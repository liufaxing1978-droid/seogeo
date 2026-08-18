import type { EntityType, PageEntityRole } from '@prisma/client';
import type { StructuredEntityRole, StructuredEntitySignal } from '../crawler/html-parser.js';
import {
  createEntityObservation,
  ensureEntityRelation,
  loadEntityAuditInput,
  resetEntityObservationsForAudit,
  upsertEntityAlias,
  upsertPageEntity,
  upsertStableEntity
} from './entity.repository.js';

const VALID_ROLES = new Set<StructuredEntityRole>([
  'ROOT',
  'AUTHOR',
  'PUBLISHER',
  'ABOUT',
  'BRAND',
  'MAIN_ENTITY',
  'PROVIDER',
  'OFFERS',
  'ITEM_OFFERED'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = stringValue(item);
    return normalized ? [normalized] : [];
  });
}

function parseStructuredSignal(value: unknown): StructuredEntitySignal | null {
  if (!isRecord(value)) return null;

  const role = stringValue(value.role) as StructuredEntityRole | null;
  const sourcePath = stringValue(value.sourcePath);
  const parentSourcePath = value.parentSourcePath === null ? null : stringValue(value.parentSourcePath);
  if (!role || !VALID_ROLES.has(role) || !sourcePath) return null;

  return {
    schemaTypes: stringArray(value.schemaTypes),
    id: stringValue(value.id),
    name: stringValue(value.name),
    alternateNames: stringArray(value.alternateNames),
    url: stringValue(value.url),
    sameAs: stringArray(value.sameAs),
    role,
    sourcePath,
    parentSourcePath
  };
}

function parseSignalList(value: unknown): StructuredEntitySignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = parseStructuredSignal(item);
    return parsed ? [parsed] : [];
  });
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function normalizedSchemaType(type: string): string {
  const withoutFragment = type.split('#').at(-1) ?? type;
  return (withoutFragment.split('/').filter(Boolean).at(-1) ?? withoutFragment).toLowerCase();
}

const ORGANIZATION_TYPES = new Set([
  'organization',
  'corporation',
  'localbusiness',
  'educationalorganization',
  'governmentorganization',
  'medicalorganization',
  'ngo',
  'performinggroup',
  'sportsorganization'
]);
const PLACE_TYPES = new Set([
  'place',
  'administrativearea',
  'city',
  'country',
  'state',
  'civicstructure',
  'landform',
  'residence',
  'touristattraction'
]);
const TOPIC_TYPES = new Set(['definedterm', 'categorycode']);

function entityTypeFor(schemaTypes: readonly string[]): EntityType {
  const types = schemaTypes.map(normalizedSchemaType);
  if (types.includes('person')) return 'PERSON';
  if (types.includes('product')) return 'PRODUCT';
  if (types.includes('service')) return 'SERVICE';
  if (types.some((type) => ORGANIZATION_TYPES.has(type))) return 'ORGANIZATION';
  if (types.some((type) => PLACE_TYPES.has(type))) return 'PLACE';
  if (types.some((type) => TOPIC_TYPES.has(type))) return 'TOPIC';
  return 'OTHER';
}

function pageRoleFor(role: StructuredEntityRole): PageEntityRole {
  if (role === 'AUTHOR') return 'AUTHOR';
  if (role === 'PUBLISHER') return 'PUBLISHER';
  if (role === 'ABOUT') return 'ABOUT';
  if (role === 'ROOT') return 'PRIMARY';
  return 'MENTIONED';
}

function explicitObservations(signal: StructuredEntitySignal): Array<[string, string]> {
  const observations: Array<[string, string]> = [];
  for (const type of signal.schemaTypes) observations.push(['@type', type]);
  if (signal.id) observations.push(['@id', signal.id]);
  if (signal.name) observations.push(['name', signal.name]);
  for (const alias of signal.alternateNames) observations.push(['alternateName', alias]);
  if (signal.url) observations.push(['url', signal.url]);
  for (const sameAs of signal.sameAs) observations.push(['sameAs', sameAs]);
  return observations;
}

export async function extractEntitiesForAudit(geoAuditRunId: string): Promise<{
  entitiesObserved: number;
  observationsPersisted: number;
  relationsObserved: number;
}> {
  const input = await loadEntityAuditInput(geoAuditRunId);
  await resetEntityObservationsForAudit(geoAuditRunId);

  const uniqueEntityIds = new Set<string>();
  let observationsPersisted = 0;
  let relationsObserved = 0;

  for (const page of input.pages) {
    const signals = parseSignalList(page.structured?.entitySignals ?? []);
    if (signals.length === 0) continue;

    const entityBySourcePath = new Map<string, Awaited<ReturnType<typeof upsertStableEntity>>>();
    const entityBySchemaId = new Map<string, Awaited<ReturnType<typeof upsertStableEntity>>>();

    for (const signal of signals) {
      if (!signal.name) continue;
      const normalizedName = normalizeName(signal.name);
      if (!normalizedName) continue;

      const entity = await upsertStableEntity({
        projectId: input.projectId,
        entityType: entityTypeFor(signal.schemaTypes),
        canonicalName: signal.name,
        normalizedName,
        officialUrl: signal.url,
        confidence: signal.schemaTypes.length > 0 ? 1 : 0.9
      });

      uniqueEntityIds.add(entity.id);
      entityBySourcePath.set(signal.sourcePath, entity);
      if (signal.id && !entityBySchemaId.has(signal.id)) entityBySchemaId.set(signal.id, entity);
    }

    for (const signal of signals) {
      if (entityBySourcePath.has(signal.sourcePath)) continue;
      if (signal.id) {
        const referenced = entityBySchemaId.get(signal.id);
        if (referenced) entityBySourcePath.set(signal.sourcePath, referenced);
      }
    }

    for (const signal of signals) {
      const entity = entityBySourcePath.get(signal.sourcePath);
      if (!entity) continue;

      await upsertPageEntity({
        pageId: page.pageId,
        entityId: entity.id,
        role: pageRoleFor(signal.role),
        confidence: signal.schemaTypes.length > 0 ? 1 : 0.9,
        sourceType: 'SCHEMA'
      });

      for (const alias of signal.alternateNames) {
        const normalizedAlias = normalizeName(alias);
        if (!normalizedAlias || normalizedAlias === entity.normalizedName) continue;
        await upsertEntityAlias({
          entityId: entity.id,
          alias,
          normalizedAlias,
          sourceType: 'SCHEMA'
        });
      }

      for (const [property, value] of explicitObservations(signal)) {
        await createEntityObservation({
          geoAuditRunId,
          entityId: entity.id,
          pageId: page.pageId,
          property,
          value,
          evidence: {
            sourceType: 'SCHEMA',
            sourcePath: signal.sourcePath,
            role: signal.role,
            snapshotId: page.snapshotId
          }
        });
        observationsPersisted += 1;
      }
    }

    for (const signal of signals) {
      if (!signal.parentSourcePath || signal.role === 'ROOT') continue;
      const sourceEntity = entityBySourcePath.get(signal.parentSourcePath);
      const targetEntity = entityBySourcePath.get(signal.sourcePath);
      if (!sourceEntity || !targetEntity || sourceEntity.id === targetEntity.id) continue;

      await ensureEntityRelation({
        projectId: input.projectId,
        sourceEntityId: sourceEntity.id,
        relationType: signal.role,
        targetEntityId: targetEntity.id,
        sourcePageId: page.pageId,
        confidence: 1,
        evidence: {
          sourceType: 'SCHEMA',
          parentSourcePath: signal.parentSourcePath,
          sourcePath: signal.sourcePath,
          snapshotId: page.snapshotId
        }
      });
      relationsObserved += 1;
    }
  }

  return {
    entitiesObserved: uniqueEntityIds.size,
    observationsPersisted,
    relationsObserved
  };
}
