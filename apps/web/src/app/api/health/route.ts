import { NextResponse } from 'next/server';
import { readPublicEnv } from '@/lib/env';
import { readServerEnv } from '@/lib/env.server';

export const dynamic = 'force-dynamic';

/** Configuration health: reports which settings are present/valid and whether Supabase answers. Never returns values. */
export async function GET() {
  const pub = readPublicEnv();
  const srv = readServerEnv();
  let supabaseReachable: boolean | null = null;
  let supabaseStatus: number | null = null;
  if (pub.ok) {
    try {
      const res = await fetch(`${pub.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: pub.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      supabaseStatus = res.status;
      supabaseReachable = res.ok;
    } catch {
      supabaseReachable = false;
    }
  }
  return NextResponse.json({
    publicConfig: pub.ok ? 'ok' : pub.problems,
    serverConfig: srv.ok ? 'ok' : srv.problems,
    supabaseReachable,
    supabaseStatus,
  });
}
