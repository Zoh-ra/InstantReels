import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // skip static assets, fonts, branding files, PWA files and images
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|branding/|sw.js|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|webp|ttf|woff2?)$).*)'],
};
