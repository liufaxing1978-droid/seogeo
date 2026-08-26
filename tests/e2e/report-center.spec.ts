import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';
import { authenticateE2e } from './e2e-auth.js';

test('generates and opens a project report without invoking DeepSeek', async ({ page, context }) => {
  await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'STANDARD',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

  const suffix = Date.now();
  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill('Report Center Smoke');
  await page.getByLabel('slug').fill(`report-center-${suffix}`);
  await page.getByLabel('主域名').fill(`report-${suffix}.example.com`);
  await page.getByLabel('套餐').selectOption('STANDARD');
  await page.getByRole('button', { name: '创建项目' }).click();

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();

  await page.goto(`/projects/${projectId}/reports`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '报告中心' })).toBeVisible();
  await page.getByRole('button', { name: '生成项目报告 V1', exact: true }).click();
  await expect(page.getByRole('table').getByText('PROJECT_REPORT_V1', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看报告' }).first().click();
  await expect(page.getByText('确定性事实', { exact: true })).toBeVisible();
  await expect(page.getByText('AI 建议 / Executive Summary', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '报告中心', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('generates PROJECT_REPORT_V2 from persisted Advanced visibility facts without leaking private snapshot fields', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'Report V2 Browser',
      slug: `report-v2-browser-${suffix}`,
      primaryDomain: `report-v2-browser-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  try {
    const snapshot = await prisma.visibilityMetricSnapshot.create({
      data: {
        projectId: project.id,
        status: 'COMPLETED',
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: 'P6B_EXTRACTION_V1',
        subjectSetHash: 'a'.repeat(64),
        subjectSnapshotJson: { private: 'E2E REPORT V2 PRIVATE SUBJECT' },
        windowStart: new Date('2026-08-01T00:00:00.000Z'),
        windowEnd: new Date('2026-08-08T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
        scopeJson: { private: 'E2E REPORT V2 PRIVATE SCOPE' },
        scopeHash: 'b'.repeat(64),
        inputFingerprint: 'c'.repeat(64),
        candidateObservationCount: 10,
        completedExtractionCount: 8,
        missingExtractionCount: 2,
        failedExtractionCount: 0,
        completedAt: new Date('2026-08-09T00:00:00.000Z')
      }
    });
    const shared = {
      visibilityMetricSnapshotId: snapshot.id,
      projectId: project.id,
      candidateObservationCount: 10,
      eligibleObservationCount: 10,
      notEligibleObservationCount: 0,
      unknownObservationCount: 0,
      dimensionType: 'OVERALL' as const,
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP' as const,
      actorKey: 'OWNED_ROLLUP'
    };
    await prisma.visibilityMetricRow.createMany({
      data: [
        { ...shared, metricType: 'MENTION_RATE', metricStatus: 'CALCULATED', numerator: 3, denominator: 10 },
        { ...shared, metricType: 'CITATION_RATE', metricStatus: 'UNKNOWN', numerator: 0, denominator: 0, unknownObservationCount: 2 },
        { ...shared, metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', numerator: 2, denominator: 5 }
      ]
    });

    const aiTaskCountBefore = await prisma.aiTask.count({ where: { projectId: project.id } });

    await page.goto(`/projects/${project.id}/reports`);
    await page.getByRole('button', { name: '生成项目报告 V2', exact: true }).click();
    await expect(page.getByRole('table').getByText('PROJECT_REPORT_V2', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '查看报告' }).first().click();

    const main = page.getByRole('main');
    await expect(main.getByText('AI Visibility', { exact: true })).toBeVisible();
    await expect(main.getByText('Mention Rate', { exact: true })).toBeVisible();
    await expect(main.getByText('30.0%', { exact: true })).toBeVisible();
    await expect(main.getByText('UNKNOWN', { exact: true }).first()).toBeVisible();
    await expect(main.getByText('Evidence Coverage', { exact: true })).toBeVisible();
    await expect(main.getByText('80.0%', { exact: true })).toBeVisible();
    await expect(main).not.toContainText('E2E REPORT V2 PRIVATE SUBJECT');
    await expect(main).not.toContainText('E2E REPORT V2 PRIVATE SCOPE');
    expect(await prisma.aiTask.count({ where: { projectId: project.id } })).toBe(aiTaskCountBefore);
  } finally {
    await prisma.reportSnapshot.deleteMany({ where: { projectId: project.id } });
    await prisma.visibilityMetricRow.deleteMany({ where: { projectId: project.id } });
    await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});
