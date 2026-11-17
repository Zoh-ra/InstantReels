import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTiming, planScenes, secondsToFrame, spansFromEndMarks, type RenderDocument, type WordByWordSurahFixture } from '@instantreels/core';
import { buildInitialDocument } from './new-document';

/** Repository root (Next runs with cwd = apps/web). */
export const repoRoot = () => resolve(process.cwd(), '../..');

export function loadBismillahSvg(): string {
  return readFileSync(resolve(repoRoot(), 'assets/branding/bismillah/bismillah.svg'), 'utf8');
}

/**
 * Public demo (no account): real Surah 1 words from the workbook fixture, same scene plan and
 * timing as the validated 4K prototype. Not saved.
 */
export function loadDemoDocument(): RenderDocument {
  const fixture = JSON.parse(readFileSync(resolve(repoRoot(), 'fixtures/quran/surah-001.wbw.json'), 'utf8')) as WordByWordSurahFixture;
  const base = buildInitialDocument({ mode: 'word_by_word', country: 'FR', surah: 1, wordVerses: fixture.verses });
  const drafts = planScenes({ surah: 1, verses: fixture.verses });
  const totalFrames = secondsToFrame(29, 30);
  const spans = spansFromEndMarks([4, 7, 10, 13, 16, 19, 22, 25.5].map((s) => secondsToFrame(s, 30)), totalFrames);
  return { ...base, totalFrames, scenes: applyTiming(drafts, spans) };
}
