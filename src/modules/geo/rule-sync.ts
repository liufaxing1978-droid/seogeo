import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BUILTIN_GEO_RULES } from './rule-catalog.js';
import type { GeoRuleDefinition } from './geo.types.js';

export interface SyncedGeoRuleIdentity {
  ruleId: string;
  ruleVersionId: string;
}

export async function syncGeoRuleDefinitions(
  definitions: readonly GeoRuleDefinition[]
): Promise<Map<string, SyncedGeoRuleIdentity>> {
  const identities = new Map<string, SyncedGeoRuleIdentity>();

  for (const definition of definitions) {
    const rule = await prisma.geoRule.upsert({
      where: { ruleCode: definition.ruleCode },
      create: {
        ruleCode: definition.ruleCode,
        name: definition.name,
        category: definition.category,
        description: definition.description,
        enabled: true
      },
      update: {
        name: definition.name,
        category: definition.category,
        description: definition.description
      }
    });

    const ruleVersion = await prisma.geoRuleVersion.upsert({
      where: {
        geoRuleId_version: {
          geoRuleId: rule.id,
          version: definition.version
        }
      },
      create: {
        geoRuleId: rule.id,
        version: definition.version,
        dimension: definition.dimension,
        severity: definition.severity,
        weight: definition.weight,
        detectionType: definition.detectionType,
        ...(definition.detectionConfig
          ? { detectionConfig: definition.detectionConfig as Prisma.InputJsonValue }
          : {}),
        geoImpact: definition.geoImpact,
        fixGuide: definition.fixGuide,
        releasedAt: new Date()
      },
      update: {}
    });

    identities.set(definition.ruleCode, {
      ruleId: rule.id,
      ruleVersionId: ruleVersion.id
    });
  }

  return identities;
}

export function syncBuiltinGeoRules(): Promise<Map<string, SyncedGeoRuleIdentity>> {
  return syncGeoRuleDefinitions(BUILTIN_GEO_RULES);
}
