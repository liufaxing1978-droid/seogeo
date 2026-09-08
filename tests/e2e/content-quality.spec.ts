import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

test('operator submits the real CSRF-protected analysis form without a publish action', async ({ page, context }) => {
  const calls: Array<{ projectId: string; actorId: string }> = [];
  const app = createApp({
    contentQualityService: {
      async enqueueRun(projectId, actorId) {
        calls.push({ projectId, actorId });
        return { jobId: 'content-quality-e2e', runId: '00000000-0000-4000-8000-000000000123', deduplicated: false };
      },
    },
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await seedAuthenticatedUser({
    role: 'OPERATOR',
    planLevel: 'STANDARD',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    const separator = auth.sessionCookie.indexOf('=');
    await context.addCookies([{
      name: auth.sessionCookie.slice(0, separator),
      value: auth.sessionCookie.slice(separator + 1),
      url: baseUrl,
    }]);
    await page.goto(`${baseUrl}/projects/${auth.project.id}/content/quality`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '内容质量建议' })).toBeVisible();
    await expect(page.getByText('发布执行')).toHaveCount(0);

    const csrfToken = await page.locator('input[name="_csrf"]').inputValue();
    const post = page.waitForRequest((request) => request.method() === 'POST'
      && request.url() === `${baseUrl}/projects/${auth.project.id}/content/quality/runs`);
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: '分析内容质量' }).click(),
    ]);
    const submitted = await post;
    expect(submitted.postData()).toContain(`_csrf=${encodeURIComponent(csrfToken)}`);
    expect((await submitted.response())?.status()).toBe(303);
    await expect(page).toHaveURL(`${baseUrl}/projects/${auth.project.id}/content/quality`);
    expect(calls).toEqual([{ projectId: auth.project.id, actorId: auth.user.id }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.project.delete({ where: { id: auth.project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: auth.user.id } }).catch(() => undefined);
  }
});
