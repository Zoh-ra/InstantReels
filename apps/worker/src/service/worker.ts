/**
 * InstantReels render worker (long-running Node process).
 * Claims queued jobs from public.render_jobs (FOR UPDATE SKIP LOCKED), renders with
 * Playwright + FFmpeg, validates the MP4, uploads it to Storage (exports/<owner>/<job>.mp4)
 * and records it in exported_videos. Supports cancellation, heartbeat and stale-job recovery.
 *
 * Usage: npm run worker            (loop)
 *        npm run worker -- --once  (process at most one job, then exit — used by tests)
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import type { Browser } from 'playwright-core';
import { RenderDocumentSchema, type RenderDocument } from '@instantreels/core';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { ffprobe } from '../media/ffmpeg.ts';
import { PRESETS, compose, type EncodePreset } from '../render/compose.ts';
import { launchBrowser, renderStills } from '../render/stills.ts';
import { validateOutput } from '../validate/validate-output.ts';
import { resolveAsset } from './assets.ts';

loadDotEnv();
const ROOT = resolve(import.meta.dirname, '../../../..');
const WORKER_ID = `${hostname()}-${process.pid}`;
const TMP_ROOT = resolve(ROOT, process.env.RENDER_TMP_DIR?.trim() || 'tmp/render');
const ONCE = process.argv.includes('--once');
const POLL_MS = 3000;
const STALE_MINUTES = 5;
const MAX_ATTEMPTS = 3;

const db = new pg.Client({ connectionString: requireEnv('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } });
const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

interface JobRow {
  id: string;
  owner_id: string;
  project_id: string;
  preset: EncodePreset['name'];
  document_snapshot: unknown;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function update(id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  await db.query(`update public.render_jobs set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, heartbeat_at = now() where id = $1`, [id, ...Object.values(fields)]);
}

async function recoverStale(): Promise<void> {
  const r = await db.query(
    `update public.render_jobs set status = case when attempts >= $1 then 'failed' else 'queued' end,
            error = case when attempts >= $1 then jsonb_build_object('message', 'worker stopped responding') else error end, worker_id = null
      where status in ('rendering', 'encoding', 'validating') and heartbeat_at < now() - make_interval(mins => $2) returning id`,
    [MAX_ATTEMPTS, STALE_MINUTES],
  );
  if (r.rowCount) log(`recovered ${r.rowCount} stale job(s)`);
}

/** Removes exported MP4s past their expiry date (Storage object + database row). */
let lastPurge = 0;
async function purgeExpiredExports(): Promise<void> {
  if (Date.now() - lastPurge < 3_600_000) return;
  lastPurge = Date.now();
  const r = await db.query<{ id: string; storage_path: string }>(`select id, storage_path from public.exported_videos where expires_at < now() limit 200`);
  if (!r.rows.length) return;
  const { error } = await supabase.storage.from('exports').remove(r.rows.map((x) => x.storage_path));
  if (error) return log(`purge failed: ${error.message}`);
  await db.query('delete from public.exported_videos where id = any($1::uuid[])', [r.rows.map((x) => x.id)]);
  log(`purged ${r.rows.length} expired export(s)`);
}

async function claim(): Promise<JobRow | null> {
  const r = await db.query<JobRow>(
    `update public.render_jobs set status = 'rendering', worker_id = $1, started_at = now(), heartbeat_at = now(), attempts = attempts + 1, progress = 0.01, error = null
      where id = (select id from public.render_jobs where status = 'queued' and not cancel_requested order by created_at for update skip locked limit 1)
      returning id, owner_id, project_id, preset, document_snapshot`,
    [WORKER_ID],
  );
  return r.rows[0] ?? null;
}

async function isCancelled(id: string): Promise<boolean> {
  const r = await db.query<{ c: boolean }>('select cancel_requested as c from public.render_jobs where id = $1', [id]);
  return r.rows[0]?.c ?? true;
}

async function process1(job: JobRow, browser: Browser): Promise<void> {
  const preset = PRESETS[job.preset];
  const tmp = resolve(TMP_ROOT, job.id);
  mkdirSync(tmp, { recursive: true });
  const abort = new AbortController();
  const watcher = setInterval(() => {
    isCancelled(job.id).then((c) => c && abort.abort(), () => undefined);
  }, 2000);
  try {
    const base = RenderDocumentSchema.parse(job.document_snapshot);
    const ctx = { supabase, tmpDir: tmp, ownerId: job.owner_id };
    // resolve every asset to a local file
    const doc: RenderDocument = {
      ...base,
      width: preset.width,
      height: preset.height,
      audio: base.audio ? { ...base.audio, src: await resolveAsset(base.audio.src, { ...ctx, name: 'audio' }) } : null,
      background: base.background.kind === 'video' ? { ...base.background, src: await resolveAsset(base.background.src, { ...ctx, name: 'background' }) } : base.background,
      bismillah: { ...base.bismillah, src: await resolveAsset(base.bismillah.src, { ...ctx, name: 'bismillah' }) },
      branding: base.branding.qr ? { ...base.branding, qr: { ...base.branding.qr, src: await resolveAsset(base.branding.qr.src, { ...ctx, name: 'qr' }) } } : base.branding,
    };
    if (abort.signal.aborted) throw new Error('cancelled');
    await update(job.id, { progress: 0.05 });
    const stills = await renderStills(doc, { fontsDir: resolve(ROOT, 'assets/fonts'), outDir: tmp, browser });
    const layoutFailures = stills.layoutChecks.filter((c) => !c.pass);
    if (layoutFailures.length) throw new Error(`layout check failed: ${layoutFailures.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
    await update(job.id, { status: 'encoding', progress: 0.1 });
    const out = resolve(tmp, 'output.mp4');
    let lastWrite = 0;
    await compose(doc, stills, preset, out, (frame) => {
      const now = Date.now();
      if (now - lastWrite < 1000) return;
      lastWrite = now;
      void update(job.id, { progress: Math.min(0.9, 0.1 + 0.8 * (frame / doc.totalFrames)) }).catch(() => undefined);
    }, abort.signal);
    if (abort.signal.aborted) throw new Error('cancelled');

    await update(job.id, { status: 'validating', progress: 0.92 });
    const qrPayload = doc.branding.qr?.visible
      ? (await db.query<{ p: string | null }>(`select decoded_payload as p from public.qr_assets where country_code = $1 and is_current`, [doc.country])).rows[0]?.p ?? null
      : null;
    const checks = await validateOutput(out, { doc, width: preset.width, height: preset.height, level: Math.round(Number(preset.level) * 10), expectedQrPayload: qrPayload, workDir: tmp });
    // scene-switch checks are heuristics on real backgrounds: reported, not blocking
    const critical = checks.filter((c) => !c.pass && !c.name.startsWith('scene '));
    if (critical.length) throw new Error(`output validation failed: ${critical.map((c) => `${c.name} (${c.detail})`).join('; ')}`);

    const path = `${job.owner_id}/${job.id}.mp4`;
    const bytes = readFileSync(out);
    const { error: upErr } = await supabase.storage.from('exports').upload(path, bytes, { contentType: 'video/mp4', upsert: true });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);
    const probe = await ffprobe(out);
    await db.query(
      `insert into public.exported_videos (owner_id, render_job_id, storage_path, size_bytes, probe, validation) values ($1, $2, $3, $4, $5, $6)
       on conflict (render_job_id) do update set storage_path = excluded.storage_path, size_bytes = excluded.size_bytes, probe = excluded.probe, validation = excluded.validation`,
      [job.owner_id, job.id, path, statSync(out).size, JSON.stringify(probe), JSON.stringify({ checks, layout: stills.layoutChecks })],
    );
    await update(job.id, { status: 'succeeded', progress: 1, finished_at: new Date().toISOString() });
    log(`job ${job.id} succeeded (${job.preset}, ${(statSync(out).size / 2 ** 20).toFixed(1)} MB)`);
  } catch (e) {
    const cancelled = abort.signal.aborted || (e as Error).message === 'cancelled';
    await update(job.id, {
      status: cancelled ? 'cancelled' : 'failed',
      finished_at: new Date().toISOString(),
      error: JSON.stringify({ message: cancelled ? 'Annulé à la demande' : (e as Error).message.slice(0, 2000) }),
    });
    log(`job ${job.id} ${cancelled ? 'cancelled' : `failed: ${(e as Error).message.slice(0, 300)}`}`);
  } finally {
    clearInterval(watcher);
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await db.connect();
  const browser = await launchBrowser();
  log(`worker ${WORKER_ID} ready (${randomUUID().slice(0, 4)})`);
  let stop = false;
  process.on('SIGINT', () => (stop = true));
  process.on('SIGTERM', () => (stop = true));
  try {
    while (!stop) {
      await recoverStale();
      await purgeExpiredExports().catch((e: Error) => log(`purge error: ${e.message}`));
      const job = await claim();
      if (job) {
        log(`job ${job.id} claimed (${job.preset})`);
        await process1(job, browser);
        if (ONCE) break;
      } else {
        if (ONCE) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
  } finally {
    await browser.close();
    await db.end();
  }
}

await main();
