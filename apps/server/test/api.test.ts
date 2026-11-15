import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HealthSchema, LookupResponseSchema, StatsSchema, TodaySchema, type Application, type ShortlistItem } from '@jobpilot/shared';
import { DataStore, buildApp, isAllowedOrigin, startServer } from '../src';

const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'sample-data');
const HOST = { host: '127.0.0.1:47321' };

let home: string;
let store: DataStore;
let app: FastifyInstance;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'jobpilot-test-'));
  // A fixed clock, deliberately different from the date the sample data pins.
  store = new DataStore({ home, sampleDir: SAMPLE_DIR, now: () => new Date(2027, 2, 4, 10, 0, 0) });
  app = await buildApp(store, { version: '9.9.9' });
});

afterEach(async () => {
  await app.close();
  await store.close();
  rmSync(home, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers: { ...HOST, ...headers } });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: payload as object, headers: { ...HOST, ...headers } });

describe('read endpoints on the sample data', () => {
  it('GET /api/health describes the instance', async () => {
    const body = HealthSchema.parse((await get('/api/health')).json());
    expect(body).toMatchObject({ name: 'jobpilot', version: '9.9.9', demo: true, today: '2026-11-15' });
    expect(body.files.applicationsLog).toContain('sample-data');
  });

  it('GET /api/today returns the morning panel', async () => {
    const today = TodaySchema.parse((await get('/api/today')).json());
    expect(today.followUpsDue.map((f) => f.application.company)).toEqual(['Hexa Staffing', 'Lumen Freight', 'Fjordbyte']);
    expect(today.staleConnects).toHaveLength(3);
    expect(today.needs).toHaveLength(4);
    expect(today.hygiene.map((h) => h.company)).toEqual(['Carpathia Soft', 'Windmolen AI']);
    expect(today.batch?.date).toBe('2026-11-15');
  });

  it('GET /api/applications filters by status, text and company', async () => {
    const all = (await get('/api/applications')).json<{ applications: Application[] }>();
    expect(all.applications).toHaveLength(41);
    const rejected = (await get('/api/applications?status=rejected')).json<{ applications: Application[] }>();
    expect(rejected.applications).toHaveLength(12);
    const text = (await get('/api/applications?q=teamtailor')).json<{ applications: Application[] }>();
    expect(text.applications.length).toBeGreaterThan(3);
    const company = (await get('/api/applications?company=Polder%20Systems%20B.V.')).json<{ applications: Application[] }>();
    expect(company.applications.map((a) => a.role)).toEqual(['Backend Engineer', 'Software Test Engineer - Motion Control']);
    expect((await get('/api/applications?status=nonsense')).statusCode).toBe(400);
  });

  it('GET /api/stats matches the schema', async () => {
    const stats = StatsSchema.parse((await get('/api/stats')).json());
    expect(stats.total).toBe(36);
    expect(stats.byChannel.length).toBeGreaterThan(4);
  });

  it('GET /api/search finds text across logs', async () => {
    const body = (await get('/api/search?q=aurora%20pay')).json<{ hits: Array<{ type: string }> }>();
    expect(new Set(body.hits.map((h) => h.type))).toEqual(new Set(['application', 'message', 'batch', 'needs']));
    expect((await get('/api/search')).json<{ hits: unknown[] }>().hits).toEqual([]);
  });

  it('GET /api/companies/:name gathers a company page', async () => {
    const page = (await get('/api/companies/skerry%20labs')).json<{ name: string; applications: unknown[]; messages: unknown[] }>();
    expect(page).toMatchObject({ name: 'Skerry Labs' });
    expect(page.applications).toHaveLength(2);
    expect(page.messages).toHaveLength(1);
    expect((await get('/api/companies/nobody-here')).statusCode).toBe(404);
    expect((await get('/api/companies')).json<{ companies: unknown[] }>().companies.length).toBeGreaterThan(20);
  });

  it('GET /api/batches lists and returns batches', async () => {
    const list = (await get('/api/batches')).json<{ batches: Array<{ date: string }> }>();
    expect(list.batches.map((b) => b.date)).toEqual(['2026-11-15', '2026-11-14', '2026-11-13']);
    expect((await get('/api/batches/2026-11-14')).json<{ title: string }>().title).toContain('14 Nov 2026');
    expect((await get('/api/batches/1999-01-01')).statusCode).toBe(404);
  });
});

describe('extension lookup', () => {
  it('reports earlier applications and the profile', async () => {
    const response = await send('POST', '/api/lookup', { company: 'Polder Systems B.V.', url: 'https://job-boards.greenhouse.io/poldersystems/jobs/6237000333' });
    const body = LookupResponseSchema.parse(response.json());
    expect(body.matches.map((m) => m.application.status)).toEqual(['waiting', 'rejected']);
    expect(body.shortlisted).toBe(false);
    expect(body.profile.maxYears).toBe(5);
  });

  it('recognises the exact posting by job id', async () => {
    const response = await send('POST', '/api/lookup', { company: '', url: 'https://www.linkedin.com/jobs/view/4490011223/' });
    expect(LookupResponseSchema.parse(response.json()).matches[0]).toMatchObject({ reason: 'job_id' });
  });

  it('rejects a malformed body', async () => {
    expect((await send('POST', '/api/lookup', { company: 42 })).statusCode).toBe(400);
  });
});

describe('shortlist', () => {
  const posting = { title: 'Python Engineer', company: 'Tidewater Labs', location: 'Gothenburg', url: 'https://jobs.tidewaterlabs.example/jobs/9911#apply', source: 'greenhouse' };

  it('adds, deduplicates by URL, lists and removes', async () => {
    const created = await send('POST', '/api/shortlist', posting);
    expect(created.statusCode).toBe(201);
    const { item } = created.json<{ item: ShortlistItem }>();
    expect(item).toMatchObject({ company: 'Tidewater Labs', companyKey: 'tidewater labs', url: 'https://jobs.tidewaterlabs.example/jobs/9911' });

    const again = await send('POST', '/api/shortlist', posting);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ created: boolean }>().created).toBe(false);

    const list = (await get('/api/shortlist')).json<{ items: ShortlistItem[]; file: string }>();
    expect(list.items).toHaveLength(1);
    expect(JSON.parse(readFileSync(list.file, 'utf8'))).toHaveLength(1);

    const lookup = LookupResponseSchema.parse((await send('POST', '/api/lookup', { company: 'Tidewater Labs', url: posting.url })).json());
    expect(lookup.shortlisted).toBe(true);

    expect((await send('DELETE', `/api/shortlist/${item.id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `/api/shortlist/${item.id}`)).statusCode).toBe(404);
    expect((await get('/api/shortlist')).json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('validates input', async () => {
    const bad = await send('POST', '/api/shortlist', { title: '', company: 'X', url: 'not a url' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ issues: Array<{ path: string }> }>().issues.map((i) => i.path).sort()).toEqual(['title', 'url']);
  });
});

describe('local-only guarantees', () => {
  it('refuses requests addressed to another host name (DNS rebinding)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/today', headers: { host: 'evil.example' } });
    expect(response.statusCode).toBe(403);
  });

  it('refuses writes from an unknown website, but accepts the extension and the dashboard', async () => {
    const body = { id: 'need-1', checked: true };
    expect((await send('PUT', '/api/checks', body, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await send('PUT', '/api/checks', body, { origin: 'chrome-extension://abcdefghijklmnop' })).statusCode).toBe(200);
    expect((await send('PUT', '/api/checks', body, { origin: 'http://127.0.0.1:47321' })).statusCode).toBe(200);
    expect((await send('PUT', '/api/checks', body)).statusCode).toBe(200);
  });

  it('does not grant CORS to unknown origins', async () => {
    const evil = await get('/api/today', { origin: 'https://evil.example' });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const extension = await get('/api/today', { origin: 'chrome-extension://abcdefghijklmnop' });
    expect(extension.headers['access-control-allow-origin']).toBe('chrome-extension://abcdefghijklmnop');
  });

  it('knows which origins are local', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('https://127.0.0.1.evil.example')).toBe(false);
    expect(isAllowedOrigin('https://app.example', ['https://app.example'])).toBe(true);
  });
});

describe('state and settings', () => {
  it('remembers ticked items across restarts without touching the logs', async () => {
    await send('PUT', '/api/checks', { id: 'need-abc', checked: true });
    const reopened = new DataStore({ home, sampleDir: SAMPLE_DIR });
    expect(reopened.checkedIds).toEqual(['need-abc']);
    await reopened.close();
    await send('PUT', '/api/checks', { id: 'need-abc', checked: false });
    expect((await get('/api/today')).json<{ checked: string[] }>().checked).toEqual([]);
  });

  it('switches from the sample to real files and back', async () => {
    const data = mkdtempSync(join(tmpdir(), 'jobpilot-data-'));
    const log = join(data, 'applications_log.md');
    writeFileSync(log, '## Waiting\n\n| Applied | Company | Role | Location | CV / channel | What happened |\n|---|---|---|---|---|---|\n| 1 Nov 2026 | Real Co | Dev | Oslo | Email | Sent |\n');

    const updated = await send('PUT', '/api/settings', { applicationsLog: log });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ paths: { demo: boolean } }>().paths.demo).toBe(false);
    const apps = (await get('/api/applications')).json<{ applications: Application[] }>().applications;
    expect(apps.map((a) => a.company)).toEqual(['Real Co']);
    // With real files configured, the clock is the real clock again.
    expect(HealthSchema.parse((await get('/api/health')).json()).today).toBe('2027-03-04');

    await send('PUT', '/api/settings', { applicationsLog: '' });
    expect((await get('/api/applications')).json<{ applications: Application[] }>().applications).toHaveLength(41);
    rmSync(data, { recursive: true, force: true });
  });

  it('rejects invalid settings', async () => {
    expect((await send('PUT', '/api/settings', { applicationsLog: 'relative/path.md' })).statusCode).toBe(400);
    expect((await send('PUT', '/api/settings', { followUpMinDays: -3 })).statusCode).toBe(400);
    expect((await send('PUT', '/api/settings', { morningNotification: '25:99' })).statusCode).toBe(400);
  });

  it('reports a missing file as a warning instead of failing', async () => {
    await send('PUT', '/api/settings', { applicationsLog: join(home, 'does-not-exist.md') });
    expect((await get('/api/applications')).json<{ applications: unknown[] }>().applications).toEqual([]);
    const warnings = (await get('/api/warnings')).json<{ warnings: Array<{ message: string }> }>().warnings;
    expect(warnings[0]!.message).toMatch(/Could not read file: ENOENT/);
  });
});

describe('the logs stay read-only', () => {
  let work: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'jobpilot-ro-'));
    cpSync(SAMPLE_DIR, join(work, 'sample-data'), { recursive: true });
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('never modifies the Markdown files, whatever the API is asked to do', async () => {
    const dir = join(work, 'sample-data');
    const files = ['applications_log.md', 'outreach_log.md', join('daily_batches', 'batch_2026-11-15.md')];
    const before = files.map((f) => readFileSync(join(dir, f), 'utf8'));
    const roStore = new DataStore({ home: join(work, 'home'), sampleDir: dir });
    const roApp = await buildApp(roStore);
    const call = (method: 'POST' | 'PUT', url: string, payload: object) => roApp.inject({ method, url, payload, headers: HOST });
    await call('POST', '/api/shortlist', { title: 'T', company: 'C', url: 'https://c.example/job/1' });
    await call('PUT', '/api/checks', { id: 'x', checked: true });
    await call('PUT', '/api/settings', { staleConnectDays: 20 });
    await call('POST', '/api/reload', {});
    expect(files.map((f) => readFileSync(join(dir, f), 'utf8'))).toEqual(before);
    await roApp.close();
    await roStore.close();
  });
});

describe('startServer', () => {
  it('listens on loopback, serves the API and reloads when a log changes', async () => {
    const work = mkdtempSync(join(tmpdir(), 'jobpilot-live-'));
    const dir = join(work, 'sample-data');
    cpSync(SAMPLE_DIR, dir, { recursive: true });
    const server = await startServer({ home: join(work, 'home'), sampleDir: dir, port: 0 });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.app.server.address()).toMatchObject({ address: '127.0.0.1' });
      const health = HealthSchema.parse(await (await fetch(`${server.url}/api/health`)).json());
      expect(health.demo).toBe(true);

      const changed = new Promise<void>((resolve) => server.store.once('change', () => resolve()));
      const log = join(dir, 'applications_log.md');
      // Give the watcher a moment to arm before the file changes.
      await new Promise((resolve) => setTimeout(resolve, 300));
      writeFileSync(log, readFileSync(log, 'utf8').replace('| 13 Nov 2026 | Northlight Robotics', '| 13 Nov 2026 | Renamed Robotics'));
      await changed;
      const apps = (await (await fetch(`${server.url}/api/applications?q=renamed`)).json()) as { applications: Application[] };
      expect(apps.applications.map((a) => a.company)).toEqual(['Renamed Robotics']);
    } finally {
      await server.close();
      rmSync(work, { recursive: true, force: true });
    }
  }, 15_000);
});
