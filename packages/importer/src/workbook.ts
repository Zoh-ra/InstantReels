import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import ExcelJS from 'exceljs';
import { classifyRow, type CellValue, type ClassifiedRow } from './classify.ts';

/** Stop after this many consecutive empty rows (the sheet declares 1,048,576 formatted rows). */
const MAX_TRAILING_BLANK_ROWS = 50;

function cellToValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('');
  if (typeof v === 'object' && 'text' in v && typeof v.text === 'string') return v.text;
  return String(v);
}

/**
 * Streams the first worksheet, reading only columns A–E, and yields classified rows.
 * Memory-bounded: shared strings are cached, cells beyond column E are ignored.
 */
export async function* readWorkbookRows(path: string): AsyncGenerator<ClassifiedRow> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
    entries: 'emit',
  });
  for await (const worksheet of reader) {
    let blankRun = 0;
    for await (const row of worksheet) {
      const r = row as ExcelJS.Row;
      const classified = classifyRow({
        rowNumber: r.number,
        a: cellToValue(r.getCell(1).value),
        b: cellToValue(r.getCell(2).value),
        c: cellToValue(r.getCell(3).value),
        d: cellToValue(r.getCell(4).value),
        e: cellToValue(r.getCell(5).value),
      });
      if (classified.kind === 'blank') {
        blankRun += 1;
        if (blankRun >= MAX_TRAILING_BLANK_ROWS) return;
        continue;
      }
      blankRun = 0;
      yield classified;
    }
    return; // first worksheet only
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
