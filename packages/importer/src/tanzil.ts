import { createHash } from 'node:crypto';
import { HAFS_VERSE_COUNTS } from './hafs.ts';

/** Tanzil translation ids requested by the owner (D-02). No substitution without approval. */
export const TANZIL_TRANSLATIONS = {
  'fr.hamidullah': { country: 'FR', language: 'fr', name: 'Muhammad Hamidullah', attribution: 'Traduction : Muhammad Hamidullah — source : Tanzil.net' },
  'en.hilali': { country: 'UK', language: 'en', name: 'Muhammad Taqi-ud-Din al-Hilali & Muhammad Muhsin Khan', attribution: 'Translation: Hilali & Khan — source: Tanzil.net' },
  'sv.bernstrom': { country: 'SE', language: 'sv', name: 'Knut Bernström', attribution: 'Översättning: Knut Bernström — källa: Tanzil.net' },
} as const;
export type TanzilTranslationId = keyof typeof TANZIL_TRANSLATIONS;

export interface ParsedTranslation {
  verses: { surah: number; verse: number; text: string; sha256: string }[];
  header: string[];
  problems: string[];
}

/**
 * Parses Tanzil "text with aya numbers" (sura|aya|text). Comment lines (#…) are kept as provenance.
 * Text is stored exactly as distributed (no rewriting); only the line terminator is removed.
 */
export function parseTanzilTranslation(content: string): ParsedTranslation {
  const verses: ParsedTranslation['verses'] = [];
  const header: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of content.replace(/^﻿/, '').split(/\r?\n/).entries()) {
    if (raw.trim() === '') continue;
    if (raw.startsWith('#')) {
      header.push(raw);
      continue;
    }
    const m = /^(\d{1,3})\|(\d{1,3})\|(.*)$/.exec(raw);
    if (!m) {
      problems.push(`line ${i + 1}: unexpected format`);
      continue;
    }
    const surah = Number(m[1]);
    const verse = Number(m[2]);
    const text = m[3]!;
    const key = `${surah}:${verse}`;
    if (seen.has(key)) problems.push(`duplicate ${key}`);
    seen.add(key);
    if (surah < 1 || surah > 114 || verse < 1 || verse > (HAFS_VERSE_COUNTS[surah - 1] ?? 0)) problems.push(`out of range ${key}`);
    if (text.trim() === '') problems.push(`empty text ${key}`);
    verses.push({ surah, verse, text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') });
  }
  HAFS_VERSE_COUNTS.forEach((n, i) => {
    for (let v = 1; v <= n; v++) if (!seen.has(`${i + 1}:${v}`)) problems.push(`missing ${i + 1}:${v}`);
  });
  return { verses, header, problems };
}

export interface SurahMeta {
  index: number;
  ayas: number;
  name: string;
  tname: string;
  ename: string;
  order: number;
}

/** Parses Tanzil quran-data.xml <sura …/> entries (surah names and revelation order). */
export function parseTanzilMetadata(xml: string): SurahMeta[] {
  const out: SurahMeta[] = [];
  for (const m of xml.matchAll(/<sura\s+([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...m[1]!.matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    if (!attrs.index) continue;
    out.push({ index: Number(attrs.index), ayas: Number(attrs.ayas), name: attrs.name ?? '', tname: attrs.tname ?? '', ename: attrs.ename ?? '', order: Number(attrs.order) });
  }
  return out;
}
