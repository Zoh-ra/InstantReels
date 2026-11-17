import Link from 'next/link';
import { ArrowRight, BookOpenText, Captions, Film, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { readPublicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

const MODES = [
  { title: 'Mot à mot', desc: 'Cadres arabe + traduction française du classeur du Dr Usama Nonnenmacher, pagination automatique.', Icon: Captions, color: 'border-aurora-mint/70 text-aurora-mint', status: 'Aperçu disponible' },
  { title: 'Versets complets', desc: 'Verset entier avec traduction Hamidullah, Hilali & Khan ou Bernström selon le pays.', Icon: BookOpenText, color: 'border-plasma-blue/70 text-plasma-blue', status: 'Phase 3' },
  { title: 'Export MP4', desc: 'H.264 / AAC en 1080×1920 ou 2160×3840, rendu sur le serveur, validé image par image.', Icon: Film, color: 'border-amber/70 text-amber', status: 'Moteur validé · file d’attente en phase 5' },
];

export default function StudioPage() {
  const supabase = readPublicEnv();
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="nebula-glow pointer-events-none absolute inset-x-0 top-0 h-[520px]" aria-hidden />
      <header className="safe-top relative mx-auto flex max-w-[1200px] items-center justify-between px-6 py-5">
        <span className="font-display text-lg tracking-tight">InstantReels</span>
        <Badge variant="outline" className="gap-2 rounded-full border-hairline bg-void-canvas px-3 py-1 text-sm font-medium text-lunar-white">
          <span className={`size-2 rounded-full ${supabase.ok ? 'bg-aurora-mint' : 'bg-amber'}`} aria-hidden />
          {supabase.ok ? 'Supabase configuré' : 'Supabase à configurer'}
        </Badge>
      </header>

      <main className="relative mx-auto max-w-[1200px] px-6 pb-20">
        <section className="flex flex-col items-center gap-6 pt-10 pb-16 text-center sm:pt-16">
          <p className="eyebrow text-ultraviolet">Studio de reels coraniques</p>
          <h1 className="max-w-3xl text-4xl leading-[1.1] font-light sm:text-5xl">Des vidéos coraniques fidèles, belles et synchronisées.</h1>
          <p className="max-w-xl text-base text-steel">Texte coranique préservé à l’octet près, calligraphie authentique, export MP4 jusqu’en 4K — pour TikTok, Reels et Shorts.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link href="/editor/demo">Ouvrir la démo Al-Fâtiha <ArrowRight /></Link>
            </Button>
            <Button size="lg" variant="outline" disabled className="gap-2" title="Création de projets : phase 2 (base de données)">
              <Plus /> Nouveau projet
            </Button>
          </div>
        </section>

        <section aria-labelledby="modes" className="grid gap-6 md:grid-cols-3">
          <h2 id="modes" className="sr-only">Fonctionnalités</h2>
          {MODES.map(({ title, desc, Icon, color, status }) => (
            <article key={title} className="rounded-2xl border border-hairline bg-carbon p-6">
              <div className={`mb-5 flex size-12 items-center justify-center rounded-full border ${color}`}>
                <Icon className="size-5" aria-hidden />
              </div>
              <h3 className="text-xl text-lunar-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-steel">{desc}</p>
              <p className="mt-4 font-mono text-xs text-steel">{status}</p>
            </article>
          ))}
        </section>

        <section aria-labelledby="projects" className="mt-16">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="eyebrow text-aurora-mint">Projets</p>
              <h2 id="projects" className="text-2xl">Vos vidéos</h2>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/editor/demo" className="group rounded-2xl border border-hairline bg-carbon p-5 transition-colors hover:border-gunmetal">
              <p className="text-center text-6xl leading-tight" style={{ fontFamily: "'QF Surah Names'" }} aria-hidden>001</p>
              <div className="mt-4 flex items-center justify-between">
                <div>
                  <p className="text-lunar-white">Démo — Al-Fâtiha</p>
                  <p className="text-xs text-steel">Mot à mot · 9 scènes · 29 s</p>
                </div>
                <ArrowRight className="size-4 text-steel transition-transform group-hover:translate-x-1" aria-hidden />
              </div>
            </Link>
            <div className="flex flex-col justify-center rounded-2xl border border-dashed border-hairline p-5 text-sm text-steel">
              {supabase.ok
                ? 'Supabase est configuré. La sauvegarde des projets arrive avec la phase 2 (schéma, RLS, import du classeur).'
                : 'Renseignez vos clés Supabase dans .env.local (voir README) : la sauvegarde des projets arrive avec la phase 2.'}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
