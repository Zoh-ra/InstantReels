/**
 * Live RLS verification on the real Supabase project, WITHOUT leaving any trace:
 * everything runs inside one transaction that is always rolled back (temporary users included).
 * Also checks anonymous REST access with the publishable key. Never prints credentials.
 * Usage: npx tsx scripts/db/rls-check-live.ts
 */
import pg from 'pg';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';

loadDotEnv();
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── anonymous REST (publishable key, no session) ──
const base = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const pub = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
for (const table of ['quran_words', 'word_translations', 'verse_translations', 'projects', 'import_batches']) {
  const r = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: pub } });
  const body = r.ok ? ((await r.json()) as unknown[]) : null;
  check(`anon REST cannot read ${table}`, !r.ok || (Array.isArray(body) && body.length === 0), `HTTP ${r.status}${body ? `, ${body.length} row(s)` : ''}`);
}

// ── signed-in users, simulated inside a rolled-back transaction ──
const c = new pg.Client({ connectionString: requireEnv('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const asUser = async (sub: string) => {
  await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub, role: 'authenticated' }), sub]);
  await c.query('set local role authenticated');
};
const attempt = async (sql: string, params: unknown[] = []) => {
  await c.query('savepoint s');
  try {
    const r = await c.query(sql, params);
    await c.query('release savepoint s');
    return r;
  } catch (e) {
    await c.query('rollback to savepoint s');
    return e as Error;
  }
};
try {
  await c.query('begin');
  await c.query(`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
                 values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@example.invalid', '{}', now(), now()),
                        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@example.invalid', '{}', now(), now())`, [A, B]);
  const prof = await c.query(`select count(*)::int n from public.profiles where id in ($1, $2)`, [A, B]);
  check('sign-up trigger creates profiles', prof.rows[0].n === 2);

  await asUser(A);
  const words = await attempt('select count(*)::int n from public.quran_words');
  check('signed-in user reads all Quranic words', !(words instanceof Error) && words.rows[0].n === 77429, words instanceof Error ? words.message : `${words.rows[0].n} words`);
  const v = await attempt(`select v.text_arabic, t.text from public.verse_arabic v join public.verse_translations t using (surah_id, verse_number)
                           join public.content_sources s on s.id = t.source_id where v.surah_id = 1 and v.verse_number = 1 and s.provider_resource_id = 'fr.hamidullah'`);
  check('full-verse Arabic + Hamidullah available for Mode B', !(v instanceof Error) && v.rows.length === 1);
  const tamper = await attempt(`update public.quran_words set text_arabic = 'x' where surah_id = 1 and verse_number = 1 and position = 1`);
  check('signed-in user cannot modify Quranic text', tamper instanceof Error || tamper.rowCount === 0);
  const imp = await attempt('select * from public.import_batches');
  check('import tables hidden from users', imp instanceof Error);
  const p = await attempt(`insert into public.projects (title, mode, surah_id, country_code, document) values ('rls test', 'word_by_word', 1, 'FR', '{"version":2}') returning id, owner_id`);
  check('user A creates own project', !(p instanceof Error) && p.rows[0].owner_id === A, p instanceof Error ? p.message : '');
  const spoof = await attempt(`insert into public.projects (owner_id, title, mode, surah_id, country_code, document) values ($1, 'spoof', 'word_by_word', 1, 'FR', '{}')`, [B]);
  check('user A cannot create a project for B', spoof instanceof Error);
  const role = await attempt(`update public.profiles set role = 'content_admin' where id = $1`, [A]);
  check('user cannot escalate own role', role instanceof Error);

  await c.query('reset role');
  await asUser(B);
  const seen = await attempt(`select count(*)::int n from public.projects where title = 'rls test'`);
  check("user B cannot see A's project", !(seen instanceof Error) && seen.rows[0].n === 0);
  const del = await attempt(`delete from public.projects where title = 'rls test'`);
  check("user B cannot delete A's project", !(del instanceof Error) && del.rowCount === 0);
  const upOther = await attempt(`insert into storage.objects (bucket_id, name) values ('audio', $1)`, [`${A}/x.mp3`]);
  check("user B cannot write into A's storage folder", upOther instanceof Error);
  const exp = await attempt(`insert into storage.objects (bucket_id, name) values ('exports', $1)`, [`${B}/x.mp4`]);
  check('users cannot write exports (worker only)', exp instanceof Error);
  await c.query('reset role');
  const buckets = await c.query(`select id, public from storage.buckets where id in ('audio','backgrounds','exports','branding') order by id`);
  check('4 private storage buckets exist', buckets.rows.length === 4 && buckets.rows.every((b) => b.public === false), buckets.rows.map((b) => b.id).join(', '));
} finally {
  await c.query('rollback').catch(() => undefined); // nothing persists
  await c.end();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nlive RLS checks passed (transaction rolled back, nothing persisted)');
process.exitCode = failures ? 1 : 0;
