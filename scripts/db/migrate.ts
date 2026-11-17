/**
 * Applies supabase/migrations/*.sql to the Supabase database (SUPABASE_DB_URL, session pooler).
 *   npm run db:migrate            → list pending migrations (read-only)
 *   npm run db:migrate -- --apply → apply each pending file in its own transaction (requires approval)
 * History is recorded in supabase_migrations.schema_migrations (same table as the Supabase CLI),
 * so the CLI can take over later. Never prints credentials.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';

loadDotEnv();
const apply = process.argv.includes('--apply');
const dir = resolve(import.meta.dirname, '../../supabase/migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

const client = new pg.Client({ connectionString: requireEnv('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await client.connect();
try {
  const exists = await client.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as ok`);
  const applied = new Set<string>();
  if (exists.rows[0].ok) {
    for (const r of (await client.query<{ version: string }>('select version from supabase_migrations.schema_migrations')).rows) applied.add(r.version);
  }
  const pending = files.filter((f) => !applied.has(f.slice(0, 14)));
  console.log(`migrations: ${files.length} total, ${applied.size} applied, ${pending.length} pending`);
  for (const f of pending) console.log(`  pending: ${f}`);
  if (!apply) {
    console.log('read-only listing — re-run with --apply after approval');
  } else {
    await client.query(`create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
    for (const f of pending) {
      const sql = readFileSync(resolve(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)', [f.slice(0, 14), [sql], f.slice(15, -4)]);
        await client.query('commit');
        console.log(`  applied: ${f}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`${f} failed and was rolled back: ${(e as Error).message}`);
      }
    }
    console.log('done');
  }
} finally {
  await client.end();
}
