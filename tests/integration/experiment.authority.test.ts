import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma, RecommendedActionType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationExperimentRepository } from '../../src/modules/optimization-experiments/experiment.repository.js';
import { OptimizationExperimentService } from '../../src/modules/optimization-experiments/experiment.service.js';

const ROLLBACK_SENTINEL = 'P9_D_AUTHORITY_ROLLBACK';
const DAY_MS = 24 * 60 * 60 * 1000;

async function withRollback(
  run: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK_SENTINEL) return;
    throw error;
  }
}

async function seedAuthorityGraph(
  tx: Prisma.TransactionClient,
  recommendedActionType: RecommendedActionType
) {
  const suffix = randomUUID();
  const targetUrl = `https://${suffix}.example.com/page`;
  const project = await tx.project.create({
    data: {
      name: `P9-D authority ${suffix}`,
      slug: `p9-d-authority-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  const isContentCreation = recommendedActionType === 'CONTENT_CREATION';
  const growthIdentity = await tx.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `growth:${suffix}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: isContentCreation ? 'NEW_CONTENT_OPPORTUNITY' : 'QUERY_PAGE_GROWTH',
      normalizedQuery: '興善堂',
      canonicalPage: isContentCreation ? null : targetUrl,
      identityPayload: { fixture: true }
    }
  });

  const growthProvenance = {
    version: 'GROWTH_SEARCH_PROVENANCE_V1',
    mode: 'CONFIGURED_MARKET',
    scoringLane: {
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketProjections: [
        { marketCode: 'HK', locale: 'zh-Hant', propertyRef: `gsc:${suffix}` }
      ]
    },
    corroboratingLanes: []
  } as const;

  const growthSnapshot = await tx.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-06-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-06-28T00:00:00.000Z'),
      previousWindowStart: new Date('2026-05-04T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-05-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-06-29T00:00:00.000Z'),
      primaryType: isContentCreation ? 'NEW_CONTENT_OPPORTUNITY' : 'CTR_UNDERPERFORMANCE',
      secondaryTypes: [],
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: growthProvenance
    }
  });

  const growthLifecycle = await tx.growthOpportunityLifecycle.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      status: 'PLANNED',
      latestSnapshotId: growthSnapshot.id,
      plannedAt: new Date('2026-06-29T01:00:00.000Z')
    }
  });

  const candidate = await tx.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: growthIdentity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${suffix}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      opportunityType: isContentCreation ? 'NEW_CONTENT_OPPORTUNITY' : 'CTR_UNDERPERFORMANCE',
      normalizedQuery: '興善堂',
      canonicalPage: isContentCreation ? null : targetUrl,
      growthScore: 80,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'PLANNED',
      sourceProvenance: growthProvenance,
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });

  const optimizationPlan = await tx.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType,
      sourceFactReferences: ['search-fact:authority'],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 7,
      finalRank: 8,
      advisoryContext: {},
      automationEligibility: false,
      explanation: { fixture: true }
    }
  });

  const optimizationRun = await tx.optimizationRun.create({
    data: {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: `run:${suffix}`,
      triggerPayload: { fixture: true },
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1,
      failureCount: 0,
      startedAt: new Date('2026-06-29T02:00:00.000Z'),
      planningCompletedAt: new Date('2026-06-29T02:01:00.000Z'),
      completedAt: new Date('2026-06-29T02:02:00.000Z')
    }
  });

  const optimizationRunItem = await tx.optimizationRunItem.create({
    data: {
      runId: optimizationRun.id,
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      itemKey: `item:${suffix}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      reasonCode: 'READY_FOR_POLICY',
      completedAt: new Date('2026-06-29T02:02:00.000Z')
    }
  });

  const autopilotPolicy = await tx.autopilotPolicy.create({
    data: {
      projectId: project.id,
      enabled: false
    }
  });

  const autopilotDecision = await tx.optimizationAutopilotDecision.create({
    data: {
      projectId: project.id,
      runId: optimizationRun.id,
      runItemId: optimizationRunItem.id,
      optimizationPlanId: optimizationPlan.id,
      policyId: autopilotPolicy.id,
      policyVersion: autopilotPolicy.policyVersion,
      policySnapshot: { fixture: true },
      sourceSnapshot: { fixture: true },
      status: 'MANUAL_REQUIRED',
      reasonCodes: ['AUTHORITY_FIXTURE'],
      decisionKey: `decision:${suffix}`
    }
  });

  const proposal = await tx.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'P9-D authority fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });
  const draft = await tx.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-D authority fixture',
      body: 'fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const site = await tx.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-D authority fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });
  const channel = await tx.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/page',
      displayName: 'P9-D page'
    }
  });
  const publicationPlan = await tx.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: targetUrl,
      targetRepository: 'fixture/repository',
      targetBranch: 'main',
      baseSha: 'a'.repeat(40),
      operations: [{ type: isContentCreation ? 'CREATE_CONTENT_PAGE' : 'UPDATE_CONTENT_PAGE', path: '/page' }],
      expectedOutcomes: [],
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: 'b'.repeat(64)
    }
  });
  const approval = await tx.publicationApproval.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      planVersion: publicationPlan.version,
      planHash: publicationPlan.planHash,
      contentVersion: 1,
      contentHash: 'c'.repeat(64),
      previewHash: 'd'.repeat(64),
      baseSha: publicationPlan.baseSha,
      targetRepository: publicationPlan.targetRepository,
      targetBranch: publicationPlan.targetBranch,
      targetBlobHashes: {},
      approverActorId: 'p9-d-authority',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: []
    }
  });

  const automationAuthorization = await tx.publicationAutomationAuthorization.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      planVersion: publicationPlan.version,
      planHash: publicationPlan.planHash,
      contentVersion: 1,
      contentHash: 'c'.repeat(64),
      previewHash: 'd'.repeat(64),
      baseSha: publicationPlan.baseSha,
      targetRepository: publicationPlan.targetRepository,
      targetBranch: publicationPlan.targetBranch,
      targetBlobHashes: {},
      authorizedRiskClass: 'LOW',
      automationDecisionId: autopilotDecision.id,
      automationPolicyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
      automationPolicyHash: 'e'.repeat(64),
      automationSource: 'P9_C_CONTROLLED_AUTOPILOT'
    }
  });

  const execution = await tx.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:${suffix}`,
      status: 'VERIFIED'
    }
  });
  const verifiedAnchorAt = new Date('2026-07-01T00:00:00.000Z');
  const verification = await tx.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: 'VERIFIED',
      observedUrl: targetUrl,
      observedAt: verifiedAnchorAt
    }
  });

  const searchSnapshot = await tx.searchFactSnapshot.create({
    data: {
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: `gsc:unrelated:${suffix}`,
      propertyType: 'URL_PREFIX',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `search-source:${suffix}`,
      sourceCutoffAt: new Date('2026-05-01T00:00:00.000Z'),
      sourceCompleteness: 'COMPLETE',
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
      inputHash: 'f'.repeat(64),
      status: 'COMPLETED',
      factCount: 1,
      completedAt: new Date('2026-05-01T00:01:00.000Z')
    }
  });
  const searchFact = await tx.searchFact.create({
    data: {
      snapshotId: searchSnapshot.id,
      projectId: project.id,
      factKey: `fact:${suffix}`,
      factKind: 'QUERY',
      sourceObservationRef: `observation:${suffix}`,
      sourceDate: new Date('2026-05-01T00:00:00.000Z'),
      query: 'unrelated',
      normalizedQuery: 'unrelated',
      queryNormalizationVersion: 'QUERY_NORMALIZATION_V1'
    }
  });
  await tx.searchFactMetric.create({
    data: {
      factId: searchFact.id,
      metricSemantic: 'IMPRESSIONS',
      numericValue: 10,
      evidenceState: 'KNOWN_PRESENT',
      sourceField: 'impressions'
    }
  });

  const visibilitySnapshot = await tx.visibilityMetricSnapshot.create({
    data: {
      projectId: project.id,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRIC_V1',
      extractorVersion: 'VISIBILITY_EXTRACTOR_V1',
      subjectSetHash: `subjects-${suffix}`,
      subjectSnapshotJson: [],
      windowStart: new Date('2026-05-01T00:00:00.000Z'),
      windowEnd: new Date('2026-05-14T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-05-15T00:00:00.000Z'),
      scopeJson: {},
      scopeHash: `scope-${suffix}`,
      candidateObservationCount: 10,
      completedExtractionCount: 10,
      completedAt: new Date('2026-05-15T00:01:00.000Z')
    }
  });
  await tx.visibilityMetricRow.create({
    data: {
      visibilityMetricSnapshotId: visibilitySnapshot.id,
      projectId: project.id,
      metricType: 'MENTION_RATE',
      metricStatus: 'CALCULATED',
      dimensionType: 'OVERALL',
      dimensionKey: 'ALL',
      actorType: 'OWNED_ROLLUP',
      actorKey: 'OWNED',
      numerator: 4,
      denominator: 10,
      candidateObservationCount: 10,
      eligibleObservationCount: 10,
      notEligibleObservationCount: 0,
      unknownObservationCount: 0
    }
  });

  return {
    project,
    growthIdentity,
    growthSnapshot,
    growthLifecycle,
    candidate,
    optimizationPlan,
    optimizationRun,
    optimizationRunItem,
    autopilotDecision,
    proposal,
    publicationPlan,
    approval,
    automationAuthorization,
    execution,
    verification,
    verifiedAnchorAt,
    searchSnapshot,
    visibilitySnapshot,
    propertyRef: `gsc:${suffix}`
  };
}

async function authoritySnapshot(
  tx: Prisma.TransactionClient,
  fixture: Awaited<ReturnType<typeof seedAuthorityGraph>>
) {
  const projectId = fixture.project.id;
  return {
    growthIdentity: await tx.growthOpportunityIdentity.findUnique({ where: { id: fixture.growthIdentity.id } }),
    growthSnapshot: await tx.growthOpportunitySnapshot.findUnique({ where: { id: fixture.growthSnapshot.id } }),
    growthLifecycle: await tx.growthOpportunityLifecycle.findUnique({
      where: { opportunityIdentityId: fixture.growthIdentity.id }
    }),
    candidate: await tx.optimizationCandidate.findUnique({ where: { id: fixture.candidate.id } }),
    optimizationPlan: await tx.optimizationPlan.findUnique({ where: { id: fixture.optimizationPlan.id } }),
    optimizationRun: await tx.optimizationRun.findUnique({ where: { id: fixture.optimizationRun.id } }),
    optimizationRunItem: await tx.optimizationRunItem.findUnique({ where: { id: fixture.optimizationRunItem.id } }),
    autopilotDecision: await tx.optimizationAutopilotDecision.findUnique({ where: { id: fixture.autopilotDecision.id } }),
    publicationProposal: await tx.publicationProposal.findUnique({ where: { id: fixture.proposal.id } }),
    publicationPlan: await tx.publicationPlan.findUnique({ where: { id: fixture.publicationPlan.id } }),
    publicationApproval: await tx.publicationApproval.findUnique({ where: { id: fixture.approval.id } }),
    publicationAutomationAuthorization: await tx.publicationAutomationAuthorization.findUnique({
      where: { id: fixture.automationAuthorization.id }
    }),
    publicationExecution: await tx.publicationExecution.findUnique({ where: { id: fixture.execution.id } }),
    publicationVerification: await tx.publicationVerification.findUnique({ where: { id: fixture.verification.id } }),
    searchFactSnapshot: await tx.searchFactSnapshot.findUnique({ where: { id: fixture.searchSnapshot.id } }),
    searchFactCount: await tx.searchFact.count({ where: { projectId } }),
    searchFactMetricCount: await tx.searchFactMetric.count({ where: { fact: { projectId } } }),
    visibilityMetricSnapshot: await tx.visibilityMetricSnapshot.findUnique({ where: { id: fixture.visibilitySnapshot.id } }),
    visibilityMetricRowCount: await tx.visibilityMetricRow.count({ where: { projectId } }),
    experimentCount: await tx.optimizationExperiment.count({ where: { projectId } }),
    observationCount: await tx.optimizationExperimentObservation.count({ where: { projectId } })
  };
}

function fakeCompleteSearchFacts(input: {
  projectId: string;
  propertyRef: string;
  verifiedAnchorAt: Date;
}) {
  return Array.from({ length: 14 }, (_, index) => {
    const sourceDate = new Date(input.verifiedAnchorAt.getTime() + (index - 7) * DAY_MS);
    const baseline = index < 7;
    return {
      snapshotId: `authority-snapshot-${index}`,
      projectId: input.projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: input.propertyRef,
      propertyType: 'URL_PREFIX',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `source-${index}`,
      sourceObservationRef: `observation-${index}`,
      sourceCutoffAt: new Date(input.verifiedAnchorAt.getTime() + 7 * DAY_MS + index),
      sourceCompleteness: 'COMPLETE',
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
      factKey: `authority-fact-${index}`,
      factKind: 'QUERY_PAGE',
      sourceDate,
      query: '興善堂',
      normalizedQuery: '興善堂',
      queryNormalizationVersion: 'QUERY_NORMALIZATION_V1',
      page: 'unused-by-injected-source',
      canonicalPage: null,
      canonicalizationVersion: 'URL_CANONICALIZATION_V1',
      metrics: [
        {
          metricSemantic: 'CLICKS',
          numericValue: baseline ? 10 : 15,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'clicks'
        },
        {
          metricSemantic: 'IMPRESSIONS',
          numericValue: baseline ? 100 : 120,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'impressions'
        },
        {
          metricSemantic: 'CTR',
          numericValue: baseline ? 0.1 : 0.125,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'ctr'
        },
        {
          metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
          numericValue: 5,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'position'
        }
      ]
    } as const;
  });
}

describe('P9-D authority write boundary', () => {
  it('allows only immutable experiment rows to grow across real start + evaluation', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedAuthorityGraph(tx, 'SERP_SNIPPET_OPTIMIZATION');
      const repository = new OptimizationExperimentRepository(tx);
      const service = new OptimizationExperimentService(repository);
      const facts = fakeCompleteSearchFacts({
        projectId: fixture.project.id,
        propertyRef: fixture.propertyRef,
        verifiedAnchorAt: fixture.verifiedAnchorAt
      }).map((fact) => ({
        ...fact,
        canonicalPage: fixture.publicationPlan.targetPublicUrl
      }));
      (service as unknown as { searchSource: unknown }).searchSource = {
        listCompletedFacts: async () => facts
      };
      (service as unknown as { now: () => Date }).now = () =>
        new Date(fixture.verifiedAnchorAt.getTime() + 8 * DAY_MS);

      const before = await authoritySnapshot(tx, fixture);
      const started = await service.startFromVerifiedExecution({
        projectId: fixture.project.id,
        publicationExecutionId: fixture.execution.id
      });
      expect(started.kind).toBe('STARTED');
      if (started.kind !== 'STARTED') throw new Error('expected STARTED');

      const observation = await service.evaluateWindow({
        projectId: fixture.project.id,
        experimentId: started.experiment.id,
        windowType: '7D'
      });
      expect(observation).not.toBeNull();

      const after = await authoritySnapshot(tx, fixture);
      expect(after.experimentCount).toBe(before.experimentCount + 1);
      expect(after.observationCount).toBe(before.observationCount + 1);
      expect({ ...after, experimentCount: before.experimentCount, observationCount: before.observationCount })
        .toEqual(before);
      expect(after.optimizationPlan?.historicalRankAdjustment).toBe(7);
    });
  });

  it('stores CONTENT_CREATION without comparable query history as INCONCLUSIVE / NO_COMPARABLE_BASELINE and never fabricates zero', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedAuthorityGraph(tx, 'CONTENT_CREATION');
      const repository = new OptimizationExperimentRepository(tx);
      const service = new OptimizationExperimentService(repository);
      (service as unknown as { searchSource: unknown }).searchSource = {
        listCompletedFacts: async () => []
      };
      (service as unknown as { now: () => Date }).now = () =>
        new Date(fixture.verifiedAnchorAt.getTime() + 15 * DAY_MS);

      const started = await service.startFromVerifiedExecution({
        projectId: fixture.project.id,
        publicationExecutionId: fixture.execution.id
      });
      expect(started.kind).toBe('STARTED');
      if (started.kind !== 'STARTED') throw new Error('expected STARTED');

      const observation = await service.evaluateWindow({
        projectId: fixture.project.id,
        experimentId: started.experiment.id,
        windowType: '14D'
      });
      expect(observation).not.toBeNull();
      expect(observation).toMatchObject({
        coverageState: 'INSUFFICIENT',
        contaminationState: 'CLEAR',
        effectState: 'INCONCLUSIVE'
      });
      expect(observation?.reasonCodes).toContain('NO_COMPARABLE_BASELINE');

      const baseline = observation?.baselineMetricsJson;
      expect(JSON.stringify(baseline)).not.toMatch(/"value":0(?:[,}])/);
    });
  });
});

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

describe('P9-D static forbidden-authority boundary', () => {
  it('contains no provider, AI, Git, merge/deploy/rollback or authoritative update path', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '../../src/modules/optimization-experiments');
    const files = sourceFiles(root);
    const forbidden = [
      'deepseek.provider',
      'github-mutation.adapter',
      'mergePullRequest',
      'PublicationExecutionService.createHumanApprovedExecution',
      'PublicationExecutionService.createAutomationAuthorizedExecution',
      'authorizePublicationAutomation',
      'publicationAutomationPreparation',
      'optimizationPlan.update',
      'optimizationCandidate.update',
      'optimizationRun.update',
      'optimizationRunItem.update',
      'publicationExecution.update',
      'publicationVerification.update',
      'searchFact.update',
      'visibilityMetricSnapshot.update'
    ];

    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden
        .filter((needle) => source.includes(needle))
        .map((needle) => `${path.relative(root, file)}:${needle}`);
    });
    expect(violations).toEqual([]);
  });
});
