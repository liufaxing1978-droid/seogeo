import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';

async function seedVisibility(projectId: string, numerator: number) {
  const snapshot = await prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'd'.repeat(64),
      subjectSnapshotJson: { private: 'E2E DASHBOARD PRIVATE SUBJECT' },
      windowStart: new Date('2026-08-01T00:00:00.000Z'),
      windowEnd: new Date('2026-08-08T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
      scopeJson: { private: 'E2E DASHBOARD PRIVATE SCOPE' },
      scopeHash: 'e'.repeat(64),
      inputFingerprint: 'f'.repeat(64),
      candidateObservationCount: 10,
      completedExtractionCount: 10,
      missingExtractionCount: 0,
      failedExtractionCount: 0,
      completedAt: new Date('2026-08-09T00:00:00.000Z')
    }
  });
  const shared = {
    visibilityMetricSnapshotId: snapshot.id,
    projectId,
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
      { ...shared, metricType: 'MENTION_RATE', metricStatus: 'CALCULATED', numerator, denominator: 10 },
      { ...shared, metricType: 'CITATION_RATE', metricStatus: 'CALCULATED', numerator: 4, denominator: 10 },
      { ...shared, metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', numerator: 1, denominator: 2 }
    ]
  });
}

test('renders persisted Advanced visibility facts on project and portfolio dashboards', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'Advanced Dashboard Browser',
      slug: `advanced-dashboard-${suffix}`,
      primaryDomain: `advanced-dashboard-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  try {
    await seedVisibility(project.id, 3);

    await page.goto(`/projects/${project.id}`);
    const main = page.getByRole('main');
    await expect(main.getByText('Owned Mention Rate', { exact: true })).toBeVisible();
    await expect(main.getByText('30.0%', { exact: true })).toBeVisible();
    await expect(main.getByText('Owned Citation Rate', { exact: true })).toBeVisible();
    await expect(main.getByText('40.0%', { exact: true })).toBeVisible();
    await expect(main.getByText('Owned Mention SOV', { exact: true })).toBeVisible();
    await expect(main.getByText('50.0%', { exact: true })).toBeVisible();
    await expect(main).not.toContainText('E2E DASHBOARD PRIVATE SUBJECT');
    await expect(main).not.toContainText('E2E DASHBOARD PRIVATE SCOPE');

    await page.goto('/');
    await expect(page.getByRole('main').getByText('Advanced Dashboard Browser', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('30.0%', { exact: true })).toBeVisible();
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});

test('Standard project dashboard never exposes restricted P6 facts even when stray rows exist', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'Standard Dashboard Browser',
      slug: `standard-dashboard-${suffix}`,
      primaryDomain: `standard-dashboard-${suffix}.example.com`,
      planLevel: 'STANDARD'
    }
  });
  try {
    await seedVisibility(project.id, 9);

    await page.goto(`/projects/${project.id}`);
    const main = page.getByRole('main');
    await expect(main.getByText('AI Visibility · 高级版', { exact: true })).toBeVisible();
    await expect(main.getByText('升级到 Advanced 或 Enterprise 后显示持久化 Visibility 指标。', { exact: true })).toBeVisible();
    await expect(main).not.toContainText('90.0%');
    await expect(main).not.toContainText('E2E DASHBOARD PRIVATE SUBJECT');
    await expect(main).not.toContainText('E2E DASHBOARD PRIVATE SCOPE');
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});
