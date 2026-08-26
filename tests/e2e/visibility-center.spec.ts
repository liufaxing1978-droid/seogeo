import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('opens Advanced AI Visibility, configures Prompt Monitor, and leaves sampling run empty', async ({ page, context }) => {
  await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ADVANCED',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('AI Visibility Smoke');
  await page.getByLabel('slug').fill(`ai-visibility-${suffix}`);
  await page.getByLabel('主域名').fill(`ai-visibility-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('ADVANCED');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectUrl = new URL(page.url());
  const projectId = projectUrl.pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/visibility`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'AI Visibility' })).toBeVisible();
  await expect(page.getByText('API 采样', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /AI Visibility/ })).toHaveClass(/active/);
  await expect(page.getByRole('link', { name: 'Visibility 指标' })).toBeVisible();
  await expect(page.getByText('ChatGPT 网页端排名')).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Mention Rate')).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Citation Rate')).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Share of Voice')).toHaveCount(0);

  await page.getByRole('link', { name: 'Prompt 监控' }).click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Prompt 监控' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Prompt 监控' })).toHaveClass(/active/);

  await page.getByLabel('Prompt Set 名称').fill('Unbranded discovery');
  await page.getByLabel('默认语言').fill('en-US');
  await page.getByLabel('默认国家').fill('US');
  await page.getByRole('button', { name: '创建 Prompt Set' }).click();
  await expect(page.getByText('Unbranded discovery')).toBeVisible();

  await page.locator('#prompt-set').selectOption({ label: 'Unbranded discovery' });
  await page.getByLabel('Prompt Key').fill('discovery');
  await page.getByLabel('Prompt 文本').fill('Which websites explain Chinese folk religious traditions well?');
  await page.getByRole('button', { name: '创建 Prompt 版本' }).click();

  await expect(page.getByText('Which websites explain Chinese folk religious traditions well?')).toBeVisible();
  await expect(page.getByText('v1')).toBeVisible();

  // Configuration is not sampling: returning to the overview must still show no run was created.
  await page.getByRole('link', { name: '返回 AI Visibility' }).click();
  await expect(page.getByText('尚无采样运行。先在 Prompt 监控建立版本化 Prompt，再通过受控 API 发起采样。')).toBeVisible();
});
