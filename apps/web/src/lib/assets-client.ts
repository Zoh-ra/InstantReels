'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const BUNDLED_WEB: Record<string, string> = {
  'bundled://qr/fr.jpg': '/branding/qr/fr.jpg',
  'bundled://bismillah.svg': '/branding/bismillah.svg',
};

export function parseStorageUri(uri: string): { bucket: string; path: string } | null {
  const m = /^storage:\/\/([a-z0-9_-]+)\/(.+)$/.exec(uri);
  return m ? { bucket: m[1]!, path: m[2]! } : null;
}

/** Browser URL for a document asset URI (signed URLs for private Storage objects). */
export function webUrl(uri: string | null | undefined, signed: Record<string, string>): string | null {
  if (!uri) return null;
  if (BUNDLED_WEB[uri]) return BUNDLED_WEB[uri]!;
  if (uri.startsWith('storage://')) return signed[uri] ?? null;
  if (uri.startsWith('/') || uri.startsWith('http')) return uri;
  return null;
}

/** Creates (and refreshes hourly) signed URLs for the private Storage assets used by the preview. */
export function useSignedUrls(uris: (string | null | undefined)[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = uris.filter((u): u is string => !!u && u.startsWith('storage://')).sort().join('|');
  useEffect(() => {
    if (!key) return;
    const sb = createSupabaseBrowserClient();
    if (!sb) return;
    let cancelled = false;
    const refresh = async () => {
      const entries = await Promise.all(
        key.split('|').map(async (uri) => {
          const s = parseStorageUri(uri);
          if (!s) return null;
          const { data } = await sb.storage.from(s.bucket).createSignedUrl(s.path, 7200);
          return data ? ([uri, data.signedUrl] as const) : null;
        }),
      );
      if (!cancelled) setMap(Object.fromEntries(entries.filter((e): e is readonly [string, string] => !!e)));
    };
    void refresh();
    const timer = setInterval(refresh, 3_600_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);
  return map;
}
