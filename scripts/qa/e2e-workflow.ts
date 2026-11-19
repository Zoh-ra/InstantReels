/**
 * End-to-end workflow against the running web app (default http://localhost:3000) and the real
 * Supabase project, with the dedicated test account approved by the owner:
 *   sign-in (server-generated magic-link token, no e-mail) → new word-by-word project (Al-Fâtiha 1–7)
 *   → upload recitation + background video → change pagination → autosave → export 1080p AND 4K
 *   (worker run in-process with --once) → download → ffprobe checks → full-verse project (112, FR)
 *   → export → duplicate/delete → cleanup of the test account's DATA (the account is kept).
 * Never prints credentials. Usage: npx tsx scripts/qa/e2e-workflow.ts [baseUrl] [--skip-4k]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright-core';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { ffmpeg, ffprobe } from '../../apps/worker/src/media/ffmpeg.ts';

loadDotEnv();
const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:3000';
const SKIP_4K = process.argv.includes('--skip-4k');
const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'output/e2e');
mkdirSync(OUT, { recursive: true });
const EMAIL = 'instantreels-e2e@example.com';
const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── test account (kept) ──
async function testUserId(): Promise<string> {
  const created = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true, user_metadata: { display_name: 'Test E2E' } });
  if (created.data.user) return created.data.user.id;
  for (let page = 1; page < 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    const u = data.users.find((x) => x.email === EMAIL);
    if (u) return u.id;
    if (data.users.length < 100) break;
  }
  throw new Error(`cannot create or find the test user: ${created.error?.message}`);
}

async function cleanup(uid: string) {
  await admin.from('projects').delete().eq('owner_id', uid);
  await admin.from('audio_assets').delete().eq('owner_id', uid);
  await admin.from('background_media').delete().eq('owner_id', uid);
  rmSync(resolve(ROOT, process.env.EXPORTS_DIR?.trim() || 'output/exports', uid), { recursive: true, force: true }); // locally delivered exports
  for (const bucket of ['audio', 'backgrounds', 'exports']) {
    const { data } = await admin.storage.from(bucket).list(uid, { limit: 1000 });
    if (data?.length) await admin.storage.from(bucket).remove(data.map((f) => `${uid}/${f.name}`));
  }
}

function runWorkerOnce(): Promise<number> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve(ROOT, 'apps/worker/src/service/worker.ts'), '--once'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    child.stdout.on('data', (d: Buffer) => process.stdout.write(`    [worker] ${d.toString()}`));
    child.stderr.on('data', (d: Buffer) => process.stdout.write(`    [worker:err] ${d.toString().slice(0, 400)}`));
    child.on('close', (code) => res(code ?? 1));
  });
}

async function exportAndVerify(page: Page, label: '1080p' | '4K', expect: { width: number; height: number; durationS: number; audio: boolean }, tag: string) {
  await page.getByRole('tab', { name: 'Export' }).first().click();
  await page.locator('label', { hasText: label === '4K' ? '4K · 2160×3840' : 'Full HD · 1080×1920' }).first().click();
  const before = await page.locator('a[href^="/api/exports/"]').count();
  await page.getByRole('button', { name: 'Générer la vidéo' }).first().click();
  await page.getByText('En file d’attente').first().waitFor({ timeout: 20000 });
  const t0 = Date.now();
  const code = await runWorkerOnce();
  check(`${label}: worker processed the job`, code === 0, `exit ${code}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.waitForFunction((n) => document.querySelectorAll('a[href^="/api/exports/"]').length > n, before, { timeout: 30000 }).catch(() => undefined);
  const href = (await page.locator('a[href^="/api/exports/"]').count()) > 0 ? await page.locator('a[href^="/api/exports/"]').first().getAttribute('href') : null;
  check(`${label}: download link shown`, !!href);
  if (!href) {
    const err = await page.locator('.text-destructive').allTextContents();
    console.log('    errors shown:', err.join(' | ').slice(0, 600));
    return;
  }
  const res = await page.request.get(BASE + href);
  check(`${label}: download returns an MP4`, res.ok() && (res.headers()['content-type'] ?? '').includes('video/mp4'), `HTTP ${res.status()}`);
  const file = resolve(OUT, `e2e-${tag}-${label}.mp4`);
  writeFileSync(file, await res.body());
  const probe = await ffprobe(file, true);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const dur = Number(probe.format.duration);
  check(`${label}: H.264 ${expect.width}×${expect.height} yuv420p 30 fps`, v?.codec_name === 'h264' && v.width === expect.width && v.height === expect.height && v.pix_fmt === 'yuv420p' && v.r_frame_rate === '30/1');
  check(`${label}: duration matches the timeline`, Math.abs(dur - expect.durationS) <= 1 / 30 + 0.01, `${dur.toFixed(3)} s vs ${expect.durationS.toFixed(3)} s`);
  check(`${label}: audio track ${expect.audio ? 'AAC present' : 'absent'}`, expect.audio ? a?.codec_name === 'aac' : !a);
  const shot = resolve(OUT, `e2e-${tag}-${label}-frame.png`);
  await ffmpeg(['-ss', String(Math.min(dur - 0.5, 12)), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', shot]);
}

async function main() {
  const uid = await testUserId();
  await cleanup(uid); // start from a clean state
  check('test account ready', !!uid);

  // synthetic test media (not Quranic recitation)
  const audioFile = resolve(OUT, 'test-recitation.mp3');
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=20', '-af', 'volume=0.3', '-c:a', 'libmp3lame', '-b:a', '128k', audioFile]);
  const bgFile = resolve(ROOT, 'output/poc/test-background-1080x1920-25fps.mp4');

  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  if (error || !link.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);

  const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL?.trim() || 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  try {
    // ── sign-in ──
    await page.goto(`${BASE}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=magiclink&next=/projects`);
    await page.waitForURL(/\/projects$/, { timeout: 30000 });
    check('signed in and redirected to /projects', page.url().endsWith('/projects'));
    await page.goto(`${BASE}/editor/00000000-0000-4000-8000-000000000000`);
    check('unknown project → not found (no data leak)', (await page.locator('text=404').count()) > 0 || (await page.title()).includes('404') || (await page.content()).includes('could not be found'));

    // ── new word-by-word project ──
    await page.goto(`${BASE}/projects/new`);
    await page.getByRole('button', { name: /Mot à mot/ }).click();
    await page.getByRole('button', { name: 'France' }).click();
    await page.getByLabel('Rechercher une sourate par numéro ou par nom').fill('1');
    await page.locator('ul[aria-label="Sourates"] button').first().click();
    await page.getByLabel('Aperçu du texte').waitFor({ timeout: 20000 });
    check('selection preview shows Arabic + French', (await page.getByLabel('Aperçu du texte').locator('p[lang="ar"]').count()) > 0);
    await page.getByRole('button', { name: 'Créer et générer les scènes' }).click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30000 });
    const projectUrl = page.url();
    check('project created, editor opened', true, projectUrl.split('/').pop());
    await page.getByText('Enregistré').first().waitFor({ timeout: 15000 });

    // ── media ──
    await page.getByRole('tab', { name: 'Médias' }).first().click();
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(audioFile);
    await page.getByText(/test-recitation\.mp3 · 20\.0 s/).waitFor({ timeout: 60000 });
    check('recitation uploaded and selected (20 s)', true);
    await page.locator('input[type="file"][accept*="video"]').setInputFiles(bgFile);
    await page.getByText('Voile sombre (lisibilité)').waitFor({ timeout: 60000 });
    check('background video uploaded and selected', true);

    // ── pagination: verse 7 from 5+4 to 3+3+3 ──
    await page.getByRole('tab', { name: 'Contenu' }).first().click();
    const v7 = page.locator('li', { hasText: 'Verset 7' }).first();
    await v7.getByRole('button', { name: 'scène' }).last().click();
    await page.getByText('9 mots · 3+3+3').first().waitFor({ timeout: 5000 });
    check('manual pagination 5+4 → 3+3+3', true);
    await page.getByText('Enregistré').first().waitFor({ timeout: 20000 });

    // reopen: state persisted
    await page.reload();
    await page.getByRole('tab', { name: 'Contenu' }).first().click();
    const kept = await page.getByText('9 mots · 3+3+3').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const audioBack = await page.locator('audio').first().waitFor({ state: 'attached', timeout: 15000 }).then(() => true, () => false);
    check('reopened project keeps pagination and audio', kept && audioBack);

    // ── exports ──
    await exportAndVerify(page, '1080p', { width: 1080, height: 1920, durationS: 20, audio: true }, 'word-by-word');
    if (!SKIP_4K) await exportAndVerify(page, '4K', { width: 2160, height: 3840, durationS: 20, audio: true }, 'word-by-word');

    // ── full-verse project (112, France / Hamidullah) ──
    await page.goto(`${BASE}/projects/new`);
    await page.getByRole('button', { name: /Versets complets/ }).click();
    await page.getByRole('button', { name: 'France' }).click();
    await page.getByLabel('Rechercher une sourate par numéro ou par nom').fill('112');
    await page.locator('ul[aria-label="Sourates"] button').first().click();
    await page.getByLabel('au verset').fill('4');
    await page.getByLabel('Aperçu du texte').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Créer et générer les scènes' }).click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30000 });
    await page.getByText('Enregistré').first().waitFor({ timeout: 15000 });
    const panel = page.locator('[data-role="verse-panel"]').first();
    await page.getByRole('button', { name: /Scène 2 :/ }).first().click();
    check('full-verse preview shows Hamidullah translation', (await panel.locator('[data-role="translation"]').count()) > 0);
    const fvDuration = await page.evaluate(() => {
      const t = document.querySelector('span.font-mono.text-sm.text-steel')?.textContent ?? '';
      const m = /(\d+):(\d+)\.(\d+)/.exec(t);
      return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 30 : 0;
    });
    await exportAndVerify(page, '1080p', { width: 1080, height: 1920, durationS: fvDuration, audio: false }, 'full-verse');

    // ── duplicate / delete ──
    await page.goto(`${BASE}/projects`);
    const count = async () => page.locator('ul > li a[aria-label^="Ouvrir"]').count();
    const n0 = await count();
    await page.getByRole('button', { name: /^Dupliquer/ }).first().click();
    await page.waitForFunction((n) => document.querySelectorAll('ul > li a[aria-label^="Ouvrir"]').length === n + 1, n0, { timeout: 15000 });
    check('duplicate project', (await count()) === n0 + 1);
    page.once('dialog', (d) => void d.accept());
    await page.locator('li', { hasText: '(copie)' }).getByRole('button', { name: /^Supprimer/ }).first().click();
    await page.waitForFunction((n) => document.querySelectorAll('ul > li a[aria-label^="Ouvrir"]').length === n, n0, { timeout: 15000 });
    check('delete project (with confirmation)', (await count()) === n0);
    check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
  } finally {
    await page.screenshot({ path: resolve(OUT, 'last-page.png') }).catch(() => undefined);
    await browser.close();
    await cleanup(uid);
    console.log('test data removed (account kept)');
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nend-to-end workflow passed');
  process.exitCode = failures ? 1 : 0;
}

await main();
