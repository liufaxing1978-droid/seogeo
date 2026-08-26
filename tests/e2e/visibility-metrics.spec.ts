import { expect, test } from '@playwright/test';
import { prisma } from '../../src/db/prisma.js';

test('renders P6-C metrics with zero-vs-unknown semantics, SOV, provenance and active navigation', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'Visibility Metrics Browser',
      slug: `visibility-metrics-browser-${suffix}`,
      primaryDomain: `visibility-metrics-browser-${suffix}.example.com`,
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
        subjectSnapshotJson: { private: 'BROWSER PRIVATE SUBJECT SNAPSHOT' },
        windowStart: new Date('2026-08-01T00:00:00.000Z'),
        windowEnd: new Date('2026-08-08T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
        scopeJson: { providers: [], promptSetIds: [], private: 'BROWSER PRIVATE SCOPE' },
        scopeHash: 'b'.repeat(64),
        inputFingerprint: 'c'.repeat(64),
        candidateObservationCount: 10,
        completedExtractionCount: 9,
        missingExtractionCount: 1,
        failedExtractionCount: 0,
        completedAt: new Date('2026-08-09T00:00:00.000Z')
      }
    });

    const shared = {
      visibilityMetricSnapshotId: snapshot.id,
      projectId: project.id,
      candidateObservationCount: 10,
      notEligibleObservationCount: 0
    } as const;
    await prisma.visibilityMetricRow.createMany({
      data: [
        {
          ...shared,
          metricType: 'MENTION_RATE', metricStatus: 'CALCULATED', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', actorType: 'OWNED_ROLLUP', actorKey: 'OWNED_ROLLUP',
          numerator: 0, denominator: 10, eligibleObservationCount: 10, unknownObservationCount: 0
        },
        {
          ...shared,
          metricType: 'CITATION_RATE', metricStatus: 'UNKNOWN', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', actorType: 'OWNED_ROLLUP', actorKey: 'OWNED_ROLLUP',
          numerator: 0, denominator: 0, eligibleObservationCount: 9, unknownObservationCount: 1
        },
        {
          ...shared,
          metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', actorType: 'OWNED_ROLLUP', actorKey: 'OWNED_ROLLUP',
          numerator: 2, denominator: 5, eligibleObservationCount: 10, unknownObservationCount: 0
        },
        {
          ...shared,
          metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', actorType: 'COMPETITOR', actorKey: 'COMPETITOR:browser-fixture',
          numerator: 3, denominator: 5, eligibleObservationCount: 10, unknownObservationCount: 0
        }
      ]
    });

    await page.goto(`/projects/${project.id}/visibility/metrics?snapshotId=${snapshot.id}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Visibility 指标' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'GEO / 可见度', exact: true })).toHaveAttribute('aria-current', 'page');

    const mentionCard = page.locator('.metric-card').filter({ hasText: 'Owned Mention Rate' });
    const citationCard = page.locator('.metric-card').filter({ hasText: 'Owned Citation Rate' });
    const sovCard = page.locator('.metric-card').filter({ hasText: 'Owned Mention SOV' });
    await expect(mentionCard).toContainText('0.0%');
    await expect(citationCard).toContainText('UNKNOWN');
    await expect(citationCard).not.toContainText('0.0%');
    await expect(sovCard).toContainText('40.0%');

    await expect(page.getByText('COMPETITOR:browser-fixture', { exact: true })).toBeVisible();
    await expect(page.getByText('60.0%', { exact: true })).toBeVisible();
    await expect(page.getByText('VISIBILITY_METRICS_V1', { exact: true })).toBeVisible();
    await expect(page.getByText('P6B_EXTRACTION_V1', { exact: true })).toBeVisible();
    await expect(page.getByText('缺失 extraction', { exact: false })).toBeVisible();

    const main = await page.getByRole('main').innerText();
    expect(main).not.toContain('BROWSER PRIVATE SUBJECT SNAPSHOT');
    expect(main).not.toContain('BROWSER PRIVATE SCOPE');
    expect(main).not.toMatch(/趋势线|delta|alert|告警|AI narrative/i);
  } finally {
    await prisma.visibilityMetricRow.deleteMany({ where: { projectId: project.id } }).catch(() => undefined);
    await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId: project.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});
