import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { BUILTIN_GEO_RULES } from '../../src/modules/geo/rule-catalog.js';
import { syncGeoRuleDefinitions } from '../../src/modules/geo/rule-sync.js';
import type { GeoRuleDefinition } from '../../src/modules/geo/geo.types.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
  await prisma.geoRuleVersion.deleteMany();
  await prisma.geoRule.deleteMany();
});

describe('GEO rule synchronization', () => {
  it('is idempotent for the same built-in rule versions', async () => {
    const first = await syncGeoRuleDefinitions(BUILTIN_GEO_RULES);
    const second = await syncGeoRuleDefinitions(BUILTIN_GEO_RULES);

    expect(first.size).toBe(BUILTIN_GEO_RULES.length);
    expect(second.size).toBe(BUILTIN_GEO_RULES.length);
    expect(await prisma.geoRule.count()).toBe(BUILTIN_GEO_RULES.length);
    expect(await prisma.geoRuleVersion.count()).toBe(BUILTIN_GEO_RULES.length);

    for (const definition of BUILTIN_GEO_RULES) {
      expect(second.get(definition.ruleCode)).toEqual(first.get(definition.ruleCode));
    }
  });

  it('adds a new version without mutating the previous version', async () => {
    const v1: GeoRuleDefinition = {
      ruleCode: 'TEST_VERSIONED_GEO_RULE',
      name: 'Versioned GEO rule',
      category: 'Test',
      description: 'Fixture rule for testing immutable GEO rule versions.',
      version: 1,
      dimension: 'CITABILITY',
      severity: 'LOW',
      weight: 1,
      detectionType: 'PAGE_FACT',
      detectionConfig: { threshold: 1 },
      geoImpact: 'Versioned definitions keep historical GEO audits explainable.',
      fixGuide: 'Use a new rule version when changing deterministic behavior.'
    };

    const v2: GeoRuleDefinition = {
      ...v1,
      version: 2,
      severity: 'MEDIUM',
      weight: 2,
      detectionConfig: { threshold: 2 }
    };

    const first = await syncGeoRuleDefinitions([v1]);
    const second = await syncGeoRuleDefinitions([v2]);
    const ruleId = first.get(v1.ruleCode)?.ruleId;

    expect(ruleId).toBeDefined();
    expect(second.get(v2.ruleCode)?.ruleId).toBe(ruleId);
    expect(second.get(v2.ruleCode)?.ruleVersionId).not.toBe(first.get(v1.ruleCode)?.ruleVersionId);

    const versions = await prisma.geoRuleVersion.findMany({
      where: { geoRuleId: ruleId },
      orderBy: { version: 'asc' }
    });

    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, severity: 'LOW', weight: 1 });
    expect(versions[0]?.detectionConfig).toEqual({ threshold: 1 });
    expect(versions[1]).toMatchObject({ version: 2, severity: 'MEDIUM', weight: 2 });
    expect(versions[1]?.detectionConfig).toEqual({ threshold: 2 });
  });
});
