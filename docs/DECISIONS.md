# Decisions

Status values: **Decided** (owner approved) · **Recommended** (awaiting owner choice) · **Open** (blocked on an external party).
Owner clarifications received 2026-11-16 are recorded below.

## D-01 Remotion licence — Decided (conditional)
Owner develops InstantReels **individually** → qualifies for Remotion's Free License (individuals and organisations of up to 3 people, unlimited commercial use).
Conditions that would change if the app is transferred to / operated by an organisation:
- For-profit organisation with ≥ 4 people → Company License. For a product where users render videos, that is "Remotion for Automators": $0.01 per render, billed in blocks of $10, **minimum $100/month**. Enterprise from $500/month.
- Non-profit organisations qualify for the Free License regardless of size, **except** government, **educational**, commercial-subsidiary and trade bodies, which need **written permission from Remotion**. An Al-Huda school/institute would fall into the educational case.
- Remotion 5.0 announces mandatory telemetry for Automators.
- Codec patents (H.264/AAC) are not covered by any Remotion licence (same for every engine).
Because the owner wants to avoid recurring licence costs, an open-source engine was compared (see D-06).

## D-02 Full-verse translations — Recommended
Translators fixed by the owner, **no substitution without approval**:

| Profile | Translator | Tanzil id | Quran Foundation id |
|---|---|---|---|
| FR | Muhammad Hamidullah | `fr.hamidullah` | 31 |
| UK | Muhammad Taqi-ud-Din al-Hilali & Muhammad Muhsin Khan | `en.hilali` | 203 |
| SE | Knut Bernström | `sv.bernstrom` | 48 |

Source comparison:

| | Tanzil.net | Quran Foundation API |
|---|---|---|
| Storage | downloadable files, may be stored | max 1 week cache outside Content Sync |
| Terms | translations "for non-commercial purposes only"; otherwise permission from translator/publisher; link back to tanzil.net/trans if > 3 translations used | social-media videos allowed with QF credit; no statement on publisher copyrights |
| Access | static files, no API key | OAuth2 client credentials, rate limits |

Recommendation: **Tanzil files as the primary store** (imported once, versioned, SHA-256, attribution kept), used only for non-commercial educational reels; QF API as an optional cross-check. Every video credits the translator and the source. Publisher permission is still needed for any commercial use (Open item B-03).
Hamidullah text from QF contains `<sup foot_note=…>` markers; Tanzil text to be inspected for the same at import.

## D-03 Arabic text source for Mode B — Recommended
Must be in the **QPC Hafs encoding** to share the KFGQPC font with Mode A (D-04). Options: KFGQPC's own published Hafs text, or QF `text_qpc_hafs` (1-week cache limit). Tanzil Uthmani (CC BY 3.0, verbatim, attribution + link required, version 1.1 / 2021) is legally simplest but uses a different encoding designed for the me_quran font; it needs its own rendering test before it can be used with KFGQPC. Decision after the Phase 2 source spike.

## D-04 Quranic Arabic font — Decided by delegation
Owner delegated the choice. Rendering comparison in `TYPOGRAPHY.md`: **KFGQPC HAFS Uthmanic Script v0.18** is the only tested font that renders the workbook's QPC Hafs encoding correctly (open tanween, tatweel-hamza, small marks). Scheherazade New, Amiri Quran and Traditional Arabic render several marks incorrectly. Font shipped unmodified. Visual confirmation by a qualified reader requested.

## D-05 Other fonts — Decided
Space Grotesk (display), Poppins SemiBold (French/UI), Amiri (institutional label), Scheherazade New (non-Quranic Arabic UI). All SIL OFL, bundled locally. Obviously (commercial) and Traditional Arabic (not redistributable) not used.

## D-06 Rendering engine — Decided (2026-11-16), prototype validated
Owner approved the open-source Playwright + FFmpeg pipeline as a proof of concept. The 4K prototype passed all automated checks (`POC_RENDERING.md`): ~1 min 47 s for an 18 s 4K reel on a laptop. Recommendation after the prototype: keep it; Remotion stays a fallback behind the `RenderEngine` boundary.

## D-07 Word-by-word data integrity — Decided
- The French word-by-word translation comes **exclusively** from Dr Usama Nonnenmacher's workbook. It is never replaced, reconstructed or generated from Tanzil, Quran.com, any API or AI.
- The workbook is imported intact (Arabic byte-for-byte, French with only logged trimming of surrounding whitespace).
- External sources are used **only to flag** Arabic discrepancies (e.g. 2:91, 2:128, 2:144, 2:181). Flags go to a review queue; nothing is auto-corrected.
- Enforced in the schema: `word_translations` accepts only the workbook source.

## D-08 Quranic symbols — Decided
`۞` (Rub el Hizb) and `۩` (Sajdah) are preserved and displayed, attached to their word exactly as in the source; the KFGQPC font positions them. Pagination never separates a symbol from its word.

## D-09 QR codes — Decided
Initial implementation uses the supplied France QR image (payload `https://qr.codes/FGWXbJ`, ECC H). The `qr_assets` model supports two kinds: uploaded image or QR **generated from a target URL** (open-source generator, ECC H, ≥ 4-module quiet zone). Replacing a dynamic link with a permanent URL = changing one record; existing projects reference the country profile, not the image. UK/SE remain placeholders until real assets are supplied.

## D-12 Node.js version — Open (recommend Node 22 LTS)
Local Node is 20.11.1: Next.js 16 works (≥ 20.9) but Vitest 5 / Vite 8 need Node ≥ 22.12, and **Tailwind ≥ 4.3.4 needs `require(esm)` (Node ≥ 20.19)**. Workarounds in place: tests use `node:test` + tsx; Tailwind is pinned to **4.3.3**. After upgrading to Node 22 LTS: move to Tailwind 4.3.5+ and Vitest.

## D-13 Dependency advisory — Accepted
`npm audit` reports a moderate advisory in `uuid < 11` via `exceljs@4.4.0` (buffer bounds in `v3/v5/v6`). exceljs only calls `uuid.v4`, so the vulnerable path is not used. Re-check on each exceljs release.

## D-14 Bismillah introduction asset — Implemented, licence OPEN
Owner-supplied calligraphy (`assets/branding/bismillah/source/bismillah-owner-supplied.jpg`, 736×654 JPEG with a baked-in checkerboard) is converted to `bismillah.svg` by `npm run asset:bismillah`: checkerboard removed by thresholding, outline traced with potrace (deterministic, no AI, shapes not redrawn), fill = `currentColor` for theming. Fidelity vs the source mask: **IoU 0.971**. Provenance and rights of the image are unknown (the baked checkerboard suggests a stock "PNG" site): **not for publication until the owner confirms rights or supplies the original high-resolution/vector file**; re-run the script on the new file.

## D-15 Surah title calligraphy — Implemented
Quran Foundation **Surah Names font** `sura_names` v1.1: ligatures for all **114/114** three-digit codes verified with Playwright (`docs/assets/font-comparison/6-…png`), plus a "surah" ligature (سورة). Licence (QF font-rendering guide + Developer Terms): runtime CDN loading allowed; bundling/caching requires an active QF Developer Console account and the credit "Quran fonts provided by Quran Foundation"; files must not be redistributed standalone. Current implementation: fetched from the CDN at render time, kept in memory only, never committed. Open: create the QF Developer Console account before bundling it for offline/preview use, and add the credit to video captions/credits.

## D-16 Verse-end marker and French verse number — Implemented
Arabic marker = Eastern Arabic digits rendered with KFGQPC HAFS v0.18, whose glyphs draw the traditional Mushaf ayah-end ornament (no invented artwork, no extra licence). Prefixing U+06DD would draw a second ornament, so it is not used. French number = Western digits in a separate pill after the final gloss. Both are separate elements computed from `verseWordCount`; they appear only in the scene containing the verse's final word. Workbook text untouched.

## D-17 Bismillah rules — Implemented (default can be changed)
`bismillahIntroPolicy`: surah 9 → intro forbidden (schema rejects it); surah 1 → intro shown as a separate decorative scene, **1:1 remains verse 1 in the word-by-word scenes** (no duplication of data, no renumbering), and the owner may switch the intro off for Al-Fatihah; other surahs → intro on by default. Open question for the owner: for Al-Fatihah, keep both the calligraphy intro and the 1:1 word scenes (current default), or skip one of them?

## D-18 Layout defaults — Implemented
1080-canvas units: title top 150 · content zone 340 → 1590, side margins 96 (clear of the right action rail) · QR 150 px, bottom 132, centred · label at the very bottom (bottom 64, Amiri 34 px) · 40 px minimum edge margin. The bottom ~100 px may be covered by captions on some apps; all positions/sizes/visibility are configurable. Technical labels are never exported unless `showTechnicalLabels` is enabled.

## D-19 Web application foundation — Implemented (2026-11-17)
`apps/web`: Next.js 16.4.6 App Router (Turbopack), React 19.3, TypeScript strict, Tailwind 4.3.3 + shadcn/ui (new-york, components adapted to Astro: pill buttons/tabs, no shadows), `cn` helper from shadcn's official `cn` package. Dark-only Astro tokens in `globals.css` (`@theme`), fonts self-hosted from `/assets/fonts` (copied by `scripts/sync-web-assets.mjs`, identical bytes to the worker), QF Surah Names font from the QF CDN at runtime. The editor preview renders the **same React layers** as the render worker (`@instantreels/video`). Package entry points split so browser code never imports Node modules (`@instantreels/core/node`, `@instantreels/video/html`).

## D-20 Supabase integration — Implemented (awaiting credentials)
`@supabase/ssr` 0.12: browser client (publishable key), per-request server client (cookies), session refresh in `src/proxy.ts` (Next 16 "Proxy", formerly Middleware) using `auth.getClaims()`, server-only admin client (secret key) guarded by `server-only`. Env validated with Zod; template values are detected as "not configured"; `/api/health` reports only variable names/status and Supabase reachability, never values. The single `.env.local` lives at the repository root and is loaded by `next.config.ts`.

## D-21 PWA — Implemented
`app/manifest.ts` (standalone, 192/512/maskable icons generated by `npm run asset:icons`), Apple touch icon, theme colour, `viewport-fit=cover` with safe-area padding. Service worker `public/sw.js` is deliberately minimal: offline fallback page for navigations only, **no caching of project data, Quranic content, audio or exports**; registered in production only. Verified with `scripts/qa/pwa-check.ts` (SW activated, manifest valid, offline page served). Installation behaviour differs between browsers (iOS: "Add to Home Screen" only).

## D-10 Authentication — Recommended
Supabase Auth (e-mail magic link); projects, audio and exports are private.

## D-11 Infrastructure — Recommended
Dedicated Docker worker + pg-boss queue in Supabase Postgres (no Redis).
