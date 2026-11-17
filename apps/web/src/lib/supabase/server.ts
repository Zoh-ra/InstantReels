import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { readPublicEnv } from '@/lib/env';

/** Per-request server client acting as the signed-in user (cookies), still governed by RLS. */
export async function createSupabaseServerClient() {
  const cfg = readPublicEnv();
  if (!cfg.ok) return null;
  const cookieStore = await cookies();
  return createServerClient(cfg.env.NEXT_PUBLIC_SUPABASE_URL, cfg.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // called from a Server Component: cookies are refreshed by proxy.ts instead
        }
      },
    },
  });
}
