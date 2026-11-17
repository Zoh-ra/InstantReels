import type { WordByWordVerse } from './content.ts';
import { DEFAULT_MAX_BOXES_PER_SCENE, paginate, suggestPageSizes } from './pagination.ts';
import { bismillahIntroPolicy } from './quran-rules.ts';
import type { Scene } from './render-document.ts';
import type { TimedSpan } from './timeline.ts';

export type SceneDraft =
  | { kind: 'intro_bismillah' }
  | {
      kind: 'word_boxes';
      ref: { surah: number; verse: number; fromPosition: number; toPosition: number; verseWordCount: number };
      words: { position: number; arabic: string; french: string }[];
    };

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

/** Resolves whether the Bismillah intro is shown. Requesting it for At-Tawbah is an error. */
export function resolveBismillahIntro(surah: number, requested: boolean | undefined): boolean {
  const policy = bismillahIntroPolicy(surah);
  if (requested === undefined) return policy.defaultEnabled;
  if (requested && !policy.allowed) throw new Error(`Surah ${surah} must not begin with a Bismillah introduction`);
  return requested;
}

/** Builds the ordered scene list. Source words are copied verbatim; nothing is inserted into verses. */
export function planScenes(opts: PlanOptions): SceneDraft[] {
  const max = opts.maxPerPage ?? DEFAULT_MAX_BOXES_PER_SCENE;
  const drafts: SceneDraft[] = [];
  if (resolveBismillahIntro(opts.surah, opts.bismillahIntro)) drafts.push({ kind: 'intro_bismillah' });
  let lastVerse = 0;
  for (const v of opts.verses) {
    if (v.verse <= lastVerse) throw new Error(`verses must be in ascending order (got ${v.verse} after ${lastVerse})`);
    lastVerse = v.verse;
    v.words.forEach((w, i) => {
      if (w.position !== i + 1) throw new Error(`verse ${v.verse}: word positions must be 1..n`);
    });
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

export function applyTiming(drafts: readonly SceneDraft[], spans: readonly TimedSpan[]): Scene[] {
  if (drafts.length !== spans.length) throw new Error(`${drafts.length} scenes but ${spans.length} time spans`);
  return drafts.map((d, i) => {
    const span = spans[i]!;
    const base = { id: `scene-${i + 1}`, startFrame: span.startFrame, endFrame: span.endFrame };
    return d.kind === 'intro_bismillah' ? { ...base, kind: d.kind } : { ...base, kind: d.kind, ref: d.ref, words: d.words };
  });
}
