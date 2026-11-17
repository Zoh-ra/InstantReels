import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

const PROTECTED = [/^\/projects(\/|$)/, /^\/editor\/(?!demo$)[^/]+/];

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  // magic links may land on the Site URL with ?code=… — forward them to the callback
  if (url.searchParams.has('code') && url.pathname !== '/auth/callback') {
    const target = new URL('/auth/callback', url.origin);
    target.searchParams.set('code', url.searchParams.get('code')!);
    target.searchParams.set('next', '/projects');
    return NextResponse.redirect(target);
  }
  const { response, userId } = await updateSession(request);
  if (!userId && PROTECTED.some((re) => re.test(url.pathname))) {
    const login = new URL('/login', url.origin);
    login.searchParams.set('next', url.pathname);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|branding/|sw.js|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|webp|ttf|woff2?)$).*)'],
};
