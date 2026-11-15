import { NavLink, useParams } from 'react-router-dom';
import { formatWeekday } from '@jobpilot/shared';
import { useBatch, useBatches } from '../api';
import { Card, Empty, Loading, Markdown, PageHeader, cx } from '../ui';

export function BatchesPage() {
  const { date } = useParams();
  const list = useBatches();
  const current = date ?? list.data?.batches[0]?.date;
  const batch = useBatch(current);

  if (!list.data) return <Loading error={list.error} />;
  return (
    <>
      <PageHeader title="Daily batches" subtitle="The agent's report for each day, rendered from the Markdown files." />
      {list.data.batches.length === 0 ? (
        <Card>
          <Empty>No batch files found in the configured folder.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
          <Card title="Days" count={list.data.batches.length} className="self-start">
            <ul className="max-h-[70vh] overflow-y-auto p-1.5">
              {list.data.batches.map((item) => (
                <li key={item.date}>
                  <NavLink
                    to={`/batches/${item.date}`}
                    className={() => cx('flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm', item.date === current ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:bg-page')}
                  >
                    {formatWeekday(item.date)}
                    <span className="text-xs text-muted">
                      {item.roleCount > 0 ? `${item.roleCount} roles` : ''}
                      {item.needsCount > 0 ? ` · ${item.needsCount} to do` : ''}
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={batch.data?.title ?? 'Batch'}>
            {batch.data ? <Markdown className="px-5 py-4 text-sm">{batch.data.markdown.replace(/^#\s+.+\n/, '')}</Markdown> : <Loading error={batch.error} />}
          </Card>
        </div>
      )}
    </>
  );
}
