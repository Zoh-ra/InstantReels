import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { classifyRow } from './classify.ts';

const row = (rowNumber: number, a: string | number | null, b: string | null, c: string | null, d: string | number | null, e: string | null) => ({ rowNumber, a, b, c, d, e });

describe('classifyRow', () => {
  it('recognises the header', () => {
    assert.equal(classifyRow(row(1, '  ', 'S:V:M', 'S:V', 'Coran', 'Français')).kind, 'header');
  });
  it('keeps Arabic byte-for-byte, including marks and attached ۞ / ۩ (no NFC)', () => {
    const arabic = '۞إِنَّ'; // 2:26:1 from the workbook
    const nonNfc = 'ٱلرَّحۡمَٰنِ'; // ٱلرَّحۡمَٰنِ as in the workbook: shadda before fatha (not NFC order)
    for (const ar of [arabic, nonNfc, 'يَسۡجُدُونَۤ۩']) {
      const r = classifyRow(row(2, 1, '2:26:1', null, ar, 'Certes,'));
      assert.equal(r.kind, 'word');
      if (r.kind === 'word') assert.equal(Buffer.compare(Buffer.from(r.arabic), Buffer.from(ar)), 0);
    }
    assert.notEqual(nonNfc.normalize('NFC'), nonNfc, 'fixture must be a non-NFC string');
  });
  it('parses word references and keeps French as-is, warning on surrounding whitespace', () => {
    const r = classifyRow(row(39187, 39186, '17:79:1', null, 'وَمِنَ', 'Et parmi '));
    assert.equal(r.kind, 'word');
    if (r.kind === 'word') {
      assert.deepEqual(r.ref, { surah: 17, verse: 79, position: 1 });
      assert.equal(r.french, 'Et parmi ');
      assert.deepEqual(r.warnings, ['french_surrounding_whitespace']);
    }
  });
  it('recognises verse separators with numeric or text D', () => {
    assert.equal(classifyRow(row(6, 5, null, '1:1', '1', null)).kind, 'verse_end');
    assert.equal(classifyRow(row(83656, 83655, null, '114:4', 4, null)).kind, 'verse_end');
  });
  it('flags malformed, inconsistent and incomplete rows instead of dropping them', () => {
    assert.equal(classifyRow(row(9, 8, '1:2', null, 'x', 'y')).kind, 'invalid');
    assert.equal(classifyRow(row(9, 8, '115:1:1', null, 'x', 'y')).kind, 'invalid');
    assert.equal(classifyRow(row(9, 8, null, '1:2', '3', null)).kind, 'invalid');
    assert.equal(classifyRow(row(9, 8, '1:2:1', null, 'ٱلۡحَمۡدُ', '  ')).kind, 'invalid');
    assert.equal(classifyRow(row(9, 8, '1:2:1', '1:2', 'x', 'y')).kind, 'invalid');
  });
  it('treats fully empty rows as blank', () => {
    assert.equal(classifyRow(row(90000, null, null, null, null, null)).kind, 'blank');
  });
});
