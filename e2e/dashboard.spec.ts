import { expect, test } from '@playwright/test';

test('morning flow: today panel, tick a task, pipeline, company page, search', async ({ page }) => {
  await page.goto('/');

  // Today: the three follow-ups whose window is open on the sample's pinned date.
  await expect(page.getByRole('heading', { name: /Sun 15 Nov . Today/ })).toBeVisible();
  const followUps = page.locator('section', { has: page.getByRole('heading', { name: 'Follow-ups due' }) });
  await expect(followUps.getByRole('listitem')).toHaveCount(3);
  await expect(followUps).toContainText('Hexa Staffing');
  await expect(followUps).toContainText('last day');
  await expect(page.getByText('Demo mode')).toBeVisible();

  // Tick a "Needs you" item; the tick survives a reload (stored by JobPilot, not in the log).
  const task = page.getByRole('checkbox', { name: /Done: Aurora Pay: Lars Nyberg asked/ });
  await task.check();
  await page.reload();
  await expect(task).toBeChecked();
  await task.uncheck();
  await expect(task).not.toBeChecked();

  // Pipeline: filter, open a card, read its timeline.
  await page.getByRole('link', { name: 'Pipeline' }).click();
  await expect(page.getByRole('region', { name: 'Waiting' }).getByRole('listitem')).toHaveCount(14);
  await page.getByLabel('Filter cards').fill('marlin');
  const card = page.getByRole('button', { name: /Marlin Insurance Tech/ });
  await expect(card).toBeVisible();
  await card.click();
  const details = page.getByRole('complementary', { name: 'Application details' });
  await expect(details).toContainText('Rejected');
  await expect(details).toContainText(/3 Nov 2026 . 20:19/);

  // Company page: every application and message for one company.
  await page.getByLabel('Filter cards').fill('skerry');
  await page.getByRole('button', { name: /Skerry Labs/ }).first().click();
  await page.getByRole('complementary', { name: 'Application details' }).getByRole('link', { name: 'Skerry Labs' }).click();
  await expect(page.getByRole('heading', { name: 'Skerry Labs' })).toBeVisible();
  await expect(page.getByText('Petra Dahl').first()).toBeVisible();
  await expect(page.getByText('Not applied').first()).toBeVisible();

  // Search across every log.
  await page.getByRole('searchbox', { name: 'Search every log' }).fill('does not support relocation');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: /Brightwave Energy . Data Infrastructure Engineer/ })).toBeVisible();
});

test('stats page renders the weekly chart and the group tables', async ({ page }) => {
  await page.goto('/stats');
  await expect(page.getByRole('img', { name: /per week/ })).toBeVisible();
  await expect(page.getByText('Applications', { exact: true }).first()).toBeVisible();
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'By region' }) })).toContainText('Sweden');
  await expect(page.locator('.recharts-bar-rectangle path').first()).toBeVisible();
});

test('settings validate input and never leave demo mode on a bad path', async ({ page }) => {
  await page.goto('/settings');
  const field = page.getByPlaceholder('Absolute path, or empty for the sample data').first();
  await field.fill('relative/path.md');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('applicationsLog must be an absolute path')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Demo mode')).toBeVisible();
});

// README screenshots: `pnpm screenshots`. Always taken from the invented sample data.
test('capture README screenshots @screenshots', async ({ page }) => {
  test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to refresh docs/screenshots');
  const shot = async (name: string): Promise<void> => {
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `docs/screenshots/${name}.png` });
  };
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Follow-ups due' })).toBeVisible();
  await shot('today');

  await page.goto('/pipeline');
  await page.getByRole('button', { name: /Vattenkraft Data/ }).click();
  await shot('pipeline');

  await page.goto('/stats');
  await expect(page.locator('.recharts-bar-rectangle path').first()).toBeVisible();
  await shot('stats');

  await page.goto('/company/polder%20systems');
  await expect(page.getByRole('heading', { name: 'Polder Systems' })).toBeVisible();
  await shot('company');
});
