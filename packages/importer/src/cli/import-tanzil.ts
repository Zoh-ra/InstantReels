/**
 * Imports Tanzil files previously downloaded (with the owner's approval) into Supabase.
 *   npm run import:tanzil -- translation <file.txt> <fr.hamidullah|en.hilali|sv.bernstrom> [--commit]
 *   npm run import:tanzil -- metadata <quran-data.xml> [--commit]
 * Dry run by default. Translations are stored verbatim; each source keeps its attribution.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import pg from 'pg';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { HAFS_VERSE_COUNTS } from '../hafs.ts';
import { TANZIL_TRANSLATIONS, parseTanzilMetadata, parseTanzilTranslation, type TanzilTranslationId } from '../tanzil.ts';

loadDotEnv();
const [kind, file, id] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const commit = process.argv.includes('--commit');
if (!kind || !file) throw new Error('usage: import:tanzil -- translation <file> <id> | metadata <file> [--commit]');
const content = readFileSync(file, 'utf8');
const sha = createHash('sha256').update(readFileSync(file)).digest('hex');

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: requireEnv('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

if (kind === 'translation') {
  if (!id || !(id in TANZIL_TRANSLATIONS)) throw new Error(`translation id must be one of ${Object.keys(TANZIL_TRANSLATIONS).join(', ')}`);
  const meta = TANZIL_TRANSLATIONS[id as TanzilTranslationId];
  const parsed = parseTanzilTranslation(content);
  console.log(`${id}: ${parsed.verses.length} verses, ${parsed.problems.length} problem(s), header lines ${parsed.header.length}`);
  for (const p of parsed.problems.slice(0, 20)) console.log(`  - ${p}`);
  if (parsed.problems.length) throw new Error('translation file is incomplete or malformed; refusing to import');
  if (!commit) {
    console.log('dry run — nothing written');
  } else {
    await withClient(async (c) => {
      const src = await c.query<{ id: number }>(
        `insert into public.content_sources (kind, name, author, language_code, provider, provider_resource_id, license_status, license_notes, attribution_text)
         values ('verse_translation', $1, $1, $2, 'tanzil', $3, 'restricted', 'Tanzil: non-commercial use only; publisher permission required otherwise', $4)
         on conflict (provider, kind, name) do update set attribution_text = excluded.attribution_text returning id`,
        [meta.name, meta.language, id, meta.attribution],
      );
      const sourceId = src.rows[0]!.id;
      const batch = await c.query<{ id: string }>(
        `insert into public.import_batches (source_id, source_file_name, source_sha256, status, stats) values ($1, $2, $3, 'previewed', $4) returning id`,
        [sourceId, basename(file), sha, JSON.stringify({ verses: parsed.verses.length, header: parsed.header })],
      );
      const batchId = batch.rows[0]!.id;
      let inserted = 0;
      for (let i = 0; i < parsed.verses.length; i += 1000) {
        const chunk = parsed.verses.slice(i, i + 1000);
        const params: unknown[] = [];
        const tuples = chunk.map((v) => {
          params.push(v.surah, v.verse, sourceId, v.text, v.sha256, batchId);
          const n = params.length;
          return `($${n - 5},$${n - 4},$${n - 3},$${n - 2},$${n - 1},$${n})`;
        });
        const r = await c.query(`insert into public.verse_translations (surah_id, verse_number, source_id, text, text_sha256, import_batch_id) values ${tuples.join(',')} on conflict do nothing`, params);
        inserted += r.rowCount ?? 0;
      }
      await c.query(`update public.import_batches set status = 'committed', committed_at = now() where id = $1`, [batchId]);
      await c.query(`update public.country_profiles set translation_source_id = $1 where code = $2`, [sourceId, meta.country]);
      console.log(`committed: ${inserted} verse translation(s), linked to country ${meta.country}`);
    });
  }
} else if (kind === 'metadata') {
  const suras = parseTanzilMetadata(content);
  const bad = suras.filter((s) => s.ayas !== HAFS_VERSE_COUNTS[s.index - 1]);
  console.log(`metadata: ${suras.length} surahs, ${bad.length} verse-count mismatch(es)`);
  if (suras.length !== 114 || bad.length) throw new Error('metadata does not match the Hafs structure; refusing to import');
  if (!commit) console.log('dry run — nothing written');
  else {
    await withClient(async (c) => {
      for (const s of suras) {
        await c.query(`update public.surahs set name_arabic = $2, name_transliterated = $3, name_english = $4, revelation_order = $5 where id = $1`, [s.index, s.name, s.tname, s.ename, s.order]);
      }
    });
    console.log('committed: surah names updated');
  }
} else {
  throw new Error(`unknown kind ${kind}`);
}
