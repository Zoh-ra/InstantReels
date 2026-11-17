import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'InstantReels — Studio de reels coraniques',
    short_name: 'InstantReels',
    description: 'Créez des reels coraniques mot à mot et versets complets, exportés en MP4.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#060913',
    theme_color: '#060913',
    lang: 'fr',
    dir: 'ltr',
    categories: ['education', 'productivity', 'photo-video'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
