import type { Job } from 'bullmq';
import { prisma } from '../../db/prisma.js';
import { buildContentFacts } from './content-facts.js';
import { contentRepository } from './content.repository.js';
import { evaluateContentDocument } from './content-rules.js';
import type { ContentRefreshJobData } from './content.service.js';

export type { ContentRefreshJobData } from './content.service.js';

async function getRelatedFacts(projectId: string, pageId: string) {
  const [entityCount, citability] = await Promise.all([
    prisma.pageEntity.count({ where: { pageId, entity: { projectId, status: 'ACTIVE' } } }),
    prisma.citabilityResult.findFirst({
      where: { pageId, geoAuditRun: { projectId, status: 'COMPLETED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { overallScore: true }
    })
  ]);

  return {
    entityCount,
    citabilityStatus: citability ? (citability.overallScore >= 60 ? 'PASS' as const : 'FAIL' as const) : 'UNKNOWN' as const,
    schemaTypesKnown: false
  };
}

export async function processContentRefreshJob(job: Job<ContentRefreshJobData>) {
  const { projectId } = job.data;
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const sources = await contentRepository.listLatestOwnedPageSources(projectId);

  let documentsUpdated = 0;
  let opportunitiesEvaluated = 0;
  for (const source of sources) {
    const facts = buildContentFacts(source);
    const document = await contentRepository.upsertContentDocument(facts);
    const related = await getRelatedFacts(projectId, source.pageId);
    const evaluation = evaluateContentDocument(facts, related);
    await contentRepository.replaceEvaluation(projectId, document.id, evaluation);
    documentsUpdated += 1;
    opportunitiesEvaluated += evaluation.length;
  }

  return { projectId, documentsUpdated, opportunitiesEvaluated };
}
