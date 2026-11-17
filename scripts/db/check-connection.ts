/**
 * Read-only configuration and connectivity check for the Supabase project.
 * NEVER prints values: only variable names, booleans, formats, HTTP status codes and counts.
 * Every message is passed through redact() which masks all configured values.
 * Nothing is written: HTTP calls are GETs, the SQL runs in a READ ONLY transaction then rolls back.
 *
 * Usage: npx tsx scripts/db/check-connection.ts
 */
import pg from 'pg';
import { loadDotEnv } from '@instantreels/core/node';

loadDotEnv(['.env.local']);
const NAMES = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_URL'] as const;
const env = Object.fromEntries(NAMES.map((n) => [n, (process.env[n] ?? '').trim()])) as Record<(typeof NAMES)[number], string>;
const PLACEHOLDER = /replace_me|your-project-ref|YOUR-DB-PASSWORD|\[YOUR-PASSWORD\]|aws-0-region/i;

// mask every configured value and its URL parts in any output
const secrets = new Set<string>();
for (const v of Object.values(env)) {
  if (v.length >= 6) secrets.add(v);
  try {
    const u = new URL(v);
    for (const part of [u.host, u.hostname, u.username, decodeURIComponent(u.password), u.password]) if (part && part.length >= 4 && part !== 'postgres') secrets.add(part);
  } catch { /* not a URL */ }
}
const redact = (s: string) => [...secrets].sort((a, b) => b.length - a.length).reduce((acc, v) => acc.split(v).join('«redacted»'), s);
let failures = 0;
const report = (ok: boolean, name: string, detail = '') => {
  if (!ok) failures++;
  console.log(redact(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`));
};

// ── 1–2. presence, placeholders, formats ──
for (const n of NAMES) report(env[n] !== '', `${n} present`);
for (const n of NAMES) if (env[n]) report(!PLACEHOLDER.test(env[n]), `${n} is not a template value`);
let url: URL | null = null;
try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { /* reported below */ }
report(!!url && url.protocol === 'https:' && url.hostname.endsWith('.supabase.co'), 'project URL format (https://<ref>.supabase.co)');
report(!!url && !!env.SUPABASE_PROJECT_REF && url.hostname.split('.')[0] === env.SUPABASE_PROJECT_REF, 'SUPABASE_PROJECT_REF matches the project URL');
const pubKind = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') ? 'new publishable key' : env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith('eyJ') ? 'legacy anon JWT' : 'unknown';
const secKind = env.SUPABASE_SECRET_KEY.startsWith('sb_secret_') ? 'new secret key' : env.SUPABASE_SECRET_KEY.startsWith('eyJ') ? 'legacy service_role JWT' : 'unknown';
report(pubKind !== 'unknown', 'publishable key format', pubKind);
report(secKind !== 'unknown', 'secret key format', secKind);
report(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== env.SUPABASE_SECRET_KEY, 'publishable and secret keys are different');
let db: URL | null = null;
try { db = new URL(env.SUPABASE_DB_URL); } catch { /* reported below */ }
const dbMode = !db ? 'invalid' : db.hostname.endsWith('pooler.supabase.com') ? (db.port === '5432' ? 'session pooler' : db.port === '6543' ? 'transaction pooler' : `pooler port ${db.port}`) : db.hostname.startsWith('db.') ? 'direct connection' : 'other host';
report(!!db && /^postgres(ql)?:$/.test(db.protocol) && !!db.password, 'database URL format (postgresql://user:password@host:port/db)', dbMode);

// ── 3. read-only HTTP checks ──
if (url) {
  const base = url.origin;
  try {
    const r = await fetch(`${base}/auth/v1/health`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(10000) });
    report(r.ok, 'Auth API reachable with the publishable key (GET /auth/v1/health)', `HTTP ${r.status}`);
  } catch (e) {
    report(false, 'Auth API reachable', (e as Error).message);
  }
  try {
    // secret key validity: list storage buckets (read-only, returns bucket names only)
    const r = await fetch(`${base}/storage/v1/bucket`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` }, signal: AbortSignal.timeout(10000) });
    const body = r.ok ? ((await r.json()) as { id: string }[]) : [];
    report(r.ok, 'secret key accepted by Storage API (GET /storage/v1/bucket)', `HTTP ${r.status}; ${body.length} existing bucket(s)${body.length ? `: ${body.map((b) => b.id).join(', ')}` : ''}`);
  } catch (e) {
    report(false, 'Storage API reachable', (e as Error).message);
  }
  try {
    // the publishable key must NOT grant admin access
    const r = await fetch(`${base}/auth/v1/admin/users?per_page=1`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}` }, signal: AbortSignal.timeout(10000) });
    report(r.status === 401 || r.status === 403, 'publishable key has no admin rights', `HTTP ${r.status} (expected 401/403)`);
  } catch (e) {
    report(false, 'admin-rights probe', (e as Error).message);
  }
}

// ── 5. read-only PostgreSQL check ──
if (db) {
  // Supabase uses its own CA; certificate pinning (Supabase CA bundle) is planned for production.
  const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  try {
    await client.connect();
    await client.query('begin transaction read only');
    const info = await client.query<{ version: string; ssl: boolean; ro: string; public_tables: number; conflicts: string[] | null; has_auth: boolean; has_storage: boolean }>(`
      select split_part(current_setting('server_version'), ' ', 1) as version,
             coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as ssl,
             current_setting('transaction_read_only') as ro,
             (select count(*)::int from information_schema.tables where table_schema = 'public') as public_tables,
             (select array_agg(table_name::text order by table_name) from information_schema.tables
               where table_schema = 'public' and table_name = any(array['content_sources','surahs','verses','quran_words','word_translations',
               'import_batches','import_validation_issues','word_reference_flags','content_revisions','import_staging_words','profiles',
               'country_profiles','qr_assets','projects','audio_assets','render_jobs','exported_videos'])) as conflicts,
             exists(select 1 from information_schema.schemata where schema_name = 'auth') as has_auth,
             exists(select 1 from information_schema.schemata where schema_name = 'storage') as has_storage`);
    await client.query('rollback');
    const i = info.rows[0]!;
    report(true, 'PostgreSQL connection', `server ${i.version}, SSL ${i.ssl ? 'on' : 'off'}, transaction read-only = ${i.ro}`);
    report(i.has_auth && i.has_storage, 'Supabase auth and storage schemas present');
    report(!i.conflicts, 'no name conflict with the planned Phase 2 tables', i.conflicts ? `existing: ${i.conflicts.join(', ')}` : `${i.public_tables} table(s) currently in schema public`);
  } catch (e) {
    report(false, 'PostgreSQL connection', (e as Error).message);
  } finally {
    await client.end().catch(() => undefined);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall connection checks passed');
process.exitCode = failures ? 1 : 0;
