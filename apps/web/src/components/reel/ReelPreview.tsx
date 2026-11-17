'use client';

import { useEffect, useRef, useState } from 'react';
import type { RenderDocument, Scene } from '@instantreels/core';
import { BrandingLayer, IntroSceneLayer, WordBoxSceneLayer } from '@instantreels/video';
import { cn } from '@/lib/utils';

const DESIGN_W = 1080;
const DESIGN_H = 1920;

export function sceneAtFrame(doc: RenderDocument, frame: number): { scene: Scene; index: number } {
  const index = Math.max(0, doc.scenes.findIndex((s) => frame >= s.startFrame && frame < s.endFrame));
  return { scene: doc.scenes[index]!, index };
}

/**
 * Lightweight browser preview. Renders the SAME React layers as the render worker at the
 * 1080×1920 design size, then scales the whole canvas with a CSS transform. The export
 * differs only by its background video (here a static nebula backdrop) and encoding.
 */
export function ReelPreview({ doc, bismillahSvg, frame, animate = true, className }: { doc: RenderDocument; bismillahSvg: string; frame: number; animate?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale((entry?.contentRect.width ?? 0) / DESIGN_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { scene } = sceneAtFrame(doc, frame);
  const fade = doc.sceneFadeInFrames;
  // same linear alpha fade-in as the FFmpeg export; disabled while paused so edits stay visible
  const opacity = animate && fade > 0 ? Math.min(1, (frame - scene.startFrame) / fade) : 1;

  return (
    <div ref={box} className={cn('relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-hairline bg-singularity', className)} aria-label="Aperçu de la vidéo" role="img">
      {scale > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})` }}>
          {/* backdrop stands in for the background video in the preview */}
          <div className="absolute inset-0" style={{ background: 'radial-gradient(55% 35% at 50% 45%, rgb(184 69 237 / 0.28), transparent 70%), radial-gradient(70% 40% at 30% 70%, rgb(50 69 255 / 0.22), transparent 70%), #060913' }} />
          <div className="absolute inset-0" style={{ opacity }}>
            {scene.kind === 'intro_bismillah' ? (
              <IntroSceneLayer surah={doc.surah} bismillah={doc.bismillah} bismillahSvg={bismillahSvg} title={doc.title} scale={1} width={DESIGN_W} height={DESIGN_H} />
            ) : (
              <WordBoxSceneLayer scene={scene} style={doc.boxStyle} decoration={doc.verseDecoration} title={doc.title} showTechnicalLabels={doc.showTechnicalLabels} scale={1} width={DESIGN_W} height={DESIGN_H} />
            )}
          </div>
          <BrandingLayer branding={doc.branding} scale={1} width={DESIGN_W} height={DESIGN_H} />
        </div>
      )}
    </div>
  );
}
