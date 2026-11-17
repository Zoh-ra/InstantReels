import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { RenderDocumentSchema } from '@instantreels/core';
import { EditorShell } from '@/components/editor/EditorShell';
import { loadBismillahSvg, loadDemoDocument } from '@/lib/demo-project';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Éditeur' };
export const dynamic = 'force-dynamic';

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const bismillahSvg = loadBismillahSvg();
  if (projectId === 'demo') {
    return <EditorShell project={null} initialDoc={loadDemoDocument()} bismillahSvg={bismillahSvg} surahName="Al-Fâtiha" />;
  }
  if (!/^[0-9a-f-]{36}$/.test(projectId)) notFound();
  const sb = await createSupabaseServerClient();
  if (!sb) redirect('/');
  const { data: p } = await sb.from('projects').select('id, title, document, document_version, surahs(name_transliterated)').eq('id', projectId).maybeSingle();
  if (!p) notFound();
  const parsed = RenderDocumentSchema.safeParse(p.document);
  if (!parsed.success) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl">Projet illisible</h1>
          <p className="text-steel">Ce projet a été créé avec une version antérieure du format. Dupliquez-le depuis un nouveau projet.</p>
        </div>
      </main>
    );
  }
  const surahName = (p as unknown as { surahs: { name_transliterated: string | null } | null }).surahs?.name_transliterated ?? `Sourate ${parsed.data.surah}`;
  return <EditorShell project={{ id: p.id as string, title: p.title as string, version: p.document_version as number }} initialDoc={parsed.data} bismillahSvg={bismillahSvg} surahName={surahName} />;
}
