import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import type { OptimizationOperationsApiPort } from '../../src/modules/optimization-operations/operations.routes.js';
import type { OperationsOverview } from '../../src/modules/optimization-operations/operations.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

function emptyOverview(): OperationsOverview {
  return {
    effectiveAutopilotState: 'ACTIVE',
    todayRunCount: 0,
    todayActions: [],
    alerts: [],
    quota: {
      configuredLimit: 1,
      reserved: 0,
      consumed: 0,
      remaining: 1,
    },
    pipelineCounts: {
      DISCOVERED: 0,
      ELIGIBLE: 0,
      PLANNED: 0,
      AUTOPILOT_DECIDED: 0,
      P8_HANDOFF: 0,
      DRAFT_PR: 0,
      VERIFIED: 0,
      OBSERVING: 0,
      EVALUATED: 0,
    },
    inboxCounts: {
      AWAITING_HUMAN_MERGE: 0,
      POLICY_BLOCKED: 0,
      P8_VALIDATION_BLOCKED: 0,
      VERIFICATION_FAILED: 0,
      STALE: 0,
      EXECUTION_FAILED: 0,
    },
    verificationSummary: {
      PENDING: 0,
      VERIFIED: 0,
      FAILED: 0,
      UNKNOWN: 0,
    },
    recentVerifications: [],
    experimentSummary: {
      last7Days: {
        positive: 0,
        neutral: 0,
        negative: 0,
        inconclusive: 0,
        feedbackAccepted: 0,
        feedbackDeferred: 0,
      },
      last30Days: {
        positive: 0,
        neutral: 0,
        negative: 0,
        inconclusive: 0,
        feedbackAccepted: 0,
        feedbackDeferred: 0,
      },
    },
    feedbackSummary: {
      sampleCount: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      rollingEffectBalance: 0,
      historicalRankAdjustment: 0,
      newestEvidenceCutoffAt: null,
      profileId: null,
    },
    recentActivity: [],
    generatedAt: new Date('2026-09-03T02:00:00.000Z'),
  };
}

function operationsApi(): OptimizationOperationsApiPort {
  return {
    async getOverview() {
      return emptyOverview();
    },
    async listPipeline() {
      return [];
    },
    async listInbox() {
      return [];
    },
    async listExperiments() {
      return [];
    },
    async listFeedback() {
      return [];
    },
    async getPolicy() {
      return null;
    },
    async listPolicyRevisions() {
      return [];
    },
  };
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe('OL-5 Automation Control Panel', () => {
  it('embeds the current authenticated session CSRF token for fail-closed orchestration commands', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanups.push(fixture.cleanup);
    const expectedToken = deriveCsrfToken(
      env.SESSION_SECRET,
      fixture.csrfInput.sessionId,
      fixture.csrfInput.tokenHash,
    );

    const response = await request(createApp({ optimizationOperationsApi: operationsApi() }))
      .get(`/projects/${fixture.project.id}/optimization`)
      .set('Cookie', fixture.sessionCookie)
      .expect(200);

    expect(response.text).toContain(`data-csrf-token="${expectedToken}"`);
  });

  it('renders one bounded Automation Control Panel for definitions and recent runs', async () => {
    const template = await readFile(
      new URL('../../src/views/optimization-operations/index.ejs', import.meta.url),
      'utf8',
    );

    expect(template).toContain('data-ui="operations-automation-control-panel"');
    expect(template).toContain('Automation Control Panel');
    expect(template).toContain('data-automation-definitions');
    expect(template).toContain('data-automation-runs');
    expect(template).toContain('data-automation-reconcile');
    expect(template).toContain('data-automation-status');
    expect(template).not.toMatch(/>\s*(?:Merge|Deploy|Rollback)\s*</i);
  });

  it('uses only the existing secure orchestration APIs and sends CSRF on every mutation', async () => {
    const source = await readFile(
      new URL('../../src/public/js/optimization-operations.js', import.meta.url),
      'utf8',
    );

    expect(source).toContain('root.dataset.csrfToken');
    expect(source).toContain('`${apiBase}/automation-definitions`');
    expect(source).toContain('`${apiBase}/automation-runs?limit=20`');
    expect(source).toContain('`${apiBase}/automation-runs`');
    expect(source).toContain('`${apiBase}/automation-runs/${runId}/retry`');
    expect(source).toContain('`${apiBase}/automation-definitions/${definitionId}`');
    expect(source).toContain('`${apiBase}/automation-definitions/reconcile`');
    expect(source).toContain("'X-CSRF-Token': csrfToken");
    expect(source).toContain("method: 'PATCH'");
    expect(source).toContain("method: 'POST'");
    expect(source).toContain('requestKey: crypto.randomUUID()');
    expect(source).toMatch(/if\s*\(!csrfToken\)/);
    expect(source).not.toMatch(/\/merge\b|\/deploy\b|\/rollback\b|force.?overwrite/i);
  });
});
