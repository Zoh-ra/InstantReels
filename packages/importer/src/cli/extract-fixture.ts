/**
 * Extracts one surah from the word-by-word workbook into a JSON fixture,
 * byte-for-byte (no normalization), with provenance (sheet row numbers + file SHA-256).
 *
 * Usage: npm run fixture:surah1   (reads WBW_XLSX_PATH from .env.local)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { WordByWordSurahFixture } from '@instantreels/core';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { readWorkbookRows, sha256File } from '../workbook.ts';

loadDotEnv();
const surah = Number(process.argv[2] ?? '1');
if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new Error('surah must be 1..114');

const path = requireEnv('WBW_XLSX_PATH');
const fixture: WordByWordSurahFixture = {
  source: { fileName: basename(path), sha256: await sha256File(path), extractedAt: new Date().toISOString() },
  surah,
  verses: [],
};
const issues: string[] = [];
let current: WordByWordSurahFixture['verses'][number] | undefined;

for await (const row of readWorkbookRows(path)) {
  if (row.kind === 'invalid') {
    issues.push(`row ${row.rowNumber}: ${row.reason}`);
    continue;
  }
  if (row.kind === 'word') {
    if (row.ref.surah < surah) continue;
    if (row.ref.surah > surah) break;
    if (!current || current.verse !== row.ref.verse) {
      current = { verse: row.ref.verse, words: [] };
      fixture.verses.push(current);
    }
    if (row.ref.position !== current.words.length + 1) {
      issues.push(`row ${row.rowNumber}: expected position ${current.words.length + 1}, got ${row.ref.position}`);
    }
    current.words.push({ position: row.ref.position, arabic: row.arabic, french: row.french, sourceRow: row.rowNumber });
    for (const w of row.warnings) issues.push(`row ${row.rowNumber}: ${w}`);
  }
  if (row.kind === 'verse_end' && row.surah > surah) break;
}

if (fixture.verses.length === 0) throw new Error(`no words found for surah ${surah}`);
const out = resolve('fixtures', 'quran', `surah-${String(surah).padStart(3, '0')}.wbw.json`);
mkdirSync(resolve('fixtures', 'quran'), { recursive: true });
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
const words = fixture.verses.reduce((n, v) => n + v.words.length, 0);
console.log(`surah ${surah}: ${fixture.verses.length} verses, ${words} words -> ${out}`);
console.log(issues.length ? `issues:\n  ${issues.join('\n  ')}` : 'issues: none');
