import type { CSSProperties } from 'react';
import { sceneEndsVerse, toArabicIndicDigits, type FullVerseScene, type FullVerseStyle, type TitleStyle, type VerseDecoration } from '@instantreels/core';
import { FONT_FAMILIES } from './fonts.ts';
import { CONTENT_ZONE, px } from './layout.ts';
import { TitleBlock } from './TitleBlock.tsx';

export interface FullVerseSceneLayerProps {
  scene: FullVerseScene;
  style: FullVerseStyle;
  decoration: VerseDecoration;
  title: TitleStyle;
  showTechnicalLabels: boolean;
  /** RTL text direction of the translation is never needed (FR/EN/SV) */
  translationLang: string;
  scale: number;
  width: number;
  height: number;
}

/**
 * Full-verse layout: complete Arabic verse (or a word segment of a long verse) with the
 * verse-end ornament, then the complete translation followed by the verse number.
 * Font size steps down for long text; the renderer refuses any overflow (never truncated).
 */
export function fittedSizes(scene: FullVerseScene, style: FullVerseStyle): { arabic: number; translation: number } {
  const arabicChars = scene.items.reduce((n, it) => n + it.arabic.length, 0);
  const translationChars = scene.items.reduce((n, it) => n + it.translation.length, 0);
  const arabicFactor = arabicChars > 320 ? 0.6 : arabicChars > 220 ? 0.7 : arabicChars > 140 ? 0.82 : 1;
  const translationFactor = translationChars > 700 ? 0.62 : translationChars > 450 ? 0.72 : translationChars > 260 ? 0.85 : 1;
  return { arabic: Math.round(style.arabicSize * arabicFactor), translation: Math.round(style.translationSize * translationFactor) };
}

export function FullVerseSceneLayer({ scene, style, decoration, title, showTechnicalLabels, translationLang, scale, width, height }: FullVerseSceneLayerProps) {
  const u = px(scale);
  const sizes = fittedSizes(scene, style);
  const zone: CSSProperties = {
    position: 'absolute', left: 0, top: 0, width, height, boxSizing: 'border-box',
    padding: `${u(CONTENT_ZONE.top)} ${u(CONTENT_ZONE.side)} ${u(CONTENT_ZONE.bottom)}`,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  };
  const panel: CSSProperties = {
    boxSizing: 'border-box', width: '100%', maxHeight: '100%', overflow: 'hidden',
    padding: u(style.panelPadding), borderRadius: u(style.panelRadius),
    background: style.panelBackground, border: `${u(2)} solid ${style.panelBorderColor}`,
    display: 'flex', flexDirection: 'column', gap: u(26),
  };
  const arabic: CSSProperties = {
    fontFamily: `'${FONT_FAMILIES.quran}'`, fontSize: u(sizes.arabic), lineHeight: 2.05, color: style.arabicColor,
    direction: 'rtl', textAlign: 'center', unicodeBidi: 'isolate', overflowWrap: 'normal',
  };
  const marker: CSSProperties = { fontFamily: `'${FONT_FAMILIES.quran}'`, color: decoration.arabicMarker.color, fontSize: `${decoration.arabicMarker.scale}em`, whiteSpace: 'nowrap' };
  const translation: CSSProperties = {
    fontFamily: `'${FONT_FAMILIES.french}', sans-serif`, fontSize: u(sizes.translation), lineHeight: 1.4, color: style.translationColor,
    textAlign: 'center', direction: 'ltr', textWrap: 'pretty',
  };
  const num: CSSProperties = {
    display: 'inline-block', marginLeft: u(10), padding: `0 ${u(10)}`, minWidth: u(sizes.translation * 1.1), borderRadius: 9999,
    background: decoration.frenchNumber.background, color: decoration.frenchNumber.color, fontSize: '0.8em', lineHeight: 1.45, textAlign: 'center', whiteSpace: 'nowrap',
  };
  const first = scene.items[0]!;
  return (
    <>
      {title.enabled && title.showOnScenes && <TitleBlock surah={first.surah} title={title} scale={scale} />}
      <div style={zone} data-scene-id={scene.id}>
        <div style={panel} data-role="verse-panel">
          {showTechnicalLabels && (
            <div data-role="technical-label" style={{ fontFamily: `'${FONT_FAMILIES.french}', sans-serif`, fontSize: u(22), color: '#858b98', textAlign: 'center' }}>
              {scene.items.map((it) => `${it.surah}:${it.verse} (${it.fromPosition}–${it.toPosition}/${it.verseWordCount})`).join(' · ')}
            </div>
          )}
          {scene.items.map((it) => {
            const ends = sceneEndsVerse(it.toPosition, it.verseWordCount);
            return (
              <div key={`${it.verse}:${it.fromPosition}`} style={{ display: 'flex', flexDirection: 'column', gap: u(18) }} data-verse={it.verse}>
                <p style={{ ...arabic, margin: 0 }} lang="ar">
                  <span data-role="arabic">{it.arabic}</span>
                  {ends && decoration.arabicMarker.enabled && (
                    <>
                      {' '}
                      <span style={marker} data-role="verse-marker" data-verse={it.verse}>{toArabicIndicDigits(it.verse)}</span>
                    </>
                  )}
                </p>
                <p style={{ ...translation, margin: 0 }} lang={translationLang}>
                  <span data-role="translation">{it.translation}</span>
                  {decoration.frenchNumber.enabled && (
                    <span style={num} data-role="verse-number-fr" data-verse={it.verse}>{String(it.verse)}</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
