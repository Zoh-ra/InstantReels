'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Flag, Pause, Play, SkipBack, SkipForward, ZoomIn, ZoomOut } from 'lucide-react';
import type { RenderDocument } from '@instantreels/core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTime } from './use-playback';

export function sceneLabel(doc: RenderDocument, i: number): string {
  const s = doc.scenes[i]!;
  if (s.kind === 'intro_bismillah') return 'Bismillah';
  const verseOf = (x: (typeof doc.scenes)[number]) => (x.kind === 'word_boxes' ? x.ref.verse : x.kind === 'full_verse' ? x.items[0]!.verse : -1);
  if (s.kind === 'full_verse') {
    const first = s.items[0]!;
    const last = s.items[s.items.length - 1]!;
    const range = first.verse === last.verse ? `${doc.surah}:${first.verse}` : `${doc.surah}:${first.verse}–${last.verse}`;
    const partial = first.fromPosition > 1 || last.toPosition < last.verseWordCount;
    return partial ? `${range} (partie)` : range;
  }
  const same = doc.scenes.filter((x) => verseOf(x) === s.ref.verse);
  const part = same.length > 1 ? ` (${same.indexOf(s) + 1}/${same.length})` : '';
  return `${s.ref.surah}:${s.ref.verse}${part}`;
}

/** Audio peaks for the waveform (decoded once per URL). */
function useWaveform(url: string | null): Float32Array | null {
  const [result, setResult] = useState<{ url: string; peaks: Float32Array | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = audio.getChannelData(0);
        const n = 1600;
        const step = Math.max(1, Math.floor(data.length / n));
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let max = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) max = Math.max(max, Math.abs(data[j]!));
          out[i] = max;
        }
        if (!cancelled) setResult({ url, peaks: out });
      } catch {
        if (!cancelled) setResult({ url, peaks: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return url && result?.url === url ? result.peaks : null;
}

function Waveform({ peaks }: { peaks: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#3245ff');
    grad.addColorStop(1, '#b845ed');
    g.fillStyle = grad;
    const max = Math.max(0.01, ...peaks);
    for (let x = 0; x < w; x++) {
      const p = peaks[Math.floor((x / w) * peaks.length)]! / max;
      const bar = Math.max(1, p * h * 0.9);
      g.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [peaks]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full opacity-70" aria-hidden />;
}

export function Transport({ doc, frame, playing, onToggle, onSeek, currentScene, onMarkEnd }: { doc: RenderDocument; frame: number; playing: boolean; onToggle: () => void; onSeek: (f: number) => void; currentScene: number; onMarkEnd?: () => void }) {
  const cur = doc.scenes[currentScene]!;
  const prev = doc.scenes[Math.max(0, currentScene - (frame - cur.startFrame < 10 ? 1 : 0))]!;
  const next = doc.scenes[Math.min(doc.scenes.length - 1, currentScene + 1)]!;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="icon" aria-label="Scène précédente" onClick={() => onSeek(prev.startFrame)}><SkipBack /></Button>
      <Button size="icon-lg" aria-label={playing ? 'Pause' : 'Lecture'} onClick={onToggle}>{playing ? <Pause /> : <Play />}</Button>
      <Button variant="ghost" size="icon" aria-label="Scène suivante" onClick={() => onSeek(next.startFrame)}><SkipForward /></Button>
      <span className="ml-1 font-mono text-sm tabular-nums text-lunar-white" aria-live="off">{formatTime(frame, doc.fps)}</span>
      <span className="font-mono text-sm tabular-nums text-steel">/ {formatTime(doc.totalFrames, doc.fps)}</span>
      {onMarkEnd && (
        <Button variant="outline" size="sm" className="ml-2 gap-1.5" onClick={onMarkEnd} disabled={currentScene >= doc.scenes.length - 1} title="Fixe la fin de la scène en cours à la position de lecture (touche M)">
          <Flag className="size-4" /> Fin de scène ici
        </Button>
      )}
    </div>
  );
}

/**
 * Scene timeline over the audio waveform: proportional blocks, draggable boundaries
 * (mouse, touch, keyboard ←/→, Shift = 1 s), zoom, click to seek.
 */
export function SceneTimeline({ doc, frame, onSeek, currentScene, onBoundary, audioUrl, compact = false }: { doc: RenderDocument; frame: number; onSeek: (f: number) => void; currentScene: number; onBoundary?: (index: number, frame: number) => void; audioUrl?: string | null; compact?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const track = useRef<HTMLDivElement>(null);
  const peaks = useWaveform(audioUrl ?? null);
  const pct = (f: number) => `${(f / doc.totalFrames) * 100}%`;
  const frameAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * doc.totalFrames;
  };
  const startDrag = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onBoundary?.(i, frameAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Dézoomer" onClick={() => setZoom((z) => Math.max(1, z / 2))} disabled={zoom <= 1}><ZoomOut /></Button>
        <span className="w-10 text-center font-mono text-xs text-steel">{zoom}×</span>
        <Button variant="ghost" size="icon-sm" aria-label="Zoomer" onClick={() => setZoom((z) => Math.min(16, z * 2))} disabled={zoom >= 16}><ZoomIn /></Button>
      </div>
      <div className="overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div ref={track} className="relative select-none" style={{ width: `${zoom * 100}%`, minWidth: compact ? 760 : undefined }}>
          <div
            className="relative h-10 cursor-pointer overflow-hidden rounded-xl bg-void-canvas"
            role="slider"
            tabIndex={0}
            aria-label="Position de lecture"
            aria-valuemin={0}
            aria-valuemax={doc.totalFrames - 1}
            aria-valuenow={frame}
            aria-valuetext={formatTime(frame, doc.fps)}
            onClick={(e) => onSeek(frameAt(e.clientX))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') onSeek(frame + (e.shiftKey ? doc.fps : 1));
              if (e.key === 'ArrowLeft') onSeek(frame - (e.shiftKey ? doc.fps : 1));
            }}
          >
            {peaks ? <Waveform peaks={peaks} /> : <div className="absolute inset-y-0 left-0 opacity-60" style={{ width: pct(frame), backgroundImage: 'var(--gradient-nebula)' }} />}
            {!peaks && audioUrl && <span className="absolute inset-0 flex items-center justify-center text-xs text-steel">Analyse de l’audio…</span>}
            {!audioUrl && <span className="absolute inset-0 flex items-center justify-center text-xs text-steel">Aucune récitation — ajoutez un audio dans « Médias »</span>}
          </div>
          <ol className="relative mt-2 h-14" aria-label="Scènes">
            {doc.scenes.map((s, i) => (
              <li key={s.id} className="absolute inset-y-0 px-0.5" style={{ left: pct(s.startFrame), width: pct(s.endFrame - s.startFrame) }}>
                <button
                  type="button"
                  onClick={() => onSeek(s.startFrame)}
                  className={cn('flex h-full w-full flex-col justify-center overflow-hidden rounded-lg border px-2 text-left transition-colors', i === currentScene ? 'border-ultraviolet bg-void-canvas' : 'border-hairline bg-singularity hover:bg-void-canvas/60')}
                  aria-current={i === currentScene}
                  aria-label={`Scène ${i + 1} : ${sceneLabel(doc, i)}, ${((s.endFrame - s.startFrame) / doc.fps).toFixed(2)} secondes`}
                >
                  <span className="truncate text-xs text-lunar-white">{sceneLabel(doc, i)}</span>
                  <span className="truncate font-mono text-[11px] text-steel">{((s.endFrame - s.startFrame) / doc.fps).toFixed(2)} s</span>
                </button>
              </li>
            ))}
            {onBoundary &&
              doc.scenes.slice(0, -1).map((s, i) => (
                <li key={`b-${s.id}`} className="absolute inset-y-0 z-10 -ml-3 w-6" style={{ left: pct(s.endFrame) }}>
                  <button
                    type="button"
                    className="group flex h-full w-full cursor-ew-resize touch-none items-center justify-center"
                    aria-label={`Limite entre les scènes ${i + 1} et ${i + 2} : ${formatTime(s.endFrame, doc.fps)}`}
                    onPointerDown={startDrag(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        onBoundary(i, s.endFrame + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? doc.fps : 1));
                      }
                    }}
                  >
                    <span className="h-full w-1 rounded-full bg-amber/70 group-hover:bg-amber group-focus-visible:bg-amber" />
                  </button>
                </li>
              ))}
          </ol>
          <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-lunar-white" style={{ left: pct(frame) }} aria-hidden />
        </div>
      </div>
    </div>
  );
}
