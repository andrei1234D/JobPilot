/**
 * Public surface of the server package. The standalone entry (`main.ts`) and the
 * Electron shell both go through `startServer`, so there is one way to boot.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_HOST, DEFAULT_PORT } from '@jobpilot/shared';
import { buildApp, type AppOptions } from './app';
import { DataStore, type StoreOptions } from './store';

export { buildApp, isAllowedOrigin, type AppOptions } from './app';
export { DataStore, type Loaded, type ResolvedPaths, type StoreOptions } from './store';

/** Where JobPilot keeps its own files: %APPDATA%\JobPilot on Windows, ~/.config/jobpilot elsewhere. */
export function defaultHome(): string {
  if (process.env.JOBPILOT_HOME) return process.env.JOBPILOT_HOME;
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'JobPilot');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'jobpilot');
}

export interface StartOptions extends AppOptions, Omit<StoreOptions, 'home'> {
  home?: string;
  port?: number;
  /** Watch the log files and reload on change. Default true. */
  watch?: boolean;
}

export interface RunningServer {
  app: FastifyInstance;
  store: DataStore;
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Thrown when the port is taken by another JobPilot, so callers can simply open that one. */
export class AlreadyRunningError extends Error {
  constructor(readonly url: string) {
    super(`JobPilot is already running at ${url}`);
    this.name = 'AlreadyRunningError';
  }
}

async function isJobPilot(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await response.json()) as { name?: string };
    return body.name === 'jobpilot';
  } catch {
    return false;
  }
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.JOBPILOT_PORT ?? DEFAULT_PORT);
  const url = `http://${DEFAULT_HOST}:${port}`;
  const store = new DataStore({ home: options.home ?? defaultHome(), sampleDir: options.sampleDir, now: options.now, today: options.today });
  const app = await buildApp(store, options);

  try {
    // Loopback only: the data never leaves this machine.
    await app.listen({ host: DEFAULT_HOST, port });
  } catch (error) {
    await app.close();
    await store.close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && (await isJobPilot(url))) throw new AlreadyRunningError(url);
    throw error;
  }

  if (options.watch !== false) store.watch();
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    app,
    store,
    port: actualPort,
    url: `http://${DEFAULT_HOST}:${actualPort}`,
    close: async () => {
      await app.close();
      await store.close();
    },
  };
}
