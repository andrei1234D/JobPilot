/**
 * Standalone entry: `pnpm start` (or `tsx apps/server/src/main.ts --open`).
 * Serves the API and, when it has been built, the dashboard on http://127.0.0.1:47321.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlreadyRunningError, startServer } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const version = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;

function openInBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

const wantsBrowser = process.argv.includes('--open');

try {
  const server = await startServer({
    sampleDir: process.env.JOBPILOT_SAMPLE_DIR ?? join(repoRoot, 'sample-data'),
    webDir: process.env.JOBPILOT_WEB_DIR ?? join(repoRoot, 'apps', 'web', 'dist'),
    version,
  });
  const { demo, applicationsLog } = server.store.paths;
  console.info(`JobPilot ${version} listening on ${server.url}`);
  console.info(demo ? 'Using the bundled sample data. Set your own paths in Settings.' : `Reading ${applicationsLog}`);
  if (wantsBrowser) openInBrowser(server.url);

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  if (error instanceof AlreadyRunningError) {
    console.info(error.message);
    if (wantsBrowser) openInBrowser(error.url);
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
}
