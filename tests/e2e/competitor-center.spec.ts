import { expect, test } from '@playwright/test';

test('registers a competitor from the project-scoped competitor center', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('Competitor Center Smoke');
  await page.getByLabel('slug').fill(`competitor-center-${suffix}`);
  await page.getByLabel('主域名').fill(`owned-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('STANDARD');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/competitors`);
  await expect(page.getByRole('heading', { level: 1, name: '竞争对手中心' })).toBeVisible();
  await page.getByLabel('竞品名称').fill('Reference Site');
  await page.getByLabel('竞品域名').fill(`reference-${suffix}.example.com`);
  await page.getByRole('button', { name: '添加竞品' }).click();

  await expect(page.getByText('Reference Site')).toBeVisible();
  await expect(page.getByText(`reference-${suffix}.example.com`)).toBeVisible();
  await expect(page.getByRole('link', { name: '竞争对手' })).toHaveClass(/active/);
});
