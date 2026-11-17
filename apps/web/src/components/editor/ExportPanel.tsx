'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Square } from 'lucide-react';
import { cancelRender, requestRender } from '@/app/actions/projects';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Section } from './controls';

type Job = { id: string; preset: '1080p30' | '2160p30'; status: string; progress: number; error: { message?: string } | null; created_at: string; finished_at: string | null };

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

export function ExportPanel({ projectId, ensureSaved, hasUnsavedWarnings }: { projectId: string | null; ensureSaved: () => Promise<boolean>; hasUnsavedWarnings: string | null }) {
  const [preset, setPreset] = useState<'1080p30' | '2160p30'>('2160p30');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = createSupabaseBrowserClient();
    if (!sb || !projectId) return;
    const { data } = await sb.from('render_jobs').select('id, preset, status, progress, error, created_at, finished_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(8);
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

  async function start() {
    setError(null);
    setBusy(true);
    try {
      if (!(await ensureSaved())) throw new Error('Enregistrez le projet avant d’exporter.');
      const r = await requestRender(projectId!, preset);
      if (!r.ok) throw new Error(r.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec');
    } finally {
      setBusy(false);
    }
  }

  const stale = now > 0 && jobs.find((j) => j.status === 'queued' && now - new Date(j.created_at).getTime() > 30_000);
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
      {hasUnsavedWarnings && <p role="alert" className="text-sm text-amber">{hasUnsavedWarnings}</p>}
      <Button className="w-full gap-2" onClick={start} disabled={busy || !!hasUnsavedWarnings}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} Générer la vidéo
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {stale && <p className="text-xs text-amber">En attente d’un serveur de rendu : vérifiez que le worker est démarré (npm run worker).</p>}
      <ul className="space-y-2" aria-live="polite">
        {jobs.map((j) => (
          <li key={j.id} className="rounded-xl border border-hairline p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>{j.preset === '2160p30' ? '4K' : '1080p'} · {STATUS[j.status] ?? j.status}</span>
              <span className="font-mono text-xs text-steel">{new Date(j.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {ACTIVE.includes(j.status) && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-void-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)}>
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(3, j.progress * 100)}%`, backgroundImage: 'var(--gradient-nebula)' }} />
                </div>
                <span className="w-10 text-right font-mono text-xs">{Math.round(j.progress * 100)}%</span>
                <Button variant="ghost" size="icon-sm" aria-label="Annuler l’export" onClick={async () => { await cancelRender(j.id); await load(); }}><Square /></Button>
              </div>
            )}
            {j.status === 'failed' && <p className="mt-1 text-xs text-destructive">{j.error?.message ?? 'Erreur inconnue'}</p>}
            {j.status === 'succeeded' && (
              <Button asChild size="sm" className="mt-2 gap-2">
                <a href={`/api/exports/${j.id}`}><Download className="size-4" /> Télécharger le MP4</a>
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-steel">Les fichiers exportés sont conservés 7 jours. Le rendu a lieu sur le serveur : vous pouvez fermer cette page.</p>
    </Section>
  );
}
