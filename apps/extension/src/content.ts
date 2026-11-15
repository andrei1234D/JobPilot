/**
 * Content script: on a job posting it shows a small panel with
 *  - "Seen before?"  earlier applications and decisions for this company;
 *  - red flags found in the ad text;
 *  - a button that saves the posting to the shortlist.
 *
 * The panel lives in a closed shadow root, so the site's CSS cannot restyle it
 * and its CSS cannot leak into the site. All text is set with textContent.
 */
import { STATUS_LABELS, redFlags, type LookupResponse, type Profile, type RedFlag, type RepeatMatch } from '@jobpilot/shared';
import { extractPosting, looksLikePosting, type Posting } from './extract';
import { send } from './messages';
import { PANEL_CSS } from './panelCss';

const HOST_ID = 'jobpilot-panel-host';

/** True only in the build the browser test loads; a closed root cannot be inspected from outside. */
declare const __E2E__: boolean | undefined;
const SHADOW_MODE: ShadowRootMode = typeof __E2E__ === 'boolean' && __E2E__ ? 'open' : 'closed';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(iso: string | null, raw: string): string {
  if (!iso) return raw || 'no date';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

function matchRow(match: RepeatMatch): HTMLElement {
  const a = match.application;
  const row = el('li', 'row');
  const top = el('div', 'row-top');
  top.append(el('span', `pill ${a.status}`, STATUS_LABELS[a.status]), el('span', 'date', formatDate(a.applied.iso, a.applied.raw)));
  row.append(top, el('div', 'role', a.role || '(role not recorded)'));
  if (match.reason === 'job_id') row.append(el('div', 'hint', 'This exact posting'));
  else if (a.company) row.append(el('div', 'hint', a.company));
  if (a.lastEvent && a.status !== 'not_applied') row.append(el('div', 'hint', `Last: ${a.lastEvent.kind.replace('_', ' ')}${a.lastEvent.date ? ` · ${formatDate(a.lastEvent.date, '')}` : ''}`));
  if (a.status === 'not_applied' && a.history) row.append(el('div', 'hint', `Why: ${a.history.replace(/\*\*/g, '').slice(0, 120)}`));
  return row;
}

function flagRow(flag: RedFlag): HTMLElement {
  const row = el('li', 'row');
  const top = el('div', 'row-top');
  top.append(el('span', `dot ${flag.severity}`), el('span', 'flag-label', flag.label));
  row.append(top);
  if (flag.evidence) row.append(el('div', 'evidence', `“${flag.evidence}”`));
  return row;
}

interface State {
  posting: Posting;
  flags: RedFlag[];
  lookup: LookupResponse | null;
  offline: boolean;
  saved: 'no' | 'saving' | 'yes' | 'error';
  collapsed: boolean;
}

function render(root: ShadowRoot, state: State, actions: { save: () => void; toggle: () => void; close: () => void }): void {
  root.replaceChildren();
  const style = el('style');
  style.textContent = PANEL_CSS;
  const panel = el('section', `panel${state.collapsed ? ' collapsed' : ''}`);
  panel.setAttribute('aria-label', 'JobPilot');

  const blockers = state.flags.filter((f) => f.severity === 'block').length;
  const repeats = state.lookup?.matches.length ?? 0;
  const header = el('header', 'header');
  const title = el('button', 'title');
  title.type = 'button';
  title.setAttribute('aria-expanded', String(!state.collapsed));
  title.append(el('span', 'brand', 'JobPilot'));
  if (repeats > 0) title.append(el('span', 'count seen', `${repeats} seen`));
  if (state.flags.length > 0) title.append(el('span', `count ${blockers > 0 ? 'block' : 'warn'}`, `${state.flags.length} ${state.flags.length === 1 ? 'flag' : 'flags'}`));
  title.addEventListener('click', actions.toggle);
  const close = el('button', 'close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Hide JobPilot on this page');
  close.addEventListener('click', actions.close);
  header.append(title, close);
  panel.append(header);

  if (!state.collapsed) {
    const body = el('div', 'body');
    body.append(el('div', 'posting', `${state.posting.company || 'Unknown company'} · ${state.posting.title}`));

    body.append(el('h3', 'heading', 'Seen before?'));
    if (state.offline) {
      body.append(el('p', 'note offline', 'JobPilot is not running, so your history is not available. Start the JobPilot app and reload this page.'));
    } else if (!state.lookup) {
      body.append(el('p', 'note', 'Checking your logs…'));
    } else if (state.lookup.matches.length === 0) {
      body.append(el('p', 'note ok', 'No earlier application or decision for this company.'));
    } else {
      const list = el('ul', 'list');
      for (const match of state.lookup.matches.slice(0, 6)) list.append(matchRow(match));
      body.append(list);
      if (state.lookup.matches.length > 6) body.append(el('p', 'note', `…and ${state.lookup.matches.length - 6} more in the dashboard.`));
    }

    body.append(el('h3', 'heading', 'Red flags in the ad'));
    if (state.flags.length === 0) {
      body.append(el('p', 'note ok', state.posting.text.length < 200 ? 'Not enough ad text on this page to check.' : 'None found.'));
    } else {
      const list = el('ul', 'list');
      for (const flag of state.flags) list.append(flagRow(flag));
      body.append(list);
    }

    const save = el('button', 'save');
    save.type = 'button';
    const already = state.lookup?.shortlisted || state.saved === 'yes';
    save.textContent = already ? 'On your shortlist ✓' : state.saved === 'saving' ? 'Saving…' : state.saved === 'error' ? 'Could not save. Try again' : 'Save to shortlist';
    save.disabled = already || state.saved === 'saving' || state.offline;
    save.addEventListener('click', actions.save);
    body.append(save);
    panel.append(body);
  }
  root.append(style, panel);
}

let currentUrl = '';
let dismissedUrl = '';
let generation = 0;

async function show(): Promise<void> {
  const url = location.href;
  const mine = ++generation;
  document.getElementById(HOST_ID)?.remove();
  if (!looksLikePosting(url) || dismissedUrl === url) return;

  // Single-page sites render the posting after the URL changes: wait for it.
  let posting: Posting | null = null;
  for (let attempt = 0; attempt < 12 && !posting; attempt++) {
    posting = extractPosting(document, url);
    if (posting && posting.text.length < 200 && attempt < 6) posting = null;
    if (!posting) await new Promise((resolve) => setTimeout(resolve, 500));
    if (mine !== generation) return;
  }
  if (!posting) return;

  const host = el('div');
  host.id = HOST_ID;
  // Closed, so the job site's own scripts cannot read your application history out of the panel.
  const root = host.attachShadow({ mode: SHADOW_MODE });
  document.documentElement.append(host);

  const state: State = { posting, flags: redFlags({ title: posting.title, text: posting.text }), lookup: null, offline: false, saved: 'no', collapsed: false };
  const actions = {
    toggle: (): void => {
      state.collapsed = !state.collapsed;
      paint();
    },
    close: (): void => {
      dismissedUrl = url;
      host.remove();
    },
    save: (): void => {
      state.saved = 'saving';
      paint();
      void send({
        type: 'shortlist:add',
        payload: { title: posting.title, company: posting.company || 'Unknown company', location: posting.location, url: posting.url, source: posting.site, flags: state.flags },
      }).then((result) => {
        state.saved = result.ok ? 'yes' : 'error';
        if (!result.ok && result.offline) state.offline = true;
        paint();
      });
    },
  };
  const paint = (): void => render(root, state, actions);
  paint();

  const result = await send({ type: 'lookup', payload: { company: posting.company, url: posting.url, title: posting.title } });
  if (mine !== generation) return;
  if (result.ok) {
    state.lookup = result.data;
    // The server knows the user's profile (languages, years, stacks): re-run the rules with it.
    const profile: Profile = result.data.profile;
    state.flags = redFlags({ title: posting.title, text: posting.text }, profile);
  } else {
    state.offline = true;
  }
  paint();
}

function watchNavigation(): void {
  const check = (): void => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    void show();
  };
  check();
  // LinkedIn and Workday swap postings without a page load.
  setInterval(check, 800);
  window.addEventListener('popstate', check);
}

watchNavigation();
