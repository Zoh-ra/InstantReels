/**
 * Responsive + accessibility smoke test of the AUTHENTICATED pages with the approved test account:
 * /projects, /projects/new, /editor/<id> (word-by-word and full-verse) at 4 viewports.
 * Checks: no horizontal overflow, 9:16 preview visible, every button/link/input has an accessible
 * name, touch targets ≥ 32 px on touch viewports, no page errors. Test data is removed afterwards.
 * Usage: npx tsx scripts/qa/responsive-auth-check.ts [baseUrl]
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, devices } from 'playwright-core';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';

loadDotEnv();
const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = resolve(import.meta.dirname, '../../output/qa');
mkdirSync(OUT, { recursive: true });
const EMAIL = 'instantreels-e2e@example.com';
const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), { auth: { persistSession: false } });

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
const uid = users.users.find((u) => u.email === EMAIL)?.id;
if (!uid) throw new Error('test account missing — run scripts/qa/e2e-workflow.ts first');
const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });

const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL?.trim() || 'chrome' });
const setup = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p0 = await setup.newPage();
await p0.goto(`${BASE}/auth/confirm?token_hash=${encodeURIComponent(link.properties!.hashed_token)}&type=magiclink&next=/projects`);
await p0.waitForURL(/\/projects$/);
const cookies = await setup.cookies();
const created: string[] = [];
for (const [mode, label, q, to] of [['word', /Mot à mot/, '36', '5'], ['verse', /Versets complets/, '2', '255']] as const) {
  await p0.goto(`${BASE}/projects/new`);
  await p0.getByRole('button', { name: label }).click();
  await p0.getByLabel('Rechercher une sourate par numéro ou par nom').fill(q);
  await p0.locator('ul[aria-label="Sourates"] button').first().click();
  if (mode === 'verse') {
    await p0.getByLabel('Du verset').fill('255');
  }
  await p0.getByLabel('au verset').fill(to);
  await p0.getByLabel('Aperçu du texte').waitFor({ timeout: 20000 });
  await p0.getByRole('button', { name: 'Créer et générer les scènes' }).click();
  await p0.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30000 });
  created.push(p0.url().split('/').pop()!);
}
await setup.close();

const viewports = [
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 }, touch: false },
  { name: 'tablet-834', viewport: { width: 834, height: 1194 }, touch: true },
  { name: 'phone-390', viewport: devices['iPhone 13']!.viewport, touch: true },
  { name: 'phone-360', viewport: { width: 360, height: 740 }, touch: true },
];
const pages = [
  ['projects', '/projects'],
  ['new', '/projects/new'],
  ['editor-word', `/editor/${created[0]}`],
  ['editor-verse', `/editor/${created[1]}`],
] as const;

for (const v of viewports) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.touch, hasTouch: v.touch });
  await ctx.addCookies(cookies);
  // tsx keeps function names via a __name helper that does not exist inside the page
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [name, path] of pages) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate((touch) => {
      const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed';
      const unnamed = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=slider], [role=tab]')]
        .filter((el) => visible(el) && !(el as HTMLElement).classList.contains('sr-only'))
        .filter((el) => {
          const label = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) || el.getAttribute('title') || el.closest('label')?.textContent?.trim();
          return !label;
        })
        .map((el) => el.outerHTML.slice(0, 80));
      const small = touch
        ? [...document.querySelectorAll('button, a[href], [role=tab]')].filter(visible).filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && (b.width < 32 || b.height < 24);
          }).map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30))
        : [];
      const pv = [...document.querySelectorAll<HTMLElement>('[aria-label="Aperçu de la vidéo"]')].find((e) => e.offsetParent !== null);
      const b = pv?.getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth - window.innerWidth, unnamed, small, ratio: b ? +(b.width / b.height).toFixed(3) : null };
    }, v.touch);
    await page.screenshot({ path: resolve(OUT, `auth-${v.name}-${name}.png`) });
    const previewOk = !name.startsWith('editor') || (r.ratio !== null && Math.abs(r.ratio - 0.5625) < 0.01);
    check(`${v.name} ${name}: no horizontal overflow, preview 9:16`, r.overflowX <= 0 && previewOk, `overflowX=${r.overflowX} ratio=${r.ratio}`);
    check(`${v.name} ${name}: all controls have accessible names`, r.unnamed.length === 0, r.unnamed.slice(0, 3).join(' | '));
    if (v.touch) check(`${v.name} ${name}: touch targets ≥ 32×24 px`, r.small.length === 0, r.small.slice(0, 6).join(', '));
  }
  check(`${v.name}: no page errors`, errors.length === 0, errors.join(' | ').slice(0, 200));
  await ctx.close();
}
await browser.close();
await admin.from('projects').delete().in('id', created);
console.log(failures ? `\n${failures} check(s) FAILED` : '\nauthenticated responsive checks passed');
process.exitCode = failures ? 1 : 0;
