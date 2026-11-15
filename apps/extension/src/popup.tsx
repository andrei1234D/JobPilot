/** Toolbar popup: is JobPilot running, and what does today look like? */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_HOST, DEFAULT_PORT, type Today } from '@jobpilot/shared';
import { send, type Result } from './messages';

const DASHBOARD = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

function Popup() {
  const [result, setResult] = useState<Result<Today> | null>(null);
  useEffect(() => {
    void send({ type: 'today' }).then(setResult);
  }, []);

  const open = (path = '/'): void => void chrome.tabs.create({ url: `${DASHBOARD}${path}` });
  return (
    <main>
      <h1>JobPilot</h1>
      {!result && <p className="muted">Connecting…</p>}
      {result && !result.ok && (
        <p className="offline">
          {result.offline ? 'JobPilot is not running. Start the JobPilot app, then open this popup again.' : result.error}
        </p>
      )}
      {result?.ok && (
        <>
          <ul>
            <li>
              <strong>{result.data.followUpsDue.length}</strong> follow-ups due today
            </li>
            <li>
              <strong>{result.data.needs.length + (result.data.batch?.needs.length ?? 0) - result.data.checked.length}</strong> items need you
            </li>
            <li>
              <strong>{result.data.staleConnects.length}</strong> connects pending too long
            </li>
          </ul>
          {result.data.demo && <p className="muted">Showing the sample data.</p>}
          <button type="button" onClick={() => open('/')}>
            Open the dashboard
          </button>
          <button type="button" className="secondary" onClick={() => open('/shortlist')}>
            Shortlist
          </button>
        </>
      )}
      <p className="muted small">Open a job posting on LinkedIn, Teamtailor, Workday, Greenhouse, Lever or Ashby to see “Seen before?” and red flags.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
