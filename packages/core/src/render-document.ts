import { z } from 'zod';
import { bismillahIntroPolicy } from './quran-rules.ts';
import { validateTimeline } from './timeline.ts';

/**
 * RenderDocument: the immutable snapshot a render job consumes.
 * The same document drives the browser preview and the worker export.
 * All positions/sizes are authored for a 1080×1920 canvas and scaled to the output size.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const BoxStyleSchema = z.object({
  background: hexColor,
  borderColor: hexColor,
  glowColor: hexColor,
  borderWidth: z.number().min(0).max(40),
  radius: z.number().min(0).max(200),
  gap: z.number().min(0).max(400),
  padding: z.number().min(0).max(400),
  arabicColor: hexColor,
  frenchColor: hexColor,
  arabicSize: z.number().min(10).max(400),
  frenchSize: z.number().min(6).max(200),
});

export const WordBoxSceneSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('word_boxes'),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(1),
  ref: z.object({
    surah: z.number().int().min(1).max(114),
    verse: z.number().int().min(1),
    fromPosition: z.number().int().min(1),
    toPosition: z.number().int().min(1),
    /** total words of the verse in the source — decides where the verse-end marker goes */
    verseWordCount: z.number().int().min(1),
  }),
  words: z
    .array(z.object({ position: z.number().int().min(1), arabic: z.string().min(1), french: z.string().min(1) }))
    .min(1),
});

export const IntroSceneSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('intro_bismillah'),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(1),
});

export const SceneSchema = z.discriminatedUnion('kind', [WordBoxSceneSchema, IntroSceneSchema]);

export const BrandingSchema = z.object({
  label: z.string().min(1),
  labelVisible: z.boolean(),
  labelColor: hexColor,
  /** distance from the bottom edge to the label box bottom */
  labelBottom: z.number().min(0),
  labelSize: z.number().min(8).max(200),
  qr: z
    .object({
      visible: z.boolean(),
      /** absolute local path (worker) or URL (preview) */
      src: z.string().min(1),
      /** side length incl. the white quiet-zone frame */
      size: z.number().min(100).max(800),
      /** horizontal centre of the QR (540 = centred) */
      centerX: z.number().min(0).max(1080),
      bottom: z.number().min(0),
    })
    .nullable(),
});

export const TitleSchema = z.object({
  enabled: z.boolean(),
  color: hexColor,
  /** font size of the calligraphic name */
  size: z.number().min(20).max(400),
  /** distance from the top edge to the title box top */
  top: z.number().min(0),
  align: z.enum(['center', 'left', 'right']),
  /** prefix the ligature "سورة" */
  withSurahWord: z.boolean(),
  showOnIntro: z.boolean(),
  showOnScenes: z.boolean(),
});

export const BismillahStyleSchema = z.object({
  /** local SVG path (worker) — traced from the owner-supplied calligraphy */
  src: z.string().min(1),
  color: hexColor,
  /** calligraphy width as a fraction of the canvas width */
  widthRatio: z.number().min(0.2).max(0.95),
  /** vertical centre of the calligraphy */
  centerY: z.number().min(0).max(1920),
  /** optional backdrop panel behind the calligraphy */
  backdrop: hexColor.nullable(),
});

export const VerseDecorationSchema = z.object({
  /** Arabic end-of-verse ornament (KFGQPC glyph around Eastern Arabic digits) */
  arabicMarker: z.object({ enabled: z.boolean(), color: hexColor, scale: z.number().min(0.4).max(1.5) }),
  /** Western-digit verse number after the final French gloss */
  frenchNumber: z.object({ enabled: z.boolean(), color: hexColor, background: hexColor }),
});

export const BackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: hexColor }),
  z.object({
    kind: z.literal('video'),
    src: z.string().min(1),
    brightness: z.number().min(-1).max(1),
    dimOpacity: z.number().min(0).max(1),
    /** never retimed: the background always plays at 1x */
    loop: z.boolean(),
  }),
]);

export const RenderDocumentSchema = z
  .object({
    version: z.literal(2),
    fps: z.union([z.literal(30), z.literal(60)]),
    width: z.number().int(),
    height: z.number().int(),
    totalFrames: z.number().int().min(1),
    surah: z.number().int().min(1).max(114),
    audio: z.object({ src: z.string().min(1) }).nullable(),
    background: BackgroundSchema,
    branding: BrandingSchema,
    title: TitleSchema,
    bismillah: BismillahStyleSchema,
    verseDecoration: VerseDecorationSchema,
    boxStyle: BoxStyleSchema,
    /** technical labels (verse ref, word range) — editor only, never exported unless enabled */
    showTechnicalLabels: z.boolean(),
    sceneFadeInFrames: z.number().int().min(0).max(30),
    scenes: z.array(SceneSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    if (doc.width * 16 !== doc.height * 9) ctx.addIssue({ code: 'custom', message: 'canvas must be 9:16' });
    for (const e of validateTimeline(doc.scenes, doc.totalFrames)) ctx.addIssue({ code: 'custom', message: e });
    const intros = doc.scenes.filter((s) => s.kind === 'intro_bismillah');
    if (intros.length > 0 && !bismillahIntroPolicy(doc.surah).allowed) {
      ctx.addIssue({ code: 'custom', message: `surah ${doc.surah} must not have a Bismillah introduction` });
    }
    if (intros.length > 1 || (intros.length === 1 && doc.scenes[0]?.kind !== 'intro_bismillah')) {
      ctx.addIssue({ code: 'custom', message: 'the Bismillah introduction must be the single first scene' });
    }
    // word scenes: same surah, contiguous coverage, no duplicate or missing word
    let prev: { verse: number; to: number; count: number } | null = null;
    doc.scenes.forEach((s, i) => {
      if (s.kind !== 'word_boxes') return;
      const { ref } = s;
      if (ref.surah !== doc.surah) ctx.addIssue({ code: 'custom', message: `scene ${i + 1}: surah ${ref.surah} ≠ document surah ${doc.surah}` });
      if (ref.toPosition > ref.verseWordCount) ctx.addIssue({ code: 'custom', message: `scene ${i + 1}: position beyond verse length` });
      if (s.words.length !== ref.toPosition - ref.fromPosition + 1) ctx.addIssue({ code: 'custom', message: `scene ${i + 1}: word count mismatch` });
      s.words.forEach((w, j) => {
        if (w.position !== ref.fromPosition + j) ctx.addIssue({ code: 'custom', message: `scene ${i + 1}: words out of order` });
      });
      if (prev && prev.verse === ref.verse && ref.fromPosition !== prev.to + 1) {
        ctx.addIssue({ code: 'custom', message: `scene ${i + 1}: verse ${ref.verse} words duplicated or skipped` });
      }
      if (prev && prev.verse !== ref.verse && prev.to !== prev.count) {
        ctx.addIssue({ code: 'custom', message: `scene ${i + 1}: previous verse ${prev.verse} not finished` });
      }
      if ((!prev || prev.verse !== ref.verse) && ref.fromPosition !== 1) {
        ctx.addIssue({ code: 'custom', message: `scene ${i + 1}: verse ${ref.verse} must start at word 1` });
      }
      prev = { verse: ref.verse, to: ref.toPosition, count: ref.verseWordCount };
    });
  });

export type RenderDocument = z.infer<typeof RenderDocumentSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type WordBoxScene = z.infer<typeof WordBoxSceneSchema>;
export type IntroScene = z.infer<typeof IntroSceneSchema>;
export type BoxStyle = z.infer<typeof BoxStyleSchema>;
export type Branding = z.infer<typeof BrandingSchema>;
export type TitleStyle = z.infer<typeof TitleSchema>;
export type BismillahStyle = z.infer<typeof BismillahStyleSchema>;
export type VerseDecoration = z.infer<typeof VerseDecorationSchema>;

/** Default "Astro" reel styling (all customizable). */
export const DEFAULT_BOX_STYLE: BoxStyle = {
  background: '#0c0f19d9',
  borderColor: '#acafff',
  glowColor: '#b845ed',
  borderWidth: 3,
  radius: 28,
  gap: 24,
  padding: 22,
  arabicColor: '#f2f6fa',
  frenchColor: '#ffd493',
  arabicSize: 60,
  frenchSize: 25,
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
