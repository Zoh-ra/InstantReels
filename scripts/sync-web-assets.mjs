// Copies shared, unmodified assets into apps/web/public so the browser preview uses the
// exact same font files and calligraphy as the render worker. The copies are git-ignored.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'apps/web/public');
const copies = [
  ...readdirSync(join(root, 'assets/fonts')).filter((f) => /\.(ttf|otf)$/.test(f)).map((f) => [join('assets/fonts', f), join('fonts', f)]),
  ['assets/branding/bismillah/bismillah.svg', 'branding/bismillah.svg'],
  ['assets/branding/qr/fr.jpg', 'branding/qr/fr.jpg'],
];
for (const [from, to] of copies) {
  mkdirSync(dirname(join(pub, to)), { recursive: true });
  copyFileSync(join(root, from), join(pub, to));
}
console.log(`synced ${copies.length} shared assets into apps/web/public`);
