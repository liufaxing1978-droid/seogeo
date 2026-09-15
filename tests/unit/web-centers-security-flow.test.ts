import { renderFile } from 'ejs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000041';

describe('project web center security boundary', () => {
  it.each(['reports', 'visibility', 'competitors'])(
    'rejects an unauthenticated %s request before business data access',
    async (center) => {
      const response = await request(createApp()).get(`/projects/${PROJECT_ID}/${center}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    },
  );

  it.each([
    ['reports/index.ejs', { project: { id: PROJECT_ID, name: 'Test', primaryDomain: 'example.com' }, reports: [] }],
    ['reports/show.ejs', {
      project: { id: PROJECT_ID },
      report: { id: 'report-1', reportType: 'PROJECT_REPORT_V1', reportVersion: 1, createdAt: new Date(), factSnapshotHash: 'hash', executiveAiTaskId: null },
      payload: {}, executiveTask: null, executiveResult: null,
    }],
    ['competitors/index.ejs', { project: { id: PROJECT_ID, name: 'Test', primaryDomain: 'example.com' }, competitors: [] }],
    ['competitors/show.ejs', {
      project: { id: PROJECT_ID, primaryDomain: 'example.com' },
      competitor: {
        id: 'competitor-1', name: 'Reference Site', domain: 'reference.example', crawls: [],
        comparisons: [{ id: 'comparison-1', comparisonVersion: 'V1', createdAt: new Date(), gaps: [] }],
      },
    }],
    ['visibility/prompts.ejs', { project: { id: PROJECT_ID, name: 'Test' }, promptSets: [], prompts: [], activeNav: 'visibility-prompts' }],
    ['visibility/alerts.ejs', {
      project: { id: PROJECT_ID, name: 'Test' },
      activeNav: 'visibility-alerts',
      rules: [{
        id: 'rule-1',
        name: 'Mention rate drop',
        ruleType: 'OWNED_MENTION_RATE_DROP',
        severity: 'WARNING',
        thresholdBasisPoints: 500,
        actorSubjectId: null,
        enabled: true,
      }],
      alerts: [{
        id: 'alert-1',
        status: 'OPEN',
        severity: 'WARNING',
        reasonCode: 'OWNED_MENTION_RATE_DROP',
        actorKey: 'OWNED_ROLLUP',
        deltaBasisPoints: -600,
        previousMetricStatus: 'CALCULATED',
        currentMetricStatus: 'CALCULATED',
        rule: { name: 'Mention rate drop' },
        comparison: { previousWindow: null, currentWindow: null },
      }],
    }],
    ['visibility/metrics.ejs', {
      project: { id: PROJECT_ID, name: 'Test' },
      activeNav: 'visibility-metrics',
      rows: [],
      contracts: [],
      snapshot: null,
      formWindowStart: '2026-09-01T00:00',
      formWindowEnd: '2026-09-08T00:00',
    }],
  ])('renders a CSRF token in every POST form in %s', async (template, locals) => {
    const html = await renderFile(
      fileURLToPath(new URL(`../../src/views/${template}`, import.meta.url)),
      { ...locals, csrfToken: 'csrf-token' },
    );
    const postFormCount = html.match(/<form\b[^>]*method="post"/g)?.length ?? 0;
    const csrfFieldCount = html.match(/name="_csrf"/g)?.length ?? 0;

    expect(postFormCount).toBeGreaterThan(0);
    expect(csrfFieldCount).toBe(postFormCount);
  });
});
