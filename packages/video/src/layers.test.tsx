import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_BOX_STYLE, DEFAULT_TITLE, DEFAULT_VERSE_DECORATION, applyTiming, defaultBranding, planScenes, suggestEvenBoundaries, type WordByWordSurahFixture, type WordBoxScene } from '@instantreels/core';
import { BrandingLayer } from './BrandingLayer.tsx';
import { WordBoxSceneLayer } from './WordBoxScene.tsx';

const ROOT = resolve(import.meta.dirname, '../../..');
const fatihah = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/quran/surah-001.wbw.json'), 'utf8')) as WordByWordSurahFixture;
const drafts = planScenes({ surah: 1, verses: fatihah.verses, bismillahIntro: false });
const scenes = applyTiming(drafts, suggestEvenBoundaries(800, drafts.length)) as WordBoxScene[];
const render = (scene: WordBoxScene, showTechnicalLabels = false) =>
  renderToStaticMarkup(WordBoxSceneLayer({ scene, style: DEFAULT_BOX_STYLE, decoration: DEFAULT_VERSE_DECORATION, title: DEFAULT_TITLE, showTechnicalLabels, scale: 1, width: 1080, height: 1920 }));
const count = (html: string, role: string) => html.split(`data-role="${role}"`).length - 1;

describe('WordBoxSceneLayer', () => {
  const v7 = scenes.filter((s) => s.ref.verse === 7);
  it('intermediate 1:7 scene: no Arabic marker, no French number', () => {
    const html = render(v7[0]!);
    assert.equal(count(html, 'verse-marker'), 0);
    assert.equal(count(html, 'verse-number-fr'), 0);
  });
  it('final 1:7 scene: one ٧ marker and one "7", both on word 9', () => {
    const html = render(v7[1]!);
    assert.equal(count(html, 'verse-marker'), 1);
    assert.equal(count(html, 'verse-number-fr'), 1);
    assert.match(html, /data-role="verse-marker" data-verse="7" lang="ar">٧</);
    assert.match(html, /data-role="verse-number-fr" data-verse="7">7</);
    const lastBox = html.slice(html.lastIndexOf('data-role="word-box"'));
    assert.match(lastBox, /data-position="9"/);
    assert.match(lastBox, /verse-marker/);
  });
  it('keeps Arabic and French text verbatim (marker/number are separate elements)', () => {
    const scene = v7[1]!;
    const html = render(scene);
    for (const w of scene.words) {
      assert.ok(html.includes(`lang="ar">${w.arabic}</span>`), `arabic ${w.position}`);
      assert.ok(html.includes(`data-role="french">${w.french.replaceAll('’', '’')}</span>`), `french ${w.position}`);
    }
  });
  it('no technical label unless explicitly enabled', () => {
    assert.equal(count(render(scenes[0]!), 'technical-label'), 0);
    assert.equal(count(render(scenes[0]!, true), 'technical-label'), 1);
  });
  it('every verse gets exactly one marker/number pair across its scenes', () => {
    for (let verse = 1; verse <= 7; verse++) {
      const html = scenes.filter((s) => s.ref.verse === verse).map((s) => render(s)).join('');
      assert.equal(count(html, 'verse-marker'), 1, `verse ${verse}`);
      assert.equal(count(html, 'verse-number-fr'), 1, `verse ${verse}`);
    }
  });
});

describe('BrandingLayer', () => {
  it('hides QR and label when disabled', () => {
    const b = defaultBranding('Al-Huda International France', 'qr.png');
    const html = renderToStaticMarkup(BrandingLayer({ branding: { ...b, labelVisible: false, qr: { ...b.qr!, visible: false } }, scale: 1, width: 1080, height: 1920 }));
    assert.equal(count(html, 'qr'), 0);
    assert.equal(count(html, 'label'), 0);
  });
});
