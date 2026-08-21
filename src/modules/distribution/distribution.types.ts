import type {
  DistributionMode,
  DistributionPlatform,
  DistributionStatus,
  Prisma
} from '@prisma/client';

export type EnsureDistributionTargetInput = {
  projectId: string;
  publicationId: string;
  platform: DistributionPlatform;
  mode: DistributionMode;
  targetKey: string;
};

export type CreateDistributionArtifactInput = {
  sourceContentVersion: number;
  adaptationVersion: string;
  artifactVersion: number;
  artifactHash: string;
  title?: string | null;
  body: string;
  summary?: string | null;
  tags?: Prisma.InputJsonValue | null;
  originalUrl: string;
  canonicalUrl?: string | null;
  sourceRefs: Prisma.InputJsonValue;
  platformMetadata?: Prisma.InputJsonValue | null;
};

export type AppendDistributionTargetEventInput = {
  artifactId?: string | null;
  fromStatus?: DistributionStatus | null;
  toStatus: DistributionStatus;
  reasonCode: string;
  sourceContentVersion?: number | null;
  metadata?: Prisma.InputJsonValue | null;
};

export type MarkDistributionSourceVersionOutdatedInput = {
  publicationId: string;
  currentSourceContentVersion: number;
  reasonCode: string;
};
