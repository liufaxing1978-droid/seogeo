import { describe, expect, it, vi } from 'vitest';
import {
  MainSiteDraftSyncService,
  MainSiteDraftSyncServiceError,
} from '../../src/modules/publication/main-site-draft-sync.service.js';
import { XingshantangCmsError } from '../../src/modules/publication/xingshantang-cms.client.js';

const draft = {
  id: 'draft-1', projectId: 'project-1', currentVersion: 3, status: 'DRAFT',
};
const draftVersion = {
  title: '六壬伏英馆', slugCandidate: 'fuyingguan', body: '# 六壬伏英馆',
  excerpt: '文化介绍', metaDescription: null, schemaJson: { '@context': 'https://schema.org', '@type': 'FAQPage' },
};

function fixtures() {
  const existing = vi.fn().mockResolvedValue(null);
  const created = { id: 'sync-1', draftId: draft.id, draftVersion: 3, mainArticleId: 'main-1', section: '六壬文化' };
  const repository = {
    getDraftForMainSiteSync: vi.fn().mockResolvedValue(draft),
    getDraftVersion: vi.fn().mockResolvedValue(draftVersion),
    getMainSiteDraftSync: existing,
    getLatestMainSiteDraftSync: vi.fn().mockResolvedValue(null),
    createMainSiteDraftSync: vi.fn().mockResolvedValue(created),
  };
  const cms = {
    createDraft: vi.fn().mockResolvedValue({ articleId: 'main-1', status: 'draft' as const }),
    updateDraftSchema: vi.fn().mockResolvedValue({ articleId: 'main-1', status: 'draft' as const }),
  };
  return { repository, cms, created };
}

describe('MainSiteDraftSyncService', () => {
  it('creates exactly one main-site draft for the same content version', async () => {
    const { repository, cms, created } = fixtures();
    const service = new MainSiteDraftSyncService(repository, cms);

    const first = await service.syncDraftVersion({ projectId: draft.projectId, draftId: draft.id, section: '六壬文化', actorId: 'user-1' });
    repository.getMainSiteDraftSync.mockResolvedValue(created);
    const second = await service.syncDraftVersion({ projectId: draft.projectId, draftId: draft.id, section: '六壬文化', actorId: 'user-1' });

    expect(first).toEqual(created);
    expect(second).toEqual(created);
    expect(cms.createDraft).toHaveBeenCalledTimes(1);
    expect(cms.createDraft).toHaveBeenCalledWith({
      title: draftVersion.title, slug: draftVersion.slugCandidate, section: '六壬文化', summary: draftVersion.excerpt, body: draftVersion.body,
    });
  });

  it('does not persist a successful sync record when the main site rejects the request', async () => {
    const { repository, cms } = fixtures();
    cms.createDraft.mockRejectedValue(new XingshantangCmsError('conflict', 'XINGSHANTANG_CMS_SLUG_CONFLICT', 409, false));
    const service = new MainSiteDraftSyncService(repository, cms);

    await expect(service.syncDraftVersion({ projectId: draft.projectId, draftId: draft.id, section: '六壬文化', actorId: 'user-1' }))
      .rejects.toMatchObject({ code: 'XINGSHANTANG_CMS_SLUG_CONFLICT' });
    expect(repository.createMainSiteDraftSync).not.toHaveBeenCalled();
  });

  it('rejects a draft without a slug before writing to the main site', async () => {
    const { repository, cms } = fixtures();
    repository.getDraftVersion.mockResolvedValue({ ...draftVersion, slugCandidate: null });
    const service = new MainSiteDraftSyncService(repository, cms);

    await expect(service.syncDraftVersion({ projectId: draft.projectId, draftId: draft.id, section: '六壬文化', actorId: 'user-1' }))
      .rejects.toMatchObject({ code: 'MAIN_SITE_DRAFT_SLUG_REQUIRED' } satisfies Partial<MainSiteDraftSyncServiceError>);
    expect(cms.createDraft).not.toHaveBeenCalled();
  });

  it('updates Schema on the existing main-site draft without creating another article', async () => {
    const { repository, cms, created } = fixtures();
    repository.getLatestMainSiteDraftSync.mockResolvedValue(created);
    cms.updateDraftSchema.mockResolvedValue({ articleId: created.mainArticleId, status: 'draft' });
    const service = new MainSiteDraftSyncService(repository, cms);

    await expect(service.syncSchemaToExistingMainSiteDraft({ projectId: draft.projectId, draftId: draft.id, actorId: 'user-1' })).resolves.toEqual(created);
    expect(cms.updateDraftSchema).toHaveBeenCalledWith({ articleId: created.mainArticleId, schemaJson: draftVersion.schemaJson });
    expect(cms.createDraft).not.toHaveBeenCalled();
    expect(repository.createMainSiteDraftSync).not.toHaveBeenCalled();
  });

  it('uses the latest main-site draft when Schema was saved as a newer SEO draft version', async () => {
    const { repository, cms, created } = fixtures();
    repository.getDraftForMainSiteSync.mockResolvedValue({ ...draft, currentVersion: 4 });
    repository.getDraftVersion.mockResolvedValue({ ...draftVersion, schemaJson: { '@context': 'https://schema.org', '@type': 'Article' } });
    repository.getLatestMainSiteDraftSync.mockResolvedValue({ ...created, draftVersion: 3 });
    const service = new MainSiteDraftSyncService(repository, cms);

    await service.syncSchemaToExistingMainSiteDraft({ projectId: draft.projectId, draftId: draft.id, actorId: 'user-1' });

    expect(cms.updateDraftSchema).toHaveBeenCalledWith({
      articleId: created.mainArticleId,
      schemaJson: { '@context': 'https://schema.org', '@type': 'Article' }
    });
    expect(cms.createDraft).not.toHaveBeenCalled();
  });
});
