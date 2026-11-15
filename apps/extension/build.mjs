// Builds the extension into dist/, ready for chrome://extensions -> "Load unpacked".
// Each entry is bundled into one self-contained file: content scripts cannot use ES module imports.
//
//   node build.mjs                 production build
//   node build.mjs --watch         rebuild on change
//   node build.mjs --e2e --port=47399 --out=dist-e2e   build used by the Playwright test
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const watch = process.argv.includes('--watch');
const e2e = process.argv.includes('--e2e');
const port = Number(arg('port', '47321'));
const out = join(here, arg('out', 'dist'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(here, 'static'), out, { recursive: true });

// The manifest grants access to exactly one origin: the local JobPilot server.
const manifest = JSON.parse(readFileSync(join(here, 'static', 'manifest.json'), 'utf8'));
manifest.host_permissions = [`http://127.0.0.1:${port}/*`];
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const ctx = await context({
  absWorkingDir: here,
  entryPoints: { content: 'src/content.ts', background: 'src/background.ts', popup: 'src/popup.tsx' },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    __JOBPILOT_PORT__: String(port),
    // The test build opens the panel's shadow root so the test can read it.
    __E2E__: String(e2e),
  },
  legalComments: 'none',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes. Reload the extension in chrome://extensions after each build.');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
