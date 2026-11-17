'use client';

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { RenderDocument } from '@instantreels/core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTime } from './use-playback';

function sceneLabel(doc: RenderDocument, i: number): string {
  const s = doc.scenes[i]!;
  if (s.kind === 'intro_bismillah') return 'Bismillah';
  const verseScenes = doc.scenes.filter((x) => x.kind === 'word_boxes' && x.ref.verse === s.ref.verse);
  const part = verseScenes.length > 1 ? ` (${verseScenes.indexOf(s) + 1}/${verseScenes.length})` : '';
  return `${s.ref.surah}:${s.ref.verse}${part}`;
}

export function Transport({ doc, frame, playing, onToggle, onSeek, currentScene }: { doc: RenderDocument; frame: number; playing: boolean; onToggle: () => void; onSeek: (f: number) => void; currentScene: number }) {
  const prev = doc.scenes[Math.max(0, currentScene - (frame - doc.scenes[currentScene]!.startFrame < 10 ? 1 : 0))]!;
  const next = doc.scenes[Math.min(doc.scenes.length - 1, currentScene + 1)]!;
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" aria-label="Scène précédente" onClick={() => onSeek(prev.startFrame)}><SkipBack /></Button>
      <Button size="icon-lg" aria-label={playing ? 'Pause' : 'Lecture'} onClick={onToggle}>{playing ? <Pause /> : <Play />}</Button>
      <Button variant="ghost" size="icon" aria-label="Scène suivante" onClick={() => onSeek(next.startFrame)}><SkipForward /></Button>
      <span className="ml-2 font-mono text-sm tabular-nums text-lunar-white">{formatTime(frame, doc.fps)}</span>
      <span className="font-mono text-sm tabular-nums text-steel">/ {formatTime(doc.totalFrames, doc.fps)}</span>
    </div>
  );
}

/** Scene timeline: widths proportional to duration, playhead, click/keyboard seeking. Audio waveform arrives in Phase 4. */
export function SceneTimeline({ doc, frame, onSeek, currentScene, compact = false }: { doc: RenderDocument; frame: number; onSeek: (f: number) => void; currentScene: number; compact?: boolean }) {
  const pct = (f: number) => `${(f / doc.totalFrames) * 100}%`;
  return (
    <div className={cn('relative', compact ? 'min-w-[720px]' : 'w-full')}>
      <div
        className="relative h-3 cursor-pointer rounded-full bg-void-canvas"
        role="slider"
        tabIndex={0}
        aria-label="Position de lecture"
        aria-valuemin={0}
        aria-valuemax={doc.totalFrames - 1}
        aria-valuenow={frame}
        aria-valuetext={formatTime(frame, doc.fps)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - r.left) / r.width) * doc.totalFrames);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(frame + (e.shiftKey ? doc.fps : 1));
          if (e.key === 'ArrowLeft') onSeek(frame - (e.shiftKey ? doc.fps : 1));
        }}
      >
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(frame), backgroundImage: 'var(--gradient-nebula)' }} />
      </div>
      <ol className="mt-3 flex gap-1" aria-label="Scènes">
        {doc.scenes.map((s, i) => (
          <li key={s.id} style={{ width: pct(s.endFrame - s.startFrame) }} className="min-w-0">
            <button
              type="button"
              onClick={() => onSeek(s.startFrame)}
              className={cn(
                'flex h-14 w-full flex-col justify-center rounded-xl border px-2 text-left transition-colors',
                i === currentScene ? 'border-ultraviolet bg-void-canvas' : 'border-hairline bg-singularity hover:bg-void-canvas/60',
              )}
              aria-current={i === currentScene}
            >
              <span className="truncate text-xs text-lunar-white">{sceneLabel(doc, i)}</span>
              <span className="truncate font-mono text-[11px] text-steel">{((s.endFrame - s.startFrame) / doc.fps).toFixed(1)} s</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="pointer-events-none absolute -top-1 bottom-0 w-px bg-lunar-white/80" style={{ left: pct(frame) }} aria-hidden />
    </div>
  );
}
