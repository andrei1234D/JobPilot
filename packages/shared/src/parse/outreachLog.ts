/**
 * Parser for the outreach log: messages sent to people and LinkedIn
 * connection requests, each in its own table.
 */
import { parseCompany } from '../company';
import { parseFuzzyDate } from '../dates';
import type { Connection, ConnectionStatus, OutreachLog, OutreachMessage, ParseWarning, SectionNote } from '../schemas';
import type { ParseOptions } from './applicationsLog';
import { hashId, parseTables, splitSections, stripMarkdown, type Table } from './markdown';

function headerIndex(table: Table, pattern: RegExp): number {
  return table.headers.findIndex((header) => pattern.test(stripMarkdown(header)));
}

export function connectionStatus(text: string): ConnectionStatus {
  const plain = stripMarkdown(text).toLowerCase();
  if (/^(accepted|connected)\b|\baccepted\b/.test(plain) && !/^pending\b/.test(plain)) return 'accepted';
  if (/^(declined|ignored|rejected)\b/.test(plain)) return 'declined';
  if (/^(withdrawn|cancelled|canceled|removed)\b/.test(plain)) return 'withdrawn';
  if (/^(pending|sent|waiting|invited)\b/.test(plain)) return 'pending';
  return 'unknown';
}

/** A reply is something the other person did; "no reply" and "waiting for reply" are not replies. */
export function hasReply(status: string): boolean {
  const plain = stripMarkdown(status);
  return /(?<!\bno )(?<!\bfor )(?<!\bfor a )(?<!\bpersonal )\b(replied|responded|wrote back|called)\b/i.test(plain);
}

/** "Ana Pop (Talent Acquisition Partner, job poster)" -> name + role. */
function splitPerson(text: string): { name: string; role: string | null } {
  const plain = stripMarkdown(text);
  const match = /^(.*?)\s*\((.*)\)\s*$/.exec(plain);
  return match && match[1] ? { name: match[1].trim(), role: match[2]!.trim() } : { name: plain, role: null };
}

export function parseOutreachLog(markdown: string, options: ParseOptions = {}): OutreachLog {
  const file = options.file ?? 'outreach_log.md';
  const referenceYear = options.referenceYear ?? new Date().getFullYear();
  const messages: OutreachMessage[] = [];
  const connections: Connection[] = [];
  const notes: SectionNote[] = [];
  const warnings: ParseWarning[] = [];

  for (const section of splitSections(markdown, 2)) {
    if (section.level === 0) continue;
    const heading = section.heading.replace(/^\d+[.)]\s*/, '').trim();
    const tables = parseTables(section.lines, section.bodyLine);
    if (tables.length === 0) {
      const text = section.lines.join('\n').trim();
      if (text) notes.push({ heading, markdown: text });
      continue;
    }

    for (const table of tables) {
      const date = headerIndex(table, /^(date|sent|when)\b/i);
      const person = headerIndex(table, /^(person|name|who|contact)\b/i);
      const company = headerIndex(table, /^(company|organi[sz]ation)/i);
      const status = headerIndex(table, /^(status|outcome|result|reply)\b/i);
      const profile = headerIndex(table, /^(profile|url|link)\b/i);
      const about = headerIndex(table, /(channel|about|message|what|subject)/i);
      if (person === -1 || date === -1) {
        warnings.push({ file, line: table.line, message: `Table under "${heading}" has no Person or Date column: skipped` });
        continue;
      }
      // A table with a profile column, or under a "Connection requests" heading, lists connects.
      const isConnections = profile !== -1 || /connect/i.test(heading);

      for (const row of table.rows) {
        for (const message of row.warnings) warnings.push({ file, line: row.line, message });
        const cell = (index: number): string => (index === -1 ? '' : (row.cells[index] ?? ''));
        const who = splitPerson(cell(person));
        const org = parseCompany(stripMarkdown(cell(company)) || '(unknown)');
        const when = parseFuzzyDate(cell(date), referenceYear);
        const id = hashId(`${cell(date)}|${cell(person)}|${cell(company)}`);

        if (isConnections) {
          const url = stripMarkdown(cell(profile));
          connections.push({
            id: `conn-${id}`,
            sent: when,
            person: who.name,
            company: org.name,
            companyKey: org.key,
            profileUrl: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
            status: connectionStatus(cell(status)),
            statusRaw: stripMarkdown(cell(status)),
            line: row.line,
          });
        } else {
          messages.push({
            id: `msg-${id}`,
            date: when,
            person: who.name,
            personRole: who.role,
            company: org.name,
            companyKey: org.key,
            about: stripMarkdown(cell(about)),
            status: stripMarkdown(cell(status)),
            replied: hasReply(cell(status)),
            line: row.line,
          });
        }
      }
    }
  }
  return { messages, connections, notes, warnings };
}
