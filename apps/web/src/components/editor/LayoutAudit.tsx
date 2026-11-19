'use client';

import { useEffect, useRef, useState } from 'react';
import type { RenderDocument } from '@instantreels/core';
import { BrandingLayer, EDGE_MARGIN, SceneLayer } from '@instantreels/video';

export interface LayoutIssue {
  scene: number;
  message: string;
}

type Box = { x: number; y: number; w: number; h: number; role: string };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ROLE_FR: Record<string, string> = { title: 'titre', 'word-box': 'cadre de mot', 'verse-panel': 'panneau du verset', 'bismillah-panel': 'calligraphie', qr: 'QR code', label: 'libellé' };

/**
 * Renders EVERY scene off-screen at the 1080×1920 design size with the same components as the
 * export and applies the same rules as the render worker (text fits, no overlap, 40 px margins).
 * Issues are reported live so an export is never started with a layout the worker would refuse.
 */
export function LayoutAudit({ doc, bismillahSvg, onIssues }: { doc: RenderDocument; bismillahSvg: string; onIssues: (issues: LayoutIssue[]) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setTick((n) => n + 1), 400);
    return () => clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled || !root.current) return;
      const issues: LayoutIssue[] = [];
      const frames = [...root.current.querySelectorAll<HTMLElement>('[data-audit-scene]')];
      for (const frame of frames) {
        const scene = Number(frame.dataset.auditScene);
        const origin = frame.getBoundingClientRect();
        const box = (el: Element, role: string): Box => {
          const r = el.getBoundingClientRect();
          return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height, role };
        };
        for (const el of frame.querySelectorAll<HTMLElement>('[data-role="word-box"], [data-role="verse-panel"]')) {
          if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
            issues.push({ scene, message: 'le texte ne tient pas dans son cadre (réduisez la taille du texte ou divisez la scène)' });
            break;
          }
        }
        const blocks = ['title', 'word-box', 'verse-panel', 'bismillah-panel', 'qr', 'label'].flatMap((role) => [...frame.querySelectorAll(`[data-role="${role}"]`)].map((el) => box(el, role)));
        const seen = new Set<string>();
        for (let a = 0; a < blocks.length; a++) {
          for (let b = a + 1; b < blocks.length; b++) {
            const A = blocks[a]!;
            const B = blocks[b]!;
            if (A.role === 'word-box' && B.role === 'word-box') continue;
            const key = [A.role, B.role].sort().join('×');
            if (!seen.has(key) && overlaps(A, B)) {
              seen.add(key);
              issues.push({ scene, message: `${ROLE_FR[A.role]} et ${ROLE_FR[B.role]} se chevauchent` });
            }
          }
        }
        const m = EDGE_MARGIN;
        for (const r of blocks) {
          if (r.x < m - 1 || r.y < m - 1 || r.x + r.w > 1080 - m + 1 || r.y + r.h > 1920 - m + 1) {
            issues.push({ scene, message: `${ROLE_FR[r.role]} sort de la marge de sécurité (40 px)` });
            break;
          }
        }
      }
      onIssues(issues);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run after the debounced tick only
  }, [tick]);

  return (
    <div ref={root} aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: 1080, pointerEvents: 'none', visibility: 'hidden' }}>
      {doc.scenes.map((scene, i) => (
        <div key={scene.id} data-audit-scene={i + 1} style={{ position: 'relative', width: 1080, height: 1920, overflow: 'hidden' }}>
          <SceneLayer doc={doc} scene={scene} bismillahSvg={bismillahSvg} scale={1} width={1080} height={1920} />
          <BrandingLayer branding={doc.branding.qr ? { ...doc.branding, qr: { ...doc.branding.qr, src: '/branding/qr/fr.jpg' } } : doc.branding} scale={1} width={1080} height={1920} />
        </div>
      ))}
    </div>
  );
}
