import type { CSSProperties } from 'react';
import { surahNameCode, type TitleStyle } from '@instantreels/core';
import { FONT_FAMILIES } from './fonts.ts';
import { px } from './layout.ts';

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
    fontSize: u(title.size),
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
