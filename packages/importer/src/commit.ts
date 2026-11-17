import type pg from 'pg';
import type { WorkbookAnalysis } from './analyze.ts';

export interface CommitResult {
  status: 'committed' | 'already_imported';
  batchId: string;
  inserted: { words: number; translations: number; verses: number; surahs: number; issues: number };
  /** existing rows whose text differs from the workbook — NOT overwritten, reported for review */
  conflicts: number;
}

const CHUNK = 1000;

async function insertChunks<T>(client: pg.Client, rows: readonly T[], columns: string[], table: string, toValues: (r: T) => unknown[], suffix = ''): Promise<number> {
  let affected = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((r) => {
      const vals = toValues(r);
      const ph = vals.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    const res = await client.query(`insert into ${table} (${columns.join(',')}) values ${tuples.join(',')} ${suffix}`, params);
    affected += res.rowCount ?? 0;
  }
  return affected;
}

/**
 * Writes the analysed workbook in ONE transaction (all or nothing).
 * - Idempotent: a file already committed (same SHA-256) is a no-op.
 * - Existing words/glosses are never overwritten: a differing value becomes a review issue.
 */
export async function commitWorkbook(client: pg.Client, a: WorkbookAnalysis): Promise<CommitResult> {
  if (!a.committable) throw new Error('analysis contains blocking errors; refusing to import');
  await client.query('begin');
  try {
    const done = await client.query<{ id: string }>(`select id from public.import_batches where source_sha256 = $1 and status = 'committed'`, [a.file.sha256]);
    if (done.rows[0]) {
      await client.query('rollback');
      return { status: 'already_imported', batchId: done.rows[0].id, inserted: { words: 0, translations: 0, verses: 0, surahs: 0, issues: 0 }, conflicts: 0 };
    }

    const src = async (kind: string, name: string, lang: string, attribution: string) => {
      const r = await client.query<{ id: number }>(
        `insert into public.content_sources (kind, name, language_code, provider, license_status, license_notes, attribution_text)
         values ($1, $2, $3, 'workbook', 'pending', 'Owner-supplied workbook; publication rights to be confirmed in writing', $4)
         on conflict (provider, kind, name) do update set name = excluded.name returning id`,
        [kind, name, lang, attribution],
      );
      return r.rows[0]!.id;
    };
    const arabicSource = await src('arabic_text', 'Workbook — Arabic text (QPC Hafs encoding)', 'ar', 'Texte arabe : classeur mot à mot du Dr Usama Nonnenmacher');
    const frenchSource = await src('word_translation', 'Dr Usama Nonnenmacher — traduction mot à mot', 'fr', 'Traduction mot à mot : Dr Usama Nonnenmacher');

    const batch = await client.query<{ id: string }>(
      `insert into public.import_batches (source_id, source_file_name, source_sha256, status, stats) values ($1, $2, $3, 'previewed', $4) returning id`,
      [frenchSource, a.file.name, a.file.sha256, JSON.stringify(a.stats)],
    );
    const batchId = batch.rows[0]!.id;

    // surahs + verses (structure)
    const surahCounts = new Map<number, number>();
    for (const v of a.verses.values()) surahCounts.set(v.surah, (surahCounts.get(v.surah) ?? 0) + 1);
    const surahs = await insertChunks(client, [...surahCounts.entries()], ['id', 'verse_count'], 'public.surahs', ([id, n]) => [id, n], 'on conflict (id) do nothing');
    const verses = await insertChunks(client, [...a.verses.values()], ['surah_id', 'verse_number', 'word_count'], 'public.verses', (v) => [v.surah, v.verse, v.wordCount], 'on conflict (surah_id, verse_number) do nothing');

    // words: insert new rows only; compare existing ones afterwards
    const words = await insertChunks(
      client, a.words,
      ['surah_id', 'verse_number', 'position', 'text_arabic', 'text_sha256', 'source_id', 'import_batch_id', 'source_row'],
      'public.quran_words',
      (w) => [w.surah, w.verse, w.position, w.arabic, w.arabicSha256, arabicSource, batchId, w.sourceRow],
      'on conflict (surah_id, verse_number, position) do nothing',
    );
    const translations = await insertChunks(
      client, a.words,
      ['surah_id', 'verse_number', 'position', 'source_id', 'text', 'import_batch_id'],
      'public.word_translations',
      (w) => [w.surah, w.verse, w.position, frenchSource, w.french, batchId],
      'on conflict (surah_id, verse_number, position, source_id) do nothing',
    );

    // conflicts with previously imported content: report, never overwrite
    let conflicts = 0;
    const conflictIssues: WorkbookAnalysis['issues'] = [];
    if (words < a.words.length || translations < a.words.length) {
      const existing = await client.query<{ k: string; sha: string; fr: string }>(
        `select w.surah_id || ':' || w.verse_number || ':' || w.position as k, w.text_sha256 as sha, t.text as fr
           from public.quran_words w join public.word_translations t using (surah_id, verse_number, position) where t.source_id = $1`,
        [frenchSource],
      );
      const map = new Map(existing.rows.map((r) => [r.k, r]));
      for (const w of a.words) {
        const k = `${w.surah}:${w.verse}:${w.position}`;
        const e = map.get(k);
        if (e && (e.sha !== w.arabicSha256 || e.fr !== w.french)) {
          conflicts++;
          conflictIssues.push({ severity: 'warning', code: 'source_changed', ref: k, rowNumber: w.sourceRow, message: 'Workbook differs from the stored text; stored text kept — use the revision process' });
        }
      }
    }

    const allIssues = [...a.issues, ...conflictIssues];
    const issues = await insertChunks(client, allIssues, ['batch_id', 'row_number', 'ref', 'severity', 'code', 'message'], 'public.import_validation_issues', (i) => [batchId, i.rowNumber, i.ref, i.severity, i.code, i.message]);

    await client.query(`update public.import_batches set status = 'committed', committed_at = now(), stats = stats || $2::jsonb where id = $1`, [batchId, JSON.stringify({ inserted: { words, translations, verses, surahs }, conflicts })]);
    await client.query('commit');
    return { status: 'committed', batchId, inserted: { words, translations, verses, surahs, issues }, conflicts };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
}
