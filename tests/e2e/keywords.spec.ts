import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('operator captures 符纸 demand and sees truthful coverage', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.goto(`/projects/${auth.project.id}/keywords`);
    await page.getByLabel('关键词').fill('符纸');
    await page.getByLabel('类型').selectOption('CORE');
    await page.getByLabel('优先级').selectOption('HIGH');
    await page.getByLabel('战略锁定').check();
    await page.getByRole('button', { name: '添加关键词' }).click();

    await expect(page.locator('[data-ui="keyword-library"]')).toContainText('符纸');
    await expect(page.locator('[data-ui="keyword-library"]')).toContainText('锁定');
    await expect(page.locator('[data-ui="keyword-coverage"]')).toContainText(/证据不足|内容缺口|部分覆盖|覆盖较强/);
  } finally {
    await auth.cleanup();
  }
});

test('keeps keyword center navigation usable without horizontal overflow at 820px', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto(`/projects/${auth.project.id}/keywords`);

    const toggle = page.locator('[data-ui="nav-toggle"]');
    const sidebar = page.locator('[data-ui="sidebar"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toBeInViewport();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toBeInViewport();
    await expect(page.getByRole('link', { name: '关键词中心', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toBeInViewport();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await auth.cleanup();
  }
});
