import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('opens Standard-plan Content Center without invoking AI or network refresh', async ({ page, context }) => {
  await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'STANDARD',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('Content Intelligence Smoke');
  await page.getByLabel('slug').fill(`content-intelligence-${suffix}`);
  await page.getByLabel('主域名').fill(`content-intelligence-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('STANDARD');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectUrl = new URL(page.url());
  const projectId = projectUrl.pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/content`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '内容中心' })).toBeVisible();
  await expect(page.getByText('确定性事实优先')).toBeVisible();
  await expect(page.getByRole('link', { name: '内容与发布', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText(/尚无内容事实/)).toBeVisible();
});
