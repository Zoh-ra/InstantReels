import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { PRESETS, QUALITY_FLOOR_KBPS, planDelivery } from './compose.ts';

const MB50 = 50 * 1024 * 1024;

describe('planDelivery — export size vs the 50 MB Storage limit', () => {
  it('short 1080p reel: full preset bitrate, stored in Supabase', () => {
    const p = planDelivery(PRESETS['1080p30'], 20, MB50);
    assert.equal(p.target, 'storage');
    assert.equal(p.maxrateKbps, 12000);
  });
  it('57 s 1080p reel (the reported failure): capped bitrate, still above the text-sharpness floor', () => {
    const p = planDelivery(PRESETS['1080p30'], 57.3, MB50);
    assert.equal(p.target, 'storage');
    assert.ok(p.maxrateKbps < 12000 && p.maxrateKbps >= QUALITY_FLOOR_KBPS['1080p30']);
    assert.ok(((p.maxrateKbps + 192) * 57.3) / 8 / 1024 < 50, 'worst case fits in 50 MB');
  });
  it('4K beyond ~24 s: never degraded below the floor — delivered locally at full quality', () => {
    const p = planDelivery(PRESETS['2160p30'], 30, MB50);
    assert.equal(p.target, 'local');
    assert.equal(p.maxrateKbps, 24000);
  });
  it('very long 1080p reel also falls back to local delivery instead of blurring', () => {
    assert.equal(planDelivery(PRESETS['1080p30'], 120, MB50).target, 'local');
  });
});
