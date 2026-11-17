import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { sceneEndsVerse, toArabicIndicDigits, type RenderDocument } from '@instantreels/core';
import {
  BrandingLayer,
  EDGE_MARGIN,
  FONT_FAMILIES,
  FONT_FILES,
  SURAH_NAMES_FONT_URL,
  SceneLayer,
  type FontSources,
} from '@instantreels/video';
import { buildLayerDocument } from '@instantreels/video/html';

const MIME: Record<string, string> = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** Embeds a local file as a data: URL (fonts embedded byte-for-byte, unmodified). */
export function dataUrl(path: string): string {
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`unsupported asset type ${path}`);
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

let surahNamesFont: string | null = null;
/**
 * Quran Foundation Surah Names font, loaded from the QF CDN at render time and kept in memory
 * only (no local copy, per QF font terms unless a Developer Console account is active).
 */
async function loadSurahNamesFont(): Promise<string> {
  if (surahNamesFont) return surahNamesFont;
  const url = process.env.SURAH_NAMES_FONT_URL?.trim() || SURAH_NAMES_FONT_URL;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cannot load Surah Names font (${res.status}) from ${url}`);
  surahNamesFont = `data:font/woff2;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  return surahNamesFont;
}

export async function fontSources(fontsDir: string): Promise<FontSources> {
  return {
    quran: dataUrl(join(fontsDir, FONT_FILES.quran)),
    french: dataUrl(join(fontsDir, FONT_FILES.french)),
    label: dataUrl(join(fontsDir, FONT_FILES.label)),
    surahNames: await loadSurahNamesFont(),
  };
}

export interface Rect {
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface LayoutCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface StillsResult {
  persistentPng: string;
  scenePngs: string[];
  ms: number;
  layoutChecks: LayoutCheck[];
}

export async function launchBrowser(): Promise<Browser> {
  const channel = process.env.RENDER_BROWSER_CHANNEL?.trim();
  return chromium.launch(channel ? { channel } : {});
}

const ROLES = ['title', 'word-box', 'verse-panel', 'arabic', 'french', 'translation', 'verse-marker', 'verse-number-fr', 'technical-label', 'bismillah', 'qr', 'label'] as const;

async function collectRects(page: Page): Promise<Rect[]> {
  return page.evaluate((roles: readonly string[]) => {
    const out: { role: string; x: number; y: number; w: number; h: number; text: string }[] = [];
    for (const role of roles) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-role="${role}"]`))) {
        const r = el.getBoundingClientRect();
        out.push({ role, x: r.x, y: r.y, w: r.width, h: r.height, text: el.textContent ?? '' });
      }
    }
    return out;
  }, ROLES);
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Renders the persistent footer and one transparent still per scene at full output size.
 * Throws if a font is missing or text overflows; returns layout checks (overlaps, margins,
 * verse markers, technical labels) for the validation report.
 */
export async function renderStills(doc: RenderDocument, opts: { fontsDir: string; outDir: string; browser: Browser }): Promise<StillsResult> {
  const t0 = performance.now();
  const fonts = await fontSources(opts.fontsDir);
  const scale = doc.width / 1080;
  const { width, height } = doc;
  const checks: LayoutCheck[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const page = await opts.browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const shoot = async (layer: Parameters<typeof buildLayerDocument>[0], name: string): Promise<{ png: string; rects: Rect[] }> => {
      const htmlPath = resolve(opts.outDir, `${name}.html`);
      writeFileSync(htmlPath, buildLayerDocument(layer, { width, height, fonts }), 'utf8');
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      // force-load every declared face (unused faces are lazy), then require all to be 'loaded'
      const loaded = await page.evaluate(async () => {
        const faces = Array.from(document.fonts);
        await Promise.allSettled(faces.map((f) => f.load()));
        await document.fonts.ready;
        return faces.filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
      });
      const missing = Object.values(FONT_FAMILIES).filter((f) => !loaded.includes(f));
      if (missing.length) throw new Error(`${name}: fonts not loaded: ${missing.join(', ')}`);
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-role="word-box"], [data-role="verse-panel"]'))
          .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
          .map((el) => el.textContent ?? ''),
      );
      if (overflow.length) throw new Error(`${name}: text does not fit — reduce the text size or split the scene (${overflow.map((t) => t.slice(0, 40)).join(' | ')})`);
      const rects = await collectRects(page);
      const png = resolve(opts.outDir, `${name}.png`);
      await page.screenshot({ path: png, omitBackground: true, type: 'png' });
      return { png, rects };
    };

    // persistent footer (QR file → data URL so the page has no file dependency)
    const branding = doc.branding.qr && !/^(data|https?):/.test(doc.branding.qr.src)
      ? { ...doc.branding, qr: { ...doc.branding.qr, src: dataUrl(doc.branding.qr.src) } }
      : doc.branding;
    const footer = await shoot(BrandingLayer({ branding, scale, width, height }), 'persistent');
    const qrRect = footer.rects.find((r) => r.role === 'qr');
    const labelRect = footer.rects.find((r) => r.role === 'label');
    if (qrRect && labelRect) add('QR separate from label', !overlaps(qrRect, labelRect) && labelRect.y >= qrRect.y + qrRect.h, `QR bottom ${Math.round(qrRect.y + qrRect.h)} px, label top ${Math.round(labelRect.y)} px`);
    if (labelRect) add('label centred at the bottom', Math.abs(labelRect.x + labelRect.w / 2 - width / 2) <= 2 * scale && height - (labelRect.y + labelRect.h) <= 120 * scale, `centre ${Math.round(labelRect.x + labelRect.w / 2)}/${width / 2}, ${Math.round(height - labelRect.y - labelRect.h)} px from bottom`);

    const bismillahSvg = readFileSync(doc.bismillah.src, 'utf8');
    const scenePngs: string[] = [];
    for (const [i, scene] of doc.scenes.entries()) {
      const name = `scene-${String(i + 1).padStart(3, '0')}`;
      const shot = await shoot(SceneLayer({ doc, scene, bismillahSvg, scale, width, height }), name);
      scenePngs.push(shot.png);
      const label =
        scene.kind === 'intro_bismillah'
          ? `${name} (Bismillah intro)`
          : scene.kind === 'word_boxes'
            ? `${name} (${scene.ref.surah}:${scene.ref.verse} w${scene.ref.fromPosition}-${scene.ref.toPosition})`
            : `${name} (${scene.items.map((it) => `${it.surah}:${it.verse} w${it.fromPosition}-${it.toPosition}`).join(', ')})`;

      // no overlap between scene content and the footer / title, everything inside the edge margin
      const blocks = shot.rects.filter((r) => ['title', 'word-box', 'verse-panel', 'bismillah'].includes(r.role));
      const all = [...blocks, ...footer.rects.filter((r) => r.role === 'qr' || r.role === 'label')];
      const clashes: string[] = [];
      for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
        const A = all[a]!;
        const B = all[b]!;
        if (A.role === 'word-box' && B.role === 'word-box') continue; // grid siblings are spaced by gap
        if (overlaps(A, B)) clashes.push(`${A.role}×${B.role}`);
      }
      const m = EDGE_MARGIN * scale;
      const outside = all.filter((r) => r.x < m - 1 || r.y < m - 1 || r.x + r.w > width - m + 1 || r.y + r.h > height - m + 1).map((r) => r.role);
      add(`${label}: no overlaps, inside margins`, clashes.length === 0 && outside.length === 0, clashes.length || outside.length ? `overlaps: ${clashes.join(', ') || 'none'}; outside margin: ${outside.join(', ') || 'none'}` : 'ok');
      add(`${label}: no technical label`, doc.showTechnicalLabels || !shot.rects.some((r) => r.role === 'technical-label'), 'checked');
      if (doc.title.enabled && (scene.kind === 'intro_bismillah' ? doc.title.showOnIntro : doc.title.showOnScenes)) {
        const t = shot.rects.find((r) => r.role === 'title');
        add(`${label}: Surah title present at top`, !!t && t.w > 50 * scale && t.y < 400 * scale, t ? `title box ${Math.round(t.w)}×${Math.round(t.h)} at y=${Math.round(t.y)}` : 'missing');
      }
      if (scene.kind === 'full_verse') {
        const markers = shot.rects.filter((r) => r.role === 'verse-marker').map((r) => r.text);
        const numbers = shot.rects.filter((r) => r.role === 'verse-number-fr').map((r) => r.text);
        const expAr = scene.items.filter((it) => sceneEndsVerse(it.toPosition, it.verseWordCount) && doc.verseDecoration.arabicMarker.enabled).map((it) => toArabicIndicDigits(it.verse));
        const expFr = doc.verseDecoration.frenchNumber.enabled ? scene.items.map((it) => String(it.verse)) : [];
        const texts = shot.rects.filter((r) => r.role === 'translation').map((r) => r.text);
        add(`${label}: verse markers/numbers and complete translations`,
          JSON.stringify(markers) === JSON.stringify(expAr) && JSON.stringify(numbers) === JSON.stringify(expFr) && texts.length === scene.items.length && texts.every((t, k) => t === scene.items[k]!.translation),
          `markers ${markers.join(',') || '—'}; numbers ${numbers.join(',') || '—'}`);
      }
      if (scene.kind === 'word_boxes') {
        const ends = sceneEndsVerse(scene.ref.toPosition, scene.ref.verseWordCount);
        const markers = shot.rects.filter((r) => r.role === 'verse-marker');
        const numbers = shot.rects.filter((r) => r.role === 'verse-number-fr');
        const expectAr = ends && doc.verseDecoration.arabicMarker.enabled ? 1 : 0;
        const expectFr = ends && doc.verseDecoration.frenchNumber.enabled ? 1 : 0;
        const arOk = markers.length === expectAr && markers.every((r) => r.text === toArabicIndicDigits(scene.ref.verse));
        const frOk = numbers.length === expectFr && numbers.every((r) => r.text === String(scene.ref.verse));
        // marker must sit in the last box, to the LEFT of the Arabic word (RTL: after it)
        const boxes = shot.rects.filter((r) => r.role === 'word-box');
        const arabics = shot.rects.filter((r) => r.role === 'arabic');
        const lastArabic = arabics[arabics.length - 1];
        const lastBox = boxes[boxes.length - 1];
        const placed = markers.every((mk) => !!lastArabic && !!lastBox && overlaps(mk, lastBox) && mk.x + mk.w <= lastArabic.x + 1);
        add(`${label}: verse-end marker ${ends ? `${toArabicIndicDigits(scene.ref.verse)} + FR ${scene.ref.verse} on last word` : 'absent (verse continues)'}`, arOk && frOk && placed,
          `markers ${markers.map((r) => r.text).join(',') || '—'}; FR numbers ${numbers.map((r) => r.text).join(',') || '—'}`);
      } else if (scene.kind === 'intro_bismillah') {
        const b = shot.rects.find((r) => r.role === 'bismillah');
        add(`${label}: calligraphy present`, !!b && Math.abs(b.w - width * doc.bismillah.widthRatio) <= 2, b ? `${Math.round(b.w)}×${Math.round(b.h)} px` : 'missing');
      }
    }
    return { persistentPng: footer.png, scenePngs, ms: performance.now() - t0, layoutChecks: checks };
  } finally {
    await page.close();
  }
}
