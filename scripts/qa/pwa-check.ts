/** PWA smoke test against a PRODUCTION server: SW registers, manifest valid, offline fallback served. */
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:3100';
const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL?.trim() || 'chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle' });
const sw = await page.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
  return reg ? (reg as ServiceWorkerRegistration).active?.state ?? 'no-active' : 'timeout';
});
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
  if (!href) return null;
  const m = await (await fetch(href)).json();
  return { href, display: m.display, icons: m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`) };
});
await page.reload({ waitUntil: 'networkidle' }); // page now controlled by the SW
await ctx.setOffline(true);
await page.goto(base + '/editor/demo').catch(() => undefined);
const offlineTitle = await page.locator('h1').first().textContent().catch(() => null);
await browser.close();
const ok = sw === 'activated' && !!manifest && manifest.icons.length === 3 && offlineTitle === 'Connexion perdue';
console.log(JSON.stringify({ sw, manifest, offlineTitle }, null, 2));
console.log(ok ? 'PASS pwa' : 'FAIL pwa');
process.exitCode = ok ? 0 : 1;
