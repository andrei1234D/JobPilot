/**
 * A small, tolerant reader for the subset of Markdown the logs use:
 * `##` sections, pipe tables and bullet lists.
 *
 * Why not remark-gfm here? GFM drops every cell past the header's column count,
 * and logs written by hand (or by an agent) contain unescaped pipes inside cells
 * ("Application received | JR33814"). Losing that text silently is worse than a
 * slightly odd row, so this reader keeps the overflow and reports a warning.
 */

export interface Section {
  /** Heading text without the leading `#`s. Empty for text before the first heading. */
  heading: string;
  level: number;
  /** 1-based line number of the heading (or of the first line for the preamble). */
  line: number;
  /** Body lines, without the heading. */
  lines: string[];
  /** 1-based line number of `lines[0]`. */
  bodyLine: number;
}

/** Splits a document into sections at headings of exactly `level`. Deeper headings stay in the body. */
export function splitSections(markdown: string, level = 2): Section[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const marker = '#'.repeat(level) + ' ';
  const sections: Section[] = [];
  let current: Section = { heading: '', level: 0, line: 1, lines: [], bodyLine: 1 };
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith(marker)) {
      sections.push(current);
      current = { heading: line.slice(marker.length).trim(), level, line: index + 1, lines: [], bodyLine: index + 2 };
    } else {
      current.lines.push(line);
    }
  });
  sections.push(current);
  return sections.filter((s) => s.heading !== '' || s.lines.some((l) => l.trim() !== ''));
}

/** Splits one table row into trimmed cells. Honours `\|` and pipes inside `code spans`. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  const text = line.trim();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cell += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  // A row normally starts and ends with a pipe, which yields empty edge cells.
  if (cells.length > 0 && cells[0]!.trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

const isRow = (line: string): boolean => line.trimStart().startsWith('|');
const isSeparator = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');

export interface TableRow {
  cells: string[];
  /** 1-based line number in the source file. */
  line: number;
  raw: string;
  warnings: string[];
}

export interface Table {
  headers: string[];
  rows: TableRow[];
  line: number;
}

/**
 * Finds every pipe table in a block of lines.
 *
 * Tolerances (each one reported as a row warning, never an exception):
 * - more cells than headers: the extra cells are merged back into the last column;
 * - fewer cells than headers: missing cells become empty strings;
 * - a row that wraps onto following lines: the continuation is appended to its last cell.
 */
export function parseTables(lines: string[], firstLine = 1): Table[] {
  const tables: Table[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i]!;
    const separator = lines[i + 1];
    if (!isRow(header) || separator === undefined || !isSeparator(separator)) {
      i++;
      continue;
    }
    const headers = splitRow(header);
    const table: Table = { headers, rows: [], line: firstLine + i };
    i += 2;
    while (i < lines.length && isRow(lines[i]!)) {
      let raw = lines[i]!;
      const line = firstLine + i;
      const warnings: string[] = [];
      i++;
      // Wrapped row: it did not close with a pipe and plain text follows.
      while (
        !raw.trimEnd().endsWith('|') &&
        i < lines.length &&
        lines[i]!.trim() !== '' &&
        !isRow(lines[i]!) &&
        !/^\s*(#{1,6} |[-*+] |\d+\. )/.test(lines[i]!)
      ) {
        raw = `${raw.trimEnd()} ${lines[i]!.trim()}`;
        if (!warnings.includes('row continues on the next line')) warnings.push('row continues on the next line');
        i++;
      }
      let cells = splitRow(raw);
      if (cells.length > headers.length && headers.length > 0) {
        const head = cells.slice(0, headers.length - 1);
        const tail = cells.slice(headers.length - 1).join(' | ');
        warnings.push(`${cells.length} cells for ${headers.length} columns: extra cells kept in "${headers[headers.length - 1]}"`);
        cells = [...head, tail];
      } else if (cells.length < headers.length) {
        warnings.push(`${cells.length} cells for ${headers.length} columns: missing cells left empty`);
        cells = [...cells, ...Array<string>(headers.length - cells.length).fill('')];
      }
      table.rows.push({ cells, line, raw, warnings });
    }
    tables.push(table);
  }
  return tables;
}

export interface Bullet {
  /** The bullet's own text (wrapped lines joined), Markdown kept. */
  text: string;
  /** Full Markdown of the bullet including nested bullets. */
  markdown: string;
  line: number;
}

/** Reads top-level bullets. Nested bullets and wrapped lines stay attached to their parent. */
export function parseBullets(lines: string[], firstLine = 1): Bullet[] {
  const bullets: Bullet[] = [];
  let current: { own: string[]; all: string[]; line: number; nested: boolean } | null = null;
  const flush = (): void => {
    if (!current) return;
    bullets.push({ text: current.own.join(' ').trim(), markdown: current.all.join('\n').trimEnd(), line: current.line });
    current = null;
  };

  lines.forEach((line, index) => {
    const top = /^[-*+]\s+(.*)$/.exec(line);
    if (top) {
      flush();
      current = { own: [top[1]!.trim()], all: [`- ${top[1]!.trim()}`], line: firstLine + index, nested: false };
      return;
    }
    if (!current) return;
    if (line.trim() === '') {
      current.all.push('');
      return;
    }
    if (/^\s+/.test(line)) {
      if (/^\s+[-*+]\s+/.test(line)) current.nested = true;
      if (!current.nested) current.own.push(line.trim());
      current.all.push(line.replace(/\s+$/, ''));
      return;
    }
    // Unindented, non-bullet text ends the list.
    flush();
  });
  flush();
  return bullets;
}

/** Removes inline Markdown so text can be shown in a compact place or searched. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Small stable hash (FNV-1a) for ids that survive a re-parse of unchanged text. */
export function hashId(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
