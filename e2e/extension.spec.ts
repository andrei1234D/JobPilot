import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

// Loads the real, built extension into Chromium and opens a (fake) job posting.
// The posting page is served from a route, so the test never touches the network;
// the extension talks to the same test server as the dashboard tests.
const extensionDir = resolve('apps/extension/dist-e2e');

const POSTING = `<!doctype html><html><head><title>Platform Engineer - Polder Systems</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Senior Platform Engineer',
  hiringOrganization: { '@type': 'Organization', name: 'Polder Systems B.V.' },
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Amsterdam', addressCountry: 'NL' } },
  description:
    '<p>Polder Systems builds planning software for water boards. We are looking for a senior engineer for our platform team.</p><ul><li>5+ years of experience running production systems</li><li>Fluent Dutch is required, because our customers are Dutch municipalities</li><li>Python, Terraform and CI pipelines</li></ul><p>Hybrid, three days a week in our Amsterdam office.</p>',
})}</script></head><body><h1>Senior Platform Engineer</h1><p>Polder Systems, Amsterdam</p></body></html>`;

let context: BrowserContext;

test.beforeAll(async () => {
  execFileSync(process.execPath, ['apps/extension/build.mjs', '--e2e', '--port=47399', '--out=dist-e2e'], { stdio: 'ignore' });
  // Extensions need the bundled Chromium ("chromium" channel = new headless mode, which supports them).
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  await context.route('https://job-boards.greenhouse.io/**', (route) => route.fulfill({ contentType: 'text/html', body: POSTING }));
});

test.afterAll(async () => {
  await context?.close();
});

test('on a posting: earlier applications, red flags, and quick-add to the shortlist', async ({ request }) => {
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/poldersystems/jobs/6237000333');

  const panel = page.locator('#jobpilot-panel-host');
  await expect(panel.getByText('Polder Systems B.V. · Senior Platform Engineer')).toBeVisible();

  // Seen before? Two earlier applications to this company in the sample log.
  await expect(panel.locator('.pill.waiting')).toHaveText('Waiting');
  await expect(panel.locator('.pill.rejected')).toHaveText('Rejected');
  await expect(panel.getByText('Software Test Engineer - Motion Control')).toBeVisible();

  // Red flags, each with the sentence that triggered it.
  await expect(panel.getByText('Dutch required')).toBeVisible();
  await expect(panel.getByText('5+ years of experience asked')).toBeVisible();
  await expect(panel.getByText('Senior-level title ("Senior")')).toBeVisible();
  await expect(panel.getByText(/because our customers are Dutch municipalities/)).toBeVisible();

  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'docs/screenshots/extension.png' });

  // Quick add writes to the shortlist through the local server.
  await panel.getByRole('button', { name: 'Save to shortlist' }).click();
  await expect(panel.getByRole('button', { name: 'On your shortlist ✓' })).toBeDisabled();
  const shortlist = (await (await request.get('/api/shortlist')).json()) as { items: Array<{ id: string; company: string; url: string; flags: unknown[] }> };
  const saved = shortlist.items.find((item) => item.url === 'https://job-boards.greenhouse.io/poldersystems/jobs/6237000333');
  expect(saved).toMatchObject({ company: 'Polder Systems B.V.' });
  expect(saved!.flags.length).toBeGreaterThanOrEqual(3);

  // The panel collapses to a chip and can be dismissed.
  await panel.getByRole('button', { name: /JobPilot/ }).first().click();
  await expect(panel.getByText('Seen before?')).toBeHidden();
  await panel.getByRole('button', { name: 'Hide JobPilot on this page' }).click();
  await expect(panel).toHaveCount(0);

  await request.delete(`/api/shortlist/${saved!.id}`);
  await page.close();
});

test('stays out of the way on pages that are not a posting', async () => {
  const page = await context.newPage();
  await page.goto('https://job-boards.greenhouse.io/poldersystems');
  await page.waitForTimeout(1500);
  await expect(page.locator('#jobpilot-panel-host')).toHaveCount(0);
  await page.close();
});
