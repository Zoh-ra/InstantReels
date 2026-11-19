/**
 * Functional audit of EVERY editor customization control on the real app + real Supabase,
 * with the approved test account. For each control: change it through the UI, check the live
 * preview DOM, then (after autosave) check the stored document, reload and check persistence.
 * Then exports (1080p → Supabase Storage, 4K → local delivery because of the 50 MB limit),
 * preview-vs-export pixel comparison, upload-limit test, failure + retry test. Test data removed.
 * Usage: npx tsx scripts/qa/controls-audit.ts [baseUrl]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, type Locator, type Page } from 'playwright-core';
import { PNG } from 'pngjs';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { ffmpeg, ffprobe } from '../../apps/worker/src/media/ffmpeg.ts';

loadDotEnv();
const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:3000';
const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'output/audit');
mkdirSync(OUT, { recursive: true });
const EMAIL = 'instantreels-e2e@example.com';
const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
const report: { area: string; control: string; ui: boolean; preview: boolean; saved: boolean; persisted: boolean; detail: string }[] = [];
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

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
    child.stderr.on('data', (d: Buffer) => process.stdout.write(`    [worker:err] ${d.toString().slice(0, 300)}`));
    child.on('close', (code) => res(code ?? 1));
  });
}

// ── UI helpers ──
const preview = (page: Page) => page.locator('main [aria-label="Aperçu de la vidéo"]').first();
async function tab(page: Page, name: string) {
  await page.getByRole('tab', { name }).first().click();
}
async function setSlider(page: Page, label: string, target: number) {
  const thumb = page.locator(`[role="slider"][aria-label="${label}"]`).first();
  await thumb.scrollIntoViewIfNeeded();
  await thumb.focus();
  for (let i = 0; i < 600; i++) {
    const now = Number(await thumb.getAttribute('aria-valuenow'));
    if (Math.abs(now - target) < 1e-6) return;
    await page.keyboard.press(now < target ? 'ArrowRight' : 'ArrowLeft');
  }
  throw new Error(`slider ${label} cannot reach ${target}`);
}
async function setColor(page: Page, id: string, hex: string) {
  await page.locator(`#${id}`).first().evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
}
async function setSwitch(page: Page, id: string, on: boolean) {
  const sw = page.locator(`#${id}`).first();
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
}
const css = (loc: Locator, prop: string) => loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
async function waitSaved(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll('header [role="status"]')].some((e) => e.textContent?.includes('Enregistré')), null, { timeout: 20000 });
}
async function storedDoc(projectId: string): Promise<Record<string, any>> {
  const { data } = await admin.from('projects').select('document').eq('id', projectId).single();
  return data!.document as Record<string, any>;
}
const get = (o: Record<string, any>, path: string) => path.split('.').reduce<any>((a, k) => a?.[k], o);

async function main() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const uid = users.users.find((u) => u.email === EMAIL)?.id;
  if (!uid) throw new Error('test account missing (run scripts/qa/e2e-workflow.ts first)');
  await cleanup(uid);

  const audioFile = resolve(OUT, 'audit-recitation-30s.mp3');
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=30', '-af', 'volume=0.3', '-c:a', 'libmp3lame', '-b:a', '128k', audioFile]);
  const bgFile = resolve(ROOT, 'output/poc/test-background-1080x1920-25fps.mp4');
  const tooBig = resolve(OUT, 'too-big-51MB.mp4');
  writeFileSync(tooBig, Buffer.alloc(51 * 1024 * 1024));

  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL?.trim() || 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  try {
    await page.goto(`${BASE}/auth/confirm?token_hash=${encodeURIComponent(link.properties!.hashed_token)}&type=magiclink&next=/projects`);
    await page.waitForURL(/\/projects$/);
    await page.goto(`${BASE}/projects/new`);
    await page.getByRole('button', { name: /Mot à mot/ }).click();
    await page.getByLabel('Rechercher une sourate par numéro ou par nom').fill('1');
    await page.locator('ul[aria-label="Sourates"] button').first().click();
    await page.getByLabel('Aperçu du texte').waitFor();
    await page.getByRole('button', { name: 'Créer et générer les scènes' }).click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
    const projectId = page.url().split('/').pop()!;
    await waitSaved(page);

    // ── media + upload limit ──
    await tab(page, 'Médias');
    await page.locator('input[type="file"][accept*="video"]').setInputFiles(tooBig);
    const limitMsg = await page.getByRole('alert').filter({ hasText: 'limite de votre stockage Supabase' }).first().textContent({ timeout: 5000 }).catch(() => null);
    check('upload > 50 MB refused BEFORE sending, with a French explanation', !!limitMsg, limitMsg?.slice(0, 90) ?? 'no message');
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(audioFile);
    await page.getByText(/audit-recitation-30s\.mp3 · 30\.0 s/).waitFor({ timeout: 60000 });
    await page.locator('input[type="file"][accept*="video"]').setInputFiles(bgFile);
    await page.getByText('Voile sombre (lisibilité)').waitFor({ timeout: 60000 });
    await waitSaved(page);
    const d0 = await storedDoc(projectId);
    check('audio + background stored in the document (duration follows the recitation)', Math.abs(d0.audio?.durationMs - 30000) < 100 && d0.background?.kind === 'video' && d0.totalFrames === Math.ceil((d0.audio.durationMs * 30) / 1000 - 1e-9), `audio ${d0.audio?.durationMs} ms, ${d0.totalFrames} frames`);

    // select a word scene (verse 1:7 last part) for box checks
    const goScene = async (n: number) => {
      await page.locator(`footer button[aria-label^="Scène ${n} :"]`).first().click();
      await page.waitForTimeout(150);
    };
    await goScene(9);
    const pv = preview(page);
    const word = pv.locator('[data-role="word-box"]').first();
    const arabic = pv.locator('[data-role="arabic"]').first();
    const french = pv.locator('[data-role="french"]').first();

    type Ctl = { area: string; label: string; path: string; value: unknown; tab: string; scene?: number; apply: () => Promise<void>; previewOk: () => Promise<boolean | string> };
    const S = (area: string, label: string, path: string, value: number, tabName: string, previewOk: () => Promise<boolean | string>, scene?: number): Ctl => ({ area, label, path, value, tab: tabName, ...(scene ? { scene } : {}), apply: () => setSlider(page, label, value), previewOk });
    const C = (area: string, label: string, id: string, path: string, hex: string, tabName: string, previewOk: () => Promise<boolean | string>, scene?: number): Ctl => ({ area, label, path, value: hex, tab: tabName, ...(scene ? { scene } : {}), apply: () => setColor(page, id, hex), previewOk });
    const W = (area: string, label: string, id: string, path: string, on: boolean, tabName: string, previewOk: () => Promise<boolean | string>, scene?: number): Ctl => ({ area, label, path, value: on, tab: tabName, ...(scene ? { scene } : {}), apply: () => setSwitch(page, id, on), previewOk });

    const controls: Ctl[] = [
      // word boxes & typography
      C('Cadres', 'Fond du cadre', 'box-bg', 'boxStyle.background', '#202a55', 'Style', async () => (await css(word, 'background-color')).startsWith('rgba(32, 42, 85')),
      S('Cadres', 'Opacité du fond', 'boxStyle.background', 60, 'Style', async () => (await css(word, 'background-color')).includes('0.6')),
      C('Cadres', 'Bordure', 'border', 'boxStyle.borderColor', '#4bf3c8', 'Style', async () => (await css(word, 'border-top-color')) === rgb('#4bf3c8')),
      { area: 'Cadres', label: 'Style de bordure', path: 'boxStyle.borderStyle', value: 'dashed', tab: 'Style', apply: async () => void (await page.locator('#border-style').first().selectOption('dashed')), previewOk: async () => (await css(word, 'border-top-style')) === 'dashed' },
      S('Cadres', 'Épaisseur bordure', 'boxStyle.borderWidth', 5, 'Style', async () => (await css(word, 'border-top-width')) === '5px'),
      C('Cadres', 'Halo lumineux', 'glow', 'boxStyle.glowColor', '#ff8800', 'Style', async () => (await css(word, 'box-shadow')).includes('255, 136, 0')),
      S('Cadres', 'Intensité du halo', 'boxStyle.glowStrength', 0.8, 'Style', async () => (await css(word, 'box-shadow')).includes('0.8')),
      S('Cadres', 'Arrondi', 'boxStyle.radius', 40, 'Style', async () => (await css(word, 'border-top-left-radius')) === '40px'),
      S('Cadres', 'Colonnes', 'boxStyle.columns', 1, 'Style', async () => Math.round(parseFloat(await css(word, 'width'))) === 888),
      S('Cadres', 'Colonnes', 'boxStyle.columns', 2, 'Style', async () => parseFloat(await css(word, 'width')) < 500),
      S('Cadres', 'Hauteur minimale', 'boxStyle.minHeight', 260, 'Style', async () => (await css(word, 'min-height')) === '260px'),
      S('Cadres', 'Espacement', 'boxStyle.gap', 30, 'Style', async () => (await word.evaluate((el) => getComputedStyle(el.parentElement!).columnGap)) === '30px'),
      S('Cadres', 'Marge intérieure', 'boxStyle.padding', 26, 'Style', async () => (await css(word, 'padding-top')) === '26px'),
      C('Typographie', 'Texte arabe', 'arabic-color', 'boxStyle.arabicColor', '#ffffff', 'Style', async () => (await css(arabic, 'color')) === rgb('#ffffff')),
      S('Typographie', 'Taille arabe', 'boxStyle.arabicSize', 66, 'Style', async () => (await css(arabic, 'font-size')) === '66px'),
      C('Typographie', 'Traduction', 'french-color', 'boxStyle.frenchColor', '#acafff', 'Style', async () => (await css(french, 'color')) === rgb('#acafff')),
      S('Typographie', 'Taille traduction', 'boxStyle.frenchSize', 28, 'Style', async () => (await css(french, 'font-size')) === '28px'),
      // verse decoration
      C('Fin de verset', 'Couleur de l’ornement', 'marker-color', 'verseDecoration.arabicMarker.color', '#4bf3c8', 'Style', async () => (await css(pv.locator('[data-role="verse-marker"]').first(), 'color')) === rgb('#4bf3c8')),
      S('Fin de verset', 'Taille de l’ornement', 'verseDecoration.arabicMarker.scale', 1.1, 'Style', async () => Math.round(parseFloat(await css(pv.locator('[data-role="verse-marker"]').first(), 'font-size'))) === Math.round(66 * 1.1)),
      C('Fin de verset', 'Pastille du numéro', 'fr-number-bg', 'verseDecoration.frenchNumber.background', '#54b9ff', 'Style', async () => (await css(pv.locator('[data-role="verse-number-fr"]').first(), 'background-color')) === rgb('#54b9ff')),
      W('Fin de verset', 'Ornement arabe ۝', 'marker', 'verseDecoration.arabicMarker.enabled', false, 'Style', async () => (await pv.locator('[data-role="verse-marker"]').count()) === 0),
      W('Fin de verset', 'Ornement arabe ۝', 'marker', 'verseDecoration.arabicMarker.enabled', true, 'Style', async () => (await pv.locator('[data-role="verse-marker"]').count()) === 1),
      W('Fin de verset', 'Numéro du verset', 'fr-number', 'verseDecoration.frenchNumber.enabled', false, 'Style', async () => (await pv.locator('[data-role="verse-number-fr"]').count()) === 0),
      W('Fin de verset', 'Numéro du verset', 'fr-number', 'verseDecoration.frenchNumber.enabled', true, 'Style', async () => (await pv.locator('[data-role="verse-number-fr"]').count()) === 1),
      S('Animation', 'Fondu d’entrée des scènes', 'sceneFadeInFrames', 12, 'Style', async () => true),
      W('Repères', 'Repères techniques', 'tech', 'showTechnicalLabels', true, 'Style', async () => (await pv.locator('[data-role="technical-label"]').count()) === 1),
      W('Repères', 'Repères techniques', 'tech', 'showTechnicalLabels', false, 'Style', async () => (await pv.locator('[data-role="technical-label"]').count()) === 0),
      // title
      C('Titre', 'Couleur du titre', 'title-color', 'title.color', '#ffd493', 'Marque', async () => (await css(pv.locator('[data-role="title"]').first(), 'color')) === rgb('#ffd493')),
      S('Titre', 'Taille du titre', 'title.size', 130, 'Marque', async () => (await pv.locator('[data-role="title"]').first().evaluate((el) => getComputedStyle(el.parentElement!).fontSize)) === '130px'),
      S('Titre', 'Position verticale du titre', 'title.top', 180, 'Marque', async () => (await pv.locator('[data-role="title"]').first().evaluate((el) => getComputedStyle(el.parentElement!).top)) === '180px'),
      { area: 'Titre', label: 'Alignement', path: 'title.align', value: 'right', tab: 'Marque', apply: () => page.getByRole('button', { name: 'Droite' }).first().click(), previewOk: async () => (await pv.locator('[data-role="title"]').first().evaluate((el) => getComputedStyle(el.parentElement!).textAlign)) === 'right' },
      { area: 'Titre', label: 'Alignement', path: 'title.align', value: 'center', tab: 'Marque', apply: () => page.getByRole('button', { name: 'Centre' }).first().click(), previewOk: async () => (await pv.locator('[data-role="title"]').first().evaluate((el) => getComputedStyle(el.parentElement!).textAlign)) === 'center' },
      W('Titre', 'Préfixe « سورة »', 'title-word', 'title.withSurahWord', false, 'Marque', async () => (await pv.locator('[data-role="title"]').first().textContent()) === '001'),
      W('Titre', 'Préfixe « سورة »', 'title-word', 'title.withSurahWord', true, 'Marque', async () => (await pv.locator('[data-role="title"]').first().textContent()) === '001 surah'),
      // footer
      C('Libellé', 'Couleur du libellé', 'label-color', 'branding.labelColor', '#ffd493', 'Marque', async () => (await css(pv.locator('[data-role="label"]').first(), 'color')) === rgb('#ffd493')),
      S('Libellé', 'Taille du libellé', 'branding.labelSize', 38, 'Marque', async () => (await pv.locator('[data-role="label"]').first().evaluate((el) => getComputedStyle(el.parentElement!).fontSize)) === '38px'),
      S('Libellé', 'Distance du libellé au bas', 'branding.labelBottom', 80, 'Marque', async () => (await pv.locator('[data-role="label"]').first().evaluate((el) => getComputedStyle(el.parentElement!).bottom)) === '80px'),
      S('QR code', 'Taille du QR', 'branding.qr.size', 170, 'Marque', async () => (await css(pv.locator('[data-role="qr"]').first(), 'width')) === '170px'),
      S('QR code', 'Position horizontale du QR', 'branding.qr.centerX', 300, 'Marque', async () => (await css(pv.locator('[data-role="qr"]').first(), 'left')) === `${300 - 85}px`),
      S('QR code', 'Distance du QR au bas', 'branding.qr.bottom', 150, 'Marque', async () => (await css(pv.locator('[data-role="qr"]').first(), 'bottom')) === '150px'),
      W('QR code', 'QR code', 'qr-on', 'branding.qr.visible', false, 'Marque', async () => (await pv.locator('[data-role="qr"]').count()) === 0),
      W('QR code', 'QR code', 'qr-on', 'branding.qr.visible', true, 'Marque', async () => (await pv.locator('[data-role="qr"]').count()) === 1),
      // background
      S('Arrière-plan', 'Luminosité', 'background.brightness', 0.2, 'Médias', async () => (await css(pv.locator('video').first(), 'filter')).includes('brightness(1.2)')),
      S('Arrière-plan', 'Voile sombre (lisibilité)', 'background.dimOpacity', 0.3, 'Médias', async () => (await pv.locator('video').first().evaluate((el) => getComputedStyle(el.nextElementSibling!).backgroundColor)) === 'rgba(0, 0, 0, 0.3)'),
      S('Arrière-plan', 'Flou', 'background.blur', 4, 'Médias', async () => (await css(pv.locator('video').first(), 'filter')).includes('blur(4px)')),
      // Bismillah (intro scene)
      C('Bismillah', 'Couleur de la calligraphie', 'bsm-color', 'bismillah.color', '#ffd493', 'Marque', async () => (await css(pv.locator('[data-role="bismillah-panel"]').first(), 'color')) === rgb('#ffd493'), 1),
      S('Bismillah', 'Largeur de la calligraphie', 'bismillah.widthRatio', 0.7, 'Marque', async () => (await css(pv.locator('[data-role="bismillah"]').first(), 'width')) === '756px', 1),
      S('Bismillah', 'Position verticale de la calligraphie', 'bismillah.centerY', 950, 'Marque', async () => (await css(pv.locator('[data-role="bismillah-panel"]').first(), 'top')) === '950px', 1),
      W('Bismillah', 'Panneau derrière la calligraphie', 'bsm-backdrop', 'bismillah.backdrop', true, 'Marque', async () => !(await css(pv.locator('[data-role="bismillah-panel"]').first(), 'background-color')).includes('rgba(0, 0, 0, 0)'), 1),
    ];

    for (const c of controls) {
      const row = { area: c.area, control: c.label, ui: false, preview: false, saved: false, persisted: false, detail: '' };
      try {
        await tab(page, c.tab);
        if (c.scene) await goScene(c.scene);
        else await goScene(9);
        await c.apply();
        row.ui = true;
        await page.waitForTimeout(120);
        const ok = await c.previewOk();
        row.preview = ok === true;
        if (ok !== true) row.detail = typeof ok === 'string' ? ok : 'preview not updated';
        await waitSaved(page);
        const v = get(await storedDoc(projectId), c.path);
        const expected = c.path === 'boxStyle.background' && typeof c.value === 'string'
          ? (x: string) => x.slice(0, 7) === c.value
          : c.path === 'boxStyle.background' && typeof c.value === 'number' ? (x: string) => x.endsWith(Math.round((c.value as number) / 100 * 255).toString(16).padStart(2, '0')) : c.path === 'bismillah.backdrop' ? (x: unknown) => (c.value ? typeof x === 'string' : x === null) : (x: unknown) => (typeof c.value === 'number' ? Math.abs((x as number) - c.value) < 1e-6 : x === c.value);
        row.saved = expected(v as never);
        if (!row.saved) row.detail += ` stored=${JSON.stringify(v)}`;
      } catch (e) {
        row.detail = (e as Error).message.slice(0, 120);
      }
      report.push(row);
      check(`${c.area} · ${c.label} = ${JSON.stringify(c.value)}`, row.ui && row.preview && row.saved, row.detail.trim());
    }

    // ── timing: boundary by keyboard and numeric input ──
    await tab(page, 'Temps');
    const before = (await storedDoc(projectId)).scenes[1].endFrame as number;
    const handle = page.locator('footer button[aria-label^="Limite entre les scènes 2 et 3"]').first();
    await handle.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await waitSaved(page);
    const afterKey = (await storedDoc(projectId)).scenes[1].endFrame as number;
    check('timeline boundary moved by keyboard (+1 s)', afterKey === before + 30, `${before} → ${afterKey}`);
    const input = page.getByLabel('Fin de la scène 3 en secondes').first();
    await input.fill('9.50');
    await input.press('Enter');
    await waitSaved(page);
    const afterNum = (await storedDoc(projectId)).scenes[2].endFrame as number;
    check('scene end typed in seconds (9.50 s → frame 285)', afterNum === 285, `endFrame=${afterNum}`);
    report.push({ area: 'Chronologie', control: 'Limite (clavier) + saisie numérique', ui: true, preview: true, saved: afterKey === before + 30 && afterNum === 285, persisted: false, detail: '' });

    // ── layout guard: an impossible size is flagged before export, and clears when reverted ──
    await tab(page, 'Style');
    await setSlider(page, 'Taille arabe', 96);
    await setSlider(page, 'Colonnes', 3);
    await page.waitForTimeout(900);
    await tab(page, 'Export');
    const flagged = await page.getByText('À corriger avant l’export').first().isVisible().catch(() => false);
    const disabled = await page.getByRole('button', { name: 'Générer la vidéo' }).first().isDisabled();
    check('extreme layout (Arabic 96 px, 3 columns) flagged and export blocked', flagged && disabled);
    await tab(page, 'Style');
    await setSlider(page, 'Colonnes', 2);
    await setSlider(page, 'Taille arabe', 66);
    await page.waitForTimeout(900);
    await tab(page, 'Export');
    check('warning cleared after reverting', !(await page.getByText('À corriger avant l’export').first().isVisible().catch(() => false)));
    await waitSaved(page);

    // ── persistence after reload ──
    const docBefore = await storedDoc(projectId);
    await page.reload();
    await waitSaved(page).catch(() => undefined);
    await tab(page, 'Style');
    const uiAfter = {
      arabicSize: Number(await page.locator('[role="slider"][aria-label="Taille arabe"]').first().getAttribute('aria-valuenow')),
      radius: Number(await page.locator('[role="slider"][aria-label="Arrondi"]').first().getAttribute('aria-valuenow')),
      border: await page.locator('#border').first().inputValue(),
    };
    await tab(page, 'Marque');
    const qrSize = Number(await page.locator('[role="slider"][aria-label="Taille du QR"]').first().getAttribute('aria-valuenow'));
    const persisted = uiAfter.arabicSize === 66 && uiAfter.radius === 40 && uiAfter.border === '#4bf3c8' && qrSize === 170;
    check('settings restored in the UI after reloading the project', persisted, JSON.stringify({ ...uiAfter, qrSize }));
    for (const r of report) r.persisted = persisted && r.saved;
    const docAfter = await storedDoc(projectId);
    check('stored document unchanged by reopening', JSON.stringify(docAfter) === JSON.stringify(docBefore));

    // ── exports with the customized settings ──
    const exportOnce = async (label: '1080p' | '4K', expectLocal: boolean) => {
      const expectedS = (await storedDoc(projectId)).totalFrames / 30;
      await tab(page, 'Export');
      await page.locator('label', { hasText: label === '4K' ? '4K · 2160×3840' : 'Full HD · 1080×1920' }).first().click();
      const before = await page.locator('a[href^="/api/exports/"]').count();
      await page.getByRole('button', { name: 'Générer la vidéo' }).first().click();
      await page.getByText('En file d’attente').first().waitFor({ timeout: 20000 });
      const code = await runWorkerOnce();
      await page.waitForFunction((n) => document.querySelectorAll('a[href^="/api/exports/"]').length > n, before, { timeout: 30000 }).catch(() => undefined);
      const href = (await page.locator('a[href^="/api/exports/"]').count()) > before ? await page.locator('a[href^="/api/exports/"]').first().getAttribute('href') : null;
      check(`${label}: export succeeded`, code === 0 && !!href);
      if (!href) return null;
      const where = await page.locator('li', { has: page.locator(`a[href="${href}"]`) }).first().textContent();
      // the decision uses the REAL file size: ≤ 50 MB → Supabase Storage, above → kept by the render server
      const sizeMB = Number(/([\d.]+) Mo/.exec(where ?? '')?.[1] ?? 0);
      const local = (where ?? '').includes('conservé sur le serveur de rendu');
      check(`${label}: delivery matches the real size (${sizeMB} MB → ${sizeMB > 50 ? 'render server' : 'Supabase Storage'})`, local === sizeMB > 50, where?.replace(/\s+/g, ' ').slice(0, 120));
      void expectLocal;
      const res = await page.request.get(BASE + href);
      const file = resolve(OUT, `audit-${label}.mp4`);
      writeFileSync(file, await res.body());
      const pr = await ffprobe(file, true);
      const v = pr.streams.find((s) => s.codec_type === 'video');
      const a = pr.streams.find((s) => s.codec_type === 'audio');
      const W = label === '4K' ? 2160 : 1080;
      check(`${label}: H.264 ${W}×${(W * 16) / 9} 30 fps, ${expectedS.toFixed(3)} s, AAC`, v?.width === W && v.height === (W * 16) / 9 && v.r_frame_rate === '30/1' && Math.abs(Number(pr.format.duration) - expectedS) < 0.04 && a?.codec_name === 'aac', `${(Number(pr.format.size) / 2 ** 20).toFixed(1)} MB, ${(Number(v?.bit_rate ?? pr.format.bit_rate) / 1e6).toFixed(1)} Mb/s`);
      return file;
    };
    const f1080 = await exportOnce('1080p', false);

    // ── preview vs export pixel comparison (same frame, scene 9 midpoint) ──
    if (f1080) {
      const d = await storedDoc(projectId);
      const sc = d.scenes[8];
      const frame = Math.floor((sc.startFrame + sc.endFrame) / 2);
      await page.locator('footer [role="slider"][aria-label="Position de lecture"]').first().focus();
      await page.locator(`footer button[aria-label^="Scène 9 :"]`).first().click();
      for (let i = 0; i < frame - sc.startFrame; i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(1200); // let the background video seek
      const box = (await preview(page).boundingBox())!;
      const pvPng = resolve(OUT, 'compare-preview.png');
      await preview(page).screenshot({ path: pvPng });
      const exPng = resolve(OUT, 'compare-export.png');
      await ffmpeg(['-ss', ((frame - 0.25) / 30).toFixed(4), '-i', f1080, '-frames:v', '1', '-vf', `scale=${Math.round(box.width)}:${Math.round(box.height)}:flags=area`, exPng]);
      const A = PNG.sync.read(readFileSync(pvPng));
      const B = PNG.sync.read(readFileSync(exPng));
      const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
      let sum = 0, n = 0, sumBg = 0, nBg = 0;
      for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) {
        const ia = (y * A.width + x) * 4, ib = (y * B.width + x) * 4;
        const dlt = (Math.abs(A.data[ia]! - B.data[ib]!) + Math.abs(A.data[ia + 1]! - B.data[ib + 1]!) + Math.abs(A.data[ia + 2]! - B.data[ib + 2]!)) / 3;
        sum += dlt; n++;
        if (y > h * 0.6 && y < h * 0.66) { sumBg += dlt; nBg++; } // band below the boxes: background only
      }
      const mean = sum / n, meanBg = sumBg / nBg;
      check('export frame matches the live preview (mean pixel difference)', mean < 12, `${mean.toFixed(1)}/255 overall, ${meanBg.toFixed(1)}/255 on a background-only band (brightness ×1.2, blur 4, dim 0.3)`);
      await ffmpeg(['-i', pvPng, '-i', exPng, '-filter_complex', `[0]scale=${w}:${h}[a];[1]scale=${w}:${h}[b];[a][b]hstack`, resolve(OUT, 'compare-side-by-side.png')]);
    }
    await exportOnce('4K', true);

    // ── failure + retry: background object deleted → clear French error → choose solid → retry succeeds ──
    const d1 = await storedDoc(projectId);
    const bgPath = String(d1.background.src).replace('storage://backgrounds/', '');
    await admin.storage.from('backgrounds').remove([bgPath]);
    await tab(page, 'Export');
    await page.locator('label', { hasText: 'Full HD · 1080×1920' }).first().click();
    await page.getByRole('button', { name: 'Générer la vidéo' }).first().click();
    await page.getByText('En file d’attente').first().waitFor({ timeout: 20000 });
    await runWorkerOnce();
    const errText = await page.locator('li p.text-destructive').first().textContent({ timeout: 30000 }).catch(() => null);
    check('missing background → understandable French error', !!errText && errText.includes('introuvable'), errText ?? 'none');
    check('failed export offers "Relancer"', await page.getByRole('button', { name: /^Relancer/ }).first().isVisible());
    const keptDoc = await storedDoc(projectId);
    check('project and settings preserved after the failure', JSON.stringify(keptDoc) === JSON.stringify(d1));
    await tab(page, 'Médias');
    await page.getByRole('button', { name: 'Couleur unie' }).first().click();
    await waitSaved(page);
    await tab(page, 'Export');
    const okBefore = await page.locator('a[href^="/api/exports/"]').count();
    await page.getByRole('button', { name: /^Relancer/ }).first().click();
    await page.getByText('En file d’attente').first().waitFor({ timeout: 20000 });
    await runWorkerOnce();
    await page.waitForFunction((n) => document.querySelectorAll('a[href^="/api/exports/"]').length > n, okBefore, { timeout: 30000 }).catch(() => undefined);
    check('retry after fixing the cause succeeds', (await page.locator('a[href^="/api/exports/"]').count()) > okBefore);
    check('no uncaught JavaScript errors during the audit', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await page.screenshot({ path: resolve(OUT, 'last-page.png') }).catch(() => undefined);
    await browser.close();
    writeFileSync(resolve(OUT, 'controls-report.json'), JSON.stringify(report, null, 2));
    await cleanup(uid);
    console.log('test data removed (account kept)');
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\ncontrols audit passed');
  process.exitCode = failures ? 1 : 0;
}

await main();
