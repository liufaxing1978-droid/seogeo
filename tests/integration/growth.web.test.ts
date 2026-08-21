import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  GrowthEvidenceQuality,
  GrowthIdentityType,
  GrowthOpportunityType
} from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function project(label: string, planLevel: 'STANDARD' | 'ADVANCED' = 'ADVANCED') {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const value = await prisma.project.create({
    data: {
      name: `P7-A Growth Web ${label}`,
      slug: `p7a-growth-web-${suffix}`,
      primaryDomain: `p7a-growth-web-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(value.id);
  return value;
}

async function opportunity(input: {
  projectId: string;
  query: string;
  page?: string | null;
  identityType?: GrowthIdentityType;
  primaryType: GrowthOpportunityType;
  score: number;
  rankingEligible?: boolean;
  evidenceQuality?: GrowthEvidenceQuality;
  sourceProvenance?: Record<string, unknown>;
}) {
  const identityType = input.identityType ?? 'QUERY_PAGE_GROWTH';
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: input.projectId,
      opportunityKey: `${identityType}:${input.query}:${input.page ?? 'none'}:${Math.random()}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType,
      normalizedQuery: input.query,
      canonicalPage: input.page ?? null,
      identityPayload: { identityType }
    }
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId: input.projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-07-21T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-17T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-23T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-20T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-17T23:59:59.000Z'),
      primaryType: input.primaryType,
      secondaryTypes: [],
      score: input.score,
      priority: input.score >= 85 ? 'CRITICAL' : input.score >= 70 ? 'HIGH' : 'MEDIUM',
      scoreState: 'KNOWN',
      evidenceQuality: input.evidenceQuality ?? 'COMPLETE',
      evidenceCoverage: input.evidenceQuality === 'PARTIAL' ? 0.65 : 0.9,
      rankingEligible: input.rankingEligible ?? true,
      sourceProvenance: input.sourceProvenance ?? { privateMarker: 'PRIVATE_SOURCE_PROVENANCE' }
    }
  });
  await prisma.growthScoreBreakdown.create({
    data: {
      snapshotId: snapshot.id,
      demandState: 'KNOWN', demandScore: 90,
      positionPotentialState: 'KNOWN', positionPotentialScore: 85,
      ctrGapState: 'KNOWN', ctrGapScore: 60,
      siteGapState: 'KNOWN', siteGapScore: 70,
      gscTrendState: 'KNOWN', gscTrendScore: 50,
      p6VisibilityState: 'UNKNOWN', p6VisibilityScore: null,
      trendVisibilityDisplayState: 'KNOWN', trendVisibilityDisplayScore: 50,
      availableWeight: 90,
      evidenceCoverage: input.evidenceQuality === 'PARTIAL' ? 0.65 : 0.9,
      weightedTotal: input.score,
      formulaVersion: 'GROWTH_SCORE_V1'
    }
  });
  await prisma.growthOpportunityEvidence.create({
    data: {
      snapshotId: snapshot.id,
      projectId: input.projectId,
      sourceModule: 'P5_CONTENT',
      sourceType: 'CONTENT_SIGNAL',
      sourceId: `content-${identity.id}`,
      sourceFactVersion: '1',
      ruleKey: 'CONTENT_TOPIC_COVERAGE',
      rootCauseKey: 'CONTENT_TOPIC_COVERAGE',
      evidenceState: 'FAIL',
      severity: 'HIGH',
      textSummary: '页面主题覆盖不足，需要补充确定性内容证据。',
      fingerprint: `evidence-${identity.id}`
    }
  });
  await prisma.growthOpportunityLifecycle.create({
    data: { opportunityIdentityId: identity.id, status: 'NEW', latestSnapshotId: snapshot.id }
  });
  await prisma.growthOpportunityLifecycleEvent.create({
    data: {
      opportunityIdentityId: identity.id,
      eventType: 'CREATED',
      actorType: 'SYSTEM',
      toStatus: 'NEW',
      reasonCode: 'GROWTH_MATERIALIZED'
    }
  });
  return { identity, snapshot };
}

describe('P7-A Growth Opportunity Center web UI', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.growthOpportunityLifecycleEvent.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunityLifecycle.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunityEvidence.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthScoreBreakdown.deleteMany({ where: { snapshot: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunitySnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthTopicClusterSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthTopicCluster.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('defaults to ranking-eligible opportunities ordered by score and separates Evidence Quality from Priority', async () => {
    const p = await project('index');
    await opportunity({ projectId: p.id, query: '六壬历史', page: `https://${p.primaryDomain}/history`, primaryType: 'RANKING_UPSIDE', score: 82, evidenceQuality: 'PARTIAL' });
    await opportunity({ projectId: p.id, query: '六壬法脉', page: `https://${p.primaryDomain}/lineage`, primaryType: 'CTR_UNDERPERFORMANCE', score: 71 });
    await opportunity({ projectId: p.id, query: '不应展示', page: `https://${p.primaryDomain}/hidden`, primaryType: 'SEO_GAP', score: 95, rankingEligible: false });

    const response = await request(createApp()).get(`/projects/${p.id}/growth`).expect(200);
    expect(response.text).toContain('Growth Opportunity Center');
    expect(response.text).toContain('Evidence Quality');
    expect(response.text).toContain('Priority');
    expect(response.text).toContain('PARTIAL');
    expect(response.text).not.toContain('不应展示');
    expect(response.text.indexOf('六壬历史')).toBeLessThan(response.text.indexOf('六壬法脉'));
  });

  it('renders deterministic detail sections and keeps AI visibly advisory', async () => {
    const p = await project('detail');
    const row = await opportunity({
      projectId: p.id,
      query: '六壬历史专题',
      page: `https://${p.primaryDomain}/history`,
      primaryType: 'RANKING_UPSIDE',
      score: 84
    });

    const response = await request(createApp()).get(`/projects/${p.id}/growth/opportunities/${row.identity.id}`).expect(200);
    expect(response.text).toContain('为什么现在值得处理');
    expect(response.text).toContain('Score Breakdown');
    expect(response.text).toContain('当前窗口');
    expect(response.text).toContain('前一窗口');
    expect(response.text).toContain('Evidence');
    expect(response.text).toContain('Lifecycle');
    expect(response.text).toContain('AI 解读（辅助）');
    expect(response.text).toContain('页面主题覆盖不足');
    expect(response.text).not.toContain('PRIVATE_SOURCE_PROVENANCE');
  });

  it('renders Topic, Cannibalization and New Content special views without execution controls', async () => {
    const p = await project('special');
    const topic = await prisma.growthTopicCluster.create({
      data: {
        projectId: p.id,
        topicKey: '六壬文化',
        topicIdentityVersion: 'GROWTH_TOPIC_IDENTITY_V1',
        primaryQuery: '六壬文化'
      }
    });
    await prisma.growthTopicClusterSnapshot.create({
      data: {
        topicClusterId: topic.id,
        projectId: p.id,
        snapshotVersion: 'GROWTH_TOPIC_SNAPSHOT_V1',
        currentWindowStart: new Date('2026-07-21T00:00:00.000Z'),
        currentWindowEnd: new Date('2026-08-17T00:00:00.000Z'),
        previousWindowStart: new Date('2026-06-23T00:00:00.000Z'),
        previousWindowEnd: new Date('2026-07-20T00:00:00.000Z'),
        dataCutoffAt: new Date('2026-08-17T23:59:59.000Z'),
        memberQueries: ['六壬文化', '六壬历史'],
        memberPages: [`https://${p.primaryDomain}/history`],
        sourceProvenance: {},
        totalImpressions: 5000,
        totalClicks: 300,
        ctr: 0.06,
        position: 11.2,
        topOpportunityScore: 84,
        topicScore: 80,
        priority: 'HIGH',
        scoreState: 'KNOWN',
        evidenceQuality: 'COMPLETE',
        evidenceCoverage: 0.9,
        rankingEligible: true,
        trendVisibilityState: 'KNOWN'
      }
    });

    await opportunity({
      projectId: p.id,
      query: '六壬祖师',
      identityType: 'KEYWORD_CANNIBALIZATION',
      primaryType: 'KEYWORD_CANNIBALIZATION',
      score: 78,
      sourceProvenance: {
        detector: {
          type: 'KEYWORD_CANNIBALIZATION',
          competingPages: [`https://${p.primaryDomain}/a`, `https://${p.primaryDomain}/b`],
          primaryPageCandidate: `https://${p.primaryDomain}/a`
        }
      }
    });
    await opportunity({
      projectId: p.id,
      query: '六壬历史资料',
      identityType: 'NEW_CONTENT_OPPORTUNITY',
      primaryType: 'NEW_CONTENT_OPPORTUNITY',
      score: 76,
      sourceProvenance: {
        detector: {
          type: 'NEW_CONTENT_OPPORTUNITY',
          reasonCodes: ['DEMAND_ELIGIBLE', 'NO_TOP_20_EXISTING_PAGE', 'P3_P5_COVERAGE_GAP']
        }
      }
    });

    const topics = await request(createApp()).get(`/projects/${p.id}/growth/topics`).expect(200);
    expect(topics.text).toContain('Topic Clusters');
    expect(topics.text).toContain('六壬文化');

    const cannibalization = await request(createApp()).get(`/projects/${p.id}/growth/cannibalization`).expect(200);
    expect(cannibalization.text).toContain('Keyword Cannibalization');
    expect(cannibalization.text).toContain(`https://${p.primaryDomain}/a`);
    expect(cannibalization.text).toContain(`https://${p.primaryDomain}/b`);
    expect(cannibalization.text).not.toContain('执行重定向');
    expect(cannibalization.text).not.toContain('修改 Canonical');

    const newContent = await request(createApp()).get(`/projects/${p.id}/growth/new-content`).expect(200);
    expect(newContent.text).toContain('New Content Opportunities');
    expect(newContent.text).toContain('建议评估新建专门内容页');
  });

  it('blocks Advanced-only special views for Standard before rendering restricted data', async () => {
    const p = await project('standard', 'STANDARD');
    await request(createApp()).get(`/projects/${p.id}/growth/topics`).expect(403);
    await request(createApp()).get(`/projects/${p.id}/growth/cannibalization`).expect(403);
    await request(createApp()).get(`/projects/${p.id}/growth/new-content`).expect(403);
  });
});