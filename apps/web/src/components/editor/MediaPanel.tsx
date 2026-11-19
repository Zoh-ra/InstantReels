'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { Loader2, Music, Trash2, Upload, Video } from 'lucide-react';
import type { RenderDocument } from '@instantreels/core';
import { registerMedia } from '@/app/actions/projects';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ColorField, Section, SliderField } from './controls';
import type { EditorAction } from './editor-state';

const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
/** Supabase Storage refuses any object above the project limit (free plan: 50 MB). */
const LIMIT_MB = Number(process.env.NEXT_PUBLIC_STORAGE_MAX_UPLOAD_MB || 50);
const MAX_BYTES = LIMIT_MB * 1024 * 1024;

type Library = { id: string; uri: string; name: string; durationMs: number | null; width?: number | null; height?: number | null }[];

/** Reads duration (and video size) locally before uploading. */
function probeLocal(file: File, kind: 'audio' | 'video'): Promise<{ durationMs: number; width: number | null; height: number | null }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      resolve({ durationMs: Math.round(el.duration * 1000), width: kind === 'video' ? v.videoWidth || null : null, height: kind === 'video' ? v.videoHeight || null : null });
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Format illisible par le navigateur'));
    };
    el.src = url;
  });
}

export function MediaPanel({ doc, dispatch, projectId, enabled }: { doc: RenderDocument; dispatch: Dispatch<EditorAction>; projectId: string | null; enabled: boolean }) {
  const [busy, setBusy] = useState<null | 'audio' | 'video'>(null);
  const [error, setError] = useState<string | null>(null);
  const [audios, setAudios] = useState<Library>([]);
  const [videos, setVideos] = useState<Library>([]);
  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const loadLibrary = useCallback(async () => {
    const sb = createSupabaseBrowserClient();
    if (!sb || !enabled) return;
    const [a, v] = await Promise.all([
      sb.from('audio_assets').select('id, storage_path, original_name, duration_ms').order('created_at', { ascending: false }).limit(30),
      sb.from('background_media').select('id, storage_path, original_name, duration_ms, width, height').order('created_at', { ascending: false }).limit(30),
    ]);
    setAudios((a.data ?? []).map((r) => ({ id: r.id, uri: `storage://audio/${r.storage_path}`, name: r.original_name, durationMs: r.duration_ms })));
    setVideos((v.data ?? []).map((r) => ({ id: r.id, uri: `storage://backgrounds/${r.storage_path}`, name: r.original_name, durationMs: r.duration_ms, width: r.width, height: r.height })));
  }, [enabled]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the network response
    void loadLibrary();
  }, [loadLibrary]);

  async function upload(file: File, kind: 'audio' | 'video') {
    setError(null);
    const types = kind === 'audio' ? AUDIO_TYPES : VIDEO_TYPES;
    if (!types.includes(file.type)) return setError(kind === 'audio' ? 'Formats acceptés : MP3, WAV, M4A, AAC.' : 'Formats acceptés : MP4, MOV, WebM.');
    if (file.size > MAX_BYTES) {
      return setError(
        `« ${file.name} » fait ${(file.size / 2 ** 20).toFixed(1)} Mo : la limite de votre stockage Supabase est de ${LIMIT_MB} Mo par fichier. ` +
          (kind === 'audio' ? 'Exportez la récitation en MP3 (128–192 kb/s) pour réduire sa taille.' : 'Compressez la vidéo (par exemple en 1080×1920, H.264, 8 Mb/s) ou utilisez un extrait plus court : elle boucle automatiquement.'),
      );
    }
    const sb = createSupabaseBrowserClient();
    if (!sb) return setError('Supabase n’est pas configuré.');
    setBusy(kind);
    try {
      const meta = await probeLocal(file, kind);
      if (kind === 'audio' && meta.durationMs > 15 * 60 * 1000) throw new Error('Récitation trop longue (15 min maximum).');
      const { data: claims } = await sb.auth.getClaims();
      const uid = claims?.claims?.sub;
      if (!uid) throw new Error('Session expirée — reconnectez-vous.');
      const ext = (file.name.split('.').pop() ?? (kind === 'audio' ? 'mp3' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${uid}/${crypto.randomUUID()}.${ext}`;
      const bucket = kind === 'audio' ? 'audio' : 'backgrounds';
      const { error: upErr } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(/size|large|413/i.test(upErr.message) ? `Fichier refusé par Supabase : il dépasse la limite de ${LIMIT_MB} Mo par fichier.` : /mime|type/i.test(upErr.message) ? 'Format de fichier refusé par le stockage.' : `Échec de l’envoi du fichier (${upErr.message}).`);
      const res = await registerMedia({ kind: kind === 'audio' ? 'audio' : 'background', path, originalName: file.name, mime: file.type, sizeBytes: file.size, durationMs: meta.durationMs, width: meta.width, height: meta.height, projectId });
      if (!res.ok) throw new Error(res.error);
      if (kind === 'audio') dispatch({ type: 'audio', audio: { src: res.data.uri, durationMs: meta.durationMs } });
      else dispatch({ type: 'background', background: { kind: 'video', src: res.data.uri, durationMs: meta.durationMs, brightness: -0.05, dimOpacity: 0.4, blur: 0, loop: true } });
      await loadLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de l’envoi');
    } finally {
      setBusy(null);
    }
  }

  const bg = doc.background;
  const currentVideo = bg.kind === 'video' ? videos.find((v) => v.uri === bg.src) : undefined;
  return (
    <div>
      <Section eyebrow="Récitation" title="Audio">
        {!enabled && <p className="text-sm text-steel">Connectez-vous et ouvrez un projet enregistré pour importer une récitation.</p>}
        {enabled && (
          <>
            <input ref={audioInput} type="file" accept={AUDIO_TYPES.join(',')} className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'audio')} />
            <Button variant="outline" className="w-full gap-2" disabled={busy !== null} onClick={() => audioInput.current?.click()}>
              {busy === 'audio' ? <Loader2 className="animate-spin" /> : <Upload />} Importer une récitation (MP3, WAV, M4A · max {LIMIT_MB} Mo)
            </Button>
            {doc.audio && (
              <div className="flex items-center justify-between rounded-xl border border-hairline p-3 text-sm">
                <span className="flex items-center gap-2 truncate"><Music className="size-4 text-aurora-mint" />{audios.find((a) => a.uri === doc.audio?.src)?.name ?? 'Récitation'} · {(doc.audio.durationMs / 1000).toFixed(1)} s</span>
                <Button variant="ghost" size="icon-sm" aria-label="Retirer l’audio" onClick={() => dispatch({ type: 'audio', audio: null })}><Trash2 /></Button>
              </div>
            )}
            {audios.length > 0 && (
              <label className="block space-y-1 text-sm">
                <span className="text-steel">Récitations déjà importées</span>
                <select
                  className="h-10 w-full rounded-full border border-hairline bg-void-canvas px-3"
                  value={doc.audio?.src ?? ''}
                  onChange={(e) => {
                    const a = audios.find((x) => x.uri === e.target.value);
                    if (a?.durationMs) dispatch({ type: 'audio', audio: { src: a.uri, durationMs: a.durationMs } });
                  }}
                >
                  <option value="">—</option>
                  {audios.map((a) => <option key={a.id} value={a.uri}>{a.name}</option>)}
                </select>
              </label>
            )}
            <p className="text-xs text-steel">La durée de la vidéo suit la récitation ; les limites des scènes sont ajustées proportionnellement, puis réglables à l’image près.</p>
          </>
        )}
      </Section>
      <Section eyebrow="Arrière-plan" title="Couleur ou vidéo">
        <div className="flex gap-2">
          <Button size="sm" variant={bg.kind === 'solid' ? 'secondary' : 'ghost'} onClick={() => dispatch({ type: 'background', background: { kind: 'solid', color: bg.kind === 'solid' ? bg.color : '#060913' } })}>Couleur unie</Button>
          <Button size="sm" variant={bg.kind === 'video' ? 'secondary' : 'ghost'} disabled={!enabled || videos.length === 0} onClick={() => { const v = videos[0]; if (v) dispatch({ type: 'background', background: { kind: 'video', src: v.uri, durationMs: v.durationMs, brightness: -0.05, dimOpacity: 0.4, blur: 0, loop: true } }); }}>Vidéo</Button>
        </div>
        {bg.kind === 'solid' && <ColorField id="bg-color" label="Couleur du fond" value={bg.color} onChange={(v) => dispatch({ type: 'background', background: { kind: 'solid', color: v } })} />}
        {enabled && (
          <>
            <input ref={videoInput} type="file" accept={VIDEO_TYPES.join(',')} className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'video')} />
            <Button variant="outline" className="w-full gap-2" disabled={busy !== null} onClick={() => videoInput.current?.click()}>
              {busy === 'video' ? <Loader2 className="animate-spin" /> : <Video />} Importer une vidéo d’arrière-plan (max {LIMIT_MB} Mo)
            </Button>
          </>
        )}
        {videos.length > 0 && (
          <label className="block space-y-1 text-sm">
            <span className="text-steel">Mes vidéos d’arrière-plan</span>
            <select
              className="h-10 w-full rounded-full border border-hairline bg-void-canvas px-3"
              value={bg.kind === 'video' ? bg.src : ''}
              onChange={(e) => {
                const v = videos.find((x) => x.uri === e.target.value);
                if (v) dispatch({ type: 'background', background: { kind: 'video', src: v.uri, durationMs: v.durationMs, brightness: bg.kind === 'video' ? bg.brightness : -0.05, dimOpacity: bg.kind === 'video' ? bg.dimOpacity : 0.4, blur: bg.kind === 'video' ? bg.blur : 0, loop: true } });
              }}
            >
              <option value="" disabled>—</option>
              {videos.map((v) => <option key={v.id} value={v.uri}>{v.name}</option>)}
            </select>
          </label>
        )}
        {bg.kind === 'video' && (
          <>
            <SliderField id="bg-brightness" label="Luminosité" value={bg.brightness} min={-0.6} max={0.3} step={0.01} unit="" onChange={(v) => dispatch({ type: 'background', background: { ...bg, brightness: v } })} />
            <SliderField id="bg-dim" label="Voile sombre (lisibilité)" value={bg.dimOpacity} min={0} max={0.85} step={0.01} unit="" onChange={(v) => dispatch({ type: 'background', background: { ...bg, dimOpacity: v } })} />
            <SliderField id="bg-blur" label="Flou" value={bg.blur} min={0} max={20} unit="px" onChange={(v) => dispatch({ type: 'background', background: { ...bg, blur: v } })} />
            <p className="text-xs text-steel">
              La vidéo garde sa vitesse naturelle ; plus courte que la récitation, elle boucle ; plus longue, elle est coupée.
              {currentVideo?.width && currentVideo.width < 2160 ? ` Source ${currentVideo.width}×${currentVideo.height} : l’export 4K n’ajoute pas de détail réel.` : ''}
            </p>
          </>
        )}
        <p className="text-xs text-steel">Recherche Pexels : désactivée tant qu’aucune clé API n’est fournie.</p>
      </Section>
      {error && <p role="alert" className="mx-4 mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}
    </div>
  );
}
