/**
 * Applies supabase/migrations/*.sql to an in-memory Postgres (PGlite) with a minimal emulation
 * of Supabase's auth/storage schemas and API roles, then checks RLS behaviour.
 * Nothing touches the real Supabase project.
 *
 * Usage: npx tsx scripts/db/validate-migrations.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = resolve(import.meta.dirname, '../..');
const dir = resolve(ROOT, 'supabase/migrations');
const db = new PGlite();

// ── minimal Supabase emulation ──
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  await db.exec(readFileSync(resolve(dir, f), 'utf8'));
  console.log(`applied ${f}`);
}

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
async function as<T>(role: 'anon' | 'authenticated', sub: string | null, fn: () => Promise<T>): Promise<T | Error> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
  try {
    return await fn();
  } catch (e) {
    return e as Error;
  } finally {
    await db.exec('reset role');
  }
}

// ── seed as owner (like the server-side importer) ──
await db.exec(`
  insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
  insert into public.content_sources (kind, name, language_code, provider) values
    ('arabic_text', 'Workbook Arabic', 'ar', 'workbook'),
    ('word_translation', 'Dr Usama Nonnenmacher — mot à mot', 'fr', 'workbook'),
    ('verse_translation', 'Hamidullah', 'fr', 'tanzil');
  insert into public.import_batches (id, source_id, source_file_name, source_sha256, status)
    values ('11111111-1111-1111-1111-111111111111', 1, 'wbw.xlsx', repeat('a', 64), 'committed');
  insert into public.surahs (id, verse_count) values (1, 7), (9, 129);
  insert into public.verses (surah_id, verse_number, word_count) values (1, 1, 4);
  insert into public.quran_words values (1, 1, 1, 'token-ar', repeat('b', 64), 1, '11111111-1111-1111-1111-111111111111', 2);
  insert into public.word_translations values (1, 1, 1, 2, 'token-fr', '11111111-1111-1111-1111-111111111111');
`);

check('profiles auto-created for new users', (await db.query('select count(*)::int as n from public.profiles')).rows[0]!['n' as never] === 2);
check('surah name code generated', (await db.query<{ name_code: string }>('select name_code from public.surahs where id = 9')).rows[0]?.name_code === '009');

const badTranslation = await db.query(`insert into public.word_translations values (1, 1, 1, 3, 'x', '11111111-1111-1111-1111-111111111111')`).catch((e: Error) => e);
check('word translations accepted only from the workbook source', badTranslation instanceof Error, badTranslation instanceof Error ? badTranslation.message.slice(0, 80) : 'insert succeeded');
const dupBatch = await db.query(`insert into public.import_batches (source_id, source_file_name, source_sha256, status) values (1, 'again.xlsx', repeat('a', 64), 'committed')`).catch((e: Error) => e);
check('same workbook cannot be committed twice', dupBatch instanceof Error);

// ── content access ──
const anonWords = await as('anon', null, () => db.query('select * from public.quran_words'));
check('anon cannot read Quranic content', anonWords instanceof Error, anonWords instanceof Error ? 'permission denied' : `${anonWords.rows.length} rows`);
const userWords = await as('authenticated', A, () => db.query('select * from public.quran_words'));
check('signed-in user can read Quranic content', !(userWords instanceof Error) && userWords.rows.length === 1);
const userWrite = await as('authenticated', A, () => db.query(`update public.quran_words set text_arabic = 'x'`));
check('signed-in user cannot modify Quranic content', userWrite instanceof Error);
const userImport = await as('authenticated', A, () => db.query('select * from public.import_batches'));
check('import tables hidden from users', userImport instanceof Error);

// ── projects ──
const doc = JSON.stringify({ version: 2 });
const insA = await as('authenticated', A, () => db.query(`insert into public.projects (title, mode, surah_id, country_code, document) values ('A1', 'word_by_word', 1, 'FR', $1) returning owner_id`, [doc]));
check('user creates own project (owner = auth.uid())', !(insA instanceof Error) && (insA.rows[0] as { owner_id: string }).owner_id === A, insA instanceof Error ? insA.message : '');
const spoof = await as('authenticated', A, () => db.query(`insert into public.projects (owner_id, title, mode, surah_id, country_code, document) values ('${B}', 'spoof', 'word_by_word', 1, 'FR', $1)`, [doc]));
check('user cannot create a project for someone else', spoof instanceof Error);
const readB = await as('authenticated', B, () => db.query('select * from public.projects'));
check("user B cannot see user A's projects", !(readB instanceof Error) && readB.rows.length === 0);
const updB = await as('authenticated', B, () => db.query(`update public.projects set title = 'hacked' returning id`));
check("user B cannot update user A's projects", !(updB instanceof Error) && updB.rows.length === 0);
const upd = await as('authenticated', A, () => db.query<{ document_version: number }>(`update public.projects set title = 'A1 bis' returning document_version`));
check('update bumps document_version (optimistic locking)', !(upd instanceof Error) && upd.rows[0]?.document_version === 2);
const steal = await as('authenticated', A, () => db.query(`update public.projects set owner_id = '${B}' returning owner_id`));
check('ownership cannot be transferred', !(steal instanceof Error) && (steal.rows[0] as { owner_id: string }).owner_id === A);
const anonProjects = await as('anon', null, () => db.query('select * from public.projects'));
check('anon cannot read projects', anonProjects instanceof Error);
const roleEsc = await as('authenticated', A, () => db.query(`update public.profiles set role = 'content_admin'`));
check('user cannot escalate own role', roleEsc instanceof Error);
const nameOk = await as('authenticated', A, () => db.query(`update public.profiles set display_name = 'Zohra' returning id`));
check('user can edit own display name', !(nameOk instanceof Error) && nameOk.rows.length === 1);
const jobInsert = await as('authenticated', A, () => db.query(`insert into public.render_jobs (project_id, preset, document_snapshot) select id, '2160p30', document from public.projects`));
check('users cannot create render jobs directly (server only)', jobInsert instanceof Error);

// ── storage ──
const upOwn = await as('authenticated', A, () => db.query(`insert into storage.objects (bucket_id, name) values ('audio', '${A}/rec.mp3')`));
check('upload to own audio folder allowed', !(upOwn instanceof Error), upOwn instanceof Error ? upOwn.message : '');
const upOther = await as('authenticated', A, () => db.query(`insert into storage.objects (bucket_id, name) values ('audio', '${B}/rec.mp3')`));
check("upload to someone else's folder refused", upOther instanceof Error);
const upExport = await as('authenticated', A, () => db.query(`insert into storage.objects (bucket_id, name) values ('exports', '${A}/x.mp4')`));
check('users cannot write exports (worker only)', upExport instanceof Error);

await db.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall migration checks passed');
process.exitCode = failures ? 1 : 0;
