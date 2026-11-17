// Node 20.11 `--test` has no glob support: collect *.test.ts files and run them with tsx.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages', 'apps'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if ((name.endsWith('.test.ts') || name.endsWith('.test.tsx'))) files.push(p);
  }
};
roots.forEach(walk);
const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
