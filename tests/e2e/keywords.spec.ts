import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { authenticateE2e } from './e2e-auth.js';

async function seedBrowserSuggestion(
  auth: Awaited<ReturnType<typeof authenticateE2e>>,
  suggestedText: string,
) {
  const seed = await keywordService.createManual({
    actorUserId: auth.user.id,
    projectId: auth.project.id,
    text: `符纸-${randomUUID()}`,
    type: 'CORE',
    intent: 'INFORMATIONAL',
  });
  const task = await prisma.aiTask.create({
    data: {
      projectId: auth.project.id,
      taskType: 'KEYWORD_EXPANSION',
      requestKey: `keyword-e2e-suggestion:${randomUUID()}`,
      promptVersion: 'keyword-expansion-v1',
      factSnapshot: { seedKeyword: { id: seed.id, text: seed.text } },
      sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
    },
  });
  const suggestion = await prisma.keywordSuggestion.create({
    data: {
      projectId: auth.project.id,
      seedKeywordId: seed.id,
      suggestedText,
      normalizedText: suggestedText.normalize('NFKC').trim().toLocaleLowerCase('und'),
      suggestedType: 'LONG_TAIL',
      suggestedIntent: 'INFORMATIONAL',
      rationale: '浏览器验收用候选，必须人工审核',
      status: 'PENDING',
      provider: 'DEEPSEEK',
      model: 'fixture-model',
      aiTaskId: task.id,
    },
  });
  return { seed, task, suggestion };
}

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

test('operator explicitly accepts or rejects advisory keyword suggestions', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OPERATOR',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    const acceptedFixture = await seedBrowserSuggestion(auth, '六壬符纸');
    const rejectedFixture = await seedBrowserSuggestion(auth, '符纸怎么用');

    await page.goto(`/projects/${auth.project.id}/keywords`);
    const advisory = page.locator('[data-ui="keyword-advisory-panel"]');
    await expect(advisory).toBeVisible();
    await expect(advisory).toContainText('AI 长尾建议');
    await expect(advisory).toContainText('Advisory');
    await expect(advisory).toContainText('不会自动写入关键词库');
    await expect(page.locator('[data-ui="keyword-suggestion-generate"]').first()).toBeVisible();

    const acceptCard = page.locator(`[data-suggestion-id="${acceptedFixture.suggestion.id}"]`);
    await acceptCard.locator('input[name="editedText"]').fill('六壬符纸专题');
    await acceptCard.getByRole('button', { name: '接受并加入词库' }).click();

    await expect(page.locator('[data-ui="keyword-library"]')).toContainText('六壬符纸专题');
    await expect(page.locator(`[data-suggestion-id="${acceptedFixture.suggestion.id}"]`)).toContainText('已接受');

    const rejectCard = page.locator(`[data-suggestion-id="${rejectedFixture.suggestion.id}"]`);
    await rejectCard.getByRole('button', { name: '拒绝' }).click();
    await expect(page.locator(`[data-suggestion-id="${rejectedFixture.suggestion.id}"]`)).toContainText('已拒绝');

    expect(await prisma.keyword.count({
      where: {
        projectId: auth.project.id,
        normalizedText: '六壬符纸专题',
        source: 'AI_ACCEPTED',
      },
    })).toBe(1);
    expect(await prisma.keywordSuggestion.findUnique({ where: { id: rejectedFixture.suggestion.id } }))
      .toMatchObject({ status: 'REJECTED', acceptedKeywordId: null });
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
