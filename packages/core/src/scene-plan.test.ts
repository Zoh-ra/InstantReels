import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import type { WordByWordSurahFixture, WordByWordVerse } from './content.ts';
import { bismillahIntroPolicy, sceneEndsVerse, surahNameCode, toArabicIndicDigits } from './quran-rules.ts';
import { RenderDocumentSchema, DEFAULT_BOX_STYLE, DEFAULT_FULL_VERSE_STYLE, DEFAULT_TITLE, DEFAULT_VERSE_DECORATION, defaultBranding } from './render-document.ts';
import { applyTiming, planFullVerseScenes, planScenes, resolveBismillahIntro, retime, type SceneDraft } from './scene-plan.ts';
import { suggestEvenBoundaries, validateTimeline } from './timeline.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const fatihah = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/quran/surah-001.wbw.json'), 'utf8')) as WordByWordSurahFixture;

/** Synthetic, clearly non-Quranic tokens — used only to exercise rules for other surahs. */
const synthetic = (verse: number, n: number): WordByWordVerse => ({
  verse,
  words: Array.from({ length: n }, (_, i) => ({ position: i + 1, arabic: `token-${verse}-${i + 1}`, french: `gloss-${verse}-${i + 1}`, sourceRow: 0 })),
});
const wordScenes = (d: SceneDraft[]) => d.filter((s): s is Extract<SceneDraft, { kind: 'word_boxes' }> => s.kind === 'word_boxes');

describe('Quranic rules', () => {
  it('Eastern Arabic digits and Surah Names codes', () => {
    assert.equal(toArabicIndicDigits(1), '١');
    assert.equal(toArabicIndicDigits(7), '٧');
    assert.equal(toArabicIndicDigits(286), '٢٨٦');
    assert.equal(surahNameCode(1), '001');
    assert.equal(surahNameCode(114), '114');
    assert.throws(() => surahNameCode(115));
  });
  it('Bismillah intro: never for At-Tawbah, separate element for Al-Fatihah, default elsewhere', () => {
    assert.deepEqual(bismillahIntroPolicy(9), { allowed: false, defaultEnabled: false, reason: 'at_tawbah' });
    assert.equal(bismillahIntroPolicy(1).reason, 'fatihah_verse_1_is_bismillah');
    assert.equal(bismillahIntroPolicy(2).defaultEnabled, true);
    assert.equal(resolveBismillahIntro(9, undefined), false);
    assert.throws(() => resolveBismillahIntro(9, true), /must not begin with a Bismillah/);
    assert.equal(resolveBismillahIntro(1, false), false);
  });
  it('verse-end only on the final word', () => {
    assert.equal(sceneEndsVerse(5, 9), false);
    assert.equal(sceneEndsVerse(9, 9), true);
    assert.throws(() => sceneEndsVerse(10, 9));
  });
});

describe('planScenes — Al-Fatihah (real workbook data)', () => {
  const drafts = planScenes({ surah: 1, verses: fatihah.verses });
  it('starts with the intro and keeps 1:1 as verse 1 (no duplication, no renumbering)', () => {
    assert.equal(drafts[0]?.kind, 'intro_bismillah');
    const ws = wordScenes(drafts);
    assert.equal(ws[0]?.ref.verse, 1);
    assert.equal(ws[0]?.ref.fromPosition, 1);
    assert.equal(ws.filter((s) => s.ref.verse === 1).flatMap((s) => s.words).length, 4);
    assert.equal(ws.length, 8);
  });
  it('splits 1:7 (9 words) as 5+4 with the verse end only in the second scene', () => {
    const v7 = wordScenes(drafts).filter((s) => s.ref.verse === 7);
    assert.deepEqual(v7.map((s) => [s.ref.fromPosition, s.ref.toPosition]), [[1, 5], [6, 9]]);
    assert.deepEqual(v7.map((s) => sceneEndsVerse(s.ref.toPosition, s.ref.verseWordCount)), [false, true]);
  });
  it('copies every word verbatim, once, in order', () => {
    const flat = wordScenes(drafts).flatMap((s) => s.words.map((w) => `${s.ref.verse}:${w.position}:${w.arabic}:${w.french}`));
    const source = fatihah.verses.flatMap((v) => v.words.map((w) => `${v.verse}:${w.position}:${w.arabic}:${w.french}`));
    assert.deepEqual(flat, source);
  });
  it('supports a manual 3+2+4 layout for 1:7 and can disable the intro', () => {
    const d = planScenes({ surah: 1, verses: fatihah.verses, layouts: new Map([[7, [3, 2, 4]]]), bismillahIntro: false });
    assert.notEqual(d[0]?.kind, 'intro_bismillah');
    const v7 = wordScenes(d).filter((s) => s.ref.verse === 7);
    assert.deepEqual(v7.map((s) => sceneEndsVerse(s.ref.toPosition, s.ref.verseWordCount)), [false, false, true]);
  });
});

describe('planScenes — At-Tawbah rule (synthetic tokens)', () => {
  it('no automatic Bismillah for surah 9', () => {
    const d = planScenes({ surah: 9, verses: [synthetic(1, 7)] });
    assert.equal(d[0]?.kind, 'word_boxes');
  });
  it('refuses an explicit Bismillah intro for surah 9', () => {
    assert.throws(() => planScenes({ surah: 9, verses: [synthetic(1, 7)], bismillahIntro: true }));
  });
});

describe('RenderDocumentSchema invariants', () => {
  const base = (surah: number, drafts: SceneDraft[]) => ({
    version: 3,
    mode: 'word_by_word',
    country: 'FR',
    maxBoxesPerScene: 5,
    fullVerseStyle: DEFAULT_FULL_VERSE_STYLE,
    fps: 30,
    width: 1080,
    height: 1920,
    totalFrames: 300,
    surah,
    audio: null,
    background: { kind: 'solid', color: '#060913' },
    branding: defaultBranding('Al-Huda International France', null),
    title: DEFAULT_TITLE,
    bismillah: { src: 'x.svg', color: '#ffffff', widthRatio: 0.78, centerY: 900, backdrop: null },
    verseDecoration: DEFAULT_VERSE_DECORATION,
    boxStyle: DEFAULT_BOX_STYLE,
    showTechnicalLabels: false,
    sceneFadeInFrames: 0,
    scenes: applyTiming(drafts, suggestEvenBoundaries(300, drafts.length)),
  });
  it('accepts the Al-Fatihah plan', () => {
    assert.equal(RenderDocumentSchema.safeParse(base(1, planScenes({ surah: 1, verses: fatihah.verses }))).success, true);
  });
  it('rejects a Bismillah intro in surah 9', () => {
    const drafts: SceneDraft[] = [{ kind: 'intro_bismillah' }, ...planScenes({ surah: 9, verses: [synthetic(1, 4)] })];
    const r = RenderDocumentSchema.safeParse(base(9, drafts));
    assert.equal(r.success, false);
    assert.match(JSON.stringify(r.error?.issues), /must not have a Bismillah/);
  });
  it('rejects duplicated or skipped words across split scenes', () => {
    const drafts = planScenes({ surah: 1, verses: fatihah.verses, bismillahIntro: false });
    const v7a = drafts.findIndex((s) => s.kind === 'word_boxes' && s.ref.verse === 7);
    const broken = structuredClone(drafts);
    const second = broken[v7a + 1];
    if (second?.kind === 'word_boxes') {
      second.ref.fromPosition = 5; // overlaps word 5
      second.words.unshift({ position: 5, arabic: 'dup', french: 'dup' });
    }
    assert.equal(RenderDocumentSchema.safeParse(base(1, broken)).success, false);
  });
});

describe('Mode B — full verse planning (synthetic tokens)', () => {
  const fv = (verse: number, n: number) => ({ verse, words: Array.from({ length: n }, (_, i) => ({ position: i + 1, arabic: `w${verse}-${i + 1}` })), translation: `translation of ${verse}` });
  it('one scene per verse, long verses split into balanced segments, never truncated', () => {
    const d = planFullVerseScenes({ surah: 2, verses: [fv(1, 1), fv(282, 128)] });
    assert.equal(d[0]?.kind, 'intro_bismillah');
    const segs = d.filter((s) => s.kind === 'full_verse').flatMap((s) => (s.kind === 'full_verse' ? s.items : []));
    const v282 = segs.filter((it) => it.verse === 282);
    assert.equal(v282.length, 6);
    assert.equal(v282.reduce((n, it) => n + it.toPosition - it.fromPosition + 1, 0), 128);
    assert.equal(v282.map((it) => it.arabic).join(' '), fv(282, 128).words.map((w) => w.arabic).join(' '));
    assert.ok(v282.every((it) => it.translation === 'translation of 282'));
    assert.deepEqual(v282.map((it) => sceneEndsVerse(it.toPosition, it.verseWordCount)), [false, false, false, false, false, true]);
  });
});

describe('retime — keeps the user timing when pagination changes', () => {
  it('re-paginating 1:7 from 5+4 to 3+2+4 keeps all other boundaries and the total', () => {
    const drafts = planScenes({ surah: 1, verses: fatihah.verses });
    const spans = suggestEvenBoundaries(870, drafts.length);
    const old = applyTiming(drafts, spans);
    const next = retime(old, planScenes({ surah: 1, verses: fatihah.verses, layouts: new Map([[7, [3, 2, 4]]]) }), 870);
    assert.equal(next.length, old.length + 1);
    assert.equal(next[next.length - 1]!.endFrame, 870);
    for (let i = 0; i < old.length - 2; i++) assert.deepEqual([next[i]!.startFrame, next[i]!.endFrame], [old[i]!.startFrame, old[i]!.endFrame]);
    const v7old = old.filter((s) => s.kind === 'word_boxes' && s.ref.verse === 7);
    const v7new = next.filter((s) => s.kind === 'word_boxes' && s.ref.verse === 7);
    assert.equal(v7new[0]!.startFrame, v7old[0]!.startFrame);
    assert.deepEqual(validateTimeline(next, 870), []);
  });
});
