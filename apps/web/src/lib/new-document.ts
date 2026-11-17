import 'server-only';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_BISMILLAH,
  DEFAULT_BOX_STYLE,
  DEFAULT_FULL_VERSE_STYLE,
  DEFAULT_TITLE,
  DEFAULT_VERSE_DECORATION,
  INSTITUTION_LABELS,
  RenderDocumentSchema,
  applyTiming,
  defaultBranding,
  planFullVerseScenes,
  planScenes,
  secondsToFrame,
  type CountryCode,
  type FullVerseSource,
  type RenderDocument,
  type SceneDraft,
  type WordByWordVerse,
} from '@instantreels/core';

export const BUNDLED_QR: Partial<Record<CountryCode, string>> = { FR: 'bundled://qr/fr.jpg' };

/** Initial durations before any audio: intro 4 s, ~3 s per word scene, length-based for full verses. */
function initialDurations(drafts: SceneDraft[], fps: number): number[] {
  return drafts.map((d) => {
    if (d.kind === 'intro_bismillah') return secondsToFrame(4, fps);
    if (d.kind === 'word_boxes') return secondsToFrame(1.5 + 0.6 * d.words.length, fps);
    const words = d.items.reduce((n, it) => n + it.toPosition - it.fromPosition + 1, 0);
    return secondsToFrame(Math.min(20, 2 + 0.55 * words), fps);
  });
}

export function buildInitialDocument(input: {
  mode: 'word_by_word' | 'full_verse';
  country: CountryCode;
  surah: number;
  wordVerses?: WordByWordVerse[];
  fullVerses?: FullVerseSource[];
  bismillahIntro?: boolean;
}): RenderDocument {
  const fps = 30;
  const drafts =
    input.mode === 'word_by_word'
      ? planScenes({ surah: input.surah, verses: input.wordVerses ?? [], ...(input.bismillahIntro === undefined ? {} : { bismillahIntro: input.bismillahIntro }) })
      : planFullVerseScenes({ surah: input.surah, verses: input.fullVerses ?? [], ...(input.bismillahIntro === undefined ? {} : { bismillahIntro: input.bismillahIntro }) });
  const durations = initialDurations(drafts, fps);
  let t = 0;
  const spans = durations.map((d) => ({ startFrame: t, endFrame: (t += d) }));
  return RenderDocumentSchema.parse({
    version: 3,
    mode: input.mode,
    country: input.country,
    fps,
    width: 1080,
    height: 1920,
    totalFrames: t,
    surah: input.surah,
    maxBoxesPerScene: 5,
    audio: null,
    background: DEFAULT_BACKGROUND,
    branding: defaultBranding(INSTITUTION_LABELS[input.country], BUNDLED_QR[input.country] ?? null),
    title: DEFAULT_TITLE,
    bismillah: DEFAULT_BISMILLAH('bundled://bismillah.svg'),
    verseDecoration: DEFAULT_VERSE_DECORATION,
    boxStyle: DEFAULT_BOX_STYLE,
    fullVerseStyle: DEFAULT_FULL_VERSE_STYLE,
    showTechnicalLabels: false,
    sceneFadeInFrames: 8,
    scenes: applyTiming(drafts, spans),
  });
}
