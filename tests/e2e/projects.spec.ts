import { expect, test } from '@playwright/test';

test('creates a project from the web UI', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('Example Project');
  await page.getByLabel('slug').fill(`example-${suffix}`);
  await page.getByLabel('主域名').fill(`example-${suffix}.com`);
  await page.getByLabel('套餐').selectOption('ADVANCED');
  await page.getByRole('button', { name: '创建项目' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Example Project' })).toBeVisible();
  await expect(page.getByText(`example-${suffix}.com`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('ADVANCED', { exact: true }).first()).toBeVisible();
});
