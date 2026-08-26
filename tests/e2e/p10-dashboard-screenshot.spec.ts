import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';
import { authenticateE2e } from './e2e-auth.js';

test('captures the live rendered P10 dashboard acceptance view', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  await prisma.project.update({
    where: { id: auth.project.id },
    data: { name: 'P10 UI Acceptance' },
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');

    await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
    await expect(page.locator('[data-ui="topbar"]')).toBeVisible();
    await expect(page.getByRole('link', { name: '仪表盘', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-ui="dashboard-overview"]')).toBeVisible();
    await expect(page.locator('[data-ui="seo-score"]')).toBeVisible();
    await expect(page.locator('[data-ui="geo-visibility"]')).toBeVisible();
    await expect(page.locator('[data-ui="ai-tasks"]')).toBeVisible();
    await expect(page.locator('[data-ui="project-status"]')).toBeVisible();
    await expect(page.locator('[data-ui="task-center"]')).toBeVisible();
    await expect(page.locator('[data-ui="quick-actions"]')).toBeVisible();
    await expect(page.locator('[data-ui="activity-feed"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'P10 UI Acceptance', exact: true }).first()).toBeVisible();

    await page.screenshot({
      path: 'p10-dashboard.png',
      fullPage: true,
      animations: 'disabled'
    });
  } finally {
    await auth.cleanup();
  }
});
