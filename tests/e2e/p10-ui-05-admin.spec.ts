import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('renders Members & Permissions from server-resolved OWNER authority', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/projects/${auth.project.id}/members`);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: '成员与权限', exact: true })).toBeVisible();
    await expect(main.locator('[data-ui="members-permissions-center"]')).toBeVisible();
    await expect(main.locator('[data-ui="role-ui-authority-boundary"]')).toContainText('服务器 RBAC 是唯一授权依据');
    await expect(main.getByText('LAST_PROJECT_OWNER_REQUIRED', { exact: true })).toBeVisible();
    await expect(main.locator('.capability-panel').getByText('PROJECT_MEMBER_MANAGE_ALL', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '成员与权限', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: '设置', exact: true })).toHaveAttribute('href', `/projects/${auth.project.id}/settings`);
    await expect(main.getByText(auth.user.email, { exact: true }).first()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'p10-ui-05-members.png', fullPage: false });
  } finally {
    await auth.cleanup();
  }
});

test('renders safe project Settings without exposing secrets or synthetic provider health', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/projects/${auth.project.id}/settings`);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: '设置', exact: true })).toBeVisible();
    await expect(main.locator('[data-ui="settings-center"]')).toBeVisible();
    await expect(main.locator('[data-ui="runtime-provider-boundary"]')).toContainText('密钥、Token、连接串不会在页面输出');
    await expect(main.getByRole('heading', { name: 'AI Provider', level: 2, exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Search / Visibility', level: 2, exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Runtime Status', level: 2, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '设置', exact: true })).toHaveAttribute('aria-current', 'page');

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('postgresql://');
    expect(bodyText).not.toContain('redis://');
    expect(bodyText).not.toContain('development-secret');
    expect(bodyText).not.toContain('Last provider success');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'p10-ui-05-settings.png', fullPage: false });
  } finally {
    await auth.cleanup();
  }
});

test('preserves Optimization Operations executor hooks while showing the P10 authority boundary', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ADVANCED',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/projects/${auth.project.id}/optimization`);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: '自动优化中心', exact: true })).toBeVisible();
    await expect(main.locator('[data-ui="optimization-operations-center"]')).toBeVisible();
    await expect(main.locator('[data-ui="optimization-authority-boundary"]')).toContainText('运行策略不等于执行授权');
    await expect(main.locator('[data-ui="optimization-authority-boundary"]')).toContainText('人工合并与部署边界保持不变');
    await expect(main.locator('[data-run-optimization]')).toBeVisible();
    await expect(main.locator('[data-policy-form]')).toBeVisible();
    await expect(page.getByRole('link', { name: '优化运营', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: 'p10-ui-05-optimization.png', fullPage: false });
  } finally {
    await auth.cleanup();
  }
});
