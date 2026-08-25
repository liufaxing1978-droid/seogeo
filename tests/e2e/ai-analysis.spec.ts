import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('opens the Standard-plan DeepSeek AI Analysis Center without invoking a provider', async ({ page, context }) => {
  await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'STANDARD',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('AI Analysis Smoke');
  await page.getByLabel('slug').fill(`ai-analysis-${suffix}`);
  await page.getByLabel('主域名').fill(`ai-analysis-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('STANDARD');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectUrl = new URL(page.url());
  const projectId = projectUrl.pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/ai`);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: 'DeepSeek AI 分析中心' })
  ).toBeVisible();
  await expect(page.getByText('AI 只分析已保存事实')).toBeVisible();
  await expect(page.getByText(/P6 高级版/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'DeepSeek 分析中心' })).toHaveClass(/active/);
  await expect(page.getByText('尚无 AI 分析任务')).toBeVisible();
});
