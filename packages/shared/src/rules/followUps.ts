/**
 * Follow-up and connection rules. Pure functions: data and "today" go in,
 * a list comes out. No clock, no I/O, so every case is unit-testable.
 */
import { matchCompany } from '../company';
import { addDays, daysBetween } from '../dates';
import type { Application, Connection, Contact, FollowUp, HygieneIssue, OutreachLog, StaleConnect } from '../schemas';

export interface FollowUpOptions {
  /** First day (after applying) on which a follow-up is allowed. */
  minDays: number;
  /** Last day of the window. */
  maxDays: number;
}

export const DEFAULT_FOLLOW_UP: FollowUpOptions = { minDays: 8, maxDays: 10 };

const EMPTY_OUTREACH: Pick<OutreachLog, 'messages' | 'connections'> = { messages: [], connections: [] };

type Outreach = Pick<OutreachLog, 'messages' | 'connections'>;

function sameCompany(application: Application, otherName: string, otherKey: string): boolean {
  if (!otherKey) return false;
  if (application.companyKey === otherKey) return true;
  return matchCompany(application.company, otherName) !== null;
}

/** The person to follow up with: someone named in the row, else someone contacted at that company. */
export function namedContact(application: Application, outreach: Outreach = EMPTY_OUTREACH): Contact | null {
  const inRow = application.contacts.find((contact) => contact.named);
  if (inRow) return inRow;
  const message = outreach.messages.find((m) => m.person && sameCompany(application, m.company, m.companyKey));
  if (message) return { name: message.person, role: message.personRole, email: null, named: true, source: 'outreach' };
  const connection = outreach.connections.find(
    (c) => c.person && c.status !== 'declined' && c.status !== 'withdrawn' && sameCompany(application, c.company, c.companyKey),
  );
  if (connection) return { name: connection.person, role: null, email: null, named: true, source: 'outreach' };
  return null;
}

/** True when a human on their side has responded in any way. */
export function hasResponse(application: Application, outreach: Outreach = EMPTY_OUTREACH): boolean {
  if (application.events.some((e) => e.kind === 'reply' || e.kind === 'interview' || e.kind === 'offer' || e.kind === 'rejected')) return true;
  const applied = application.applied.iso;
  return outreach.messages.some(
    (m) => m.replied && sameCompany(application, m.company, m.companyKey) && (!applied || !m.date.iso || m.date.iso >= applied),
  );
}

/**
 * The rule is "one follow-up, never two". A follow-up counts as sent when the row
 * says so, or when a message went to that company three or more days after the
 * application (a message on the day itself is the introduction, not a follow-up).
 */
export function followUpSent(application: Application, outreach: Outreach = EMPTY_OUTREACH): boolean {
  if (application.events.some((e) => e.kind === 'follow_up')) return true;
  const applied = application.applied.iso;
  if (!applied) return false;
  const threshold = addDays(applied, 3);
  return outreach.messages.some((m) => m.date.iso !== null && m.date.iso >= threshold && sameCompany(application, m.company, m.companyKey));
}

function candidates(apps: readonly Application[], outreach: Outreach, today: string): Array<Omit<FollowUp, 'windowDaysLeft'>> {
  const result: Array<Omit<FollowUp, 'windowDaysLeft'>> = [];
  for (const application of apps) {
    if (application.status !== 'waiting') continue;
    // "~Sep 2026" is not precise enough to count days from.
    if (application.applied.precision !== 'day' || application.applied.approximate || !application.applied.iso) continue;
    const contact = namedContact(application, outreach);
    if (!contact) continue;
    if (hasResponse(application, outreach) || followUpSent(application, outreach)) continue;
    result.push({ application, contact, daysSinceApplied: daysBetween(application.applied.iso, today) });
  }
  return result;
}

/** Applications whose follow-up window (minDays..maxDays after applying) is open today. */
export function followUpsDue(
  apps: readonly Application[],
  today: string,
  outreach: Outreach = EMPTY_OUTREACH,
  options: FollowUpOptions = DEFAULT_FOLLOW_UP,
): FollowUp[] {
  return candidates(apps, outreach, today)
    .filter((c) => c.daysSinceApplied >= options.minDays && c.daysSinceApplied <= options.maxDays)
    .map((c) => ({ ...c, windowDaysLeft: options.maxDays - c.daysSinceApplied }))
    .sort((a, b) => a.windowDaysLeft - b.windowDaysLeft);
}

/** Applications whose window opens within `horizonDays`. `windowDaysLeft` is negative: days until it opens. */
export function followUpsUpcoming(
  apps: readonly Application[],
  today: string,
  outreach: Outreach = EMPTY_OUTREACH,
  options: FollowUpOptions = DEFAULT_FOLLOW_UP,
  horizonDays = 5,
): FollowUp[] {
  return candidates(apps, outreach, today)
    .filter((c) => c.daysSinceApplied < options.minDays && c.daysSinceApplied >= options.minDays - horizonDays)
    .map((c) => ({ ...c, windowDaysLeft: c.daysSinceApplied - options.minDays }))
    .sort((a, b) => b.windowDaysLeft - a.windowDaysLeft);
}

/** Connection requests still pending after more than `maxDays` days: worth withdrawing. */
export function staleConnects(connections: readonly Connection[], today: string, maxDays = 14): StaleConnect[] {
  const stale: StaleConnect[] = [];
  for (const connection of connections) {
    if (connection.status !== 'pending' || !connection.sent.iso || connection.sent.precision !== 'day') continue;
    const daysPending = daysBetween(connection.sent.iso, today);
    if (daysPending > maxDays) stale.push({ connection, daysPending });
  }
  return stale.sort((a, b) => b.daysPending - a.daysPending);
}

/**
 * Checks the log against itself. An agent (or a tired human) edits the row but
 * forgets to move it to the section that matches its new status.
 */
export function hygieneIssues(apps: readonly Application[], today: string, noReplyAfterDays = 28): HygieneIssue[] {
  const issues: HygieneIssue[] = [];
  const issue = (a: Application, message: string): void => {
    issues.push({ applicationId: a.id, company: a.company, role: a.role, message, line: a.line });
  };
  const seen = new Map<string, Application>();

  for (const a of apps) {
    const open = a.status === 'waiting' || a.status === 'no_reply';
    if (open && a.events.some((e) => e.kind === 'rejected')) issue(a, `Says "rejected" but sits under "${a.section}"`);
    if (a.status === 'waiting' && a.events.some((e) => e.kind === 'offer')) issue(a, `Mentions an offer but sits under "${a.section}"`);
    if (a.status === 'waiting' && a.applied.iso && a.applied.precision === 'day') {
      const age = daysBetween(a.applied.iso, today);
      const active = a.events.some((e) => e.date !== null && daysBetween(e.date, today) <= noReplyAfterDays && e.kind !== 'submitted' && e.kind !== 'confirmation');
      if (age > noReplyAfterDays && !active) issue(a, `Waiting for ${age} days with no news: move to "No reply"?`);
    }
    if (a.status !== 'not_applied' && a.status !== 'archived') {
      const key = `${a.companyKey}|${a.role.toLowerCase()}`;
      const earlier = seen.get(key);
      if (earlier && earlier.applied.iso === a.applied.iso) issue(a, `Looks like a duplicate of line ${earlier.line}`);
      else if (!earlier) seen.set(key, a);
    }
  }
  return issues;
}
