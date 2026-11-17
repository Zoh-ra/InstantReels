-- InstantReels — Quranic content (read-only for users) + import pipeline.
-- Principles: words identified by (surah, verse, position), Arabic stored byte-for-byte
-- (never normalised), provenance kept for every row, corrections only through content_revisions.

-- ───────────────────────── sources & provenance ─────────────────────────
create table public.content_sources (
  id                  integer generated always as identity primary key,
  kind                text not null check (kind in ('arabic_text', 'word_translation', 'verse_translation')),
  name                text not null,
  author              text,
  language_code       text not null,
  provider            text not null,               -- 'workbook', 'tanzil', 'quran_foundation', …
  provider_resource_id text,                       -- e.g. Tanzil 'fr.hamidullah'
  license_status      text not null default 'pending' check (license_status in ('verified', 'pending', 'restricted')),
  license_notes       text,
  attribution_text    text,
  created_at          timestamptz not null default now(),
  unique (provider, kind, name)
);
comment on table public.content_sources is 'Provenance and licensing of every Quranic dataset.';

create table public.import_batches (
  id                uuid primary key default gen_random_uuid(),
  source_id         integer not null references public.content_sources (id),
  source_file_name  text not null,
  source_sha256     text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  status            text not null default 'parsing' check (status in ('parsing', 'previewed', 'committed', 'failed', 'rolled_back')),
  stats             jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  committed_at      timestamptz
);
-- re-importing the same file never creates a second committed batch
create unique index import_batches_one_commit_per_file on public.import_batches (source_sha256) where status = 'committed';

-- ───────────────────────── Quran structure ─────────────────────────
create table public.surahs (
  id            smallint primary key check (id between 1 and 114),
  verse_count   smallint not null check (verse_count > 0),
  -- 3-digit code selecting the calligraphic ligature in the QF Surah Names font
  name_code     text generated always as (lpad(id::text, 3, '0')) stored,
  name_arabic          text,      -- optional metadata (e.g. Tanzil quran-data), never Quranic text
  name_transliterated  text,
  name_english         text,
  revelation_order     smallint
);

create table public.verses (
  surah_id      smallint not null references public.surahs (id),
  verse_number  smallint not null check (verse_number > 0),
  word_count    smallint not null check (word_count > 0),
  verse_key     text generated always as (surah_id::text || ':' || verse_number::text) stored,
  primary key (surah_id, verse_number),
  unique (verse_key)
);

create table public.quran_words (
  surah_id         smallint not null,
  verse_number     smallint not null,
  position         smallint not null check (position > 0),
  text_arabic      text not null check (length(text_arabic) > 0),    -- byte-for-byte, QPC Hafs encoding
  text_sha256      text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  source_id        integer not null references public.content_sources (id),
  import_batch_id  uuid not null references public.import_batches (id),
  source_row       integer not null,                                   -- workbook row (provenance)
  primary key (surah_id, verse_number, position),
  foreign key (surah_id, verse_number) references public.verses (surah_id, verse_number)
);

create table public.word_translations (
  surah_id         smallint not null,
  verse_number     smallint not null,
  position         smallint not null,
  source_id        integer not null references public.content_sources (id),
  text             text not null check (length(btrim(text)) > 0),   -- exactly as in the workbook
  import_batch_id  uuid not null references public.import_batches (id),
  primary key (surah_id, verse_number, position, source_id),
  foreign key (surah_id, verse_number, position) references public.quran_words (surah_id, verse_number, position)
);

-- D-07: word-by-word translations may only come from the workbook source
create function public.enforce_workbook_word_translation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.content_sources s
    where s.id = new.source_id and s.kind = 'word_translation' and s.provider = 'workbook'
  ) then
    raise exception 'word_translations.source_id % is not the workbook word-translation source', new.source_id;
  end if;
  return new;
end $$;
create trigger word_translations_workbook_only
  before insert or update on public.word_translations
  for each row execute function public.enforce_workbook_word_translation();

-- full-verse translations (Mode B), one row per verse and source (e.g. Tanzil fr.hamidullah)
create table public.verse_translations (
  surah_id         smallint not null,
  verse_number     smallint not null,
  source_id        integer not null references public.content_sources (id),
  text             text not null check (length(btrim(text)) > 0),
  text_sha256      text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  import_batch_id  uuid not null references public.import_batches (id),
  primary key (surah_id, verse_number, source_id),
  foreign key (surah_id, verse_number) references public.verses (surah_id, verse_number)
);

-- Mode B Arabic = the workbook words of the verse joined by a space (same QPC Hafs text and font as Mode A)
create view public.verse_arabic with (security_invoker = true) as
  select surah_id, verse_number, string_agg(text_arabic, ' ' order by position) as text_arabic, count(*)::int as word_count
  from public.quran_words group by surah_id, verse_number;

-- ───────────────────────── review & audit ─────────────────────────
create table public.import_validation_issues (
  id           bigint generated always as identity primary key,
  batch_id     uuid not null references public.import_batches (id) on delete cascade,
  row_number   integer,
  ref          text,                                 -- 'S:V:W' or 'S:V'
  severity     text not null check (severity in ('error', 'warning', 'info')),
  code         text not null,
  message      text not null,
  resolution   text not null default 'open' check (resolution in ('open', 'accepted', 'corrected', 'ignored')),
  resolved_by  uuid references auth.users (id),
  resolved_at  timestamptz
);
create index on public.import_validation_issues (batch_id, severity);

-- Arabic differences against an external reference: FLAGS ONLY, never written into quran_words
create table public.word_reference_flags (
  id                   bigint generated always as identity primary key,
  surah_id             smallint not null,
  verse_number         smallint not null,
  position             smallint,
  reference_source_id  integer not null references public.content_sources (id),
  workbook_value       text,
  reference_value      text,
  kind                 text not null,                -- 'diacritic', 'segmentation', 'symbol_spacing', …
  status               text not null default 'open' check (status in ('open', 'confirmed_workbook', 'needs_correction', 'ignored')),
  note                 text,
  created_at           timestamptz not null default now()
);

create table public.content_revisions (
  id            bigint generated always as identity primary key,
  table_name    text not null,
  row_key       jsonb not null,
  old_value     text,
  new_value     text,
  reason        text not null,
  approved_by   uuid not null references auth.users (id),
  created_at    timestamptz not null default now()
);

-- staging area used by the importer inside its transaction
create table public.import_staging_words (
  batch_id      uuid not null references public.import_batches (id) on delete cascade,
  surah_id      smallint not null,
  verse_number  smallint not null,
  position      smallint not null,
  text_arabic   text not null,
  text_french   text not null,
  source_row    integer not null,
  primary key (batch_id, surah_id, verse_number, position)
);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.content_sources          enable row level security;
alter table public.surahs                   enable row level security;
alter table public.verses                   enable row level security;
alter table public.quran_words              enable row level security;
alter table public.word_translations        enable row level security;
alter table public.verse_translations       enable row level security;
alter table public.import_batches           enable row level security;
alter table public.import_validation_issues enable row level security;
alter table public.word_reference_flags     enable row level security;
alter table public.content_revisions        enable row level security;
alter table public.import_staging_words     enable row level security;

-- signed-in users can READ content (the workbook is not published to anonymous visitors)
create policy "content readable by signed-in users" on public.content_sources   for select to authenticated using (true);
create policy "surahs readable by signed-in users"  on public.surahs            for select to authenticated using (true);
create policy "verses readable by signed-in users"  on public.verses            for select to authenticated using (true);
create policy "words readable by signed-in users"   on public.quran_words       for select to authenticated using (true);
create policy "word translations readable by signed-in users" on public.word_translations for select to authenticated using (true);
create policy "verse translations readable by signed-in users" on public.verse_translations for select to authenticated using (true);
-- no insert/update/delete policies: only the server-side importer (secret key, bypasses RLS) writes.
-- import_*, word_reference_flags, content_revisions: no policies at all → invisible to anon/authenticated.

revoke all on public.import_batches, public.import_validation_issues, public.word_reference_flags,
              public.content_revisions, public.import_staging_words from anon, authenticated;
revoke insert, update, delete on public.content_sources, public.surahs, public.verses,
              public.quran_words, public.word_translations, public.verse_translations from anon, authenticated;
revoke all on public.content_sources, public.surahs, public.verses, public.quran_words, public.word_translations,
              public.verse_translations, public.verse_arabic from anon;
revoke insert, update, delete on public.verse_arabic from authenticated;
