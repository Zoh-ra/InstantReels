# InstantReels render worker — Playwright Chromium + FFmpeg (Debian, Node 22 LTS).
# Build from the repository root:   docker build -f apps/worker/Dockerfile -t instantreels-worker .
# Run (secrets come from the environment, never baked into the image):
#   docker run --rm --env-file .env.local -e RENDER_BROWSER_CHANNEL= instantreels-worker
FROM mcr.microsoft.com/playwright:v1.65.1-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY assets ./assets
# workspaces needed by the worker only (web app excluded from the image)
RUN npm ci --workspace @instantreels/worker --workspace @instantreels/core --workspace @instantreels/video --include-workspace-root --omit=optional \
 && npx playwright-core install chromium

ENV NODE_ENV=production \
    RENDER_BROWSER_CHANNEL= \
    RENDER_TMP_DIR=/tmp/instantreels
USER pwuser
CMD ["npx", "tsx", "apps/worker/src/service/worker.ts"]
