# Architecture

Status: **Approved** — Phase 1 foundation implemented (web app shell, Supabase clients, PWA, rendering prototype). See `DECISIONS.md` D-19…D-21.

## 1. Overview

```
┌──────────────────────────┐        ┌────────────────────────────┐
│  Browser (PWA)           │        │  Supabase                  │
│  Next.js App Router UI   │◄──────►│  Postgres (+RLS)           │
│  Preview player          │  auth  │  Auth                      │
│  wavesurfer.js timeline  │  data  │  Storage (audio, bg, mp4)  │
└───────────┬──────────────┘        └──────────▲─────────────────┘
            │ server actions / route handlers   │ service role
┌───────────▼──────────────┐        ┌───────────┴────────────────┐
│  Next.js server          │ enqueue│  Render worker (Node 22)   │
│  - Pexels proxy          ├───────►│  Docker, long-running      │
│  - Quran API proxy/cache │ pg-boss│  RenderEngine (D-06)       │
│  - upload validation     │        │  Chromium (Playwright)     │
│  - job creation          │        │  FFmpeg / FFprobe          │
└──────────────────────────┘        │  output validation         │
                                    └────────────────────────────┘
```

Monorepo (npm workspaces):

```
apps/web          Next.js 16 app (UI, API routes, PWA) — studio home, /editor/[projectId], /api/health, /offline
apps/worker       Render worker (Node, Docker)
packages/core     Pure TS domain: types, Zod schemas, pagination, timeline (frame math)
packages/video    Scene compositions (React) shared by the preview player and the worker
packages/importer Excel importer (used by an admin route and a CLI)
supabase/         migrations, seed, RLS policies
```

The **single source of truth** for a reel is a `ProjectDocument` (Zod-validated JSON) persisted in Postgres. The same document drives the editor, the browser preview and the worker render, so preview and export cannot drift structurally.

## 2. Key principles

- **Frame-based time**: all scene boundaries are stored as integer frames at the project fps. Seconds are only a UI representation. Rounding happens once, at user input.
- **Source data vs presentation**: Quranic text and translations live in read-only content tables; projects reference words by `(surah, verse, position)` and never copy/modify text.
- **Rendering is never done in the browser or in a serverless function**; the mobile device only previews.
- **Secrets server-side only**: Supabase secret key, Pexels key, Quran Foundation client secret.

## 3. Modes

- **Mode A — Word-by-word**: Arabic words and French glosses **exclusively** from Dr Usama Nonnenmacher's workbook (Postgres). External sources only flag Arabic discrepancies (D-07). Scene = ordered contiguous slice of words of one verse (default ≤ 5 boxes, configurable).
- **Mode B — Full verse**: Arabic in QPC Hafs encoding (D-03) + translations by Hamidullah / Hilali & Khan / Bernström, imported from Tanzil.net files (D-02), QF API optional cross-check. Scene = one or more verses or verse segments.

## 4. Editor layout

Desktop: left sidebar (Surah/verses/media/branding/templates) · center 9:16 Player · right inspector · bottom waveform timeline.
Mobile: Player on top, compact transport, tabbed panels, horizontally scrollable scene strip, bottom nav.

## 5. Technology choices (versions checked 2026-11-16 via `npm view`)

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js App Router | 16.4.x (requires Node ≥ 20.9; local Node 20.11.1 OK, Node 22 LTS recommended) |
| UI | React | 19.x |
| Styling | Tailwind CSS v4 + shadcn/ui | 4.3.x |
| Video engine | **Pending D-06**: recommended Playwright (Chromium) scene stills + FFmpeg compositing, behind a `RenderEngine` interface; alternative Remotion 4.0.544 (Free License while individual) | — |
| Quranic font | KFGQPC HAFS Uthmanic Script v0.18, unmodified `.ttf` (see `TYPOGRAPHY.md`) | 0.18 |
| DB/Auth/Storage | `@supabase/supabase-js`, `@supabase/ssr` | 2.119 / 0.12 |
| Validation | Zod | 4.x |
| Excel | ExcelJS (streaming reader) | 4.4.0 — SheetJS npm `xlsx` 0.18.5 is the stale npm build; avoid |
| Waveform | wavesurfer.js (+ regions plugin) | 8.x |
| Job queue | pg-boss (Postgres-native, no Redis) | 12.x |
| PWA | Serwist (`@serwist/next`) | 9.x |
| Tests | Vitest, Playwright | 5.x / 1.65 |

## 6. Security

- RLS on every user table (`owner_id = auth.uid()`); content tables read-only for `authenticated`, write only via service role in the importer.
- Storage buckets private; downloads via short-lived signed URLs.
- Upload validation: MIME sniffing + size limits + FFprobe on the worker before use.
- Pexels and Quran API calls proxied through server route handlers with rate limiting.
