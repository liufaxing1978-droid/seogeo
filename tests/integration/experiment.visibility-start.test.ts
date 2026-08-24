import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationExperimentRepository } from '../../src/modules/optimization-experiments/experiment.repository.js';
import { OptimizationExperimentService } from '../../src/modules/optimization-experiments/experiment.service.js';

const ROLLBACK_SENTINEL = 'P9_D_VISIBILITY_START_ROLLBACK';

async function withRollback(run: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
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

async function seedVerifiedVisibilityGraph(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const targetUrl = `https://${suffix}.example.com/page`;
  const project = await tx.project.create({
    data: {
      name: `P9-D visibility ${suffix}`,
      slug: `p9-d-visibility-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  const identity = await tx.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `growth:${suffix}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: '興善堂',
      canonicalPage: targetUrl,
      identityPayload: { fixture: true }
    }
  });

  const growthSnapshot = await tx.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-08-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
      previousWindowStart: new Date('2026-07-25T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      primaryType: 'GEO_CITABILITY_GAP',
      secondaryTypes: [],
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: { version: 'P6_VISIBILITY_PROVENANCE_V1' }
    }
  });

  const metricSnapshot = await tx.visibilityMetricSnapshot.create({
    data: {
      projectId: project.id,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'VISIBILITY_EXTRACTION_V1',
      subjectSetHash: 'a'.repeat(64),
      subjectSnapshotJson: { owned: ['興善堂'] },
      windowStart: new Date('2026-08-01T00:00:00.000Z'),
      windowEnd: new Date('2026-08-07T23:59:59.000Z'),
      inputCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      scopeJson: { marketCode: 'HK', locale: 'zh-Hant' },
      scopeHash: 'b'.repeat(64),
      candidateObservationCount: 12,
      completedExtractionCount: 12,
      missingExtractionCount: 0,
      failedExtractionCount: 0,
      completedAt: new Date('2026-08-08T00:00:00.000Z')
    }
  });

  const metricRow = await tx.visibilityMetricRow.create({
    data: {
      visibilityMetricSnapshotId: metricSnapshot.id,
      projectId: project.id,
      metricType: 'CITATION_RATE',
      metricStatus: 'CALCULATED',
      dimensionType: 'OVERALL',
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP',
      actorKey: 'OWNED_ROLLUP',
      numerator: 6,
      denominator: 12,
      candidateObservationCount: 12,
      eligibleObservationCount: 12,
      notEligibleObservationCount: 0,
      unknownObservationCount: 0
    }
  });

  await tx.growthOpportunityEvidence.create({
    data: {
      snapshotId: growthSnapshot.id,
      projectId: project.id,
      sourceModule: 'P6_VISIBILITY',
      sourceType: 'VISIBILITY_METRIC_ROW',
      sourceId: metricRow.id,
      sourceFactVersion: `${metricSnapshot.formulaVersion}:${metricSnapshot.id}`,
      ruleKey: 'P6_CITATION_RATE',
      rootCauseKey: 'geo-citability-gap',
      evidenceState: 'FAIL',
      severity: 'HIGH',
      numericValue: 0.5,
      textSummary: 'Persisted P6 citation-rate evidence',
      fingerprint: `p6-citation:${suffix}`
    }
  });

  const candidate = await tx.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${suffix}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      opportunityType: 'GEO_CITABILITY_GAP',
      normalizedQuery: '興善堂',
      canonicalPage: targetUrl,
      growthScore: 80,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: { version: 'P9_A_SOURCE_PROVENANCE_V1' },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });

  const optimizationPlan = await tx.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'GEO_CITABILITY_IMPROVEMENT',
      sourceFactReferences: [`visibility-row:${metricRow.id}`],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: { fixture: true }
    }
  });

  const proposal = await tx.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'P9-D visibility start fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });
  const draft = await tx.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-D visibility start fixture',
      body: 'fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const site = await tx.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-D visibility start fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });
  const publicationPlan = await tx.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      version: 1,
      targetPublicUrl: targetUrl,
      targetRepository: 'fixture/repository',
      targetBranch: 'main',
      baseSha: 'c'.repeat(40),
      operations: [{ type: 'UPDATE_CONTENT_PAGE', path: '/page' }],
      expectedOutcomes: [],
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: 'd'.repeat(64)
    }
  });
  const approval = await tx.publicationApproval.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      planVersion: publicationPlan.version,
      planHash: publicationPlan.planHash,
      contentVersion: 1,
      contentHash: 'e'.repeat(64),
      previewHash: 'f'.repeat(64),
      baseSha: publicationPlan.baseSha,
      targetRepository: publicationPlan.targetRepository,
      targetBranch: publicationPlan.targetBranch,
      targetBlobHashes: {},
      approverActorId: 'p9-d-test',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: []
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
  await tx.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: 'VERIFIED',
      observedUrl: targetUrl,
      observedAt: new Date('2026-08-24T00:00:00.000Z')
    }
  });

  return { project, execution, metricSnapshot };
}

describe('P9-D persisted P6 visibility start', () => {
  it('starts GEO citability experiment from persisted P6 citation evidence without an injected source port', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedVerifiedVisibilityGraph(tx);
      const service = new OptimizationExperimentService(new OptimizationExperimentRepository(tx));

      const result = await service.startFromVerifiedExecution({
        projectId: fixture.project.id,
        publicationExecutionId: fixture.execution.id
      });

      expect(result.kind).toBe('STARTED');
      if (result.kind !== 'STARTED') throw new Error(`expected STARTED, received ${result.kind}`);
      expect(result.experiment.measurementScopeJson).toEqual({
        kind: 'VISIBILITY',
        metricType: 'CITATION_RATE',
        subjectSetHash: fixture.metricSnapshot.subjectSetHash,
        scopeHash: fixture.metricSnapshot.scopeHash,
        formulaVersion: fixture.metricSnapshot.formulaVersion,
        extractorVersion: fixture.metricSnapshot.extractorVersion,
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP'
      });
    });
  });
});
