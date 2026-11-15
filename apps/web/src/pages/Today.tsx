import { Link } from 'react-router-dom';
import { STATUS_LABELS, daysBetween, formatDay, formatWeekday, type FollowUp, type NeedsItem, type Status } from '@jobpilot/shared';
import { useSetChecked, useToday } from '../api';
import { Badge, Card, CompanyLink, Empty, Loading, Markdown, PageHeader, cx, fuzzy } from '../ui';

const COUNT_ORDER: Status[] = ['waiting', 'interview', 'offer', 'rejected', 'no_reply', 'not_applied'];

function FollowUpRow({ item, upcoming }: { item: FollowUp; upcoming?: boolean }) {
  const { application: a, contact } = item;
  const who = contact.name ?? contact.email ?? 'contact';
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <CompanyLink name={a.company} companyKey={a.companyKey} /> <span className="text-ink-2">· {a.role}</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-2">
          Follow up with <span className="font-medium text-ink">{who}</span>
          {contact.role ? ` (${contact.role})` : ''} · applied {fuzzy(a.applied)}
          {contact.source === 'outreach' ? ' · contact from the outreach log' : ''}
        </p>
      </div>
      {upcoming ? (
        <Badge>opens in {-item.windowDaysLeft} {item.windowDaysLeft === -1 ? 'day' : 'days'}</Badge>
      ) : (
        <Badge tone={item.windowDaysLeft === 0 ? 'bad' : 'warn'} title={`Day ${item.daysSinceApplied} since applying`}>
          {item.windowDaysLeft === 0 ? 'last day' : `${item.windowDaysLeft} ${item.windowDaysLeft === 1 ? 'day' : 'days'} left`}
        </Badge>
      )}
    </li>
  );
}

function NeedsList({ items, checked, source }: { items: NeedsItem[]; checked: Set<string>; source?: string }) {
  const setChecked = useSetChecked();
  if (items.length === 0) return <Empty>Nothing needs you here.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const done = checked.has(item.id);
        return (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={done}
              onChange={(event) => setChecked.mutate({ id: item.id, checked: event.target.checked })}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              aria-label={`Done: ${item.title.slice(0, 80)}`}
            />
            <Markdown className={cx('min-w-0 flex-1 text-sm', done && 'text-muted line-through')}>{item.markdown.replace(/^- /, '')}</Markdown>
          </li>
        );
      })}
      {source && <li className="px-4 py-2 text-xs text-muted">Ticks are saved by JobPilot. The log file is never edited.</li>}
    </ul>
  );
}

export function TodayPage() {
  const { data, error } = useToday();
  if (!data) return <Loading error={error} />;
  const checked = new Set(data.checked);
  const batchAge = data.batch ? daysBetween(data.batch.date, data.today) : 0;
  const open = data.needs.filter((n) => !checked.has(n.id)).length + (data.batch?.needs.filter((n) => !checked.has(n.id)).length ?? 0);

  return (
    <>
      <PageHeader
        title={formatWeekday(data.today) + ' · Today'}
        subtitle={`${data.followUpsDue.length} follow-ups due · ${open} items need you · ${data.staleConnects.length} connects pending too long`}
      >
        {COUNT_ORDER.filter((status) => (data.counts[status] ?? 0) > 0).map((status) => (
          <Link key={status} to={`/pipeline?status=${status}`} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 hover:border-accent">
            <span className="mr-1 text-sm font-semibold text-ink">{data.counts[status]}</span>
            {STATUS_LABELS[status]}
          </Link>
        ))}
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title="Follow-ups due" count={data.followUpsDue.length}>
            {data.followUpsDue.length === 0 ? (
              <Empty>No follow-up window is open today.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {data.followUpsDue.map((item) => (
                  <FollowUpRow key={item.application.id} item={item} />
                ))}
              </ul>
            )}
            <p className="border-t border-line px-4 py-2 text-xs text-muted">One follow-up per application, never two. Applications that already got an answer or a follow-up are left out.</p>
          </Card>

          {data.followUpsUpcoming.length > 0 && (
            <Card title="Coming up" count={data.followUpsUpcoming.length}>
              <ul className="divide-y divide-line">
                {data.followUpsUpcoming.map((item) => (
                  <FollowUpRow key={item.application.id} item={item} upcoming />
                ))}
              </ul>
            </Card>
          )}

          <Card title="Connection requests pending too long" count={data.staleConnects.length}>
            {data.staleConnects.length === 0 ? (
              <Empty>No stale connection requests.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {data.staleConnects.map(({ connection, daysPending }) => (
                  <li key={connection.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {connection.profileUrl ? (
                          <a href={connection.profileUrl} target="_blank" rel="noreferrer noopener" className="hover:text-accent hover:underline">
                            {connection.person}
                          </a>
                        ) : (
                          connection.person
                        )}
                      </p>
                      <p className="truncate text-xs text-ink-2">
                        {connection.company} · sent {fuzzy(connection.sent)}
                      </p>
                    </div>
                    <Badge tone="warn">{daysPending} days</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.hygiene.length > 0 && (
            <Card title="Log hygiene" count={data.hygiene.length}>
              <ul className="divide-y divide-line">
                {data.hygiene.map((issue) => (
                  <li key={issue.applicationId + issue.message} className="px-4 py-2.5">
                    <p className="font-medium">
                      {issue.company} <span className="font-normal text-ink-2">· {issue.role}</span>
                    </p>
                    <p className="text-xs text-ink-2">
                      {issue.message} <span className="text-muted">(line {issue.line})</span>
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Needs you" count={data.needs.filter((n) => !checked.has(n.id)).length}>
            <NeedsList items={data.needs} checked={checked} source="log" />
          </Card>

          {data.batch ? (
            <Card
              title={batchAge === 0 ? "Today's batch" : `Latest batch · ${formatDay(data.batch.date)}`}
              action={
                <Link to={`/batches/${data.batch.date}`} className="text-xs text-accent hover:underline">
                  Open full batch
                </Link>
              }
            >
              {batchAge > 0 && <p className="border-b border-line bg-page px-4 py-2 text-xs text-ink-2">No batch for today yet. This one is {batchAge} {batchAge === 1 ? 'day' : 'days'} old.</p>}
              {data.batch.needs.length > 0 && (
                <>
                  <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Needs you</p>
                  <NeedsList items={data.batch.needs} checked={checked} />
                </>
              )}
              {data.batch.roles.length > 0 && (
                <div className="border-t border-line px-4 py-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Proposed roles</p>
                  <ul className="space-y-2">
                    {data.batch.roles.map((role) => (
                      <li key={role.index + role.company} className="rounded-lg border border-line bg-raised px-3 py-2">
                        <p className="font-medium">
                          {role.company} <span className="font-normal text-ink-2">· {role.role}</span>
                        </p>
                        <p className="text-xs text-ink-2">{role.location}</p>
                        {role.gap && <p className="mt-1 text-xs text-ink-2"><span className="font-medium text-warn">Gap:</span> {role.gap}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.batch.sections
                .filter((section) => /summary|networking/i.test(section.heading) && section.markdown)
                .map((section) => (
                  <div key={section.heading} className="border-t border-line px-4 py-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{section.heading}</p>
                    <Markdown className="text-sm text-ink-2">{section.markdown}</Markdown>
                  </div>
                ))}
            </Card>
          ) : (
            <Card title="Daily batch">
              <Empty>No batch files found.</Empty>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
