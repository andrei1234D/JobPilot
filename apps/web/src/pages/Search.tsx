import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDay, queryTerms, type SearchHit } from '@jobpilot/shared';
import { useApplications, useSearch } from '../api';
import { Badge, Card, Empty, Highlight, PageHeader, inputClass } from '../ui';

const TYPE_LABEL: Record<SearchHit['type'], string> = {
  application: 'Application',
  message: 'Message',
  connection: 'Connect',
  batch: 'Batch',
  needs: 'Needs you',
};

function useHitLink() {
  const applications = useApplications();
  return (hit: SearchHit): string => {
    if (hit.type === 'application') {
      const application = applications.data?.applications.find((a) => a.id === hit.ref);
      return application ? `/company/${encodeURIComponent(application.companyKey)}` : '/pipeline';
    }
    if (hit.type === 'batch') return `/batches/${hit.ref}`;
    if (hit.type === 'needs') return '/';
    return `/company/${encodeURIComponent(hit.ref)}`;
  };
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [draft, setDraft] = useState(query);
  const linkFor = useHitLink();
  const { data, isFetching } = useSearch(query);

  useEffect(() => setDraft(query), [query]);

  // Search as you type, a beat after the last key press.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft.trim() !== query) setParams(draft.trim() ? { q: draft.trim() } : {}, { replace: true });
    }, 220);
    return () => clearTimeout(timer);
  }, [draft, query, setParams]);

  const hits = query ? (data?.hits ?? []) : [];
  // The same terms the search used for this query: quoted phrases stay one piece.
  const terms = queryTerms(query);
  return (
    <>
      <PageHeader title="Search" subtitle="Applications, messages, connection requests, daily batches and the needs list. All words must match; use quotes for a phrase." />
      <input
        type="search"
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder='Try: teamtailor   ·   "no reply"   ·   a company or a person'
        aria-label="Search query"
        className={`${inputClass} mb-4 max-w-xl`}
      />
      <Card title={query ? `Results for “${query}”` : 'Results'} count={query ? hits.length : undefined}>
        {!query ? (
          <Empty>Type something to search every log at once.</Empty>
        ) : hits.length === 0 ? (
          <Empty>{isFetching ? 'Searching…' : 'Nothing found.'}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {hits.map((hit) => (
              <li key={`${hit.type}-${hit.id}`}>
                <Link to={linkFor(hit)} className="block px-4 py-2.5 hover:bg-page">
                  <div className="flex items-center gap-2">
                    <Badge tone={hit.type === 'application' ? 'accent' : 'neutral'}>{TYPE_LABEL[hit.type]}</Badge>
                    <span className="truncate font-medium">
                      <Highlight text={hit.title} terms={terms} />
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted">{hit.date ? formatDay(hit.date) : ''}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    <Highlight text={hit.subtitle} terms={terms} />
                  </p>
                  <p className="mt-1 text-xs text-ink-2">
                    <Highlight text={hit.snippet} terms={terms} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
