import type { CSSProperties } from 'react';
import type { BismillahStyle, TitleStyle } from '@instantreels/core';
import { px } from './layout.ts';
import { TitleBlock } from './TitleBlock.tsx';

export interface IntroLayerProps {
  surah: number;
  bismillah: BismillahStyle;
  /** inline SVG markup of the traced calligraphy (fill="currentColor") */
  bismillahSvg: string;
  title: TitleStyle;
  scale: number;
  width: number;
  height: number;
}

/** Dedicated Bismillah introduction: the owner-supplied calligraphy, recoloured via currentColor only. */
export function IntroSceneLayer({ surah, bismillah, bismillahSvg, title, scale, width, height }: IntroLayerProps) {
  const u = px(scale);
  const w = width * bismillah.widthRatio;
  const pad = bismillah.backdrop ? 40 * scale : 0;
  // outer panel (optional backdrop) is centred; the measured calligraphy box keeps exactly widthRatio × width
  const holder: CSSProperties = {
    position: 'absolute',
    left: (width - w) / 2 - pad,
    top: u(bismillah.centerY),
    width: w + 2 * pad,
    transform: 'translateY(-50%)',
    boxSizing: 'border-box',
    padding: pad,
    borderRadius: u(28),
    background: bismillah.backdrop ?? 'transparent',
    color: bismillah.color,
    lineHeight: 0,
  };
  // the SVG is our own traced asset (not user HTML); sized by its container
  const svg = bismillahSvg.replace('<svg ', '<svg width="100%" style="display:block;height:auto" ');
  return (
    <>
      {title.enabled && title.showOnIntro && <TitleBlock surah={surah} title={title} scale={scale} />}
      <div style={holder} data-role="bismillah-panel">
        <div data-role="bismillah" style={{ width: w }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </>
  );
}
