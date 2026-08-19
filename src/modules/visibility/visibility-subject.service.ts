import { createHash } from 'node:crypto';
import type {
  VisibilityAliasType,
  VisibilitySubject,
  VisibilitySubjectSource,
  VisibilitySubjectType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  normalizeVisibilityDomain,
  normalizeVisibilityName
} from './visibility-normalization.js';

export type CreateVisibilitySubjectInput =
  | { subjectType: 'OWNED_BRAND'; canonicalValue: string }
  | { subjectType: 'OWNED_DOMAIN'; canonicalValue: string }
  | { subjectType: 'OWNED_ENTITY'; entityId: string }
  | { subjectType: 'COMPETITOR'; competitorId: string };

export interface AddVisibilityAliasInput {
  alias: string;
  aliasType: VisibilityAliasType;
}

export interface VisibilitySubjectSnapshotItem {
  id: string;
  subjectType: VisibilitySubjectType;
  canonicalValue: string;
  normalizedValue: string;
  sourceType: VisibilitySubjectSource;
  entityId: string | null;
  competitorId: string | null;
  aliases: string[];
}

export interface VisibilitySubjectSnapshot {
  subjects: VisibilitySubjectSnapshotItem[];
  ambiguousAliases: string[];
  subjectSetHash: string;
}

type VisibilitySubjectErrorCode =
  | 'VISIBILITY_PROJECT_NOT_FOUND'
  | 'VISIBILITY_ENTITY_NOT_FOUND'
  | 'VISIBILITY_COMPETITOR_NOT_FOUND'
  | 'VISIBILITY_SUBJECT_NOT_FOUND'
  | 'VISIBILITY_SUBJECT_VALUE_REQUIRED'
  | 'AMBIGUOUS_ALIAS';

export class VisibilitySubjectError extends Error {
  readonly code: VisibilitySubjectErrorCode;

  constructor(code: VisibilitySubjectErrorCode, message: string) {
    super(message);
    this.name = 'VisibilitySubjectError';
    this.code = code;
  }
}

function requireNormalized(value: string, kind: 'text' | 'domain'): string {
  const normalized = kind === 'domain'
    ? normalizeVisibilityDomain(value)
    : normalizeVisibilityName(value);
  if (!normalized) {
    throw new VisibilitySubjectError(
      'VISIBILITY_SUBJECT_VALUE_REQUIRED',
      'Visibility subject value is required'
    );
  }
  return normalized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function ensureProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new VisibilitySubjectError('VISIBILITY_PROJECT_NOT_FOUND', 'Visibility project not found');
  }
  return project;
}

export class VisibilitySubjectService {
  async bootstrapOwnedDomain(projectId: string): Promise<VisibilitySubject> {
    const project = await ensureProject(projectId);
    const normalizedValue = requireNormalized(project.primaryDomain, 'domain');

    return prisma.visibilitySubject.upsert({
      where: {
        projectId_subjectType_normalizedValue: {
          projectId,
          subjectType: 'OWNED_DOMAIN',
          normalizedValue
        }
      },
      create: {
        projectId,
        subjectType: 'OWNED_DOMAIN',
        canonicalValue: normalizedValue,
        normalizedValue,
        sourceType: 'PRIMARY_DOMAIN'
      },
      update: {
        canonicalValue: normalizedValue,
        sourceType: 'PRIMARY_DOMAIN',
        status: 'ACTIVE'
      }
    });
  }

  async createSubject(projectId: string, input: CreateVisibilitySubjectInput): Promise<VisibilitySubject> {
    await ensureProject(projectId);

    let canonicalValue: string;
    let normalizedValue: string;
    let sourceType: VisibilitySubjectSource;
    let entityId: string | null = null;
    let competitorId: string | null = null;

    if (input.subjectType === 'OWNED_ENTITY') {
      const entity = await prisma.entity.findFirst({
        where: { id: input.entityId, projectId }
      });
      if (!entity) {
        throw new VisibilitySubjectError('VISIBILITY_ENTITY_NOT_FOUND', 'Visibility entity not found');
      }
      canonicalValue = entity.canonicalName;
      normalizedValue = requireNormalized(entity.normalizedName || entity.canonicalName, 'text');
      sourceType = 'P3_ENTITY';
      entityId = entity.id;
    } else if (input.subjectType === 'COMPETITOR') {
      const competitor = await prisma.competitor.findFirst({
        where: { id: input.competitorId, projectId }
      });
      if (!competitor) {
        throw new VisibilitySubjectError('VISIBILITY_COMPETITOR_NOT_FOUND', 'Visibility competitor not found');
      }
      normalizedValue = requireNormalized(competitor.domain, 'domain');
      canonicalValue = normalizedValue;
      sourceType = 'P5_COMPETITOR';
      competitorId = competitor.id;
    } else if (input.subjectType === 'OWNED_DOMAIN') {
      normalizedValue = requireNormalized(input.canonicalValue, 'domain');
      canonicalValue = normalizedValue;
      sourceType = 'PROJECT_CONFIG';
    } else {
      canonicalValue = input.canonicalValue.normalize('NFKC').trim();
      normalizedValue = requireNormalized(canonicalValue, 'text');
      sourceType = 'PROJECT_CONFIG';
    }

    return prisma.visibilitySubject.upsert({
      where: {
        projectId_subjectType_normalizedValue: {
          projectId,
          subjectType: input.subjectType,
          normalizedValue
        }
      },
      create: {
        projectId,
        subjectType: input.subjectType,
        canonicalValue,
        normalizedValue,
        sourceType,
        entityId,
        competitorId
      },
      update: {
        canonicalValue,
        sourceType,
        entityId,
        competitorId,
        status: 'ACTIVE'
      }
    });
  }

  async addAlias(projectId: string, subjectId: string, input: AddVisibilityAliasInput) {
    const subject = await prisma.visibilitySubject.findFirst({
      where: { id: subjectId, projectId, status: 'ACTIVE' }
    });
    if (!subject) {
      throw new VisibilitySubjectError('VISIBILITY_SUBJECT_NOT_FOUND', 'Visibility subject not found');
    }

    const alias = input.alias.normalize('NFKC').trim();
    const normalizedAlias = requireNormalized(alias, 'text');
    const [conflictingAlias, conflictingSubject] = await Promise.all([
      prisma.visibilitySubjectAlias.findFirst({
        where: {
          projectId,
          normalizedAlias,
          status: 'ACTIVE',
          subjectId: { not: subjectId }
        },
        select: { id: true }
      }),
      prisma.visibilitySubject.findFirst({
        where: {
          projectId,
          normalizedValue: normalizedAlias,
          status: 'ACTIVE',
          id: { not: subjectId }
        },
        select: { id: true }
      })
    ]);

    if (conflictingAlias || conflictingSubject) {
      throw new VisibilitySubjectError('AMBIGUOUS_ALIAS', 'Visibility alias is ambiguous');
    }

    return prisma.visibilitySubjectAlias.upsert({
      where: { subjectId_normalizedAlias: { subjectId, normalizedAlias } },
      create: {
        projectId,
        subjectId,
        alias,
        normalizedAlias,
        aliasType: input.aliasType,
        sourceType: 'PROJECT_CONFIG'
      },
      update: {
        alias,
        aliasType: input.aliasType,
        sourceType: 'PROJECT_CONFIG',
        status: 'ACTIVE'
      }
    });
  }

  async archiveSubject(projectId: string, subjectId: string) {
    const updated = await prisma.visibilitySubject.updateMany({
      where: { id: subjectId, projectId },
      data: { status: 'ARCHIVED' }
    });
    if (updated.count !== 1) {
      throw new VisibilitySubjectError('VISIBILITY_SUBJECT_NOT_FOUND', 'Visibility subject not found');
    }
    await prisma.visibilitySubjectAlias.updateMany({
      where: { projectId, subjectId },
      data: { status: 'ARCHIVED' }
    });
  }

  async buildActiveSnapshot(projectId: string): Promise<VisibilitySubjectSnapshot> {
    await ensureProject(projectId);
    const [subjects, aliases] = await Promise.all([
      prisma.visibilitySubject.findMany({
        where: { projectId, status: 'ACTIVE' },
        orderBy: [{ subjectType: 'asc' }, { normalizedValue: 'asc' }, { id: 'asc' }]
      }),
      prisma.visibilitySubjectAlias.findMany({
        where: { projectId, status: 'ACTIVE' },
        orderBy: [{ normalizedAlias: 'asc' }, { subjectId: 'asc' }, { id: 'asc' }]
      })
    ]);

    const activeSubjectIds = new Set(subjects.map((subject) => subject.id));
    const ownersByAlias = new Map<string, Set<string>>();

    for (const subject of subjects) {
      const owners = ownersByAlias.get(subject.normalizedValue) ?? new Set<string>();
      owners.add(subject.id);
      ownersByAlias.set(subject.normalizedValue, owners);
    }
    for (const alias of aliases) {
      if (!activeSubjectIds.has(alias.subjectId)) continue;
      const normalizedAlias = normalizeVisibilityName(alias.normalizedAlias || alias.alias);
      if (!normalizedAlias) continue;
      const owners = ownersByAlias.get(normalizedAlias) ?? new Set<string>();
      owners.add(alias.subjectId);
      ownersByAlias.set(normalizedAlias, owners);
    }

    const ambiguousAliases = [...ownersByAlias.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([alias]) => alias)
      .sort();
    const ambiguous = new Set(ambiguousAliases);

    const aliasesBySubject = new Map<string, string[]>();
    for (const alias of aliases) {
      if (!activeSubjectIds.has(alias.subjectId)) continue;
      const normalizedAlias = normalizeVisibilityName(alias.normalizedAlias || alias.alias);
      if (!normalizedAlias || ambiguous.has(normalizedAlias)) continue;
      const values = aliasesBySubject.get(alias.subjectId) ?? [];
      if (!values.includes(normalizedAlias)) values.push(normalizedAlias);
      aliasesBySubject.set(alias.subjectId, values);
    }

    const snapshotSubjects: VisibilitySubjectSnapshotItem[] = subjects.map((subject) => ({
      id: subject.id,
      subjectType: subject.subjectType,
      canonicalValue: subject.canonicalValue,
      normalizedValue: subject.normalizedValue,
      sourceType: subject.sourceType,
      entityId: subject.entityId,
      competitorId: subject.competitorId,
      aliases: (aliasesBySubject.get(subject.id) ?? []).sort()
    }));

    const snapshotBody = {
      subjects: snapshotSubjects,
      ambiguousAliases
    };
    const subjectSetHash = createHash('sha256')
      .update(stableJson(snapshotBody))
      .digest('hex');

    return {
      ...snapshotBody,
      subjectSetHash
    };
  }
}
