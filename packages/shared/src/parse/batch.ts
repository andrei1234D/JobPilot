/**
 * Parser for a daily batch file (batch_YYYY-MM-DD.md): the agent's report for
 * one day, with a table of proposed roles and a "Needs <name>" list of things
 * only the human can do.
 */
import type { Batch, BatchRole, BatchSummary, NeedsItem } from '../schemas';
import { hashId, parseBullets, parseTables, splitSections, stripMarkdown } from './markdown';

export function batchDateFromFile(fileName: string): string | null {
  const match = /(\d{4}-\d{2}-\d{2})/.exec(fileName);
  return match ? match[1]! : null;
}

export function parseBatch(markdown: string, fileName: string): Batch {
  const text = markdown.replace(/\r\n?/g, '\n');
  const date = batchDateFromFile(fileName) ?? '1970-01-01';
  const titleMatch = /^#\s+(.+)$/m.exec(text);
  const title = titleMatch ? stripMarkdown(titleMatch[1]!) : `Daily batch ${date}`;

  const sections = splitSections(text, 2).filter((section) => section.level === 2);
  const roles: BatchRole[] = [];
  const needs: NeedsItem[] = [];

  for (const section of sections) {
    if (/^roles?\b|shortlist|proposed/i.test(section.heading)) {
      for (const table of parseTables(section.lines, section.bodyLine)) {
        const at = (pattern: RegExp): number => table.headers.findIndex((h) => pattern.test(stripMarkdown(h)));
        const columns = {
          index: at(/^#$|^no\.?$|^nr\.?$/i),
          company: at(/^company/i),
          role: at(/^(role|position|title)/i),
          location: at(/^location/i),
          link: at(/^(link|url)/i),
          fit: at(/^fit/i),
          gap: at(/^gaps?/i),
          how: at(/^how/i),
        };
        if (columns.company === -1) continue;
        for (const row of table.rows) {
          const cell = (index: number): string => (index === -1 ? '' : stripMarkdown(row.cells[index] ?? ''));
          roles.push({
            index: cell(columns.index) || String(roles.length + 1),
            company: cell(columns.company),
            role: cell(columns.role),
            location: cell(columns.location),
            link: cell(columns.link),
            fit: cell(columns.fit),
            gap: cell(columns.gap),
            how: cell(columns.how),
          });
        }
      }
    }
    if (/^needs\b/i.test(section.heading)) {
      for (const bullet of parseBullets(section.lines, section.bodyLine)) {
        const itemTitle = stripMarkdown(bullet.text);
        needs.push({ id: `need-${date}-${hashId(itemTitle)}`, markdown: bullet.markdown, title: itemTitle, source: fileName, line: bullet.line });
      }
    }
  }

  return {
    date,
    file: fileName,
    title,
    sections: sections.map((section) => ({ heading: section.heading, markdown: section.lines.join('\n').trim() })),
    roles,
    needs,
    markdown: text,
  };
}

export function summariseBatch(batch: Batch): BatchSummary {
  return { date: batch.date, file: batch.file, title: batch.title, roleCount: batch.roles.length, needsCount: batch.needs.length };
}
