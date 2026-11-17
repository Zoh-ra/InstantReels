'use client';

import {
  audioDurationToFrames,
  paginate,
  planScenes,
  retime,
  secondsToFrame,
  suggestEvenBoundaries,
  suggestPageSizes,
  verseItem,
  type Background,
  type BismillahStyle,
  type BoxStyle,
  type Branding,
  type FullVerseItem,
  type FullVerseStyle,
  type RenderDocument,
  type Scene,
  type SceneDraft,
  type TitleStyle,
  type VerseDecoration,
  type WordByWordVerse,
} from '@instantreels/core';

/**
 * Editor state = the RenderDocument (single source of truth for preview, save and export).
 * Actions change presentation, pagination and timing only — never the Quranic text, which is
 * copied verbatim from existing scenes and re-verified by the server on every save.
 */
export type EditorAction =
  | { type: 'boxStyle'; patch: Partial<BoxStyle> }
  | { type: 'fullVerseStyle'; patch: Partial<FullVerseStyle> }
  | { type: 'title'; patch: Partial<TitleStyle> }
  | { type: 'branding'; patch: Partial<Omit<Branding, 'qr'>> }
  | { type: 'qr'; patch: Partial<NonNullable<Branding['qr']>> }
  | { type: 'arabicMarker'; patch: Partial<VerseDecoration['arabicMarker']> }
  | { type: 'frenchNumber'; patch: Partial<VerseDecoration['frenchNumber']> }
  | { type: 'bismillah'; patch: Partial<BismillahStyle> }
  | { type: 'technicalLabels'; value: boolean }
  | { type: 'fade'; frames: number }
  | { type: 'intro'; enabled: boolean }
  | { type: 'pagination'; verse: number; sizes: number[] }
  | { type: 'resetPagination'; verse: number }
  | { type: 'maxBoxes'; value: number }
  | { type: 'splitScene'; index: number }
  | { type: 'mergeWithNext'; index: number }
  | { type: 'boundary'; index: number; frame: number }
  | { type: 'evenTiming' }
  | { type: 'audio'; audio: RenderDocument['audio'] }
  | { type: 'background'; background: Background }
  | { type: 'replace'; doc: RenderDocument };

const MIN_SCENE_FRAMES = 6;

/** Rebuilds verse word lists from the scenes (mode A): all words of a selected verse are always present. */
export function wordVersesOf(doc: RenderDocument): WordByWordVerse[] {
  const map = new Map<number, WordByWordVerse>();
  for (const s of doc.scenes) {
    if (s.kind !== 'word_boxes') continue;
    const v = map.get(s.ref.verse) ?? { verse: s.ref.verse, words: [] };
    for (const w of s.words) v.words.push({ ...w, sourceRow: 0 });
    map.set(s.ref.verse, v);
  }
  return [...map.values()];
}

/** Current page sizes per verse (mode A). */
export function pageSizesOf(doc: RenderDocument): Map<number, number[]> {
  const sizes = new Map<number, number[]>();
  for (const s of doc.scenes) if (s.kind === 'word_boxes') sizes.set(s.ref.verse, [...(sizes.get(s.ref.verse) ?? []), s.words.length]);
  return sizes;
}

function hasIntro(doc: RenderDocument): boolean {
  return doc.scenes[0]?.kind === 'intro_bismillah';
}

function contentDrafts(doc: RenderDocument): SceneDraft[] {
  return doc.scenes.filter((s) => s.kind !== 'intro_bismillah').map((s): SceneDraft => (s.kind === 'word_boxes' ? { kind: 'word_boxes', ref: s.ref, words: s.words } : { kind: 'full_verse', items: (s as Extract<Scene, { kind: 'full_verse' }>).items }));
}

function withScenes(doc: RenderDocument, drafts: SceneDraft[]): RenderDocument {
  return { ...doc, scenes: retime(doc.scenes, drafts, doc.totalFrames) };
}

/** Splits one full-verse item into two at the middle word (words never contain spaces). */
function splitItem(it: FullVerseItem): [FullVerseItem, FullVerseItem] | null {
  const words = it.arabic.split(' ');
  if (words.length < 2) return null;
  const cut = Math.ceil(words.length / 2);
  const a: FullVerseItem = { ...it, toPosition: it.fromPosition + cut - 1, arabic: words.slice(0, cut).join(' ') };
  const b: FullVerseItem = { ...it, fromPosition: it.fromPosition + cut, arabic: words.slice(cut).join(' ') };
  return [a, b];
}

export function editorReducer(doc: RenderDocument, a: EditorAction): RenderDocument {
  switch (a.type) {
    case 'replace':
      return a.doc;
    case 'boxStyle':
      return { ...doc, boxStyle: { ...doc.boxStyle, ...a.patch } };
    case 'fullVerseStyle':
      return { ...doc, fullVerseStyle: { ...doc.fullVerseStyle, ...a.patch } };
    case 'title':
      return { ...doc, title: { ...doc.title, ...a.patch } };
    case 'branding':
      return { ...doc, branding: { ...doc.branding, ...a.patch } };
    case 'qr':
      return doc.branding.qr ? { ...doc, branding: { ...doc.branding, qr: { ...doc.branding.qr, ...a.patch } } } : doc;
    case 'arabicMarker':
      return { ...doc, verseDecoration: { ...doc.verseDecoration, arabicMarker: { ...doc.verseDecoration.arabicMarker, ...a.patch } } };
    case 'frenchNumber':
      return { ...doc, verseDecoration: { ...doc.verseDecoration, frenchNumber: { ...doc.verseDecoration.frenchNumber, ...a.patch } } };
    case 'bismillah':
      return { ...doc, bismillah: { ...doc.bismillah, ...a.patch } };
    case 'technicalLabels':
      return { ...doc, showTechnicalLabels: a.value };
    case 'fade':
      return { ...doc, sceneFadeInFrames: Math.max(0, Math.min(30, Math.round(a.frames))) };

    case 'intro': {
      if (a.enabled === hasIntro(doc)) return doc;
      if (a.enabled && doc.surah === 9) return doc; // At-Tawbah: never
      const drafts = contentDrafts(doc);
      return withScenes(doc, a.enabled ? [{ kind: 'intro_bismillah' }, ...drafts] : drafts);
    }

    case 'pagination':
    case 'resetPagination':
    case 'maxBoxes': {
      if (doc.mode !== 'word_by_word') return doc;
      const max = a.type === 'maxBoxes' ? Math.max(1, Math.min(8, Math.round(a.value))) : doc.maxBoxesPerScene;
      const layouts = pageSizesOf(doc);
      if (a.type === 'pagination') layouts.set(a.verse, a.sizes);
      for (const v of wordVersesOf(doc)) {
        const cur = layouts.get(v.verse)!;
        if (a.type === 'resetPagination' && a.verse === v.verse) layouts.set(v.verse, suggestPageSizes(v.words.length, max));
        if (a.type === 'maxBoxes' && cur.some((n) => n > max)) layouts.set(v.verse, suggestPageSizes(v.words.length, max));
      }
      try {
        const drafts = planScenes({ surah: doc.surah, verses: wordVersesOf(doc), layouts, maxPerPage: max, bismillahIntro: hasIntro(doc) });
        return { ...withScenes(doc, drafts), maxBoxesPerScene: max };
      } catch {
        return doc; // invalid layout (sum / size) is ignored
      }
    }

    case 'splitScene': {
      const s = doc.scenes[a.index];
      if (!s || s.kind !== 'full_verse') return doc;
      const drafts: SceneDraft[] = [];
      for (const [i, sc] of doc.scenes.entries()) {
        if (sc.kind === 'intro_bismillah') {
          drafts.push({ kind: 'intro_bismillah' });
          continue;
        }
        if (i !== a.index) {
          drafts.push(sc.kind === 'word_boxes' ? { kind: 'word_boxes', ref: sc.ref, words: sc.words } : { kind: 'full_verse', items: sc.items });
          continue;
        }
        const fv = sc as Extract<Scene, { kind: 'full_verse' }>;
        if (fv.items.length > 1) for (const it of fv.items) drafts.push({ kind: 'full_verse', items: [it] });
        else {
          const parts = splitItem(fv.items[0]!);
          if (!parts) return doc;
          drafts.push({ kind: 'full_verse', items: [parts[0]] }, { kind: 'full_verse', items: [parts[1]] });
        }
      }
      return { ...doc, scenes: retime(doc.scenes, drafts, doc.totalFrames) };
    }

    case 'mergeWithNext': {
      const s = doc.scenes[a.index];
      const n = doc.scenes[a.index + 1];
      if (!s || !n || s.kind !== 'full_verse' || n.kind !== 'full_verse') return doc;
      const items = [...s.items];
      for (const it of n.items) {
        const last = items[items.length - 1]!;
        if (last.verse === it.verse && last.toPosition + 1 === it.fromPosition) items[items.length - 1] = { ...last, toPosition: it.toPosition, arabic: `${last.arabic} ${it.arabic}` };
        else items.push(it);
      }
      if (items.length > 4) return doc;
      const drafts: SceneDraft[] = [];
      doc.scenes.forEach((sc, i) => {
        if (i === a.index + 1) return;
        if (sc.kind === 'intro_bismillah') drafts.push({ kind: 'intro_bismillah' });
        else if (i === a.index) drafts.push({ kind: 'full_verse', items });
        else drafts.push(sc.kind === 'word_boxes' ? { kind: 'word_boxes', ref: sc.ref, words: sc.words } : { kind: 'full_verse', items: (sc as Extract<Scene, { kind: 'full_verse' }>).items });
      });
      // keep the merged scene's start and the following scenes' timing
      const scenes = doc.scenes.filter((_, i) => i !== a.index + 1).map((sc, i) => ({ ...sc, endFrame: i === a.index ? n.endFrame : sc.endFrame }));
      return { ...doc, scenes: scenes.map((sc, i) => ({ ...rebuild(drafts[i]!, sc), id: `scene-${i + 1}` })) };
    }

    case 'boundary': {
      const i = a.index;
      const cur = doc.scenes[i];
      const next = doc.scenes[i + 1];
      if (!cur || !next) return doc;
      const frame = Math.round(Math.max(cur.startFrame + MIN_SCENE_FRAMES, Math.min(next.endFrame - MIN_SCENE_FRAMES, a.frame)));
      return { ...doc, scenes: doc.scenes.map((s, k) => (k === i ? { ...s, endFrame: frame } : k === i + 1 ? { ...s, startFrame: frame } : s)) };
    }

    case 'evenTiming': {
      const spans = suggestEvenBoundaries(doc.totalFrames, doc.scenes.length);
      return { ...doc, scenes: doc.scenes.map((s, i) => ({ ...s, ...spans[i]! })) };
    }

    case 'audio': {
      const total = a.audio ? audioDurationToFrames(a.audio.durationMs / 1000, doc.fps) : doc.audio ? defaultTotal(doc) : doc.totalFrames;
      return rescale({ ...doc, audio: a.audio }, total);
    }

    case 'background':
      return { ...doc, background: a.background };
  }
}

function rebuild(d: SceneDraft, timing: { startFrame: number; endFrame: number; id: string }): Scene {
  if (d.kind === 'intro_bismillah') return { ...timing, kind: 'intro_bismillah' };
  if (d.kind === 'word_boxes') return { ...timing, kind: 'word_boxes', ref: d.ref, words: d.words };
  return { ...timing, kind: 'full_verse', items: d.items };
}

function defaultTotal(doc: RenderDocument): number {
  return doc.scenes.reduce((n, s) => n + (s.kind === 'intro_bismillah' ? secondsToFrame(4, doc.fps) : secondsToFrame(3, doc.fps)), 0);
}

/** Scales every boundary proportionally to a new total duration (e.g. after choosing the recitation). */
function rescale(doc: RenderDocument, total: number): RenderDocument {
  if (total === doc.totalFrames) return doc;
  const k = total / doc.totalFrames;
  const starts = doc.scenes.map((s) => Math.round(s.startFrame * k));
  for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i]!, starts[i - 1]! + 1);
  return { ...doc, totalFrames: total, scenes: doc.scenes.map((s, i) => ({ ...s, startFrame: starts[i]!, endFrame: i + 1 < starts.length ? starts[i + 1]! : total })) };
}

/** Moves one word between two adjacent pages of the same verse (mode A): delta −1 = left page loses its last word. */
export function shiftWord(sizes: number[], page: number, delta: 1 | -1): number[] | null {
  const next = [...sizes];
  if (page < 0 || page + 1 >= next.length) return null;
  next[page]! += delta;
  next[page + 1]! -= delta;
  if (next[page]! < 1 || next[page + 1]! < 1) return null;
  return next;
}

export { paginate, verseItem };

export const SURAH_LATIN_FALLBACK = (n: number) => `Sourate ${n}`;
