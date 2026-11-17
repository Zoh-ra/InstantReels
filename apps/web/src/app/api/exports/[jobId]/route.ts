import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Redirects the owner to a short-lived signed download URL of the exported MP4. */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const sb = await createSupabaseServerClient();
  if (!sb) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const { data } = await sb.from('exported_videos').select('storage_path, render_jobs(preset, projects(title))').eq('render_job_id', jobId).maybeSingle();
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const meta = data as unknown as { storage_path: string; render_jobs: { preset: string; projects: { title: string } | null } | null };
  const title = (meta.render_jobs?.projects?.title ?? 'instantreels').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'instantreels';
  const { data: signed, error } = await sb.storage.from('exports').createSignedUrl(meta.storage_path, 600, { download: `${title}-${meta.render_jobs?.preset ?? ''}.mp4` });
  if (error || !signed) return NextResponse.json({ error: error?.message ?? 'cannot sign' }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
}
