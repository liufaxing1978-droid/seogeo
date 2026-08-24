import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  buildPublicationPlan,
  createPublicationPreview,
  type AdapterPreviewFile,
  type PublicationTargetSnapshot
} from './publication-plan.js';
import {
  validatePublicationDraft,
  type PublicationValidationResult
} from './publication-validation.js';

export interface PublicationAutomationTargetPort {
  readTarget(input: {
    repositoryIdentity: string;
    branch: string;
    targetPublicUrl: string;
    repositoryPath: string;
  }): Promise<PublicationTargetSnapshot>;
  preview(input: {
    projectId: string;
    proposalId: string;
    draftId: string;
    planId: string;
    planHash: string;
    repositoryIdentity: string;
    branch: string;
    baseSha: string;
    touchedBlobShas: Record<string, string>;
    riskClass: 'LOW';
    operations: Prisma.JsonValue | Prisma.InputJsonValue;
  }): Promise<{
    files: AdapterPreviewFile[];
    unifiedDiff: string;
    validationResult?: {
      blockingCodes: string[];
      warningCodes: string[];
      canCreatePlan: boolean;
    };
  }>;
}

export interface PrepareGeneratedArticleForPublicationInput {
  projectId: string;
  proposalId: string;
  draftId: string;
  lockKey: string;
  targetPort: PublicationAutomationTargetPort | null;
}

export interface PrepareGeneratedArticleForPublicationResult {
  state: 'P8_READY' | 'MANUAL_REQUIRED' | 'VALIDATION_BLOCKED';
  planId: string | null;
  previewId: string | null;
  reasonCode: string | null;
}

type EligibleTarget = {
  site: {
    id: string;
    domain: string;
    repositoryIdentity: string;
    baseBranch: string;
    allowedPaths: string[];
  };
  channel: {
    id: string;
    pathPrefix: string;
    repositoryPathTemplate: string;
  };
};

function stringArray(value: Prisma.JsonValue | null): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return null;
    const normalized = item.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  const leading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return leading.length > 1 && leading.endsWith('/') ? leading.slice(0, -1) : leading;
}

function targetPublicUrl(domain: string, pathPrefix: string, slug: string): string | null {
  const hostname = domain.trim().toLowerCase();
  if (!hostname || hostname.includes('/') || hostname.includes(':')) return null;
  const prefix = normalizePathPrefix(pathPrefix);
  const pathname = prefix === '/' ? `/${slug}` : `${prefix}/${slug}`;
  return `https://${hostname}${pathname}`;
}

function targetRepositoryPath(template: string, slug: string): string | null {
  const normalized = template.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized.includes('{slug}')) return null;
  const path = normalized.replaceAll('{slug}', slug);
  if (!path || path.startsWith('/') || path.includes('../') || path.includes('/..')) return null;
  return path;
}

function manual(reasonCode: string): PrepareGeneratedArticleForPublicationResult {
  return { state: 'MANUAL_REQUIRED', planId: null, previewId: null, reasonCode };
}

function blocked(reasonCode: string): PrepareGeneratedArticleForPublicationResult {
  return { state: 'VALIDATION_BLOCKED', planId: null, previewId: null, reasonCode };
}

function exactCreateOperation(value: Prisma.JsonValue): boolean {
  return Array.isArray(value)
    && value.length === 1
    && value[0] !== null
    && typeof value[0] === 'object'
    && !Array.isArray(value[0])
    && (value[0] as Record<string, unknown>).type === 'CREATE_CONTENT_PAGE';
}

function existingPlanReady(input: {
  plan: {
    id: string;
    projectId: string;
    proposalId: string;
    draftId: string;
    draftVersion: number;
    siteId: string;
    channelId: string | null;
    targetRepository: string;
    targetBranch: string;
    riskClass: string;
    operations: Prisma.JsonValue;
    preview: { id: string } | null;
  };
  projectId: string;
  proposalId: string;
  draftId: string;
  target: EligibleTarget;
}): PrepareGeneratedArticleForPublicationResult | null {
  const { plan, target } = input;
  if (
    plan.projectId !== input.projectId
    || plan.proposalId !== input.proposalId
    || plan.draftId !== input.draftId
    || plan.draftVersion !== 2
    || plan.siteId !== target.site.id
    || plan.channelId !== target.channel.id
    || plan.targetRepository !== target.site.repositoryIdentity
    || plan.targetBranch !== target.site.baseBranch
    || plan.riskClass !== 'LOW'
    || !exactCreateOperation(plan.operations)
    || !plan.preview
  ) {
    return null;
  }
  return {
    state: 'P8_READY',
    planId: plan.id,
    previewId: plan.preview.id,
    reasonCode: null
  };
}

async function eligibleTargets(projectId: string): Promise<EligibleTarget[]> {
  const sites = await prisma.publicationSite.findMany({
    where: {
      projectId,
      enabled: true,
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR'
    },
    include: {
      channels: {
        where: { enabled: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      }
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });

  const targets: EligibleTarget[] = [];
  for (const site of sites) {
    const repositoryIdentity = site.repositoryIdentity?.trim() ?? '';
    const baseBranch = site.baseBranch?.trim() ?? '';
    const allowedPaths = stringArray(site.allowedPaths);
    if (!repositoryIdentity || !baseBranch || !allowedPaths) continue;

    for (const channel of site.channels) {
      const operations = stringArray(channel.allowedOperationClasses);
      const template = channel.repositoryPathTemplate?.trim() ?? '';
      if (!operations?.includes('CREATE_CONTENT_PAGE') || !template) continue;
      targets.push({
        site: {
          id: site.id,
          domain: site.domain,
          repositoryIdentity,
          baseBranch,
          allowedPaths
        },
        channel: {
          id: channel.id,
          pathPrefix: channel.pathPrefix,
          repositoryPathTemplate: template
        }
      });
    }
  }
  return targets;
}

function previewContractClean(input: {
  files: AdapterPreviewFile[];
  unifiedDiff: string;
  validationResult?: {
    blockingCodes: string[];
    warningCodes: string[];
    canCreatePlan: boolean;
  };
}, repositoryPath: string): boolean {
  const remoteValidation = input.validationResult;
  if (
    remoteValidation
    && (
      remoteValidation.blockingCodes.length > 0
      || remoteValidation.warningCodes.length > 0
      || !remoteValidation.canCreatePlan
    )
  ) return false;
  if (!input.unifiedDiff.trim()) return false;
  if (input.files.length !== 1) return false;
  const file = input.files[0];
  return file?.path === repositoryPath
    && file.change === 'CREATED'
    && file.oldBlobSha === null;
}

function validationReason(validation: PublicationValidationResult): string {
  return validation.blockingCodes[0]
    ?? validation.warningCodes[0]
    ?? 'P8_VALIDATION_BLOCKED';
}

export async function prepareGeneratedArticleForPublication(
  input: PrepareGeneratedArticleForPublicationInput
): Promise<PrepareGeneratedArticleForPublicationResult> {
  const targets = await eligibleTargets(input.projectId);
  if (targets.length === 0) return manual('P8_PUBLICATION_TARGET_NOT_CONFIGURED');
  if (targets.length !== 1) return manual('P8_PUBLICATION_TARGET_AMBIGUOUS');
  const target = targets[0]!;

  const existing = await prisma.publicationPlan.findFirst({
    where: { proposalId: input.proposalId, version: 1 },
    include: { preview: true }
  });
  if (existing) {
    const ready = existingPlanReady({
      plan: existing,
      projectId: input.projectId,
      proposalId: input.proposalId,
      draftId: input.draftId,
      target
    });
    return ready ?? manual('P8_EXISTING_PLAN_IDENTITY_MISMATCH');
  }

  if (!input.targetPort) return manual('P8_PUBLICATION_TARGET_PORT_NOT_CONFIGURED');

  const draftVersion = await prisma.contentDraftVersion.findFirst({
    where: { draftId: input.draftId, version: 2 }
  });
  if (!draftVersion?.contentHash) return blocked('P8_GENERATED_DRAFT_VERSION_MISSING');
  if (!draftVersion.slugCandidate || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(draftVersion.slugCandidate)) {
    return blocked('P8_GENERATED_DRAFT_SLUG_INVALID');
  }

  const publicUrl = targetPublicUrl(
    target.site.domain,
    target.channel.pathPrefix,
    draftVersion.slugCandidate
  );
  const repositoryPath = targetRepositoryPath(
    target.channel.repositoryPathTemplate,
    draftVersion.slugCandidate
  );
  if (!publicUrl || !repositoryPath) return blocked('P8_PUBLICATION_TARGET_INVALID');

  const snapshot = await input.targetPort.readTarget({
    repositoryIdentity: target.site.repositoryIdentity,
    branch: target.site.baseBranch,
    targetPublicUrl: publicUrl,
    repositoryPath
  });
  const validation = validatePublicationDraft({
    draft: {
      title: draftVersion.title,
      body: draftVersion.body,
      slugCandidate: draftVersion.slugCandidate,
      canonicalCandidate: draftVersion.canonicalCandidate,
      schemaJson: draftVersion.schemaJson,
      language: draftVersion.language
    },
    target: {
      publicUrl,
      primaryHost: target.site.domain,
      channelPathPrefix: target.channel.pathPrefix,
      repositoryPath,
      allowedRepositoryPaths: target.site.allowedPaths
    },
    resolvedFacts: {
      urlConflict: snapshot.publicUrlExists || snapshot.files[repositoryPath] !== undefined,
      sourceGaps: []
    }
  });
  if (
    !validation.canCreatePlan
    || validation.blockingCodes.length > 0
    || validation.warningCodes.length > 0
  ) {
    return blocked(validationReason(validation));
  }

  const planId = randomUUID();
  const plan = buildPublicationPlan({
    projectId: input.projectId,
    proposalId: input.proposalId,
    planVersion: 1,
    draftVersion: {
      draftId: draftVersion.draftId,
      version: draftVersion.version,
      title: draftVersion.title,
      slugCandidate: draftVersion.slugCandidate,
      body: draftVersion.body,
      excerpt: draftVersion.excerpt,
      metaTitle: draftVersion.metaTitle,
      metaDescription: draftVersion.metaDescription,
      canonicalCandidate: draftVersion.canonicalCandidate,
      schemaJson: draftVersion.schemaJson,
      author: draftVersion.author,
      language: draftVersion.language,
      contentHash: draftVersion.contentHash
    },
    site: {
      id: target.site.id,
      domain: target.site.domain,
      repositoryIdentity: target.site.repositoryIdentity,
      baseBranch: target.site.baseBranch
    },
    channel: {
      id: target.channel.id,
      pathPrefix: target.channel.pathPrefix,
      repositoryPathTemplate: target.channel.repositoryPathTemplate
    },
    intent: 'CREATE',
    validatorVersion: validation.validatorVersion,
    validationResult: validation,
    expectedOutcomes: {
      publicUrl,
      indexable: true
    },
    riskClass: 'LOW',
    rollbackStrategy: 'REVERT_COMMIT'
  }, snapshot);

  if (
    plan.riskClass !== 'LOW'
    || plan.operations.length !== 1
    || plan.operations[0]?.type !== 'CREATE_CONTENT_PAGE'
  ) {
    return blocked('P8_EXACT_AUTOMATIC_OPERATION_REQUIRED');
  }

  const adapterPreview = await input.targetPort.preview({
    projectId: input.projectId,
    proposalId: input.proposalId,
    draftId: input.draftId,
    planId,
    planHash: plan.planHash,
    repositoryIdentity: plan.targetRepository,
    branch: plan.targetBranch,
    baseSha: plan.baseSha,
    touchedBlobShas: plan.targetBlobHashes,
    riskClass: 'LOW',
    operations: plan.operations
  });
  if (!previewContractClean(adapterPreview, repositoryPath)) {
    return blocked('P8_PREVIEW_VALIDATION_BLOCKED');
  }

  const preview = createPublicationPreview({ id: planId, ...plan }, {
    files: adapterPreview.files,
    unifiedDiff: adapterPreview.unifiedDiff,
    validationResult: validation
  });

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.lockKey}, 0))`;
    const raced = await tx.publicationPlan.findFirst({
      where: { proposalId: input.proposalId, version: 1 },
      include: { preview: true }
    });
    if (raced) {
      const ready = existingPlanReady({
        plan: raced,
        projectId: input.projectId,
        proposalId: input.proposalId,
        draftId: input.draftId,
        target
      });
      return ready ?? manual('P8_EXISTING_PLAN_IDENTITY_MISMATCH');
    }

    await tx.publicationPlan.create({
      data: {
        id: planId,
        ...plan
      }
    });
    const storedPreview = await tx.publicationPreview.create({ data: preview });
    return {
      state: 'P8_READY',
      planId,
      previewId: storedPreview.id,
      reasonCode: null
    };
  });
}
