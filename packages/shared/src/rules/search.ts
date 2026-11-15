/**
 * Full-text search across every log. Small data (hundreds of rows), so a linear
 * scan is instant and needs no index to keep in sync.
 */
import { stripMarkdown } from '../parse/markdown';
import type { Application, Batch, Connection, NeedsItem, OutreachMessage, SearchHit } from '../schemas';

export interface SearchCorpus {
  applications: readonly Application[];
  messages: readonly OutreachMessage[];
  connections: readonly Connection[];
  batches: readonly Batch[];
  needs: readonly NeedsItem[];
}

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** `teamtailor "no reply"` -> ["teamtailor", "no reply"] */
export function queryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of fold(query).matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? '').trim();
    if (term) terms.push(term);
  }
  return terms;
}

function snippetAround(text: string, terms: readonly string[], radius = 90): string {
  const folded = fold(text);
  let at = -1;
  for (const term of terms) {
    const index = folded.indexOf(term);
    if (index !== -1 && (at === -1 || index < at)) at = index;
  }
  if (at === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

interface Doc extends Omit<SearchHit, 'snippet' | 'score'> {
  body: string;
}

function documents(corpus: SearchCorpus): Doc[] {
  const docs: Doc[] = [];
  for (const a of corpus.applications) {
    docs.push({
      type: 'application',
      id: a.id,
      title: `${a.company} · ${a.role}`,
      subtitle: `${a.section}${a.location ? ` · ${a.location}` : ''}`,
      body: [a.companyNote ?? '', a.roleNote ?? '', a.channelRaw, stripMarkdown(a.history)].join(' \n '),
      date: a.applied.iso,
      ref: a.id,
    });
  }
  for (const m of corpus.messages) {
    docs.push({
      type: 'message',
      id: m.id,
      title: `${m.person} · ${m.company}`,
      subtitle: `Message${m.personRole ? ` · ${m.personRole}` : ''}`,
      body: `${m.about} \n ${m.status}`,
      date: m.date.iso,
      ref: m.companyKey,
    });
  }
  for (const c of corpus.connections) {
    docs.push({
      type: 'connection',
      id: c.id,
      title: `${c.person} · ${c.company}`,
      subtitle: `Connection request · ${c.status}`,
      body: c.statusRaw,
      date: c.sent.iso,
      ref: c.companyKey,
    });
  }
  for (const b of corpus.batches) {
    for (const [index, section] of b.sections.entries()) {
      docs.push({
        type: 'batch',
        id: `${b.date}#${index}`,
        title: `${b.title}`,
        subtitle: `Daily batch · ${section.heading}`,
        body: stripMarkdown(section.markdown),
        date: b.date,
        ref: b.date,
      });
    }
  }
  for (const n of corpus.needs) {
    docs.push({ type: 'needs', id: n.id, title: n.title.slice(0, 90), subtitle: 'Needs you', body: stripMarkdown(n.markdown), date: null, ref: n.id });
  }
  return docs;
}

/**
 * Every term must appear (AND). A hit in the title weighs three times a hit in
 * the body; ties go to the newer entry.
 */
export function search(corpus: SearchCorpus, query: string, limit = 60): SearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const doc of documents(corpus)) {
    const title = fold(`${doc.title} ${doc.subtitle}`);
    const body = fold(doc.body);
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inBody = body.includes(term);
      if (!inTitle && !inBody) {
        matchedAll = false;
        break;
      }
      score += (inTitle ? 3 : 0) + (inBody ? 1 : 0);
    }
    if (!matchedAll) continue;
    const { body: text, ...rest } = doc;
    hits.push({ ...rest, snippet: snippetAround(text.replace(/\s+/g, ' '), terms), score });
  }
  return hits.sort((a, b) => b.score - a.score || (b.date ?? '').localeCompare(a.date ?? '')).slice(0, limit);
}
