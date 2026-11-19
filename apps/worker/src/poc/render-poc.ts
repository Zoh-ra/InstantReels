/**
 * Rendering prototype — full Surah Al-Fatihah, word by word:
 *  - Bismillah calligraphy introduction (owner-supplied, traced), then verses 1:1–1:7
 *    (1:1 stays verse 1 of the source data; the intro does not replace or renumber it)
 *  - calligraphic Surah title (Quran Foundation Surah Names font), top
 *  - verse-end ornament (KFGQPC glyph, Eastern Arabic digits) + French verse number,
 *    only on the final word of each verse (1:7 split 5+4 → only in the second scene)
 *  - small QR + label at the bottom; no technical labels in the video
 * Background and audio are synthetic TEST signals. Writes output/poc/poc-report.json.
 *
 * Usage: npm run poc:render  [-- --only=1080p30]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import {
  DEFAULT_BOX_STYLE,
  DEFAULT_FULL_VERSE_STYLE,
  DEFAULT_TITLE,
  DEFAULT_VERSE_DECORATION,
  RenderDocumentSchema,
  applyTiming,
  defaultBranding,
  planScenes,
  secondsToFrame,
  spansFromEndMarks,
  type RenderDocument,
  type WordByWordSurahFixture,
} from '@instantreels/core';
import { loadDotEnv } from '@instantreels/core/node';
import { ffmpeg, ffmpegBin, run } from '../media/ffmpeg.ts';
import { PRESETS, compose, type EncodePreset } from '../render/compose.ts';
import { launchBrowser, renderStills } from '../render/stills.ts';
import { validateOutput, type Check } from '../validate/validate-output.ts';
import { FRAME_CODE, makeTestAudio, makeTestBackground } from './test-media.ts';

loadDotEnv();
const ROOT = resolve(import.meta.dirname, '../../../..');
const OUT = resolve(ROOT, 'output', 'poc');
const FPS = 30 as const;
const BG_SECONDS = 8;
const QR_PAYLOAD = 'https://qr.codes/FGWXbJ'; // decoded from the supplied France QR (D-09)
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

// ── 1. content: real workbook data, all 7 verses ──
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/quran/surah-001.wbw.json'), 'utf8')) as WordByWordSurahFixture;
const drafts = planScenes({ surah: fixture.surah, verses: fixture.verses }); // intro resolved by the Quranic rule

// ── 2. timeline: intro 4 s, then manual end marks (seconds → frames, single rounding) ──
const endMarksSec = [4, 7, 10, 13, 16, 19, 22, 25.5];
const totalSec = 29;
if (endMarksSec.length !== drafts.length - 1) throw new Error(`need ${drafts.length - 1} end marks for ${drafts.length} scenes`);
const totalFrames = secondsToFrame(totalSec, FPS);
const spans = spansFromEndMarks(endMarksSec.map((s) => secondsToFrame(s, FPS)), totalFrames);
const scenes = applyTiming(drafts, spans);
const beepStartsSec = spans.map((s) => s.startFrame / FPS);

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const version = (await run(ffmpegBin(), ['-hide_banner', '-version'])).stdout.split('\n')[0];
  console.log(`ffmpeg: ${version}`);
  const bgPath = resolve(OUT, 'test-background-1080x1920-25fps.mp4');
  const audioPath = resolve(OUT, 'test-audio-beeps.wav');
  await makeTestBackground(bgPath, BG_SECONDS);
  await makeTestAudio(audioPath, totalSec, beepStartsSec);

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    machine: { cpus: cpus().length, cpuModel: cpus()[0]?.model, ramGB: Math.round(totalmem() / 2 ** 30), platform: process.platform },
    ffmpeg: version,
    source: fixture.source,
    scenes: scenes.map((s) => ({ kind: s.kind, ref: s.kind === 'word_boxes' ? `${s.ref.surah}:${s.ref.verse} w${s.ref.fromPosition}-${s.ref.toPosition}/${s.ref.verseWordCount}` : 'bismillah', frames: [s.startFrame, s.endFrame] })),
    outputs: [] as unknown[],
  };

  const browser = await launchBrowser();
  try {
    for (const preset of Object.values(PRESETS) as EncodePreset[]) {
      if (only && preset.name !== only) continue;
      const work = resolve(OUT, preset.name);
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      const doc: RenderDocument = RenderDocumentSchema.parse({
        version: 3,
        mode: 'word_by_word',
        country: 'FR',
        maxBoxesPerScene: 5,
        fullVerseStyle: DEFAULT_FULL_VERSE_STYLE,
        fps: FPS,
        width: preset.width,
        height: preset.height,
        totalFrames,
        surah: fixture.surah,
        audio: { src: audioPath, durationMs: totalSec * 1000 },
        background: { kind: 'video', src: bgPath, durationMs: BG_SECONDS * 1000, brightness: -0.04, dimOpacity: 0.35, blur: 0, loop: true },
        branding: defaultBranding('Al-Huda International France', resolve(ROOT, 'assets/branding/qr/fr.jpg')),
        title: DEFAULT_TITLE,
        bismillah: { src: resolve(ROOT, 'assets/branding/bismillah/bismillah.svg'), color: '#f2f6fa', widthRatio: 0.78, centerY: 900, backdrop: null },
        verseDecoration: DEFAULT_VERSE_DECORATION,
        boxStyle: DEFAULT_BOX_STYLE,
        showTechnicalLabels: false,
        sceneFadeInFrames: 8,
        scenes,
      });
      writeFileSync(resolve(work, 'render-document.json'), JSON.stringify(doc, null, 2));

      console.log(`\n[${preset.name}] rendering ${doc.scenes.length} scene stills…`);
      const stills = await renderStills(doc, { fontsDir: resolve(ROOT, 'assets/fonts'), outDir: work, browser });
      console.log(`[${preset.name}] stills in ${(stills.ms / 1000).toFixed(1)} s; encoding ${totalFrames} frames…`);
      const mp4 = resolve(OUT, `instantreels-poc-${preset.name}.mp4`);
      let last = 0;
      const encodeMs = await compose(doc, stills, preset, mp4, (f) => {
        if (f - last >= 150) {
          last = f;
          process.stdout.write(`  frame ${f}/${totalFrames}\r`);
        }
      });
      console.log(`[${preset.name}] encoded in ${(encodeMs / 1000).toFixed(1)} s → ${mp4}`);

      const checks: Check[] = [
        ...stills.layoutChecks.map((c) => ({ ...c, critical: true })),
        ...(await validateOutput(mp4, {
          doc,
          width: preset.width,
          height: preset.height,
          level: Math.round(Number(preset.level) * 10),
          expectedQrPayload: QR_PAYLOAD,
          workDir: work,
          frameCode: { ...FRAME_CODE, loopSeconds: BG_SECONDS, sourceWidth: 1080, sourceFps: 25 },
          beepStartsSec,
        })),
      ];
      for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);

      // representative screenshots: intro, an intermediate verse scene (1:7 part 1), final scene of 1:7
      const mid = (i: number) => Math.floor((scenes[i]!.startFrame + scenes[i]!.endFrame) / 2);
      const shots: Record<string, number> = {
        intro: mid(0),
        'verse-1-7-part1-intermediate': mid(scenes.length - 2),
        'verse-1-7-final': mid(scenes.length - 1),
      };
      for (const [name, frame] of Object.entries(shots)) {
        await ffmpeg(['-ss', ((frame - 0.25) / FPS).toFixed(6), '-i', mp4, '-frames:v', '1', resolve(OUT, `shot-${preset.name}-${name}.png`)]);
      }
      const size = readFileSync(mp4).byteLength;
      (report.outputs as unknown[]).push({ preset: preset.name, file: mp4, sizeMB: +(size / 2 ** 20).toFixed(1), stillsSeconds: +(stills.ms / 1000).toFixed(2), encodeSeconds: +(encodeMs / 1000).toFixed(2), screenshots: shots, checks });
    }
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(OUT, 'poc-report.json'), JSON.stringify(report, null, 2));
  const all = (report.outputs as { checks: Check[] }[]).flatMap((o) => o.checks);
  const failed = all.filter((c) => !c.pass);
  console.log(`\nreport: ${resolve(OUT, 'poc-report.json')}`);
  console.log(failed.length ? `${failed.length}/${all.length} check(s) FAILED` : `all ${all.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

await main();
