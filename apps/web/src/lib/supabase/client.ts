'use client';
import { createBrowserClient } from '@supabase/ssr';
import { readPublicEnv } from '@/lib/env';

/** Browser client: publishable key only, all access governed by RLS. Null when not configured. */
export function createSupabaseBrowserClient() {
  const cfg = readPublicEnv();
  if (!cfg.ok) return null;
  return createBrowserClient(cfg.env.NEXT_PUBLIC_SUPABASE_URL, cfg.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
