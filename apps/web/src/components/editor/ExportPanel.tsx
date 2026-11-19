'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, HardDrive, Loader2, RotateCcw, Square } from 'lucide-react';
import { cancelRender, requestRender } from '@/app/actions/projects';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Section } from './controls';
import type { LayoutIssue } from './LayoutAudit';

type Preset = '1080p30' | '2160p30';
type Job = {
  id: string;
  preset: Preset;
  status: string;
  progress: number;
  error: { message?: string; detail?: string } | null;
  created_at: string;
  finished_at: string | null;
  exported_videos: { size_bytes: number; storage_path: string } | { size_bytes: number; storage_path: string }[] | null;
};

const STATUS: Record<string, string> = {
  queued: 'En file d’attente',
  rendering: 'Rendu des scènes',
  encoding: 'Encodage MP4',
  validating: 'Vérification',
  succeeded: 'Prêt',
  failed: 'Échec',
  cancelled: 'Annulé',
};
const ACTIVE = ['queued', 'rendering', 'encoding', 'validating'];

/** Storage upload limit of the Supabase project (free plan: 50 MB per object). */
export const UPLOAD_LIMIT_MB = Number(process.env.NEXT_PUBLIC_STORAGE_MAX_UPLOAD_MB || 50);
/** Same constants as the worker's planDelivery (apps/worker/src/render/compose.ts). */
const PRESET_MAX_KBPS: Record<Preset, number> = { '1080p30': 12000, '2160p30': 24000 };
const FLOOR_KBPS: Record<Preset, number> = { '1080p30': 6000, '2160p30': 16000 };

function plan(preset: Preset, durationSec: number) {
  const budget = (UPLOAD_LIMIT_MB * 1024 * 1024 * 0.96 * 8) / 1000 / durationSec - 192;
  const maxrate = Math.min(PRESET_MAX_KBPS[preset], budget);
  const toStorage = budget >= FLOOR_KBPS[preset];
  const worstMB = (((toStorage ? maxrate : PRESET_MAX_KBPS[preset]) + 192) * durationSec) / 8 / 1024;
  return { toStorage, capped: toStorage && budget < PRESET_MAX_KBPS[preset], worstMB };
}

export function ExportPanel({ projectId, ensureSaved, layoutIssues, durationSec }: { projectId: string | null; ensureSaved: () => Promise<boolean>; layoutIssues: LayoutIssue[]; durationSec: number }) {
  const [preset, setPreset] = useState<Preset>('2160p30');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = createSupabaseBrowserClient();
    if (!sb || !projectId) return;
    const { data } = await sb.from('render_jobs').select('id, preset, status, progress, error, created_at, finished_at, exported_videos(size_bytes, storage_path)').eq('project_id', projectId).order('created_at', { ascending: false }).limit(8);
    setJobs((data as Job[]) ?? []);
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the network response
    void load();
  }, [load]);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const anyActive = jobs.some((j) => ACTIVE.includes(j.status));
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  if (!projectId) {
    return (
      <Section eyebrow="Export" title="Vidéo MP4">
        <p className="text-sm text-steel">L’export est disponible pour les projets enregistrés (connectez-vous puis créez un projet).</p>
      </Section>
    );
  }

  async function start(p: Preset) {
    setError(null);
    setBusy(true);
    try {
      if (!(await ensureSaved())) throw new Error('Le projet n’a pas pu être enregistré — corrigez l’erreur affichée en haut de l’éditeur, puis relancez.');
      const r = await requestRender(projectId!, p);
      if (!r.ok) throw new Error(r.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la demande d’export');
    } finally {
      setBusy(false);
    }
  }

  const p = plan(preset, durationSec);
  const stale = now > 0 && jobs.find((j) => j.status === 'queued' && now - new Date(j.created_at).getTime() > 30_000);
  const blocking = layoutIssues.length > 0;
  return (
    <Section eyebrow="Export" title="Vidéo MP4 (H.264 / AAC)">
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="sr-only">Qualité</legend>
        {(
          [
            ['2160p30', '4K · 2160×3840', 'Qualité maximale'],
            ['1080p30', 'Full HD · 1080×1920', 'Plus rapide, compatible partout'],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className={`cursor-pointer rounded-xl border p-3 text-sm ${preset === value ? 'border-ultraviolet bg-void-canvas' : 'border-hairline'}`}>
            <input type="radio" name="preset" value={value} checked={preset === value} onChange={() => setPreset(value)} className="sr-only" />
            <span className="block text-lunar-white">{label}</span>
            <span className="text-xs text-steel">{hint}</span>
          </label>
        ))}
      </fieldset>

      <div className="rounded-xl border border-hairline p-3 text-xs text-steel" role="note">
        <p>Durée {durationSec.toFixed(1)} s · taille maximale estimée ≈ {Math.ceil(p.worstMB)} Mo (souvent bien moins).</p>
        {p.toStorage ? (
          <p className="mt-1">{p.capped ? `Débit plafonné pour rester sous la limite Supabase de ${UPLOAD_LIMIT_MB} Mo, au-dessus du seuil de netteté du texte.` : `Le fichier sera stocké dans Supabase (limite ${UPLOAD_LIMIT_MB} Mo).`}</p>
        ) : (
          <p className="mt-1 flex gap-1.5 text-amber">
            <HardDrive className="mt-0.5 size-3.5 shrink-0" />
            Trop long pour la limite Supabase de {UPLOAD_LIMIT_MB} Mo sans perdre en netteté : la vidéo sera produite en pleine qualité et conservée sur le serveur de rendu (téléchargement depuis cette application). Alternative : l’export Full HD{preset === '1080p30' ? ' plus court' : ''} ou une offre Supabase supérieure.
          </p>
        )}
      </div>

      {blocking && (
        <div role="alert" className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-amber"><AlertTriangle className="size-4" /> À corriger avant l’export</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {layoutIssues.slice(0, 6).map((i, k) => <li key={k}>Scène {i.scene} : {i.message}</li>)}
            {layoutIssues.length > 6 && <li>… et {layoutIssues.length - 6} autre(s)</li>}
          </ul>
        </div>
      )}
      <Button className="w-full gap-2" onClick={() => start(preset)} disabled={busy || blocking}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} Générer la vidéo
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {stale && <p className="text-xs text-amber">En attente d’un serveur de rendu : vérifiez que le worker est démarré (npm run worker).</p>}
      <ul className="space-y-2" aria-live="polite">
        {jobs.map((j) => {
          const ev = Array.isArray(j.exported_videos) ? j.exported_videos[0] : j.exported_videos;
          return (
            <li key={j.id} className="rounded-xl border border-hairline p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>{j.preset === '2160p30' ? '4K' : '1080p'} · {STATUS[j.status] ?? j.status}</span>
                <span className="font-mono text-xs text-steel">{new Date(j.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {ACTIVE.includes(j.status) && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-void-canvas" role="progressbar" aria-label="Progression de l’export" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)}>
                    <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(3, j.progress * 100)}%`, backgroundImage: 'var(--gradient-nebula)' }} />
                  </div>
                  <span className="w-10 text-right font-mono text-xs">{Math.round(j.progress * 100)}%</span>
                  <Button variant="ghost" size="icon-sm" aria-label="Annuler l’export" onClick={async () => { await cancelRender(j.id); await load(); }}><Square /></Button>
                </div>
              )}
              {j.status === 'failed' && (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-destructive">{j.error?.message ?? 'Erreur inconnue'}</p>
                  {j.error?.detail && (
                    <details className="text-[11px] text-steel">
                      <summary className="cursor-pointer">Détail technique</summary>
                      <p className="mt-1 break-words font-mono">{j.error.detail}</p>
                    </details>
                  )}
                </div>
              )}
              {(j.status === 'failed' || j.status === 'cancelled') && (
                <Button variant="outline" size="sm" className="mt-2 gap-2" disabled={busy || blocking} onClick={() => start(j.preset)}>
                  <RotateCcw className="size-4" /> Relancer ({j.preset === '2160p30' ? '4K' : '1080p'})
                </Button>
              )}
              {j.status === 'succeeded' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button asChild size="sm" className="gap-2">
                    <a href={`/api/exports/${j.id}`}><Download className="size-4" /> Télécharger le MP4</a>
                  </Button>
                  {ev && <span className="text-xs text-steel">{(ev.size_bytes / 2 ** 20).toFixed(1)} Mo{ev.storage_path.startsWith('local://') ? ' · conservé sur le serveur de rendu' : ''}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-steel">Les fichiers exportés sont conservés 7 jours. Le rendu a lieu sur le serveur : vous pouvez fermer cette page. Un échec ne modifie jamais votre projet.</p>
    </Section>
  );
}
