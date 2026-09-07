import { prisma } from '../../db/prisma.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function evidenceSnapshotIds(evidence: unknown): string[] {
  const value = record(evidence);
  const references = Array.isArray(value.sourceReferences) ? value.sourceReferences.map(record) : [];
  return [...new Set([
    ...references.flatMap((reference) => reference.type === 'PAGE_SNAPSHOT' && typeof reference.id === 'string' ? [reference.id] : []),
    ...(typeof value.previousSnapshotId === 'string' ? [value.previousSnapshotId] : []),
    ...(typeof value.currentSnapshotId === 'string' ? [value.currentSnapshotId] : []),
  ])];
}

async function attachEvidenceSnapshots<T extends { evidence: unknown; projectId: string }>(findings: T[]) {
  const ids = [...new Set(findings.flatMap((finding) => evidenceSnapshotIds(finding.evidence)))];
  if (!ids.length) return findings.map((finding) => ({ ...finding, evidenceSnapshots: [] }));
  const snapshots = await prisma.pageSnapshot.findMany({
    where: { id: { in: ids }, page: { projectId: findings[0]?.projectId } },
    select: { id: true, capturedAt: true, wordCount: true, title: true, h1: true, statusCode: true, contentType: true, indexable: true },
  });
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  return findings.map((finding) => ({
    ...finding,
    evidenceSnapshots: evidenceSnapshotIds(finding.evidence).flatMap((id) => {
      const snapshot = byId.get(id);
      return snapshot ? [snapshot] : [];
    }),
  }));
}

export const contentWebRepository = {
  async getCenter(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const [documents, openOpportunities, briefs] = await Promise.all([
      prisma.contentDocument.findMany({
        where: { projectId },
        include: { _count: { select: { signals: true, opportunities: true, briefs: true } } },
        orderBy: [{ extractedAt: 'desc' }, { canonicalUrl: 'asc' }],
        take: 100
      }),
      prisma.contentOpportunity.findMany({
        where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        include: { document: { select: { id: true, canonicalUrl: true, title: true } } },
        orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }],
        take: 50
      }),
      prisma.contentBrief.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 20 })
    ]);
    return { project, documents, openOpportunities, briefs };
  },

  async getDocument(projectId: string, documentId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const document = await prisma.contentDocument.findFirst({
      where: { id: documentId, projectId },
      include: {
        signals: { orderBy: { ruleKey: 'asc' } },
        opportunities: { orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }] },
        briefs: { orderBy: { createdAt: 'desc' } }
      }
    });
    return document ? { project, document } : null;
  },

  async getBrief(projectId: string, briefId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const brief = await prisma.contentBrief.findFirst({ where: { id: briefId, projectId } });
    return brief ? { project, brief } : null;
  },

  async getQualityCenter(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const [runs, findings] = await Promise.all([
      prisma.contentQualityRun.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 20,
      }),
      prisma.contentQualityFinding.findMany({
        where: { projectId },
        include: {
          document: { select: { id: true, canonicalUrl: true, title: true } },
          latestRun: { select: { id: true, status: true, inputSnapshotCutoffAt: true, completedAt: true } },
          acceptedPublicationProposal: { select: { id: true } },
        },
        orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }, { id: 'asc' }],
        take: 100,
      }),
    ]);
    return { project, runs, findings: await attachEvidenceSnapshots(findings) };
  },

  async getQualityFinding(projectId: string, findingId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const finding = await prisma.contentQualityFinding.findFirst({
      where: { id: findingId, projectId },
      include: {
        document: { select: { id: true, canonicalUrl: true, title: true, latestPageSnapshotId: true } },
        latestRun: true,
        acceptedPublicationProposal: { select: { id: true, createdAt: true, reason: true } },
        history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    return finding ? { project, finding: (await attachEvidenceSnapshots([finding]))[0]! } : null;
  }
};
