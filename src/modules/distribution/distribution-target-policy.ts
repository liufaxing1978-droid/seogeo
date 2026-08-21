import type {
  DistributionMode,
  DistributionPlatform,
  PlanLevel
} from '@prisma/client';
import { z } from 'zod';

export type CommunityTargetContext = {
  sourceType: 'USER' | 'APPROVED_DISCOVERY';
  question: string;
  topicUrl: string | null;
  includeBrandLink: boolean;
};

export class DistributionTargetPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DistributionTargetPolicyError';
  }
}

const COMMUNITY_PLATFORMS = new Set<DistributionPlatform>([
  'REDDIT',
  'QUORA',
  'ZHIHU',
  'JIANSHU',
  'TIEBA',
  'PTT',
  'DCARD',
  'MOBILE01'
]);

const ENTITY_PLATFORMS = new Set<DistributionPlatform>([
  'WIKIDATA',
  'WIKIPEDIA',
  'BAIDU_BAIKE'
]);

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const CommunityTargetContextSchema = z.object({
  sourceType: z.enum(['USER', 'APPROVED_DISCOVERY']),
  question: z.string().trim().min(1).max(4000),
  topicUrl: z.string().trim().url().max(2048).refine(isHttpUrl, 'topicUrl must use HTTP or HTTPS').nullable().optional(),
  includeBrandLink: z.boolean().default(false)
}).strict();

export function isCommunityDistributionPlatform(
  platform: DistributionPlatform
): boolean {
  return COMMUNITY_PLATFORMS.has(platform);
}

export function isEntityDistributionPlatform(
  platform: DistributionPlatform
): boolean {
  return ENTITY_PLATFORMS.has(platform);
}

export function normalizeDistributionTargetContext(input: {
  platform: DistributionPlatform;
  mode: DistributionMode;
  context?: unknown;
}): CommunityTargetContext | null {
  if (input.mode !== 'COMMUNITY_DRAFT') {
    if (input.context !== undefined && input.context !== null) {
      throw new DistributionTargetPolicyError(
        'DISTRIBUTION_TARGET_CONTEXT_NOT_ALLOWED',
        'Community target context is allowed only for COMMUNITY_DRAFT targets'
      );
    }
    return null;
  }

  if (!isCommunityDistributionPlatform(input.platform)) {
    throw new DistributionTargetPolicyError(
      'DISTRIBUTION_COMMUNITY_PLATFORM_REQUIRED',
      `COMMUNITY_DRAFT is not allowed for ${input.platform}`
    );
  }

  const parsed = CommunityTargetContextSchema.parse(input.context);
  return {
    sourceType: parsed.sourceType,
    question: parsed.question,
    topicUrl: parsed.topicUrl ?? null,
    includeBrandLink: parsed.includeBrandLink
  };
}

export function assertDistributionTargetPolicy(input: {
  planLevel: PlanLevel;
  platform: DistributionPlatform;
  mode: DistributionMode;
}): void {
  if (isCommunityDistributionPlatform(input.platform)) {
    if (input.mode !== 'COMMUNITY_DRAFT') {
      throw new DistributionTargetPolicyError(
        'DISTRIBUTION_COMMUNITY_MODE_REQUIRED',
        `${input.platform} requires COMMUNITY_DRAFT mode`
      );
    }
    if (input.planLevel === 'STANDARD') {
      throw new DistributionTargetPolicyError(
        'PUBLICATION_DISTRIBUTION_NOT_AVAILABLE',
        'Community GEO distribution requires the Advanced plan or higher'
      );
    }
    return;
  }

  if (isEntityDistributionPlatform(input.platform)) {
    if (input.mode !== 'ENTITY_SUGGESTION') {
      throw new DistributionTargetPolicyError(
        'DISTRIBUTION_ENTITY_MODE_REQUIRED',
        `${input.platform} requires ENTITY_SUGGESTION mode`
      );
    }
    if (input.planLevel !== 'ENTERPRISE') {
      throw new DistributionTargetPolicyError(
        'PUBLICATION_ENTERPRISE_GOVERNANCE_NOT_AVAILABLE',
        'Entity and knowledge-graph suggestions require the Enterprise plan'
      );
    }
    return;
  }

  if (input.mode === 'COMMUNITY_DRAFT' || input.mode === 'ENTITY_SUGGESTION') {
    throw new DistributionTargetPolicyError(
      'DISTRIBUTION_MODE_NOT_ALLOWED',
      `${input.mode} is not allowed for ${input.platform}`
    );
  }
}
