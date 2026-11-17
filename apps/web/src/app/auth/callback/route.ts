import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Magic-link landing: exchanges the one-time code for a session cookie, then redirects. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') ?? '/projects';
  // only same-site relative redirects
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/projects';
  if (code) {
    const sb = await createSupabaseServerClient();
    if (sb) {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL('/login?error=link', url.origin));
}
