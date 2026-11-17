# Video Rendering

Status: **Proposed (Phase 0)** — engine choice pending (D-06); benchmark required before any performance claim. Sections 1–4 describe the pipeline in engine-neutral terms except where Remotion is named.

## 1. Pipeline

1. User requests export → server validates `ProjectDocument`, snapshots it into `render_jobs`, enqueues with pg-boss.
2. Worker downloads assets (audio, background, fonts, QR) to a temp dir, runs **FFprobe** on each input.
3. Background video normalised if needed (FFmpeg → H.264 constant fps, no audio, ≥ target short side when available).
4. `@remotion/renderer` `selectComposition` + `renderMedia` with the snapshot as `inputProps`.
5. Post-process remux: `ffmpeg -i out.mp4 -c copy -movflags +faststart final.mp4` (no re-encode).
6. Validation (below), upload to Storage, signed URL, temp cleanup in `finally`.

Remotion ships FFmpeg/FFprobe binaries (`npx remotion ffmpeg`, `npx remotion ffprobe`), so the worker image does not strictly need a system FFmpeg; we will pin the versions used.

## 2. Export presets

| Preset | Size | fps | Codec | Notes |
|---|---|---|---|---|
| `2160p30` (primary) | 2160×3840 | 30 CFR | H.264 High, Level 5.1, yuv420p, AAC-LC 48 kHz 192 kbps | target ~35–45 Mbps (crf-based, capped) |
| `1080p30` (fallback, most compatible) | 1080×1920 | 30 CFR | H.264 High, Level 4.1/4.2, yuv420p, AAC-LC | ~10–12 Mbps |
| `1080p60` (optional) | 1080×1920 | 60 | idem, Level 4.2 | only after benchmark |

Level 5.1 is the lowest H.264 level covering a 3840-line frame at 30 fps (frame of 32,400 macroblocks). Some older/low-end phones cannot hardware-decode it — hence the 1080p fallback. Social platforms re-encode uploads; we do not promise 4K delivery on any platform.

Remotion options: `codec: 'h264'`, `pixelFormat: 'yuv420p'`, `audioCodec: 'aac'`, `crf`, `x264Preset`, `enforceAudioTrack` when audio supplied, `concurrency` tuned per machine.

## 3. Timing model

- All boundaries integer frames; scene i covers `[start_i, end_i)`; validated `start_0 = 0`, `start_{i+1} = end_i`, `end_last = durationInFrames`. No gaps/overlaps by construction.
- Audio placed with `<Audio>` from frame 0; total duration = `ceil(audioDurationMs * fps / 1000)` unless the user trims.
- Background video uses `<OffthreadVideo>` at **playbackRate 1** (never retimed). Shorter than reel → `<Loop>` of its own duration; longer → cut at the reel end. Original audio muted by default.
- Background scaled with `object-fit: cover` into 9:16; if source < 2160 px wide, the UI warns that 4K export does not add source detail.

## 4. Output validation (worker, before marking succeeded)

FFprobe JSON checks: video stream exists, `codec_name=h264`, `pix_fmt=yuv420p`, expected width/height, `r_frame_rate` = fps, `nb_frames` ≈ durationInFrames (± 0), duration within 1 frame, audio stream `aac` present if audio supplied, `moov` before `mdat` (faststart).
Frame checks: extract frames at each scene midpoint → FFmpeg `blackdetect` over the whole file; QR decode with zxing-cpp on extracted frames (must equal the configured payload); non-blank text region checks vs. a reference render in tests.

## 5. Engine comparison (D-06)

Checked 2026-11-16.

| | **A. Remotion + FFmpeg** | **B. Revideo** | **C. Scene-still compositing (Playwright + FFmpeg)** |
|---|---|---|---|
| Licence | source-available Remotion License; free for individuals and ≤ 3 people; ≥ $100/month for larger companies; educational bodies need written permission | MIT | Playwright Apache-2.0, FFmpeg LGPL/GPL (server-side use, no redistribution) — **no licence fees ever** |
| Maturity | very active (v4.0.544 released today, 73k★) | 0.11.0, last commit July 2026, 4.2k★, small team | Playwright/FFmpeg are industry standards; **our own glue code** to maintain |
| Authoring | React/DOM — HTML/CSS layout, RTL, `font-feature-settings` | Canvas 2D generators — RTL wrapping and box layout written by hand | React/DOM (same as A) |
| Preview | `<Player>` built in, frame-accurate | React player component | own lightweight player: `<audio>` clock + `<video>` background + same React overlay |
| 4K cost | every frame screenshotted (900 for 30 s) | every frame drawn | **one transparent 2160×3840 PNG per scene**, FFmpeg composes video |
| Animation | anything | anything | fades, slides, scale (FFmpeg filters on stills); no per-frame custom animation |
| Background video | `<OffthreadVideo>` decoded per frame | similar | FFmpeg native: `-stream_loop`, `scale/crop` cover, never retimed |

Why C fits InstantReels: scenes are static text over a moving background, and the spec asks for restrained animation. Rendering stills + FFmpeg compositing is far cheaper at 4K, uses the same Chromium/HarfBuzz shaping as the browser preview, and has no recurring licence cost. Main risk: we own the preview player and the compositing code (more tests needed). Mitigation: a `RenderEngine` interface in `packages/video`; if richer animation becomes necessary, a Remotion adapter can be added without changing the project model.

C pipeline sketch:

1. Worker launches Chromium (Playwright), loads the composition page with the scene's props, viewport 2160×3840, transparent background → `scene-NN.png` (+ separate persistent layer for label/QR).
2. FFmpeg: background input (`-stream_loop -1`, `scale=…:force_original_aspect_ratio=increase,crop=2160:3840`, brightness/blur/overlay), each scene PNG `overlay` with `enable='between(t,start,end)'` and optional `fade` on alpha, audio input, `-t` = total duration, `libx264 -profile:v high -level 5.1 -pix_fmt yuv420p -r 30 -c:a aac -movflags +faststart`.
3. Scene boundaries converted from integer frames to exact timestamps (`frame / fps`), so frame accuracy is preserved.

Recommendation: **C** — chosen and validated by the Phase 1 prototype (`POC_RENDERING.md`): all checks passed at 2160p and 1080p.

## 6. Infrastructure options

| Option | Pros | Cons |
|---|---|---|
| **A. Dedicated Docker worker on a VM** (recommended start) | simple, predictable cost, any duration, local reproducible | scale = add machines |
| B. Remotion Lambda (AWS) | parallel chunks, fast | AWS account + quotas, cost per render, more complexity |
| C. Google Cloud Run (Remotion Cloud Run, alpha) | serverless | less mature |

Estimates for option A (to be measured): a 4–8 vCPU / 8–16 GB VM costs roughly €15–60/month at mainstream EU hosts. A 30 s 4K reel = 900 frames; render time expected in the order of minutes, not seconds — to be benchmarked in Phase 5.

**Remotion licence**: free for individuals, non-profits and companies ≤ 3 people; otherwise "Remotion for Automators" ($0.01/render, $100/month minimum). Educational/government organisations need written permission from Remotion even if non-profit — see `DECISIONS.md` D-01.

## 7. Preview vs export differences

Same compositions and fonts; Player renders in the user's browser at reduced size. Possible differences: browser font hinting at small sizes, video decoding of the background (Player uses `<video>` element), and colour management. Fonts are loaded from the same bundled files in both (`@remotion/fonts` / `loadFont`), never from system fonts.
