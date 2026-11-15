import { Link, useParams } from 'react-router-dom';
import { formatDay } from '@jobpilot/shared';
import { ApiError, useCompany } from '../api';
import { Badge, Card, EVENT_LABEL, Empty, Loading, Markdown, PageHeader, StatusBadge, fuzzy } from '../ui';

export function CompanyPage() {
  const { key } = useParams();
  const { data, error } = useCompany(key);

  if (error instanceof ApiError && error.status === 404) {
    return (
      <>
        <PageHeader title={key ?? 'Company'} />
        <Card>
          <Empty>Nothing in the logs about this company. No earlier application, message or decision.</Empty>
        </Card>
      </>
    );
  }
  if (!data) return <Loading error={error} />;

  const applied = data.applications.filter((a) => a.status !== 'not_applied');
  const skipped = data.applications.length - applied.length;
  const open = applied.filter((a) => a.status === 'waiting' || a.status === 'interview' || a.status === 'offer').length;

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={`${applied.length} ${applied.length === 1 ? 'application' : 'applications'}${open ? ` (${open} open)` : ''}${skipped ? ` · ${skipped} not applied` : ''} · ${data.messages.length} messages · ${data.connections.length} connects`}
      >
        <Link to="/pipeline" className="text-sm text-accent hover:underline">
          Back to the pipeline
        </Link>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title="Applications and decisions" count={data.applications.length}>
          {data.applications.length === 0 ? (
            <Empty>No applications.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.applications.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.role || '—'}</span>
                    <StatusBadge status={a.status} />
                    <span className="ml-auto text-xs text-ink-2">{fuzzy(a.applied)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {[a.location, a.cvVariant ? `CV ${a.cvVariant}` : '', a.roleNote ?? ''].filter(Boolean).join(' · ')}
                  </p>
                  {a.lastEvent && (
                    <p className="mt-1 text-xs text-ink-2">
                      <span className="font-medium">Last: {EVENT_LABEL[a.lastEvent.kind]}</span>
                      {a.lastEvent.date ? ` on ${formatDay(a.lastEvent.date)}` : ''}
                    </p>
                  )}
                  <Markdown className="mt-1.5 text-sm text-ink-2">{a.history}</Markdown>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Messages" count={data.messages.length}>
            {data.messages.length === 0 ? (
              <Empty>No messages to anyone here.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {data.messages.map((m) => (
                  <li key={m.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.person}</span>
                      {m.replied && <Badge tone="good">replied</Badge>}
                      <span className="ml-auto text-xs text-ink-2">{fuzzy(m.date)}</span>
                    </div>
                    {m.personRole && <p className="text-xs text-muted">{m.personRole}</p>}
                    <p className="mt-1 text-xs text-ink-2">{m.about}</p>
                    <p className="mt-1 text-xs text-ink-2">
                      <span className="font-medium">Status:</span> {m.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Connection requests" count={data.connections.length}>
            {data.connections.length === 0 ? (
              <Empty>No connection requests.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {data.connections.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="font-medium">{c.person}</span>
                    <Badge tone={c.status === 'accepted' ? 'good' : c.status === 'pending' ? 'accent' : 'neutral'}>{c.status}</Badge>
                    <span className="ml-auto text-xs text-ink-2">{fuzzy(c.sent)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.shortlist.length > 0 && (
            <Card title="On the shortlist" count={data.shortlist.length}>
              <ul className="divide-y divide-line">
                {data.shortlist.map((item) => (
                  <li key={item.id} className="px-4 py-2.5">
                    <a href={item.url} target="_blank" rel="noreferrer noopener" className="font-medium hover:text-accent hover:underline">
                      {item.title}
                    </a>
                    <p className="text-xs text-muted">saved {formatDay(item.addedAt.slice(0, 10))}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.batchMentions.length > 0 && (
            <Card title="Mentioned in daily batches" count={data.batchMentions.length}>
              <ul className="divide-y divide-line">
                {data.batchMentions.map((mention) => (
                  <li key={mention.date}>
                    <Link to={`/batches/${mention.date}`} className="block px-4 py-2.5 hover:bg-page">
                      <p className="text-xs font-medium">{formatDay(mention.date)}</p>
                      <p className="mt-0.5 text-xs text-ink-2">{mention.snippet}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
