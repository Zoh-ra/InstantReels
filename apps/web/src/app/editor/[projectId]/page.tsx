import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorShell } from '@/components/editor/EditorShell';
import { loadDemoProject } from '@/lib/demo-project';

export const metadata: Metadata = { title: 'Éditeur' };

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  // Projects are stored in Supabase from Phase 2; until then only the demo project exists.
  if (projectId !== 'demo') notFound();
  const project = loadDemoProject();
  return <EditorShell title={project.title} initialDoc={project.doc} bismillahSvg={project.bismillahSvg} />;
}
