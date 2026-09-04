import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import { KeywordCannibalizationService } from '../../src/modules/keywords/keyword-cannibalization.service.js';

const projects: string[] = [];
afterEach(async () => { await prisma.project.deleteMany({ where: { id: { in: projects.splice(0) } } }); });

describe('P4 cannibalization analysis', () => {
  it('persists NONE when there is no Growth evidence, mapping conflict, or coverage evidence', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P4 analysis', slug: `p4-analysis-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projects.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '法事', normalizedText: '法事', type: 'CORE', source: 'MANUAL' });
    const snapshot = await new KeywordCannibalizationService().calculateKeyword(project.id, keyword.id, randomUUID());
    expect(snapshot).toMatchObject({ projectId: project.id, keywordId: keyword.id, risk: 'NONE', recommendedAction: null, formulaVersion: 'keyword-cannibalization-v1' });
    expect(snapshot.sourceProvenance).toMatchObject({ growthSnapshotId: null, coverageStatus: 'UNKNOWN' });
  });
});
