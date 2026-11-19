import type { CSSProperties } from 'react';
import { surahNameCode, type TitleStyle } from '@instantreels/core';
import { FONT_FAMILIES } from './fonts.ts';
import { px } from './layout.ts';
import { SURAH_TITLE_EM } from './surah-title-metrics.ts';

/** Title width available between the 60 px side margins of the 1080 canvas. */
const TITLE_MAX_WIDTH = 960;

/** Requested size, reduced only if the calligraphy would not fit the canvas width. */
export function fittedTitleSize(surah: number, title: TitleStyle): number {
  const em = SURAH_TITLE_EM[surah - 1]?.[title.withSurahWord ? 1 : 0] ?? 4;
  return Math.min(title.size, Math.floor(TITLE_MAX_WIDTH / em));
}

/**
 * Calligraphic Surah name from the Quran Foundation Surah Names font.
 * The font maps "001"…"114" (and "surah") to calligraphic ligatures; nothing is drawn by us.
 * Latin codes are laid out LTR, so "<code> surah" displays as [name][سورة] — read right-to-left: «سورة <name>».
 */
export function TitleBlock({ surah, title, scale }: { surah: number; title: TitleStyle; scale: number }) {
  const u = px(scale);
  const style: CSSProperties = {
    position: 'absolute',
    top: u(title.top),
    left: u(60),
    right: u(60),
    textAlign: title.align,
    fontFamily: `'${FONT_FAMILIES.surahNames}'`,
    fontSize: u(fittedTitleSize(surah, title)),
    lineHeight: 1.25,
    color: title.color,
    direction: 'ltr',
    unicodeBidi: 'isolate',
    whiteSpace: 'nowrap',
  };
  const text = title.withSurahWord ? `${surahNameCode(surah)} surah` : surahNameCode(surah);
  return (
    <div style={style}>
      <span data-role="title" data-surah={surah}>
        {text}
      </span>
    </div>
  );
}
