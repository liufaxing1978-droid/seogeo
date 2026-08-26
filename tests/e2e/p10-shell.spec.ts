import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('renders the UI-01 shell with truthful project context', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/projects/${auth.project.id}`);

    await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
    await expect(page.locator('[data-ui="topbar"]')).toBeVisible();
    await expect(page.locator('[data-ui="auth-session"]')).toContainText('已认证');
    await expect(page.getByRole('link', { name: '项目中心', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'SEO 中心', exact: true })).toHaveAttribute('href', `/projects/${auth.project.id}/seo`);
    await expect(page.getByRole('link', { name: 'GEO / 可见度', exact: true })).toHaveAttribute('href', `/projects/${auth.project.id}/geo`);
    await expect(page.getByRole('link', { name: '切换项目', exact: true })).toHaveAttribute('href', '/projects');
    await expect(page.getByLabel('通知')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('P10 · Identity & RBAC');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await auth.cleanup();
  }
});

test('opens and closes primary navigation below 1024px', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto(`/projects/${auth.project.id}`);

    const toggle = page.locator('[data-ui="nav-toggle"]');
    const sidebar = page.locator('[data-ui="sidebar"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toBeInViewport();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toBeInViewport();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toBeInViewport();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await auth.cleanup();
  }
});
