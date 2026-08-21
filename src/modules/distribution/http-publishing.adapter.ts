import { createHash } from 'node:crypto';
import type { DistributionPlatform } from '@prisma/client';
import { z } from 'zod';
import {
  DistributionAdapterError,
  type ApprovedDistributionArtifact,
  type DistributionAdapter,
  type DistributionPrepareInput,
  type DistributionPreparedArtifact,
  type DistributionPreview,
  type DistributionPublishResult,
  type DistributionVerifyResult
} from './distribution-adapter.js';

type TrustedHttpPlatform = 'WORDPRESS' | 'BLOGGER';

export type TrustedHttpDistributionConfig = {
  endpoint: string;
  credentialRef: string;
  primaryOriginalUrl: string;
};

export type DistributionHttpPublishRequest = {
  endpoint: string;
  credentialRef: string;
  providerPublishKey: string;
  payload: {
    platform: TrustedHttpPlatform;
    mode: ApprovedDistributionArtifact['mode'];
    publicationId: string;
    sourceContentVersion: number;
    title: string;
    body: string;
    summary: string | null;
    tags: string[];
    originalUrl: string;
    canonicalUrl: string | null;
  };
};

export type DistributionHttpVerifyRequest = {
  endpoint: string;
  credentialRef: string;
  providerId: string;
  publicUrl: string;
};

export type DistributionHttpTransportResponse = {
  status: number;
  body: unknown;
};

export interface DistributionHttpTransport {
  publish(request: DistributionHttpPublishRequest): Promise<DistributionHttpTransportResponse>;
  verify(request: DistributionHttpVerifyRequest): Promise<DistributionHttpTransportResponse>;
}

export class DistributionHttpAdapterError extends DistributionAdapterError {
  constructor(
    code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(code, message);
    this.name = 'DistributionHttpAdapterError';
  }
}

const publishResponseSchema = z.object({
  id: z.string().min(1).max(500),
  url: z.string().url(),
  status: z.string().min(1).max(100)
}).passthrough();

const verifyResponseSchema = z.object({
  id: z.string().min(1).max(500),
  url: z.string().url(),
  status: z.string().min(1).max(100),
  verified: z.boolean()
}).passthrough();

function isTrustedHttpPlatform(platform: DistributionPlatform): platform is TrustedHttpPlatform {
  return platform === 'WORDPRESS' || platform === 'BLOGGER';
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function providerPublishKey(artifact: ApprovedDistributionArtifact): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({
      platform: artifact.platform,
      mode: artifact.mode,
      publicationId: artifact.publicationId,
      sourceContentVersion: artifact.sourceContentVersion,
      title: artifact.title,
      body: artifact.body,
      summary: artifact.summary ?? null,
      tags: artifact.tags ?? [],
      originalUrl: artifact.originalUrl,
      canonicalUrl: artifact.canonicalUrl ?? null,
      metadata: artifact.metadata ?? {}
    })))
    .digest('hex');
}

function classifyProviderFailure(status: number): never {
  if (status === 429 || status >= 500) {
    throw new DistributionHttpAdapterError(
      'DISTRIBUTION_PROVIDER_TRANSIENT',
      `Distribution provider returned transient HTTP ${status}`,
      true
    );
  }
  throw new DistributionHttpAdapterError(
    'DISTRIBUTION_PROVIDER_REJECTED',
    `Distribution provider rejected the request with HTTP ${status}`,
    false
  );
}

export class TrustedHttpDistributionAdapter implements DistributionAdapter {
  readonly capability = 'PUBLISH_API' as const;
  readonly platform: TrustedHttpPlatform;

  constructor(private readonly input: {
    platform: DistributionPlatform;
    config: TrustedHttpDistributionConfig;
    transport: DistributionHttpTransport;
  }) {
    if (!isTrustedHttpPlatform(input.platform)) {
      throw new DistributionHttpAdapterError(
        'DISTRIBUTION_NOT_SUPPORTED',
        `${input.platform} is not a trusted HTTP publishing target`,
        false
      );
    }
    this.platform = input.platform;
  }

  private assertConfigured(): void {
    const { endpoint, credentialRef, primaryOriginalUrl } = this.input.config;
    if (!endpoint.trim() || !credentialRef.trim() || !primaryOriginalUrl.trim()) {
      throw new DistributionHttpAdapterError(
        'DISTRIBUTION_NOT_CONFIGURED',
        `${this.platform} trusted publishing is not fully configured`,
        false
      );
    }

    try {
      const endpointUrl = new URL(endpoint);
      const originalUrl = new URL(primaryOriginalUrl);
      if (endpointUrl.protocol !== 'https:' || !originalUrl.protocol.startsWith('http')) throw new Error('invalid protocol');
    } catch {
      throw new DistributionHttpAdapterError(
        'DISTRIBUTION_NOT_CONFIGURED',
        `${this.platform} trusted publishing configuration contains an invalid URL`,
        false
      );
    }
  }

  private assertArtifact(artifact: DistributionPrepareInput): void {
    if (artifact.platform !== this.platform) {
      throw new DistributionHttpAdapterError(
        'DISTRIBUTION_TARGET_MISMATCH',
        `Prepared artifact platform must match ${this.platform}`,
        false
      );
    }

    if (artifact.mode === 'CANONICAL_REPOST' || artifact.mode === 'SECONDARY_SITE') {
      const expected = this.input.config.primaryOriginalUrl;
      if (artifact.originalUrl !== expected || artifact.canonicalUrl !== expected) {
        throw new DistributionHttpAdapterError(
          'DISTRIBUTION_OWNERSHIP_MISMATCH',
          'Distribution artifact does not preserve the verified primary ownership URL',
          false
        );
      }
    }
  }

  async prepare(input: DistributionPrepareInput): Promise<DistributionPreparedArtifact> {
    this.assertConfigured();
    this.assertArtifact(input);
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
    this.assertConfigured();
    this.assertArtifact(artifact);
    return {
      platform: this.platform,
      capability: this.capability,
      artifact
    };
  }

  async publish(artifact: ApprovedDistributionArtifact): Promise<DistributionPublishResult> {
    this.assertConfigured();
    this.assertArtifact(artifact);

    const response = await this.input.transport.publish({
      endpoint: this.input.config.endpoint,
      credentialRef: this.input.config.credentialRef,
      providerPublishKey: providerPublishKey(artifact),
      payload: {
        platform: this.platform,
        mode: artifact.mode,
        publicationId: artifact.publicationId,
        sourceContentVersion: artifact.sourceContentVersion,
        title: artifact.title,
        body: artifact.body,
        summary: artifact.summary ?? null,
        tags: artifact.tags ? [...artifact.tags] : [],
        originalUrl: artifact.originalUrl,
        canonicalUrl: artifact.canonicalUrl ?? null
      }
    });

    if (response.status < 200 || response.status >= 300) classifyProviderFailure(response.status);
    const parsed = publishResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new DistributionHttpAdapterError(
        'DISTRIBUTION_PROVIDER_INVALID_RESPONSE',
        'Distribution provider publish response did not match the required contract',
        false
      );
    }

    return {
      providerId: parsed.data.id,
      publicUrl: parsed.data.url,
      status: parsed.data.status
    };
  }

  async verify(result: DistributionPublishResult): Promise<DistributionVerifyResult> {
    this.assertConfigured();
    if (!result.providerId || !result.publicUrl) {
      throw new DistributionHttpAdapterError(
        'DISTRIBUTION_PROVIDER_INVALID_RESPONSE',
        'Distribution publish result is missing provider identity or public URL',
        false
      );
    }

    const response = await this.input.transport.verify({
      endpoint: this.input.config.endpoint,
      credentialRef: this.input.config.credentialRef,
      providerId: result.providerId,
      publicUrl: result.publicUrl
    });
    if (response.status < 200 || response.status >= 300) classifyProviderFailure(response.status);

    const parsed = verifyResponseSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.id !== result.providerId || parsed.data.url !== result.publicUrl) {
      throw new DistributionHttpAdapterError(
        'DISTRIBUTION_PROVIDER_INVALID_RESPONSE',
        'Distribution provider verify response did not match the published object',
        false
      );
    }

    return {
      verified: parsed.data.verified,
      publicUrl: parsed.data.url
    };
  }
}
