/**
 * Generates the PWA icons (Astro style: deep surface, nebula glow, luminous 9:16 frame).
 * Usage: npx tsx scripts/assets/generate-icons.ts
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../..');
const out = resolve(ROOT, 'apps/web/public/icons');
mkdirSync(out, { recursive: true });

const svg = (pad: number) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="60%"><stop offset="0" stop-color="#b845ed" stop-opacity=".55"/><stop offset=".55" stop-color="#3245ff" stop-opacity=".25"/><stop offset="1" stop-color="#060913" stop-opacity="0"/></radialGradient>
    <linearGradient id="n" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3245ff"/><stop offset="1" stop-color="#b845ed"/></linearGradient>
  </defs>
  <rect width="512" height="512" fill="#060913"/>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(256 256) scale(${(512 - 2 * pad) / 512}) translate(-256 -256)">
    <rect x="171" y="96" width="170" height="302" rx="30" fill="#0c0f19" stroke="url(#n)" stroke-width="14"/>
    <rect x="198" y="150" width="54" height="40" rx="10" fill="none" stroke="#acafff" stroke-width="7"/>
    <rect x="260" y="150" width="54" height="40" rx="10" fill="none" stroke="#acafff" stroke-width="7"/>
    <rect x="198" y="200" width="54" height="40" rx="10" fill="none" stroke="#acafff" stroke-width="7"/>
    <rect x="260" y="200" width="54" height="40" rx="10" fill="none" stroke="#acafff" stroke-width="7"/>
    <path d="M238 284 L238 344 L290 314 Z" fill="#f2f6fa"/>
  </g>
</svg>`;

const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL?.trim() || 'chrome' });
const page = await browser.newPage();
const targets: [string, number, number][] = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 70], // keep the motif inside the maskable safe zone
  ['../../src/app/apple-icon.png', 180, 20],
];
for (const [name, size, pad] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(pad).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: resolve(out, name), clip: { x: 0, y: 0, width: size, height: size } });
}
// favicon via the App Router "icon" convention
await page.setViewportSize({ width: 64, height: 64 });
await page.setContent(`<html><body style="margin:0">${svg(0).replace('width="512" height="512"', 'width="64" height="64"')}</body></html>`);
await page.screenshot({ path: resolve(ROOT, 'apps/web/src/app/icon.png'), clip: { x: 0, y: 0, width: 64, height: 64 } });
await browser.close();
console.log('icons written to apps/web/public/icons and apps/web/src/app/icon.png');
