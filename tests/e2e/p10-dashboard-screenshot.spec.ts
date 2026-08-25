import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';

test('captures the live rendered P10 dashboard acceptance view', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P10 UI Acceptance',
      slug: `p10-ui-acceptance-${suffix}`,
      primaryDomain: `p10-ui-${suffix}.example.com`,
      planLevel: 'ENTERPRISE'
    }
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');

    await expect(page.locator('[data-ui="dashboard-overview"]')).toBeVisible();
    await expect(page.locator('[data-ui="seo-score"]')).toBeVisible();
    await expect(page.locator('[data-ui="geo-visibility"]')).toBeVisible();
    await expect(page.locator('[data-ui="ai-tasks"]')).toBeVisible();
    await expect(page.locator('[data-ui="project-status"]')).toBeVisible();
    await expect(page.locator('[data-ui="task-center"]')).toBeVisible();
    await expect(page.locator('[data-ui="quick-actions"]')).toBeVisible();
    await expect(page.locator('[data-ui="activity-feed"]')).toBeVisible();
    await expect(page.getByText('P10 UI Acceptance', { exact: true })).toBeVisible();

    await page.screenshot({
      path: 'p10-dashboard.png',
      fullPage: true,
      animations: 'disabled'
    });
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});
