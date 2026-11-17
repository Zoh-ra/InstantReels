import type { CSSProperties } from 'react';
import { sceneEndsVerse, toArabicIndicDigits, type BoxStyle, type TitleStyle, type VerseDecoration, type WordBoxScene } from '@instantreels/core';
import { FONT_FAMILIES } from './fonts.ts';
import { CONTENT_ZONE, px, withAlpha } from './layout.ts';
import { TitleBlock } from './TitleBlock.tsx';

export interface WordBoxSceneLayerProps {
  scene: WordBoxScene;
  style: BoxStyle;
  decoration: VerseDecoration;
  title: TitleStyle;
  showTechnicalLabels: boolean;
  scale: number;
  width: number;
  height: number;
}

export function WordBoxSceneLayer({ scene, style, decoration, title, showTechnicalLabels, scale, width, height }: WordBoxSceneLayerProps) {
  const u = px(scale);
  const endsVerse = sceneEndsVerse(scene.ref.toPosition, scene.ref.verseWordCount);
  const lastPosition = scene.words[scene.words.length - 1]!.position;

  const zone: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width,
    height,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    padding: `${u(CONTENT_ZONE.top)} ${u(CONTENT_ZONE.side)} ${u(CONTENT_ZONE.bottom)}`,
    gap: u(28),
  };
  const grid: CSSProperties = { direction: 'rtl', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', gap: u(style.gap), width: '100%' };
  const box: CSSProperties = {
    boxSizing: 'border-box',
    width: `calc((100% - ${u(style.gap)}) / 2)`,
    minHeight: u(236),
    padding: u(style.padding),
    borderRadius: u(style.radius),
    border: `${u(style.borderWidth)} solid ${style.borderColor}`,
    background: style.background,
    boxShadow: `0 0 ${u(22)} ${withAlpha(style.glowColor, 0.45)}, inset 0 0 ${u(18)} ${withAlpha(style.glowColor, 0.18)}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: u(8),
    overflow: 'hidden',
  };
  const arabicLine: CSSProperties = { direction: 'rtl', unicodeBidi: 'isolate', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: u(10) };
  const arabic: CSSProperties = { fontFamily: `'${FONT_FAMILIES.quran}'`, fontSize: u(style.arabicSize), lineHeight: 1.75, color: style.arabicColor };
  const marker: CSSProperties = {
    fontFamily: `'${FONT_FAMILIES.quran}'`,
    fontSize: u(style.arabicSize * decoration.arabicMarker.scale),
    lineHeight: 1,
    color: decoration.arabicMarker.color,
  };
  const french: CSSProperties = { fontFamily: `'${FONT_FAMILIES.french}', sans-serif`, fontSize: u(style.frenchSize), lineHeight: 1.3, color: style.frenchColor, direction: 'ltr', textAlign: 'center', textWrap: 'balance', overflowWrap: 'anywhere' };
  const frNumber: CSSProperties = {
    display: 'inline-block',
    marginLeft: u(8),
    padding: `0 ${u(9)}`,
    minWidth: u(style.frenchSize * 1.1),
    borderRadius: 9999,
    background: decoration.frenchNumber.background,
    color: decoration.frenchNumber.color,
    fontSize: u(style.frenchSize * 0.8),
    lineHeight: 1.45,
    textAlign: 'center',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  };
  const techChip: CSSProperties = { fontFamily: `'${FONT_FAMILIES.french}', sans-serif`, fontSize: u(22), color: '#858b98', direction: 'ltr' };
  const { surah, verse, fromPosition, toPosition } = scene.ref;

  return (
    <>
      {title.enabled && title.showOnScenes && <TitleBlock surah={surah} title={title} scale={scale} />}
      <div style={zone} data-scene-id={scene.id} data-verse={verse} data-ends-verse={endsVerse}>
        {showTechnicalLabels && <div style={techChip} data-role="technical-label">{`${surah}:${verse} · ${fromPosition}–${toPosition}`}</div>}
        <div style={grid}>
          {scene.words.map((w) => {
            const isVerseEnd = endsVerse && w.position === lastPosition;
            return (
              <div key={w.position} style={box} data-role="word-box" data-position={w.position}>
                <div style={arabicLine}>
                  <span style={arabic} data-role="arabic" lang="ar">
                    {w.arabic}
                  </span>
                  {isVerseEnd && decoration.arabicMarker.enabled && (
                    <span style={marker} data-role="verse-marker" data-verse={verse} lang="ar">
                      {toArabicIndicDigits(verse)}
                    </span>
                  )}
                </div>
                <div style={french} lang="fr">
                  <span data-role="french">{w.french}</span>
                  {isVerseEnd && decoration.frenchNumber.enabled && (
                    <span style={frNumber} data-role="verse-number-fr" data-verse={verse}>
                      {String(verse)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
