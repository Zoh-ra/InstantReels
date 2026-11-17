/**
 * Quranic presentation rules. These never alter source text; they only decide which
 * separate rendering elements (Bismillah intro, verse markers, verse numbers) appear.
 */

export const SURAH_AT_TAWBAH = 9;
export const SURAH_AL_FATIHAH = 1;

export type BismillahIntroPolicy =
  | { allowed: false; defaultEnabled: false; reason: 'at_tawbah' }
  | { allowed: true; defaultEnabled: true; reason: 'fatihah_verse_1_is_bismillah' | 'standard' };

/**
 * - Surah 9 (At-Tawbah): no Bismillah intro, ever.
 * - Surah 1 (Al-Fatihah): the Bismillah IS verse 1:1 in the source data. The intro is a separate
 *   decorative element; it never replaces, renumbers or removes 1:1 from the word-by-word data.
 * - Other surahs: intro enabled by default.
 */
export function bismillahIntroPolicy(surah: number): BismillahIntroPolicy {
  assertSurah(surah);
  if (surah === SURAH_AT_TAWBAH) return { allowed: false, defaultEnabled: false, reason: 'at_tawbah' };
  if (surah === SURAH_AL_FATIHAH) return { allowed: true, defaultEnabled: true, reason: 'fatihah_verse_1_is_bismillah' };
  return { allowed: true, defaultEnabled: true, reason: 'standard' };
}

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

/** 7 → "٧", 286 → "٢٨٦" (Eastern Arabic digits, U+0660–U+0669). */
export function toArabicIndicDigits(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid number ${n}`);
  return String(n).replace(/\d/g, (d) => ARABIC_INDIC[Number(d)] as string);
}

/** Three-digit code selecting a ligature in the Quran Foundation Surah Names font. */
export function surahNameCode(surah: number): string {
  assertSurah(surah);
  return String(surah).padStart(3, '0');
}

/** A scene ends its verse only if it contains the verse's final word. */
export function sceneEndsVerse(toPosition: number, verseWordCount: number): boolean {
  if (toPosition > verseWordCount) throw new Error(`position ${toPosition} exceeds verse length ${verseWordCount}`);
  return toPosition === verseWordCount;
}

function assertSurah(surah: number): void {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new Error(`invalid surah ${surah}`);
}
