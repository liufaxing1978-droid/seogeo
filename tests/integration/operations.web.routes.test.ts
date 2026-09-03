import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import type {
  OperationsActorResolver,
  OptimizationOperationsApiPort,
} from '../../src/modules/optimization-operations/operations.routes.js';
import type { OperationsOverview } from '../../src/modules/optimization-operations/operations.service.js';

const projectIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-F Operations ${planLevel}`,
      slug: `p9f-operations-web-${planLevel.toLowerCase()}-${suffix}`,
      primaryDomain: `operations-${suffix}.example.com`,
      planLevel,
    },
  });
  projectIds.push(project.id);
  return project;
}

function makeOverview(overrides: Partial<OperationsOverview> = {}): OperationsOverview {
  return {
    effectiveAutopilotState: 'ACTIVE',
    todayRunCount: 4,
    todayActions: [],
    quota: {
      configuredLimit: 5,
      reserved: 1,
      consumed: 2,
      remaining: 2,
    },
    pipelineCounts: {
      DISCOVERED: 1,
      ELIGIBLE: 1,
      PLANNED: 1,
      AUTOPILOT_DECIDED: 1,
      P8_HANDOFF: 1,
      DRAFT_PR: 2,
      VERIFIED: 1,
      OBSERVING: 1,
      EVALUATED: 3,
    },
    inboxCounts: {
      AWAITING_HUMAN_MERGE: 1,
      POLICY_BLOCKED: 1,
      P8_VALIDATION_BLOCKED: 0,
      VERIFICATION_FAILED: 1,
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
        positive: 3,
        neutral: 1,
        negative: 1,
        inconclusive: 2,
        feedbackAccepted: 2,
        feedbackDeferred: 5,
      },
      last30Days: {
        positive: 8,
        neutral: 3,
        negative: 4,
        inconclusive: 5,
        feedbackAccepted: 9,
        feedbackDeferred: 11,
      },
    },
    feedbackSummary: {
      sampleCount: 6,
      positiveCount: 3,
      neutralCount: 1,
      negativeCount: 2,
      rollingEffectBalance: 1,
      historicalRankAdjustment: -2,
      newestEvidenceCutoffAt: new Date('2026-08-25T05:00:00.000Z'),
      profileId: 'feedback-profile-fixture',
    },
    recentActivity: [
      {
        occurredAt: new Date('2026-08-25T05:15:00.000Z'),
        sourceModule: 'P8',
        eventType: 'PUBLICATION_VERIFICATION_FAILED',
        title: 'P8 verification failed',
        summary: 'Canonical verification did not pass.',
        authorityId: 'verification-fixture',
        authorityUrl: '/projects/fixture/publication/verification-fixture',
        severity: 'ERROR',
      },
    ],
    generatedAt: new Date('2026-08-25T05:20:00.000Z'),
    ...overrides,
  };
}

class FakeOperationsApi implements OptimizationOperationsApiPort {
  calls: string[] = [];
  overview = makeOverview();
  inbox = [
    {
      id: 'AUTOPILOT_DECISION:decision-fixture',
      authorityType: 'AUTOPILOT_DECISION' as const,
      authorityId: 'decision-fixture',
      category: 'POLICY_BLOCKED' as const,
      severity: 'HIGH' as const,
      reasonCode: 'POLICY_DISABLED',
      optimizationPlanId: 'plan-fixture',
      targetUrl: 'https://example.com/topic',
      updatedAt: new Date('2026-08-25T04:00:00.000Z'),
      authorityUrl: '/projects/fixture/optimization/policy',
    },
  ];
  policy: unknown = {
    id: 'policy-fixture',
    enabled: true,
    dailyDraftPrLimit: 5,
    maxConcurrentRuns: 2,
    requireFreshEvidence: true,
    minimumEvidenceCoverage: 80,
    pauseOnVerificationFailure: true,
    killSwitch: false,
    allowedRiskClass: 'LOW',
    allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
    updatedAt: new Date('2026-08-25T05:10:00.000Z'),
  };

  async getOverview(_projectId: string) {
    this.calls.push('getOverview');
    return this.overview;
  }

  async listPipeline(_projectId: string, _limit: number, _offset: number) {
    this.calls.push('listPipeline');
    return [];
  }

  async listInbox(_projectId: string, limit: number, offset: number) {
    this.calls.push(`listInbox:${limit}:${offset}`);
    return this.inbox;
  }

  async listExperiments(_projectId: string, _limit: number, _offset: number) {
    this.calls.push('listExperiments');
    return [];
  }

  async listFeedback(_projectId: string, _limit: number, _offset: number) {
    this.calls.push('listFeedback');
    return [];
  }

  async getPolicy(_projectId: string) {
    this.calls.push('getPolicy');
    return this.policy;
  }

  async listPolicyRevisions(_projectId: string, _limit: number, _offset: number) {
    this.calls.push('listPolicyRevisions');
    return [];
  }
}

function actorResolver(actorId = 'operator:fixture'): OperationsActorResolver {
  return {
    resolve() {
      return { actorId };
    },
  };
}

afterAll(async () => {
  if (projectIds.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  }
});

describe('P9-F Operations Center web route', () => {
  it('renders for Advanced and Enterprise, while Standard is denied before Operations reads', async () => {
    for (const planLevel of ['ADVANCED', 'ENTERPRISE'] as const) {
      const project = await createProject(planLevel);
      const api = new FakeOperationsApi();
      const app = createApp({ optimizationOperationsApi: api });
      const response = await request(app)
        .get(`/projects/${project.id}/optimization`)
        .expect(200);

      expect(response.text).toContain('自动优化中心');
      expect(response.text).toContain('data-operations-root');
      expect(api.calls).toEqual(['getOverview', 'listInbox:8:0', 'getPolicy']);
    }

    const standard = await createProject('STANDARD');
    const api = new FakeOperationsApi();
    const app = createApp({ optimizationOperationsApi: api });
    const denied = await request(app)
      .get(`/projects/${standard.id}/optimization`)
      .expect(403);

    expect(denied.body.error.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(api.calls).toHaveLength(0);
  });

  it('renders persisted metrics, inbox authority, outcomes, feedback, activity, and locked authority', async () => {
    const project = await createProject('ADVANCED');
    const api = new FakeOperationsApi();
    const app = createApp({ optimizationOperationsApi: api });
    const response = await request(app)
      .get(`/projects/${project.id}/optimization`)
      .expect(200);

    expect(response.text).toContain('仅基于已持久化事实');
    expect(response.text).toContain('ACTIVE');
    expect(response.text).toContain('今日 Optimization Runs');
    expect(response.text).toMatch(/DRAFT_PR[\s\S]*2/);
    expect(response.text).toMatch(/OBSERVING[\s\S]*1/);
    expect(response.text).toContain('POLICY_BLOCKED');
    expect(response.text).toContain('POLICY_DISABLED');
    expect(response.text).toContain('最近 7 天');
    expect(response.text).toMatch(/POSITIVE[\s\S]*3/);
    expect(response.text).toMatch(/FEEDBACK_ACCEPTED[\s\S]*2/);
    expect(response.text).toContain('最近 30 天');
    expect(response.text).toMatch(/NEGATIVE[\s\S]*4/);
    expect(response.text).toContain('历史效果权重只参与未来 P9-A V2 排序');
    expect(response.text).toMatch(/样本数[\s\S]*6/);
    expect(response.text).toMatch(/历史排序调整[\s\S]*-2/);
    expect(response.text).toContain('P8 verification failed');
    expect(response.text).toContain('LOW');
    expect(response.text).toContain('CREATE_CONTENT_PAGE');
    expect(response.text).toContain('/assets/js/optimization-operations.js');
  });

  it('renders explicit empty states without inventing missing persisted authority', async () => {
    const project = await createProject('ADVANCED');
    const api = new FakeOperationsApi();
    api.inbox = [];
    api.policy = null;
    api.overview = makeOverview({
      todayRunCount: 0,
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
    });
    const app = createApp({ optimizationOperationsApi: api });
    const response = await request(app)
      .get(`/projects/${project.id}/optimization`)
      .expect(200);

    expect(response.text).toContain('暂无需要人工处理的事项');
    expect(response.text).toContain('暂无活动记录');
    expect(response.text).toContain('尚未创建 Autopilot Policy');
  });

  it('never renders privileged mutation controls and visibly locks P9-C authority', async () => {
    const project = await createProject('ADVANCED');
    const app = createApp({ optimizationOperationsApi: new FakeOperationsApi() });
    const response = await request(app)
      .get(`/projects/${project.id}/optimization`)
      .expect(200);

    expect(response.text).not.toMatch(/>\s*Merge\s*</i);
    expect(response.text).not.toMatch(/>\s*Deploy\s*</i);
    expect(response.text).not.toMatch(/>\s*Rollback\s*</i);
    expect(response.text).not.toMatch(/force verified/i);
    expect(response.text).not.toMatch(/risk class editor/i);
    expect(response.text).not.toMatch(/historical weight editor/i);
    expect(response.text).not.toMatch(/force overwrite/i);
    expect(response.text).toMatch(/LOW[\s\S]*锁定/);
    expect(response.text).toMatch(/CREATE_CONTENT_PAGE[\s\S]*锁定/);
  });

  it('disables Policy Save without a server actor and enables it only with an injected actor', async () => {
    const project = await createProject('ADVANCED');

    const unavailable = await request(createApp({ optimizationOperationsApi: new FakeOperationsApi() }))
      .get(`/projects/${project.id}/optimization`)
      .expect(200);
    expect(unavailable.text).toMatch(/data-policy-save[^>]*disabled/);
    expect(unavailable.text).toContain('认证操作员身份不可用');

    const available = await request(createApp({
      optimizationOperationsApi: new FakeOperationsApi(),
      operationsActorResolver: actorResolver(),
    }))
      .get(`/projects/${project.id}/optimization`)
      .expect(200);
    expect(available.text).toMatch(/data-policy-save(?![^>]*disabled)/);
    expect(available.text).not.toContain('认证操作员身份不可用');
  });

  it('ships a page-scoped client that refreshes safely and reuses only bounded existing commands', async () => {
    const source = await readFile(
      new URL('../../src/public/js/optimization-operations.js', import.meta.url),
      'utf8',
    );

    expect(source).toContain('[data-operations-root]');
    expect(source).toContain("document.visibilityState === 'visible'");
    expect(source).toMatch(/30_?000|30000/);
    expect(source).toContain('`/api/v1/projects/${projectId}/optimization`');
    expect(source).toContain('`${apiBase}/operations`');
    expect(source).toContain('data-dirty');
    expect(source).toContain('crypto.randomUUID()');
    expect(source).toContain('`${apiBase}/runs`');
    expect(source).toContain('manualRequestId');
    expect(source).toContain('/autopilot-policy/revisions');
    expect(source).toContain('window.confirm');
    expect(source).toMatch(/status\s*===\s*409/);
    expect(source).not.toMatch(/\/merge\b|\/deploy\b|\/rollback\b|force.?overwrite/i);
  });
});
