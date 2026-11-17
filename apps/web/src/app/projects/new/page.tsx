import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NewProjectWizard } from '@/components/projects/NewProjectWizard';
import { countryTranslation, listSurahs } from '@/lib/content';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Nouveau projet' };
export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const sb = await createSupabaseServerClient();
  if (!sb) redirect('/');
  const { data: claims } = await sb.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/login?next=/projects/new');
  const [surahs, fr, uk, se] = await Promise.all([listSurahs(sb), countryTranslation(sb, 'FR'), countryTranslation(sb, 'UK'), countryTranslation(sb, 'SE')]);
  return <NewProjectWizard surahs={surahs} translations={{ FR: fr?.name ?? null, UK: uk?.name ?? null, SE: se?.name ?? null }} />;
}
