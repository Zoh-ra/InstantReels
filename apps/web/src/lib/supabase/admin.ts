import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { readPublicEnv } from '@/lib/env';
import { readServerEnv } from '@/lib/env.server';

/**
 * Privileged client (secret key, bypasses RLS). Server-only; use solely for trusted jobs
 * such as the workbook importer or the render worker — never with user-controlled queries.
 */
export function createSupabaseAdminClient() {
  const pub = readPublicEnv();
  const srv = readServerEnv();
  if (!pub.ok || !srv.ok) return null;
  return createClient(pub.env.NEXT_PUBLIC_SUPABASE_URL, srv.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
