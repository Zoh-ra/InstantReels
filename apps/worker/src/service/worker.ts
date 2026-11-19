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
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import type { Browser } from 'playwright-core';
import { RenderDocumentSchema, type RenderDocument } from '@instantreels/core';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { ffprobe } from '../media/ffmpeg.ts';
import { PRESETS, compose, planDelivery, type EncodePreset } from '../render/compose.ts';
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

// A pool (not a single Client): the Supabase pooler drops idle connections (ECONNRESET); the pool discards
// broken clients and opens new ones. Every query here is a single statement, so pooling is safe.
const db = new pg.Pool({ connectionString: requireEnv('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 60_000, keepAlive: true });
db.on('error', (e: Error) => console.log(new Date().toISOString(), `db idle client error (recovered): ${e.message}`));
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
  const remote = r.rows.filter((x) => !x.storage_path.startsWith('local://')).map((x) => x.storage_path);
  if (remote.length) {
    const { error } = await supabase.storage.from('exports').remove(remote);
    if (error) return log(`purge failed: ${error.message}`);
  }
  for (const x of r.rows.filter((y) => y.storage_path.startsWith('local://'))) rmSync(resolve(EXPORTS_DIR, x.storage_path.slice('local://'.length)), { force: true });
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

/** Translates technical failures into actionable French messages (kept with the raw detail for diagnosis). */
export function explainFailure(raw: string): string {
  if (/text does not fit|ne tient pas/.test(raw)) return 'Le texte d’une scène ne tient pas dans son cadre. Réduisez la taille du texte ou divisez la scène, puis relancez l’export.';
  if (/layout check failed/.test(raw)) {
    if (/overlaps/.test(raw)) return 'Deux éléments se chevauchent (titre, cadres, QR code ou libellé). Ajustez leur position ou leur taille, puis relancez.';
    if (/outside margin/.test(raw)) return 'Un élément sort de la zone visible (marges de sécurité). Rapprochez-le du centre ou réduisez sa taille.';
    return 'La mise en page d’une scène est invalide. Vérifiez les avertissements de l’éditeur, puis relancez.';
  }
  if (/cannot download|object missing|Object not found/i.test(raw)) return 'Un fichier du projet (audio ou vidéo de fond) est introuvable dans le stockage. Réimportez-le dans « Médias ».';
  if (/fonts not loaded|Surah Names font/i.test(raw)) return 'Une police n’a pas pu être chargée (connexion Internet requise pour la police des noms de sourates). Relancez l’export.';
  if (/output validation failed/.test(raw)) return 'La vidéo produite n’a pas passé les contrôles de qualité. Relancez l’export ; si le problème persiste, contactez le support avec l’identifiant de l’export.';
  if (/exceeded the maximum allowed size|upload failed/i.test(raw)) return 'La vidéo dépasse la taille maximale acceptée par le stockage Supabase. Elle sera conservée sur le serveur de rendu lors du prochain essai.';
  if (/ffmpeg exited/.test(raw)) return 'L’encodage vidéo a échoué (fichier audio ou vidéo de fond peut-être corrompu). Essayez un autre fichier ou relancez.';
  return 'L’export a échoué de façon inattendue. Relancez-le ; vos réglages sont conservés.';
}

const UPLOAD_LIMIT_BYTES = Number(process.env.STORAGE_MAX_UPLOAD_MB?.trim() || 50) * 1024 * 1024;
const EXPORTS_DIR = resolve(ROOT, process.env.EXPORTS_DIR?.trim() || 'output/exports');

async function process1(job: JobRow, browser: Browser): Promise<void> {
  const preset = PRESETS[job.preset];
  const tmp = resolve(TMP_ROOT, job.id);
  mkdirSync(tmp, { recursive: true });
  const abort = new AbortController();
  const watcher = setInterval(() => {
    isCancelled(job.id).then((c) => c && abort.abort(), () => undefined);
  }, 2000);
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = (Date.now() - t) / 1000;
    }
  };
  try {
    const base = RenderDocumentSchema.parse(job.document_snapshot);
    const ctx = { supabase, tmpDir: tmp, ownerId: job.owner_id };
    const durationSec = base.totalFrames / base.fps;
    const plan = planDelivery(preset, durationSec, UPLOAD_LIMIT_BYTES);
    log(`job ${job.id.slice(0, 8)} plan: ${durationSec.toFixed(1)} s, ${plan.target === 'storage' ? `Supabase Storage, video ≤ ${(plan.maxrateKbps / 1000).toFixed(1)} Mb/s` : `local delivery (budget ${(plan.budgetKbps / 1000).toFixed(1)} Mb/s < quality floor), full quality`}`);
    // resolve every asset to a local file
    const doc: RenderDocument = await step('download', async () => ({
      ...base,
      width: preset.width,
      height: preset.height,
      audio: base.audio ? { ...base.audio, src: await resolveAsset(base.audio.src, { ...ctx, name: 'audio' }) } : null,
      background: base.background.kind === 'video' ? { ...base.background, src: await resolveAsset(base.background.src, { ...ctx, name: 'background' }) } : base.background,
      bismillah: { ...base.bismillah, src: await resolveAsset(base.bismillah.src, { ...ctx, name: 'bismillah' }) },
      branding: base.branding.qr ? { ...base.branding, qr: { ...base.branding.qr, src: await resolveAsset(base.branding.qr.src, { ...ctx, name: 'qr' }) } } : base.branding,
    }));
    if (abort.signal.aborted) throw new Error('cancelled');
    await update(job.id, { progress: 0.05 });
    const stills = await step('stills', () => renderStills(doc, { fontsDir: resolve(ROOT, 'assets/fonts'), outDir: tmp, browser }));
    const layoutFailures = stills.layoutChecks.filter((c) => !c.pass);
    if (layoutFailures.length) throw new Error(`layout check failed: ${layoutFailures.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
    await update(job.id, { status: 'encoding', progress: 0.1 });
    const out = resolve(tmp, 'output.mp4');
    let lastWrite = 0;
    await step('encode', () =>
      compose(doc, stills, preset, out, (frame) => {
        const now = Date.now();
        if (now - lastWrite < 1000) return;
        lastWrite = now;
        void update(job.id, { progress: Math.min(0.9, 0.1 + 0.8 * (frame / doc.totalFrames)) }).catch(() => undefined);
      }, abort.signal, plan.target === 'storage' ? plan.maxrateKbps : undefined),
    );
    if (abort.signal.aborted) throw new Error('cancelled');

    await update(job.id, { status: 'validating', progress: 0.92 });
    const qrPayload = doc.branding.qr?.visible
      ? (await db.query<{ p: string | null }>(`select decoded_payload as p from public.qr_assets where country_code = $1 and is_current`, [doc.country])).rows[0]?.p ?? null
      : null;
    const checks = await step('validate', () => validateOutput(out, { doc, width: preset.width, height: preset.height, level: Math.round(Number(preset.level) * 10), expectedQrPayload: qrPayload, workDir: tmp }));
    const critical = checks.filter((c) => !c.pass && c.critical);
    if (critical.length) throw new Error(`output validation failed: ${critical.map((c) => `${c.name} (${c.detail})`).join('; ')}`);

    // delivery: Supabase Storage when the file fits its upload limit, otherwise the worker's local export folder
    const size = statSync(out).size;
    let storagePath: string;
    let delivery: 'storage' | 'local' = size <= UPLOAD_LIMIT_BYTES * 0.99 ? 'storage' : 'local';
    if (delivery === 'storage') {
      const path = `${job.owner_id}/${job.id}.mp4`;
      const { error: upErr } = await step('upload', () => supabase.storage.from('exports').upload(path, readFileSync(out), { contentType: 'video/mp4', upsert: true }));
      if (upErr) {
        log(`job ${job.id.slice(0, 8)} storage upload refused (${upErr.message}); falling back to local delivery`);
        delivery = 'local';
      }
      storagePath = path;
    }
    if (delivery === 'local') {
      const dir = resolve(EXPORTS_DIR, job.owner_id);
      mkdirSync(dir, { recursive: true });
      copyFileSync(out, resolve(dir, `${job.id}.mp4`));
      storagePath = `local://${job.owner_id}/${job.id}.mp4`;
    }
    const probe = await ffprobe(out);
    await db.query(
      `insert into public.exported_videos (owner_id, render_job_id, storage_path, size_bytes, probe, validation) values ($1, $2, $3, $4, $5, $6)
       on conflict (render_job_id) do update set storage_path = excluded.storage_path, size_bytes = excluded.size_bytes, probe = excluded.probe, validation = excluded.validation`,
      [job.owner_id, job.id, storagePath!, size, JSON.stringify(probe), JSON.stringify({ checks, layout: stills.layoutChecks, delivery, plan, timings })],
    );
    await update(job.id, { status: 'succeeded', progress: 1, finished_at: new Date().toISOString() });
    log(`job ${job.id.slice(0, 8)} succeeded: ${job.preset}, ${(size / 2 ** 20).toFixed(1)} MB, ${delivery === 'storage' ? 'Supabase Storage' : `local file in ${EXPORTS_DIR}`}, total ${((Date.now() - t0) / 1000).toFixed(0)} s ${JSON.stringify(timings)}`);
  } catch (e) {
    const raw = (e as Error).message;
    const cancelled = abort.signal.aborted || raw === 'cancelled';
    await update(job.id, {
      status: cancelled ? 'cancelled' : 'failed',
      finished_at: new Date().toISOString(),
      error: JSON.stringify(cancelled ? { message: 'Annulé à la demande' } : { message: explainFailure(raw), detail: raw.slice(0, 2000) }),
    });
    log(`job ${job.id.slice(0, 8)} ${cancelled ? 'cancelled' : `failed after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${raw.slice(0, 400)}`} ${JSON.stringify(timings)}`);
  } finally {
    clearInterval(watcher);
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await db.query('select 1');
  const browser = await launchBrowser();
  log(`worker ${WORKER_ID} ready (${randomUUID().slice(0, 4)})`);
  let stop = false;
  process.on('SIGINT', () => (stop = true));
  process.on('SIGTERM', () => (stop = true));
  try {
    while (!stop) {
      try {
        await recoverStale();
        await purgeExpiredExports().catch((e: Error) => log(`purge error: ${e.message}`));
        const job = await claim();
        if (job) {
          log(`job ${job.id} claimed (${job.preset})`);
          await process1(job, browser);
          if (ONCE) break;
          continue;
        }
      } catch (e) {
        // Transient database/network failure: log and retry on the next poll instead of exiting.
        // A job interrupted here is re-queued by recoverStale() once its heartbeat is stale.
        log(`loop error (retrying): ${(e as Error).message}`);
      }
      if (ONCE) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    await browser.close();
    await db.end();
  }
}

await main();
