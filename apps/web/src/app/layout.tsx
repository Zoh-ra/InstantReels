import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'InstantReels', template: '%s · InstantReels' },
  description: 'Studio de création de reels coraniques mot à mot et versets complets — Al-Huda International.',
  applicationName: 'InstantReels',
  appleWebApp: { capable: true, title: 'InstantReels', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#060913',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <body className="min-h-dvh">
        <TooltipProvider>{children}</TooltipProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
