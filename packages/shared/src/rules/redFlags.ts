/**
 * Red flags in a job ad: reasons the application would be a waste of an evening.
 *
 * What counts as a red flag is personal, so the thresholds come from a
 * `Profile`. Every flag carries the sentence that triggered it, because a flag
 * you cannot check is a flag you learn to ignore.
 */
import { ProfileSchema, type Profile, type RedFlag } from '../schemas';

export interface Ad {
  title?: string;
  text: string;
}

const LANGUAGES: ReadonlyArray<[string, RegExp]> = [
  ['Dutch', /\b(dutch|nederlands(?:e|talig|talige)?)\b/i],
  ['Swedish', /\b(swedish|svenska)\b/i],
  ['German', /\b(german|deutsch(?:kenntnisse)?)\b/i],
  ['French', /\b(french|français|francais)\b/i],
  ['Norwegian', /\b(norwegian|norsk)\b/i],
  ['Danish', /\b(danish|dansk)\b/i],
  ['Finnish', /\b(finnish|suomi)\b/i],
  ['Spanish', /\b(spanish|español)\b/i],
  ['Italian', /\b(italian|italiano)\b/i],
  ['Polish', /\b(polish|polski)\b/i],
  ['Romanian', /\b(romanian|română)\b/i],
  ['Portuguese', /\b(portuguese|português)\b/i],
];

const OPTIONAL_HINT =
  /\b(a plus|is a plus|plus\b|bonus|nice[\s-]to[\s-]have|advantage|advantageous|asset|preferred|preferably|beneficial|desirable|helpful|not (?:required|necessary|needed|a must)|optional|willing(?:ness)? to learn|or (?:are )?willing|pré|meriterande|merit)\b/i;
const REQUIRED_HINT =
  /\b(required|requirements?|must|need(?:s|ed)? to|have to|fluent|fluency|fluently|native|proficien\w*|mandatory|essential|excellent|strong|professional|business[\s-]level|c1|c2|b2|command of|working knowledge|you speak|speak(?:s|ing)?|written and spoken|verbal and written|vloeiend|beheers\w*|flytande|krav|obligatoriskt|fließend|zwingend|necessary)\b/i;

/** Function words that identify the language an ad is written in. */
const STOPWORDS: Record<string, ReadonlySet<string>> = {
  English: new Set(['the', 'and', 'of', 'to', 'in', 'for', 'with', 'you', 'our', 'we', 'is', 'are', 'will', 'as', 'your', 'that', 'on', 'be']),
  Dutch: new Set(['de', 'het', 'een', 'en', 'van', 'voor', 'met', 'je', 'wij', 'zijn', 'naar', 'bij', 'ook', 'onze', 'jij', 'wat', 'aan', 'als', 'dat', 'niet', 'ons', 'jouw']),
  Swedish: new Set(['och', 'att', 'det', 'som', 'för', 'med', 'är', 'på', 'vi', 'du', 'av', 'till', 'har', 'vår', 'våra', 'hos', 'oss', 'inte', 'ett', 'eller', 'dig', 'din']),
  German: new Set(['und', 'der', 'die', 'das', 'mit', 'für', 'wir', 'sie', 'ist', 'eine', 'bei', 'uns', 'zu', 'auf', 'dich', 'deine', 'nicht', 'von', 'als', 'oder', 'dein']),
  French: new Set(['le', 'la', 'les', 'des', 'et', 'pour', 'avec', 'vous', 'nous', 'est', 'une', 'dans', 'votre', 'notre', 'sur', 'que', 'qui', 'au']),
  Romanian: new Set(['și', 'în', 'pentru', 'este', 'care', 'cu', 'la', 'din', 'pe', 'sau', 'mai', 'să', 'noi', 'tu', 'unei', 'sunt', 'ale']),
};

/** The language most of the ad is written in, or null when the text is too short to tell. */
export function detectAdLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 40) return null;
  let best: { language: string; count: number } | null = null;
  for (const [language, stopwords] of Object.entries(STOPWORDS)) {
    const count = words.reduce((n, word) => n + (stopwords.has(word) ? 1 : 0), 0);
    if (!best || count > best.count) best = { language, count };
  }
  return best && best.count / words.length >= 0.08 ? best.language : null;
}

/** Splits an ad into sentences; list items and lines count as sentences too. */
export function adSentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}"“(])/u)
    .map((s) => s.replace(/^[\s•·▪◦*–-]+/, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 2);
}

const clip = (sentence: string): string => (sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a technology name as a whole token, including names like ".NET", "C#" and "C++". */
function stackPattern(stack: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\d+#.])${escapeRegExp(stack)}(?![\\p{L}\\d+#])`, 'giu');
}

const SENIOR_TITLE = /\b(senior|sr\.?|lead|principal|staff|architect|head of|director|manager|expert|medior\/senior)\b/i;
const SENIOR_TEXT = /\b(?:looking for|seeking|hiring|searching for|need)\s+(?:an?\s+)?(?:\w+\s+){0,2}?(senior|lead|principal|staff|seasoned|highly experienced)\b/i;
const INTERN_TITLE = /\b(intern|internship|stage|stagiair|stagiaire|praktik|praktikant|trainee|traineeship|working student|werkstudent|afstudeer\w*|graduation (?:project|assignment|internship)|thesis)\b/i;
const INTERN_TEXT = /\b(this (?:is|role is) an? (?:paid |unpaid )?internship|internship (?:position|role|duration|allowance|agreement|period)|\d+[\s-]months? internship|must be enrolled|currently enrolled (?:in|at)|stagevergoeding)\b/i;
const YEARS = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?|jaar|år)\b/gi;
const EXPERIENCE_CONTEXT = /\b(experience|experienced|ervaring|erfarenhet|erfahrung|background|track record|working (?:as|with|in)|hands-on|professional|industry|in a similar|relevant)\b/i;

const KNOCKOUT_PLACE = new RegExp(
  [
    '\\b(?:must|need to|needs to|have to|has to|required to|should|you)\\s+(?:be\\s+|currently\\s+|already\\s+|live\\s+|reside\\s+)+(?:based\\s+|located\\s+|living\\s+|residing\\s+|resident\\s+)?in\\s+(?:the\\s+)?(\\p{Lu}[\\p{L}]+(?:\\s\\p{Lu}[\\p{L}]+)?)',
    '\\b(?:currently|already)\\s+(?:based|living|located|residing|resident)\\s+in\\s+(?:the\\s+)?(\\p{Lu}[\\p{L}]+(?:\\s\\p{Lu}[\\p{L}]+)?)',
    '\\b(?:only|exclusively)\\s+(?:consider(?:ing)?|accept(?:ing)?|hir(?:e|ing))\\s+candidates\\s+(?:who\\s+(?:are|live)\\s+)?(?:based\\s+|located\\s+|living\\s+|residing\\s+)?in\\s+(?:the\\s+)?(\\p{Lu}[\\p{L}]+(?:\\s\\p{Lu}[\\p{L}]+)?)',
    '\\bcandidates\\s+(?:must|need to|should)\\s+(?:be\\s+|live\\s+|reside\\s+)+(?:based\\s+|located\\s+)?in\\s+(?:the\\s+)?(\\p{Lu}[\\p{L}]+(?:\\s\\p{Lu}[\\p{L}]+)?)',
  ].join('|'),
  'u',
);
const NO_RELOCATION =
  /\b(no relocation|relocation (?:support |assistance |package |budget )?(?:is |are )?not (?:offered|provided|available|supported|possible)|(?:cannot|can't|unable to|do not|don't|does not|will not|won't) (?:offer|provide|support) relocation|local candidates only|does not support relocation)\b/i;
const NO_SPONSORSHIP =
  /\b(no (?:visa|work permit) sponsorship|(?:cannot|can't|unable to|do not|don't|does not|will not|won't|not able to) (?:offer|provide|sponsor)[^.]{0,40}(?:visa|sponsorship|work permit)|sponsorship is not (?:available|offered|provided))\b/i;

/**
 * Returns the red flags found in a job ad, most serious first.
 *
 * - `block`: a stated requirement you do not meet (language, years, location).
 * - `warn`:  probably a poor fit (seniority, internship, a stack you avoid).
 * - `info`:  worth knowing, not a reason to skip.
 */
export function redFlags(ad: string | Ad, profileInput: Partial<Profile> = {}): RedFlag[] {
  const profile = ProfileSchema.parse(profileInput);
  const title = typeof ad === 'string' ? '' : (ad.title ?? '');
  const text = typeof ad === 'string' ? ad : ad.text;
  const sentences = adSentences(text);
  const spoken = new Set(profile.languages.map((language) => language.toLowerCase()));
  const flags: RedFlag[] = [];
  const add = (flag: RedFlag): void => {
    if (!flags.some((f) => f.id === flag.id)) flags.push(flag);
  };

  // --- language of the ad itself -------------------------------------------------
  const written = detectAdLanguage(text);
  if (written && !spoken.has(written.toLowerCase())) {
    add({ id: `ad-language-${written.toLowerCase()}`, label: `Ad is written in ${written}`, severity: 'warn', evidence: clip(sentences[0] ?? '') });
  }

  // --- required languages --------------------------------------------------------
  for (const [language, pattern] of LANGUAGES) {
    if (spoken.has(language.toLowerCase())) continue;
    let optional: string | null = null;
    for (const sentence of sentences) {
      if (!pattern.test(sentence)) continue;
      // Judge only the clause that mentions the language: "English required, Dutch is a plus".
      const clause = sentence.split(/[,;]|\bbut\b|\bwhile\b|\band\b(?=[^,;]*\b(?:plus|bonus|advantage)\b)/i).find((part) => pattern.test(part)) ?? sentence;
      // The clause decides; the rest of the sentence is only consulted when the clause says nothing.
      const clauseSilent = !OPTIONAL_HINT.test(clause) && !REQUIRED_HINT.test(clause);
      if (OPTIONAL_HINT.test(clause) || (clauseSilent && OPTIONAL_HINT.test(sentence))) optional ??= sentence;
      else if (REQUIRED_HINT.test(clause) || REQUIRED_HINT.test(sentence)) {
        add({ id: `language-${language.toLowerCase()}`, label: `${language} required`, severity: 'block', evidence: clip(sentence) });
        optional = null;
        break;
      }
    }
    if (optional) add({ id: `language-${language.toLowerCase()}-optional`, label: `${language} is a plus`, severity: 'info', evidence: clip(optional) });
  }

  // --- years of experience -------------------------------------------------------
  let most: { years: number; sentence: string } | null = null;
  for (const sentence of sentences) {
    if (!EXPERIENCE_CONTEXT.test(sentence)) continue;
    for (const match of sentence.matchAll(YEARS)) {
      const years = Number(match[1]);
      if (years > 0 && years <= 25 && (!most || years > most.years)) most = { years, sentence };
    }
  }
  if (most) {
    if (most.years >= profile.maxYears) {
      add({ id: 'years', label: `${most.years}+ years of experience asked`, severity: 'block', evidence: clip(most.sentence) });
    } else if (most.years >= 3 && most.years >= profile.maxYears - 2) {
      add({ id: 'years', label: `${most.years}+ years of experience asked`, severity: 'warn', evidence: clip(most.sentence) });
    }
  }

  // --- seniority -----------------------------------------------------------------
  if (profile.flagSeniority) {
    const inTitle = SENIOR_TITLE.exec(title);
    const inText = sentences.find((sentence) => SENIOR_TEXT.test(sentence));
    if (inTitle) add({ id: 'seniority', label: `Senior-level title ("${inTitle[1]}")`, severity: 'warn', evidence: clip(title) });
    else if (inText) add({ id: 'seniority', label: 'Senior-level role', severity: 'warn', evidence: clip(inText) });
  }

  // --- internship ----------------------------------------------------------------
  if (profile.flagInternships) {
    const inText = sentences.find((sentence) => INTERN_TEXT.test(sentence));
    if (INTERN_TITLE.test(title)) add({ id: 'internship', label: 'Internship or traineeship', severity: 'warn', evidence: clip(title) });
    else if (inText) add({ id: 'internship', label: 'Internship or traineeship', severity: 'warn', evidence: clip(inText) });
  }

  // --- stacks to avoid -----------------------------------------------------------
  for (const stack of profile.avoidStacks) {
    const pattern = stackPattern(stack);
    const mentions = (text.match(pattern) ?? []).length;
    const inTitle = stackPattern(stack).test(title);
    if (mentions >= 2 || inTitle) {
      const evidence = inTitle ? title : (sentences.find((sentence) => stackPattern(stack).test(sentence)) ?? '');
      const count = mentions + (inTitle ? 1 : 0);
      add({ id: `stack-${stack.toLowerCase()}`, label: `${stack}-heavy stack (${count} mentions)`, severity: 'warn', evidence: clip(evidence) });
    }
  }

  // --- location knock-outs -------------------------------------------------------
  const home = new Set(profile.basedIn.map((place) => place.toLowerCase()));
  for (const sentence of sentences) {
    const match = KNOCKOUT_PLACE.exec(sentence);
    const place = match?.slice(1).find(Boolean);
    if (place && !home.has(place.toLowerCase()) && !/^(Office|Person|Our|A|An|The)$/i.test(place)) {
      add({ id: 'location', label: `Must already be based in ${place}`, severity: 'block', evidence: clip(sentence) });
    }
    if (NO_RELOCATION.test(sentence)) add({ id: 'relocation', label: 'No relocation support', severity: 'block', evidence: clip(sentence) });
    if (NO_SPONSORSHIP.test(sentence)) add({ id: 'sponsorship', label: 'No visa sponsorship', severity: 'info', evidence: clip(sentence) });
  }

  const order = { block: 0, warn: 1, info: 2 } as const;
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}
