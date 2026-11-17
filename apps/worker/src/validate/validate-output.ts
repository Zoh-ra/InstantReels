import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import jsQRModule from 'jsqr';
import { PNG } from 'pngjs';
import type { RenderDocument } from '@instantreels/core';
import { ffmpeg, ffmpegRaw, ffprobe } from '../media/ffmpeg.ts';

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ValidationContext {
  doc: RenderDocument;
  /** output size actually encoded */
  width: number;
  height: number;
  level: number;
  expectedQrPayload: string | null;
  workDir: string;
  /** optional synthetic-background beacon (test media only) */
  frameCode?: { x: number; y: number; cell: number; pitch: number; bits: number; loopSeconds: number; sourceWidth: number; sourceFps: number };
  /** optional beep check (test audio only) */
  beepStartsSec?: number[];
}

// jsqr is CommonJS: depending on interop the function is the module or its .default
type JsQR = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
const jsQR: JsQR = ((jsQRModule as unknown as { default?: JsQR }).default ?? (jsQRModule as unknown as JsQR));

const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail });

/** Top-level MP4 box order; faststart means 'moov' precedes 'mdat'. */
export function topLevelBoxes(path: string): string[] {
  const fd = openSync(path, 'r');
  try {
    const boxes: string[] = [];
    const header = Buffer.alloc(16);
    let offset = 0;
    for (let i = 0; i < 64; i++) {
      if (readSync(fd, header, 0, 16, offset) < 8) break;
      let size = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (size === 1) size = Number(header.readBigUInt64BE(8));
      if (size < 8) break;
      boxes.push(type);
      offset += size;
    }
    return boxes;
  } finally {
    closeSync(fd);
  }
}

/** Extracts exactly frame `n` (0-based) as RGBA, optionally cropped (output pixel coords). */
export async function grabFrame(path: string, n: number, fps: number, out: string, crop?: { x: number; y: number; w: number; h: number }): Promise<PNG> {
  const t = Math.max(0, (n - 0.25) / fps);
  const vf = crop ? [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : [];
  await ffmpeg(['-ss', t.toFixed(6), '-i', path, '-frames:v', '1', ...(vf.length ? ['-vf', vf.join(',')] : []), '-pix_fmt', 'rgba', out]);
  return PNG.sync.read(readFileSync(out));
}

function meanAbsDiff(a: PNG, b: PNG): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)) + Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)) + Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0));
  }
  return sum / ((a.data.length / 4) * 3);
}

/** Decodes the test background's 8-bit frame code for every frame of a video (one ffmpeg pass). */
async function decodeFrameCodes(path: string, fc: { x: number; y: number; cell: number; pitch: number; bits: number }, scale: number): Promise<number[]> {
  const x = Math.round(fc.x * scale);
  const y = Math.round(fc.y * scale);
  const w = Math.round((fc.pitch * (fc.bits - 1) + fc.cell) * scale);
  const h = Math.round(fc.cell * scale);
  const raw = await ffmpegRaw(['-i', path, '-an', '-vf', `crop=${w}:${h}:${x}:${y},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const frameBytes = w * h;
  const codes: number[] = [];
  for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) {
    const levels: number[] = [];
    for (let k = 0; k < fc.bits; k++) {
      // sample the inner half of cell k
      const cx0 = Math.round((k * fc.pitch + fc.cell * 0.25) * scale);
      const cx1 = Math.round((k * fc.pitch + fc.cell * 0.75) * scale);
      const cy0 = Math.round(fc.cell * 0.25 * scale);
      const cy1 = Math.round(fc.cell * 0.75 * scale);
      let sum = 0;
      let n = 0;
      for (let yy = cy0; yy < cy1; yy++) for (let xx = cx0; xx < cx1; xx++) {
        sum += raw[off + yy * w + xx] ?? 0;
        n++;
      }
      levels.push(sum / n);
    }
    const threshold = (Math.max(...levels) + Math.min(...levels)) / 2;
    const spread = Math.max(...levels) - Math.min(...levels);
    codes.push(levels.reduce((acc, lv, k) => acc + (spread > 20 && lv > threshold ? 2 ** k : 0), 0));
  }
  return codes;
}

export async function validateOutput(path: string, ctx: ValidationContext): Promise<Check[]> {
  const { doc, width, height } = ctx;
  const checks: Check[] = [];
  const s = width / 1080;

  // ── container / streams ──
  const probe = await ffprobe(path, true);
  const v = probe.streams.find((x) => x.codec_type === 'video');
  const a = probe.streams.find((x) => x.codec_type === 'audio');
  checks.push(check('video stream present', !!v, v ? `${v.codec_name}` : 'none'));
  if (v) {
    checks.push(check('codec H.264 High', v.codec_name === 'h264' && v.profile === 'High', `${v.codec_name} ${v.profile}`));
    checks.push(check(`H.264 level ${ctx.level / 10}`, v.level === ctx.level, `level ${v.level}`));
    checks.push(check('resolution', v.width === width && v.height === height, `${v.width}x${v.height}`));
    checks.push(check('pixel format yuv420p', v.pix_fmt === 'yuv420p', String(v.pix_fmt)));
    checks.push(check(`constant ${doc.fps} fps`, v.r_frame_rate === `${doc.fps}/1` && v.avg_frame_rate === `${doc.fps}/1`, `r=${v.r_frame_rate} avg=${v.avg_frame_rate}`));
    checks.push(check('exact frame count', Number(v.nb_read_frames) === doc.totalFrames, `${v.nb_read_frames} / expected ${doc.totalFrames}`));
  }
  const expectedDur = doc.totalFrames / doc.fps;
  const dur = Number(probe.format.duration);
  checks.push(check('duration ±1 frame', Math.abs(dur - expectedDur) <= 1 / doc.fps + 1e-3, `${dur.toFixed(3)} s / expected ${expectedDur.toFixed(3)} s`));
  if (doc.audio) {
    checks.push(check('audio AAC-LC 48 kHz stereo', !!a && a.codec_name === 'aac' && a.profile === 'LC' && a.sample_rate === '48000' && a.channels === 2, a ? `${a.codec_name} ${a.profile} ${a.sample_rate} ${a.channels}ch` : 'none'));
  }
  const boxes = topLevelBoxes(path);
  checks.push(check('faststart (moov before mdat)', boxes.indexOf('moov') > -1 && boxes.indexOf('moov') < boxes.indexOf('mdat'), boxes.join(' > ')));

  // ── black frames ──
  const bd = await ffmpeg(['-i', path, '-an', '-vf', 'blackdetect=d=0.04:pix_th=0.06', '-f', 'null', '-']);
  const blacks = bd.stderr.match(/black_start:\S+/g) ?? [];
  checks.push(check('no black segments', blacks.length === 0, blacks.length ? blacks.join(', ') : 'none detected'));

  // ── scene switching exactly on boundaries (content zone, output pixels) ──
  // content zone (word boxes / Bismillah), excluding title and footer
  const zone = { x: Math.round(96 * s), y: Math.round(340 * s), w: Math.round(888 * s), h: Math.round(1250 * s) };
  for (let i = 1; i < doc.scenes.length; i++) {
    const b = doc.scenes[i]!.startFrame;
    const before = await grabFrame(path, b - 1, doc.fps, join(ctx.workDir, `b${i}-pre.png`), zone);
    const prev2 = await grabFrame(path, b - 2, doc.fps, join(ctx.workDir, `b${i}-pre2.png`), zone);
    const at = await grabFrame(path, b, doc.fps, join(ctx.workDir, `b${i}-at.png`), zone);
    const stable = meanAbsDiff(prev2, before);
    const change = meanAbsDiff(before, at);
    checks.push(check(`scene ${i}→${i + 1} switches exactly at frame ${b}`, change > 4 * stable + 2, `Δ(at boundary)=${change.toFixed(2)} vs Δ(within scene)=${stable.toFixed(2)}`));
  }

  // ── QR readability on real frames (first, middle, last) ──
  if (ctx.expectedQrPayload && doc.branding.qr?.visible) {
    const q = doc.branding.qr;
    const margin = 24 * s;
    const crop = {
      x: Math.round((q.centerX - q.size / 2) * s - margin),
      y: Math.round(height - (q.bottom + q.size) * s - margin),
      w: Math.round(q.size * s + 2 * margin),
      h: Math.round(q.size * s + 2 * margin),
    };
    for (const n of [0, Math.floor(doc.totalFrames / 2), doc.totalFrames - 1]) {
      const img = await grabFrame(path, n, doc.fps, join(ctx.workDir, `qr-${n}.png`), crop);
      const res = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
      checks.push(check(`QR readable at frame ${n}`, res?.data === ctx.expectedQrPayload, res ? res.data : 'not decoded'));
    }
  }

  // ── QR still readable when the whole frame is downscaled to a 720×1280 phone-like view ──
  if (ctx.expectedQrPayload && doc.branding.qr?.visible) {
    const q = doc.branding.qr;
    const k = 720 / 1080;
    const m = 16;
    const x = Math.round((q.centerX - q.size / 2) * k - m);
    const y = Math.round(1280 - (q.bottom + q.size) * k - m);
    const side = Math.round(q.size * k + 2 * m);
    const out = join(ctx.workDir, 'qr-720p.png');
    const mid = Math.floor(doc.totalFrames / 2);
    await ffmpeg(['-ss', ((mid - 0.25) / doc.fps).toFixed(6), '-i', path, '-frames:v', '1', '-vf', `scale=720:1280:flags=bicubic,crop=${side}:${side}:${x}:${y}`, '-pix_fmt', 'rgba', out]);
    const img = PNG.sync.read(readFileSync(out));
    const res = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    checks.push(check('QR readable at phone scale (frame downscaled to 720×1280)', res?.data === ctx.expectedQrPayload, `${res ? res.data : 'not decoded'} — QR ${(q.size * k).toFixed(0)} px wide`));
  }

  // ── background plays at 1x and loops (test frame code only) ──
  // For EVERY output frame, the decoded source frame must equal the 1x-and-loop prediction
  // (±1 source frame for the 25→30 fps resampling). A retimed or frozen background would drift.
  if (ctx.frameCode) {
    const fc = ctx.frameCode;
    const codes = await decodeFrameCodes(path, fc, width / fc.sourceWidth);
    const loopFrames = Math.round(fc.loopSeconds * fc.sourceFps);
    let worst = 0;
    let worstAt = -1;
    codes.forEach((code, n) => {
      const predicted = Math.round(((n / doc.fps) % fc.loopSeconds) * fc.sourceFps) % loopFrames;
      const raw = Math.abs(code - predicted);
      const d = Math.min(raw, loopFrames - raw);
      if (d > worst) {
        worst = d;
        worstAt = n;
      }
    });
    const retimed = codes.map((_, n) => Math.round(((n * 1.25) / doc.fps % fc.loopSeconds) * fc.sourceFps) % loopFrames);
    const retimedWorst = Math.max(...codes.map((c, n) => Math.min(Math.abs(c - retimed[n]!), loopFrames - Math.abs(c - retimed[n]!))));
    checks.push(check('background at native speed, looped (frame code, every frame)', codes.length === doc.totalFrames && worst <= 1,
      `${codes.length} frames decoded; max deviation ${worst} source frame(s)${worstAt >= 0 ? ` at output frame ${worstAt}` : ''}; a 1.25x retime would deviate by ${retimedWorst}`));
  }

  // ── audio/scene sync (test beeps only) ──
  if (ctx.beepStartsSec && doc.audio) {
    const sd = await ffmpeg(['-i', path, '-vn', '-af', 'highpass=f=600,silencedetect=noise=-30dB:d=0.05', '-f', 'null', '-']);
    const onsets = [...sd.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const expected = ctx.beepStartsSec.filter((t) => t > 0);
    const errs = expected.map((t) => Math.min(...onsets.map((o) => Math.abs(o - t))));
    const worstMs = Math.max(...errs) * 1000;
    checks.push(check('audio beeps align with scene starts (≤ 1 frame)', worstMs <= 1000 / doc.fps, `max offset ${worstMs.toFixed(1)} ms; onsets ${onsets.map((o) => o.toFixed(3)).join(', ')}`));
  }

  return checks;
}
