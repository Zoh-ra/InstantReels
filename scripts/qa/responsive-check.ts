/**
 * Responsive smoke test against a running dev/prod server (default http://localhost:3000).
 * For each viewport: screenshots of / and /editor/demo, no horizontal page overflow,
 * preview visible with 9:16 ratio, no console errors.
 * Usage: npx tsx scripts/qa/responsive-check.ts [baseUrl]
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = resolve(import.meta.dirname, '../../output/qa');
mkdirSync(out, { recursive: true });

const viewports = [
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'tablet-834', viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true },
  { name: 'phone-390', viewport: devices['iPhone 13']!.viewport, isMobile: true, hasTouch: true },
  { name: 'phone-360', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
];

const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL?.trim() || 'chrome' });
let failures = 0;
for (const v of viewports) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['/', '/editor/demo']) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(() => {
      const pv = [...document.querySelectorAll<HTMLElement>('[aria-label="Aperçu de la vidéo"]')].find((e) => e.offsetParent !== null);
      const b = pv?.getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth - window.innerWidth, preview: b ? { w: Math.round(b.width), h: Math.round(b.height), ratio: +(b.width / b.height).toFixed(3), top: Math.round(b.top) } : null };
    });
    const name = `${v.name}${path === '/' ? '-home' : '-editor'}`;
    await page.screenshot({ path: resolve(out, `${name}.png`) });
    const okOverflow = r.overflowX <= 0;
    const okPreview = path === '/' || (!!r.preview && Math.abs(r.preview.ratio - 0.5625) < 0.01 && r.preview.top < v.viewport.height);
    if (!okOverflow || !okPreview) failures++;
    console.log(`${okOverflow && okPreview ? 'PASS' : 'FAIL'} ${name}: overflowX=${r.overflowX} preview=${JSON.stringify(r.preview)}`);
  }
  if (errors.length) {
    failures++;
    console.log(`FAIL ${v.name}: console errors: ${errors.join(' | ')}`);
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all responsive checks passed');
process.exitCode = failures ? 1 : 0;
