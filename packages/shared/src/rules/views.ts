/**
 * Read models built from the parsed logs: what the "Today" panel and the
 * company page show. Still pure functions.
 */
import { isRepeat, matchCompany, parseCompany } from '../company';
import { stripMarkdown } from '../parse/markdown';
import {
  STATUSES,
  type Application,
  type Batch,
  type CompanyPage,
  type CompanySummary,
  type OutreachLog,
  type Settings,
  type ShortlistItem,
  type Status,
  type Today,
} from '../schemas';
import { followUpsDue, followUpsUpcoming, hygieneIssues, staleConnects } from './followUps';

export interface Dataset {
  applications: readonly Application[];
  needs: Today['needs'];
  outreach: Pick<OutreachLog, 'messages' | 'connections'>;
  batches: readonly Batch[];
  shortlist: readonly ShortlistItem[];
}

export function statusCounts(apps: readonly Application[]): Record<Status, number> {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<Status, number>;
  for (const a of apps) counts[a.status]++;
  return counts;
}

type Rules = Pick<Settings, 'followUpMinDays' | 'followUpMaxDays' | 'staleConnectDays'>;

export function buildToday(data: Dataset, today: string, rules: Rules, options: { demo: boolean; checked: string[] }): Today {
  const window = { minDays: rules.followUpMinDays, maxDays: Math.max(rules.followUpMinDays, rules.followUpMaxDays) };
  // Show today's batch; before the agent has run, the most recent one is still the open to-do list.
  const batch = data.batches.find((b) => b.date === today) ?? [...data.batches].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  return {
    today,
    demo: options.demo,
    followUpsDue: followUpsDue(data.applications, today, data.outreach, window),
    followUpsUpcoming: followUpsUpcoming(data.applications, today, data.outreach, window),
    staleConnects: staleConnects(data.outreach.connections, today, rules.staleConnectDays),
    needs: data.needs,
    hygiene: hygieneIssues(data.applications, today),
    batch,
    checked: options.checked,
    counts: statusCounts(data.applications),
  };
}

export function listCompanies(apps: readonly Application[]): CompanySummary[] {
  const groups = new Map<string, Application[]>();
  for (const a of apps) groups.set(a.companyKey, [...(groups.get(a.companyKey) ?? []), a]);
  return [...groups.entries()]
    .map(([key, items]): CompanySummary => ({
      key,
      name: items[0]!.company,
      applications: items.length,
      lastApplied: items.map((a) => a.applied.iso).filter((d): d is string => d !== null).sort().pop() ?? null,
      statuses: [...new Set(items.map((a) => a.status))],
    }))
    .sort((a, b) => (b.lastApplied ?? '').localeCompare(a.lastApplied ?? ''));
}

/** Everything known about one company: the repeat check before applying again. */
export function buildCompanyPage(data: Dataset, nameOrKey: string): CompanyPage | null {
  const wanted = parseCompany(nameOrKey);
  const byKey = data.applications.filter((a) => a.companyKey === wanted.key);
  const applications = byKey.length > 0 ? byKey : isRepeat(nameOrKey, data.applications).map((m) => m.application);
  const name = applications[0]?.company ?? nameOrKey;
  const same = (otherName: string, otherKey: string): boolean => otherKey === wanted.key || matchCompany(name, otherName) !== null;

  const messages = data.outreach.messages.filter((m) => same(m.company, m.companyKey));
  const connections = data.outreach.connections.filter((c) => same(c.company, c.companyKey));
  const shortlist = data.shortlist.filter((s) => same(s.company, s.companyKey));

  const batchMentions: CompanyPage['batchMentions'] = [];
  const needle = name.toLowerCase();
  if (needle.length >= 3) {
    for (const batch of [...data.batches].sort((a, b) => b.date.localeCompare(a.date))) {
      const text = stripMarkdown(batch.markdown);
      const at = text.toLowerCase().indexOf(needle);
      if (at !== -1) batchMentions.push({ date: batch.date, snippet: `…${text.slice(Math.max(0, at - 80), at + 160).trim()}…` });
    }
  }

  if (applications.length + messages.length + connections.length + shortlist.length + batchMentions.length === 0) return null;
  return {
    key: wanted.key,
    name,
    applications: [...applications].sort((a, b) => (b.applied.iso ?? '').localeCompare(a.applied.iso ?? '')),
    messages,
    connections,
    batchMentions,
    shortlist,
  };
}
