'use client';

import type { Dispatch } from 'react';
import { Merge, Minus, Plus, RotateCcw, Scissors } from 'lucide-react';
import { sceneEndsVerse, type RenderDocument } from '@instantreels/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ColorField, Section, SliderField, SwitchField } from './controls';
import { pageSizesOf, shiftWord, type EditorAction } from './editor-state';
import { formatTime, parseSeconds } from './use-playback';

type PanelProps = { doc: RenderDocument; dispatch: Dispatch<EditorAction> };

export function SurahHeader({ doc, surahName }: { doc: RenderDocument; surahName: string }) {
  return (
    <Section eyebrow="Sourate" title={`${doc.surah}. ${surahName}`}>
      <p className="text-center text-6xl leading-tight text-lunar-white" style={{ fontFamily: "'QF Surah Names'" }} aria-hidden>
        {String(doc.surah).padStart(3, '0')}
      </p>
      <p className="text-xs text-steel">
        {doc.mode === 'word_by_word'
          ? 'Mot à mot · texte arabe et traduction du classeur du Dr Usama Nonnenmacher (non modifiables).'
          : 'Versets complets · texte arabe du classeur et traduction du pays choisi (non modifiables).'}
      </p>
    </Section>
  );
}

/** Verses, pagination (mode A) or segmentation (mode B), with scene navigation. */
export function ContentPanel({ doc, dispatch, currentScene, onSelectScene, surahName }: PanelProps & { currentScene: number; onSelectScene: (index: number) => void; surahName: string }) {
  const introIndex = doc.scenes.findIndex((s) => s.kind === 'intro_bismillah');
  return (
    <div>
      <SurahHeader doc={doc} surahName={surahName} />
      <Section eyebrow="Scènes" title={doc.mode === 'word_by_word' ? 'Versets et pagination' : 'Versets et découpage'}>
        <ol className="space-y-2">
          {introIndex >= 0 && (
            <li>
              <button type="button" onClick={() => onSelectScene(introIndex)} className={cn('flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm transition-colors', currentScene === introIndex ? 'border-ultraviolet/60 bg-void-canvas' : 'border-hairline hover:bg-void-canvas/60')}>
                <span>Introduction — Bismillah</span>
                <Badge variant="outline" className="rounded-full border-hairline text-amber">intro</Badge>
              </button>
            </li>
          )}
          {doc.mode === 'word_by_word' ? <WordPagination doc={doc} dispatch={dispatch} currentScene={currentScene} onSelectScene={onSelectScene} /> : <VerseSegments doc={doc} dispatch={dispatch} currentScene={currentScene} onSelectScene={onSelectScene} />}
        </ol>
      </Section>
    </div>
  );
}

function WordPagination({ doc, dispatch, currentScene, onSelectScene }: PanelProps & { currentScene: number; onSelectScene: (i: number) => void }) {
  const layouts = pageSizesOf(doc);
  return (
    <>
      {[...layouts.entries()].map(([verse, sizes]) => {
        const total = sizes.reduce((a, b) => a + b, 0);
        const scenes = doc.scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'word_boxes' && s.ref.verse === verse);
        const canAdd = sizes.length < total;
        const canRemove = sizes.length > 1 && Math.ceil(total / doc.maxBoxesPerScene) < sizes.length;
        const evenly = (n: number) => {
          const base = Math.floor(total / n);
          const extra = total % n;
          return Array.from({ length: n }, (_, k) => base + (k < extra ? 1 : 0));
        };
        return (
          <li key={verse} className="rounded-xl border border-hairline p-2">
            <div className="flex items-center justify-between gap-2 px-1 pb-2 text-sm">
              <span>Verset {verse}</span>
              <span className="text-xs text-steel">{total} mot{total > 1 ? 's' : ''} · {sizes.join('+')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {scenes.map(({ s, i }, k) => (
                <span key={s.id} className="flex items-center gap-1">
                  <button type="button" onClick={() => onSelectScene(i)} aria-label={`Scène ${i + 1}, verset ${verse}, ${sizes[k]} mots`} className={cn('min-h-9 rounded-full border px-3 text-xs transition-colors', currentScene === i ? 'border-ultraviolet bg-void-canvas text-lunar-white' : 'border-hairline text-steel hover:text-lunar-white')}>
                    {sizes[k]} mot{(sizes[k] ?? 0) > 1 ? 's' : ''}{s.kind === 'word_boxes' && sceneEndsVerse(s.ref.toPosition, s.ref.verseWordCount) ? ' · fin' : ''}
                  </button>
                  {k < scenes.length - 1 && (
                    <span className="flex">
                      <Button variant="ghost" size="icon-xs" aria-label={`Passer un mot de la scène ${k + 1} à la suivante`} disabled={!shiftWord(sizes, k, -1)} onClick={() => { const n = shiftWord(sizes, k, -1); if (n) dispatch({ type: 'pagination', verse, sizes: n }); }}>›</Button>
                      <Button variant="ghost" size="icon-xs" aria-label={`Ramener un mot de la scène ${k + 2} vers la précédente`} disabled={!shiftWord(sizes, k, 1) || (sizes[k] ?? 0) >= doc.maxBoxesPerScene} onClick={() => { const n = shiftWord(sizes, k, 1); if (n) dispatch({ type: 'pagination', verse, sizes: n }); }}>‹</Button>
                    </span>
                  )}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button variant="ghost" size="xs" disabled={!canRemove} onClick={() => dispatch({ type: 'pagination', verse, sizes: evenly(sizes.length - 1) })}><Minus /> scène</Button>
              <Button variant="ghost" size="xs" disabled={!canAdd} onClick={() => dispatch({ type: 'pagination', verse, sizes: evenly(sizes.length + 1) })}><Plus /> scène</Button>
              <Button variant="ghost" size="xs" onClick={() => dispatch({ type: 'resetPagination', verse })}><RotateCcw /> auto</Button>
            </div>
          </li>
        );
      })}
      <li className="pt-2">
        <SliderField id="max-boxes" label="Cadres maximum par scène (avancé)" value={doc.maxBoxesPerScene} min={1} max={8} unit="" onChange={(v) => dispatch({ type: 'maxBoxes', value: v })} />
      </li>
    </>
  );
}

function VerseSegments({ doc, dispatch, currentScene, onSelectScene }: PanelProps & { currentScene: number; onSelectScene: (i: number) => void }) {
  return (
    <>
      {doc.scenes.map((s, i) => {
        if (s.kind !== 'full_verse') return null;
        const next = doc.scenes[i + 1];
        const label = s.items.map((it) => (it.fromPosition === 1 && it.toPosition === it.verseWordCount ? `v${it.verse}` : `v${it.verse} (${it.fromPosition}–${it.toPosition}/${it.verseWordCount})`)).join(' + ');
        const canSplit = s.items.length > 1 || s.items[0]!.toPosition > s.items[0]!.fromPosition;
        const canMerge = next?.kind === 'full_verse' && s.items.length + next.items.length <= 4;
        return (
          <li key={s.id} className={cn('flex items-center justify-between gap-2 rounded-xl border p-2', currentScene === i ? 'border-ultraviolet/60 bg-void-canvas' : 'border-hairline')}>
            <button type="button" className="min-h-9 flex-1 truncate text-left text-sm" onClick={() => onSelectScene(i)}>{label}</button>
            <Button variant="ghost" size="icon-sm" aria-label={`Diviser la scène ${i + 1}`} disabled={!canSplit} onClick={() => dispatch({ type: 'splitScene', index: i })}><Scissors /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Fusionner la scène ${i + 1} avec la suivante`} disabled={!canMerge} onClick={() => dispatch({ type: 'mergeWithNext', index: i })}><Merge /></Button>
          </li>
        );
      })}
      <li className="text-xs text-steel">Diviser coupe un verset long entre deux mots ; fusionner regroupe jusqu’à 4 versets courts. Le texte n’est jamais tronqué.</li>
    </>
  );
}

export function StylePanel({ doc, dispatch }: PanelProps) {
  const b = doc.boxStyle;
  const f = doc.fullVerseStyle;
  const setB = (patch: Partial<typeof b>) => dispatch({ type: 'boxStyle', patch });
  const setF = (patch: Partial<typeof f>) => dispatch({ type: 'fullVerseStyle', patch });
  return (
    <div>
      {doc.mode === 'word_by_word' ? (
        <>
          <Section eyebrow="Cadres" title="Mots et traductions">
            <ColorField id="box-bg" label="Fond du cadre" value={b.background} onChange={(v) => setB({ background: v })} />
            <SliderField id="box-opacity" label="Opacité du fond" value={Math.round((parseInt(b.background.slice(7, 9) || 'ff', 16) / 255) * 100)} min={0} max={100} unit="%" onChange={(v) => setB({ background: b.background.slice(0, 7) + Math.round((v / 100) * 255).toString(16).padStart(2, '0') })} />
            <ColorField id="border" label="Bordure" value={b.borderColor} onChange={(v) => setB({ borderColor: v })} />
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="border-style" className="text-sm text-steel">Style de bordure</Label>
              <select id="border-style" value={b.borderStyle} onChange={(e) => setB({ borderStyle: e.target.value as typeof b.borderStyle })} className="h-9 rounded-full border border-hairline bg-void-canvas px-3 text-sm">
                <option value="solid">Pleine</option>
                <option value="dashed">Tirets</option>
                <option value="dotted">Pointillés</option>
                <option value="double">Double</option>
              </select>
            </div>
            <SliderField id="border-width" label="Épaisseur bordure" value={b.borderWidth} min={0} max={10} onChange={(v) => setB({ borderWidth: v })} />
            <ColorField id="glow" label="Halo lumineux" value={b.glowColor} onChange={(v) => setB({ glowColor: v })} />
            <SliderField id="glow-strength" label="Intensité du halo" value={b.glowStrength} min={0} max={1} step={0.05} unit="" onChange={(v) => setB({ glowStrength: v })} />
            <SliderField id="radius" label="Arrondi" value={b.radius} min={0} max={60} onChange={(v) => setB({ radius: v })} />
            <SliderField id="columns" label="Colonnes" value={b.columns} min={1} max={3} unit="" onChange={(v) => setB({ columns: v as 1 | 2 | 3 })} />
            <SliderField id="min-height" label="Hauteur minimale" value={b.minHeight} min={120} max={400} onChange={(v) => setB({ minHeight: v })} />
            <SliderField id="gap" label="Espacement" value={b.gap} min={0} max={60} onChange={(v) => setB({ gap: v })} />
            <SliderField id="padding" label="Marge intérieure" value={b.padding} min={4} max={60} onChange={(v) => setB({ padding: v })} />
          </Section>
          <Section eyebrow="Typographie" title="Texte">
            <ColorField id="arabic-color" label="Texte arabe" value={b.arabicColor} onChange={(v) => setB({ arabicColor: v })} />
            <SliderField id="arabic-size" label="Taille arabe" value={b.arabicSize} min={36} max={96} onChange={(v) => setB({ arabicSize: v })} />
            <ColorField id="french-color" label="Traduction" value={b.frenchColor} onChange={(v) => setB({ frenchColor: v })} />
            <SliderField id="french-size" label="Taille traduction" value={b.frenchSize} min={16} max={40} onChange={(v) => setB({ frenchSize: v })} />
          </Section>
        </>
      ) : (
        <Section eyebrow="Verset complet" title="Texte et panneau">
          <ColorField id="fv-arabic" label="Texte arabe" value={f.arabicColor} onChange={(v) => setF({ arabicColor: v })} />
          <SliderField id="fv-arabic-size" label="Taille arabe (base)" value={f.arabicSize} min={36} max={110} onChange={(v) => setF({ arabicSize: v })} />
          <ColorField id="fv-tr" label="Traduction" value={f.translationColor} onChange={(v) => setF({ translationColor: v })} />
          <SliderField id="fv-tr-size" label="Taille traduction (base)" value={f.translationSize} min={18} max={48} onChange={(v) => setF({ translationSize: v })} />
          <ColorField id="fv-panel" label="Fond du panneau" value={f.panelBackground} onChange={(v) => setF({ panelBackground: v })} />
          <ColorField id="fv-border" label="Bordure du panneau" value={f.panelBorderColor} onChange={(v) => setF({ panelBorderColor: v })} />
          <SliderField id="fv-radius" label="Arrondi" value={f.panelRadius} min={0} max={80} onChange={(v) => setF({ panelRadius: v })} />
          <SliderField id="fv-padding" label="Marge intérieure" value={f.panelPadding} min={8} max={100} onChange={(v) => setF({ panelPadding: v })} />
          <p className="text-xs text-steel">Les tailles diminuent automatiquement pour les versets longs ; si le texte ne tient pas, divisez la scène.</p>
        </Section>
      )}
      <Section eyebrow="Versets" title="Fin de verset">
        <SwitchField id="marker" label="Ornement arabe ۝" hint="Après le dernier mot du verset" checked={doc.verseDecoration.arabicMarker.enabled} onChange={(v) => dispatch({ type: 'arabicMarker', patch: { enabled: v } })} />
        <ColorField id="marker-color" label="Couleur de l’ornement" value={doc.verseDecoration.arabicMarker.color} onChange={(v) => dispatch({ type: 'arabicMarker', patch: { color: v } })} />
        <SliderField id="marker-scale" label="Taille de l’ornement" value={doc.verseDecoration.arabicMarker.scale} min={0.5} max={1.4} step={0.05} unit="×" onChange={(v) => dispatch({ type: 'arabicMarker', patch: { scale: v } })} />
        <SwitchField id="fr-number" label="Numéro du verset (traduction)" checked={doc.verseDecoration.frenchNumber.enabled} onChange={(v) => dispatch({ type: 'frenchNumber', patch: { enabled: v } })} />
        <ColorField id="fr-number-bg" label="Pastille du numéro" value={doc.verseDecoration.frenchNumber.background} onChange={(v) => dispatch({ type: 'frenchNumber', patch: { background: v } })} />
        <SliderField id="fade" label="Fondu d’entrée des scènes" value={doc.sceneFadeInFrames} min={0} max={30} unit=" img" onChange={(v) => dispatch({ type: 'fade', frames: v })} />
        <SwitchField id="tech" label="Repères techniques" hint="Désactivé = jamais visibles dans l’export" checked={doc.showTechnicalLabels} onChange={(v) => dispatch({ type: 'technicalLabels', value: v })} />
      </Section>
    </div>
  );
}

export function BrandPanel({ doc, dispatch }: PanelProps) {
  const t = doc.title;
  const br = doc.branding;
  const hasIntro = doc.scenes[0]?.kind === 'intro_bismillah';
  return (
    <div>
      <Section eyebrow="En-tête" title="Nom de la sourate (calligraphie)">
        <SwitchField id="title-on" label="Afficher la calligraphie" checked={t.enabled} onChange={(v) => dispatch({ type: 'title', patch: { enabled: v } })} />
        <SwitchField id="title-word" label="Préfixe « سورة »" checked={t.withSurahWord} onChange={(v) => dispatch({ type: 'title', patch: { withSurahWord: v } })} />
        <SwitchField id="title-scenes" label="Visible sur toutes les scènes" checked={t.showOnScenes} onChange={(v) => dispatch({ type: 'title', patch: { showOnScenes: v } })} />
        <ColorField id="title-color" label="Couleur du titre" value={t.color} onChange={(v) => dispatch({ type: 'title', patch: { color: v } })} />
        <SliderField id="title-size" label="Taille du titre" value={t.size} min={70} max={170} onChange={(v) => dispatch({ type: 'title', patch: { size: v } })} />
        <SliderField id="title-top" label="Position verticale du titre" value={t.top} min={60} max={240} onChange={(v) => dispatch({ type: 'title', patch: { top: v } })} />
        <div className="flex min-h-11 items-center justify-between">
          <Label className="text-sm text-steel">Alignement</Label>
          <div className="flex gap-1">
            {(['right', 'center', 'left'] as const).map((al) => (
              <Button key={al} size="xs" variant={t.align === al ? 'secondary' : 'ghost'} onClick={() => dispatch({ type: 'title', patch: { align: al } })}>{al === 'right' ? 'Droite' : al === 'center' ? 'Centre' : 'Gauche'}</Button>
            ))}
          </div>
        </div>
      </Section>
      <Section eyebrow="Introduction" title="Bismillah">
        <SwitchField
          id="intro-on"
          label="Scène d’introduction"
          hint={doc.surah === 9 ? 'Sourate At-Tawba : pas de Bismillah' : doc.surah === 1 ? 'Al-Fâtiha : le verset 1:1 reste dans les scènes' : 'Avant les versets'}
          checked={hasIntro}
          onChange={(v) => dispatch({ type: 'intro', enabled: v })}
        />
        {hasIntro && (
          <>
            <ColorField id="bsm-color" label="Couleur de la calligraphie" value={doc.bismillah.color} onChange={(v) => dispatch({ type: 'bismillah', patch: { color: v } })} />
            <SliderField id="bsm-width" label="Largeur de la calligraphie" value={doc.bismillah.widthRatio} min={0.4} max={doc.bismillah.backdrop ? 0.84 : 0.92} step={0.01} unit="" onChange={(v) => dispatch({ type: 'bismillah', patch: { widthRatio: v } })} />
            <SliderField id="bsm-y" label="Position verticale de la calligraphie" value={doc.bismillah.centerY} min={500} max={1300} onChange={(v) => dispatch({ type: 'bismillah', patch: { centerY: v } })} />
            <SwitchField id="bsm-backdrop" label="Panneau derrière la calligraphie" checked={doc.bismillah.backdrop !== null} onChange={(v) => dispatch({ type: 'bismillah', patch: { backdrop: v ? '#0c0f19b3' : null, widthRatio: v ? Math.min(0.84, doc.bismillah.widthRatio) : doc.bismillah.widthRatio } })} />
            <p className="text-xs text-steel">Durée : déplacez la limite de la scène « Bismillah » dans la chronologie.</p>
          </>
        )}
      </Section>
      <Section eyebrow="Pied de page" title="Marque et QR code">
        <SwitchField id="label-on" label="Libellé institutionnel" checked={br.labelVisible} onChange={(v) => dispatch({ type: 'branding', patch: { labelVisible: v } })} />
        <ColorField id="label-color" label="Couleur du libellé" value={br.labelColor} onChange={(v) => dispatch({ type: 'branding', patch: { labelColor: v } })} />
        <SliderField id="label-size" label="Taille du libellé" value={br.labelSize} min={22} max={52} onChange={(v) => dispatch({ type: 'branding', patch: { labelSize: v } })} />
        <SliderField id="label-bottom" label="Distance du libellé au bas" value={br.labelBottom} min={40} max={260} onChange={(v) => dispatch({ type: 'branding', patch: { labelBottom: v } })} />
        {br.qr ? (
          <>
            <SwitchField id="qr-on" label="QR code" checked={br.qr.visible} onChange={(v) => dispatch({ type: 'qr', patch: { visible: v } })} />
            <SliderField id="qr-size" label="Taille du QR" value={br.qr.size} min={120} max={240} onChange={(v) => { const half = v / 2 + 40; dispatch({ type: 'qr', patch: { size: v, centerX: Math.min(1080 - half, Math.max(half, br.qr!.centerX)) } }); }} />
            {/* keep the whole code (incl. its white frame) inside the 40 px safety margin */}
            <SliderField id="qr-x" label="Position horizontale du QR" value={br.qr.centerX} min={Math.ceil(br.qr.size / 2 + 40)} max={Math.floor(1080 - br.qr.size / 2 - 40)} onChange={(v) => dispatch({ type: 'qr', patch: { centerX: v } })} />
            <SliderField id="qr-bottom" label="Distance du QR au bas" value={br.qr.bottom} min={100} max={420} onChange={(v) => dispatch({ type: 'qr', patch: { bottom: v } })} />
          </>
        ) : (
          <p className="text-xs text-steel">Aucun QR code fourni pour ce pays (UK/SE : en attente des fichiers officiels).</p>
        )}
        <p className="text-xs text-steel">L’export vérifie l’absence de chevauchement et la lisibilité du QR.</p>
      </Section>
    </div>
  );
}

export function TimingPanel({ doc, dispatch, onSeek }: PanelProps & { onSeek: (f: number) => void }) {
  return (
    <div>
      <Section eyebrow="Synchronisation" title="Début et fin de chaque scène">
        <p className="text-xs text-steel">Saisissez les temps en secondes, déplacez les limites dans la chronologie, ou utilisez « Fin de scène ici » pendant la lecture (touche M).</p>
        <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'evenTiming' })}>Proposer une répartition uniforme</Button>
        <ol className="space-y-1.5">
          {doc.scenes.map((s, i) => (
            <li key={s.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm">
              <button type="button" className="truncate text-left text-steel hover:text-lunar-white" onClick={() => onSeek(s.startFrame)}>{i + 1}. {s.kind === 'intro_bismillah' ? 'Bismillah' : s.kind === 'word_boxes' ? `${s.ref.verse} (${s.ref.fromPosition}–${s.ref.toPosition})` : s.items.map((it) => it.verse).join('+')}</button>
              <span className="font-mono text-xs text-steel">{formatTime(s.startFrame, doc.fps)}</span>
              <input
                aria-label={`Fin de la scène ${i + 1} en secondes`}
                className="h-8 w-20 rounded-full border border-hairline bg-void-canvas px-2 text-right font-mono text-xs disabled:opacity-50"
                defaultValue={(s.endFrame / doc.fps).toFixed(2)}
                key={`${s.id}-${s.endFrame}`}
                disabled={i === doc.scenes.length - 1}
                inputMode="decimal"
                onBlur={(e) => {
                  const f = parseSeconds(e.target.value, doc.fps);
                  if (f !== null) dispatch({ type: 'boundary', index: i, frame: f });
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </li>
          ))}
        </ol>
        <p className="text-xs text-steel">La dernière scène se termine avec {doc.audio ? 'la récitation' : 'la vidéo'} ({formatTime(doc.totalFrames, doc.fps)}).</p>
      </Section>
    </div>
  );
}
