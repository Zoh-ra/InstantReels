/**
 * Word-by-word workbook import.
 *   npm run import:workbook            → DRY RUN: full analysis + report, no database access
 *   npm run import:workbook -- --commit → writes to Supabase in one transaction (requires approval)
 * Reads WBW_XLSX_PATH and SUPABASE_DB_URL from .env.local. Never prints credentials.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadDotEnv, requireEnv } from '@instantreels/core/node';
import { analyzeWorkbook, renderReportMarkdown } from '../analyze.ts';
import { commitWorkbook } from '../commit.ts';

loadDotEnv();
const commit = process.argv.includes('--commit');
const path = requireEnv('WBW_XLSX_PATH');

const t0 = performance.now();
const analysis = await analyzeWorkbook(path);
const outDir = resolve('output', 'import', analysis.file.sha256.slice(0, 12));
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'report.md'), renderReportMarkdown(analysis), 'utf8');
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify({ file: analysis.file, stats: analysis.stats, committable: analysis.committable, issues: analysis.issues }, null, 2), 'utf8');

const sev = (s: string) => analysis.issues.filter((i) => i.severity === s).length;
console.log(`analysed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`words ${analysis.stats.words} · verses ${analysis.stats.verses} · surahs ${analysis.stats.surahs} · separators ${analysis.stats.verseSeparators}`);
console.log(`issues: ${sev('error')} error(s), ${sev('warning')} warning(s), ${sev('info')} info`);
console.log(`report: ${resolve(outDir, 'report.md')}`);

if (!commit) {
  console.log('dry run — nothing written. Re-run with --commit after approval.');
} else {
  if (!analysis.committable) throw new Error('blocking errors in the analysis; import refused');
  const client = new pg.Client({ connectionString: requireEnv('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  await client.connect();
  try {
    const r = await commitWorkbook(client, analysis);
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await client.end();
  }
}
