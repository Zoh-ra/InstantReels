'use client';

import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clapperboard, Clock, Film, Layers, Loader2, Palette, Stamp } from 'lucide-react';
import type { RenderDocument } from '@instantreels/core';
import { saveProject } from '@/app/actions/projects';
import { ReelPreview, sceneAtFrame } from '@/components/reel/ReelPreview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSignedUrls, webUrl } from '@/lib/assets-client';
import { cn } from '@/lib/utils';
import { editorReducer } from './editor-state';
import { ExportPanel } from './ExportPanel';
import { LayoutAudit, type LayoutIssue } from './LayoutAudit';
import { MediaPanel } from './MediaPanel';
import { BrandPanel, ContentPanel, StylePanel, TimingPanel } from './panels';
import { SceneTimeline, Transport } from './Timeline';
import { usePlayback } from './use-playback';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'local';

export interface EditorProject {
  id: string;
  title: string;
  version: number;
}

export function EditorShell({ project, initialDoc, bismillahSvg, surahName }: { project: EditorProject | null; initialDoc: RenderDocument; bismillahSvg: string; surahName: string }) {
  const [doc, rawDispatch] = useReducer(editorReducer, initialDoc);
  const [title, setTitle] = useState(project?.title ?? 'Démo — Al-Fâtiha');
  const [save, setSave] = useState<SaveState>(project ? 'saved' : 'local');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [layoutIssues, setLayoutIssues] = useState<LayoutIssue[]>([]);
  const version = useRef(project?.version ?? 0);
  const first = useRef(true);
  const audioEl = useRef<HTMLAudioElement>(null);
  const dispatch = useCallback((a: Parameters<typeof rawDispatch>[0]) => {
    rawDispatch(a);
    if (project) setSave((s) => (s === 'conflict' ? s : 'dirty'));
  }, [project]);

  const signed = useSignedUrls([doc.audio?.src, doc.background.kind === 'video' ? doc.background.src : null, doc.branding.qr?.src]);
  const audioUrl = webUrl(doc.audio?.src, signed);
  const backgroundUrl = doc.background.kind === 'video' ? webUrl(doc.background.src, signed) : null;
  const qrUrl = webUrl(doc.branding.qr?.src, signed);

  const { frame, playing, seek, toggle } = usePlayback(doc.totalFrames, doc.fps, audioUrl ? audioEl : undefined);
  const { index: currentScene } = sceneAtFrame(doc, frame);
  const [mobileTab, setMobileTab] = useState('content');
  const selectScene = (i: number) => seek(doc.scenes[i]!.startFrame);
  const markEnd = useCallback(() => {
    if (currentScene < doc.scenes.length - 1) dispatch({ type: 'boundary', index: currentScene, frame });
  }, [currentScene, doc.scenes.length, frame, dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'm' || e.key === 'M') markEnd();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [markEnd]);

  // ── autosave (debounced, optimistic locking, server-side text verification) ──
  const doSave = useCallback(async (): Promise<boolean> => {
    if (!project) return true;
    setSave('saving');
    const r = await saveProject(project.id, doc, version.current, title);
    if (r.ok) {
      version.current = r.data.version;
      setSave('saved');
      setSaveError(null);
      return true;
    }
    setSave(r.error === 'CONFLICT' ? 'conflict' : 'error');
    setSaveError(r.error === 'CONFLICT' ? 'Ce projet a été modifié dans un autre onglet. Rechargez la page pour récupérer la dernière version.' : r.error);
    return false;
  }, [project, doc, title]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!project || save !== 'dirty') return;
    const t = setTimeout(() => void doSave(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-armed on every edit; doSave reads the latest doc
  }, [doc, title, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save === 'dirty' || save === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  const ensureSaved = useCallback(async () => {
    if (save === 'saved' || save === 'local') return true;
    if (save === 'conflict') return false;
    return doSave();
  }, [save, doSave]);

  const saveBadge = {
    saved: { icon: <Check className="size-3.5" />, text: 'Enregistré', cls: 'text-aurora-mint' },
    dirty: { icon: <Clock className="size-3.5" />, text: 'Modifications…', cls: 'text-steel' },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'Enregistrement…', cls: 'text-steel' },
    error: { icon: <AlertTriangle className="size-3.5" />, text: 'Erreur', cls: 'text-destructive' },
    conflict: { icon: <AlertTriangle className="size-3.5" />, text: 'Conflit', cls: 'text-amber' },
    local: { icon: null, text: 'Démo (non enregistrée)', cls: 'text-steel' },
  }[save];

  const preview = (cls: string) => (
    <ReelPreview doc={doc} bismillahSvg={bismillahSvg} frame={frame} playing={playing} animate={playing} backgroundUrl={backgroundUrl} qrUrl={qrUrl} className={cls} onOverflow={setOverflow} />
  );
  const exportWarning = overflow ? 'Le texte de la scène affichée ne tient pas : réduisez la taille ou divisez la scène.' : layoutIssues.length ? `${layoutIssues.length} problème(s) de mise en page à corriger avant l’export (voir l’onglet Export).` : null;
  const panels = {
    content: <ContentPanel doc={doc} dispatch={dispatch} currentScene={currentScene} onSelectScene={selectScene} surahName={surahName} />,
    style: <StylePanel doc={doc} dispatch={dispatch} />,
    brand: <BrandPanel doc={doc} dispatch={dispatch} />,
    media: <MediaPanel doc={doc} dispatch={dispatch} projectId={project?.id ?? null} enabled={!!project} />,
    timing: <TimingPanel doc={doc} dispatch={dispatch} onSeek={seek} />,
    export: <ExportPanel projectId={project?.id ?? null} ensureSaved={ensureSaved} layoutIssues={layoutIssues} durationSec={doc.totalFrames / doc.fps} />,
  };
  const timeline = (compact: boolean) => (
    <SceneTimeline doc={doc} frame={frame} onSeek={seek} currentScene={currentScene} onBoundary={(i, f) => dispatch({ type: 'boundary', index: i, frame: f })} audioUrl={audioUrl} compact={compact} />
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      {audioUrl && <audio ref={audioEl} src={audioUrl} preload="auto" className="hidden" />}
      <LayoutAudit doc={doc} bismillahSvg={bismillahSvg} onIssues={setLayoutIssues} />
      <header className="safe-top flex h-14 shrink-0 items-center gap-2 border-b border-hairline px-3 lg:px-4">
        <Button asChild variant="ghost" size="icon" aria-label="Retour aux projets">
          <Link href={project ? '/projects' : '/'}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          {project ? (
            <input aria-label="Titre du projet" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setSave((s) => (s === 'conflict' ? s : 'dirty')); }} className="w-full truncate rounded-md bg-transparent text-base text-lunar-white outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
          ) : (
            <h1 className="truncate text-base text-lunar-white">{title}</h1>
          )}
          <p className={cn('flex items-center gap-1 text-xs', saveBadge.cls)} role="status">{saveBadge.icon}{saveBadge.text}</p>
        </div>
        <Badge variant="outline" className="hidden rounded-full border-hairline text-aurora-mint sm:inline-flex">{doc.mode === 'word_by_word' ? 'Mot à mot' : 'Verset complet'}</Badge>
        <Badge variant="outline" className="hidden rounded-full border-hairline sm:inline-flex">{doc.country}</Badge>
      </header>
      {saveError && (
        <div role="alert" className="flex items-center gap-2 border-b border-amber/40 bg-amber/10 px-4 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber" />
          <span className="flex-1">{saveError}</span>
          {save === 'conflict' ? <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Recharger</Button> : <Button size="sm" variant="outline" onClick={() => void doSave()}>Réessayer</Button>}
        </div>
      )}

      {/* ───────────── desktop (≥ lg) ───────────── */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[320px_minmax(0,1fr)_340px]">
        <aside className="min-h-0 border-r border-hairline bg-singularity" aria-label="Contenu et médias">
          <Tabs defaultValue="content" className="flex h-full flex-col">
            <TabsList className="mx-4 mt-4 w-[calc(100%-2rem)] bg-void-canvas">
              <TabsTrigger value="content">Contenu</TabsTrigger>
              <TabsTrigger value="media">Médias</TabsTrigger>
              <TabsTrigger value="timing">Temps</TabsTrigger>
            </TabsList>
            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="content">{panels.content}</TabsContent>
              <TabsContent value="media">{panels.media}</TabsContent>
              <TabsContent value="timing">{panels.timing}</TabsContent>
            </ScrollArea>
          </Tabs>
        </aside>
        <main className="nebula-glow flex min-h-0 flex-col items-center justify-center gap-2 p-6">
          <div className="min-h-0 flex-1" style={{ aspectRatio: '9 / 16' }}>{preview('h-full')}</div>
          {exportWarning && <p className="text-xs text-amber" role="status">⚠ {exportWarning}</p>}
        </main>
        <aside className="min-h-0 border-l border-hairline bg-singularity" aria-label="Propriétés">
          <Tabs defaultValue="style" className="flex h-full flex-col">
            <TabsList className="mx-4 mt-4 w-[calc(100%-2rem)] bg-void-canvas">
              <TabsTrigger value="style">Style</TabsTrigger>
              <TabsTrigger value="brand">Marque</TabsTrigger>
              <TabsTrigger value="export">Export</TabsTrigger>
            </TabsList>
            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="style">{panels.style}</TabsContent>
              <TabsContent value="brand">{panels.brand}</TabsContent>
              <TabsContent value="export">{panels.export}</TabsContent>
            </ScrollArea>
          </Tabs>
        </aside>
      </div>
      <footer className="hidden shrink-0 space-y-2 border-t border-hairline bg-singularity px-4 py-3 lg:block" aria-label="Chronologie">
        <Transport doc={doc} frame={frame} playing={playing} onToggle={toggle} onSeek={seek} currentScene={currentScene} onMarkEnd={markEnd} />
        {timeline(false)}
      </footer>

      {/* ───────────── mobile / tablet (< lg): one scrolling column, sticky preview ───────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto lg:hidden" id="mobile-editor">
        <div className="nebula-glow sticky top-0 z-20 flex justify-center bg-background/95 px-4 pt-3 pb-2 backdrop-blur">
          <div style={{ height: 'min(36dvh, 520px)', aspectRatio: '9 / 16' }}>{preview('h-full')}</div>
        </div>
        <div className="flex justify-center px-2 py-2">
          <Transport doc={doc} frame={frame} playing={playing} onToggle={toggle} onSeek={seek} currentScene={currentScene} onMarkEnd={markEnd} />
        </div>
        <div className="px-3 pb-2">{timeline(true)}</div>
        <div className="border-t border-hairline bg-singularity pb-4">
          {mobileTab === 'media' ? (
            <>
              {panels.media}
              {panels.timing}
            </>
          ) : (
            panels[mobileTab as keyof typeof panels]
          )}
        </div>
      </div>
      <div className="lg:hidden">
        <nav className="safe-bottom grid shrink-0 grid-cols-5 border-t border-hairline bg-singularity" aria-label="Panneaux">
          {[
            { id: 'content', label: 'Contenu', Icon: Layers },
            { id: 'media', label: 'Médias', Icon: Film },
            { id: 'style', label: 'Style', Icon: Palette },
            { id: 'brand', label: 'Marque', Icon: Stamp },
            { id: 'export', label: 'Export', Icon: Clapperboard },
          ].map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => setMobileTab(id)} aria-pressed={mobileTab === id} className={cn('flex min-h-14 flex-col items-center justify-center gap-1 text-xs', mobileTab === id ? 'text-lunar-white' : 'text-steel')}>
              <Icon className="size-5" aria-hidden />{label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
