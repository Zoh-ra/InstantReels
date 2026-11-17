export const metadata = { title: 'Hors ligne' };

export default function OfflinePage() {
  return (
    <main className="nebula-glow flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="eyebrow text-amber">Hors ligne</p>
      <h1 className="text-3xl">Connexion perdue</h1>
      <p className="max-w-sm text-steel">InstantReels a besoin d’Internet pour charger vos projets et générer les vidéos. Vos modifications reprendront dès le retour du réseau.</p>
    </main>
  );
}
