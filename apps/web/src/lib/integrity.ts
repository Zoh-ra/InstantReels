import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RenderDocument } from '@instantreels/core';
import { loadFullVerses, loadWordVerses } from './content';

/**
 * Server-side guarantee that the Quranic text inside a document is a verbatim copy of the
 * database (workbook words/glosses, configured verse translation). Any edit of the text —
 * accidental or malicious — is rejected before saving or rendering.
 */
export async function verifyDocumentText(sb: SupabaseClient, doc: RenderDocument): Promise<string[]> {
  const problems: string[] = [];
  const verses = new Set<number>();
  for (const s of doc.scenes) {
    if (s.kind === 'word_boxes') verses.add(s.ref.verse);
    if (s.kind === 'full_verse') for (const it of s.items) verses.add(it.verse);
  }
  if (verses.size === 0) return ['the document contains no verse'];
  const list = [...verses].sort((a, b) => a - b);

  if (doc.mode === 'word_by_word') {
    const db = new Map((await loadWordVerses(sb, doc.surah, list)).map((v) => [v.verse, v]));
    for (const s of doc.scenes) {
      if (s.kind !== 'word_boxes') continue;
      const v = db.get(s.ref.verse)!;
      if (s.ref.verseWordCount !== v.words.length) problems.push(`${doc.surah}:${s.ref.verse}: word count differs from the source`);
      for (const w of s.words) {
        const src = v.words[w.position - 1];
        if (!src || src.arabic !== w.arabic || src.french !== w.french) problems.push(`${doc.surah}:${s.ref.verse}:${w.position}: text differs from the source`);
      }
    }
  } else {
    const { verses: db } = await loadFullVerses(sb, doc.surah, list, doc.country);
    const map = new Map(db.map((v) => [v.verse, v]));
    for (const s of doc.scenes) {
      if (s.kind !== 'full_verse') continue;
      for (const it of s.items) {
        const v = map.get(it.verse)!;
        const arabic = v.words.slice(it.fromPosition - 1, it.toPosition).map((w) => w.arabic).join(' ');
        if (it.verseWordCount !== v.words.length) problems.push(`${doc.surah}:${it.verse}: word count differs from the source`);
        if (it.arabic !== arabic) problems.push(`${doc.surah}:${it.verse} (${it.fromPosition}-${it.toPosition}): Arabic differs from the source`);
        if (it.translation !== v.translation) problems.push(`${doc.surah}:${it.verse}: translation differs from the source`);
      }
    }
  }
  return problems;
}
