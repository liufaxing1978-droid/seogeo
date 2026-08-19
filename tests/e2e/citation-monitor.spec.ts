import { expect, test } from '@playwright/test';

test('opens Citation Monitor, configures owned subject, and keeps P6-C metrics disabled', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('Citation Monitor Smoke');
  await page.getByLabel('slug').fill(`citation-monitor-${suffix}`);
  await page.getByLabel('主域名').fill(`citation-monitor-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('ADVANCED');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectUrl = new URL(page.url());
  const projectId = projectUrl.pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/visibility/citations`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Citation 监控' })).toBeVisible();
  await expect(page.getByText('UNKNOWN 与 NOT_ELIGIBLE 不等于零', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Citation 监控' })).toHaveClass(/active/);
  await expect(page.getByText('Mention Rate')).toHaveCount(0);
  await expect(page.getByText('Citation Rate')).toHaveCount(0);
  await expect(page.getByText('Share of Voice')).toHaveCount(0);

  await page.getByRole('link', { name: '监控主体' }).first().click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '监控主体' })).toBeVisible();
  await expect(page.getByText(`citation-monitor-${suffix}.example.com`, { exact: true })).toBeVisible();

  await page.getByLabel('类型').first().selectOption('OWNED_BRAND');
  await page.getByLabel('Canonical Value').fill('兴善堂');
  await page.getByRole('button', { name: '新增主体' }).click();
  await expect(page.getByText('兴善堂', { exact: true })).toBeVisible();

  const row = page.locator('tr').filter({ hasText: '兴善堂' }).first();
  await row.getByLabel('Alias').fill('Xingshantang');
  await row.getByLabel('类型').selectOption('NAME');
  await row.getByRole('button', { name: '添加 Alias' }).click();
  await expect(page.getByText('Xingshantang', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Citation 监控' }).click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Citation 监控' })).toBeVisible();
  await expect(page.getByText('P6-C 指标（未启用）')).toBeVisible();
});
