import { expect, test } from '@playwright/test';

test('generates and opens a project report without invoking DeepSeek', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('Report Center Smoke');
  await page.getByLabel('slug').fill(`report-center-${suffix}`);
  await page.getByLabel('主域名').fill(`report-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('STANDARD');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/reports`);
  await expect(page.getByRole('heading', { level: 1, name: '报告中心' })).toBeVisible();
  await page.getByRole('button', { name: '生成项目报告' }).click();
  await expect(page.getByRole('table').getByText('PROJECT_REPORT_V1', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看报告' }).first().click();
  await expect(page.getByText('确定性事实', { exact: true })).toBeVisible();
  await expect(page.getByText('AI 建议 / Executive Summary', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '报告' })).toHaveClass(/active/);
});
