import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Job status for the export panel (RLS: only the owner can read it). */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const sb = await createSupabaseServerClient();
  if (!sb) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const { data, error } = await sb
    .from('render_jobs')
    .select('id, preset, status, progress, error, created_at, started_at, finished_at, exported_videos(size_bytes, expires_at)')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
