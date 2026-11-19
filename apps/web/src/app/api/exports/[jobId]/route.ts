import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXPORTS_DIR = resolve(/*turbopackIgnore: true*/ process.cwd(), '../..', process.env.EXPORTS_DIR?.trim() || 'output/exports');

/**
 * Download of an exported MP4 by its owner (the row is only visible to the owner through RLS).
 * - Supabase Storage → short-lived signed URL.
 * - Local delivery (file larger than the Storage upload limit) → streamed from the worker's export folder.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return NextResponse.json({ error: 'Identifiant invalide' }, { status: 400 });
  const sb = await createSupabaseServerClient();
  if (!sb) return NextResponse.json({ error: 'Supabase n’est pas configuré' }, { status: 503 });
  const { data } = await sb.from('exported_videos').select('storage_path, size_bytes, render_jobs(preset, projects(title))').eq('render_job_id', jobId).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Export introuvable ou expiré' }, { status: 404 });
  const meta = data as unknown as { storage_path: string; render_jobs: { preset: string; projects: { title: string } | null } | null };
  const title = (meta.render_jobs?.projects?.title ?? 'instantreels').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'instantreels';
  const filename = `${title}-${meta.render_jobs?.preset ?? ''}.mp4`;

  if (meta.storage_path.startsWith('local://')) {
    const file = resolve(/*turbopackIgnore: true*/ EXPORTS_DIR, meta.storage_path.slice('local://'.length));
    if (!file.startsWith(EXPORTS_DIR + sep) || !existsSync(file)) {
      return NextResponse.json({ error: 'Ce fichier est conservé sur le serveur de rendu et n’est pas accessible depuis ce serveur web.' }, { status: 404 });
    }
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(stream, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(statSync(file).size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  const { data: signed, error } = await sb.storage.from('exports').createSignedUrl(meta.storage_path, 600, { download: filename });
  if (error || !signed) return NextResponse.json({ error: 'Lien de téléchargement indisponible — réessayez.' }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
}
