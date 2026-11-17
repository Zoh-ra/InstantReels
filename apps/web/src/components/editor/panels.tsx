'use client';

import type { Dispatch } from 'react';
import { sceneEndsVerse, type RenderDocument } from '@instantreels/core';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ColorField, Section, SliderField, SwitchField } from './controls';
import { SURAH_LATIN_NAMES, type EditorAction } from './editor-state';

type PanelProps = { doc: RenderDocument; dispatch: Dispatch<EditorAction> };

/** Surah + verses + automatic pagination (read-only until the Phase 3 pagination editor). */
export function ContentPanel({ doc, currentScene, onSelectScene }: { doc: RenderDocument; currentScene: number; onSelectScene: (index: number) => void }) {
  const verses = new Map<number, { count: number; scenes: number[] }>();
  doc.scenes.forEach((s, i) => {
    if (s.kind !== 'word_boxes') return;
    const v = verses.get(s.ref.verse) ?? { count: s.ref.verseWordCount, scenes: [] };
    v.scenes.push(i);
    verses.set(s.ref.verse, v);
  });
  const introIndex = doc.scenes.findIndex((s) => s.kind === 'intro_bismillah');
  return (
    <div>
      <Section eyebrow="Sourate" title={`${doc.surah}. ${SURAH_LATIN_NAMES[doc.surah] ?? ''}`}>
        <p className="text-center text-6xl leading-tight text-lunar-white" style={{ fontFamily: "'QF Surah Names'" }} aria-hidden>
          {String(doc.surah).padStart(3, '0')}
        </p>
        <p className="text-xs text-steel">Mode mot à mot · données du classeur du Dr Usama Nonnenmacher (texte non modifiable).</p>
      </Section>
      <Section eyebrow="Scènes" title="Versets et pagination">
        <ol className="space-y-2">
          {introIndex >= 0 && (
            <li>
              <button type="button" onClick={() => onSelectScene(introIndex)} className={cn('flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm transition-colors', currentScene === introIndex ? 'border-ultraviolet/60 bg-void-canvas' : 'border-hairline hover:bg-void-canvas/60')}>
                <span>Introduction — Bismillah</span>
                <Badge variant="outline" className="rounded-full border-hairline text-amber">intro</Badge>
              </button>
            </li>
          )}
          {[...verses.entries()].map(([verse, info]) => (
            <li key={verse} className="rounded-xl border border-hairline p-2">
              <div className="flex items-center justify-between px-1 pb-2 text-sm">
                <span>Verset {verse}</span>
                <span className="text-xs text-steel">{info.count} mot{info.count > 1 ? 's' : ''}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {info.scenes.map((i, k) => {
                  const s = doc.scenes[i]!;
                  if (s.kind !== 'word_boxes') return null;
                  const n = s.ref.toPosition - s.ref.fromPosition + 1;
                  return (
                    <button key={i} type="button" onClick={() => onSelectScene(i)} aria-label={`Scène ${i + 1}, verset ${verse}, mots ${s.ref.fromPosition} à ${s.ref.toPosition}`}
                      className={cn('min-h-9 rounded-full border px-3 text-xs transition-colors', currentScene === i ? 'border-ultraviolet bg-void-canvas text-lunar-white' : 'border-hairline text-steel hover:text-lunar-white')}>
                      {info.scenes.length > 1 ? `${k + 1}/${info.scenes.length} · ` : ''}{n} mot{n > 1 ? 's' : ''}{sceneEndsVerse(s.ref.toPosition, s.ref.verseWordCount) ? ' · fin' : ''}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-steel">Pagination automatique (5 cadres max). L’édition manuelle (5+2, 3+4…) arrive en phase 3.</p>
      </Section>
    </div>
  );
}

export function StylePanel({ doc, dispatch }: PanelProps) {
  const b = doc.boxStyle;
  const set = (patch: Partial<typeof b>) => dispatch({ type: 'boxStyle', patch });
  return (
    <div>
      <Section eyebrow="Cadres" title="Mots et traductions">
        <ColorField id="border" label="Bordure" value={b.borderColor} onChange={(v) => set({ borderColor: v })} />
        <ColorField id="glow" label="Halo" value={b.glowColor} onChange={(v) => set({ glowColor: v })} />
        <ColorField id="arabic-color" label="Texte arabe" value={b.arabicColor} onChange={(v) => set({ arabicColor: v })} />
        <ColorField id="french-color" label="Traduction" value={b.frenchColor} onChange={(v) => set({ frenchColor: v })} />
        <SliderField id="arabic-size" label="Taille arabe" value={b.arabicSize} min={40} max={80} onChange={(v) => set({ arabicSize: v })} />
        <SliderField id="french-size" label="Taille traduction" value={b.frenchSize} min={18} max={34} onChange={(v) => set({ frenchSize: v })} />
        <SliderField id="radius" label="Arrondi" value={b.radius} min={0} max={60} onChange={(v) => set({ radius: v })} />
        <SliderField id="border-width" label="Épaisseur bordure" value={b.borderWidth} min={0} max={8} onChange={(v) => set({ borderWidth: v })} />
      </Section>
      <Section eyebrow="Versets" title="Fin de verset">
        <SwitchField id="marker" label="Ornement arabe ۝" hint="Après le dernier mot du verset" checked={doc.verseDecoration.arabicMarker.enabled} onChange={(v) => dispatch({ type: 'arabicMarker', patch: { enabled: v } })} />
        <ColorField id="marker-color" label="Couleur de l’ornement" value={doc.verseDecoration.arabicMarker.color} onChange={(v) => dispatch({ type: 'arabicMarker', patch: { color: v } })} />
        <SwitchField id="fr-number" label="Numéro en français" hint="Après la dernière traduction" checked={doc.verseDecoration.frenchNumber.enabled} onChange={(v) => dispatch({ type: 'frenchNumber', patch: { enabled: v } })} />
        <SwitchField id="tech" label="Repères techniques" hint="Désactivé = jamais visibles dans l’export" checked={doc.showTechnicalLabels} onChange={(v) => dispatch({ type: 'technicalLabels', value: v })} />
      </Section>
    </div>
  );
}

export function BrandPanel({ doc, dispatch }: PanelProps) {
  const t = doc.title;
  const br = doc.branding;
  return (
    <div>
      <Section eyebrow="En-tête" title="Nom de la sourate">
        <SwitchField id="title-on" label="Calligraphie du titre" checked={t.enabled} onChange={(v) => dispatch({ type: 'title', patch: { enabled: v } })} />
        <SwitchField id="title-word" label="Préfixe « سورة »" checked={t.withSurahWord} onChange={(v) => dispatch({ type: 'title', patch: { withSurahWord: v } })} />
        <ColorField id="title-color" label="Couleur" value={t.color} onChange={(v) => dispatch({ type: 'title', patch: { color: v } })} />
        <SliderField id="title-size" label="Taille" value={t.size} min={70} max={160} onChange={(v) => dispatch({ type: 'title', patch: { size: v } })} />
        <SliderField id="title-top" label="Position verticale" value={t.top} min={110} max={220} onChange={(v) => dispatch({ type: 'title', patch: { top: v } })} />
      </Section>
      <Section eyebrow="Introduction" title="Bismillah">
        <ColorField id="bsm-color" label="Couleur" value={doc.bismillah.color} onChange={(v) => dispatch({ type: 'bismillah', patch: { color: v } })} />
        <SliderField id="bsm-width" label="Largeur" value={doc.bismillah.widthRatio} min={0.5} max={0.9} step={0.01} unit="" onChange={(v) => dispatch({ type: 'bismillah', patch: { widthRatio: v } })} />
      </Section>
      <Section eyebrow="Pied de page" title="Al-Huda International">
        <SwitchField id="label-on" label="Libellé institutionnel" checked={br.labelVisible} onChange={(v) => dispatch({ type: 'branding', patch: { labelVisible: v } })} />
        <ColorField id="label-color" label="Couleur" value={br.labelColor} onChange={(v) => dispatch({ type: 'branding', patch: { labelColor: v } })} />
        <SliderField id="label-size" label="Taille" value={br.labelSize} min={24} max={48} onChange={(v) => dispatch({ type: 'branding', patch: { labelSize: v } })} />
        {br.qr && (
          <>
            <SwitchField id="qr-on" label="QR code (France)" checked={br.qr.visible} onChange={(v) => dispatch({ type: 'qr', patch: { visible: v } })} />
            <SliderField id="qr-size" label="Taille du QR" value={br.qr.size} min={120} max={220} onChange={(v) => dispatch({ type: 'qr', patch: { size: v } })} />
          </>
        )}
        <p className="text-xs text-steel">Les positions sont contrôlées à l’export : aucun chevauchement, marges respectées.</p>
      </Section>
    </div>
  );
}
