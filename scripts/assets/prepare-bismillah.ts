/**
 * Converts the owner-supplied Bismillah calligraphy into a recolourable vector asset
 * WITHOUT redrawing it: the original strokes are isolated (the baked-in checkerboard is
 * removed by thresholding) and traced with potrace (deterministic outline tracing, no AI).
 * Fidelity is measured by rasterising the SVG back and comparing it with the source mask (IoU).
 *
 * Usage: npx tsx scripts/assets/prepare-bismillah.ts [source.jpg]
 * Output: assets/branding/bismillah/bismillah.svg (+ fidelity report JSON)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import potrace from 'potrace';
import { ffmpeg, ffmpegRaw } from '../../apps/worker/src/media/ffmpeg.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = resolve(process.argv[2] ?? resolve(ROOT, 'assets/branding/bismillah/source/bismillah-owner-supplied.jpg'));
const OUT_DIR = resolve(ROOT, 'assets/branding/bismillah');
const TMP = resolve(ROOT, 'tmp/bismillah');
const UPSCALE = 3;
/** Checkerboard squares are ~229–255; calligraphy strokes are near 0. */
const BACKGROUND_CUTOFF = 200;
const INK_THRESHOLD = 128;

mkdirSync(TMP, { recursive: true });
const pre = resolve(TMP, 'pre.png');
// 1. grayscale, flatten checkerboard to white, upscale smoothly (tracing input only)
await ffmpeg(['-i', SRC, '-vf', `format=gray,lut=c0='if(gte(val\\,${BACKGROUND_CUTOFF})\\,255\\,val)',scale=iw*${UPSCALE}:ih*${UPSCALE}:flags=bicubic`, pre]);

// 2. trace
const traced: string = await new Promise((res, rej) =>
  potrace.trace(pre, { threshold: INK_THRESHOLD, turdSize: 6, optTolerance: 0.2, alphaMax: 1, color: '#000000', background: 'transparent' }, (err: Error | null, svg: string) => (err ? rej(err) : res(svg))),
);
const d = /<path[^>]*\sd="([^"]+)"/.exec(traced)?.[1];
if (!d) throw new Error('potrace produced no path');

// 3. source mask at tracing scale (for the fidelity measurement)
const { width: W, height: H } = PNG.sync.read(readFileSync(pre));
const preRaw = await ffmpegRaw(['-i', pre, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);

// 4. rasterise the traced path, measure IoU and the tight bounding box
const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL?.trim() || 'chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<html><body style="margin:0;background:#fff"><svg id=s xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path id=p d="${d}" fill="#000" fill-rule="evenodd"/></svg></body></html>`);
const bbox = await page.evaluate(() => {
  const b = (document.getElementById('p') as unknown as SVGGraphicsElement).getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
const shot = PNG.sync.read(await page.screenshot({ type: 'png' }));
await browser.close();
let inter = 0;
let union = 0;
for (let i = 0; i < W * H; i++) {
  const a = (preRaw[i] ?? 255) < INK_THRESHOLD;
  const b = (shot.data[i * 4] ?? 255) < INK_THRESHOLD;
  if (a && b) inter++;
  if (a || b) union++;
}
const iou = inter / union;

// 5. final SVG: tight viewBox, fill = currentColor so the theme can recolour it
const m = Math.round(Math.max(bbox.w, bbox.h) * 0.01);
const vb = [Math.floor(bbox.x - m), Math.floor(bbox.y - m), Math.ceil(bbox.w + 2 * m), Math.ceil(bbox.h + 2 * m)];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" fill="currentColor" role="img" aria-label="بسم الله الرحمن الرحيم">\n<!-- Traced (potrace) from the owner-supplied calligraphy, source SHA-256 in bismillah.json. Shapes not redrawn. -->\n<path d="${d}" fill-rule="evenodd"/>\n</svg>\n`;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'bismillah.svg'), svg);
const { createHash } = await import('node:crypto');
const report = {
  source: SRC.replace(ROOT, '.').replaceAll('\\', '/'),
  sourceSha256: createHash('sha256').update(readFileSync(SRC)).digest('hex'),
  method: `checkerboard >= ${BACKGROUND_CUTOFF} flattened, bicubic x${UPSCALE}, potrace threshold ${INK_THRESHOLD} turdSize 6 optTolerance 0.2`,
  tracedAt: new Date().toISOString(),
  aspectRatio: +(vb[2]! / vb[3]!).toFixed(4),
  fidelityIoU: +iou.toFixed(4),
  licence: 'PENDING — provenance and rights of the supplied image not confirmed (see docs/DECISIONS.md D-14)',
};
writeFileSync(resolve(OUT_DIR, 'bismillah.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report);
if (iou < 0.95) {
  console.error(`fidelity too low (IoU ${iou.toFixed(3)} < 0.95)`);
  process.exitCode = 1;
}
