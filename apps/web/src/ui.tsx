import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { CHANNEL_LABELS, REGION_LABELS, STATUS_LABELS, formatDay, type Application, type EventKind, type FuzzyDate, type Status } from '@jobpilot/shared';

import { splitByMatches } from './highlight';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({ title, count, action, children, className }: { title?: ReactNode; count?: number; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {title !== undefined && (
        <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          {count !== undefined && <span className="rounded-full bg-page px-2 py-0.5 text-xs font-medium text-ink-2">{count}</span>}
          <div className="ml-auto">{action}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const TONES: Record<Tone, string> = {
  neutral: 'bg-page text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  good: 'bg-good-soft text-good border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4', TONES[tone])}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<Status, Tone> = {
  interview: 'good',
  offer: 'good',
  waiting: 'accent',
  no_reply: 'neutral',
  rejected: 'bad',
  not_applied: 'neutral',
  archived: 'neutral',
  unknown: 'warn',
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}

export const EVENT_LABEL: Record<EventKind, string> = {
  submitted: 'Submitted',
  confirmation: 'Confirmed',
  viewed: 'Viewed',
  reply: 'Reply',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  follow_up: 'Follow-up',
  note: 'Note',
};

export const EVENT_TONE: Record<EventKind, Tone> = {
  submitted: 'neutral',
  confirmation: 'neutral',
  viewed: 'accent',
  reply: 'good',
  interview: 'good',
  offer: 'good',
  rejected: 'bad',
  follow_up: 'accent',
  note: 'neutral',
};

/** Shows a date as written when it is not an exact day ("~Sep 2026"). */
export function fuzzy(date: FuzzyDate): string {
  if (!date.iso) return date.raw || 'unknown';
  if (date.precision === 'day' && !date.approximate) return formatDay(date.iso);
  return date.raw;
}

export function regionLabel(region: string): string {
  return REGION_LABELS[region] ?? region;
}

export function channelLabel(application: Application): string {
  return CHANNEL_LABELS[application.channel];
}

export function CompanyLink({ name, companyKey, className }: { name: string; companyKey: string; className?: string }) {
  return (
    <Link to={`/company/${encodeURIComponent(companyKey)}`} className={cx('font-semibold text-ink hover:text-accent hover:underline', className)} onClick={(event) => event.stopPropagation()}>
      {name}
    </Link>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cx('md', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Links in the logs point anywhere; never navigate the dashboard away.
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Text with every occurrence of the search terms wrapped in <mark>. */
export function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {splitByMatches(text, terms).map((piece, index) => (piece.match ? <mark key={index}>{piece.text}</mark> : piece.text))}
    </>
  );
}

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Loading({ error }: { error?: unknown }) {
  if (error) {
    return (
      <div className="rounded-xl border border-line bg-bad-soft px-4 py-3 text-sm text-bad">
        Could not load: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  return <p className="py-10 text-center text-sm text-muted">Loading…</p>;
}

export const inputClass =
  'w-full rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none';

export const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-50';

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-transparent bg-accent px-3 py-1.5 text-sm font-semibold text-page hover:opacity-90 disabled:opacity-50';
