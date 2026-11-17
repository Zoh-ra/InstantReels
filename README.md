# InstantReels

Progressive Web App for producing Quranic educational reels (9:16 MP4, H.264/AAC, 1080p and 4K) in two modes: word-by-word boxes and full verses, with audio-synchronised scenes, optional Pexels backgrounds and Al-Huda International branding.

## Status

| Phase | Status |
|---|---|
| 0 Discovery | ✅ done |
| 1 Foundation | ✅ rendering engine (`docs/POC_RENDERING.md`), Next.js 16 app, Astro design system, responsive editor shell with live preview (demo Al-Fâtiha), PWA, Supabase clients + session proxy + health check |
| 2 Database + Excel import | ⏳ (streaming row classifier + Surah 1 fixture exist) |
| 3 Scene editor | ⏳ |
| 4 Audio, timeline, Pexels | ⏳ |
| 5 Rendering worker (jobs, storage) | ⏳ (engine prototype exists) |
| 6 Production readiness | ⏳ |

Not implemented yet: database schema & import (Phase 2), sign-in UI, project saving, manual pagination editing, audio/waveform, Pexels, render job queue and in-app export.

## Repository layout

```
packages/core       domain types, Zod render document, pagination, frame timeline
packages/video      React scene layers (shared by preview and export)
packages/importer   streaming workbook reader/classifier, fixture CLI
apps/web            Next.js 16 PWA: studio, responsive editor, Supabase clients
apps/worker         Playwright stills + FFmpeg compositor + MP4 validation (prototype)
assets/fonts        KFGQPC HAFS v0.18, Poppins SemiBold, Amiri (+ licences)
assets/branding/qr  France QR (fr.jpg)
assets/branding/bismillah  owner-supplied calligraphy + traced SVG (licence pending, D-14)
fixtures/quran      Surah 1 extracted from the workbook (byte-for-byte)
docs/               architecture, decisions, reports
```

## Windows setup (PowerShell)

Prerequisites: Node.js ≥ 20.9 (22 LTS recommended), Git, Google Chrome, FFmpeg + FFprobe on PATH (`ffmpeg -version`).

```powershell
npm install
Copy-Item .env.example .env.local   # only if .env.local does not exist yet
# edit .env.local yourself — never commit it
npm test
npm run fixture:surah1
npm run asset:bismillah   # re-trace the Bismillah SVG from the source image
npm run poc:render
npm run dev                 # http://localhost:3000 — studio + /editor/demo
npm run typecheck; npm run lint; npm run build:web
npm run qa:responsive       # needs the dev server running
```

Check the Supabase configuration (never shows values): open http://localhost:3000/api/health.

### Where to find the Supabase values (Dashboard → your project)

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Connect** button (top bar), or Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → *Publishable key* (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → *Secret keys* → reveal or create (`sb_secret_…`) — server only |
| `SUPABASE_PROJECT_REF` | Project Settings → General → Project ID |
| `SUPABASE_DB_URL` | **Connect** → Connection string → *Session pooler*; replace `[YOUR-PASSWORD]` (reset under Project Settings → Database if unknown) |

If the project only shows legacy keys, the *anon* key plays the publishable role and *service_role* the secret role.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Database schema](docs/DATABASE_SCHEMA.md)
- [Video rendering](docs/VIDEO_RENDERING.md) · [Rendering prototype results](docs/POC_RENDERING.md) · [Typography](docs/TYPOGRAPHY.md)
- [Excel import](docs/EXCEL_IMPORT.md) · [Deployment](docs/DEPLOYMENT.md) · [Testing](docs/TESTING.md)
- [Phase 0 report (FR)](docs/PHASE0_REPORT.md)
