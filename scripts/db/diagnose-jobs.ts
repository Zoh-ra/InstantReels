/**
 * Read-only diagnostics of recent render jobs (no credentials printed, no writes):
 * job status/errors, document duration and settings, source media sizes, bucket limits.
 * Usage: npx tsx scripts/db/diagnose-jobs.ts [limit]
 */
import pg from 'pg';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';

loadDotEnv();
const limit = Number(process.argv[2] ?? 5);
const c = new pg.Client({ connectionString: requireEnv('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query('begin transaction read only');
  const buckets = await c.query(`select id, file_size_limit, allowed_mime_types from storage.buckets order by id`);
  console.log('buckets:', buckets.rows.map((b) => `${b.id} limit=${b.file_size_limit ? (Number(b.file_size_limit) / 2 ** 20).toFixed(0) + ' MB' : 'none'}`).join(' · '));
  const jobs = await c.query(
    `select j.id, j.preset, j.status, j.error->>'message' as err, j.created_at, j.started_at, j.finished_at,
            (j.document_snapshot->>'totalFrames')::int as frames, j.document_snapshot->>'mode' as mode,
            j.document_snapshot->'background' as bg, j.document_snapshot->'audio' as audio
       from public.render_jobs j order by j.created_at desc limit $1`,
    [limit],
  );
  for (const j of jobs.rows) {
    const secs = j.started_at && j.finished_at ? ((new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000).toFixed(0) : '?';
    console.log(`\njob ${j.id.slice(0, 8)} ${j.preset} ${j.status} (${secs}s) mode=${j.mode} duration=${(j.frames / 30).toFixed(1)}s`);
    if (j.err) console.log(`  error: ${j.err.slice(0, 300)}`);
    console.log(`  background: ${j.bg?.kind}${j.bg?.kind === 'video' ? ` brightness=${j.bg.brightness} dim=${j.bg.dimOpacity} blur=${j.bg.blur} durationMs=${j.bg.durationMs}` : ` color=${j.bg?.color}`}`);
    for (const [kind, uri] of [['audio', j.audio?.src], ['background', j.bg?.src]] as const) {
      if (!uri?.startsWith('storage://')) continue;
      const [, bucket, ...rest] = uri.replace('storage://', '/').split('/');
      const obj = await c.query(`select (metadata->>'size')::bigint size, metadata->>'mimetype' mime from storage.objects where bucket_id = $1 and name = $2`, [bucket, rest.join('/')]);
      const meta = await c.query(kind === 'audio' ? `select width, height from (select null::int width, null::int height) x` : `select width, height, duration_ms from public.background_media where storage_path = $1`, kind === 'audio' ? [] : [rest.join('/')]);
      console.log(`  ${kind}: ${obj.rows[0] ? `${(Number(obj.rows[0].size) / 2 ** 20).toFixed(1)} MB ${obj.rows[0].mime}` : 'object missing'}${meta.rows[0]?.width ? ` ${meta.rows[0].width}×${meta.rows[0].height}` : ''}`);
    }
  }
  const exp = await c.query(`select count(*)::int n, coalesce(max(size_bytes),0)::bigint maxb from public.exported_videos`);
  console.log(`\nexports stored: ${exp.rows[0].n}, largest ${(Number(exp.rows[0].maxb) / 2 ** 20).toFixed(1)} MB`);
} finally {
  await c.query('rollback').catch(() => undefined);
  await c.end();
}
