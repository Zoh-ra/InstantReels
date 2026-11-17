# Excel Word-by-Word Import

Status: **Phase 0 — analysis complete, importer not yet implemented** (planned for Phase 2).

## 1. Source workbook

| Property | Value |
|---|---|
| File | `Traduction mot a mot du Coran - Dr Usama Nonnenmacher (1).xlsx` |
| Size | 3,934,855 bytes (zip); `sheet1.xml` 35.7 MB + `sharedStrings.xml` 15.4 MB uncompressed |
| Producer | LibreOffice 26.2 (Linux), creator "Lion", created 2024-04-08, modified 2026-08-05, revision 852 |
| Sheets | 1 — `Feuille1` |
| Declared dimension | `A1:AMD1048576` (formatting bleeds over ~1,000 columns × 1M rows) |
| Real data range | `A1:E83666` (matches the `_xlnm._FilterDatabase` defined name) |
| Column F and beyond | empty (0 non-empty cells) |
| Drawings | `drawing1.xml`: 2 stray 1×1 px rectangle shapes anchored at D35563 — artifacts, ignore |

The importer **must** stream rows and read only columns A–E, stopping after the last meaningful row. Loading the declared dimension naively would allocate ~1 billion cells.

## 2. Row structure (verified over the entire file, not only the first rows)

Header row 1: `A=" "`, `B="S:V:M"`, `C="S:V"`, `D="Coran"`, `E="Français"`.

Two row kinds, strictly alternating per verse:

| Kind | A | B | C | D | E |
|---|---|---|---|---|---|
| **Word** | running int | `S:V:W` | empty | Arabic word | French gloss |
| **Verse separator** | running int | empty | `S:V` | verse number (int ×6146, string ×90) | empty |

Example:

```
2  1  1:1:1   ·     بِسۡمِ          (Je lis) avec (Le) Nom
...
6  5  ·       1:1   1               ·
```

Rules confirmed by the analysis script:

- Column A is a contiguous counter 1…83665 (no gaps).
- Every separator immediately follows the last word of its verse (0 exceptions).
- Separator D value always equals the verse number of C (0 mismatches) — but its cell type varies (int/string), so compare as strings.

## 3. Integrity results

| Check | Result |
|---|---|
| Word rows | **77,429** |
| Verse separators | **6,236** |
| Distinct verses with words | 6,236 |
| Surahs | 114, verse counts identical to the standard Hafs count for all 114 |
| Malformed references | 0 |
| Duplicate `S:V:W` | 0 |
| Word-index gaps / disorder | 0 |
| Non-monotonic references | 0 |
| Words missing Arabic / French | 0 / 0 |
| Arabic cells containing spaces or ASCII | 0 / 0 |
| Max words per verse | 128 (2:282) |
| Verses with > 5 words | 4,681 (→ pagination is the common case) |
| One-word verses | 28 |

### 3.1 Arabic encoding

71 distinct code points. The text is in the **KFGQPC "QPC Hafs" encoding**, verified by comparing Surah 2 with Quran.com `text_qpc_hafs`: 263/286 verses byte-identical.

Notable code points that must be preserved exactly:

- `U+06E1` small high dotless head of khah (sukun form) ×37,148
- `U+0657`, `U+065E`, `U+0656` used by the QPC encoding for open/consecutive tanween forms (e.g. `هُدٗى`, `بَرَآءَةٞ`)
- `U+06DE` Rub el Hizb `۞` **attached to the first word** of 199 verses (e.g. `2:26:1 = ۞إِنَّ`)
- `U+06E9` Sajdah `۩` attached to the last word of 15 verses
- `U+0640` tatweel ×535 (e.g. `يَٰٓـَٔادَمُ`), `U+06EA`, `U+06EC`, `U+06E8`, `U+0655` rare marks
- Pause marks `U+06D6`, `U+06D7`, `U+06DA`, … attached to words

**23,870 Arabic cells change under Unicode NFC normalization** (combining-mark reordering). The importer must **never normalize** Arabic; store the raw string and a SHA-256 of it.

Font consequence: QPC-encoded text is designed for the *KFGQPC HAFS Uthmanic Script* font. The rendering comparison (`TYPOGRAPHY.md`) confirmed that Scheherazade New, Amiri Quran and Traditional Arabic misrender these marks; KFGQPC v0.18 is the chosen font (D-04).

### 3.2 Discrepancies vs. QPC Hafs reference (Surah 2 sample)

Besides the 19 verses where Quran.com separates `۞` with a space (formatting difference only), four verses in Surah 2 differ in actual characters:

| Ref | Workbook | QPC Hafs (Quran.com) | Nature |
|---|---|---|---|
| 2:91 | `بِمَآ` (with `U+0653` maddah) | `بِمَا` | maddah |
| 2:128 | `لَكَ` | `لَّكَ` | missing shadda in workbook |
| 2:144 | `وَجۡهِكَ` (kasra) | `وَجۡهَكَ` (fatha) | different vowel |
| 2:181 | `بَعۡدَمَا` (1 word) | `بَعۡدَ مَا` (2 words) | word segmentation |

These are **not auto-corrected**. Per the owner's decision D-07, the workbook is the sole source of the word-by-word data (Arabic and French); external references are used only to raise flags, and French glosses are never compared against or replaced by any other translation. Phase 2 will run a full 114-surah cross-check against an authoritative QPC Hafs source and produce a review queue (`import_validation_issues`). Corrections happen only through an audited, human-approved process.

### 3.3 French column anomalies

| Ref | Value | Issue |
|---|---|---|
| 59:15:9 | `et (il y a pour eux` | unclosed parenthesis |
| 76:18:4 | `Salsabîl (=qui cou(e intensément).` | probable typo (`cou(e` → `coule`?) |
| 17:79:1, 25:18:12, 28:43:10, 29:41:7 | trailing space / NBSP | whitespace |
| — | 5,964 `U+00A0` NBSP | French typographic spacing before `? ! : »` — **keep** (renders correctly) |
| — | `« »` and `“ ”` open in one word and close in a later word | expected for multi-word quotations, not an error |
| 89:22:4–5 | `صَفّٗا صَفّٗا` repeated | legitimate Quranic repetition — proves words must never be deduplicated by text |

Basmala: only 1:1 contains it as a verse (standard Hafs numbering). An optional basmala for other surahs requires a separate, explicit source.

## 4. Importer design (Phase 2)

1. Upload workbook (server-side only, admin role). Compute SHA-256 of file → `import_batches.source_sha256`. Re-importing an identical file is a no-op.
2. Stream parse with **ExcelJS `WorkbookReader`** (streaming), only columns 1–5, stop at the first run of N empty rows after the filter range.
3. Classify each row (word / separator / header / blank / unclassified). Unclassified rows → error, never silently dropped.
4. Validate with Zod + structural checks (§3) and the reference cross-check.
5. Write to staging tables `import_staging_words` inside the batch; produce a **preview report** (counts, anomalies, diffs vs. current data).
6. On admin confirmation: single transaction `INSERT … ON CONFLICT (surah, verse, word_position) DO UPDATE` only where `text_sha256` differs, recording every change in `content_revisions`. Failure → rollback, batch status `failed`.
7. Keep provenance: batch id, file name, hash, row number for every word.

Trimming: only leading/trailing ASCII whitespace of the French gloss is trimmed (and logged as a warning); Arabic is stored byte-for-byte.

## 5. Reproducing the analysis

The Phase 0 analysis used throwaway Python scripts (openpyxl read-only streaming, ~15 s). The production importer will be TypeScript with automated tests asserting the numbers above.
