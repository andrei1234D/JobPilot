/**
 * Turns the free text of a log row into structured facts:
 * channel, region, CV variant, dated events and contacts.
 *
 * Everything here is a best-effort read of prose. The raw text is always kept
 * next to the derived value, so a wrong guess is visible and never destructive.
 */
import { findDates } from '../dates';
import type { AppEvent, Channel, Contact, EventKind } from '../schemas';
import { stripMarkdown } from './markdown';

// --------------------------------------------------------------------------
// Channel
// --------------------------------------------------------------------------

const CHANNEL_RULES: ReadonlyArray<[Channel, RegExp]> = [
  ['easy_apply', /easy[\s-]?apply/i],
  ['inmail', /\binmail\b/i],
  ['teamtailor', /teamtailor/i],
  ['workday', /workday|myworkdayjobs/i],
  ['greenhouse', /greenhouse/i],
  ['lever', /\blever\b|jobs\.lever\.co/i],
  ['ashby', /ashby/i],
  ['successfactors', /success\s?factors|sapsf/i],
  ['smartrecruiters', /smartrecruiters/i],
  ['workable', /workable/i],
  ['email', /\be-?mail(?:ed)?\b.*\bto\b|\bcold e-?mail\b|^e-?mail\b|\be-?mail from\b/i],
  ['company_site', /\bform\b|careers? (?:site|page)|own (?:site|form)|website|homerun|jobylon|cornerstone|avature|tally|hubspot|recruitee|personio|bamboohr|icims/i],
  ['linkedin', /linkedin/i],
  ['job_board', /\b(indeed|glassdoor|the hub|jobgether|stepstone|monster|otta|welcome to the jungle|wellfound|angellist|ejobs|bestjobs|hipo|jobbsafari|arbetsförmedlingen|nationale vacaturebank|crossover)\b/i],
  // Anything left that names a careers page or a web address is the company's own site.
  ['company_site', /\bcareers?\b|\b[\w-]+\.(?:com|nl|se|ro|io|eu|de|co|ai|dev|org|net|example)\b/i],
];

/** The first matching rule wins, so specific systems are listed before generic words. */
export function classifyChannel(text: string): Channel {
  const plain = stripMarkdown(text);
  if (!plain || plain === '-') return 'other';
  for (const [channel, pattern] of CHANNEL_RULES) if (pattern.test(plain)) return channel;
  return 'other';
}

// --------------------------------------------------------------------------
// CV variant
// --------------------------------------------------------------------------

/** "agent CV Full-Stack RO", "CV Automation Engineer NL", "NL CV" -> "Full-Stack RO", "Automation NL", "NL". */
export function extractCvVariant(text: string): string | null {
  const plain = stripMarkdown(text);
  let match = /\bCV[\s:]+((?:[A-Z][\w+#.-]*)(?:[\s-]+(?:[A-Z][\w+#.-]*)){0,3})/.exec(plain);
  if (match) {
    const words = match[1]!
      .split(/\s+/)
      .filter((w) => !/^(Engineer|Developer|uploaded|rebuilt|attached|sent|PDF)$/i.test(w));
    const kept: string[] = [];
    for (const word of words) {
      // Stop at the first word that is clearly prose, not part of a label.
      if (!/^[A-Z]/.test(word) || /^(Yahoo|Gmail|LinkedIn|Email)$/i.test(word)) break;
      kept.push(word.replace(/[.,;:]+$/, ''));
    }
    if (kept.length > 0) return kept.join(' ');
  }
  match = /\b([A-Z]{2}) (?:full-stack |fullstack )?CV\b/.exec(plain);
  if (match) return match[1]!;
  return null;
}

// --------------------------------------------------------------------------
// Region
// --------------------------------------------------------------------------

/** Lower-cased place -> ISO 3166 alpha-2. Covers the countries and the larger tech cities of Europe. */
const PLACES: Record<string, string> = {
  // Netherlands
  netherlands: 'NL', nederland: 'NL', amsterdam: 'NL', rotterdam: 'NL', utrecht: 'NL', eindhoven: 'NL', 'the hague': 'NL',
  'den haag': 'NL', delft: 'NL', leiden: 'NL', groningen: 'NL', tilburg: 'NL', breda: 'NL', nijmegen: 'NL', arnhem: 'NL',
  veldhoven: 'NL', "'s-hertogenbosch": 'NL', 'den bosch': 'NL', haarlem: 'NL', maastricht: 'NL', enschede: 'NL', zwolle: 'NL',
  amersfoort: 'NL', veghel: 'NL', weert: 'NL', helmond: 'NL', almere: 'NL', apeldoorn: 'NL', hilversum: 'NL',
  // Sweden
  sweden: 'SE', sverige: 'SE', stockholm: 'SE', gothenburg: 'SE', göteborg: 'SE', malmö: 'SE', malmo: 'SE', uppsala: 'SE',
  linköping: 'SE', lund: 'SE', solna: 'SE', södertälje: 'SE', västerås: 'SE', örebro: 'SE', umeå: 'SE', kista: 'SE',
  // Romania
  romania: 'RO', românia: 'RO', bucharest: 'RO', bucurești: 'RO', 'cluj-napoca': 'RO', cluj: 'RO', timișoara: 'RO',
  timisoara: 'RO', iași: 'RO', iasi: 'RO', brașov: 'RO', brasov: 'RO', sibiu: 'RO', constanța: 'RO', oradea: 'RO',
  craiova: 'RO', galați: 'RO',
  // Germany, Austria, Switzerland
  germany: 'DE', deutschland: 'DE', berlin: 'DE', munich: 'DE', münchen: 'DE', hamburg: 'DE', frankfurt: 'DE',
  cologne: 'DE', köln: 'DE', stuttgart: 'DE', düsseldorf: 'DE', leipzig: 'DE', dresden: 'DE',
  austria: 'AT', vienna: 'AT', wien: 'AT', graz: 'AT', linz: 'AT',
  switzerland: 'CH', zurich: 'CH', zürich: 'CH', geneva: 'CH', basel: 'CH', bern: 'CH', lausanne: 'CH',
  // Nordics
  denmark: 'DK', copenhagen: 'DK', aarhus: 'DK', norway: 'NO', oslo: 'NO', bergen: 'NO', trondheim: 'NO',
  finland: 'FI', helsinki: 'FI', espoo: 'FI', tampere: 'FI',
  // UK and Ireland
  'united kingdom': 'GB', uk: 'GB', england: 'GB', scotland: 'GB', london: 'GB', manchester: 'GB', edinburgh: 'GB',
  cambridge: 'GB', oxford: 'GB', bristol: 'GB', leeds: 'GB', glasgow: 'GB', ireland: 'IE', dublin: 'IE', cork: 'IE',
  // Rest of Europe
  belgium: 'BE', brussels: 'BE', antwerp: 'BE', ghent: 'BE', leuven: 'BE', france: 'FR', paris: 'FR', lyon: 'FR',
  toulouse: 'FR', spain: 'ES', madrid: 'ES', barcelona: 'ES', valencia: 'ES', portugal: 'PT', lisbon: 'PT', porto: 'PT',
  italy: 'IT', milan: 'IT', rome: 'IT', turin: 'IT', modena: 'IT', poland: 'PL', warsaw: 'PL', kraków: 'PL',
  krakow: 'PL', wrocław: 'PL', gdańsk: 'PL', czechia: 'CZ', 'czech republic': 'CZ', prague: 'CZ', brno: 'CZ',
  hungary: 'HU', budapest: 'HU', bulgaria: 'BG', sofia: 'BG', greece: 'GR', athens: 'GR', estonia: 'EE', tallinn: 'EE',
  latvia: 'LV', riga: 'LV', lithuania: 'LT', vilnius: 'LT', luxembourg: 'LU',
  // Elsewhere
  'united states': 'US', usa: 'US', 'new york': 'US', 'san francisco': 'US', seattle: 'US', boston: 'US', austin: 'US',
  canada: 'CA', toronto: 'CA', vancouver: 'CA',
};

const PLACE_NAMES = Object.keys(PLACES).sort((a, b) => b.length - a.length);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const COUNTRY_CODES = new Set(Object.values(PLACES));

function findCountry(text: string): string | null {
  const lower = text.toLowerCase();
  let best: { index: number; country: string } | null = null;
  // A bare country code, as people write in a narrow column: "NL", "Modena, IT".
  // Only as a whole item, so the "IT" in "IT Support" is not Italy.
  for (const match of text.matchAll(/(?:^|[,(/]\s*)([A-Z]{2})(?=\s*(?:[,)/]|$))/g)) {
    const code = match[1] === 'UK' ? 'GB' : match[1]!;
    if (COUNTRY_CODES.has(code) && (!best || match.index < best.index)) best = { index: match.index, country: code };
  }
  for (const place of PLACE_NAMES) {
    const match = new RegExp(`(?<![\\p{L}])${escapeRegExp(place)}(?![\\p{L}])`, 'u').exec(lower);
    if (match && (!best || match.index < best.index)) best = { index: match.index, country: PLACES[place]! };
  }
  return best?.country ?? null;
}

/**
 * Region used for the statistics. A fully remote role is "REMOTE" even when a
 * country is named ("Remote, Romania"); a hybrid role belongs to its country.
 */
export function classifyRegion(location: string): string {
  const plain = stripMarkdown(location);
  if (!plain || plain === '-') return 'OTHER';
  const remote = /\b(remote|work from home|wfh|anywhere|worldwide)\b/i.test(plain);
  const hybrid = /\b(hybrid|on[\s-]?site|office days?)\b/i.test(plain);
  if (remote && !hybrid) return 'REMOTE';
  return findCountry(plain) ?? (remote ? 'REMOTE' : 'OTHER');
}

export const REGION_LABELS: Record<string, string> = {
  NL: 'Netherlands', SE: 'Sweden', RO: 'Romania', DE: 'Germany', AT: 'Austria', CH: 'Switzerland', DK: 'Denmark',
  NO: 'Norway', FI: 'Finland', GB: 'United Kingdom', IE: 'Ireland', BE: 'Belgium', FR: 'France', ES: 'Spain',
  PT: 'Portugal', IT: 'Italy', PL: 'Poland', CZ: 'Czechia', HU: 'Hungary', BG: 'Bulgaria', GR: 'Greece', EE: 'Estonia',
  LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', US: 'United States', CA: 'Canada', REMOTE: 'Remote', OTHER: 'Other',
};

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------

/** Order matters: the first kind whose pattern matches a sentence wins. */
const EVENT_RULES: ReadonlyArray<[EventKind, RegExp]> = [
  ['rejected', /\b(reject(?:ed|ion)?|declined|not (?:progressing|moving forward|selected|proceeding)|unsuccessful|position (?:was )?filled|turned down|no longer (?:being )?considered)\b/i],
  ['offer', /\b(offer (?:received|made|extended|letter)|(?:received|got|made) (?:an |the )?offer|job offer)\b/i],
  ['interview', /\b(interview(?:ed|s)?|phone screen|screening call|video (?:call|conversation|interview)|technical (?:test|assessment|round)|assessment|take-home|coding (?:test|challenge)|meeting with|called (?:me|him|her|them))\b/i],
  ['follow_up', /\b(follow(?:ed)?[\s-]?up (?:sent|email(?:ed)?|message sent|done)|sent (?:a |one |the )?follow[\s-]?up|followed up)\b/i],
  ['reply', /(?<!\bno )(?<!\bnot )(?<!\bwithout )(?<!\bany )\b(replied|responded|wrote back|got back)\b/i],
  ['viewed', /\b(viewed|opened (?:the |my |his |her )?(?:application|cv|profile))\b/i],
  ['submitted', /\b(submitted|applied|application sent|sent\b|in (?:yahoo |gmail )?sent)\b/i],
  ['confirmation', /\b(confirmation|thank(?:s| you) for (?:your )?(?:application|applying|job application|your interest)|application (?:received|successful)|received your application|we have received|bedankt|tack för)\b/i],
];

/** Phrases that look like an event but say that nothing happened. */
const NEGATED = /\b(no (?:reply|response|answer|email|confirmation)|not (?:yet )?(?:sent|submitted|applied|clicked)|allowed from|if (?:he|she|they) (?:accepts?|repl))\b/i;

function classifyEvent(sentence: string): EventKind {
  for (const [kind, pattern] of EVENT_RULES) {
    if (!pattern.test(sentence)) continue;
    if (kind === 'reply' || kind === 'follow_up' || kind === 'submitted' || kind === 'confirmation') {
      // "no reply yet", "follow-up allowed from 23 Nov" are not events.
      const cleaned = sentence.replace(NEGATED, '');
      if (!pattern.test(cleaned)) continue;
    }
    return kind;
  }
  return 'note';
}

/** Splits prose into sentence-like pieces at ";" and at ". " followed by a capital or a quote. */
export function splitSentences(text: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1] ?? '';
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === '"' || ch === '“' || ch === '”') quoted = ch === '“' ? true : ch === '”' ? false : !quoted;
    const boundary =
      depth === 0 &&
      !quoted &&
      (ch === ';' || ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(next) && /[\p{Lu}"“*\d]/u.test(text.slice(i + 1).trimStart()[0] ?? '')));
    if (boundary) {
      if (ch !== ';') current += ch;
      if (current.trim()) pieces.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/**
 * Reads dated events out of the "What happened" text.
 *
 * Each sentence yields at most one event: its kind comes from keywords, its date
 * from the first date in the sentence. A sentence with a strong keyword but no
 * date (e.g. a bare "**Rejected**") still becomes an undated event.
 */
export function extractEvents(history: string, appliedIso: string | null, fallbackYear: number): AppEvent[] {
  const events: AppEvent[] = [];
  for (const sentence of splitSentences(stripMarkdown(history))) {
    let kind = classifyEvent(sentence);
    const dates = findDates(sentence, appliedIso, fallbackYear);
    const first = dates[0];
    // Something dated before the application cannot be an outcome of it
    // ("NOTE: an earlier application was rejected 17 Sep"). Keep it as a note.
    if (first && appliedIso && first.iso < appliedIso && kind !== 'note') kind = 'note';
    if (!first && (kind === 'note' || kind === 'submitted' || kind === 'confirmation' || kind === 'viewed')) continue;
    let time = first?.time ?? null;
    if (first && !time) {
      // "email 16:15 ..." style: a clock time in the same sentence belongs to the event.
      const clock = /(?<![\d:.])~?([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/.exec(sentence);
      if (clock) time = `${clock[1]!.padStart(2, '0')}:${clock[2]}`;
    }
    events.push({ date: first?.iso ?? null, time, kind, text: sentence.length > 320 ? `${sentence.slice(0, 317)}...` : sentence });
  }
  return events;
}

const EVENT_WEIGHT: Record<EventKind, number> = {
  offer: 6,
  rejected: 5,
  interview: 4,
  reply: 3,
  follow_up: 2,
  viewed: 1,
  confirmation: 0,
  submitted: 0,
  note: 0,
};

/** The most recent event; on the same day the more decisive kind wins. Undated events rank by kind only. */
export function lastEventOf(allEvents: readonly AppEvent[]): AppEvent | null {
  if (allEvents.length === 0) return null;
  // Notes ("follow-up allowed from 23 Nov") are context, not news: use them only when nothing else exists.
  const real = allEvents.filter((e) => e.kind !== 'note');
  const events = real.length > 0 ? real : allEvents;
  return [...events].sort((a, b) => {
    const byDate = (b.date ?? '').localeCompare(a.date ?? '');
    if (a.date && b.date && byDate !== 0) return byDate;
    const byWeight = EVENT_WEIGHT[b.kind] - EVENT_WEIGHT[a.kind];
    if (byWeight !== 0) return byWeight;
    return (b.time ?? '').localeCompare(a.time ?? '');
  })[0]!;
}

// --------------------------------------------------------------------------
// Contacts
// --------------------------------------------------------------------------

const ROLE_WORDS =
  /\b(recruit|talent|acquisition|sourcer|people|hr\b|hrbp|human resources|manager|lead\b|head\b|director|founder|owner|ceo\b|cto\b|coo\b|vp\b|chief|engineer|partner|consultant|advisor|officer|hiring)/i;
const SHARED_MAILBOX =
  /^(careers?|jobs?|hr|hello|hi|info|contact|recruit(?:ing|ment)?|talent|apply|applications?|work|team|office|support|people|noreply|no-reply|hiring|join|vacatures?|sollicitatie)@/i;
/** One or more capitalised words: "Ana Pop", "Jan van der Berg", "Chris S." */
const NAME = "\\p{Lu}[\\p{L}'’-]+(?:\\s+(?:(?:van|von|de|der|den|di|da|la|le|el|bin|al)\\s+){0,2}\\p{Lu}[\\p{L}'’.-]*){1,3}";
const NOT_A_PERSON =
  /^(Easy Apply|Full[\s-]Stack|Talent Acquisition|Human Resources|Engineering Manager|Software Engineer|Data Engineer|Job Board|Recruiting Team|Privacy Policy|Thank You|Application (?:Received|Successful)|Cover Letter|The Hub|High Tech|Linked ?In)\b/i;

const TITLE_WORD = /^(recruiter|cto|ceo|coo|cfo|vp|founder|co-founder|manager|lead|head|director|poster|job|hiring|contact|qa|hr|ta|senior|junior|engineering|talent|mr|ms|mrs|dr|blank|connect|inmail|message|email)\.?$/i;

/** "Recruiter Tobias Ek" -> "Tobias Ek": a title in front of a name is not part of the name. */
function cleanName(name: string): string {
  const words = name.replace(/[,;:]+$/, '').replace(/\s+/g, ' ').trim().split(' ');
  while (words.length > 2 && TITLE_WORD.test(words[0]!)) words.shift();
  return words.join(' ').replace(/[,;:]+$/, '');
}

/** Two capitalised words are not always a person: "Engineering Manager", "New York", "Easy Apply". */
function isPerson(name: string): boolean {
  if (NOT_A_PERSON.test(name) || ROLE_WORDS.test(name)) return false;
  if (/\b(Yahoo|Gmail|LinkedIn|Workday|Teamtailor|Greenhouse|Lever|Ashby|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(name)) return false;
  return findCountry(name) === null;
}

/**
 * Finds the people mentioned in an application row:
 * - "Ana Pop (Talent Acquisition Partner)" -> named contact with a role;
 * - "recruiter Jan Smit", "from Ana Pop"   -> named contact;
 * - "to jan.smit@acme.com"                  -> named contact by email;
 * - "to careers@acme.com"                   -> shared mailbox (named = false).
 */
export function extractContacts(text: string): Contact[] {
  const plain = stripMarkdown(text);
  const contacts: Contact[] = [];
  const seen = new Set<string>();
  const add = (contact: Omit<Contact, 'source'>): void => {
    const key = (contact.name ?? contact.email ?? '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    contacts.push({ ...contact, source: 'application' });
  };

  // "Ana Pop (Talent Acquisition Partner)"
  for (const match of plain.matchAll(new RegExp(`(${NAME})\\s*\\(([^()]{2,90})\\)`, 'gu'))) {
    const name = cleanName(match[1]!);
    const role = match[2]!.trim();
    if (!isPerson(name) || !ROLE_WORDS.test(role)) continue;
    add({ name, role, email: null, named: true });
  }

  // "... confirmation email (Ana Pop, Talent Acquisition Partner)": the signature of an email in parentheses.
  for (const match of plain.matchAll(new RegExp(`\\((${NAME})(?:\\s*[,:]\\s*|\\s+-\\s+)([^()]{0,90})\\)`, 'gu'))) {
    const name = cleanName(match[1]!);
    const rest = match[2]!.trim();
    if (!isPerson(name)) continue;
    const before = plain.slice(Math.max(0, (match.index ?? 0) - 110), match.index ?? 0);
    const signsAnEmail = /\b(e-?mail|confirmation|thank|signed|from|received|message|reply|replied)\b/i.test(before);
    if (!ROLE_WORDS.test(rest) && !signsAnEmail) continue;
    add({ name, role: ROLE_WORDS.test(rest) ? rest : null, email: null, named: true });
  }

  const intro = new RegExp(
    `\\b(?:[Rr]ecruiter|[Cc]ontact(?: person)?|[Hh]iring manager|[Ss]igned(?: by)?|[Ff]rom|[Bb]y|[Pp]oster|[Pp]osted by|[Tt]o|[Ww]ith)\\s+(${NAME})(?=[\\s,.;:)]|$)`,
    'gu',
  );
  for (const match of plain.matchAll(intro)) {
    const name = cleanName(match[1]!);
    if (!isPerson(name)) continue;
    // "from Acme Corp" would also match: keep it only when followed by a role hint nearby.
    const after = plain.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 60);
    const before = plain.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0);
    if (!ROLE_WORDS.test(match[0]) && !ROLE_WORDS.test(after) && !ROLE_WORDS.test(before)) continue;
    add({ name, role: null, email: null, named: true });
  }

  for (const match of plain.matchAll(/\bto\s+(?:recruiter\s+)?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi)) {
    const email = match[1]!.replace(/\.$/, '');
    const shared = SHARED_MAILBOX.test(email);
    const local = email.split('@')[0]!;
    add({ name: null, role: null, email, named: !shared && /[._]/.test(local) });
  }
  return contacts;
}
