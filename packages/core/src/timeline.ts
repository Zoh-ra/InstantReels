/**
 * Frame-based timeline. All boundaries are integer frames; seconds are UI-only.
 * Scene i covers frames [startFrame, endFrame). Scenes are contiguous from 0 to totalFrames.
 */

export interface TimedSpan {
  startFrame: number;
  endFrame: number;
}

/** The single rounding point from user/audio seconds to frames. */
export function secondsToFrame(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`invalid seconds ${seconds}`);
  return Math.round(seconds * fps);
}

export function frameToSeconds(frame: number, fps: number): number {
  return frame / fps;
}

/** Total frames needed to play an audio clip completely. */
export function audioDurationToFrames(durationSeconds: number, fps: number): number {
  return Math.ceil(durationSeconds * fps - 1e-9);
}

/** Even initial suggestion (never overrides manual edits — callers decide). */
export function suggestEvenBoundaries(totalFrames: number, sceneCount: number): TimedSpan[] {
  if (!Number.isInteger(totalFrames) || totalFrames < sceneCount) throw new Error('not enough frames for scenes');
  const spans: TimedSpan[] = [];
  for (let i = 0; i < sceneCount; i++) {
    spans.push({ startFrame: Math.round((i * totalFrames) / sceneCount), endFrame: Math.round(((i + 1) * totalFrames) / sceneCount) });
  }
  return spans;
}

/** Builds contiguous spans from end-marks (e.g. "mark end of scene" clicks), last scene ends at totalFrames. */
export function spansFromEndMarks(endMarks: readonly number[], totalFrames: number): TimedSpan[] {
  const spans: TimedSpan[] = [];
  let start = 0;
  for (const end of [...endMarks, totalFrames]) {
    spans.push({ startFrame: start, endFrame: end });
    start = end;
  }
  const errors = validateTimeline(spans, totalFrames);
  if (errors.length) throw new Error(errors.join('; '));
  return spans;
}

/** Returns human-readable errors; empty array means the timeline is valid. */
export function validateTimeline(spans: readonly TimedSpan[], totalFrames: number): string[] {
  const errors: string[] = [];
  if (spans.length === 0) return ['timeline has no scenes'];
  if (spans[0]?.startFrame !== 0) errors.push('first scene must start at frame 0');
  spans.forEach((s, i) => {
    if (!Number.isInteger(s.startFrame) || !Number.isInteger(s.endFrame)) errors.push(`scene ${i + 1}: non-integer frame`);
    if (s.endFrame <= s.startFrame) errors.push(`scene ${i + 1}: empty or negative duration`);
    const next = spans[i + 1];
    if (next && next.startFrame !== s.endFrame) errors.push(`scene ${i + 1}/${i + 2}: gap or overlap (${s.endFrame} vs ${next.startFrame})`);
  });
  if (spans[spans.length - 1]?.endFrame !== totalFrames) errors.push(`last scene must end at frame ${totalFrames}`);
  return errors;
}
