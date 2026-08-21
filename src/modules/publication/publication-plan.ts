import type { Prisma, PublicationRiskClass } from '@prisma/client';
import { planHashV1, previewHashV1 } from './publication.hash.js';
import type {
  CreatePublicationPlanInput,
  CreatePublicationPreviewInput
} from './publication.types.js';
import type { PublicationValidationResult } from './publication-validation.js';

export type PublicationPlanIntent = 'CREATE' | 'UPDATE';
export type PublicationFileChange = 'CREATED' | 'MODIFIED' | 'DELETED';

export class PublicationPlanError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationPlanError';
  }
}

export interface ImmutableDraftVersionInput {
  draftId: string;
  version: number;
  title: string;
  slugCandidate: string | null;
  body: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalCandidate: string | null;
  schemaJson: Prisma.JsonValue | Prisma.InputJsonValue | null;
  author: string | null;
  language: string;
  contentHash: string;
}

export interface BuildPublicationPlanInput {
  projectId: string;
  proposalId: string;
  planVersion: number;
  draftVersion: ImmutableDraftVersionInput;
  site: {
    id: string;
    domain: string;
    repositoryIdentity: string;
    baseBranch: string;
  };
  channel: {
    id: string;
    pathPrefix: string;
    repositoryPathTemplate: string;
  };
  intent: PublicationPlanIntent;
  validatorVersion: string;
  validationResult: PublicationValidationResult;
  expectedOutcomes: Prisma.InputJsonValue;
  riskClass: PublicationRiskClass;
  rollbackStrategy: string;
}

export interface PublicationTargetSnapshot {
  repositoryIdentity: string;
  branch: string;
  headSha: string;
  publicUrlExists: boolean;
  files: Record<string, string>;
}

export interface PublicationContentOperation {
  type: 'CREATE_CONTENT_PAGE' | 'UPDATE_CONTENT_PAGE';
  path: string;
  targetUrl: string;
  contentHash: string;
  content: string;
  title: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalCandidate: string | null;
  schemaJson: Prisma.JsonValue | Prisma.InputJsonValue | null;
  author: string | null;
  language: string;
}

export type PublicationPlanPayload = Omit<
  CreatePublicationPlanInput,
  'operations' | 'targetBlobHashes'
> & {
  targetBlobHashes: Record<string, string>;
  operations: PublicationContentOperation[] & Prisma.InputJsonValue;
};

export interface AdapterPreviewFile {
  path: string;
  change: PublicationFileChange;
  oldBlobSha: string | null;
  newContentHash: string | null;
}

export interface AdapterPublicationPreview {
  files: AdapterPreviewFile[];
  unifiedDiff: string;
  validationResult: PublicationValidationResult;
}

export interface PublicationPreviewDiffPayload {
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  fileChanges: AdapterPreviewFile[];
  operations: PublicationContentOperation[];
  unifiedDiff: string;
  expectedOutcomes: Prisma.InputJsonValue;
  baseSha: string;
  targetBlobHashes: Record<string, string>;
  riskClass: PublicationRiskClass;
  validatorVersion: string;
  planHash: string;
}

export type PublicationPreviewPayload = Omit<
  CreatePublicationPreviewInput,
  'diffPayload' | 'validationResult'
> & {
  diffPayload: PublicationPreviewDiffPayload & Prisma.InputJsonValue;
  validationResult: PublicationValidationResult & Prisma.InputJsonValue;
};

function planError(code: string, message: string): never {
  throw new PublicationPlanError(code, message);
}

function normalizeChannelPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  const leading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return leading.length > 1 && leading.endsWith('/') ? leading.slice(0, -1) : leading;
}

function validateSlug(value: string | null): string {
  const slug = value?.trim() ?? '';
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
    return planError('PUBLICATION_VALIDATION_FAILED', 'A safe slug candidate is required for publication planning');
  }
  return slug;
}

function targetPublicUrl(domain: string, prefix: string, slug: string): string {
  const hostname = domain.trim().toLowerCase();
  if (!hostname || hostname.includes('/') || hostname.includes(':')) {
    return planError('PUBLICATION_VALIDATION_FAILED', 'Publication site domain must be a hostname');
  }
  const pathPrefix = normalizeChannelPrefix(prefix);
  const pathname = pathPrefix === '/' ? `/${slug}` : `${pathPrefix}/${slug}`;
  return `https://${hostname}${pathname}`;
}

function targetRepositoryPath(template: string, slug: string): string {
  const normalizedTemplate = template.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalizedTemplate.includes('{slug}')) {
    return planError('PUBLICATION_VALIDATION_FAILED', 'Repository path template must include {slug}');
  }
  const path = normalizedTemplate.replaceAll('{slug}', slug);
  if (!path || path.startsWith('/') || path.includes('../') || path.includes('/..')) {
    return planError('PATH_NOT_ALLOWED', 'Resolved repository path is outside the safe relative path contract');
  }
  return path;
}

function assertSnapshotMatchesTarget(
  input: BuildPublicationPlanInput,
  snapshot: PublicationTargetSnapshot
): void {
  if (
    snapshot.repositoryIdentity !== input.site.repositoryIdentity
    || snapshot.branch !== input.site.baseBranch
    || !snapshot.headSha.trim()
  ) {
    planError('TARGET_REVISION_CHANGED', 'Target snapshot does not match the configured repository and branch');
  }
}

function operationFor(
  input: BuildPublicationPlanInput,
  path: string,
  publicUrl: string
): PublicationContentOperation {
  const draft = input.draftVersion;
  return {
    type: input.intent === 'CREATE' ? 'CREATE_CONTENT_PAGE' : 'UPDATE_CONTENT_PAGE',
    path,
    targetUrl: publicUrl,
    contentHash: draft.contentHash,
    content: draft.body,
    title: draft.title,
    excerpt: draft.excerpt,
    metaTitle: draft.metaTitle,
    metaDescription: draft.metaDescription,
    canonicalCandidate: draft.canonicalCandidate,
    schemaJson: draft.schemaJson,
    author: draft.author,
    language: draft.language
  };
}

export function buildPublicationPlan(
  input: BuildPublicationPlanInput,
  targetSnapshot: PublicationTargetSnapshot
): PublicationPlanPayload {
  if (!input.validationResult.canCreatePlan) {
    planError('VALIDATION_FAILED', 'Deterministic publication validation has not cleared plan creation');
  }
  if (input.planVersion < 1 || !Number.isInteger(input.planVersion)) {
    planError('PUBLICATION_VALIDATION_FAILED', 'Plan version must be a positive integer');
  }
  if (input.draftVersion.version < 1 || !Number.isInteger(input.draftVersion.version)) {
    planError('PUBLICATION_VALIDATION_FAILED', 'Draft version must be a positive integer');
  }
  if (!input.draftVersion.contentHash.trim()) {
    planError('PUBLICATION_VALIDATION_FAILED', 'Immutable draft version must have a content hash');
  }

  assertSnapshotMatchesTarget(input, targetSnapshot);
  const slug = validateSlug(input.draftVersion.slugCandidate);
  const publicUrl = targetPublicUrl(input.site.domain, input.channel.pathPrefix, slug);
  const repositoryPath = targetRepositoryPath(input.channel.repositoryPathTemplate, slug);
  const existingBlobSha = targetSnapshot.files[repositoryPath] ?? null;

  if (input.intent === 'CREATE' && (targetSnapshot.publicUrlExists || existingBlobSha !== null)) {
    planError('URL_CONFLICT', 'CREATE intent cannot target an existing public URL or repository file');
  }
  if (input.intent === 'UPDATE' && existingBlobSha === null) {
    planError('TARGET_NOT_FOUND', 'UPDATE intent requires an existing repository target');
  }

  const targetBlobHashes = existingBlobSha === null
    ? {}
    : { [repositoryPath]: existingBlobSha };
  const operations = [operationFor(input, repositoryPath, publicUrl)];
  const jsonOperations = operations as PublicationContentOperation[] & Prisma.InputJsonValue;

  const hashBinding = {
    projectId: input.projectId,
    proposalId: input.proposalId,
    draftId: input.draftVersion.draftId,
    draftVersion: input.draftVersion.version,
    siteId: input.site.id,
    channelId: input.channel.id,
    version: input.planVersion,
    targetPublicUrl: publicUrl,
    targetRepository: input.site.repositoryIdentity,
    targetBranch: input.site.baseBranch,
    baseSha: targetSnapshot.headSha,
    targetBlobHashes,
    operations,
    expectedOutcomes: input.expectedOutcomes,
    validatorVersion: input.validatorVersion,
    riskClass: input.riskClass,
    rollbackStrategy: input.rollbackStrategy
  };

  return {
    ...hashBinding,
    targetBlobHashes,
    operations: jsonOperations,
    planHash: planHashV1(hashBinding)
  };
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function createPublicationPreview(
  plan: PublicationPlanPayload & { id: string },
  adapterPreview: AdapterPublicationPreview
): PublicationPreviewPayload {
  const deleted = adapterPreview.files.filter((file) => file.change === 'DELETED');
  if (deleted.length > 0) {
    planError('OPERATION_NOT_ALLOWED', 'P8-A publication previews cannot delete files');
  }

  const filesCreated = sortedUnique(
    adapterPreview.files.filter((file) => file.change === 'CREATED').map((file) => file.path)
  );
  const filesModified = sortedUnique(
    adapterPreview.files.filter((file) => file.change === 'MODIFIED').map((file) => file.path)
  );
  const filesDeleted: string[] = [];
  const fileChanges = [...adapterPreview.files].sort((left, right) => left.path.localeCompare(right.path));

  const diffPayload: PublicationPreviewDiffPayload = {
    filesCreated,
    filesModified,
    filesDeleted,
    fileChanges,
    operations: plan.operations,
    unifiedDiff: adapterPreview.unifiedDiff,
    expectedOutcomes: plan.expectedOutcomes,
    baseSha: plan.baseSha,
    targetBlobHashes: plan.targetBlobHashes,
    riskClass: plan.riskClass,
    validatorVersion: plan.validatorVersion,
    planHash: plan.planHash
  };
  const hashBinding = {
    projectId: plan.projectId,
    planId: plan.id,
    planHash: plan.planHash,
    diffPayload,
    validationResult: adapterPreview.validationResult
  };

  return {
    projectId: plan.projectId,
    planId: plan.id,
    previewHash: previewHashV1(hashBinding),
    diffSummary: `${filesCreated.length} created, ${filesModified.length} modified, ${filesDeleted.length} deleted`,
    diffPayload: diffPayload as PublicationPreviewDiffPayload & Prisma.InputJsonValue,
    validationResult: adapterPreview.validationResult as PublicationValidationResult & Prisma.InputJsonValue
  };
}
