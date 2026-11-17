'use client';

import { useEffect, useRef, useState } from 'react';
import type { RenderDocument, Scene } from '@instantreels/core';
import { BrandingLayer, SceneLayer } from '@instantreels/video';
import { cn } from '@/lib/utils';

const DESIGN_W = 1080;
const DESIGN_H = 1920;

export function sceneAtFrame(doc: RenderDocument, frame: number): { scene: Scene; index: number } {
  const index = Math.max(0, doc.scenes.findIndex((s) => frame >= s.startFrame && frame < s.endFrame));
  return { scene: doc.scenes[index] ?? doc.scenes[doc.scenes.length - 1]!, index: index === -1 ? doc.scenes.length - 1 : index };
}

/**
 * Lightweight browser preview. Renders the SAME React layers as the render worker at the
 * 1080×1920 design size and scales the canvas with a CSS transform. The background video plays
 * at its native speed and loops (like the export); brightness / dim / blur mimic the FFmpeg filters.
 */
export function ReelPreview({
  doc,
  bismillahSvg,
  frame,
  playing = false,
  animate = true,
  backgroundUrl,
  qrUrl,
  className,
  onOverflow,
}: {
  doc: RenderDocument;
  bismillahSvg: string;
  frame: number;
  playing?: boolean;
  animate?: boolean;
  backgroundUrl?: string | null;
  qrUrl?: string | null;
  className?: string;
  onOverflow?: (overflowing: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale((entry?.contentRect.width ?? 0) / DESIGN_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // background video: native 1x playback, looping; re-synchronised when seeking
  const t = frame / doc.fps;
  useEffect(() => {
    const v = video.current;
    if (!v || !Number.isFinite(v.duration) || v.duration === 0) return;
    const target = t % v.duration;
    if (!playing || Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [t, playing]);

  const { scene } = sceneAtFrame(doc, frame);
  const fade = doc.sceneFadeInFrames;
  const opacity = animate && fade > 0 ? Math.min(1, (frame - scene.startFrame) / fade) : 1;

  // overflow warning (the export refuses text that does not fit)
  useEffect(() => {
    if (!onOverflow || !box.current) return;
    const id = requestAnimationFrame(() => {
      const els = box.current?.querySelectorAll<HTMLElement>('[data-role="word-box"], [data-role="verse-panel"]') ?? [];
      onOverflow([...els].some((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1));
    });
    return () => cancelAnimationFrame(id);
  });

  const bg = doc.background;
  const branding = doc.branding.qr ? { ...doc.branding, qr: qrUrl ? { ...doc.branding.qr, src: qrUrl } : { ...doc.branding.qr, visible: false } } : doc.branding;

  return (
    <div ref={box} className={cn('relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-hairline bg-singularity', className)} aria-label="Aperçu de la vidéo" role="img">
      {scale > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})` }}>
          {bg.kind === 'solid' && <div className="absolute inset-0" style={{ background: bg.color }} />}
          {bg.kind === 'video' && (
            <>
              <div className="absolute inset-0 bg-black" />
              {backgroundUrl && (
                <video
                  ref={video}
                  src={backgroundUrl}
                  muted
                  loop
                  playsInline
                  preload="auto"
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ filter: `brightness(${1 + bg.brightness})${bg.blur > 0 ? ` blur(${bg.blur}px)` : ''}` }}
                />
              )}
              <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${bg.dimOpacity})` }} />
            </>
          )}
          <div className="absolute inset-0" style={{ opacity }}>
            <SceneLayer doc={doc} scene={scene} bismillahSvg={bismillahSvg} scale={1} width={DESIGN_W} height={DESIGN_H} />
          </div>
          <BrandingLayer branding={branding} scale={1} width={DESIGN_W} height={DESIGN_H} />
        </div>
      )}
    </div>
  );
}
