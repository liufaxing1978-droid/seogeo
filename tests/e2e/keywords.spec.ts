import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
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

async function seedBrowserSearchEvidence(
  auth: Awaited<ReturnType<typeof authenticateE2e>>,
  keywordText: string,
) {
  const suffix = randomUUID();
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sourceDate = new Date(todayUtc.getTime() - 86_400_000);
  const propertyRef = `sc-domain:${auth.project.primaryDomain}`;
  const repository = new SearchFactRepository(prisma);

  await repository.persistCompletedSnapshot(
    {
      projectId: auth.project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef,
      propertyType: 'DOMAIN',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `task8-google-${suffix}`,
      sourceCutoffAt: sourceDate,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [
      {
        factKey: `task8-google-query-page-${suffix}`,
        factKind: 'QUERY_PAGE',
        sourceObservationRef: `task8-google-observation-${suffix}`,
        sourceDate,
        query: keywordText,
        normalizedQuery: `task8-provider-normalized-${suffix}`,
        queryNormalizationVersion: 'task8-provider-v1',
        page: `https://${auth.project.primaryDomain}/fu-zhi`,
        canonicalPage: `https://${auth.project.primaryDomain}/fu-zhi`,
        canonicalizationVersion: 'task8-test-v1',
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 6,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks',
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 150,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions',
          },
          {
            metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
            numericValue: 5.5,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'position',
          },
        ],
      },
    ],
    `task8-google-input-${suffix}`,
  );
}

async function seedBrowserDiscovery(
  auth: Awaited<ReturnType<typeof authenticateE2e>>,
  query: string,
) {
  const suffix = randomUUID();
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sourceDate = new Date(todayUtc.getTime() - 86_400_000);
  const repository = new SearchFactRepository(prisma);

  await repository.persistCompletedSnapshot(
    {
      projectId: auth.project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: `sc-domain:${auth.project.primaryDomain}`,
      propertyType: 'DOMAIN',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `task9-discovery-gsc-${suffix}`,
      sourceCutoffAt: sourceDate,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [{
      factKey: `task9-discovery-gsc-fact-${suffix}`,
      factKind: 'QUERY_PAGE',
      sourceObservationRef: `task9-discovery-gsc-observation-${suffix}`,
      sourceDate,
      query,
      normalizedQuery: query,
      queryNormalizationVersion: 'task9-fixture',
      page: `https://${auth.project.primaryDomain}/liuren-fuzhi-guide`,
      canonicalPage: `https://${auth.project.primaryDomain}/liuren-fuzhi-guide`,
      canonicalizationVersion: 'task9-fixture',
      metrics: [
        {
          metricSemantic: 'IMPRESSIONS',
          numericValue: 80,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'impressions',
        },
        {
          metricSemantic: 'CLICKS',
          numericValue: 8,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'clicks',
        },
        {
          metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
          numericValue: 4.25,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'position',
        },
      ],
    }],
    `task9-discovery-gsc-input-${suffix}`,
  );

  await repository.persistCompletedSnapshot(
    {
      projectId: auth.project.id,
      provider: 'BING_WEBMASTER',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: `https://${auth.project.primaryDomain}/`,
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: `task9-discovery-bing-${suffix}`,
      sourceCutoffAt: sourceDate,
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [{
      factKey: `task9-discovery-bing-fact-${suffix}`,
      factKind: 'QUERY',
      sourceObservationRef: `task9-discovery-bing-observation-${suffix}`,
      sourceDate,
      query,
      normalizedQuery: query,
      queryNormalizationVersion: 'task9-fixture',
      page: null,
      canonicalPage: null,
      canonicalizationVersion: null,
      metrics: [
        {
          metricSemantic: 'IMPRESSIONS',
          numericValue: 30,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'impressions',
        },
        {
          metricSemantic: 'CLICKS',
          numericValue: 3,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'clicks',
        },
        {
          metricSemantic: 'BING_AVG_CLICK_POSITION',
          numericValue: 6.5,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'avgClickPosition',
        },
        {
          metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
          numericValue: null,
          evidenceState: 'UNKNOWN',
          sourceField: 'avgImpressionPosition',
        },
      ],
    }],
    `task9-discovery-bing-input-${suffix}`,
  );

  return prisma.keywordDiscoveryCandidate.create({
    data: {
      projectId: auth.project.id,
      normalizedQuery: query,
      representativeText: query,
      status: 'PENDING',
      firstObservedAt: sourceDate,
      lastObservedAt: sourceDate,
    },
  });
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

test('renders persisted Google search evidence without fabricating current rank', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    const keyword = await keywordService.createManual({
      actorUserId: auth.user.id,
      projectId: auth.project.id,
      text: '符纸',
      type: 'CORE',
      priority: 'HIGH',
    });
    await seedBrowserSearchEvidence(auth, keyword.text);

    await page.goto(`/projects/${auth.project.id}/keywords`);
    const row = page.locator(`[data-keyword-id="${keyword.id}"]`);
    const evidence = row.locator('[data-ui="keyword-search-evidence"]');

    await expect(row).toBeVisible();
    await expect(evidence).toContainText('Google Search Console');
    await expect(evidence).toContainText('Search Console 平均位置');
    await expect(evidence).not.toContainText('Google 当前排名');
  } finally {
    await prisma.searchFactSnapshot.deleteMany({ where: { projectId: auth.project.id } });
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
    const keyword = await keywordService.createManual({
      actorUserId: auth.user.id,
      projectId: auth.project.id,
      text: '符纸',
      type: 'CORE',
    });
    await seedBrowserSearchEvidence(auth, keyword.text);

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

    const evidence = page.locator(`[data-keyword-id="${keyword.id}"] [data-ui="keyword-search-evidence"]`);
    await expect(evidence).toContainText('Google Search Console');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await prisma.searchFactSnapshot.deleteMany({ where: { projectId: auth.project.id } });
    await auth.cleanup();
  }
});

test('operator reviews real search query discoveries with explicit human type choice', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OPERATOR',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  try {
    const acceptedQuery = '六壬符纸怎么用';
    const rejectedQuery = '符纸怎么保存';
    const acceptedCandidate = await seedBrowserDiscovery(auth, acceptedQuery);
    const rejectedCandidate = await seedBrowserDiscovery(auth, rejectedQuery);
    const factCountBeforeReview = await prisma.searchFact.count({
      where: { projectId: auth.project.id },
    });

    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto(`/projects/${auth.project.id}/keywords`);

    const discovery = page.locator('[data-ui="keyword-discovery"]');
    await expect(discovery).toBeVisible();
    await expect(discovery).toContainText('真实搜索词');
    await expect(discovery).toContainText('Google Search Console');
    await expect(discovery).toContainText('Search Console 平均位置');
    await expect(discovery).toContainText('Bing Webmaster Tools');
    await expect(discovery).toContainText('Bing 平均展示位置');
    await expect(discovery).not.toContainText('Google 当前排名');
    await expect(discovery).not.toContainText('Bing 当前排名');
    await expect(discovery).not.toContainText('全网搜索量');
    await expect(discovery).not.toContainText('月搜索量');

    const acceptRow = page.locator(`[data-candidate-id="${acceptedCandidate.id}"]`);
    const typeSelect = acceptRow.locator('[data-ui="keyword-discovery-accept"] select[name="type"]');
    await expect(typeSelect).toBeVisible();
    await typeSelect.selectOption('LONG_TAIL');
    await acceptRow.getByRole('button', { name: '加入关键词库' }).click();

    expect(await prisma.keyword.count({
      where: {
        projectId: auth.project.id,
        text: acceptedQuery,
        source: 'SEARCH_DISCOVERY_ACCEPTED',
      },
    })).toBe(1);

    const rejectRow = page.locator(`[data-candidate-id="${rejectedCandidate.id}"]`);
    await rejectRow.getByRole('button', { name: '忽略' }).click();
    expect(await prisma.keywordDiscoveryCandidate.findUnique({
      where: { id: rejectedCandidate.id },
    })).toMatchObject({ status: 'REJECTED', acceptedKeywordId: null });
    expect(await prisma.searchFact.count({
      where: { projectId: auth.project.id },
    })).toBe(factCountBeforeReview);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await auth.cleanup();
  }
});
