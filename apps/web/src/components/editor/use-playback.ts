'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Frame clock of the editor. With a recitation loaded, the AUDIO element is the clock
 * (frame = floor(currentTime × fps)), so scenes follow exactly what the user hears.
 * Without audio, a requestAnimationFrame clock is used.
 */
export function usePlayback(totalFrames: number, fps: number, audioRef?: RefObject<HTMLAudioElement | null>) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const origin = useRef<{ t: number; f: number } | null>(null);
  const frameRef = useRef(0);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    if (!playing) {
      audioRef?.current?.pause();
      return;
    }
    const audio = audioRef?.current ?? null;
    let raf = 0;
    if (audio) {
      // eslint-disable-next-line react-hooks/immutability -- seeking a DOM media element is an intended side effect
      audio.currentTime = frameRef.current / fps;
      void audio.play().catch(() => setPlaying(false));
    }
    origin.current = { t: performance.now(), f: frameRef.current };
    const tick = (now: number) => {
      const f = audio ? Math.floor(audio.currentTime * fps) : origin.current!.f + Math.floor(((now - origin.current!.t) / 1000) * fps);
      if (f >= totalFrames || (audio && audio.ended)) {
        setFrame(totalFrames - 1);
        setPlaying(false);
        return;
      }
      setFrame(f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, totalFrames, audioRef]);

  const seek = useCallback(
    (f: number) => {
      const clamped = Math.max(0, Math.min(totalFrames - 1, Math.round(f)));
      setFrame(clamped);
      const audio = audioRef?.current;
      // eslint-disable-next-line react-hooks/immutability -- seeking a DOM media element is an intended side effect
      if (audio) audio.currentTime = clamped / fps;
      if (origin.current) origin.current = { t: performance.now(), f: clamped };
    },
    [totalFrames, fps, audioRef],
  );

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && frameRef.current >= totalFrames - 1) setFrame(0);
      return !p;
    });
  }, [totalFrames]);

  // keyboard: space = play/pause (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== 'Space' || (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) || t?.isContentEditable) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { frame, playing, seek, toggle, setPlaying };
}

export function formatTime(frame: number, fps: number): string {
  const total = frame / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const ff = frame % fps;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ff).padStart(2, '0')}`;
}

/** "12.35" seconds → frames (single rounding point). */
export function parseSeconds(text: string, fps: number): number | null {
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * fps) : null;
}
