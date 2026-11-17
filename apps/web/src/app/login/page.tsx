import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/projects/LoginForm';

export const metadata: Metadata = { title: 'Connexion' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/projects';
  return (
    <main className="nebula-glow flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-hairline bg-carbon p-8">
        <Link href="/" className="font-display text-lg">InstantReels</Link>
        <p className="eyebrow mt-8 text-ultraviolet">Connexion</p>
        <h1 className="mt-1 text-3xl">Accéder à votre studio</h1>
        <p className="mt-2 text-sm text-steel">Recevez un lien de connexion sécurisé par e-mail. Aucun mot de passe à retenir.</p>
        {error === 'link' && (
          <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">Lien invalide ou expiré. Demandez un nouveau lien.</p>
        )}
        <LoginForm next={safeNext} />
      </div>
    </main>
  );
}
