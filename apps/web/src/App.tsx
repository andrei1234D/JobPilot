import { Suspense, lazy, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { formatDay } from '@jobpilot/shared';
import { useHealth, useLiveUpdates, useReload, useToday } from './api';
import { BatchesPage } from './pages/Batches';
import { CompanyPage } from './pages/Company';
import { PipelinePage } from './pages/Pipeline';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';
import { ShortlistPage } from './pages/Shortlist';
import { TodayPage } from './pages/Today';
import { Loading, cx, inputClass } from './ui';

// The charting library is the heaviest dependency; load it only when Stats is opened.
const StatsPage = lazy(() => import('./pages/Stats').then((module) => ({ default: module.StatsPage })));

const NAV = [
  { to: '/', label: 'Today', end: true },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/stats', label: 'Stats' },
  { to: '/batches', label: 'Daily batches' },
  { to: '/shortlist', label: 'Shortlist' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' },
];

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#1c5cab" />
      <path d="M14 34 L50 16 L40 50 L31 38 Z" fill="#ffffff" />
      <path d="M31 38 L50 16 L26 33 Z" fill="#cde2fb" />
    </svg>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };
  return (
    <form onSubmit={submit} role="search" className="w-full max-w-md">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search every log: a company, a person, “no reply”…"
        aria-label="Search every log"
        className={inputClass}
      />
    </form>
  );
}

export function App() {
  useLiveUpdates();
  const health = useHealth();
  const today = useToday();
  const reload = useReload();
  const due = today.data?.followUpsDue.length ?? 0;

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 px-4 py-4">
          <Logo />
          <span className="text-base font-semibold tracking-tight">JobPilot</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx('flex items-center justify-between rounded-lg px-3 py-1.5 text-sm', isActive ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:bg-page hover:text-ink')
              }
            >
              {item.label}
              {item.to === '/' && due > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-page" title={`${due} follow-ups due`}>
                  {due}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-1 px-4 py-4 text-xs text-muted">
          {health.data && (
            <>
              <p>Clock: {formatDay(health.data.today)}</p>
              <p title={health.data.files.applicationsLog} className="truncate">
                {health.data.demo ? 'Sample data' : 'Your logs'} · v{health.data.version}
              </p>
              {health.data.warnings > 0 && (
                <NavLink to="/settings#warnings" className="block text-warn hover:underline">
                  {health.data.warnings} parser {health.data.warnings === 1 ? 'note' : 'notes'}
                </NavLink>
              )}
            </>
          )}
          <button type="button" onClick={() => reload.mutate()} className="text-accent hover:underline" disabled={reload.isPending}>
            {reload.isPending ? 'Reloading…' : 'Reload logs'}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-line bg-surface px-6 py-2.5">
          <SearchBox />
          <div className="ml-auto flex items-center gap-2 text-xs text-ink-2">
            <span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />
            Local only · 127.0.0.1
          </div>
        </header>
        {health.data?.demo && (
          <div className="border-b border-line bg-warn-soft px-6 py-1.5 text-xs text-warn" role="status">
            Demo mode: invented sample data, with the clock pinned to {formatDay(health.data.today)}. Point JobPilot at your own logs in{' '}
            <NavLink to="/settings" className="font-semibold underline">
              Settings
            </NavLink>
            .
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route
              path="/stats"
              element={
                <Suspense fallback={<Loading />}>
                  <StatsPage />
                </Suspense>
              }
            />
            <Route path="/batches" element={<BatchesPage />} />
            <Route path="/batches/:date" element={<BatchesPage />} />
            <Route path="/shortlist" element={<ShortlistPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/company/:key" element={<CompanyPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
