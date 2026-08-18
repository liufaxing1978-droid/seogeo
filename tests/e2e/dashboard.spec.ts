import { expect, test } from '@playwright/test';

test('renders the approved P0 dashboard shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('SEO GEO', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('AI Visibility', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('高级版', { exact: true }).first()).toBeVisible();

  for (const metric of ['SEO Score','GEO Score','AI Visibility','Citability','Entity Authority','AI Citations','Brand Mentions','Critical Issues']) {
    await expect(page.getByText(metric, { exact: true }).first()).toBeVisible();
  }
});
