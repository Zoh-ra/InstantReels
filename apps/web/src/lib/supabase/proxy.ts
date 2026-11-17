import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { readPublicEnv } from '@/lib/env';

/** Refreshes the Supabase auth session cookie on each request (no-op until Supabase is configured). */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const cfg = readPublicEnv();
  if (!cfg.ok) return response;
  const supabase = createServerClient(cfg.env.NEXT_PUBLIC_SUPABASE_URL, cfg.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  // validates the JWT with Supabase Auth; do not run code between client creation and this call
  await supabase.auth.getClaims();
  return response;
}
