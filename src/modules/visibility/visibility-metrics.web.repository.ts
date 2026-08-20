import { prisma } from '../../db/prisma.js';

const CONTRACT_SCAN_LIMIT = 100;
const CONTRACT_LIMIT = 20;

export class VisibilityMetricsWebRepository {
  async getMetricsPage(projectId: string, snapshotId?: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const snapshot = snapshotId
      ? await prisma.visibilityMetricSnapshot.findFirst({
          where: { id: snapshotId, projectId },
          select: {
            id: true,
            projectId: true,
            status: true,
            formulaVersion: true,
            extractorVersion: true,
            subjectSetHash: true,
            windowStart: true,
            windowEnd: true,
            inputCutoffAt: true,
            scopeHash: true,
            inputFingerprint: true,
            candidateObservationCount: true,
            completedExtractionCount: true,
            missingExtractionCount: true,
            failedExtractionCount: true,
            errorCode: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true
          }
        })
      : await prisma.visibilityMetricSnapshot.findFirst({
          where: { projectId, status: 'COMPLETED' },
          orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            projectId: true,
            status: true,
            formulaVersion: true,
            extractorVersion: true,
            subjectSetHash: true,
            windowStart: true,
            windowEnd: true,
            inputCutoffAt: true,
            scopeHash: true,
            inputFingerprint: true,
            candidateObservationCount: true,
            completedExtractionCount: true,
            missingExtractionCount: true,
            failedExtractionCount: true,
            errorCode: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true
          }
        });

    const rows = snapshot
      ? await prisma.visibilityMetricRow.findMany({
          where: { projectId, visibilityMetricSnapshotId: snapshot.id },
          orderBy: [
            { metricType: 'asc' },
            { dimensionType: 'asc' },
            { dimensionKey: 'asc' },
            { actorKey: 'asc' },
            { id: 'asc' }
          ],
          select: {
            id: true,
            visibilityMetricSnapshotId: true,
            metricType: true,
            metricStatus: true,
            dimensionType: true,
            dimensionKey: true,
            dimensionLabelSnapshot: true,
            actorType: true,
            actorSubjectId: true,
            actorKey: true,
            numerator: true,
            denominator: true,
            candidateObservationCount: true,
            eligibleObservationCount: true,
            notEligibleObservationCount: true,
            unknownObservationCount: true,
            createdAt: true
          }
        })
      : [];

    const extractions = await prisma.visibilityExtraction.findMany({
      where: { projectId, status: 'COMPLETED' },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: CONTRACT_SCAN_LIMIT,
      select: {
        extractorVersion: true,
        subjectSetHash: true,
        completedAt: true
      }
    });

    const seen = new Set<string>();
    const contracts: Array<{
      extractorVersion: string;
      subjectSetHash: string;
      completedAt: Date | null;
    }> = [];
    for (const extraction of extractions) {
      const key = `${extraction.extractorVersion}\u0000${extraction.subjectSetHash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contracts.push(extraction);
      if (contracts.length >= CONTRACT_LIMIT) break;
    }

    return { project, snapshot, rows, contracts };
  }
}

export const visibilityMetricsWebRepository = new VisibilityMetricsWebRepository();
