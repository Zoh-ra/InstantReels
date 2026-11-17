# Testing Strategy

Status: Phase 1 — unit tests (`npm test`, Node test runner + tsx while Node is 20.11; Vitest after Node 22) and the rendering validation suite (`apps/worker/src/validate/validate-output.ts`, run by `npm run poc:render`).

Current automated tests: pagination (1/4/5/7/9/11/128 words, 5+2, 3+4, no omission/duplication), timeline (frame rounding, gaps/overlaps, spec 0-4-9-15-22-30 example), workbook row classifier (byte-for-byte Arabic incl. non-NFC strings, ۞/۩, separators, malformed rows).

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | pagination, frame math, Zod schemas, Excel row classifier |
| Integration | Vitest + local Supabase (`supabase start`, Docker) | importer idempotency, RLS policies, job lifecycle |
| Render | Vitest on worker + FFprobe/FFmpeg + zxing-cpp | real MP4 1080p and 4K short fixtures; codec, size, fps, frame count, audio, blackdetect, QR decode, text-region checks |
| E2E | Playwright (Chromium, WebKit, mobile emulation) | editor flows, touch timeline, PWA manifest |
| Manual | checklist | real iPhone Safari, Android Chrome, iPad, upload to TikTok/Instagram/YouTube |

Importer acceptance numbers (from the Phase 0 analysis): 77,429 words, 6,236 verses, 114 surahs, 0 duplicate refs, Arabic stored byte-identical (SHA-256 per word), second import of the same file = 0 changes.

Pagination fixtures: verses with 1, 4, 5, 7 words and 2:282 (128 words); manual 5+2 and 3+4 splits; invariant: concatenation of scenes = verse words in order, no duplicates.

## Web app checks (Phase 1)

| Command | What it verifies |
|---|---|
| `npm run typecheck` | strict TypeScript for packages, worker and web app |
| `npm run lint` | ESLint (next/core-web-vitals + typescript) |
| `npm run build:web` | production build (Turbopack) |
| `npm run qa:responsive` | 1440×900, 834×1194, 390×844, 360×740: no horizontal overflow, 9:16 preview visible, no console errors; screenshots in `output/qa/` |
| `npx tsx scripts/qa/pwa-check.ts http://localhost:3100` (after `next start -p 3100`) | service worker activated, manifest + 3 icons, offline fallback page |

Results 2026-11-17: all passed. Manual checklist still required on real devices: iPhone Safari (Add to Home Screen, safe areas), Android Chrome install prompt, iPad split view, touch sliders.
