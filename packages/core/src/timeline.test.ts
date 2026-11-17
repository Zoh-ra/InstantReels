import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { audioDurationToFrames, secondsToFrame, spansFromEndMarks, suggestEvenBoundaries, validateTimeline } from './timeline.ts';

describe('timeline', () => {
  it('converts the spec example 0-4-9-15-22-30 s into contiguous frames', () => {
    const fps = 30;
    const spans = spansFromEndMarks([4, 9, 15, 22].map((s) => secondsToFrame(s, fps)), secondsToFrame(30, fps));
    assert.deepEqual(spans.map((s) => [s.startFrame, s.endFrame]), [[0, 120], [120, 270], [270, 450], [450, 660], [660, 900]]);
  });
  it('rounds once, at input (no float drift)', () => {
    assert.equal(secondsToFrame(3.5, 30), 105);
    assert.equal(secondsToFrame(0.1 + 0.2, 30), 9);
    assert.equal(audioDurationToFrames(18, 30), 540);
    assert.equal(audioDurationToFrames(18.01, 30), 541);
  });
  it('even suggestion covers every frame exactly once', () => {
    for (const [total, n] of [[900, 7], [31, 5], [540, 5]] as const) {
      const spans = suggestEvenBoundaries(total, n);
      assert.deepEqual(validateTimeline(spans, total), []);
    }
  });
  it('detects gaps, overlaps and bad ends', () => {
    assert.ok(validateTimeline([{ startFrame: 0, endFrame: 10 }, { startFrame: 12, endFrame: 20 }], 20).some((e) => e.includes('gap')));
    assert.ok(validateTimeline([{ startFrame: 0, endFrame: 10 }, { startFrame: 8, endFrame: 20 }], 20).some((e) => e.includes('overlap')));
    assert.ok(validateTimeline([{ startFrame: 0, endFrame: 10 }], 20).some((e) => e.includes('last scene')));
    assert.throws(() => spansFromEndMarks([10, 5], 20));
  });
});
