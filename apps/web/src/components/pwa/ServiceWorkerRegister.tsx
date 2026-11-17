'use client';

import { useEffect } from 'react';

/** Registers the minimal service worker (offline fallback page only; no data caching). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // non-fatal: the app works without a service worker
    });
  }, []);
  return null;
}
