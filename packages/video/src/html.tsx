import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fontFaceCss, type FontSources } from './fonts.ts';

/**
 * Wraps a layer in a standalone, transparent HTML document of the exact output size.
 * Used by the worker (Playwright screenshot) — the browser preview renders the same
 * layer components directly in React.
 */
export function buildLayerDocument(layer: ReactElement, opts: { width: number; height: number; fonts: FontSources }): string {
  const body = renderToStaticMarkup(layer);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaceCss(opts.fonts)}
html,body{margin:0;padding:0;background:transparent;width:${opts.width}px;height:${opts.height}px;overflow:hidden;}
*{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;}
</style></head><body>${body}</body></html>`;
}
