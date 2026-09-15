import express from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { errorHandler } from '../../src/core/http.js';
import { prisma } from '../../src/db/prisma.js';
import {
  createOptimizationOperationsRoutes,
  type OperationsActorResolver,
  type OptimizationOperationsApiPort,
  type PolicyRevisionCommandPort,
} from '../../src/modules/optimization-operations/operations.routes.js';
import type { OperationsOverview } from '../../src/modules/optimization-operations/operations.service.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000301';
const USER_ID = '00000000-0000-4000-8000-000000000302';
const SESSION_ID = '00000000-0000-4000-8000-000000000303';
const TOKEN_HASH = 'operations-security-token-hash';

const project = {
  id: PROJECT_ID,
  name: 'Operations security fixture',
  slug: 'operations-security-fixture',
  primaryDomain: 'example.com',
  industry: null,
  defaultLanguage: 'zh-CN',
  targetCountry: 'CN',
  timezone: 'Asia/Shanghai',
  status: 'ACTIVE',
  planLevel: 'ENTERPRISE',
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-15T00:00:00Z'),
} as const;

const emptyOverview: OperationsOverview = {
  effectiveAutopilotState: 'DISABLED',
  todayRunCount: 0,
  todayActions: [],
  alerts: [],
  quota: { configuredLimit: 0, reserved: 0, consumed: 0, remaining: 0 },
  pipelineCounts: {
    DISCOVERED: 0, ELIGIBLE: 0, PLANNED: 0, AUTOPILOT_DECIDED: 0,
    P8_HANDOFF: 0, DRAFT_PR: 0, VERIFIED: 0, OBSERVING: 0, EVALUATED: 0,
  },
  inboxCounts: {
    AWAITING_HUMAN_MERGE: 0, POLICY_BLOCKED: 0, P8_VALIDATION_BLOCKED: 0,
    VERIFICATION_FAILED: 0, STALE: 0, EXECUTION_FAILED: 0,
  },
  verificationSummary: { PENDING: 0, VERIFIED: 0, FAILED: 0, UNKNOWN: 0 },
  recentVerifications: [],
  experimentSummary: {
    last7Days: { positive: 0, neutral: 0, negative: 0, inconclusive: 0, feedbackAccepted: 0, feedbackDeferred: 0 },
    last30Days: { positive: 0, neutral: 0, negative: 0, inconclusive: 0, feedbackAccepted: 0, feedbackDeferred: 0 },
  },
  feedbackSummary: {
    sampleCount: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0,
    rollingEffectBalance: 0, historicalRankAdjustment: 0,
    newestEvidenceCutoffAt: null, profileId: null,
  },
  recentActivity: [],
  generatedAt: new Date('2026-09-15T00:00:00Z'),
};

const operationsApi: OptimizationOperationsApiPort = {
  getOverview: async () => emptyOverview,
  listPipeline: async () => [],
  listInbox: async () => [],
  listExperiments: async () => [],
  listFeedback: async () => [],
  getPolicy: async () => null,
  listPolicyRevisions: async () => [],
};

const validPolicyBody = () => ({
  requestId: randomUUID(),
  expectedUpdatedAt: null,
  policy: {
    enabled: false,
    dailyDraftPrLimit: 1,
    maxConcurrentRuns: 1,
    requireFreshEvidence: true,
    minimumEvidenceCoverage: 80,
    pauseOnVerificationFailure: true,
    killSwitch: false,
  },
});

function stubProject(role: 'VIEWER' | 'OWNER' = 'OWNER') {
  vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(project as never);
  vi.spyOn(prisma.projectMembership, 'findFirst').mockResolvedValue({
    id: 'membership-1',
    projectId: PROJECT_ID,
    userId: USER_ID,
    role,
    status: 'ACTIVE',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    project,
  } as never);
}

function authenticatedApiApp(
  role: 'VIEWER' | 'OWNER',
  command: PolicyRevisionCommandPort,
  actorResolver: OperationsActorResolver,
) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { userId: USER_ID, sessionId: SESSION_ID };
    res.locals.authSessionTokenHash = TOKEN_HASH;
    next();
  });
  stubProject(role);
  app.use('/api/v1', createOptimizationOperationsRoutes(operationsApi, command, actorResolver));
  app.use(errorHandler);
  return app;
}

const readPaths = [
  'operations',
  'operations/pipeline',
  'operations/inbox',
  'operations/experiments',
  'operations/feedback',
  'autopilot-policy',
  'autopilot-policy/revisions',
];

describe('Operations Center security boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(readPaths)('rejects unauthenticated API read %s before returning project data', async (path) => {
    stubProject();
    const response = await request(createApp({ optimizationOperationsApi: operationsApi }))
      .get(`/api/v1/projects/${PROJECT_ID}/optimization/${path}`)
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects the unauthenticated Operations web page before rendering project data', async () => {
    stubProject();
    const response = await request(createApp({ optimizationOperationsApi: operationsApi }))
      .get(`/projects/${PROJECT_ID}/optimization`)
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('denies a VIEWER policy revision even with a valid CSRF token', async () => {
    const command: PolicyRevisionCommandPort = {
      apply: async () => ({
        status: 'APPLIED', policyId: randomUUID(), revisionId: randomUUID(),
        revisionKey: 'revision-key', commandFingerprint: 'fingerprint',
        appliedPolicyUpdatedAt: '2026-09-15T00:00:00.000Z',
      }),
    };
    const response = await request(authenticatedApiApp('VIEWER', command, {
      resolve: () => ({ actorId: `user:${USER_ID}` }),
    }))
      .post(`/api/v1/projects/${PROJECT_ID}/optimization/autopilot-policy/revisions`)
      .set('X-CSRF-Token', deriveCsrfToken(env.SESSION_SECRET, SESSION_ID, TOKEN_HASH))
      .send(validPolicyBody())
      .expect(403);

    expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
  });

  it('rejects an OWNER policy revision without CSRF', async () => {
    const command: PolicyRevisionCommandPort = {
      apply: async () => ({
        status: 'APPLIED', policyId: randomUUID(), revisionId: randomUUID(),
        revisionKey: 'revision-key', commandFingerprint: 'fingerprint',
        appliedPolicyUpdatedAt: '2026-09-15T00:00:00.000Z',
      }),
    };
    const response = await request(authenticatedApiApp('OWNER', command, {
      resolve: () => ({ actorId: `user:${USER_ID}` }),
    }))
      .post(`/api/v1/projects/${PROJECT_ID}/optimization/autopilot-policy/revisions`)
      .send(validPolicyBody())
      .expect(403);

    expect(response.body.error.code).toBe('CSRF_INVALID');
  });
});
