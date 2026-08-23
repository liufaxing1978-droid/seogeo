import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { PublicationAutomationPreparationService } from '../../src/modules/publication/publication-automation-preparation.js';

const AUTOMATIC_REF_TYPES = [
  'GROWTH_OPPORTUNITY_IDENTITY',
  'GROWTH_OPPORTUNITY_SNAPSHOT',
  'GROWTH_OPPORTUNITY_EVIDENCE'
] as const;

async function createFixture(
  recommendedActionType:
    | 'CONTENT_CREATION'
    | 'CONTENT_REFRESH'
    | 'ON_PAGE_OPTIMIZATION' = 'CONTENT_CREATION',
  includeInvalidSourceReference = false
) {
  const suffix = `${Date.now()}-${Math.random()}`.replace('.', '-');
  const project = await prisma.project.create({
    data: {
      name: `P9-C preparation ${suffix}`,
      slug: `p9c-prep-${suffix}`,
      primaryDomain: `p9c-prep-${suffix}.example.com`,
      planLevel: 'ADVANCED',
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });

  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `identity-${suffix}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'NEW_CONTENT_OPPORTUNITY',
      normalizedQuery: '六壬伏英舘文化源流',
      canonicalPage: null,
      identityPayload: {
        normalizedQuery: '六壬伏英舘文化源流',
        privateRawProviderPayload: 'must-never-enter-p8-ai'
      }
    }
  });

  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_FORMULA_V1',
      currentWindowStart: new Date('2026-07-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-01T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-06-30T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-01T00:00:00.000Z'),
      primaryType: 'NEW_CONTENT_OPPORTUNITY',
      secondaryTypes: [],
      score: 82,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 100,
      rankingEligible: true,
      sourceProvenance: {
        provider: 'fixture-provider',
        rawProviderPayload: 'must-never-enter-p8-ai'
      }
    }
  });

  const evidence = await prisma.growthOpportunityEvidence.create({
    data: {
      snapshotId: snapshot.id,
      projectId: project.id,
      sourceModule: 'P5_CONTENT',
      sourceType: 'FIXTURE_FACT',
      sourceId: `source-${suffix}`,
      sourceFactVersion: 'FACT_V1',
      ruleKey: 'new-content-gap',
      rootCauseKey: 'content-gap',
      evidenceState: 'PASS',
      severity: 'MEDIUM',
      textSummary: 'raw evidence summary must not be copied into the P8 AI packet',
      fingerprint: `fingerprint-${suffix}`
    }
  });

  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: snapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `p9ccontentseed${suffix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      opportunityType: 'NEW_CONTENT_OPPORTUNITY',
      normalizedQuery: '六壬伏英舘文化源流',
      canonicalPage: null,
      growthScore: 82,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 100,
      growthRankingEligible: true,
      growthLifecycleStatus: 'PLANNED',
      sourceProvenance: { rawOptimizationPayload: 'must-never-enter-p8-ai' },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });

  const sourceFactReferences: Array<{ type: string; id: string }> = [
    { type: AUTOMATIC_REF_TYPES[0], id: identity.id },
    { type: AUTOMATIC_REF_TYPES[1], id: snapshot.id },
    { type: AUTOMATIC_REF_TYPES[2], id: evidence.id }
  ];
  if (includeInvalidSourceReference) {
    sourceFactReferences.push({ type: 'RAW_PROVIDER_PAYLOAD', id: randomUUID() });
  }
  const plan = await prisma.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType,
      sourceFactReferences,
      deterministicRank: 10,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 10,
      advisoryContext: {},
      automationEligibility: true,
      explanation: { summary: 'bounded plan explanation' }
    }
  });

  const run = await prisma.optimizationRun.create({
    data: {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerKey: `run-${suffix}`,
      triggerPayload: { source: 'fixture' },
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1,
      planningCompletedAt: new Date('2026-08-24T00:00:00.000Z'),
      completedAt: new Date('2026-08-24T00:01:00.000Z')
    }
  });
  const runItem = await prisma.optimizationRunItem.create({
    data: {
      runId: run.id,
      projectId: project.id,
      optimizationPlanId: plan.id,
      itemKey: `item-${suffix}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      completedAt: new Date('2026-08-24T00:01:00.000Z')
    }
  });

  return {
    project,
    identity,
    snapshot,
    evidence,
    candidate,
    plan,
    run,
    runItem,
    sourceFactReferences,
    decisionId: randomUUID()
  };
}

function serviceHarness() {
  const queue = { add: vi.fn(async () => undefined) };
  const aiTaskService = new AiTaskService(new AiRepository(), queue);
  const service = new PublicationAutomationPreparationService({ aiTaskService });
  return { queue, service };
}

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Project" CASCADE');
});

describe('P9-C -> P8 controlled content preparation', () => {
  it('creates one bounded P9 proposal, deterministic seed draft, internal source refs and brief task, then reuses them on retry', async () => {
    const fixture = await createFixture('CONTENT_CREATION');
    const { queue, service } = serviceHarness();
    const input = {
      projectId: fixture.project.id,
      runItemId: fixture.runItem.id,
      optimizationPlanId: fixture.plan.id,
      decisionId: fixture.decisionId
    };

    const first = await service.prepareContentCreation(input);
    const second = await service.prepareContentCreation(input);

    expect(first).toMatchObject({
      state: 'WAITING_FOR_BRIEF',
      planId: null,
      previewId: null,
      reasonCode: null
    });
    expect(second).toEqual(first);
    expect(first.proposalId).toEqual(expect.any(String));
    expect(first.draftId).toEqual(expect.any(String));

    const proposals = await prisma.publicationProposal.findMany({
      where: { projectId: fixture.project.id }
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      sourceType: 'P9_OPTIMIZATION_PLAN',
      sourceReferenceId: fixture.plan.id,
      sourceSnapshotId: fixture.runItem.id
    });
    expect(proposals[0]?.sourceMetadata).toMatchObject({
      candidateId: fixture.candidate.id,
      candidateKey: fixture.candidate.candidateKey,
      decisionId: fixture.decisionId,
      recommendedActionType: 'CONTENT_CREATION'
    });
    const metadataText = JSON.stringify(proposals[0]?.sourceMetadata ?? null);
    expect(metadataText).not.toContain('sourceProvenance');
    expect(metadataText).not.toContain('rawOptimizationPayload');
    expect(metadataText).not.toContain('rawProviderPayload');

    const drafts = await prisma.contentDraft.findMany({
      where: { projectId: fixture.project.id }
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      sourceProposalId: proposals[0]?.id,
      title: fixture.candidate.normalizedQuery,
      slugCandidate: `p9-${fixture.candidate.candidateKey.slice(0, 16)}`,
      body: `# ${fixture.candidate.normalizedQuery}\n\n<!-- Controlled-autopilot seed; generated article revision required before planning. -->`,
      currentVersion: 1,
      generatedBy: 'DETERMINISTIC_GENERATOR'
    });

    const refs = await prisma.contentSourceReference.findMany({
      where: { projectId: fixture.project.id, draftId: drafts[0]?.id },
      orderBy: [{ sourceType: 'asc' }, { id: 'asc' }]
    });
    expect(refs).toHaveLength(3);
    expect(refs.map((item) => item.sourceType).sort()).toEqual([...AUTOMATIC_REF_TYPES].sort());
    for (const ref of refs) {
      expect(ref.internalRef).toBe(true);
      expect(ref.userProvided).toBe(false);
      expect(ref.author).toBeNull();
      expect(ref.publisher).toBeNull();
      expect(ref.sourceUrl).toBeNull();
      const source = fixture.sourceFactReferences.find((item) => item.type === ref.sourceType);
      expect(source).toBeDefined();
      expect(ref.title).toContain(source!.id);
    }

    const tasks = await prisma.aiTask.findMany({ where: { projectId: fixture.project.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ taskType: 'PUBLICATION_CONTENT_BRIEF' });
    expect(JSON.stringify(tasks[0]?.factSnapshot ?? null)).not.toContain('must-never-enter-p8-ai');
    expect(JSON.stringify(tasks[0]?.factSnapshot ?? null)).not.toContain('sourceProvenance');
    expect(JSON.stringify(tasks[0]?.factSnapshot ?? null)).not.toContain('textSummary');
    expect(queue.add).toHaveBeenCalledTimes(1);

    expect(await prisma.publicationPlan.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.publicationPreview.count({ where: { projectId: fixture.project.id } })).toBe(0);
  });

  it('keeps non-CONTENT_CREATION actions manual and creates no P8 preparation artifacts', async () => {
    const fixture = await createFixture('CONTENT_REFRESH');
    const { queue, service } = serviceHarness();

    const result = await service.prepareContentCreation({
      projectId: fixture.project.id,
      runItemId: fixture.runItem.id,
      optimizationPlanId: fixture.plan.id,
      decisionId: fixture.decisionId
    });

    expect(result).toMatchObject({
      state: 'MANUAL_REQUIRED',
      proposalId: null,
      draftId: null,
      planId: null,
      previewId: null
    });
    expect(result.reasonCode).toEqual(expect.any(String));
    expect(await prisma.publicationProposal.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.contentDraft.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.aiTask.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('fails closed when a persisted P9 source reference is not allowlisted for P8 preparation', async () => {
    const fixture = await createFixture('CONTENT_CREATION', true);
    const { queue, service } = serviceHarness();

    const result = await service.prepareContentCreation({
      projectId: fixture.project.id,
      runItemId: fixture.runItem.id,
      optimizationPlanId: fixture.plan.id,
      decisionId: fixture.decisionId
    });

    expect(result).toMatchObject({
      state: 'MANUAL_REQUIRED',
      proposalId: null,
      draftId: null,
      planId: null,
      previewId: null
    });
    expect(result.reasonCode).toEqual(expect.any(String));
    expect(await prisma.publicationProposal.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.contentDraft.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
