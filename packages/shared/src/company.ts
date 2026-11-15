/**
 * Company-name normalisation and the repeat check
 * ("have I already applied to these people?").
 */
import type { Application, RepeatMatch } from './schemas';

/** Words that say nothing about which company it is. */
const NOISE = new Set([
  'the',
  'inc',
  'incorporated',
  'ltd',
  'limited',
  'llc',
  'plc',
  'bv',
  'nv',
  'ab',
  'as',
  'asa',
  'oy',
  'oyj',
  'gmbh',
  'ag',
  'sa',
  'srl',
  'sarl',
  'spa',
  'co',
  'corp',
  'corporation',
  'company',
  'group',
  'groep',
  'holding',
  'holdings',
  'international',
]);

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Tokens of a name with punctuation, accents and legal suffixes removed. */
export function companyTokens(name: string): string[] {
  const tokens = fold(name)
    // "B.V." and "S.R.L." are one word each, not a string of single letters.
    .replace(/\b(?:[a-z]\.){2,}/g, (abbreviation) => abbreviation.replace(/\./g, ''))
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = tokens.filter((t) => !NOISE.has(t));
  return meaningful.length > 0 ? meaningful : tokens;
}

export interface CompanyName {
  /** Name without the parenthesised note. */
  name: string;
  note: string | null;
  /** Normalised key: "KVD (Kanaal Venture Digital)" -> "kvd". */
  key: string;
  /** Other normalised forms this company may be written as. */
  aliases: string[];
}

/**
 * "KVD (Kanaal Venture Digital)"          -> name KVD, alias "kanaal venture digital"
 * "Brightwave (via a recruiter)"        -> name Brightwave, note kept, no alias
 * "The Loft / Annex9"                  -> aliases "loft", "annex9"
 */
export function parseCompany(raw: string): CompanyName {
  const text = raw.replace(/\*\*/g, '').trim();
  const paren = /^(.*?)\s*\((.*)\)\s*$/.exec(text);
  const name = (paren ? paren[1]! : text).trim() || text;
  const note = paren ? paren[2]!.trim() : null;
  const key = companyTokens(name).join(' ');
  const aliases = new Set<string>();

  for (const part of name.split(/\s+\/\s+|\s+\|\s+/)) {
    const alias = companyTokens(part).join(' ');
    if (alias && alias !== key) aliases.add(alias);
  }
  if (note) {
    // A note is an alias when the name is its acronym ("KVD" / "Kanaal Venture Digital")
    // or when it is introduced as a former or alternative name.
    const noteWords = fold(note).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const acronym = noteWords.map((w) => w[0]).join('');
    const compactName = fold(name).replace(/[^a-z0-9]/g, '');
    const former = /^(?:ex|formerly|former|aka|also known as|now|part of)[- ]+(.+)$/i.exec(note.split(/[,;]/)[0]!.trim());
    if (compactName.length >= 2 && acronym === compactName) aliases.add(companyTokens(note).join(' '));
    else if (former) aliases.add(companyTokens(former[1]!).join(' '));
  }
  return { name, note, key, aliases: [...aliases].filter(Boolean) };
}

export function companyKey(raw: string): string {
  return parseCompany(raw).key;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** 0..1 similarity based on edit distance. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

export interface NameMatch {
  score: number;
  reason: 'exact' | 'alias' | 'tokens' | 'fuzzy';
}

/** Compares two company names as written. Returns null when they are different companies. */
export function matchCompany(a: string, b: string): NameMatch | null {
  const left = parseCompany(a);
  const right = parseCompany(b);
  if (!left.key || !right.key) return null;
  if (left.key === right.key) return { score: 1, reason: 'exact' };

  const leftForms = [left.key, ...left.aliases];
  const rightForms = [right.key, ...right.aliases];
  if (leftForms.some((form) => rightForms.includes(form))) return { score: 0.95, reason: 'alias' };

  // "Acme" vs "Acme Robotics": every token of the shorter name leads the longer one.
  const lt = left.key.split(' ');
  const rt = right.key.split(' ');
  const [short, long] = lt.length <= rt.length ? [lt, rt] : [rt, lt];
  const prefix = short.every((token, i) => long[i] === token);
  if (prefix && short.join('').length >= 3) return { score: 0.9, reason: 'tokens' };

  // Typos and spacing: "Meridian Health" vs "Meridian Helth", "Fjord Byte" vs "Fjordbyte".
  const compactLeft = left.key.replace(/ /g, '');
  const compactRight = right.key.replace(/ /g, '');
  if (compactLeft === compactRight) return { score: 0.95, reason: 'fuzzy' };
  const score = similarity(compactLeft, compactRight);
  if (Math.min(compactLeft.length, compactRight.length) >= 5 && score >= 0.86) return { score, reason: 'fuzzy' };
  return null;
}

/** Job-board ids worth an exact match: LinkedIn job ids and requisition numbers found in a URL. */
export function jobIdsFromUrl(url: string): string[] {
  const ids = new Set<string>();
  for (const match of url.matchAll(/(?:jobs\/view\/|currentJobId=|\/jobs\/|gh_jid=|\/job\/|\/j\/)(?:[a-z-]*-)?(\d{6,})/gi)) ids.add(match[1]!);
  for (const match of url.matchAll(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)) ids.add(match[1]!.toLowerCase());
  return [...ids];
}

/**
 * Finds earlier applications (and "not applied" decisions) for a company.
 * An exact job-id match wins; otherwise names are compared with `matchCompany`.
 * Results are sorted best match first, then newest first.
 */
export function isRepeat(company: string, apps: readonly Application[], url = ''): RepeatMatch[] {
  const ids = url ? jobIdsFromUrl(url) : [];
  const matches: RepeatMatch[] = [];
  for (const application of apps) {
    if (ids.length > 0 && application.jobIds.some((id) => ids.includes(id))) {
      matches.push({ application, score: 1, reason: 'job_id' });
      continue;
    }
    if (!company.trim()) continue;
    const written = application.companyNote ? `${application.company} (${application.companyNote})` : application.company;
    const match = matchCompany(company, written);
    if (match) matches.push({ application, ...match });
  }
  const rank = (m: RepeatMatch): number => (m.reason === 'job_id' ? 2 : m.score);
  return matches.sort((a, b) => rank(b) - rank(a) || (b.application.applied.iso ?? '').localeCompare(a.application.applied.iso ?? ''));
}
