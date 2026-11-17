# Quranic Typography — Font Comparison

Date: 2026-11-16. Status: **Recommendation made (D-04)**, visual validation by a qualified reader requested.

## 1. Method

- 15 workbook words chosen to cover the hard cases (open tanween `U+0657/U+065E`, `۞`, `۩`, tatweel + hamza, `U+06EA`, `U+06EC`, `U+06E8`, `U+0655`, small high marks, shadda + kasra), plus verse 2:2 joined from workbook words.
- Strings taken **byte-for-byte from the workbook** (no retyping).
- Rendered in headless **Chrome** (Chromium + HarfBuzz — the same shaping engine used by any headless-browser render pipeline, including Remotion's Chrome Headless Shell), 64 px, fonts loaded via `@font-face` from local files (no system fallback).
- Glyph coverage checked with fontTools against all 71 code points used in the workbook.

## 2. Candidates

| Font | Version | Licence | Coverage of 71 code points |
|---|---|---|---|
| KFGQPC HAFS Uthmanic Script | 0.18 (as used by Quran.com) | KFGQPC EULA: free to use, copy, distribute; **no selling, no modification** | 71/71 |
| KFGQPC Uthmanic Script HAFS | 0.09 | same | 71/71 |
| Scheherazade New | 4.500 | SIL OFL 1.1 | 71/71 |
| Amiri Quran | 1.003 | SIL OFL 1.1 | 70/71 (missing `U+065E`) |
| Noto Naskh Arabic | 2.021 | SIL OFL 1.1 | 71/71 |
| Traditional Arabic | 6.85 | Microsoft, Windows-only, **not redistributable** | 70/71 (missing `U+065E`) |

Images: `docs/assets/font-comparison/1-kfgqpc-hafs-v18.png` … `5-traditional-arabic.png`.

## 3. Findings

The workbook is encoded in the **QPC Hafs** scheme, where `U+0657`, `U+065E`, `U+0656` are repurposed for the Mushaf's open/sequential tanween. Only the KFGQPC font interprets them that way.

| Word | KFGQPC v18 | Scheherazade New | Amiri Quran | Traditional Arabic |
|---|---|---|---|---|
| 2:2 `هُدٗى` | correct open tanween | shows inverted damma glyph (wrong) | wrong mark | wrong mark |
| 9:1:1 `بَرَآءَةٞ` | correct | fatha-with-two-dots glyph (wrong) | wrong | wrong |
| 24:11:16 `ٱمۡرِيٕٖ` | correct | hamza below misplaced, tanween wrong | collides with text below | hamza detached |
| 2:33:2 `يَٰٓـَٔادَمُ` | correct tatweel + hamza seat | hamza seat lost | broken stacking | seat lost |
| 2:31:10 `أَنۢبِـُٔونِي` | correct | marks stacked incorrectly | marks misplaced | marks misplaced |
| `۞`, `۩` | rendered, aligned | rendered (decorative) | rendered (oversized) | rendered |

Amiri Quran also places many fathas below the baseline with this encoding — unusable here.

## 4. Recommendation

1. **Quranic Arabic (both modes): KFGQPC HAFS Uthmanic Script v0.18**, shipped **unmodified** as the original `.ttf` (no subsetting, no conversion to WOFF2, which could count as "modification" under the EULA). Same file used by the browser preview and the server renderer.
2. **Fallback for non-Quranic Arabic UI text** (Surah names, labels): Scheherazade New (OFL).
3. Mode B Arabic must use the **same QPC Hafs encoding** so that one font serves both modes (see D-03).
4. Institutional label: Amiri (OFL). French/Latin: Poppins SemiBold (OFL). Display: Space Grotesk (OFL).
5. Traditional Arabic is excluded (cannot be bundled on a Linux render server).

Licence caveat: the EULA forbids reproduction "in no means" in clause 1 while granting copy/distribute rights above it — contradictory wording. Rendering text with the font into a video is ordinary *use*. Low risk, but a short confirmation e-mail to KFGQPC is advisable before public launch.

## 5. Still to validate

- A qualified reader confirms the KFGQPC screenshots (open tanween, small marks) before Phase 3.
- Re-run this comparison inside the final render pipeline at 2160×3840.
- iOS Safari preview uses CoreText instead of HarfBuzz: check on a real iPhone (manual test).
