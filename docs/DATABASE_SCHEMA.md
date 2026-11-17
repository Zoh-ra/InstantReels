# Database Schema (proposed)

Status: **Proposed (Phase 0)**. Migrations will live in `supabase/migrations/` from Phase 2.

## 1. Content (read-only for users)

```sql
surahs (
  id smallint primary key check (id between 1 and 114),
  name_arabic text not null, name_simple text not null, name_french text,
  verse_count smallint not null, revelation_place text
)

verses (
  surah_id smallint references surahs, verse_number smallint not null,
  verse_key text generated always as (surah_id || ':' || verse_number) stored,
  word_count smallint not null,
  primary key (surah_id, verse_number)
)

quran_words (
  surah_id smallint, verse_number smallint, position smallint check (position >= 1),
  text_arabic text not null,             -- raw, never normalized
  text_sha256 bytea not null,
  source_id int references content_sources,
  import_batch_id uuid references import_batches,
  source_row int,                        -- provenance: workbook row number
  primary key (surah_id, verse_number, position),
  foreign key (surah_id, verse_number) references verses
)

word_translations (
  surah_id, verse_number, position,       -- FK to quran_words
  source_id int references content_sources,  -- trigger: must be the workbook source (D-07)
  text text not null,                     -- exactly as in the workbook
  primary key (surah_id, verse_number, position, source_id)
)

word_reference_flags (       -- external cross-checks only FLAG, never write into quran_words/word_translations
  id bigserial, surah_id, verse_number, position, reference_source_id int,
  workbook_value text, reference_value text, kind text, status text default 'open'
)

content_sources (            -- provenance and licensing for every dataset
  id serial primary key, kind text check (kind in ('arabic','word_translation','verse_translation')),
  name text, author text, language_code text,
  provider text,             -- 'workbook', 'quran_foundation', ...
  provider_resource_id text, -- e.g. QF translation id '31'
  license_status text check (license_status in ('verified','pending','restricted')),
  license_notes text, attribution_text text
)

content_revisions (          -- audited corrections; nothing is edited in place silently
  id bigserial, table_name text, row_key jsonb, old_value text, new_value text,
  reason text, approved_by uuid, created_at timestamptz default now()
)
```

Full-verse content (Mode B), imported from Tanzil files (D-02/D-03), versioned:

```sql
verse_texts (surah_id, verse_number, source_id, text, text_sha256, primary key (surah_id, verse_number, source_id))
verse_translations (surah_id, verse_number, source_id, text, text_sha256, primary key (surah_id, verse_number, source_id))
```

If the Quran Foundation API is used instead, its content goes to a `verse_translation_cache` with a 7-day TTL purge (their terms).

## 2. Import

```sql
import_batches (id uuid pk, source_file_name text, source_sha256 bytea unique,
  status text check (status in ('parsing','previewed','committed','failed','rolled_back')),
  stats jsonb, created_by uuid, created_at, committed_at)
import_validation_issues (id bigserial, batch_id uuid, row_number int, ref text,
  severity text check (severity in ('error','warning','info')), code text, message text,
  resolution text check (resolution in ('open','accepted','corrected','ignored')))
import_staging_words (batch_id, surah_id, verse_number, position, text_arabic, text_french, source_row)
```

## 3. Branding

```sql
country_profiles (code text pk check (code in ('FR','UK','SE')), display_name text,
  institution_label text, default_translation_source_id int, locale text)
qr_assets (id uuid pk, country_code text references country_profiles,
  kind text check (kind in ('uploaded_image','generated_from_url')),
  target_url text,              -- for generated codes; replacing it = new permanent destination (D-09)
  storage_path text, decoded_payload text, ec_level text, module_count int,
  status text check (status in ('active','placeholder','retired')),
  is_current boolean)           -- one current asset per country (partial unique index)
```

## 4. Projects (RLS: owner only)

```sql
profiles (id uuid pk references auth.users, display_name, role text default 'editor')
projects (id uuid pk, owner_id uuid not null, title text, mode text check (mode in ('word_by_word','full_verse')),
  country_code text, fps smallint default 30, document jsonb not null,  -- ProjectDocument (Zod)
  document_version int not null default 1, updated_at timestamptz)    -- optimistic locking for autosave
project_scenes (id uuid pk, project_id uuid, ordinal int, start_frame int, end_frame int,
  check (end_frame > start_frame), layout jsonb, unique (project_id, ordinal))
scene_words (scene_id uuid, surah_id, verse_number, position, ordinal smallint,
  primary key (scene_id, ordinal))
audio_assets (id uuid pk, owner_id, storage_path, original_name, mime, duration_ms int,
  sample_rate int, channels smallint, normalized_path text, probe jsonb)
background_media (id uuid pk, owner_id, provider text, provider_id text, source_url text,
  width int, height int, duration_ms int, attribution jsonb, local_path text, probe jsonb)
render_jobs (id uuid pk, project_id, owner_id, preset text check (preset in ('1080p30','2160p30','1080p60')),
  document_snapshot jsonb, status text check (status in ('queued','rendering','encoding','validating','succeeded','failed','cancelled')),
  progress real, error jsonb, attempts smallint, created_at, started_at, finished_at)
exported_videos (id uuid pk, render_job_id uuid unique, storage_path, size_bytes bigint,
  probe jsonb, validation jsonb, expires_at timestamptz)
```

Scenes are also present inside `projects.document`; `project_scenes`/`scene_words` are a normalized projection kept in sync on save to enable integrity constraints (no word duplicated or missing per verse — checked by a trigger/function).

## 5. Indexes

`quran_words (surah_id, verse_number)`, `projects (owner_id, updated_at desc)`, `render_jobs (status, created_at)`, trigram index on `surahs.name_simple/name_french` for search.
