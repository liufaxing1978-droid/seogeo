import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { BUILTIN_PAGE_RULES, BUILTIN_RULES } from '../../src/modules/seo/rule-catalog.js';
import { syncBuiltinRules, syncRuleDefinitions } from '../../src/modules/seo/rule-sync.js';

describe('SEO rule catalog synchronization', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
    await prisma.seoRuleVersion.deleteMany();
    await prisma.seoRule.deleteMany();
  });

  it('is idempotent for the same built-in rule catalog', async () => {
    const first = await syncBuiltinRules();
    const countsAfterFirst = {
      rules: await prisma.seoRule.count(),
      versions: await prisma.seoRuleVersion.count()
    };

    const second = await syncBuiltinRules();

    expect(second.size).toBe(first.size);
    expect(await prisma.seoRule.count()).toBe(countsAfterFirst.rules);
    expect(await prisma.seoRuleVersion.count()).toBe(countsAfterFirst.versions);
    expect(first.size).toBe(BUILTIN_RULES.length);
  });

  it('creates a new rule version without overwriting the earlier version', async () => {
    const v1 = BUILTIN_PAGE_RULES.find((rule) => rule.ruleCode === 'TITLE_MISSING')!;
    await syncRuleDefinitions([v1]);

    const v2 = {
      ...v1,
      version: 2,
      weight: 3.5,
      fixGuide: 'Add one unique and descriptive document title.'
    } as const;
    await syncRuleDefinitions([v2]);

    const rule = await prisma.seoRule.findUniqueOrThrow({ where: { ruleCode: 'TITLE_MISSING' } });
    const versions = await prisma.seoRuleVersion.findMany({
      where: { seoRuleId: rule.id },
      orderBy: { version: 'asc' }
    });

    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, weight: 3 });
    expect(versions[1]).toMatchObject({ version: 2, weight: 3.5 });
  });
});
