import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { STATUS_LABELS, formatDay, type Application, type Status } from '@jobpilot/shared';
import { useApplications } from '../api';
import { Badge, CompanyLink, EVENT_LABEL, EVENT_TONE, Loading, Markdown, PageHeader, StatusBadge, channelLabel, cx, fuzzy, inputClass, regionLabel } from '../ui';

const COLUMNS: Status[] = ['waiting', 'interview', 'offer', 'rejected', 'no_reply', 'not_applied', 'archived', 'unknown'];
const ALWAYS: Status[] = ['waiting', 'interview', 'rejected', 'no_reply', 'not_applied'];

function Card({ application: a, onOpen, selected }: { application: Application; onOpen: () => void; selected: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cx('w-full rounded-lg border bg-raised px-3 py-2 text-left hover:border-accent', selected ? 'border-accent ring-1 ring-accent' : 'border-line')}
      >
        <p className="truncate text-[13px] font-semibold">{a.company}</p>
        <p className="truncate text-xs text-ink-2">{a.role || '—'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Badge>{fuzzy(a.applied)}</Badge>
          {a.region !== 'OTHER' && <Badge>{a.region === 'REMOTE' ? 'Remote' : a.region}</Badge>}
          {a.status !== 'not_applied' && a.channel !== 'other' && <Badge>{channelLabel(a)}</Badge>}
        </div>
        {a.lastEvent && (
          <p className="mt-1.5 truncate text-[11px] text-muted">
            <span className={cx('font-medium', a.lastEvent.kind === 'rejected' ? 'text-bad' : a.lastEvent.kind === 'interview' || a.lastEvent.kind === 'reply' ? 'text-good' : 'text-ink-2')}>
              {EVENT_LABEL[a.lastEvent.kind]}
            </span>
            {a.lastEvent.date ? ` · ${formatDay(a.lastEvent.date)}` : ''}
          </p>
        )}
      </button>
    </li>
  );
}

function Detail({ application: a, onClose }: { application: Application; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: Array<[string, string]> = [
    ['Applied', fuzzy(a.applied)],
    ['Location', a.location || '—'],
    ['Region', regionLabel(a.region)],
    ['Channel', a.status === 'not_applied' ? '—' : channelLabel(a)],
    ['CV', a.cvVariant ?? '—'],
  ];
  return (
    <aside className="flex w-[26rem] shrink-0 flex-col rounded-xl border border-line bg-surface" aria-label="Application details">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <CompanyLink name={a.company} companyKey={a.companyKey} className="text-base" />
          {a.companyNote && <p className="text-xs text-muted">{a.companyNote}</p>}
          <p className="mt-1 text-sm text-ink-2">{a.role}</p>
          {a.roleNote && <p className="text-xs text-muted">{a.roleNote}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-ink-2 hover:bg-page" aria-label="Close details">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={a.status} />
          <Badge>line {a.line}</Badge>
        </div>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {a.contacts.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">People</h3>
            <ul className="space-y-0.5 text-sm">
              {a.contacts.map((contact) => (
                <li key={(contact.name ?? '') + (contact.email ?? '')}>
                  {contact.name ?? contact.email}
                  {contact.role && <span className="text-ink-2"> · {contact.role}</span>}
                  {!contact.named && <span className="text-muted"> · shared mailbox</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {a.events.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</h3>
            <ol className="space-y-2 border-l border-line-strong pl-3">
              {a.events.map((event, index) => (
                <li key={index} className="text-sm">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={EVENT_TONE[event.kind]}>{EVENT_LABEL[event.kind]}</Badge>
                    <span className="text-xs text-ink-2">
                      {event.date ? formatDay(event.date) : 'no date'}
                      {event.time ? ` · ${event.time}` : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-2">{event.text}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {a.channelRaw && a.channelRaw !== '-' && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">How it was sent</h3>
            <p className="text-sm text-ink-2">{a.channelRaw}</p>
          </div>
        )}
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">As written in the log</h3>
          <Markdown className="text-sm text-ink-2">{a.history || '—'}</Markdown>
        </div>
        {a.warnings.length > 0 && (
          <div className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            {a.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export function PipelinePage() {
  const { data, error } = useApplications();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const onlyStatus = params.get('status') as Status | null;

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const groups = new Map<Status, Application[]>();
    for (const a of data?.applications ?? []) {
      if (needle && !`${a.company} ${a.role} ${a.location} ${a.channelRaw} ${a.history}`.toLowerCase().includes(needle)) continue;
      groups.set(a.status, [...(groups.get(a.status) ?? []), a]);
    }
    for (const list of groups.values()) list.sort((x, y) => (y.applied.iso ?? '').localeCompare(x.applied.iso ?? ''));
    return groups;
  }, [data, filter]);

  if (!data) return <Loading error={error} />;
  const selected = data.applications.find((a) => a.id === selectedId) ?? null;
  const columns = COLUMNS.filter((status) => (onlyStatus ? status === onlyStatus : ALWAYS.includes(status) || (grouped.get(status)?.length ?? 0) > 0));
  const shown = [...grouped.values()].reduce((n, list) => n + list.length, 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Pipeline" subtitle={`${shown} of ${data.applications.length} rows · parsed live from the applications log`}>
        {onlyStatus && (
          <button type="button" onClick={() => setParams({})} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 hover:border-accent">
            {STATUS_LABELS[onlyStatus]} only ✕
          </button>
        )}
        <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter cards…" aria-label="Filter cards" className={cx(inputClass, 'w-56')} />
      </PageHeader>

      {data.notes.map((note) => (
        <p key={note.heading} className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-2">
          <span className="font-semibold text-ink">{note.heading}:</span> {note.markdown.replace(/\s+/g, ' ').slice(0, 260)}
        </p>
      ))}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-2">
          {columns.map((status) => {
            const list = grouped.get(status) ?? [];
            return (
              <section key={status} className="flex w-64 shrink-0 flex-col rounded-xl border border-line bg-surface" aria-label={STATUS_LABELS[status]}>
                <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <h2 className="text-[13px] font-semibold">{STATUS_LABELS[status]}</h2>
                  <span className="rounded-full bg-page px-2 py-0.5 text-xs font-medium text-ink-2">{list.length}</span>
                </header>
                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {list.map((a) => (
                    <Card key={a.id} application={a} selected={a.id === selectedId} onOpen={() => setSelectedId(a.id === selectedId ? null : a.id)} />
                  ))}
                  {list.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted">Nothing here</li>}
                </ul>
              </section>
            );
          })}
        </div>
        {selected && <Detail application={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}
