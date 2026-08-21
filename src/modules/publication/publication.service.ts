import {
  Prisma,
  type ContentDraftStatus,
  type ContentGeneratedBy
} from '@prisma/client';
import { contentHashV1 } from './publication.hash.js';
import {
  PublicationRepository,
  publicationRepository
} from './publication.repository.js';

export class PublicationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationServiceError';
  }
}

export interface CreateManualProposalInput {
  reason: string;
}

export interface CreateDraftFromProposalInput {
  title: string;
  slugCandidate?: string | null;
  body: string;
  excerpt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalCandidate?: string | null;
  schemaJson?: Prisma.InputJsonValue | null;
  author?: string | null;
  language: string;
  status?: ContentDraftStatus;
  generatedBy: ContentGeneratedBy;
}

export interface SaveDraftVersionInput {
  title?: string;
  slugCandidate?: string | null;
  body?: string;
  excerpt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalCandidate?: string | null;
  schemaJson?: Prisma.InputJsonValue | null;
  author?: string | null;
  language?: string;
  status?: ContentDraftStatus;
}

export interface SourceReferenceInput {
  title: string;
  author?: string | null;
  publisher?: string | null;
  sourceUrl?: string | null;
  publishedAt?: Date | null;
  sourceType: string;
  accessedAt?: Date | null;
  userProvided?: boolean;
  internalRef?: boolean;
}

export type UpdateSourceReferenceInput = Partial<SourceReferenceInput>;

function serviceError(code: string, message: string): never {
  throw new PublicationServiceError(code, message);
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) serviceError('PUBLICATION_VALIDATION_FAILED', `${label} is required`);
  if (normalized.length > maxLength) {
    serviceError('PUBLICATION_VALIDATION_FAILED', `${label} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  label: string,
  maxLength: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    serviceError('PUBLICATION_VALIDATION_FAILED', `${label} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function validateActorId(actorId: string): string {
  return requiredText(actorId, 'actor id', 200);
}

function validateDate(value: Date | null | undefined, label: string): Date | null | undefined {
  if (value === undefined || value === null) return value;
  if (Number.isNaN(value.getTime())) {
    serviceError('PUBLICATION_VALIDATION_FAILED', `${label} must be a valid date`);
  }
  return value;
}

function validateSourceUrl(value: string | null | undefined): string | null | undefined {
  const normalized = optionalText(value, 'source URL', 2048);
  if (normalized === undefined || normalized === null) return normalized;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return serviceError('PUBLICATION_VALIDATION_FAILED', 'source URL must be an absolute HTTP(S) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return serviceError('PUBLICATION_VALIDATION_FAILED', 'source URL must use HTTP(S)');
  }
  return parsed.toString();
}

function nullableField<T>(incoming: T | null | undefined, current: T | null): T | null {
  return incoming === undefined ? current : incoming;
}

function normalizedDraftForHash(input: {
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
}) {
  return {
    title: input.title,
    slugCandidate: input.slugCandidate,
    body: input.body,
    excerpt: input.excerpt,
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    canonicalCandidate: input.canonicalCandidate,
    schemaJson: input.schemaJson,
    author: input.author,
    language: input.language
  };
}

export class PublicationService {
  constructor(private readonly repository: PublicationRepository = publicationRepository) {}

  async createProposalFromGrowthOpportunity(
    projectId: string,
    opportunityIdentityId: string,
    actorId: string
  ) {
    const normalizedProjectId = requiredText(projectId, 'project id', 100);
    const normalizedIdentityId = requiredText(opportunityIdentityId, 'opportunity identity id', 100);
    const normalizedActorId = validateActorId(actorId);

    const source = await this.repository.getGrowthOpportunityProposalSource(
      normalizedProjectId,
      normalizedIdentityId
    );
    if (!source) {
      serviceError('GROWTH_OPPORTUNITY_NOT_FOUND', 'Growth opportunity identity not found for project');
    }
    const snapshot = source.snapshots[0];
    if (!snapshot) {
      serviceError('GROWTH_OPPORTUNITY_SNAPSHOT_NOT_FOUND', 'Growth opportunity has no persisted snapshot');
    }

    return this.repository.createProposal({
      projectId: normalizedProjectId,
      sourceType: 'P7_GROWTH_OPPORTUNITY',
      reason: `P7 growth opportunity: ${snapshot.primaryType}`,
      createdBy: normalizedActorId,
      sourceReferenceId: source.id,
      sourceSnapshotId: snapshot.id,
      sourceMetadata: {
        identityType: source.identityType,
        normalizedQuery: source.normalizedQuery,
        canonicalPage: source.canonicalPage,
        opportunityType: snapshot.primaryType,
        priority: snapshot.priority,
        score: snapshot.score,
        evidenceQuality: snapshot.evidenceQuality,
        rankingEligible: snapshot.rankingEligible,
        snapshotVersion: snapshot.snapshotVersion
      }
    });
  }

  async createManualProposal(projectId: string, input: CreateManualProposalInput, actorId: string) {
    const normalizedProjectId = requiredText(projectId, 'project id', 100);
    const normalizedActorId = validateActorId(actorId);
    const reason = requiredText(input.reason, 'reason', 1000);

    const project = await this.repository.getProject(normalizedProjectId);
    if (!project) serviceError('PROJECT_NOT_FOUND', 'Publication target project not found');

    return this.repository.createProposal({
      projectId: normalizedProjectId,
      sourceType: 'MANUAL',
      reason,
      createdBy: normalizedActorId
    });
  }

  async createDraftFromProposal(proposalId: string, input: CreateDraftFromProposalInput) {
    const normalizedProposalId = requiredText(proposalId, 'proposal id', 100);
    const proposal = await this.repository.getProposal(normalizedProposalId);
    if (!proposal) serviceError('PUBLICATION_PROPOSAL_NOT_FOUND', 'Publication proposal not found');

    const title = requiredText(input.title, 'draft title', 300);
    const language = requiredText(input.language, 'draft language', 32);
    const slugCandidate = optionalText(input.slugCandidate, 'slug candidate', 200) ?? null;
    const excerpt = optionalText(input.excerpt, 'excerpt', 1000) ?? null;
    const metaTitle = optionalText(input.metaTitle, 'meta title', 300) ?? null;
    const metaDescription = optionalText(input.metaDescription, 'meta description', 1000) ?? null;
    const canonicalCandidate = optionalText(input.canonicalCandidate, 'canonical candidate', 2048) ?? null;
    const author = optionalText(input.author, 'author', 300) ?? null;
    const schemaJson = input.schemaJson ?? null;
    const contentHash = contentHashV1(normalizedDraftForHash({
      title,
      slugCandidate,
      body: input.body,
      excerpt,
      metaTitle,
      metaDescription,
      canonicalCandidate,
      schemaJson,
      author,
      language
    }));

    return this.repository.createDraft({
      projectId: proposal.projectId,
      sourceProposalId: proposal.id,
      title,
      slugCandidate,
      body: input.body,
      excerpt,
      metaTitle,
      metaDescription,
      canonicalCandidate,
      ...(schemaJson !== null ? { schemaJson } : {}),
      author,
      language,
      contentHash,
      status: input.status ?? 'DRAFT',
      generatedBy: input.generatedBy
    });
  }

  async saveDraftVersion(
    draftId: string,
    expectedVersion: number,
    input: SaveDraftVersionInput,
    generatedBy: ContentGeneratedBy
  ) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      serviceError('PUBLICATION_VALIDATION_FAILED', 'expectedVersion must be a positive integer');
    }

    const draft = await this.repository.getDraft(draftId);
    if (!draft) serviceError('CONTENT_DRAFT_NOT_FOUND', 'Content draft not found');
    if (draft.currentVersion !== expectedVersion) {
      serviceError('DRAFT_VERSION_CONFLICT', 'Content draft version changed; reload before saving');
    }

    const title = input.title === undefined
      ? draft.title
      : requiredText(input.title, 'draft title', 300);
    const slugCandidate = nullableField(
      input.slugCandidate === undefined
        ? undefined
        : optionalText(input.slugCandidate, 'slug candidate', 200),
      draft.slugCandidate
    );
    const body = input.body ?? draft.body;
    const excerpt = nullableField(
      input.excerpt === undefined ? undefined : optionalText(input.excerpt, 'excerpt', 1000),
      draft.excerpt
    );
    const metaTitle = nullableField(
      input.metaTitle === undefined ? undefined : optionalText(input.metaTitle, 'meta title', 300),
      draft.metaTitle
    );
    const metaDescription = nullableField(
      input.metaDescription === undefined
        ? undefined
        : optionalText(input.metaDescription, 'meta description', 1000),
      draft.metaDescription
    );
    const canonicalCandidate = nullableField(
      input.canonicalCandidate === undefined
        ? undefined
        : optionalText(input.canonicalCandidate, 'canonical candidate', 2048),
      draft.canonicalCandidate
    );
    const schemaJson = input.schemaJson === undefined ? draft.schemaJson : input.schemaJson;
    const author = nullableField(
      input.author === undefined ? undefined : optionalText(input.author, 'author', 300),
      draft.author
    );
    const language = input.language === undefined
      ? draft.language
      : requiredText(input.language, 'draft language', 32);
    const status = input.status ?? draft.status;
    const contentHash = contentHashV1(normalizedDraftForHash({
      title,
      slugCandidate,
      body,
      excerpt,
      metaTitle,
      metaDescription,
      canonicalCandidate,
      schemaJson,
      author,
      language
    }));

    const version = await this.repository.appendDraftVersionIfCurrent(
      draft.id,
      expectedVersion,
      {
        title,
        slugCandidate,
        body,
        excerpt,
        metaTitle,
        metaDescription,
        canonicalCandidate,
        schemaJson,
        author,
        language,
        contentHash,
        status,
        generatedBy
      }
    );
    if (!version) {
      serviceError('DRAFT_VERSION_CONFLICT', 'Content draft version changed; reload before saving');
    }
    return version;
  }

  async addSourceReference(draftId: string, input: SourceReferenceInput) {
    const draft = await this.repository.getDraft(draftId);
    if (!draft) serviceError('CONTENT_DRAFT_NOT_FOUND', 'Content draft not found');

    return this.repository.createSourceReference({
      projectId: draft.projectId,
      draftId: draft.id,
      title: requiredText(input.title, 'source title', 500),
      author: optionalText(input.author, 'source author', 300) ?? null,
      publisher: optionalText(input.publisher, 'source publisher', 300) ?? null,
      sourceUrl: validateSourceUrl(input.sourceUrl) ?? null,
      publishedAt: validateDate(input.publishedAt, 'publishedAt') ?? null,
      sourceType: requiredText(input.sourceType, 'source type', 64),
      accessedAt: validateDate(input.accessedAt, 'accessedAt') ?? null,
      userProvided: input.userProvided ?? false,
      internalRef: input.internalRef ?? false
    });
  }

  async listSourceReferences(draftId: string) {
    const draft = await this.repository.getDraft(draftId);
    if (!draft) serviceError('CONTENT_DRAFT_NOT_FOUND', 'Content draft not found');
    return this.repository.listSourceReferences(draft.id);
  }

  async updateSourceReference(referenceId: string, input: UpdateSourceReferenceInput) {
    const current = await this.repository.getSourceReference(referenceId);
    if (!current) serviceError('CONTENT_SOURCE_REFERENCE_NOT_FOUND', 'Content source reference not found');

    const data: Prisma.ContentSourceReferenceUpdateInput = {};
    if (input.title !== undefined) data.title = requiredText(input.title, 'source title', 500);
    if (input.author !== undefined) data.author = optionalText(input.author, 'source author', 300) ?? null;
    if (input.publisher !== undefined) data.publisher = optionalText(input.publisher, 'source publisher', 300) ?? null;
    if (input.sourceUrl !== undefined) data.sourceUrl = validateSourceUrl(input.sourceUrl) ?? null;
    if (input.publishedAt !== undefined) data.publishedAt = validateDate(input.publishedAt, 'publishedAt') ?? null;
    if (input.sourceType !== undefined) data.sourceType = requiredText(input.sourceType, 'source type', 64);
    if (input.accessedAt !== undefined) data.accessedAt = validateDate(input.accessedAt, 'accessedAt') ?? null;
    if (input.userProvided !== undefined) data.userProvided = input.userProvided;
    if (input.internalRef !== undefined) data.internalRef = input.internalRef;

    return this.repository.updateSourceReference(current.id, data);
  }

  async deleteSourceReference(referenceId: string) {
    const current = await this.repository.getSourceReference(referenceId);
    if (!current) serviceError('CONTENT_SOURCE_REFERENCE_NOT_FOUND', 'Content source reference not found');
    return this.repository.deleteSourceReference(current.id);
  }
}

export const publicationService = new PublicationService();
