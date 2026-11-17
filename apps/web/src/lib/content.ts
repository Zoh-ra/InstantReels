import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CountryCode, FullVerseSource, WordByWordVerse } from '@instantreels/core';

export interface SurahSummary {
  id: number;
  verseCount: number;
  nameArabic: string | null;
  nameTransliterated: string | null;
  nameEnglish: string | null;
}

export async function listSurahs(sb: SupabaseClient): Promise<SurahSummary[]> {
  const { data, error } = await sb.from('surahs').select('id, verse_count, name_arabic, name_transliterated, name_english').order('id');
  if (error) throw new Error(`cannot load surahs: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, verseCount: r.verse_count, nameArabic: r.name_arabic, nameTransliterated: r.name_transliterated, nameEnglish: r.name_english }));
}

/** PostgREST caps rows per request: page through large selections. */
async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await query(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

/** Words of the selected verses with the workbook French glosses, verbatim, ordered. */
export async function loadWordVerses(sb: SupabaseClient, surah: number, verses: readonly number[]): Promise<WordByWordVerse[]> {
  const rows = await fetchAll<{ verse_number: number; position: number; text_arabic: string; source_row: number; word_translations: { text: string }[] }>((from, to) =>
    sb.from('quran_words')
      .select('verse_number, position, text_arabic, source_row, word_translations(text)')
      .eq('surah_id', surah)
      .in('verse_number', verses as number[])
      .order('verse_number')
      .order('position')
      .range(from, to),
  );
  const byVerse = new Map<number, WordByWordVerse>();
  for (const r of rows) {
    const french = r.word_translations[0]?.text;
    if (french === undefined) throw new Error(`missing gloss for ${surah}:${r.verse_number}:${r.position}`);
    const v = byVerse.get(r.verse_number) ?? { verse: r.verse_number, words: [] };
    v.words.push({ position: r.position, arabic: r.text_arabic, french, sourceRow: r.source_row });
    byVerse.set(r.verse_number, v);
  }
  return verses.map((n) => {
    const v = byVerse.get(n);
    if (!v) throw new Error(`verse ${surah}:${n} not found`);
    return v;
  });
}

export interface TranslationSource {
  id: number;
  name: string;
  attribution: string | null;
  licenseNotes: string | null;
}

export async function countryTranslation(sb: SupabaseClient, country: CountryCode): Promise<TranslationSource | null> {
  const { data, error } = await sb.from('country_profiles').select('translation_source_id, content_sources(id, name, attribution_text, license_notes)').eq('code', country).single();
  if (error) throw new Error(error.message);
  const src = (data as unknown as { content_sources: { id: number; name: string; attribution_text: string | null; license_notes: string | null } | null }).content_sources;
  return src ? { id: src.id, name: src.name, attribution: src.attribution_text, licenseNotes: src.license_notes } : null;
}

/** Arabic words + complete verse translation for Mode B. */
export async function loadFullVerses(sb: SupabaseClient, surah: number, verses: readonly number[], country: CountryCode): Promise<{ verses: FullVerseSource[]; source: TranslationSource }> {
  const source = await countryTranslation(sb, country);
  if (!source) throw new Error(`no full-verse translation configured for ${country}`);
  const words = await loadWordVerses(sb, surah, verses);
  const tr = await fetchAll<{ verse_number: number; text: string }>((from, to) =>
    sb.from('verse_translations').select('verse_number, text').eq('surah_id', surah).eq('source_id', source.id).in('verse_number', verses as number[]).range(from, to),
  );
  const map = new Map(tr.map((t) => [t.verse_number, t.text]));
  return {
    source,
    verses: words.map((v) => {
      const translation = map.get(v.verse);
      if (!translation) throw new Error(`missing translation for ${surah}:${v.verse}`);
      return { verse: v.verse, words: v.words.map((w) => ({ position: w.position, arabic: w.arabic })), translation };
    }),
  };
}
