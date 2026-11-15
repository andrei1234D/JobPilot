/**
 * Parser for the applications log: one Markdown file, split by `##` headings
 * into status sections, each holding a pipe table with one row per application.
 *
 * Design rule: an unknown or broken format must never crash the app. Whatever
 * cannot be understood is kept as raw text and reported as a warning.
 */
import { parseCompany } from '../company';
import { parseFuzzyDate } from '../dates';
import type { Application, ApplicationsLog, NeedsItem, ParseWarning, SectionNote, Status } from '../schemas';
import { classifyChannel, classifyRegion, extractContacts, extractCvVariant, extractEvents, lastEventOf } from './classify';
import { hashId, parseBullets, parseTables, slug, splitSections, stripMarkdown, type TableRow } from './markdown';

/** "## 4. No reply for 4+ weeks (applied before October)" -> "No reply for 4+ weeks (applied before October)" */
function cleanHeading(heading: string): string {
  return heading.replace(/^\d+[.)]\s*/, '').trim();
}

export type SectionKind = Status | 'needs';

/**
 * Maps a section heading to a status. Order matters: "Not applied" and
 * "No reply ... (applied before October)" both contain the word "applied".
 */
export function sectionKind(heading: string): SectionKind {
  const text = cleanHeading(heading).toLowerCase();
  if (/^needs\b|action (?:needed|required)|to[\s-]?do\b/.test(text)) return 'needs';
  if (/not applied|did(?: not|n't) apply|skipped|decided against|won't apply/.test(text)) return 'not_applied';
  if (/no (?:reply|response|answer)|ghosted|silent|stale/.test(text)) return 'no_reply';
  if (/reject|declined|closed/.test(text)) return 'rejected';
  if (/offer/.test(text)) return 'offer';
  if (/interview|assessment|\btests?\b/.test(text)) return 'interview';
  if (/^old\b|archive|history/.test(text)) return 'archived';
  if (/waiting|pending|applied|in progress|open|active/.test(text)) return 'waiting';
  return 'unknown';
}

type Field = 'date' | 'company' | 'role' | 'location' | 'channel' | 'history';

const HEADER_FIELDS: ReadonlyArray<[Field, RegExp]> = [
  ['date', /^(applied|date|sent|when|day)\b/i],
  ['company', /^(company|employer|organi[sz]ation|firm)\b/i],
  ['role', /^(role|position|title|job)\b/i],
  ['location', /^(location|where|place|city)\b/i],
  ['channel', /(channel|cv\b|via|how|source|method)/i],
  ['history', /(what happened|history|status|notes?|why|reason|outcome|result|updates?)/i],
];

function mapHeaders(headers: string[]): Array<Field | null> {
  const used = new Set<Field>();
  return headers.map((header) => {
    const plain = stripMarkdown(header);
    for (const [field, pattern] of HEADER_FIELDS) {
      if (!used.has(field) && pattern.test(plain)) {
        used.add(field);
        return field;
      }
    }
    return null;
  });
}

/** "Software Engineer (Teamtailor 8724853, LinkedIn 4489832114)" -> title + note. */
function splitTrailingNote(text: string): { main: string; note: string | null } {
  const match = /^(.*?\S)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(text);
  if (!match || match[1]!.length < 2) return { main: text, note: null };
  return { main: match[1]!.trim(), note: match[2]!.trim() };
}

/** Requisition and job-board ids that identify one posting, e.g. "LinkedIn 4489832114". */
function extractJobIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\b(?:LinkedIn|Teamtailor|Greenhouse|Jobylon|Workable|Lever|Ashby)\s+(?:job\s+)?#?(\d{6,}|[0-9a-f]{8}-[0-9a-f-]{27})/gi)) {
    ids.add(match[1]!.toLowerCase());
  }
  for (const match of text.matchAll(/\b[\w.-]+\.[a-z]{2,}\/[^\s|)]*?\/(\d{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)) {
    ids.add(match[1]!.toLowerCase());
  }
  return [...ids];
}

export interface ParseOptions {
  /** File name used in warnings. */
  file?: string;
  /** Year assumed for dates written without one. Defaults to the current year. */
  referenceYear?: number;
}

/** Parses the whole applications log. Never throws on malformed content. */
export function parseApplicationsLog(markdown: string, options: ParseOptions = {}): ApplicationsLog {
  const file = options.file ?? 'applications_log.md';
  const referenceYear = options.referenceYear ?? new Date().getFullYear();
  const applications: Application[] = [];
  const needs: NeedsItem[] = [];
  const notes: SectionNote[] = [];
  const warnings: ParseWarning[] = [];
  const idCounts = new Map<string, number>();

  for (const section of splitSections(markdown, 2)) {
    if (section.level === 0) continue; // preamble: instructions for whoever maintains the file
    const heading = cleanHeading(section.heading);
    const kind = sectionKind(section.heading);

    if (kind === 'needs') {
      for (const bullet of parseBullets(section.lines, section.bodyLine)) {
        const title = stripMarkdown(bullet.text);
        needs.push({ id: `need-${hashId(title)}`, markdown: bullet.markdown, title, source: file, line: bullet.line });
      }
      continue;
    }
    if (kind === 'unknown') {
      warnings.push({ file, line: section.line, message: `Unknown section "${heading}": rows are shown under "Other"` });
    }

    const tables = parseTables(section.lines, section.bodyLine);
    if (tables.length === 0) {
      const text = section.lines.join('\n').trim();
      if (text) notes.push({ heading, markdown: text });
      continue;
    }

    for (const table of tables) {
      const fields = mapHeaders(table.headers);
      if (!fields.includes('company')) {
        warnings.push({ file, line: table.line, message: `Table under "${heading}" has no Company column: skipped` });
        continue;
      }
      for (const row of table.rows) {
        try {
          const application = buildApplication(row, fields, kind, heading, referenceYear);
          const seen = idCounts.get(application.id) ?? 0;
          idCounts.set(application.id, seen + 1);
          if (seen > 0) application.id = `${application.id}-${seen + 1}`;
          applications.push(application);
          for (const message of application.warnings) warnings.push({ file, line: row.line, message });
        } catch (error) {
          // Belt and braces: a bug in one row must not hide the other hundred.
          warnings.push({ file, line: row.line, message: `Row could not be read (${String(error)}): ${row.raw.slice(0, 120)}` });
        }
      }
    }
  }
  return { applications, needs, notes, warnings };
}

function buildApplication(
  row: TableRow,
  fields: Array<Field | null>,
  status: Status,
  section: string,
  referenceYear: number,
): Application {
  const cell = (field: Field): string => {
    const index = fields.indexOf(field);
    return index === -1 ? '' : (row.cells[index] ?? '');
  };
  const warnings = [...row.warnings];

  const applied = parseFuzzyDate(cell('date'), referenceYear);
  if (applied.precision === 'unknown' && !/^(|-|unknown|\?)$/i.test(stripMarkdown(cell('date')))) {
    warnings.push(`Date "${cell('date')}" not understood`);
  }

  const companyCell = stripMarkdown(cell('company'));
  if (!companyCell) warnings.push('Row has no company name');
  const company = parseCompany(companyCell || '(unknown)');

  const roleCell = stripMarkdown(cell('role'));
  const role = splitTrailingNote(roleCell);

  // The "not applied" table has no Location column; the place is usually in the role note.
  const location = stripMarkdown(cell('location'));
  const channelRaw = cell('channel');
  const history = cell('history');
  const allText = row.cells.join(' | ');

  const year = applied.iso ? Number(applied.iso.slice(0, 4)) : referenceYear;
  const events = extractEvents(history, applied.precision === 'day' ? applied.iso : null, year);
  const region = classifyRegion(location || roleCell);

  return {
    id: [slug(company.name) || 'unknown', slug(role.main) || 'role', applied.iso ?? 'undated'].join('--'),
    status,
    section,
    applied,
    company: company.name,
    companyNote: company.note,
    companyKey: company.key,
    role: role.main,
    roleNote: role.note,
    location,
    region,
    channel: classifyChannel(channelRaw),
    channelRaw: stripMarkdown(channelRaw),
    cvVariant: extractCvVariant(channelRaw),
    history,
    events,
    lastEvent: lastEventOf(events),
    contacts: extractContacts(`${channelRaw}. ${history}`),
    jobIds: extractJobIds(allText),
    line: row.line,
    warnings,
  };
}
