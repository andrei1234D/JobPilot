/**
 * The HTTP API. Local-only by construction:
 *
 * - the listener binds to 127.0.0.1 (see `startServer`);
 * - the Host header must be a loopback name, which defeats DNS rebinding;
 * - browsers may call it only from the dashboard itself or from a browser
 *   extension (Origin allowlist), so a random website cannot read the data
 *   or add to the shortlist.
 */
import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  LookupRequestSchema,
  STATUSES,
  ShortlistInputSchema,
  buildCompanyPage,
  buildToday,
  computeStats,
  isRepeat,
  listCompanies,
  matchCompany,
  search,
  summariseBatch,
  type Health,
  type LookupResponse,
  type Status,
} from '@jobpilot/shared';
import { ZodError, z } from 'zod';
import type { DataStore } from './store';

export interface AppOptions {
  /** Folder with the built dashboard (apps/web/dist). When missing, only the API is served. */
  webDir?: string | null;
  version?: string;
  /** Extra origins allowed to call the API (the Vite dev server is always allowed). */
  allowedOrigins?: string[];
  logger?: boolean;
}

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//i;
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function isAllowedOrigin(origin: string | undefined, extra: readonly string[] = []): boolean {
  if (!origin) return true; // same-origin navigation, curl, the desktop shell
  return EXTENSION_ORIGIN.test(origin) || LOOPBACK_ORIGIN.test(origin) || extra.includes(origin);
}

function badRequest(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: 'Invalid request', issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid request' });
}

export async function buildApp(store: DataStore, options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 });
  const version = options.version ?? '0.0.0';
  const extraOrigins = options.allowedOrigins ?? [];

  await app.register(cors, {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin, extraOrigins)),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!LOOPBACK_HOST.test(request.headers.host ?? '')) {
      return reply.code(403).send({ error: 'JobPilot only answers on localhost' });
    }
    const origin = request.headers.origin;
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS' && !isAllowedOrigin(origin, extraOrigins)) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
  });

  const dataset = () => store.data;

  // ---------------------------------------------------------------- reads

  app.get('/api/health', async (): Promise<Health> => {
    const paths = store.paths;
    return {
      ok: true,
      name: 'jobpilot',
      version,
      demo: paths.demo,
      today: store.today(),
      files: { applicationsLog: paths.applicationsLog, outreachLog: paths.outreachLog, batchesDir: paths.batchesDir },
      loadedAt: store.data.loadedAt,
      warnings: store.data.warnings.length,
    };
  });

  app.get('/api/today', async () =>
    buildToday(dataset(), store.today(), store.settings, { demo: store.paths.demo, checked: store.checkedIds }),
  );

  app.get('/api/applications', async (request, reply) => {
    const query = z
      .object({ status: z.enum(STATUSES).optional(), q: z.string().max(200).optional(), company: z.string().max(200).optional() })
      .safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);
    let applications = dataset().applications;
    if (query.data.status) applications = applications.filter((a) => a.status === (query.data.status as Status));
    if (query.data.company) applications = applications.filter((a) => matchCompany(query.data.company!, a.company) !== null);
    if (query.data.q) {
      const needle = query.data.q.toLowerCase();
      applications = applications.filter((a) => `${a.company} ${a.role} ${a.location} ${a.channelRaw} ${a.history}`.toLowerCase().includes(needle));
    }
    return { applications, notes: dataset().notes };
  });

  app.get('/api/stats', async () => computeStats(dataset().applications));

  app.get('/api/search', async (request, reply) => {
    const query = z.object({ q: z.string().max(200).default('') }).safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);
    const data = dataset();
    const hits = search(
      { applications: data.applications, messages: data.outreach.messages, connections: data.outreach.connections, batches: data.batches, needs: data.needs },
      query.data.q,
    );
    return { query: query.data.q, hits };
  });

  app.get('/api/companies', async () => ({ companies: listCompanies(dataset().applications) }));

  app.get<{ Params: { name: string } }>('/api/companies/:name', async (request, reply) => {
    const page = buildCompanyPage(dataset(), request.params.name);
    return page ?? reply.code(404).send({ error: `Nothing known about "${request.params.name}"` });
  });

  app.get('/api/outreach', async () => ({
    messages: dataset().outreach.messages,
    connections: dataset().outreach.connections,
    notes: dataset().outreach.notes,
  }));

  app.get('/api/batches', async () => ({
    batches: [...dataset().batches].sort((a, b) => b.date.localeCompare(a.date)).map(summariseBatch),
  }));

  app.get<{ Params: { date: string } }>('/api/batches/:date', async (request, reply) => {
    const batch = dataset().batches.find((b) => b.date === request.params.date);
    return batch ?? reply.code(404).send({ error: `No batch for ${request.params.date}` });
  });

  app.get('/api/warnings', async () => ({ warnings: dataset().warnings }));

  // ------------------------------------------------- extension: lookup

  app.post('/api/lookup', async (request, reply): Promise<LookupResponse | FastifyReply> => {
    const body = LookupRequestSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    const { company, url } = body.data;
    const data = dataset();
    const matches = isRepeat(company, data.applications, url);
    const cleanUrl = url.split('#')[0];
    return {
      company,
      matches: matches.slice(0, 20),
      shortlisted: data.shortlist.some((item) => item.url === cleanUrl),
      profile: store.settings.profile,
    };
  });

  // ------------------------------------------------------------ shortlist

  app.get('/api/shortlist', async () => ({ items: dataset().shortlist, file: store.paths.shortlistFile }));

  app.post('/api/shortlist', async (request, reply) => {
    const body = ShortlistInputSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    const result = store.addToShortlist(body.data);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/shortlist/:id', async (request, reply) =>
    store.removeFromShortlist(request.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'Not on the shortlist' }),
  );

  // ------------------------------------------------------- settings, state

  app.get('/api/settings', async () => ({ settings: store.settings, paths: store.paths, settingsFile: store.settingsFile }));

  app.put('/api/settings', async (request, reply) => {
    try {
      const settings = store.updateSettings(request.body);
      return { settings, paths: store.paths, settingsFile: store.settingsFile };
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.put('/api/checks', async (request, reply) => {
    const body = z.object({ id: z.string().min(1).max(120), checked: z.boolean() }).safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    return { checked: store.setChecked(body.data.id, body.data.checked) };
  });

  app.post('/api/reload', async () => {
    store.reload();
    return { loadedAt: store.data.loadedAt };
  });

  // ------------------------------------- live updates (server-sent events)

  app.get('/api/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...(request.headers.origin && isAllowedOrigin(request.headers.origin, extraOrigins) ? { 'Access-Control-Allow-Origin': request.headers.origin } : {}),
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ loadedAt: store.data.loadedAt })}\n\n`);
    const onChange = (): void => {
      reply.raw.write(`event: change\ndata: ${JSON.stringify({ loadedAt: store.data.loadedAt })}\n\n`);
    };
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    store.on('change', onChange);
    request.raw.on('close', () => {
      clearInterval(ping);
      store.off('change', onChange);
    });
  });

  // ------------------------------------------------------- the dashboard

  const webDir = options.webDir;
  if (webDir && existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.get('/', async (_request, reply) =>
      reply.type('text/html').send('<h1>JobPilot API</h1><p>The dashboard is not built. Run <code>pnpm --filter @jobpilot/web build</code>, or use <code>pnpm dev</code>.</p>'),
    );
  }

  return app;
}
