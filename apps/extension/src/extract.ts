/**
 * Reads a job posting out of the page the user is looking at.
 *
 * Three layers, most reliable first:
 *  1. schema.org `JobPosting` JSON-LD, which most applicant-tracking systems embed;
 *  2. selectors for the known sites (their markup changes, so these are fallbacks);
 *  3. generic page metadata (og:title, og:site_name, <h1>).
 *
 * Pure DOM in, plain object out: it runs in the content script and in jsdom tests.
 */

export type Site = 'linkedin' | 'teamtailor' | 'workday' | 'greenhouse' | 'lever' | 'ashby' | 'other';

export interface Posting {
  site: Site;
  title: string;
  company: string;
  location: string;
  /** Plain text of the description, used for the red-flag rules. */
  text: string;
  url: string;
}

export function detectSite(url: string): Site {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host.endsWith('linkedin.com')) return 'linkedin';
  if (host.endsWith('teamtailor.com')) return 'teamtailor';
  if (host.includes('myworkdayjobs.com') || host.endsWith('workday.com')) return 'workday';
  if (host.endsWith('greenhouse.io')) return 'greenhouse';
  if (host.endsWith('lever.co')) return 'lever';
  if (host.endsWith('ashbyhq.com')) return 'ashby';
  return 'other';
}

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

function htmlToText(html: string, doc: Document): string {
  const holder = doc.createElement('div');
  holder.innerHTML = html.replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '$&\n');
  return (holder.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

interface JsonLdPosting {
  title?: string;
  company?: string;
  location?: string;
  text?: string;
}

function fromJsonLd(doc: Document): JsonLdPosting {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const graph = (parsed as { '@graph'?: unknown[] })['@graph'];
    const nodes: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(graph) ? graph : [parsed];
    for (const node of nodes) {
      const item = node as Record<string, unknown>;
      const type = item['@type'];
      if (type !== 'JobPosting' && !(Array.isArray(type) && type.includes('JobPosting'))) continue;
      const org = item.hiringOrganization as { name?: string } | string | undefined;
      const place = [item.jobLocation].flat()[0] as { address?: { addressLocality?: string; addressCountry?: string | { name?: string } } | string } | undefined;
      const address = place?.address;
      const country = typeof address === 'object' ? (typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry) : undefined;
      const location = typeof address === 'string' ? address : [address?.addressLocality, country].filter(Boolean).join(', ');
      const remote = item.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '';
      return {
        title: clean(item.title as string),
        company: clean(typeof org === 'string' ? org : org?.name),
        location: clean([location, remote].filter(Boolean).join(' · ')),
        text: typeof item.description === 'string' ? htmlToText(item.description, doc) : '',
      };
    }
  }
  return {};
}

const SELECTORS: Record<Site, { title: string[]; company: string[]; location: string[]; text: string[] }> = {
  linkedin: {
    title: ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'],
    company: ['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link', '.top-card-layout__card a[href*="/company/"]'],
    location: ['.job-details-jobs-unified-top-card__primary-description-container span', '.jobs-unified-top-card__bullet', '.topcard__flavor--bullet'],
    text: ['#job-details', '.jobs-description__content', '.jobs-description', '.show-more-less-html__markup', '.description__text'],
  },
  teamtailor: {
    title: ['h1'],
    company: ['[data-company-name]', 'header a[href="/"]', '.company-name'],
    location: ['[data-location]', 'dl dd', '.job-location'],
    text: ['[data-controller="careersite--jobs--description"]', '.prose', 'main section', 'main'],
  },
  workday: {
    title: ['[data-automation-id="jobPostingHeader"]', 'h2', 'h1'],
    company: ['[data-automation-id="companyName"]'],
    location: ['[data-automation-id="locations"] dd', '[data-automation-id="location"]'],
    text: ['[data-automation-id="jobPostingDescription"]', 'main'],
  },
  greenhouse: {
    title: ['h1.section-header', '.job__title h1', 'h1.app-title', 'h1'],
    company: ['.company-name', 'header img[alt]'],
    location: ['.job__location', '.location'],
    text: ['.job__description', '#content', 'main'],
  },
  lever: {
    title: ['.posting-headline h2', 'h2', 'h1'],
    company: ['.main-header-logo img[alt]', 'footer .image-link img[alt]'],
    location: ['.posting-categories .location', '.location'],
    text: ['[data-qa="job-description"]', '.section-wrapper.page-full-width', '.content'],
  },
  ashby: {
    title: ['h1'],
    company: ['header img[alt]', 'nav img[alt]'],
    location: ['[class*="_details"] p', '[class*="location"]'],
    text: ['[class*="_description"]', '#overview', 'main'],
  },
  other: { title: ['h1'], company: [], location: [], text: ['main', 'article', 'body'] },
};

function pick(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    let element: Element | null = null;
    try {
      element = doc.querySelector(selector);
    } catch {
      continue;
    }
    if (!element) continue;
    const text = clean(element.tagName === 'IMG' ? element.getAttribute('alt') : element.textContent);
    if (text) return text;
  }
  return '';
}

const meta = (doc: Document, name: string): string =>
  clean(doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content'));

/** "acme.teamtailor.com" -> "Acme"; "jobs.lever.co/acme/..." -> "Acme". */
function companyFromUrl(url: string, site: Site): string {
  try {
    const parsed = new URL(url);
    const first = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    const sub = parsed.hostname.split('.')[0] ?? '';
    const raw = site === 'teamtailor' || site === 'workday' ? sub : site === 'lever' || site === 'ashby' || site === 'greenhouse' ? first : '';
    if (!raw || /^(jobs|careers?|www|job-boards|boards|embed)$/i.test(raw)) return '';
    return raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return '';
  }
}

/** Splits "Backend Engineer - Acme" / "Acme hiring Backend Engineer in Oslo | LinkedIn" into its parts. */
function fromTitleTag(doc: Document, site: Site): { title: string; company: string } {
  const raw = clean(meta(doc, 'og:title') || doc.title);
  const linkedin = /^(.+?) hiring (.+?) in (.+?)(?: \| LinkedIn)?$/.exec(raw);
  if (site === 'linkedin' && linkedin) return { company: linkedin[1]!, title: linkedin[2]! };
  const parts = raw.split(/\s+[|–—-]\s+|\s+@\s+|\s+at\s+(?=[A-Z])/).map(clean).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0]!, company: parts[1]!.replace(/\s*(careers?|jobs)$/i, '') };
  return { title: raw, company: '' };
}

/**
 * Extracts the posting from a document. Returns null when the page does not
 * look like a single job posting (no title, or almost no text).
 */
export function extractPosting(doc: Document, url: string): Posting | null {
  const site = detectSite(url);
  const ld = fromJsonLd(doc);
  const selectors = SELECTORS[site];
  const tag = fromTitleTag(doc, site);

  const title = ld.title || pick(doc, selectors.title) || tag.title;
  const company = ld.company || pick(doc, selectors.company) || meta(doc, 'og:site_name') || tag.company || companyFromUrl(url, site);
  const location = ld.location || pick(doc, selectors.location);
  let text = ld.text ?? '';
  if (text.length < 200) {
    for (const selector of selectors.text) {
      const element = doc.querySelector(selector);
      const candidate = element ? ((element as HTMLElement).innerText ?? element.textContent ?? '').trim() : '';
      if (candidate.length > text.length) text = candidate;
      if (text.length >= 200) break;
    }
  }

  if (!title || (site === 'other' && !ld.title)) return null;
  return { site, title, company, location, text: text.slice(0, 60_000), url: url.split('#')[0]! };
}

/** True for URLs that show one posting, as opposed to a search page or a company home page. */
export function looksLikePosting(url: string): boolean {
  const site = detectSite(url);
  let path = '';
  let search = '';
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
    search = parsed.search;
  } catch {
    return false;
  }
  switch (site) {
    case 'linkedin':
      return /\/jobs\/view\//.test(path) || /currentJobId=\d+/.test(search);
    case 'teamtailor':
      return /\/jobs\/\d+/.test(path);
    case 'workday':
      return /\/job\//.test(path);
    case 'greenhouse':
      return /\/jobs\/\d+/.test(path) || /gh_jid=\d+/.test(search);
    case 'lever':
      return /^\/[^/]+\/[0-9a-f-]{36}/.test(path);
    case 'ashby':
      return /^\/[^/]+\/[0-9a-f-]{36}/.test(path);
    default:
      return false;
  }
}
