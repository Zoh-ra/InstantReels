'use client';

import Link from 'next/link';
import { useReducer, useState } from 'react';
import { ArrowLeft, Clapperboard, Download, Layers, Palette, Stamp } from 'lucide-react';
import type { RenderDocument } from '@instantreels/core';
import { ReelPreview, sceneAtFrame } from '@/components/reel/ReelPreview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { editorReducer } from './editor-state';
import { BrandPanel, ContentPanel, StylePanel } from './panels';
import { SceneTimeline, Transport } from './Timeline';
import { usePlayback } from './use-playback';

export function EditorShell({ title, initialDoc, bismillahSvg }: { title: string; initialDoc: RenderDocument; bismillahSvg: string }) {
  const [doc, dispatch] = useReducer(editorReducer, initialDoc);
  const { frame, playing, seek, toggle } = usePlayback(doc.totalFrames, doc.fps);
  const { index: currentScene } = sceneAtFrame(doc, frame);
  const [mobileTab, setMobileTab] = useState('content');
  const selectScene = (i: number) => seek(doc.scenes[i]!.startFrame);

  const exportButton = (
    <Button disabled title="Export MP4 : phase 5 (worker de rendu)" className="gap-2">
      <Download /> Exporter MP4
    </Button>
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* header */}
      <header className="safe-top flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-3 lg:px-4">
        <Button asChild variant="ghost" size="icon" aria-label="Retour au studio">
          <Link href="/"><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base text-lunar-white">{title}</h1>
          <p className="hidden text-xs text-steel sm:block">Aperçu léger · l’export utilise exactement les mêmes calques</p>
        </div>
        <Badge variant="outline" className="hidden rounded-full border-hairline text-aurora-mint sm:inline-flex">Mot à mot</Badge>
        <div className="hidden lg:block">{exportButton}</div>
      </header>

      {/* ───────────── desktop (≥ lg) ───────────── */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 border-r border-hairline bg-singularity" aria-label="Contenu">
          <ScrollArea className="h-full"><ContentPanel doc={doc} currentScene={currentScene} onSelectScene={selectScene} /></ScrollArea>
        </aside>
        <main className="nebula-glow flex min-h-0 items-center justify-center p-6">
          <div className="h-full max-h-full" style={{ aspectRatio: '9 / 16' }}>
            <ReelPreview doc={doc} bismillahSvg={bismillahSvg} frame={frame} animate={playing} className="h-full" />
          </div>
        </main>
        <aside className="min-h-0 border-l border-hairline bg-singularity" aria-label="Propriétés">
          <Tabs defaultValue="style" className="flex h-full flex-col">
            <TabsList className="mx-4 mt-4 w-[calc(100%-2rem)] bg-void-canvas">
              <TabsTrigger value="style">Style</TabsTrigger>
              <TabsTrigger value="brand">Marque</TabsTrigger>
            </TabsList>
            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="style"><StylePanel doc={doc} dispatch={dispatch} /></TabsContent>
              <TabsContent value="brand"><BrandPanel doc={doc} dispatch={dispatch} /></TabsContent>
            </ScrollArea>
          </Tabs>
        </aside>
      </div>
      <footer className="hidden shrink-0 border-t border-hairline bg-singularity px-4 py-3 lg:block" aria-label="Chronologie">
        <div className="mb-3 flex items-center justify-between">
          <Transport doc={doc} frame={frame} playing={playing} onToggle={toggle} onSeek={seek} currentScene={currentScene} />
          <p className="text-xs text-steel">Forme d’onde audio et synchronisation manuelle : phase 4</p>
        </div>
        <SceneTimeline doc={doc} frame={frame} onSeek={seek} currentScene={currentScene} />
      </footer>

      {/* ───────────── mobile / tablet (< lg) ───────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="nebula-glow flex shrink-0 justify-center px-4 pt-3">
          <div style={{ height: 'min(44dvh, 560px)', aspectRatio: '9 / 16' }}>
            <ReelPreview doc={doc} bismillahSvg={bismillahSvg} frame={frame} animate={playing} className="h-full" />
          </div>
        </div>
        <div className="flex shrink-0 justify-center py-2">
          <Transport doc={doc} frame={frame} playing={playing} onToggle={toggle} onSeek={seek} currentScene={currentScene} />
        </div>
        <div className="shrink-0 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          <SceneTimeline doc={doc} frame={frame} onSeek={seek} currentScene={currentScene} compact />
        </div>
        <ScrollArea className="min-h-0 flex-1 border-t border-hairline bg-singularity">
          {mobileTab === 'content' && <ContentPanel doc={doc} currentScene={currentScene} onSelectScene={selectScene} />}
          {mobileTab === 'style' && <StylePanel doc={doc} dispatch={dispatch} />}
          {mobileTab === 'brand' && <BrandPanel doc={doc} dispatch={dispatch} />}
        </ScrollArea>
        <nav className="safe-bottom grid shrink-0 grid-cols-4 border-t border-hairline bg-singularity" aria-label="Panneaux">
          {[
            { id: 'content', label: 'Contenu', Icon: Layers },
            { id: 'style', label: 'Style', Icon: Palette },
            { id: 'brand', label: 'Marque', Icon: Stamp },
          ].map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => setMobileTab(id)} aria-pressed={mobileTab === id}
              className={cn('flex min-h-14 flex-col items-center justify-center gap-1 text-xs', mobileTab === id ? 'text-lunar-white' : 'text-steel')}>
              <Icon className="size-5" aria-hidden />{label}
            </button>
          ))}
          <button type="button" disabled className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs text-steel/50" title="Export : phase 5">
            <Clapperboard className="size-5" aria-hidden />Exporter
          </button>
        </nav>
      </div>
    </div>
  );
}
