import type { WordByWordVerse } from './content.ts';
import { DEFAULT_MAX_BOXES_PER_SCENE, paginate, suggestPageSizes } from './pagination.ts';
import { bismillahIntroPolicy } from './quran-rules.ts';
import type { FullVerseItem, Scene } from './render-document.ts';
import type { TimedSpan } from './timeline.ts';

type Ref = { surah: number; verse: number; fromPosition: number; toPosition: number; verseWordCount: number };

export type SceneDraft =
  | { kind: 'intro_bismillah' }
  | { kind: 'word_boxes'; ref: Ref; words: { position: number; arabic: string; french: string }[] }
  | { kind: 'full_verse'; items: FullVerseItem[] };

/** Resolves whether the Bismillah intro is shown. Requesting it for At-Tawbah is an error. */
export function resolveBismillahIntro(surah: number, requested: boolean | undefined): boolean {
  const policy = bismillahIntroPolicy(surah);
  if (requested === undefined) return policy.defaultEnabled;
  if (requested && !policy.allowed) throw new Error(`Surah ${surah} must not begin with a Bismillah introduction`);
  return requested;
}

function assertVerses(verses: readonly { verse: number; words: readonly { position: number }[] }[]): void {
  let last = 0;
  for (const v of verses) {
    if (v.verse <= last) throw new Error(`verses must be in ascending order (got ${v.verse} after ${last})`);
    last = v.verse;
    v.words.forEach((w, i) => {
      if (w.position !== i + 1) throw new Error(`verse ${v.verse}: word positions must be 1..n`);
    });
  }
}

// ───────────────────────── Mode A: word by word ─────────────────────────

export interface PlanOptions {
  surah: number;
  /** selected verses, in Quran order, with ALL their words */
  verses: readonly WordByWordVerse[];
  /** manual page sizes per verse number (else automatic) */
  layouts?: ReadonlyMap<number, readonly number[]>;
  maxPerPage?: number;
  /** undefined = follow the Quranic default for this surah */
  bismillahIntro?: boolean;
}

/** Builds the ordered scene list. Source words are copied verbatim; nothing is inserted into verses. */
export function planScenes(opts: PlanOptions): SceneDraft[] {
  const max = opts.maxPerPage ?? DEFAULT_MAX_BOXES_PER_SCENE;
  assertVerses(opts.verses);
  const drafts: SceneDraft[] = [];
  if (resolveBismillahIntro(opts.surah, opts.bismillahIntro)) drafts.push({ kind: 'intro_bismillah' });
  for (const v of opts.verses) {
    const sizes = opts.layouts?.get(v.verse) ?? suggestPageSizes(v.words.length, max);
    for (const page of paginate(v.words, sizes, max)) {
      drafts.push({
        kind: 'word_boxes',
        ref: { surah: opts.surah, verse: v.verse, fromPosition: page[0]!.position, toPosition: page[page.length - 1]!.position, verseWordCount: v.words.length },
        words: page.map((w) => ({ position: w.position, arabic: w.arabic, french: w.french })),
      });
    }
  }
  return drafts;
}

// ───────────────────────── Mode B: full verse ─────────────────────────

export interface FullVerseSource {
  verse: number;
  /** Arabic words of the verse (verbatim, in order) */
  words: readonly { position: number; arabic: string }[];
  translation: string;
}

/** Verses longer than this (in words) are split into balanced segments by default. */
export const DEFAULT_MAX_WORDS_PER_SEGMENT = 24;

export function verseItem(surah: number, v: FullVerseSource, from: number, to: number): FullVerseItem {
  return {
    surah,
    verse: v.verse,
    fromPosition: from,
    toPosition: to,
    verseWordCount: v.words.length,
    arabic: v.words.slice(from - 1, to).map((w) => w.arabic).join(' '),
    translation: v.translation,
  };
}

/** One scene per verse; long verses split into balanced word segments (never truncated). */
export function planFullVerseScenes(opts: { surah: number; verses: readonly FullVerseSource[]; maxWordsPerSegment?: number; bismillahIntro?: boolean }): SceneDraft[] {
  assertVerses(opts.verses);
  const maxWords = opts.maxWordsPerSegment ?? DEFAULT_MAX_WORDS_PER_SEGMENT;
  const drafts: SceneDraft[] = [];
  if (resolveBismillahIntro(opts.surah, opts.bismillahIntro)) drafts.push({ kind: 'intro_bismillah' });
  for (const v of opts.verses) {
    let from = 1;
    for (const size of suggestPageSizes(v.words.length, maxWords)) {
      drafts.push({ kind: 'full_verse', items: [verseItem(opts.surah, v, from, from + size - 1)] });
      from += size;
    }
  }
  return drafts;
}

// ───────────────────────── timing ─────────────────────────

export function applyTiming(drafts: readonly SceneDraft[], spans: readonly TimedSpan[]): Scene[] {
  if (drafts.length !== spans.length) throw new Error(`${drafts.length} scenes but ${spans.length} time spans`);
  return drafts.map((d, i) => {
    const span = spans[i]!;
    const base = { id: `scene-${i + 1}`, startFrame: span.startFrame, endFrame: span.endFrame };
    if (d.kind === 'intro_bismillah') return { ...base, kind: d.kind };
    if (d.kind === 'word_boxes') return { ...base, kind: d.kind, ref: d.ref, words: d.words };
    return { ...base, kind: d.kind, items: d.items };
  });
}

type Slot = { verse: number; position: number };

function slotsOf(s: SceneDraft | Scene): Slot[] {
  if (s.kind === 'word_boxes') return s.words.map((w) => ({ verse: s.ref.verse, position: w.position }));
  if (s.kind === 'full_verse') return s.items.flatMap((it) => Array.from({ length: it.toPosition - it.fromPosition + 1 }, (_, k) => ({ verse: it.verse, position: it.fromPosition + k })));
  return [];
}

/**
 * Re-times a new scene list (after pagination / splitting / merging) WITHOUT moving the user's
 * timing elsewhere: each word keeps the moment it had in the old timeline; new scene boundaries
 * fall on the moment of their first word. The intro and the total duration are preserved.
 */
export function retime(oldScenes: readonly Scene[], drafts: readonly SceneDraft[], totalFrames: number): Scene[] {
  const wordStart = new Map<string, number>();
  for (const s of oldScenes) {
    const slots = slotsOf(s);
    slots.forEach((sl, k) => wordStart.set(`${sl.verse}:${sl.position}`, s.startFrame + ((s.endFrame - s.startFrame) * k) / slots.length));
  }
  const oldIntro = oldScenes.find((s) => s.kind === 'intro_bismillah');
  const firstContent = oldScenes.find((s) => s.kind !== 'intro_bismillah')?.startFrame ?? 0;
  const starts = drafts.map((d, i) => {
    if (d.kind === 'intro_bismillah') return 0;
    const first = slotsOf(d)[0];
    const t = first ? wordStart.get(`${first.verse}:${first.position}`) : undefined;
    if (t !== undefined) return Math.round(t);
    return i === 0 ? 0 : firstContent;
  });
  // an intro that did not exist before takes ~3 s from the start of the content
  if (drafts[0]?.kind === 'intro_bismillah' && !oldIntro && drafts.length > 1) {
    const introEnd = Math.min(90, Math.floor(totalFrames / drafts.length));
    for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i]!, introEnd);
    starts[1] = introEnd;
  }
  if (drafts[0]?.kind !== 'intro_bismillah') starts[0] = 0;
  // enforce strictly increasing starts (≥ 1 frame per scene)
  for (let i = 1; i < starts.length; i++) if (starts[i]! <= starts[i - 1]!) starts[i] = starts[i - 1]! + 1;
  const overflow = starts[starts.length - 1]! - (totalFrames - 1);
  if (overflow > 0) for (let i = starts.length - 1; i > 0; i--) starts[i] = Math.min(starts[i]!, totalFrames - (starts.length - i));
  const spans = starts.map((s, i) => ({ startFrame: s, endFrame: i + 1 < starts.length ? starts[i + 1]! : totalFrames }));
  return applyTiming(drafts, spans);
}
