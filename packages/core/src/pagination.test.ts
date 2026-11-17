import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { paginate, suggestPageSizes, validatePageSizes } from './pagination.ts';

const words = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('suggestPageSizes', () => {
  it('handles 1, 4, 5, 7, 9, 11 and 128 words', () => {
    assert.deepEqual(suggestPageSizes(1), [1]);
    assert.deepEqual(suggestPageSizes(4), [4]);
    assert.deepEqual(suggestPageSizes(5), [5]);
    assert.deepEqual(suggestPageSizes(7), [4, 3]);
    assert.deepEqual(suggestPageSizes(9), [5, 4]);
    assert.deepEqual(suggestPageSizes(11), [4, 4, 3]);
    const long = suggestPageSizes(128); // 2:282
    assert.equal(long.reduce((a, b) => a + b, 0), 128);
    assert.ok(long.every((s) => s >= 4 && s <= 5));
  });
  it('respects a configured maximum', () => {
    assert.deepEqual(suggestPageSizes(7, 3), [3, 2, 2]);
  });
});

describe('manual layouts', () => {
  it('accepts 5+2 and 3+4 for a 7-word verse', () => {
    assert.deepEqual(paginate(words(7), [5, 2]), [[1, 2, 3, 4, 5], [6, 7]]);
    assert.deepEqual(paginate(words(7), [3, 4]), [[1, 2, 3], [4, 5, 6, 7]]);
  });
  it('rejects omissions, duplications, empty and oversized pages', () => {
    assert.equal(validatePageSizes([4, 2], 7)[0]?.code, 'sum_mismatch');
    assert.equal(validatePageSizes([5, 3], 7)[0]?.code, 'sum_mismatch');
    assert.ok(validatePageSizes([7, 0], 7).some((e) => e.code === 'empty_page'));
    assert.ok(validatePageSizes([6, 1], 7).some((e) => e.code === 'page_too_large'));
    assert.throws(() => paginate(words(7), [6, 1]));
  });
  it('preserves order without duplicates for every split of 1..20 words', () => {
    for (let n = 1; n <= 20; n++) {
      const flat = paginate(words(n), suggestPageSizes(n)).flat();
      assert.deepEqual(flat, words(n));
    }
  });
});
