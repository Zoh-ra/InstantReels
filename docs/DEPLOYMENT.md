# Deployment

Status: **Proposed (Phase 0)** — nothing is deployed yet.

## Components

| Component | Proposed host | Notes |
|---|---|---|
| Next.js web/PWA | Vercel (or any Node host) | no rendering here |
| Database/Auth/Storage | Supabase (Pro recommended for storage + backups) | migrations via Supabase CLI |
| Render worker | Docker on a VM (4–8 vCPU, 8–16 GB RAM, ≥ 50 GB SSD temp) | Linux, Chrome Headless Shell deps, fonts bundled |
| Queue | pg-boss on Supabase Postgres (direct/session connection, not transaction pooler) | |

## External services and credentials (placeholders only in `.env.example`)

- Supabase: project URL, publishable key (browser), secret key (server/worker only)
- Pexels API key (server only) — 200 req/h, 20,000/month default; visible Pexels attribution required
- Quran Foundation: client id + secret (server only), OAuth2 client credentials
- Remotion licence key if required (D-01)

## Indicative monthly cost (to confirm)

Supabase Pro ~$25 · Vercel Hobby $0 / Pro $20 · worker VM €15–60 · storage egress depending on video volume (a 30 s 4K file ≈ 130–170 MB) · Remotion $0 or ≥ $100.

Exports should expire (e.g. 7 days) to bound storage cost.

Windows setup, migration commands and worker run instructions will be written in Phase 1 once the code exists.
