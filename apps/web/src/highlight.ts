/**
 * Finds where search terms occur in a text, for highlighting.
 *
 * Matching follows the search engine's own rules (case and accents ignored), so
 * what is highlighted is exactly what made the result match. This only reads
 * the terms; it does not change how results are found or ranked.
 */

const COMBINING = /[̀-ͯ]/g;

interface Folded {
  text: string;
  /** For every character of `text`, the index of the original character it came from. */
  origin: number[];
}

function fold(text: string): Folded {
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    const plain = char.normalize('NFKD').replace(COMBINING, '').toLowerCase();
    for (let k = 0; k < plain.length; k++) origin.push(i);
    folded += plain;
    i += char.length;
  }
  return { text: folded, origin };
}

/** Sorted, non-overlapping [start, end) ranges of `text` that match any term. */
export function findRanges(text: string, terms: readonly string[]): Array<[number, number]> {
  const { text: haystack, origin } = fold(text);
  const found: Array<[number, number]> = [];
  for (const raw of terms) {
    const needle = fold(raw).text.trim();
    if (!needle) continue;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      const start = origin[at]!;
      const last = origin[at + needle.length - 1]!;
      found.push([start, last + String.fromCodePoint(text.codePointAt(last)!).length]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const range of found) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export interface Piece {
  text: string;
  match: boolean;
}

/** Splits a text into alternating plain and matching pieces. */
export function splitByMatches(text: string, terms: readonly string[]): Piece[] {
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const [start, end] of findRanges(text, terms)) {
    if (start > cursor) pieces.push({ text: text.slice(cursor, start), match: false });
    pieces.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), match: false });
  return pieces;
}
