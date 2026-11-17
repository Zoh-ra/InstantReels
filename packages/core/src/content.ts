/** Read-only Quranic content shapes. Text fields are stored exactly as in the source. */

export interface WordByWordWord {
  position: number;
  /** Arabic word, byte-for-byte from the workbook (QPC Hafs encoding). Never normalize. */
  arabic: string;
  /** French gloss, exactly as in Dr Usama Nonnenmacher's workbook. */
  french: string;
  /** 1-based sheet row in the source workbook (provenance). */
  sourceRow: number;
}

export interface WordByWordVerse {
  verse: number;
  words: WordByWordWord[];
}

export interface WordByWordSurahFixture {
  source: { fileName: string; sha256: string; extractedAt: string };
  surah: number;
  verses: WordByWordVerse[];
}
