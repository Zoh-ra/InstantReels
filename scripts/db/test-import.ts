/**
 * Integration test: applies the migrations to an in-memory Postgres (PGlite), imports the FULL
 * workbook with the real commit code, then checks counts, byte-for-byte integrity and idempotency.
 * Nothing touches Supabase. Usage: npx tsx scripts/db/test-import.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { analyzeWorkbook } from '../../packages/importer/src/analyze.ts';
import { commitWorkbook } from '../../packages/importer/src/commit.ts';

loadDotEnv();
const ROOT = resolve(import.meta.dirname, '../..');
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`);
for (const f of readdirSync(resolve(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(resolve(ROOT, 'supabase/migrations', f), 'utf8'));
}

// minimal pg.Client adapter over PGlite
const client = {
  query: async (sql: string, params?: unknown[]) => {
    const r = await db.query(sql, params as never[]);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
} as unknown as pg.Client;

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const analysis = await analyzeWorkbook(requireEnv('WBW_XLSX_PATH'));
const t0 = performance.now();
const first = await commitWorkbook(client, analysis);
check('first import committed', first.status === 'committed', `${((performance.now() - t0) / 1000).toFixed(1)} s, ${JSON.stringify(first.inserted)}`);

const one = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows[0]!;
const counts = await one(`select (select count(*)::int from public.quran_words) w, (select count(*)::int from public.word_translations) t,
  (select count(*)::int from public.verses) v, (select count(*)::int from public.surahs) s, (select coalesce(sum(verse_count),0)::int from public.surahs) sv`);
check('77,429 words / 77,429 glosses / 6,236 verses / 114 surahs', counts.w === 77429 && counts.t === 77429 && counts.v === 6236 && counts.s === 114 && counts.sv === 6236, JSON.stringify(counts));

// byte-for-byte: every stored word equals the workbook cell
const stored = await db.query<{ k: string; a: string; f: string }>(`select w.surah_id||':'||w.verse_number||':'||w.position k, w.text_arabic a, t.text f from public.quran_words w join public.word_translations t using (surah_id, verse_number, position)`);
const map = new Map(stored.rows.map((r) => [r.k, r]));
const mismatches = analysis.words.filter((w) => {
  const r = map.get(`${w.surah}:${w.verse}:${w.position}`);
  return !r || r.a !== w.arabic || r.f !== w.french;
}).length;
check('Arabic and French stored byte-for-byte (no normalisation, no trimming)', mismatches === 0, `${mismatches} mismatch(es)`);

const v = await one(`select text_arabic, word_count from public.verse_arabic where surah_id = 1 and verse_number = 7`);
const expected7 = analysis.words.filter((w) => w.surah === 1 && w.verse === 7).map((w) => w.arabic).join(' ');
check('verse_arabic view rebuilds 1:7 from its 9 words', v.text_arabic === expected7 && v.word_count === 9);

const issues = await one(`select count(*)::int n from public.import_validation_issues`);
check('validation issues stored for review', issues.n === analysis.issues.length, `${String(issues.n)} issue(s)`);

const second = await commitWorkbook(client, analysis);
check('re-importing the same file is a no-op', second.status === 'already_imported');
const after = await one(`select count(*)::int w from public.quran_words`);
check('no duplication after re-import', after.w === 77429);

await db.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nimport integration test passed');
process.exitCode = failures ? 1 : 0;
