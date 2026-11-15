/**
 * Statistics over the applications: how many, how many answered, how fast the
 * rejections come, split by region, channel and CV variant.
 */
import { addDays, daysBetween, weekStart } from '../dates';
import { REGION_LABELS } from '../parse/classify';
import { CHANNEL_LABELS, type Application, type GroupStat, type Stats } from '../schemas';

/** "Not applied" rows are decisions, not applications. */
export function isApplication(a: Application): boolean {
  return a.status !== 'not_applied';
}

export function responded(a: Application): boolean {
  if (a.status === 'rejected' || a.status === 'interview' || a.status === 'offer') return true;
  return a.events.some((e) => e.kind === 'rejected' || e.kind === 'interview' || e.kind === 'offer' || e.kind === 'reply');
}

export function hadInterview(a: Application): boolean {
  return a.status === 'interview' || a.status === 'offer' || a.events.some((e) => e.kind === 'interview' || e.kind === 'offer');
}

function rejectionDate(a: Application): string | null {
  const dated = a.events.filter((e) => e.kind === 'rejected' && e.date !== null).map((e) => e.date!);
  return dated.length > 0 ? dated.sort()[0]! : null;
}

/** Days from applying to the rejection, when both days are known exactly. */
export function daysToRejection(a: Application): number | null {
  if (a.applied.precision !== 'day' || a.applied.approximate || !a.applied.iso) return null;
  const rejected = rejectionDate(a);
  if (!rejected) return null;
  const days = daysBetween(a.applied.iso, rejected);
  return days >= 0 ? days : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function groupBy(apps: readonly Application[], keyOf: (a: Application) => string, labelOf: (key: string) => string): GroupStat[] {
  const groups = new Map<string, Application[]>();
  for (const a of apps) {
    const key = keyOf(a);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([key, items]): GroupStat => {
      const answered = items.filter(responded).length;
      return {
        key,
        label: labelOf(key),
        total: items.length,
        responded: answered,
        rejected: items.filter((a) => a.status === 'rejected' || a.events.some((e) => e.kind === 'rejected')).length,
        interviews: items.filter(hadInterview).length,
        responseRate: items.length > 0 ? answered / items.length : null,
        medianDaysToRejection: median(items.map(daysToRejection).filter((d): d is number => d !== null)),
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function computeStats(allApps: readonly Application[], maxWeeks = 26): Stats {
  const apps = allApps.filter(isApplication);
  const answered = apps.filter(responded).length;

  // Weekly series, zero-filled so quiet weeks show as gaps instead of disappearing.
  const applicationsPerWeek = new Map<string, number>();
  const rejectionsPerWeek = new Map<string, number>();
  for (const a of apps) {
    if (a.applied.iso && a.applied.precision === 'day') {
      const week = weekStart(a.applied.iso);
      applicationsPerWeek.set(week, (applicationsPerWeek.get(week) ?? 0) + 1);
    }
    const rejected = rejectionDate(a);
    if (rejected) {
      const week = weekStart(rejected);
      rejectionsPerWeek.set(week, (rejectionsPerWeek.get(week) ?? 0) + 1);
    }
  }
  const weeks = [...new Set([...applicationsPerWeek.keys(), ...rejectionsPerWeek.keys()])].sort();
  const perWeek: Stats['perWeek'] = [];
  if (weeks.length > 0) {
    const last = weeks[weeks.length - 1]!;
    let week = weeks[0]!;
    if (daysBetween(week, last) / 7 >= maxWeeks) week = addDays(last, -7 * (maxWeeks - 1));
    for (; week <= last; week = addDays(week, 7)) {
      const point = { week, applications: applicationsPerWeek.get(week) ?? 0, rejections: rejectionsPerWeek.get(week) ?? 0 };
      // Gaps inside the series are information; an empty run before the first event is not.
      if (perWeek.length === 0 && point.applications === 0 && point.rejections === 0) continue;
      perWeek.push(point);
    }
  }

  return {
    total: apps.length,
    responded: answered,
    responseRate: apps.length > 0 ? answered / apps.length : null,
    medianDaysToRejection: median(apps.map(daysToRejection).filter((d): d is number => d !== null)),
    perWeek,
    byRegion: groupBy(apps, (a) => a.region, (key) => REGION_LABELS[key] ?? key),
    byChannel: groupBy(apps, (a) => a.channel, (key) => CHANNEL_LABELS[key as keyof typeof CHANNEL_LABELS] ?? key),
    byCv: groupBy(apps, (a) => a.cvVariant ?? 'none', (key) => (key === 'none' ? 'Not recorded' : key)),
  };
}
