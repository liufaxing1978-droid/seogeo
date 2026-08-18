import { expect, test } from '@playwright/test';

test('opens GEO overview with factual empty state', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('GEO E2E Project');
  await page.getByLabel('slug').fill(`geo-e2e-${suffix}`);
  await page.getByLabel('主域名').fill(`geo-e2e-${suffix}.example.com`);
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectUrl = new URL(page.url());
  const projectId = projectUrl.pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/geo`);
  await expect(page.getByRole('heading', { level: 1, name: 'GEO Readiness' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '尚无 GEO 审计' })).toBeVisible();
  await expect(page.getByText('AI Visibility', { exact: true })).toBeVisible();
  await expect(page.getByText('等待 P6 真实采样')).toBeVisible();
});
