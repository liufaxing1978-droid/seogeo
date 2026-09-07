import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';
import { authenticateE2e } from './e2e-auth.js';

test('operator requests analysis without a publish action', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OPERATOR',
    planLevel: 'STANDARD',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    await page.goto(`/projects/${auth.project.id}/content/quality`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '内容质量建议' })).toBeVisible();
    await expect(page.getByText('尚无分析记录')).toBeVisible();
    await expect(page.getByText('发布执行')).toHaveCount(0);

    await page.route(`**/projects/${auth.project.id}/content/quality/runs`, async (route) => {
      await route.fulfill({ status: 303, headers: { location: `/projects/${auth.project.id}/content/quality` } });
    });
    await page.getByRole('button', { name: '分析内容质量' }).click();
  } finally {
    await prisma.project.delete({ where: { id: auth.project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: auth.user.id } }).catch(() => undefined);
  }
});
