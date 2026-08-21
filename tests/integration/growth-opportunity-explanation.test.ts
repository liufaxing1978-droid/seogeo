import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import {
  GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID,
  buildGrowthOpportunityExplanationTaskInput,
  createGrowthOpportunityExplanationTask,
  parseGrowthOpportunityExplanationOutput
} from '../../src/modules/ai/growth-opportunity-explanation.js';

const projectIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED', label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `Growth AI ${label}`,
      slug: `growth-ai-${suffix}`,
      primaryDomain: `growth-ai-${suffix}.example.com`,
      planLevel,
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function seedOpportunity(projectId: string) {
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `growth-ai-${projectId}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: '兴善堂 民间信仰',
      canonicalPage: 'https://example.com/minjian-xinyang',
      identityPayload: { private: 'PRIVATE IDENTITY PAYLOAD MUST NOT REACH AI' }
    }
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-07-12T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-08T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-14T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-11T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
      primaryType: 'DECLINING_PERFORMANCE',
      secondaryTypes: ['SEO_GAP'],
      score: 86,
      priority: 'CRITICAL',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: { private: 'PRIVATE SOURCE PROVENANCE MUST NOT REACH AI' }
    }
  });
  await prisma.growthScoreBreakdown.create({
    data: {
      snapshotId: snapshot.id,
      demandState: 'KNOWN',
      demandScore: 85,
      positionPotentialState: 'KNOWN',
      positionPotentialScore: 100,
      ctrGapState: 'KNOWN',
      ctrGapScore: 60,
      siteGapState: 'KNOWN',
      siteGapScore: 100,
      gscTrendState: 'KNOWN',
      gscTrendScore: 75,
      p6VisibilityState: 'UNKNOWN',
      p6VisibilityScore: null,
      trendVisibilityDisplayState: 'KNOWN',
      trendVisibilityDisplayScore: 75,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: 86,
      formulaVersion: 'GROWTH_SCORE_V1'
    }
  });
  const evidence = await prisma.growthOpportunityEvidence.create({
    data: {
      snapshotId: snapshot.id,
      projectId,
      sourceModule: 'P2_SEO',
      sourceType: 'SEO_ISSUE',
      sourceId: 'seo-issue-fixture',
      sourceFactVersion: 'SEO_RULE_V1',
      ruleKey: 'title_missing',
      rootCauseKey: 'page:title',
      evidenceState: 'FAIL',
      severity: 'HIGH',
      textSummary: 'Persisted title evidence is failing.',
      fingerprint: `growth-ai-evidence-${projectId}`
    }
  });
  await prisma.growthOpportunityLifecycle.create({
    data: {
      opportunityIdentityId: identity.id,
      status: 'REVIEWED',
      latestSnapshotId: snapshot.id,
      reviewedAt: new Date('2026-08-09T00:00:00.000Z')
    }
  });
  return { identity, snapshot, evidence };
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.aiTask.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P7-A GROWTH_OPPORTUNITY_EXPLANATION', () => {
  it('builds a bounded safe packet from the latest persisted snapshot and validates every returned source ref', async () => {
    const project = await createProject('ADVANCED', 'packet');
    const seeded = await seedOpportunity(project.id);

    const input = await buildGrowthOpportunityExplanationTaskInput(project.id, seeded.identity.id);
    expect(input.taskType).toBe('GROWTH_OPPORTUNITY_EXPLANATION');
    expect(input.promptVersion).toBe(GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID);
    expect(input.requestKey).toBe(`growth-opportunity-explanation:${seeded.snapshot.id}:${GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID}`);

    const packet = JSON.stringify(input.factSnapshot);
    expect(packet).toContain(project.id);
    expect(packet).toContain(seeded.identity.id);
    expect(packet).toContain(seeded.snapshot.id);
    expect(packet).toContain(seeded.evidence.id);
    expect(packet).toContain('DECLINING_PERFORMANCE');
    expect(packet).toContain('86');
    expect(packet).not.toContain('PRIVATE IDENTITY PAYLOAD MUST NOT REACH AI');
    expect(packet).not.toContain('PRIVATE SOURCE PROVENANCE MUST NOT REACH AI');
    expect(packet).not.toContain('identityPayload');
    expect(packet).not.toContain('sourceProvenance');
    expect((input.factSnapshot as any).evidence.length).toBeLessThanOrEqual(50);

    const refs = input.sourceReferences as Array<{ type: string; id: string }>;
    const snapshotRef = `GROWTH_OPPORTUNITY_SNAPSHOT:${seeded.snapshot.id}`;
    const evidenceRef = `GROWTH_OPPORTUNITY_EVIDENCE:${seeded.evidence.id}`;
    const valid = JSON.stringify({
      summary: 'The opportunity is critical because persisted demand, position and site-gap evidence are strong.',
      whyNow: 'The deterministic Growth score is 86 and the primary type is declining performance.',
      actions: [{
        priority: 'HIGH',
        action: 'Repair the persisted title gap and reassess after the next stable window.',
        rationale: 'The supplied SEO evidence is failing and contributes to the site-gap signal.',
        sourceRefs: [snapshotRef, evidenceRef]
      }],
      caveats: ['P6 visibility is UNKNOWN and must not be treated as zero.'],
      sourceReferences: [snapshotRef, evidenceRef]
    });
    expect(parseGrowthOpportunityExplanationOutput(valid, refs).summary).toContain('critical');
    expect(() => parseGrowthOpportunityExplanationOutput(valid.replace(evidenceRef, 'GROWTH_OPPORTUNITY_EVIDENCE:invented'), refs)).toThrow();
  });

  it('uses one idempotent task per opportunity snapshot and stores DeepSeek output only as advisory AI result', async () => {
    const project = await createProject('ADVANCED', 'worker');
    const seeded = await seedOpportunity(project.id);
    const queue = { add: vi.fn(async () => undefined) };
    const service = new AiTaskService(new AiRepository(), queue);

    const first = await createGrowthOpportunityExplanationTask(project.id, seeded.identity.id, service);
    const second = await createGrowthOpportunityExplanationTask(project.id, seeded.identity.id, service);
    expect(second.id).toBe(first.id);
    expect(queue.add).toHaveBeenCalledTimes(1);

    const before = {
      snapshots: await prisma.growthOpportunitySnapshot.count({ where: { projectId: project.id } }),
      breakdowns: await prisma.growthScoreBreakdown.count({ where: { snapshot: { projectId: project.id } } }),
      evidence: await prisma.growthOpportunityEvidence.count({ where: { projectId: project.id } }),
      lifecycle: await prisma.growthOpportunityLifecycle.findUniqueOrThrow({ where: { opportunityIdentityId: seeded.identity.id } })
    };
    const snapshotRef = `GROWTH_OPPORTUNITY_SNAPSHOT:${seeded.snapshot.id}`;
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-reasoner',
        responseId: 'growth-explanation-fixture',
        content: JSON.stringify({
          summary: 'Advisory explanation grounded in the persisted Growth snapshot.',
          whyNow: 'The deterministic score is critical.',
          actions: [{ priority: 'HIGH', action: 'Review the title gap.', rationale: 'The supplied evidence says it is failing.', sourceRefs: [snapshotRef] }],
          caveats: ['This explanation does not change deterministic facts.'],
          sourceReferences: [snapshotRef]
        }),
        finishReason: 'stop',
        latencyMs: 80,
        usage: { promptTokens: 90, completionTokens: 35, totalTokens: 125, cacheHitTokens: 0, cacheMissTokens: 90, reasoningTokens: 18 }
      }))
    };

    await executeAiTask(first.id, { repository: new AiRepository(), gateway });

    const stored = await prisma.aiTask.findUniqueOrThrow({ where: { id: first.id }, include: { runs: { include: { result: true } } } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.taskType).toBe('GROWTH_OPPORTUNITY_EXPLANATION');
    expect(stored.runs[0]?.result).toMatchObject({
      resultType: 'GROWTH_OPPORTUNITY_EXPLANATION',
      summary: 'Advisory explanation grounded in the persisted Growth snapshot.',
      provider: 'DEEPSEEK',
      promptVersion: GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID
    });
    expect(await prisma.growthOpportunitySnapshot.count({ where: { projectId: project.id } })).toBe(before.snapshots);
    expect(await prisma.growthScoreBreakdown.count({ where: { snapshot: { projectId: project.id } } })).toBe(before.breakdowns);
    expect(await prisma.growthOpportunityEvidence.count({ where: { projectId: project.id } })).toBe(before.evidence);
    expect(await prisma.growthOpportunityLifecycle.findUniqueOrThrow({ where: { opportunityIdentityId: seeded.identity.id } })).toEqual(before.lifecycle);
  });

  it('exposes the advisory enqueue endpoint only to Advanced/Enterprise plans', async () => {
    const standard = await createProject('STANDARD', 'gate');
    const advanced = await createProject('ADVANCED', 'api');
    const seeded = await seedOpportunity(advanced.id);
    const app = createApp();

    await request(app)
      .post(`/api/v1/projects/${standard.id}/growth/opportunities/00000000-0000-0000-0000-000000000000/explanation`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    await request(app)
      .post(`/api/v1/projects/${advanced.id}/growth/opportunities/${seeded.identity.id}/explanation`)
      .send({})
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          projectId: advanced.id,
          taskType: 'GROWTH_OPPORTUNITY_EXPLANATION',
          promptVersion: GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID
        });
        expect(body.data.factSnapshot).toBeUndefined();
        expect(body.data.sourceReferences).toBeUndefined();
      });
  });
});
