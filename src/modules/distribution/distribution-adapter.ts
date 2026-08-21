import type { DistributionMode, DistributionPlatform } from '@prisma/client';

export type DistributionCapability = 'PREPARE_ONLY' | 'MANUAL_HANDOFF' | 'PUBLISH_API';

export type DistributionPrepareInput = {
  platform: DistributionPlatform;
  mode: DistributionMode;
  publicationId: string;
  sourceContentVersion: number;
  title: string;
  body: string;
  summary?: string | null;
  tags?: string[];
  originalUrl: string;
  canonicalUrl?: string | null;
  metadata?: Record<string, unknown>;
};

export type DistributionPreparedArtifact = DistributionPrepareInput;
export type ApprovedDistributionArtifact = DistributionPreparedArtifact;

export type DistributionPreview = {
  platform: DistributionPlatform;
  capability: DistributionCapability;
  artifact: DistributionPreparedArtifact;
  handoff?: {
    action: 'MANUAL_PUBLISH';
    steps: string[];
  };
};

export type DistributionPublishResult = {
  providerId?: string | null;
  publicUrl?: string | null;
  status: string;
};

export type DistributionVerifyResult = {
  verified: boolean;
  publicUrl?: string | null;
};

export interface DistributionAdapter {
  readonly platform: DistributionPlatform;
  readonly capability: DistributionCapability;
  prepare(input: DistributionPrepareInput): Promise<DistributionPreparedArtifact>;
  preview(artifact: DistributionPreparedArtifact): Promise<DistributionPreview>;
  publish?(artifact: ApprovedDistributionArtifact): Promise<DistributionPublishResult>;
  verify?(result: DistributionPublishResult): Promise<DistributionVerifyResult>;
}

export class DistributionAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DistributionAdapterError';
  }
}

export function resolveDistributionCapability(
  platform: DistributionPlatform,
  input: { trustedPublishAdapterConfigured: boolean }
): DistributionCapability {
  switch (platform) {
    case 'WORDPRESS':
    case 'BLOGGER':
      return input.trustedPublishAdapterConfigured ? 'PUBLISH_API' : 'MANUAL_HANDOFF';
    case 'MEDIUM':
    case 'LINKEDIN':
    case 'SUBSTACK':
      return 'MANUAL_HANDOFF';
    case 'REDDIT':
    case 'QUORA':
    case 'ZHIHU':
    case 'WIKIPEDIA':
    case 'WIKIDATA':
    case 'BAIDU_BAIKE':
      return 'PREPARE_ONLY';
  }
}

export async function publishWithDistributionAdapter(
  adapter: DistributionAdapter,
  artifact: ApprovedDistributionArtifact
): Promise<DistributionPublishResult> {
  if (adapter.capability === 'MANUAL_HANDOFF') {
    throw new DistributionAdapterError(
      'DISTRIBUTION_MANUAL_ONLY',
      `${adapter.platform} requires a manual publishing handoff`
    );
  }

  if (adapter.capability !== 'PUBLISH_API' || !adapter.publish) {
    throw new DistributionAdapterError(
      'DISTRIBUTION_NOT_SUPPORTED',
      `${adapter.platform} does not expose an automatic publishing capability`
    );
  }

  return adapter.publish(artifact);
}
