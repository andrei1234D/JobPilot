import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseApplicationsLog, parseBatch, parseOutreachLog, type Application, type Batch } from '../src';

export const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'sample-data');
export const TODAY = '2026-11-15';

export function loadSample() {
  const applications = parseApplicationsLog(readFileSync(join(SAMPLE_DIR, 'applications_log.md'), 'utf8'), { referenceYear: 2026 });
  const outreach = parseOutreachLog(readFileSync(join(SAMPLE_DIR, 'outreach_log.md'), 'utf8'), { referenceYear: 2026 });
  const batchDir = join(SAMPLE_DIR, 'daily_batches');
  const batches: Batch[] = readdirSync(batchDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseBatch(readFileSync(join(batchDir, name), 'utf8'), name));
  return { applications, outreach, batches };
}

/** Builds one application through the real parser, so tests exercise the same code path as production. */
export function app(row: { applied?: string; company?: string; role?: string; location?: string; channel?: string; history?: string }, section = 'Waiting for a reply'): Application {
  const cells = [row.applied ?? '5 Nov 2026', row.company ?? 'Acme', row.role ?? 'Engineer', row.location ?? 'Utrecht', row.channel ?? 'Email', row.history ?? 'Sent'];
  const markdown = `## ${section}\n\n| Applied | Company | Role | Location | CV / channel | What happened |\n|---|---|---|---|---|---|\n| ${cells.join(' | ')} |\n`;
  const parsed = parseApplicationsLog(markdown, { referenceYear: 2026 });
  const first = parsed.applications[0];
  if (!first) throw new Error('test row did not parse');
  return first;
}
