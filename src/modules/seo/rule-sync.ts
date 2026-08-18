import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BUILTIN_RULES } from './rule-catalog.js';
import type { SeoRuleDefinition } from './seo.types.js';

export interface SyncedRuleIdentity {
  ruleId: string;
  ruleVersionId: string;
}

export async function syncRuleDefinitions(
  definitions: readonly SeoRuleDefinition[]
): Promise<Map<string, SyncedRuleIdentity>> {
  const identities = new Map<string, SyncedRuleIdentity>();

  for (const definition of definitions) {
    const rule = await prisma.seoRule.upsert({
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

    const ruleVersion = await prisma.seoRuleVersion.upsert({
      where: {
        seoRuleId_version: {
          seoRuleId: rule.id,
          version: definition.version
        }
      },
      create: {
        seoRuleId: rule.id,
        version: definition.version,
        severity: definition.severity,
        weight: definition.weight,
        detectionType: definition.detectionType,
        ...(definition.detectionConfig
          ? { detectionConfig: definition.detectionConfig as Prisma.InputJsonValue }
          : {}),
        seoImpact: definition.seoImpact,
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

export function syncBuiltinRules(): Promise<Map<string, SyncedRuleIdentity>> {
  return syncRuleDefinitions(BUILTIN_RULES);
}
