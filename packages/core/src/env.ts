import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader for Node scripts (Node 20.11 lacks process.loadEnvFile).
 * Never logs values. Existing process.env values win.
 */
export function loadDotEnv(files: string[] = ['.env.local', '.env']): void {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trimStart().startsWith('#')) continue;
      const key = m[1] as string;
      let value = m[2] ?? '';
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}
