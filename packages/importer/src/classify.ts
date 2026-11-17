/**
 * Pure classification of one workbook row (columns A–E).
 * Arabic text is NEVER trimmed, normalized or otherwise altered.
 * See docs/EXCEL_IMPORT.md for the verified structure.
 */

export type CellValue = string | number | null;

export interface RawRow {
  /** 1-based sheet row number (provenance). */
  rowNumber: number;
  a: CellValue;
  b: CellValue;
  c: CellValue;
  d: CellValue;
  e: CellValue;
}

export interface WordRef {
  surah: number;
  verse: number;
  position: number;
}

export type ClassifiedRow =
  | { kind: 'header'; rowNumber: number }
  | { kind: 'blank'; rowNumber: number }
  | {
      kind: 'word';
      rowNumber: number;
      ref: WordRef;
      arabic: string;
      french: string;
      warnings: string[];
    }
  | { kind: 'verse_end'; rowNumber: number; surah: number; verse: number }
  | { kind: 'invalid'; rowNumber: number; reason: string; raw: RawRow };

const WORD_REF = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/;
const VERSE_REF = /^(\d{1,3}):(\d{1,3})$/;

function asText(v: CellValue): string {
  if (v === null) return '';
  return typeof v === 'number' ? String(v) : v;
}

function isEmpty(v: CellValue): boolean {
  return asText(v).trim() === '';
}

export function classifyRow(raw: RawRow): ClassifiedRow {
  const { rowNumber } = raw;
  const b = asText(raw.b).trim();
  const c = asText(raw.c).trim();

  if (b === 'S:V:M' && c === 'S:V') return { kind: 'header', rowNumber };
  if ([raw.a, raw.b, raw.c, raw.d, raw.e].every(isEmpty)) return { kind: 'blank', rowNumber };

  if (b !== '' && c === '') {
    const m = WORD_REF.exec(b);
    if (!m) return { kind: 'invalid', rowNumber, reason: `malformed word reference "${b}"`, raw };
    const ref: WordRef = { surah: Number(m[1]), verse: Number(m[2]), position: Number(m[3]) };
    if (ref.surah < 1 || ref.surah > 114 || ref.verse < 1 || ref.position < 1) {
      return { kind: 'invalid', rowNumber, reason: `reference out of range "${b}"`, raw };
    }
    if (typeof raw.d !== 'string' || raw.d.length === 0) {
      return { kind: 'invalid', rowNumber, reason: `missing Arabic text for ${b}`, raw };
    }
    if (typeof raw.e !== 'string' || raw.e.trim() === '') {
      return { kind: 'invalid', rowNumber, reason: `missing French text for ${b}`, raw };
    }
    const warnings: string[] = [];
    if (raw.d !== raw.d.trim()) warnings.push('arabic_surrounding_whitespace');
    if (raw.e !== raw.e.trim()) warnings.push('french_surrounding_whitespace');
    return { kind: 'word', rowNumber, ref, arabic: raw.d, french: raw.e, warnings };
  }

  if (c !== '' && b === '') {
    const m = VERSE_REF.exec(c);
    if (!m) return { kind: 'invalid', rowNumber, reason: `malformed verse reference "${c}"`, raw };
    const surah = Number(m[1]);
    const verse = Number(m[2]);
    if (asText(raw.d).trim() !== String(verse)) {
      return { kind: 'invalid', rowNumber, reason: `separator D "${asText(raw.d)}" != verse ${verse}`, raw };
    }
    return { kind: 'verse_end', rowNumber, surah, verse };
  }

  return { kind: 'invalid', rowNumber, reason: 'row is neither a word nor a verse separator', raw };
}
