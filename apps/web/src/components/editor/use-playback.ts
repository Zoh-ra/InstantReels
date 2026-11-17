'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Frame clock for the preview (no audio yet — Phase 4 will slave it to the audio element). */
export function usePlayback(totalFrames: number, fps: number) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const origin = useRef<{ t: number; f: number } | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    origin.current = { t: performance.now(), f: frame };
    const tick = (now: number) => {
      const o = origin.current!;
      const f = o.f + Math.floor(((now - o.t) / 1000) * fps);
      if (f >= totalFrames) {
        setFrame(totalFrames - 1);
        setPlaying(false);
        return;
      }
      setFrame(f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // frame intentionally read once when playback starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fps, totalFrames]);

  const seek = useCallback((f: number) => {
    const clamped = Math.max(0, Math.min(totalFrames - 1, Math.round(f)));
    setFrame(clamped);
    if (origin.current) origin.current = { t: performance.now(), f: clamped };
  }, [totalFrames]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && frame >= totalFrames - 1) setFrame(0);
      return !p;
    });
  }, [frame, totalFrames]);

  return { frame, playing, seek, toggle, setPlaying };
}

export function formatTime(frame: number, fps: number): string {
  const total = frame / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const ff = frame % fps;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ff).padStart(2, '0')}`;
}
