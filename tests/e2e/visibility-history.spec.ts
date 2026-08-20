import { expect, test } from '@playwright/test';

test('navigates P6-D history and alerts without triggering sampling', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('P6-D History Smoke');
  await page.getByLabel('slug').fill(`p6d-history-${suffix}`);
  await page.getByLabel('主域名').fill(`p6d-history-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('ADVANCED');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/visibility/history`);
  await expect(page.getByRole('heading', { level: 1, name: 'Visibility 历史趋势' })).toBeVisible();
  await expect(page.getByText('尚无可比前序快照')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Visibility 历史' })).toHaveClass(/active/);

  await page.getByRole('link', { name: '告警', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Visibility 告警' })).toBeVisible();
  await expect(page.getByText('V1 为站内告警，不宣称外部通知投递。')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Visibility 告警' })).toHaveClass(/active/);

  await page.getByLabel('名称').fill('Owned mention smoke');
  await page.getByLabel('规则类型').selectOption('OWNED_MENTION_RATE_DROP');
  await page.getByLabel('阈值 bp').fill('500');
  await page.getByRole('button', { name: '创建规则' }).click();
  await expect(page.getByText('Owned mention smoke')).toBeVisible();

  await page.getByRole('link', { name: 'AI Visibility', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'AI Visibility' })).toBeVisible();
  await expect(page.getByText('尚无采样运行。先在 Prompt 监控建立版本化 Prompt，再通过受控 API 发起采样。')).toBeVisible();
});
