'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { RenderDocumentSchema, type RenderDocument } from '@instantreels/core';
import { loadFullVerses, loadWordVerses } from '@/lib/content';
import { verifyDocumentText } from '@/lib/integrity';
import { buildInitialDocument } from '@/lib/new-document';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function requireUser() {
  const sb = await createSupabaseServerClient();
  if (!sb) throw new Error('Supabase n’est pas configuré');
  const { data } = await sb.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error('Session expirée — reconnectez-vous');
  return { sb, userId };
}

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : 'Erreur inattendue' });

// ───────────────────────── create ─────────────────────────
const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mode: z.enum(['word_by_word', 'full_verse']),
  country: z.enum(['FR', 'UK', 'SE']),
  surah: z.number().int().min(1).max(114),
  verses: z.array(z.number().int().min(1)).min(1).max(300),
  bismillahIntro: z.boolean(),
});

export async function createProject(input: z.input<typeof CreateSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const p = CreateSchema.parse(input);
    const { sb } = await requireUser();
    const verses = [...new Set(p.verses)].sort((a, b) => a - b);
    const intro = p.surah === 9 ? false : p.bismillahIntro;
    const doc =
      p.mode === 'word_by_word'
        ? buildInitialDocument({ mode: p.mode, country: p.country, surah: p.surah, wordVerses: await loadWordVerses(sb, p.surah, verses), bismillahIntro: intro })
        : buildInitialDocument({ mode: p.mode, country: p.country, surah: p.surah, fullVerses: (await loadFullVerses(sb, p.surah, verses, p.country)).verses, bismillahIntro: intro });
    const { data, error } = await sb.from('projects').insert({ title: p.title, mode: p.mode, surah_id: p.surah, country_code: p.country, document: doc }).select('id').single();
    if (error) throw new Error(error.message);
    revalidatePath('/projects');
    return { ok: true, data: { id: data.id as string } };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── save (optimistic locking + text integrity) ─────────────────────────
export async function saveProject(id: string, doc: RenderDocument, expectedVersion: number, title?: string): Promise<ActionResult<{ version: number }>> {
  try {
    z.uuid().parse(id);
    const parsed = RenderDocumentSchema.safeParse(doc);
    if (!parsed.success) return { ok: false, error: `Document invalide : ${parsed.error.issues.slice(0, 3).map((i) => i.message).join(' ; ')}` };
    const { sb } = await requireUser();
    const problems = await verifyDocumentText(sb, parsed.data);
    if (problems.length) return { ok: false, error: `Texte coranique non conforme à la source : ${problems.slice(0, 3).join(' ; ')}` };
    const patch: Record<string, unknown> = { document: parsed.data };
    if (title !== undefined) patch.title = z.string().trim().min(1).max(200).parse(title);
    const { data, error } = await sb.from('projects').update(patch).eq('id', id).eq('document_version', expectedVersion).select('document_version');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return { ok: false, error: 'CONFLICT' };
    return { ok: true, data: { version: data[0]!.document_version as number } };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicateProject(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { sb } = await requireUser();
    const { data: p, error } = await sb.from('projects').select('title, mode, surah_id, country_code, document').eq('id', id).single();
    if (error || !p) throw new Error('Projet introuvable');
    const { data, error: e2 } = await sb.from('projects').insert({ ...p, title: `${p.title} (copie)`.slice(0, 200) }).select('id').single();
    if (e2) throw new Error(e2.message);
    revalidatePath('/projects');
    return { ok: true, data: { id: data.id as string } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteProject(id: string): Promise<ActionResult> {
  try {
    const { sb } = await requireUser();
    const { error, count } = await sb.from('projects').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    if (!count) throw new Error('Projet introuvable');
    revalidatePath('/projects');
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── media registration ─────────────────────────
const MediaSchema = z.object({
  kind: z.enum(['audio', 'background']),
  path: z.string().min(3).max(300),
  originalName: z.string().min(1).max(300),
  mime: z.string().min(3).max(100),
  sizeBytes: z.number().int().min(1),
  durationMs: z.number().int().min(1).nullable(),
  width: z.number().int().min(1).nullable().optional(),
  height: z.number().int().min(1).nullable().optional(),
  projectId: z.uuid().nullable().optional(),
});

/** Records an object the browser has just uploaded into the user's own Storage folder. */
export async function registerMedia(input: z.input<typeof MediaSchema>): Promise<ActionResult<{ id: string; uri: string }>> {
  try {
    const m = MediaSchema.parse(input);
    const { sb, userId } = await requireUser();
    if (!m.path.startsWith(`${userId}/`) || m.path.includes('..')) throw new Error('Chemin de fichier invalide');
    const bucket = m.kind === 'audio' ? 'audio' : 'backgrounds';
    const table = m.kind === 'audio' ? 'audio_assets' : 'background_media';
    const row: Record<string, unknown> =
      m.kind === 'audio'
        ? { storage_path: m.path, original_name: m.originalName, mime: m.mime, size_bytes: m.sizeBytes, duration_ms: m.durationMs, project_id: m.projectId ?? null }
        : { storage_path: m.path, original_name: m.originalName, mime: m.mime, size_bytes: m.sizeBytes, duration_ms: m.durationMs, width: m.width ?? null, height: m.height ?? null };
    const { data, error } = await sb.from(table).insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return { ok: true, data: { id: data.id as string, uri: `storage://${bucket}/${m.path}` } };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── rendering ─────────────────────────
export async function requestRender(projectId: string, preset: '1080p30' | '2160p30'): Promise<ActionResult<{ jobId: string }>> {
  try {
    z.uuid().parse(projectId);
    z.enum(['1080p30', '2160p30']).parse(preset);
    const { sb, userId } = await requireUser();
    const { data: p, error } = await sb.from('projects').select('id, document').eq('id', projectId).single();
    if (error || !p) throw new Error('Projet introuvable');
    const doc = RenderDocumentSchema.parse(p.document);
    const problems = await verifyDocumentText(sb, doc);
    if (problems.length) throw new Error(`Texte non conforme à la source : ${problems[0]}`);
    // jobs are written by the server only (RLS: read-only for users)
    const admin = createSupabaseAdminClient();
    if (!admin) throw new Error('Clé serveur Supabase manquante');
    const active = await admin.from('render_jobs').select('id', { count: 'exact', head: true }).eq('owner_id', userId).in('status', ['queued', 'rendering', 'encoding', 'validating']);
    if ((active.count ?? 0) >= 3) throw new Error('Trois exports sont déjà en cours — attendez leur fin');
    const { data, error: e2 } = await admin.from('render_jobs').insert({ owner_id: userId, project_id: projectId, preset, document_snapshot: doc }).select('id').single();
    if (e2) throw new Error(e2.message);
    return { ok: true, data: { jobId: data.id as string } };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelRender(jobId: string): Promise<ActionResult> {
  try {
    z.uuid().parse(jobId);
    const { sb } = await requireUser();
    const { data: job } = await sb.from('render_jobs').select('id, status').eq('id', jobId).single();
    if (!job) throw new Error('Export introuvable');
    const admin = createSupabaseAdminClient();
    if (!admin) throw new Error('Clé serveur Supabase manquante');
    if (job.status === 'queued') await admin.from('render_jobs').update({ status: 'cancelled', cancel_requested: true, finished_at: new Date().toISOString() }).eq('id', jobId);
    else await admin.from('render_jobs').update({ cancel_requested: true }).eq('id', jobId);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function signOut(): Promise<void> {
  const sb = await createSupabaseServerClient();
  await sb?.auth.signOut();
  redirect('/login');
}

// ───────────────────────── selection preview ─────────────────────────
export type SelectionPreview = { verse: number; arabic: string; french: string; wordCount: number }[];

/** Arabic + translation of the first selected verses, shown before creating the project. */
export async function previewSelection(input: { surah: number; verses: number[]; mode: 'word_by_word' | 'full_verse'; country: 'FR' | 'UK' | 'SE' }): Promise<ActionResult<SelectionPreview>> {
  try {
    const p = z.object({ surah: z.number().int().min(1).max(114), verses: z.array(z.number().int().min(1)).min(1).max(300), mode: z.enum(['word_by_word', 'full_verse']), country: z.enum(['FR', 'UK', 'SE']) }).parse(input);
    const { sb } = await requireUser();
    const shown = [...new Set(p.verses)].sort((a, b) => a - b).slice(0, 6);
    if (p.mode === 'word_by_word') {
      const v = await loadWordVerses(sb, p.surah, shown);
      return { ok: true, data: v.map((x) => ({ verse: x.verse, arabic: x.words.map((w) => w.arabic).join(' '), french: x.words.map((w) => w.french).join(' · '), wordCount: x.words.length })) };
    }
    const { verses } = await loadFullVerses(sb, p.surah, shown, p.country);
    return { ok: true, data: verses.map((x) => ({ verse: x.verse, arabic: x.words.map((w) => w.arabic).join(' '), french: x.translation, wordCount: x.words.length })) };
  } catch (e) {
    return fail(e);
  }
}
