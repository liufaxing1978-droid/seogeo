import type { GrowthRestRepository } from './growth.routes.js';
import { growthRestRepository } from './growth.routes.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === 'string');
}

function safeSnapshot(value: unknown): Record<string, unknown> {
  const source = record(value);
  const { sourceProvenance: _privateProvenance, ...safe } = source;
  return safe;
}

function safeDetail(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const source = record(value);
  return {
    identity: record(source.identity),
    snapshot: safeSnapshot(source.snapshot),
    breakdown: record(source.breakdown),
    evidence: array(source.evidence).map(record),
    history: array(source.history).map(safeSnapshot),
    lifecycle: source.lifecycle ? record(source.lifecycle) : null,
    lifecycleEvents: array(source.lifecycleEvents).map(record)
  };
}

function safeCannibalization(value: unknown): Record<string, unknown> {
  const source = record(value);
  const identity = record(source.identity);
  const detector = record(record(source.sourceProvenance).detector);
  return {
    id: identity.id,
    normalizedQuery: identity.normalizedQuery,
    score: source.score,
    priority: source.priority,
    evidenceQuality: source.evidenceQuality,
    evidenceCoverage: source.evidenceCoverage,
    currentWindowStart: source.currentWindowStart,
    currentWindowEnd: source.currentWindowEnd,
    competingPages: strings(detector.competingPages),
    primaryPageCandidate: typeof detector.primaryPageCandidate === 'string'
      ? detector.primaryPageCandidate
      : null
  };
}

function safeNewContent(value: unknown): Record<string, unknown> {
  const source = record(value);
  const identity = record(source.identity);
  const detector = record(record(source.sourceProvenance).detector);
  return {
    id: identity.id,
    normalizedQuery: identity.normalizedQuery,
    score: source.score,
    priority: source.priority,
    evidenceQuality: source.evidenceQuality,
    evidenceCoverage: source.evidenceCoverage,
    currentWindowStart: source.currentWindowStart,
    currentWindowEnd: source.currentWindowEnd,
    reasonCodes: strings(detector.reasonCodes)
  };
}

function safeTopic(value: unknown): Record<string, unknown> {
  const source = record(value);
  return {
    id: source.id,
    topicCluster: record(source.topicCluster),
    memberQueries: strings(source.memberQueries),
    memberPages: strings(source.memberPages),
    totalImpressions: source.totalImpressions,
    totalClicks: source.totalClicks,
    ctr: source.ctr,
    position: source.position,
    topOpportunityScore: source.topOpportunityScore,
    topicScore: source.topicScore,
    priority: source.priority,
    evidenceQuality: source.evidenceQuality,
    evidenceCoverage: source.evidenceCoverage,
    rankingEligible: source.rankingEligible,
    currentWindowStart: source.currentWindowStart,
    currentWindowEnd: source.currentWindowEnd
  };
}

export interface GrowthWebRepository {
  listOpportunities(projectId: string, basicSurface: boolean): Promise<Record<string, unknown>[]>;
  getOpportunity(projectId: string, identityId: string, basicSurface: boolean): Promise<Record<string, unknown> | null>;
  listTopics(projectId: string): Promise<Record<string, unknown>[]>;
  listCannibalization(projectId: string): Promise<Record<string, unknown>[]>;
  listNewContent(projectId: string): Promise<Record<string, unknown>[]>;
}

export function createGrowthWebRepository(
  injectedRepository: Partial<GrowthRestRepository> = {}
): GrowthWebRepository {
  const repository: GrowthRestRepository = { ...growthRestRepository, ...injectedRepository };
  return {
    async listOpportunities(projectId, basicSurface) {
      const rows = await repository.listOpportunities(projectId, {
        limit: 100,
        offset: 0,
        basicOnly: basicSurface,
        rankingEligible: true
      });
      return rows.map(record);
    },

    async getOpportunity(projectId, identityId, basicSurface) {
      return safeDetail(await repository.getOpportunity(projectId, identityId, basicSurface));
    },

    async listTopics(projectId) {
      return (await repository.listTopics(projectId, 100, 0)).map(safeTopic);
    },

    async listCannibalization(projectId) {
      return (await repository.listCannibalization(projectId, 100, 0)).map(safeCannibalization);
    },

    async listNewContent(projectId) {
      return (await repository.listNewContent(projectId, 100, 0)).map(safeNewContent);
    }
  };
}

export const growthWebRepository = createGrowthWebRepository();