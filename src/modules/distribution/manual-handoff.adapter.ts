import type { DistributionPlatform } from '@prisma/client';
import {
  DistributionAdapterError,
  type DistributionAdapter,
  type DistributionPrepareInput,
  type DistributionPreparedArtifact,
  type DistributionPreview
} from './distribution-adapter.js';

type ManualHandoffPlatform = 'MEDIUM' | 'LINKEDIN' | 'SUBSTACK' | 'WORDPRESS' | 'BLOGGER';

function isManualHandoffPlatform(platform: DistributionPlatform): platform is ManualHandoffPlatform {
  return (
    platform === 'MEDIUM' ||
    platform === 'LINKEDIN' ||
    platform === 'SUBSTACK' ||
    platform === 'WORDPRESS' ||
    platform === 'BLOGGER'
  );
}

export class ManualHandoffDistributionAdapter implements DistributionAdapter {
  readonly capability = 'MANUAL_HANDOFF' as const;
  readonly platform: ManualHandoffPlatform;

  constructor(platform: DistributionPlatform) {
    if (!isManualHandoffPlatform(platform)) {
      throw new DistributionAdapterError(
        'DISTRIBUTION_NOT_SUPPORTED',
        `${platform} is not an article-distribution manual handoff target`
      );
    }
    this.platform = platform;
  }

  async prepare(input: DistributionPrepareInput): Promise<DistributionPreparedArtifact> {
    if (input.platform !== this.platform) {
      throw new DistributionAdapterError(
        'DISTRIBUTION_TARGET_MISMATCH',
        `Prepared artifact platform must match ${this.platform}`
      );
    }

    return {
      platform: input.platform,
      mode: input.mode,
      publicationId: input.publicationId,
      sourceContentVersion: input.sourceContentVersion,
      title: input.title,
      body: input.body,
      summary: input.summary ?? null,
      tags: input.tags ? [...input.tags] : [],
      originalUrl: input.originalUrl,
      canonicalUrl: input.canonicalUrl ?? null,
      metadata: input.metadata ? { ...input.metadata } : {}
    };
  }

  async preview(artifact: DistributionPreparedArtifact): Promise<DistributionPreview> {
    if (artifact.platform !== this.platform) {
      throw new DistributionAdapterError(
        'DISTRIBUTION_TARGET_MISMATCH',
        `Prepared artifact platform must match ${this.platform}`
      );
    }

    return {
      platform: this.platform,
      capability: this.capability,
      artifact,
      handoff: {
        action: 'MANUAL_PUBLISH',
        steps: [
          'Review the prepared content and destination.',
          'Publish the reviewed content manually in the destination account.',
          'Record the resulting public URL in the distribution workflow.'
        ]
      }
    };
  }
}
