import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

const ROOT = resolve(import.meta.dirname, '../../../..');

/** Repository assets addressable from documents as bundled://… (or their web paths). */
const BUNDLED: Record<string, string> = {
  'qr/fr.jpg': 'assets/branding/qr/fr.jpg',
  'bismillah.svg': 'assets/branding/bismillah/bismillah.svg',
};
const WEB_PATHS: Record<string, string> = {
  '/branding/qr/fr.jpg': 'qr/fr.jpg',
  '/branding/bismillah.svg': 'bismillah.svg',
};

export function parseStorageUri(uri: string): { bucket: string; path: string } | null {
  const m = /^storage:\/\/([a-z0-9_-]+)\/(.+)$/.exec(uri);
  return m ? { bucket: m[1]!, path: m[2]! } : null;
}

/**
 * Resolves a document asset URI to a local file for the renderer.
 * Storage objects are downloaded with the server key; only the expected owner folder is accepted.
 */
export async function resolveAsset(uri: string, ctx: { supabase: SupabaseClient; tmpDir: string; ownerId: string; name: string }): Promise<string> {
  const web = WEB_PATHS[uri];
  const bundledKey = web ?? (uri.startsWith('bundled://') ? uri.slice('bundled://'.length) : null);
  if (bundledKey) {
    const rel = BUNDLED[bundledKey];
    if (!rel) throw new Error(`unknown bundled asset ${bundledKey}`);
    return resolve(ROOT, rel);
  }
  const s = parseStorageUri(uri);
  if (!s) throw new Error(`unsupported asset reference (${uri.split(':')[0]})`);
  if (!['audio', 'backgrounds', 'branding'].includes(s.bucket)) throw new Error(`bucket ${s.bucket} not allowed`);
  // user media must come from the job owner's own folder
  if (s.bucket !== 'branding' && !s.path.startsWith(`${ctx.ownerId}/`)) throw new Error('asset outside the owner folder');
  const { data, error } = await ctx.supabase.storage.from(s.bucket).download(s.path);
  if (error || !data) throw new Error(`cannot download ${s.bucket} object: ${error?.message ?? 'empty'}`);
  const local = resolve(ctx.tmpDir, `${ctx.name}${extname(s.path).toLowerCase() || ''}`);
  await mkdir(dirname(local), { recursive: true });
  await pipeline(Readable.fromWeb(data.stream() as never), createWriteStream(local));
  return local;
}
