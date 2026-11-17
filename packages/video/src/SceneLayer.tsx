import type { RenderDocument, Scene } from '@instantreels/core';
import { FullVerseSceneLayer } from './FullVerseScene.tsx';
import { IntroSceneLayer } from './IntroScene.tsx';
import { WordBoxSceneLayer } from './WordBoxScene.tsx';

const TRANSLATION_LANG = { FR: 'fr', UK: 'en', SE: 'sv' } as const;

/** Single entry point used by BOTH the editor preview and the render worker. */
export function SceneLayer({ doc, scene, bismillahSvg, scale, width, height }: { doc: RenderDocument; scene: Scene; bismillahSvg: string; scale: number; width: number; height: number }) {
  if (scene.kind === 'intro_bismillah') {
    return <IntroSceneLayer surah={doc.surah} bismillah={doc.bismillah} bismillahSvg={bismillahSvg} title={doc.title} scale={scale} width={width} height={height} />;
  }
  if (scene.kind === 'word_boxes') {
    return <WordBoxSceneLayer scene={scene} style={doc.boxStyle} decoration={doc.verseDecoration} title={doc.title} showTechnicalLabels={doc.showTechnicalLabels} scale={scale} width={width} height={height} />;
  }
  return (
    <FullVerseSceneLayer
      scene={scene}
      style={doc.fullVerseStyle}
      decoration={doc.verseDecoration}
      title={doc.title}
      showTechnicalLabels={doc.showTechnicalLabels}
      translationLang={TRANSLATION_LANG[doc.country]}
      scale={scale}
      width={width}
      height={height}
    />
  );
}
