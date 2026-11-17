/**
 * Word-box pagination. Words are never split, merged, duplicated or reordered:
 * a layout is just a list of page sizes over the verse's ordered words.
 */

export const DEFAULT_MAX_BOXES_PER_SCENE = 5;

/** Balanced automatic split, e.g. 7 → [4,3], 9 → [5,4], 11 → [4,4,3]. */
export function suggestPageSizes(wordCount: number, maxPerPage = DEFAULT_MAX_BOXES_PER_SCENE): number[] {
  assertPositiveInt(wordCount, 'wordCount');
  assertPositiveInt(maxPerPage, 'maxPerPage');
  const pages = Math.ceil(wordCount / maxPerPage);
  const base = Math.floor(wordCount / pages);
  const extra = wordCount % pages;
  return Array.from({ length: pages }, (_, i) => base + (i < extra ? 1 : 0));
}

export type LayoutError = { code: 'sum_mismatch' | 'page_too_large' | 'empty_page'; message: string };

/** Validates a manual layout (e.g. 5+2 or 3+4 for a 7-word verse). */
export function validatePageSizes(sizes: readonly number[], wordCount: number, maxPerPage = DEFAULT_MAX_BOXES_PER_SCENE): LayoutError[] {
  const errors: LayoutError[] = [];
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum !== wordCount) errors.push({ code: 'sum_mismatch', message: `pages cover ${sum} words, verse has ${wordCount}` });
  sizes.forEach((s, i) => {
    if (!Number.isInteger(s) || s < 1) errors.push({ code: 'empty_page', message: `page ${i + 1} has ${s} words` });
    else if (s > maxPerPage) errors.push({ code: 'page_too_large', message: `page ${i + 1} has ${s} > ${maxPerPage} words` });
  });
  return errors;
}

/** Splits ordered items by page sizes. Throws on an invalid layout. */
export function paginate<T>(items: readonly T[], sizes: readonly number[], maxPerPage = DEFAULT_MAX_BOXES_PER_SCENE): T[][] {
  const errors = validatePageSizes(sizes, items.length, maxPerPage);
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));
  const pages: T[][] = [];
  let offset = 0;
  for (const size of sizes) {
    pages.push(items.slice(offset, offset + size));
    offset += size;
  }
  return pages;
}

function assertPositiveInt(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${n}`);
}
