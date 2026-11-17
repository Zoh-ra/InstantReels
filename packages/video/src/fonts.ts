/** Font families used by reel compositions. */
export const FONT_FAMILIES = {
  /** KFGQPC HAFS Uthmanic Script v0.18 — Quranic text and the verse-end ornament */
  quran: 'KFGQPC HAFS',
  french: 'Poppins SemiBold',
  label: 'Amiri',
  /** Quran Foundation "sura_names" v1.1 — ligature per 3-digit code (loaded from the QF CDN) */
  surahNames: 'QF Surah Names',
} as const;

/** Local font files in /assets/fonts (unmodified). The Surah Names font is fetched at render time. */
export const FONT_FILES = {
  quran: 'UthmanicHafs1Ver18.ttf',
  french: 'Poppins-SemiBold.ttf',
  label: 'Amiri-Regular.ttf',
} as const;

export const SURAH_NAMES_FONT_URL = 'https://verses.quran.foundation/fonts/quran/surah-names/v1/sura_names.woff2';

export type FontSources = Record<keyof typeof FONT_FAMILIES, string>;

export function fontFaceCss(sources: FontSources): string {
  return (Object.keys(FONT_FAMILIES) as (keyof typeof FONT_FAMILIES)[])
    .map((k) => `@font-face{font-family:'${FONT_FAMILIES[k]}';src:url('${sources[k]}');font-display:block;}`)
    .join('\n');
}
