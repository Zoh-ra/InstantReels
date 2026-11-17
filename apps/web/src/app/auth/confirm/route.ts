import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Token-hash confirmation (Supabase SSR pattern): works with email templates using
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/projects
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next') ?? '/projects';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/projects';
  if (tokenHash && type) {
    const sb = await createSupabaseServerClient();
    if (sb) {
      const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL('/login?error=link', url.origin));
}
