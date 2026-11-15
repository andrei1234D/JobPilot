import { describe, expect, it } from 'vitest';
import { hashId, parseBullets, parseTables, slug, splitRow, splitSections, stripMarkdown } from '../src';

describe('splitRow', () => {
  it('splits a normal row', () => {
    expect(splitRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
  });
  it('keeps empty middle cells', () => {
    expect(splitRow('| a |  | c |')).toEqual(['a', '', 'c']);
  });
  it('honours escaped pipes and pipes in code spans', () => {
    expect(splitRow('| a \\| b | `x | y` |')).toEqual(['a | b', '`x | y`']);
  });
  it('accepts rows without edge pipes', () => {
    expect(splitRow('a | b')).toEqual(['a', 'b']);
  });
});

describe('parseTables', () => {
  const table = (rows: string[]) => parseTables(['| A | B | C |', '|---|:--|--:|', ...rows], 10)[0]!;

  it('reads headers, rows and source line numbers', () => {
    const t = table(['| 1 | 2 | 3 |', '| 4 | 5 | 6 |']);
    expect(t.headers).toEqual(['A', 'B', 'C']);
    expect(t.rows.map((r) => r.cells)).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    expect(t.rows.map((r) => r.line)).toEqual([12, 13]);
  });

  it('keeps text after an unescaped pipe instead of dropping it', () => {
    const t = table(['| 1 | 2 | received: Engineer at Acme | REQ-2291 |']);
    expect(t.rows[0]!.cells).toEqual(['1', '2', 'received: Engineer at Acme | REQ-2291']);
    expect(t.rows[0]!.warnings[0]).toMatch(/4 cells for 3 columns/);
  });

  it('pads a short row', () => {
    const t = table(['| 1 | 2 |']);
    expect(t.rows[0]!.cells).toEqual(['1', '2', '']);
    expect(t.rows[0]!.warnings[0]).toMatch(/missing cells/);
  });

  it('joins a row that wraps onto the next line', () => {
    const t = table(['| 1 | 2 | a note that', '  continues here |', '| 4 | 5 | 6 |']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]!.cells[2]).toBe('a note that continues here');
    expect(t.rows[1]!.cells).toEqual(['4', '5', '6']);
  });

  it('finds several tables and ignores prose', () => {
    const tables = parseTables(['text', '| A |', '|---|', '| 1 |', '', 'more text | with a pipe', '| B |', '|---|', '| 2 |']);
    expect(tables.map((t) => t.headers[0])).toEqual(['A', 'B']);
  });

  it('does not treat a pipe line without a separator as a table', () => {
    expect(parseTables(['| just | a | line |', 'text'])).toEqual([]);
  });
});

describe('splitSections', () => {
  it('splits at level-2 headings and keeps deeper headings in the body', () => {
    const sections = splitSections('# Title\nintro\n## One\na\n### Sub\nb\n## Two\nc');
    expect(sections.map((s) => s.heading)).toEqual(['', 'One', 'Two']);
    expect(sections[1]!.lines).toEqual(['a', '### Sub', 'b']);
    expect(sections[1]!.line).toBe(3);
    expect(sections[1]!.bodyLine).toBe(4);
  });

  it('ignores headings inside code fences and handles CRLF', () => {
    const sections = splitSections('## One\r\n```\r\n## not a heading\r\n```\r\n## Two\r\n');
    expect(sections.map((s) => s.heading)).toEqual(['One', 'Two']);
  });
});

describe('parseBullets', () => {
  it('keeps nested bullets and wrapped lines with their parent', () => {
    const bullets = parseBullets(['- **First:** one', '  wrapped line', '- Second', '  - child a', '  - child b', '', 'Paragraph ends the list', '- Third'], 5);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toMatchObject({ text: '**First:** one wrapped line', line: 5 });
    expect(bullets[1]!.text).toBe('Second');
    expect(bullets[1]!.markdown).toContain('  - child b');
    expect(bullets[2]!.line).toBe(12);
  });
});

describe('text helpers', () => {
  it('strips inline Markdown', () => {
    expect(stripMarkdown('**Rejected 9 Nov** (see `log.md`, [site](https://x.example))')).toBe('Rejected 9 Nov (see log.md, site)');
  });
  it('makes stable ids and slugs', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('abc')).not.toBe(hashId('abd'));
    expect(slug("Östra Mobility & Co. ('s-Hertogenbosch)")).toBe('ostra-mobility-co-s-hertogenbosch');
  });
});
