import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_BOX_STYLE,
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

/** Repository root (Next runs with cwd = apps/web). */
const repoRoot = () => resolve(process.cwd(), '../..');

export interface DemoProject {
  id: 'demo';
  title: string;
  doc: RenderDocument;
  bismillahSvg: string;
  sourceFile: string;
}

/**
 * Demo project until the database exists (Phase 2): real Surah 1 words from the workbook
 * fixture, same scene plan and timing as the validated 4K prototype.
 */
export function loadDemoProject(): DemoProject {
  const fixture = JSON.parse(readFileSync(resolve(repoRoot(), 'fixtures/quran/surah-001.wbw.json'), 'utf8')) as WordByWordSurahFixture;
  const bismillahSvg = readFileSync(resolve(repoRoot(), 'assets/branding/bismillah/bismillah.svg'), 'utf8');
  const fps = 30;
  const drafts = planScenes({ surah: fixture.surah, verses: fixture.verses });
  const totalFrames = secondsToFrame(29, fps);
  const spans = spansFromEndMarks([4, 7, 10, 13, 16, 19, 22, 25.5].map((s) => secondsToFrame(s, fps)), totalFrames);
  const doc = RenderDocumentSchema.parse({
    version: 2,
    fps,
    width: 1080,
    height: 1920,
    totalFrames,
    surah: fixture.surah,
    audio: null,
    background: { kind: 'solid', color: '#060913' },
    branding: defaultBranding('Al-Huda International France', '/branding/qr/fr.jpg'),
    title: DEFAULT_TITLE,
    bismillah: { src: '/branding/bismillah.svg', color: '#f2f6fa', widthRatio: 0.78, centerY: 900, backdrop: null },
    verseDecoration: DEFAULT_VERSE_DECORATION,
    boxStyle: DEFAULT_BOX_STYLE,
    showTechnicalLabels: false,
    sceneFadeInFrames: 8,
    scenes: applyTiming(drafts, spans),
  });
  return { id: 'demo', title: 'Démo — Al-Fâtiha (mot à mot)', doc, bismillahSvg, sourceFile: fixture.source.fileName };
}
