-- InstantReels — users, branding profiles, projects, render jobs, storage.
-- All user data is private: every policy is scoped to (select auth.uid()).

-- ───────────────────────── profiles ─────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  role          text not null default 'editor' check (role in ('editor', 'content_admin')),
  created_at    timestamptz not null default now()
);

-- create a profile row when a user signs up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── country / branding profiles ─────────────────────────
create table public.country_profiles (
  code                text primary key check (code in ('FR', 'UK', 'SE')),
  institution_label   text not null,
  locale              text not null,
  translation_source_id integer references public.content_sources (id)
);
insert into public.country_profiles (code, institution_label, locale) values
  ('FR', 'Al-Huda International France', 'fr'),
  ('UK', 'Al-Huda International UK', 'en'),
  ('SE', 'Al-Huda International Sweden', 'sv');

create table public.qr_assets (
  id               uuid primary key default gen_random_uuid(),
  country_code     text not null references public.country_profiles (code),
  kind             text not null check (kind in ('uploaded_image', 'generated_from_url')),
  target_url       text,                     -- permanent destination for generated codes (D-09)
  storage_path     text,                     -- branding bucket
  decoded_payload  text,
  ec_level         text check (ec_level in ('L', 'M', 'Q', 'H')),
  status           text not null default 'active' check (status in ('active', 'placeholder', 'retired')),
  is_current       boolean not null default false,
  created_at       timestamptz not null default now(),
  check (kind <> 'generated_from_url' or target_url is not null)
);
create unique index qr_assets_one_current_per_country on public.qr_assets (country_code) where is_current;
-- France QR supplied by the owner (bundled asset, payload verified); UK/SE stay placeholders until supplied
insert into public.qr_assets (country_code, kind, storage_path, decoded_payload, ec_level, status, is_current) values
  ('FR', 'uploaded_image', 'bundled/qr/fr.jpg', 'https://qr.codes/FGWXbJ', 'H', 'active', true),
  ('UK', 'uploaded_image', null, null, null, 'placeholder', true),
  ('SE', 'uploaded_image', null, null, null, 'placeholder', true);

-- ───────────────────────── projects ─────────────────────────
create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 200),
  mode              text not null check (mode in ('word_by_word', 'full_verse')),
  surah_id          smallint not null references public.surahs (id),
  country_code      text not null references public.country_profiles (code),
  -- RenderDocument v2 (validated with Zod on the server before every write)
  document          jsonb not null check (jsonb_typeof(document) = 'object'),
  document_version  integer not null default 1,     -- optimistic locking for autosave
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index projects_owner_recent on public.projects (owner_id, updated_at desc);

create function public.touch_project() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.document_version := old.document_version + 1;
  new.owner_id := old.owner_id;                 -- ownership cannot be transferred by an update
  return new;
end $$;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_project();

-- ───────────────────────── media & rendering ─────────────────────────
create table public.audio_assets (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete set null,
  storage_path    text not null,                -- audio/<owner_id>/<uuid>.<ext>
  original_name   text not null,
  mime            text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  duration_ms     integer,
  probe           jsonb,
  created_at      timestamptz not null default now()
);

create table public.background_media (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path    text not null,                -- backgrounds/<owner_id>/<uuid>.<ext>
  original_name   text not null,
  mime            text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  width           integer,
  height          integer,
  duration_ms     integer,
  provider        text not null default 'upload' check (provider in ('upload', 'pexels')),
  attribution     jsonb,
  created_at      timestamptz not null default now()
);

create table public.render_jobs (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  preset             text not null check (preset in ('1080p30', '2160p30')),
  document_snapshot  jsonb not null,
  status             text not null default 'queued' check (status in ('queued', 'rendering', 'encoding', 'validating', 'succeeded', 'failed', 'cancelled')),
  progress           real not null default 0 check (progress between 0 and 1),
  error              jsonb,
  attempts           smallint not null default 0,
  cancel_requested   boolean not null default false,
  worker_id          text,
  heartbeat_at       timestamptz,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz
);
create index render_jobs_queue on public.render_jobs (status, created_at);

create table public.exported_videos (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  render_job_id   uuid not null unique references public.render_jobs (id) on delete cascade,
  storage_path    text not null,                 -- exports/<owner_id>/<job_id>.mp4
  size_bytes      bigint not null,
  probe           jsonb not null,
  validation      jsonb not null,
  expires_at      timestamptz not null default now() + interval '7 days',
  created_at      timestamptz not null default now()
);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.profiles         enable row level security;
alter table public.country_profiles enable row level security;
alter table public.qr_assets        enable row level security;
alter table public.projects         enable row level security;
alter table public.audio_assets     enable row level security;
alter table public.background_media enable row level security;
alter table public.render_jobs      enable row level security;
alter table public.exported_videos  enable row level security;

create policy "own profile: read"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- users may only change their display name; role changes are reserved to the server (secret key)
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "branding readable" on public.country_profiles for select to authenticated using (true);
create policy "qr readable"       on public.qr_assets        for select to authenticated using (status <> 'retired');

create policy "own projects: read"   on public.projects for select to authenticated using (owner_id = (select auth.uid()));
create policy "own projects: create" on public.projects for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own projects: update" on public.projects for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own projects: delete" on public.projects for delete to authenticated using (owner_id = (select auth.uid()));

create policy "own audio: read"   on public.audio_assets for select to authenticated using (owner_id = (select auth.uid()));
create policy "own audio: create" on public.audio_assets for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own audio: delete" on public.audio_assets for delete to authenticated using (owner_id = (select auth.uid()));
create policy "own backgrounds: read"   on public.background_media for select to authenticated using (owner_id = (select auth.uid()));
create policy "own backgrounds: create" on public.background_media for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own backgrounds: delete" on public.background_media for delete to authenticated using (owner_id = (select auth.uid()));

-- jobs are created/updated by the server and worker only; users can read and see progress
create policy "own render jobs: read" on public.render_jobs     for select to authenticated using (owner_id = (select auth.uid()));
create policy "own exports: read"     on public.exported_videos for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.profiles, public.country_profiles, public.qr_assets, public.projects,
              public.audio_assets, public.background_media, public.render_jobs, public.exported_videos from anon;
revoke update on public.audio_assets, public.background_media from authenticated;
revoke insert, update, delete on public.country_profiles, public.qr_assets, public.render_jobs, public.exported_videos from authenticated;

-- ───────────────────────── Storage (private buckets) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('audio',    'audio',    false, 104857600,  array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac']),
  ('backgrounds', 'backgrounds', false, 524288000, array['video/mp4', 'video/quicktime', 'video/webm']),
  ('exports',  'exports',  false, 2147483648, array['video/mp4']),
  ('branding', 'branding', false, 5242880,    array['image/png', 'image/jpeg', 'image/svg+xml']);

-- objects are stored under <bucket>/<owner uid>/…; users only touch their own folder
create policy "audio: own folder read"   on storage.objects for select to authenticated using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio: own folder upload" on storage.objects for insert to authenticated with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio: own folder delete" on storage.objects for delete to authenticated using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "backgrounds: own folder read"   on storage.objects for select to authenticated using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "backgrounds: own folder upload" on storage.objects for insert to authenticated with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "backgrounds: own folder delete" on storage.objects for delete to authenticated using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "exports: own folder read" on storage.objects for select to authenticated using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "branding: read"           on storage.objects for select to authenticated using (bucket_id = 'branding');
-- exports and branding are written by the server/worker only (secret key)
