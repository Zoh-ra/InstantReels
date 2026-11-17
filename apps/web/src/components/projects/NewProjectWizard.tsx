'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { ArrowLeft, BookOpenText, Captions, Loader2, Search } from 'lucide-react';
import { createProject, previewSelection, type SelectionPreview } from '@/app/actions/projects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Surah = { id: number; verseCount: number; nameArabic: string | null; nameTransliterated: string | null; nameEnglish: string | null };
type Country = 'FR' | 'UK' | 'SE';
const COUNTRIES: { code: Country; label: string }[] = [
  { code: 'FR', label: 'France' },
  { code: 'UK', label: 'Royaume-Uni' },
  { code: 'SE', label: 'Suède' },
];
const MAX_VERSES = 300;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-hairline bg-carbon p-5 sm:p-6" aria-labelledby={`step-${n}`}>
      <p className="eyebrow text-ultraviolet">Étape {n}</p>
      <h2 id={`step-${n}`} className="mb-4 text-xl">{title}</h2>
      {children}
    </section>
  );
}

export function NewProjectWizard({ surahs, translations }: { surahs: Surah[]; translations: Record<Country, string | null> }) {
  const router = useRouter();
  const [mode, setMode] = useState<'word_by_word' | 'full_verse'>('word_by_word');
  const [country, setCountry] = useState<Country>('FR');
  const [query, setQuery] = useState('');
  const [surah, setSurah] = useState<Surah | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [individual, setIndividual] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [intro, setIntro] = useState(true);
  const [title, setTitle] = useState('');
  const [previewState, setPreviewState] = useState<{ key: string; data: SelectionPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return surahs;
    return surahs.filter((s) => String(s.id) === q || s.nameTransliterated?.toLowerCase().includes(q) || s.nameEnglish?.toLowerCase().includes(q) || s.nameArabic?.includes(query.trim()));
  }, [query, surahs]);

  const verses = useMemo(() => {
    if (!surah) return [];
    if (individual) return [...picked].sort((a, b) => a - b);
    const a = Math.max(1, Math.min(from, to));
    const b = Math.min(surah.verseCount, Math.max(from, to));
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }, [surah, individual, picked, from, to]);

  const fullVerseUnavailable = mode === 'full_verse' && !translations[country];
  const tooMany = verses.length > MAX_VERSES;

  const selectionKey = surah && verses.length > 0 && !fullVerseUnavailable ? `${surah.id}|${mode}|${country}|${verses.slice(0, 6).join(',')}` : null;
  const preview = selectionKey && previewState?.key === selectionKey ? previewState.data : null;
  useEffect(() => {
    if (!selectionKey || !surah) return;
    const t = setTimeout(async () => {
      const r = await previewSelection({ surah: surah.id, verses: verses.slice(0, MAX_VERSES), mode, country });
      if (r.ok) setPreviewState({ key: selectionKey, data: r.data });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectionKey captures the relevant inputs
  }, [selectionKey]);

  function choose(s: Surah) {
    setSurah(s);
    setFrom(1);
    setTo(Math.min(s.verseCount, 7));
    setPicked(new Set([1]));
    setIntro(s.id !== 9);
    setTitle(`${s.nameTransliterated ?? `Sourate ${s.id}`} — ${mode === 'word_by_word' ? 'mot à mot' : 'versets'}`);
  }

  function submit() {
    if (!surah) return;
    setError(null);
    start(async () => {
      const r = await createProject({ title: title || `Sourate ${surah.id}`, mode, country, surah: surah.id, verses, bismillahIntro: intro });
      if (r.ok) router.push(`/editor/${r.data.id}`);
      else setError(r.error);
    });
  }

  return (
    <div className="relative min-h-dvh">
      <div className="nebula-glow pointer-events-none absolute inset-x-0 top-0 h-[300px]" aria-hidden />
      <main className="relative mx-auto max-w-3xl space-y-5 px-4 pb-28 pt-6 sm:px-6">
        <Button asChild variant="ghost" className="gap-2"><Link href="/projects"><ArrowLeft className="size-4" /> Mes projets</Link></Button>
        <h1 className="text-3xl">Nouveau projet</h1>

        <Step n={1} title="Mode de vidéo">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['word_by_word', 'Mot à mot', 'Cadres arabe + traduction française du classeur, 5 cadres max par scène.', Captions],
                ['full_verse', 'Versets complets', 'Verset entier avec la traduction du pays choisi.', BookOpenText],
              ] as const
            ).map(([value, label, desc, Icon]) => (
              <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value} className={cn('rounded-xl border p-4 text-left transition-colors', mode === value ? 'border-ultraviolet bg-void-canvas' : 'border-hairline hover:bg-void-canvas/50')}>
                <Icon className="mb-2 size-5 text-aurora-mint" aria-hidden />
                <span className="block text-lunar-white">{label}</span>
                <span className="text-sm text-steel">{desc}</span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="Pays et marque">
          <div className="flex flex-wrap gap-2">
            {COUNTRIES.map((c) => (
              <Button key={c.code} variant={country === c.code ? 'secondary' : 'ghost'} onClick={() => setCountry(c.code)} aria-pressed={country === c.code}>{c.label}</Button>
            ))}
          </div>
          <p className="mt-3 text-sm text-steel">
            Marque : Al-Huda International {country === 'FR' ? 'France' : country === 'UK' ? 'UK' : 'Sweden'}
            {mode === 'full_verse' && ` · traduction : ${translations[country] ?? 'non disponible'}`}
            {country !== 'FR' && ' · QR code : en attente du fichier officiel'}
          </p>
          {fullVerseUnavailable && <p role="alert" className="mt-2 text-sm text-amber">Aucune traduction importée pour ce pays.</p>}
        </Step>

        <Step n={3} title="Sourate">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-steel" aria-hidden />
            <Input aria-label="Rechercher une sourate par numéro ou par nom" placeholder="Numéro ou nom (ex. 36, Ya-Sin, الكهف)" value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 rounded-full pl-9" />
          </div>
          <ul className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3" aria-label="Sourates">
            {filtered.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => choose(s)} aria-pressed={surah?.id === s.id} className={cn('w-full rounded-xl border p-2 text-left transition-colors', surah?.id === s.id ? 'border-ultraviolet bg-void-canvas' : 'border-hairline hover:bg-void-canvas/50')}>
                  <span className="block text-center text-3xl leading-snug" style={{ fontFamily: "'QF Surah Names'" }} aria-hidden>{String(s.id).padStart(3, '0')}</span>
                  <span className="block truncate text-xs text-lunar-white">{s.id}. {s.nameTransliterated ?? ''}</span>
                  <span className="block text-[11px] text-steel">{s.verseCount} versets</span>
                </button>
              </li>
            ))}
          </ul>
        </Step>

        {surah && (
          <Step n={4} title="Versets">
            <div className="mb-3 flex items-center gap-3">
              <Switch id="individual" checked={individual} onCheckedChange={setIndividual} />
              <Label htmlFor="individual">Choisir des versets individuellement</Label>
            </div>
            {!individual ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="from">Du verset</Label>
                  <Input id="from" type="number" min={1} max={surah.verseCount} value={from} onChange={(e) => setFrom(Number(e.target.value) || 1)} className="h-11 w-28 rounded-full" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="to">au verset</Label>
                  <Input id="to" type="number" min={1} max={surah.verseCount} value={to} onChange={(e) => setTo(Number(e.target.value) || 1)} className="h-11 w-28 rounded-full" />
                </div>
                <span className="pb-3 text-sm text-steel">sur {surah.verseCount}</span>
              </div>
            ) : (
              <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label="Versets">
                {Array.from({ length: surah.verseCount }, (_, i) => i + 1).map((v) => (
                  <button key={v} type="button" aria-pressed={picked.has(v)} onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; })} className={cn('h-9 min-w-9 rounded-full border px-2 text-xs', picked.has(v) ? 'border-ultraviolet bg-void-canvas text-lunar-white' : 'border-hairline text-steel')}>
                    {v}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-sm text-steel">{verses.length} verset{verses.length > 1 ? 's' : ''} sélectionné{verses.length > 1 ? 's' : ''}{tooMany ? ` — maximum ${MAX_VERSES}` : ''}</p>
            {preview && (
              <div className="mt-4 space-y-3 rounded-xl border border-hairline bg-singularity p-4" aria-label="Aperçu du texte">
                {preview.map((p) => (
                  <div key={p.verse}>
                    <p dir="rtl" lang="ar" className="text-2xl leading-loose" style={{ fontFamily: "'KFGQPC HAFS'" }}>{p.arabic}</p>
                    <p className="text-sm text-steel">{surah.id}:{p.verse} · {p.wordCount} mots — {p.french.length > 220 ? `${p.french.slice(0, 220)}…` : p.french}</p>
                  </div>
                ))}
                {verses.length > preview.length && <p className="text-xs text-steel">… et {verses.length - preview.length} autre(s) verset(s).</p>}
              </div>
            )}
          </Step>
        )}

        {surah && (
          <Step n={5} title="Options">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="intro">Introduction Bismillah</Label>
                  <p className="text-xs text-steel">{surah.id === 9 ? 'Sourate At-Tawba : pas de Bismillah.' : surah.id === 1 ? 'Calligraphie séparée ; le verset 1:1 reste dans les scènes.' : 'Calligraphie avant les versets.'}</p>
                </div>
                <Switch id="intro" checked={intro && surah.id !== 9} disabled={surah.id === 9} onCheckedChange={setIntro} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="title">Titre du projet</Label>
                <Input id="title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-full" />
              </div>
            </div>
          </Step>
        )}

        {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}
      </main>
      <div className="safe-bottom fixed inset-x-0 bottom-0 border-t border-hairline bg-singularity/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="truncate text-sm text-steel">{surah ? `${surah.id}. ${surah.nameTransliterated ?? ''} · ${verses.length} verset(s)` : 'Choisissez une sourate'}</p>
          <Button size="lg" disabled={!surah || verses.length === 0 || tooMany || fullVerseUnavailable || pending} onClick={submit} className="gap-2">
            {pending && <Loader2 className="animate-spin" />} Créer et générer les scènes
          </Button>
        </div>
      </div>
    </div>
  );
}
