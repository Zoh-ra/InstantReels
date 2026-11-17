import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogOut, Plus } from 'lucide-react';
import { signOut } from '@/app/actions/projects';
import { ProjectCardActions } from '@/components/projects/ProjectCardActions';
import { Button } from '@/components/ui/button';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Mes projets' };
export const dynamic = 'force-dynamic';

const MODE = { word_by_word: 'Mot à mot', full_verse: 'Verset complet' } as const;

export default async function ProjectsPage() {
  const sb = await createSupabaseServerClient();
  if (!sb) redirect('/');
  const { data: claims } = await sb.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/login?next=/projects');
  const [{ data: projects, error }, { data: profile }] = await Promise.all([
    sb.from('projects').select('id, title, mode, surah_id, country_code, updated_at, surahs(name_transliterated)').order('updated_at', { ascending: false }).limit(200),
    sb.from('profiles').select('display_name').single(),
  ]);

  return (
    <div className="relative min-h-dvh">
      <div className="nebula-glow pointer-events-none absolute inset-x-0 top-0 h-[360px]" aria-hidden />
      <header className="safe-top relative mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-6 py-5">
        <Link href="/" className="font-display text-lg">InstantReels</Link>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-steel sm:inline">{profile?.display_name}</span>
          <form action={signOut}>
            <Button variant="ghost" size="sm" className="gap-2" type="submit"><LogOut className="size-4" /> Déconnexion</Button>
          </form>
        </div>
      </header>
      <main className="relative mx-auto max-w-[1200px] px-6 pb-20">
        <div className="flex flex-wrap items-end justify-between gap-4 pt-6 pb-8">
          <div>
            <p className="eyebrow text-aurora-mint">Studio</p>
            <h1 className="text-3xl sm:text-4xl">Mes projets</h1>
          </div>
          <Button asChild size="lg" className="gap-2"><Link href="/projects/new"><Plus /> Nouveau projet</Link></Button>
        </div>
        {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">Impossible de charger les projets : {error.message}</p>}
        {projects && projects.length === 0 && (
          <div className="rounded-2xl border border-dashed border-hairline p-10 text-center">
            <p className="text-lg">Aucun projet pour l’instant</p>
            <p className="mt-1 text-sm text-steel">Choisissez une sourate et des versets pour créer votre premier reel.</p>
            <Button asChild className="mt-6 gap-2"><Link href="/projects/new"><Plus /> Créer un projet</Link></Button>
          </div>
        )}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(projects ?? []).map((p) => {
            const name = (p as unknown as { surahs: { name_transliterated: string | null } | null }).surahs?.name_transliterated;
            return (
              <li key={p.id} className="group relative rounded-2xl border border-hairline bg-carbon p-5 transition-colors hover:border-gunmetal">
                <Link href={`/editor/${p.id}`} className="block focus-visible:outline-none" aria-label={`Ouvrir ${p.title}`}>
                  <p className="text-center text-5xl leading-tight" style={{ fontFamily: "'QF Surah Names'" }} aria-hidden>{String(p.surah_id).padStart(3, '0')}</p>
                  <p className="mt-4 truncate text-lunar-white">{p.title}</p>
                  <p className="text-xs text-steel">{MODE[p.mode as keyof typeof MODE]} · {p.surah_id}. {name ?? ''} · {p.country_code}</p>
                  <p className="mt-1 text-xs text-steel">Modifié le {new Date(p.updated_at as string).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </Link>
                <ProjectCardActions id={p.id as string} title={p.title as string} />
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
