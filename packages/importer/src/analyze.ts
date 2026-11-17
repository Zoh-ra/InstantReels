import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { ClassifiedRow } from './classify.ts';
import { HAFS_TOTAL_VERSES, HAFS_VERSE_COUNTS } from './hafs.ts';
import { readWorkbookRows, sha256File } from './workbook.ts';

export interface ParsedWord {
  surah: number;
  verse: number;
  position: number;
  arabic: string;
  french: string;
  arabicSha256: string;
  sourceRow: number;
}

export type Severity = 'error' | 'warning' | 'info';
export interface ImportIssue {
  severity: Severity;
  code: string;
  ref: string | null;
  rowNumber: number | null;
  message: string;
}

export interface WorkbookAnalysis {
  file: { name: string; sha256: string };
  words: ParsedWord[];
  /** verse word counts, keyed "S:V" */
  verses: Map<string, { surah: number; verse: number; wordCount: number }>;
  issues: ImportIssue[];
  stats: {
    rowsRead: number;
    words: number;
    verseSeparators: number;
    verses: number;
    surahs: number;
    maxWordsInVerse: { ref: string; words: number };
    versesOver5Words: number;
    singleWordVerses: number;
    arabicCellsNotNfc: number;
    rubElHizbMarks: number;
    sajdahMarks: number;
    distinctArabicCodePoints: number;
  };
  /** true when no error-level issue exists */
  committable: boolean;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Opening/closing pairs that should balance inside ONE gloss (quotes may legitimately span words). */
const PAIRS: [string, string][] = [['(', ')'], ['[', ']']];

/**
 * Full, read-only analysis of the workbook. Nothing is corrected: anomalies are reported.
 * Arabic is kept byte-for-byte; French is kept as written (surrounding whitespace is reported, not removed).
 */
export async function analyzeWorkbook(path: string, rows?: AsyncIterable<ClassifiedRow>): Promise<WorkbookAnalysis> {
  const issues: ImportIssue[] = [];
  const add = (severity: Severity, code: string, ref: string | null, rowNumber: number | null, message: string) => issues.push({ severity, code, ref, rowNumber, message });
  const words: ParsedWord[] = [];
  const verses = new Map<string, { surah: number; verse: number; wordCount: number }>();
  const seenWords = new Set<string>();
  const separators = new Map<string, number>();
  let rowsRead = 0;
  let last: [number, number, number] = [0, 0, 0];
  let pendingVerse: string | null = null;

  for await (const row of rows ?? readWorkbookRows(path)) {
    rowsRead++;
    if (row.kind === 'header') continue;
    if (row.kind === 'invalid') {
      add('error', 'invalid_row', null, row.rowNumber, row.reason);
      continue;
    }
    if (row.kind === 'word') {
      const { surah, verse, position } = row.ref;
      const ref = `${surah}:${verse}:${position}`;
      const vkey = `${surah}:${verse}`;
      if (seenWords.has(ref)) add('error', 'duplicate_reference', ref, row.rowNumber, `reference ${ref} appears twice`);
      seenWords.add(ref);
      const cmp = surah - last[0] || verse - last[1] || position - last[2];
      if (cmp <= 0) add('error', 'non_monotonic', ref, row.rowNumber, `reference ${ref} after ${last.join(':')}`);
      const expectedPos = (verses.get(vkey)?.wordCount ?? 0) + 1;
      if (position !== expectedPos) add('error', 'word_index_gap', ref, row.rowNumber, `expected word ${expectedPos}, found ${position}`);
      if (pendingVerse && pendingVerse !== vkey) add('error', 'missing_separator', pendingVerse, row.rowNumber, `verse ${pendingVerse} has no separator before ${ref}`);
      pendingVerse = vkey;
      last = [surah, verse, position];
      verses.set(vkey, { surah, verse, wordCount: (verses.get(vkey)?.wordCount ?? 0) + 1 });
      words.push({ surah, verse, position, arabic: row.arabic, french: row.french, arabicSha256: sha256(row.arabic), sourceRow: row.rowNumber });
      for (const w of row.warnings) add('warning', w, ref, row.rowNumber, w === 'french_surrounding_whitespace' ? 'French gloss has leading/trailing whitespace (kept as is)' : 'Arabic has leading/trailing whitespace (kept as is)');
      for (const [o, c] of PAIRS) {
        if (row.french.split(o).length !== row.french.split(c).length) add('warning', 'french_unbalanced_bracket', ref, row.rowNumber, `unbalanced "${o}${c}" in French gloss: «${row.french}»`);
      }
      continue;
    }
    if (row.kind === 'verse_end') {
      const vkey = `${row.surah}:${row.verse}`;
      separators.set(vkey, (separators.get(vkey) ?? 0) + 1);
      if (pendingVerse !== vkey) add('error', 'separator_mismatch', vkey, row.rowNumber, `separator ${vkey} does not follow its verse (last word verse: ${pendingVerse ?? 'none'})`);
      pendingVerse = null;
    }
  }

  // structure vs Hafs numbering
  const bySurah = new Map<number, number[]>();
  for (const v of verses.values()) bySurah.set(v.surah, [...(bySurah.get(v.surah) ?? []), v.verse]);
  HAFS_VERSE_COUNTS.forEach((count, i) => {
    const s = i + 1;
    const got = bySurah.get(s) ?? [];
    if (got.length !== count) add('error', 'surah_verse_count', `${s}`, null, `surah ${s}: ${got.length} verses, expected ${count}`);
    got.forEach((v, j) => {
      if (v !== j + 1) add('error', 'verse_gap', `${s}:${v}`, null, `surah ${s}: verse ${v} at index ${j + 1}`);
    });
  });
  for (const [k, n] of separators) if (n > 1) add('error', 'duplicate_separator', k, null, `separator ${k} appears ${n} times`);
  for (const k of verses.keys()) if (!separators.has(k)) add('error', 'missing_separator', k, null, `verse ${k} has no separator row`);

  // informative facts (no action)
  let notNfc = 0, rub = 0, sajdah = 0;
  const cps = new Set<number>();
  for (const w of words) {
    if (w.arabic.normalize('NFC') !== w.arabic) notNfc++;
    if (w.arabic.includes('۞')) rub++;
    if (w.arabic.includes('۩')) sajdah++;
    for (const ch of w.arabic) cps.add(ch.codePointAt(0)!);
  }
  if (notNfc) add('info', 'arabic_not_nfc', null, null, `${notNfc} Arabic cells are not in Unicode NFC form — stored unchanged by design`);

  let max = { ref: '', words: 0 };
  let over5 = 0, single = 0;
  for (const [k, v] of verses) {
    if (v.wordCount > max.words) max = { ref: k, words: v.wordCount };
    if (v.wordCount > 5) over5++;
    if (v.wordCount === 1) single++;
  }
  if (verses.size !== HAFS_TOTAL_VERSES) add('error', 'total_verses', null, null, `${verses.size} verses, expected ${HAFS_TOTAL_VERSES}`);

  return {
    file: { name: basename(path), sha256: await sha256File(path) },
    words,
    verses,
    issues,
    stats: {
      rowsRead,
      words: words.length,
      verseSeparators: [...separators.values()].reduce((a, b) => a + b, 0),
      verses: verses.size,
      surahs: bySurah.size,
      maxWordsInVerse: max,
      versesOver5Words: over5,
      singleWordVerses: single,
      arabicCellsNotNfc: notNfc,
      rubElHizbMarks: rub,
      sajdahMarks: sajdah,
      distinctArabicCodePoints: cps.size,
    },
    committable: !issues.some((i) => i.severity === 'error'),
  };
}

export function renderReportMarkdown(a: WorkbookAnalysis): string {
  const count = (s: Severity) => a.issues.filter((i) => i.severity === s).length;
  const lines = [
    `# Workbook import report`,
    ``,
    `- File: \`${a.file.name}\``,
    `- SHA-256: \`${a.file.sha256}\``,
    `- Generated: ${new Date().toISOString()}`,
    `- Result: **${a.committable ? 'committable (no blocking error)' : 'NOT committable — fix errors first'}**`,
    ``,
    `## Statistics`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    ...Object.entries(a.stats).map(([k, v]) => `| ${k} | ${typeof v === 'object' ? `${v.ref} (${v.words})` : v} |`),
    ``,
    `## Issues (${count('error')} errors, ${count('warning')} warnings, ${count('info')} info)`,
    ``,
    `Nothing is corrected automatically. Warnings are stored in \`import_validation_issues\` for human review.`,
    ``,
    `| Severity | Code | Ref | Row | Message |`,
    `|---|---|---|---|---|`,
    ...a.issues.map((i) => `| ${i.severity} | ${i.code} | ${i.ref ?? ''} | ${i.rowNumber ?? ''} | ${i.message.replaceAll('|', '\\|')} |`),
    ``,
  ];
  return lines.join('\n');
}
