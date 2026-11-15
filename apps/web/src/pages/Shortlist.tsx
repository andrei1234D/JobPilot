import { formatDay } from '@jobpilot/shared';
import { useRemoveShortlistItem, useShortlist } from '../api';
import { Badge, Card, CompanyLink, Empty, Loading, PageHeader, buttonClass } from '../ui';

export function ShortlistPage() {
  const { data, error } = useShortlist();
  const remove = useRemoveShortlistItem();
  if (!data) return <Loading error={error} />;

  return (
    <>
      <PageHeader title="Shortlist" subtitle="Postings saved with the browser extension's quick-add. This is the only file JobPilot writes." />
      <Card title="Saved postings" count={data.items.length}>
        {data.items.length === 0 ? (
          <Empty>Nothing saved yet. Open a job posting with the extension installed and click “Save to shortlist”.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <a href={item.url} target="_blank" rel="noreferrer noopener" className="font-semibold hover:text-accent hover:underline">
                    {item.title}
                  </a>
                  <p className="mt-0.5 text-sm text-ink-2">
                    <CompanyLink name={item.company} companyKey={item.companyKey} className="font-medium" />
                    {item.location ? ` · ${item.location}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    saved {formatDay(item.addedAt.slice(0, 10))} · {item.source}
                  </p>
                  {item.flags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.flags.map((flag) => (
                        <Badge key={flag.id} tone={flag.severity === 'block' ? 'bad' : flag.severity === 'warn' ? 'warn' : 'neutral'} title={flag.evidence}>
                          {flag.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {item.note && <p className="mt-1.5 text-sm text-ink-2">{item.note}</p>}
                </div>
                <button type="button" className={buttonClass} onClick={() => remove.mutate(item.id)} disabled={remove.isPending}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Stored in <code className="rounded bg-page px-1">{data.file}</code>
        </p>
      </Card>
    </>
  );
}
