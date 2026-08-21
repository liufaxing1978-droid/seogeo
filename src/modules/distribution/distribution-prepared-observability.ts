import type { AiTask, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  distributionObservability,
  type DistributionObservability
} from './distribution-observability.js';

function objectValue(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function arrayCount(value: Prisma.JsonValue | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

function taskBinding(task: AiTask): {
  targetId: string;
  platform: string;
  mode: string;
  sourceContentVersion: number;
} | null {
  if (task.taskType !== 'PUBLICATION_CONTENT_ADAPTATION') return null;
  const facts = task.factSnapshot as Record<string, unknown>;
  const target = facts.target as Record<string, unknown> | undefined;
  const primary = facts.primary as Record<string, unknown> | undefined;
  const targetId = typeof target?.id === 'string' ? target.id : null;
  const platform = typeof target?.platform === 'string' ? target.platform : null;
  const mode = typeof target?.mode === 'string' ? target.mode : null;
  const sourceContentVersion = typeof primary?.sourceContentVersion === 'number'
    ? primary.sourceContentVersion
    : null;
  if (!targetId || !platform || !mode || !sourceContentVersion) return null;
  return { targetId, platform, mode, sourceContentVersion };
}

export async function emitPreparedDistributionEvent(
  task: AiTask,
  observability: DistributionObservability = distributionObservability
): Promise<void> {
  const binding = taskBinding(task);
  if (!binding || (binding.mode !== 'COMMUNITY_DRAFT' && binding.mode !== 'ENTITY_SUGGESTION')) return;

  const artifact = await prisma.distributionArtifact.findFirst({
    where: {
      projectId: task.projectId,
      targetId: binding.targetId,
      sourceContentVersion: binding.sourceContentVersion,
      adaptationVersion: task.promptVersion
    },
    orderBy: [{ artifactVersion: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      sourceRefs: true,
      platformMetadata: true
    }
  });
  if (!artifact) return;

  const metadata = objectValue(artifact.platformMetadata);
  const common = {
    projectId: task.projectId,
    targetId: binding.targetId,
    artifactId: artifact.id,
    platform: binding.platform,
    mode: binding.mode,
    status: 'DRAFT_READY',
    sourceContentVersion: binding.sourceContentVersion,
    sourceReferenceCount: Array.isArray(artifact.sourceRefs) ? artifact.sourceRefs.length : 0
  };

  if (binding.mode === 'COMMUNITY_DRAFT') {
    observability.emit('community.draft.prepared', {
      ...common,
      contextHash: typeof metadata.contextHash === 'string' ? metadata.contextHash : undefined
    });
    return;
  }

  observability.emit('entity.suggestion.prepared', {
    ...common,
    sameAsCount: arrayCount(metadata.sameAs),
    attributeCount: arrayCount(metadata.attributes),
    missingDataCount: arrayCount(metadata.missingData)
  });
}
