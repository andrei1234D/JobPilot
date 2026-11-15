/**
 * Date helpers. Everything works on ISO day strings (yyyy-mm-dd) and UTC math,
 * so results never depend on the machine's time zone.
 */
import type { FuzzyDate } from './schemas';

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Regex source matching an English month name, short or long. */
export const MONTH_PATTERN =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

export function monthNumber(name: string): number | null {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Builds an ISO day, or null when the day does not exist (31 Feb). */
export function toIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

const DAY_MS = 86_400_000;

/** Whole days from `fromIso` to `toIsoDay` (positive when `toIsoDay` is later). */
export function daysBetween(fromIso: string, toIsoDay: string): number {
  return Math.round((toUtc(toIsoDay) - toUtc(fromIso)) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week that contains `iso`. */
export function weekStart(iso: string): string {
  const dow = new Date(toUtc(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/** Local calendar day of a Date as ISO. */
export function localIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "14 Nov 2026" */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

/** "Sat 14 Nov" */
export function formatWeekday(iso: string): string {
  const date = new Date(toUtc(iso));
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`;
}

const APPROX_PREFIX = /^(?:~|≈|ca\.?|c\.|circa|around|about|approx\.?|by|before|until|early|mid|late|end of)\s*/i;
const UNKNOWN = /^(?:|-|–|—|\?+|n\/?a|unknown|tbd|none)$/i;

/**
 * Parses a date the way a human wrote it. Never throws: text it cannot read
 * comes back as `{ iso: null, precision: 'unknown' }` with the raw text kept.
 *
 * @param refYear year to assume when the text has none ("14 Nov").
 */
export function parseFuzzyDate(raw: string, refYear?: number): FuzzyDate {
  const original = raw.trim();
  let text = original.replace(/\*\*/g, '').trim();
  if (UNKNOWN.test(text)) return { raw: original, iso: null, precision: 'unknown', approximate: false };

  let approximate = false;
  while (APPROX_PREFIX.test(text) && text.length > 0) {
    const next = text.replace(APPROX_PREFIX, '');
    if (next === text) break;
    approximate = true;
    text = next;
  }

  const unknown: FuzzyDate = { raw: original, iso: null, precision: 'unknown', approximate };
  const day = (y: number, m: number, d: number): FuzzyDate => {
    const iso = toIso(y, m, d);
    return iso ? { raw: original, iso, precision: 'day', approximate } : unknown;
  };

  // 2026-11-14 or 2026/11/14
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (match) return day(Number(match[1]), Number(match[2]), Number(match[3]));

  // 14.11.2026 (day first, as written in Europe)
  match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})\b/.exec(text);
  if (match) return day(Number(match[3]), Number(match[2]), Number(match[1]));

  // 18-19 Sep 2026: a range. The first day is kept and marked approximate.
  match = new RegExp(`^(\\d{1,2})\\s*[-–/]\\s*\\d{1,2}\\s+(${MONTH_PATTERN})\\.?,?(?:\\s+(\\d{4}))?\\b`, 'i').exec(text);
  if (match) {
    const year = match[3] ? Number(match[3]) : refYear;
    const month = monthNumber(match[2]!);
    const iso = year && month ? toIso(year, month, Number(match[1])) : null;
    return iso ? { raw: original, iso, precision: 'day', approximate: true } : unknown;
  }

  // Aug/Sep 2026: somewhere in two months. The first month is kept.
  match = new RegExp(`^(${MONTH_PATTERN})\\.?\\s*[-–/]\\s*${MONTH_PATTERN}\\.?,?\\s+(\\d{4})\\b`, 'i').exec(text);
  if (match) {
    const month = monthNumber(match[1]!);
    const iso = month ? toIso(Number(match[2]), month, 1) : null;
    if (iso) return { raw: original, iso, precision: 'month', approximate: true };
  }

  // [Sat] 14 Nov [2026]
  match = new RegExp(`^(?:[a-z]{3,9},?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?,?(?:\\s+(\\d{4}))?\\b`, 'i').exec(text);
  if (match) {
    const year = match[3] ? Number(match[3]) : refYear;
    const month = monthNumber(match[2]!);
    if (year && month) return day(year, month, Number(match[1]));
    return unknown;
  }

  // Nov 14[, 2026]
  match = new RegExp(`^(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(text);
  if (match && !(match[3] === undefined && /^\d{4}$/.test(match[2]!))) {
    const year = match[3] ? Number(match[3]) : refYear;
    const month = monthNumber(match[1]!);
    if (year && month) return day(year, month, Number(match[2]));
    return unknown;
  }

  // Nov 2026 -> month precision
  match = new RegExp(`^(${MONTH_PATTERN})\\.?,?\\s+(\\d{4})\\b`, 'i').exec(text);
  if (match) {
    const month = monthNumber(match[1]!);
    const iso = month ? toIso(Number(match[2]), month, 1) : null;
    if (iso) return { raw: original, iso, precision: 'month', approximate: true };
  }

  return unknown;
}

export interface FoundDate {
  iso: string;
  time: string | null;
  index: number;
  length: number;
}

/**
 * Finds every "9 Nov", "9 Nov 2026" or "9 Nov 15:20" inside free text.
 * A missing year is inferred from `anchorIso` (normally the application date):
 * "3 Jan" in a row applied on "20 Dec 2026" is January 2027. A date only a few
 * weeks before the anchor is left alone: it is a reference to something earlier
 * ("an earlier application was rejected 17 Sep"), not a wrap into the next year.
 */
export function findDates(text: string, anchorIso: string | null, fallbackYear: number): FoundDate[] {
  const pattern = new RegExp(
    `(?<![\\d-])(\\d{1,2})\\s+(${MONTH_PATTERN})\\b\\.?(?:,?\\s+(\\d{4}))?(?:,?\\s+(?:at\\s+)?~?(\\d{1,2}:\\d{2}))?`,
    'gi',
  );
  const found: FoundDate[] = [];
  for (const match of text.matchAll(pattern)) {
    const dayNum = Number(match[1]);
    const month = monthNumber(match[2]!);
    if (!month || dayNum < 1 || dayNum > 31) continue;
    let iso: string | null;
    if (match[3]) {
      iso = toIso(Number(match[3]), month, dayNum);
    } else {
      const baseYear = anchorIso ? Number(anchorIso.slice(0, 4)) : fallbackYear;
      iso = toIso(baseYear, month, dayNum);
      // More than half a year "before" the application: the year has rolled over.
      if (iso && anchorIso && daysBetween(anchorIso, iso) < -183) iso = toIso(baseYear + 1, month, dayNum);
    }
    if (!iso) continue;
    found.push({ iso, time: match[4] ?? null, index: match.index, length: match[0].length });
  }
  return found;
}
