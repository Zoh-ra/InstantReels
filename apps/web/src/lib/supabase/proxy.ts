import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { readPublicEnv } from '@/lib/env';

/** Refreshes the Supabase auth session cookie and returns the verified user id (if any). */
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({ request });
  const cfg = readPublicEnv();
  if (!cfg.ok) return { response, userId: null };
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
  // validates the JWT; do not run code between client creation and this call
  const { data } = await supabase.auth.getClaims();
  return { response, userId: (data?.claims?.sub as string | undefined) ?? null };
}
