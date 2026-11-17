import { z } from 'zod';
import { bismillahIntroPolicy } from './quran-rules.ts';
import { validateTimeline } from './timeline.ts';

/**
 * RenderDocument v3: the single source of truth of a project. The same document drives the
 * editor preview and the worker export. Sizes/positions are authored for a 1080×1920 canvas
 * and scaled to the output size. Quranic text inside scenes is a verbatim copy of the database
 * (verified on save); presentation settings are free.
 *
 * Asset references are URIs: "bundled://…" (repository assets), "storage://<bucket>/<path>"
 * (Supabase Storage), "file://…" (worker-local), "http(s)://…" or "/…" (browser).
 */

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const BoxStyleSchema = z.object({
  background: hexColor,
  borderColor: hexColor,
  borderStyle: z.enum(['solid', 'dashed', 'dotted', 'double']),
  glowColor: hexColor,
  glowStrength: z.number().min(0).max(1),
  borderWidth: z.number().min(0).max(40),
  radius: z.number().min(0).max(200),
  gap: z.number().min(0).max(400),
  padding: z.number().min(0).max(400),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  minHeight: z.number().min(80).max(600),
  arabicColor: hexColor,
  frenchColor: hexColor,
  arabicSize: z.number().min(10).max(400),
  frenchSize: z.number().min(6).max(200),
});

export const FullVerseStyleSchema = z.object({
  arabicColor: hexColor,
  arabicSize: z.number().min(20).max(200),
  translationColor: hexColor,
  translationSize: z.number().min(14).max(80),
  panelBackground: hexColor,
  panelBorderColor: hexColor,
  panelRadius: z.number().min(0).max(120),
  panelPadding: z.number().min(0).max(200),
});

const RefSchema = z.object({
  surah: z.number().int().min(1).max(114),
  verse: z.number().int().min(1),
  fromPosition: z.number().int().min(1),
  toPosition: z.number().int().min(1),
  /** total words of the verse — decides where the verse-end marker goes */
  verseWordCount: z.number().int().min(1),
});

const SceneTiming = { id: z.string().min(1), startFrame: z.number().int().min(0), endFrame: z.number().int().min(1) };

export const WordBoxSceneSchema = z.object({
  ...SceneTiming,
  kind: z.literal('word_boxes'),
  ref: RefSchema,
  words: z.array(z.object({ position: z.number().int().min(1), arabic: z.string().min(1), french: z.string().min(1) })).min(1),
});

export const FullVerseItemSchema = RefSchema.extend({
  /** words fromPosition..toPosition of the verse, joined by a space (verbatim) */
  arabic: z.string().min(1),
  /** complete verse translation (verbatim), shown with every segment of the verse */
  translation: z.string().min(1),
});

export const FullVerseSceneSchema = z.object({
  ...SceneTiming,
  kind: z.literal('full_verse'),
  items: z.array(FullVerseItemSchema).min(1).max(4),
});

export const IntroSceneSchema = z.object({ ...SceneTiming, kind: z.literal('intro_bismillah') });

export const SceneSchema = z.discriminatedUnion('kind', [WordBoxSceneSchema, FullVerseSceneSchema, IntroSceneSchema]);

export const BrandingSchema = z.object({
  label: z.string().min(1).max(120),
  labelVisible: z.boolean(),
  labelColor: hexColor,
  labelBottom: z.number().min(0).max(600),
  labelSize: z.number().min(8).max(200),
  qr: z
    .object({
      visible: z.boolean(),
      src: z.string().min(1),
      size: z.number().min(100).max(800),
      centerX: z.number().min(0).max(1080),
      bottom: z.number().min(0).max(1600),
    })
    .nullable(),
});

export const TitleSchema = z.object({
  enabled: z.boolean(),
  color: hexColor,
  size: z.number().min(20).max(400),
  top: z.number().min(0).max(800),
  align: z.enum(['center', 'left', 'right']),
  withSurahWord: z.boolean(),
  showOnIntro: z.boolean(),
  showOnScenes: z.boolean(),
});

export const BismillahStyleSchema = z.object({
  src: z.string().min(1),
  color: hexColor,
  widthRatio: z.number().min(0.2).max(0.95),
  centerY: z.number().min(0).max(1920),
  backdrop: hexColor.nullable(),
});

export const VerseDecorationSchema = z.object({
  arabicMarker: z.object({ enabled: z.boolean(), color: hexColor, scale: z.number().min(0.4).max(1.5) }),
  frenchNumber: z.object({ enabled: z.boolean(), color: hexColor, background: hexColor }),
});

export const BackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: hexColor }),
  z.object({
    kind: z.literal('video'),
    src: z.string().min(1),
    durationMs: z.number().int().min(1).nullable(),
    brightness: z.number().min(-1).max(1),
    dimOpacity: z.number().min(0).max(1),
    blur: z.number().min(0).max(40),
    /** never retimed: the background always plays at 1x; shorter clips loop */
    loop: z.boolean(),
  }),
]);

export const RenderDocumentSchema = z
  .object({
    version: z.literal(3),
    mode: z.enum(['word_by_word', 'full_verse']),
    country: z.enum(['FR', 'UK', 'SE']),
    fps: z.union([z.literal(30), z.literal(60)]),
    width: z.number().int(),
    height: z.number().int(),
    totalFrames: z.number().int().min(1),
    surah: z.number().int().min(1).max(114),
    maxBoxesPerScene: z.number().int().min(1).max(8),
    audio: z.object({ src: z.string().min(1), durationMs: z.number().int().min(1) }).nullable(),
    background: BackgroundSchema,
    branding: BrandingSchema,
    title: TitleSchema,
    bismillah: BismillahStyleSchema,
    verseDecoration: VerseDecorationSchema,
    boxStyle: BoxStyleSchema,
    fullVerseStyle: FullVerseStyleSchema,
    /** technical labels (verse ref, word range) — editor only, never exported unless enabled */
    showTechnicalLabels: z.boolean(),
    sceneFadeInFrames: z.number().int().min(0).max(30),
    scenes: z.array(SceneSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (doc.width * 16 !== doc.height * 9) issue('canvas must be 9:16');
    for (const e of validateTimeline(doc.scenes, doc.totalFrames)) issue(e);
    const intros = doc.scenes.filter((s) => s.kind === 'intro_bismillah');
    if (intros.length > 0 && !bismillahIntroPolicy(doc.surah).allowed) issue(`surah ${doc.surah} must not have a Bismillah introduction`);
    if (intros.length > 1 || (intros.length === 1 && doc.scenes[0]?.kind !== 'intro_bismillah')) issue('the Bismillah introduction must be the single first scene');

    // every content scene matches the mode; verses are covered contiguously (no duplicated / skipped word)
    const segments: { verse: number; from: number; to: number; count: number; surah: number }[] = [];
    doc.scenes.forEach((s, i) => {
      if (s.kind === 'intro_bismillah') return;
      if (s.kind === 'word_boxes') {
        if (doc.mode !== 'word_by_word') issue(`scene ${i + 1}: word boxes in full-verse mode`);
        if (s.words.length > doc.maxBoxesPerScene) issue(`scene ${i + 1}: ${s.words.length} boxes > maximum ${doc.maxBoxesPerScene}`);
        if (s.words.length !== s.ref.toPosition - s.ref.fromPosition + 1) issue(`scene ${i + 1}: word count mismatch`);
        s.words.forEach((w, j) => {
          if (w.position !== s.ref.fromPosition + j) issue(`scene ${i + 1}: words out of order`);
        });
        segments.push({ verse: s.ref.verse, from: s.ref.fromPosition, to: s.ref.toPosition, count: s.ref.verseWordCount, surah: s.ref.surah });
      } else {
        if (doc.mode !== 'full_verse') issue(`scene ${i + 1}: full-verse scene in word-by-word mode`);
        for (const it of s.items) segments.push({ verse: it.verse, from: it.fromPosition, to: it.toPosition, count: it.verseWordCount, surah: it.surah });
      }
    });
    let prev: (typeof segments)[number] | null = null;
    segments.forEach((seg, k) => {
      if (seg.surah !== doc.surah) issue(`segment ${k + 1}: surah ${seg.surah} ≠ ${doc.surah}`);
      if (seg.to > seg.count || seg.from > seg.to) issue(`segment ${k + 1}: invalid word range ${seg.from}-${seg.to}/${seg.count}`);
      if (prev && prev.verse === seg.verse && seg.from !== prev.to + 1) issue(`verse ${seg.verse}: words duplicated or skipped`);
      if (prev && prev.verse !== seg.verse) {
        if (prev.to !== prev.count) issue(`verse ${prev.verse} not finished`);
        if (seg.verse < prev.verse) issue(`verse ${seg.verse} follows ${prev.verse}: verses must be in ascending order`);
      }
      if ((!prev || prev.verse !== seg.verse) && seg.from !== 1) issue(`verse ${seg.verse} must start at word 1`);
      prev = seg;
    });
    const lastSeg = segments[segments.length - 1];
    if (lastSeg && lastSeg.to !== lastSeg.count) issue(`verse ${lastSeg.verse} not finished`);
  });

export type RenderDocument = z.infer<typeof RenderDocumentSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type WordBoxScene = z.infer<typeof WordBoxSceneSchema>;
export type FullVerseScene = z.infer<typeof FullVerseSceneSchema>;
export type FullVerseItem = z.infer<typeof FullVerseItemSchema>;
export type IntroScene = z.infer<typeof IntroSceneSchema>;
export type BoxStyle = z.infer<typeof BoxStyleSchema>;
export type FullVerseStyle = z.infer<typeof FullVerseStyleSchema>;
export type Branding = z.infer<typeof BrandingSchema>;
export type TitleStyle = z.infer<typeof TitleSchema>;
export type BismillahStyle = z.infer<typeof BismillahStyleSchema>;
export type VerseDecoration = z.infer<typeof VerseDecorationSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type CountryCode = RenderDocument['country'];

/** Default "Astro" reel styling (all customizable). */
export const DEFAULT_BOX_STYLE: BoxStyle = {
  background: '#0c0f19d9',
  borderColor: '#acafff',
  borderStyle: 'solid',
  glowColor: '#b845ed',
  glowStrength: 0.45,
  borderWidth: 3,
  radius: 28,
  gap: 24,
  padding: 22,
  columns: 2,
  minHeight: 236,
  arabicColor: '#f2f6fa',
  frenchColor: '#ffd493',
  arabicSize: 60,
  frenchSize: 25,
};

export const DEFAULT_FULL_VERSE_STYLE: FullVerseStyle = {
  arabicColor: '#f2f6fa',
  arabicSize: 62,
  translationColor: '#ffd493',
  translationSize: 30,
  panelBackground: '#0c0f19b3',
  panelBorderColor: '#acafff66',
  panelRadius: 32,
  panelPadding: 44,
};

export const DEFAULT_TITLE: TitleStyle = {
  enabled: true,
  color: '#f2f6fa',
  size: 118,
  top: 150,
  align: 'center',
  withSurahWord: true,
  showOnIntro: true,
  showOnScenes: true,
};

export const DEFAULT_VERSE_DECORATION: VerseDecoration = {
  arabicMarker: { enabled: true, color: '#ffd493', scale: 0.9 },
  frenchNumber: { enabled: true, color: '#060913', background: '#ffd493' },
};

export const DEFAULT_BISMILLAH = (src: string): BismillahStyle => ({ src, color: '#f2f6fa', widthRatio: 0.78, centerY: 900, backdrop: null });

export const DEFAULT_BACKGROUND: Background = { kind: 'solid', color: '#060913' };

export const INSTITUTION_LABELS: Record<CountryCode, string> = {
  FR: 'Al-Huda International France',
  UK: 'Al-Huda International UK',
  SE: 'Al-Huda International Sweden',
};

/** Footer: small QR above a label at the very bottom. */
export function defaultBranding(label: string, qrSrc: string | null): Branding {
  return {
    label,
    labelVisible: true,
    labelColor: '#f2f6fa',
    labelBottom: 64,
    labelSize: 34,
    qr: qrSrc ? { visible: true, src: qrSrc, size: 150, centerX: 540, bottom: 132 } : null,
  };
}
