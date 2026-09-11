import { MAIN_SITE_SECTIONS, type MainSiteSection, type CreateMainSiteDraftInput, type UpdateMainSiteDraftSchemaInput } from './xingshantang-cms.client.js';

type SyncableDraft = {
  id: string;
  projectId: string;
  currentVersion: number;
  status: string;
};

type SyncableDraftVersion = {
  title: string;
  slugCandidate: string | null;
  body: string;
  excerpt: string | null;
  metaDescription: string | null;
  schemaJson?: unknown;
};

export type MainSiteDraftSyncRecord = {
  id: string;
  projectId: string;
  draftId: string;
  draftVersion: number;
  mainArticleId: string;
  section: string;
};

export interface MainSiteDraftSyncRepository {
  getDraftForMainSiteSync(projectId: string, draftId: string): Promise<SyncableDraft | null>;
  getDraftVersion(draftId: string, version: number): Promise<SyncableDraftVersion | null>;
  getMainSiteDraftSync(draftId: string, draftVersion: number): Promise<MainSiteDraftSyncRecord | null>;
  getLatestMainSiteDraftSync(draftId: string): Promise<MainSiteDraftSyncRecord | null>;
  createMainSiteDraftSync(input: Omit<MainSiteDraftSyncRecord, 'id'>): Promise<MainSiteDraftSyncRecord>;
}

export interface MainSiteDraftCmsClient {
  createDraft(input: CreateMainSiteDraftInput): Promise<{ articleId: string; status: 'draft' }>;
  updateDraftSchema(input: UpdateMainSiteDraftSchemaInput): Promise<{ articleId: string; status: 'draft' | 'published' }>;
}

export class MainSiteDraftSyncServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MainSiteDraftSyncServiceError';
  }
}

function validSection(section: string): section is MainSiteSection {
  return (MAIN_SITE_SECTIONS as readonly string[]).includes(section);
}

function validSchemaJson(value: unknown): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const context = record['@context']; const type = record['@type'];
  return (context === 'https://schema.org' || context === 'http://schema.org')
    && (typeof type === 'string' ? type.trim().length > 0 : Array.isArray(type) && type.length > 0);
}

export class MainSiteDraftSyncService {
  constructor(
    private readonly repository: MainSiteDraftSyncRepository,
    private readonly cms: MainSiteDraftCmsClient
  ) {}

  async syncDraftVersion(input: {
    projectId: string;
    draftId: string;
    section: MainSiteSection;
    actorId: string;
  }): Promise<MainSiteDraftSyncRecord> {
    if (!input.projectId || !input.draftId || !input.actorId) {
      throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_INPUT_INVALID', 'Project, draft and actor are required');
    }
    if (!validSection(input.section)) {
      throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_SECTION_INVALID', 'Main-site section is not allowed');
    }

    const draft = await this.repository.getDraftForMainSiteSync(input.projectId, input.draftId);
    if (!draft) throw new MainSiteDraftSyncServiceError('PUBLICATION_DRAFT_NOT_FOUND', 'Content draft not found');
    if (draft.status === 'ARCHIVED') {
      throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_ARCHIVED', 'Archived drafts cannot be synced');
    }
    const version = await this.repository.getDraftVersion(draft.id, draft.currentVersion);
    if (!version) {
      throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_VERSION_NOT_FOUND', 'Content draft version not found');
    }
    const slug = version.slugCandidate?.trim();
    if (!slug) throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_SLUG_REQUIRED', 'A draft slug is required before syncing');

    const existing = await this.repository.getMainSiteDraftSync(draft.id, draft.currentVersion);
    if (existing) return existing;

    const created = await this.cms.createDraft({
      title: version.title,
      slug,
      section: input.section,
      summary: version.excerpt ?? version.metaDescription ?? '',
      body: version.body
    });
    return this.repository.createMainSiteDraftSync({
      projectId: draft.projectId,
      draftId: draft.id,
      draftVersion: draft.currentVersion,
      mainArticleId: created.articleId,
      section: input.section
    });
  }

  async syncSchemaToExistingMainSiteDraft(input: { projectId: string; draftId: string; actorId: string }): Promise<MainSiteDraftSyncRecord> {
    const draft = await this.repository.getDraftForMainSiteSync(input.projectId, input.draftId);
    if (!draft) throw new MainSiteDraftSyncServiceError('PUBLICATION_DRAFT_NOT_FOUND', 'Content draft not found');
    if (draft.status === 'ARCHIVED') throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_ARCHIVED', 'Archived drafts cannot be synced');
    const version = await this.repository.getDraftVersion(draft.id, draft.currentVersion);
    if (!version) throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_VERSION_NOT_FOUND', 'Content draft version not found');
    if (!validSchemaJson(version.schemaJson)) throw new MainSiteDraftSyncServiceError('MAIN_SITE_SCHEMA_INVALID', 'A valid Schema candidate is required');
    // Saving Schema creates a new SEO draft version. Reuse the existing main-site
    // article for this logical draft instead of creating a duplicate article.
    const existing = await this.repository.getLatestMainSiteDraftSync(draft.id);
    if (!existing) throw new MainSiteDraftSyncServiceError('MAIN_SITE_DRAFT_SYNC_REQUIRED', 'Sync this draft to the main site before updating Schema');
    await this.cms.updateDraftSchema({ articleId: existing.mainArticleId, schemaJson: version.schemaJson });
    return existing;
  }
}
