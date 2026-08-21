import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PublicationSiteService } from '../../src/modules/publication/publication-site.service.js';

const projectIds: string[] = [];

async function createProject(label: string, planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' = 'ADVANCED') {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p8-site-${suffix}`,
      primaryDomain: `p8-site-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

describe('P8-A publication site/channel configuration', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      const sites = await prisma.publicationSite.findMany({ where: { projectId }, select: { id: true } });
      if (sites.length > 0) {
        await prisma.publicationChannel.deleteMany({ where: { siteId: { in: sites.map((site) => site.id) } } });
      }
      await prisma.publicationSite.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('persists xingshantang.org with explicit independent channel-to-repository mappings', async () => {
    const project = await createProject('P8 xingshantang mapping');
    const service = new PublicationSiteService();

    const site = await service.configureSite({
      projectId: project.id,
      displayName: '兴善堂',
      publicBaseUrl: 'https://xingshantang.org',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      baseBranch: 'main',
      allowedPaths: ['content/news/', 'content/culture/', 'content/archives/']
    });

    expect(site.domain).toBe('xingshantang.org');
    expect(site.repositoryIdentity).toBe('liufaxing1978-droid/xingshantang');
    expect(site.baseBranch).toBe('main');

    const configured = await Promise.all([
      service.configureChannel({
        siteId: site.id,
        pathPrefix: '/news',
        displayName: '最新消息',
        repositoryPathTemplate: 'content/news/{slug}.md',
        contentType: 'ARTICLE'
      }),
      service.configureChannel({
        siteId: site.id,
        pathPrefix: '/culture',
        displayName: '六壬文化',
        repositoryPathTemplate: 'content/culture/{slug}.md',
        contentType: 'ARTICLE'
      }),
      service.configureChannel({
        siteId: site.id,
        pathPrefix: '/archives',
        displayName: '民宗文献',
        repositoryPathTemplate: 'content/archives/{slug}.md',
        contentType: 'ARTICLE'
      })
    ]);

    expect(configured.map((channel) => [channel.pathPrefix, channel.repositoryPathTemplate])).toEqual([
      ['/news', 'content/news/{slug}.md'],
      ['/culture', 'content/culture/{slug}.md'],
      ['/archives', 'content/archives/{slug}.md']
    ]);

    const mappings = await service.listChannelMappings(site.id);
    expect(mappings.map((channel) => ({
      publicPathPrefix: channel.pathPrefix,
      repositoryPathTemplate: channel.repositoryPathTemplate
    }))).toEqual([
      { publicPathPrefix: '/archives', repositoryPathTemplate: 'content/archives/{slug}.md' },
      { publicPathPrefix: '/culture', repositoryPathTemplate: 'content/culture/{slug}.md' },
      { publicPathPrefix: '/news', repositoryPathTemplate: 'content/news/{slug}.md' }
    ]);
  });

  it('never infers a filesystem mapping from a public URL prefix', async () => {
    const project = await createProject('P8 explicit mapping');
    const service = new PublicationSiteService();
    const site = await service.configureSite({
      projectId: project.id,
      displayName: 'Explicit mapping',
      publicBaseUrl: 'https://explicit.example.com',
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      allowedPaths: ['content/news/']
    });

    await expect(service.configureChannel({
      siteId: site.id,
      pathPrefix: '/news',
      displayName: 'News',
      repositoryPathTemplate: '',
      contentType: 'ARTICLE'
    })).rejects.toThrow(/repository path template/i);
  });

  it('requires an absolute clean HTTPS site URL', async () => {
    const project = await createProject('P8 https validation');
    const service = new PublicationSiteService();

    for (const publicBaseUrl of [
      'xingshantang.org',
      'http://xingshantang.org',
      'https://xingshantang.org/news',
      'https://xingshantang.org?preview=1',
      'https://xingshantang.org#fragment'
    ]) {
      expect(() => service.configureSite({
        projectId: project.id,
        displayName: 'Invalid',
        publicBaseUrl,
        adapterType: 'EXPORT_ONLY',
        writeCapability: 'EXPORT_ONLY',
        allowedPaths: ['content/news/']
      })).toThrow(/https|base url/i);
    }
  });

  it('requires explicit Git repository identity and base branch for Git-backed sites', async () => {
    const project = await createProject('P8 Git config');
    const service = new PublicationSiteService();

    expect(() => service.configureSite({
      projectId: project.id,
      displayName: 'Missing repo',
      publicBaseUrl: 'https://missing-repo.example.com',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      baseBranch: 'main',
      allowedPaths: ['content/news/']
    })).toThrow(/repository identity/i);

    expect(() => service.configureSite({
      projectId: project.id,
      displayName: 'Missing branch',
      publicBaseUrl: 'https://missing-branch.example.com',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      repositoryIdentity: 'owner/site',
      allowedPaths: ['content/news/']
    })).toThrow(/base branch/i);
  });

  it('allows export-only sites without remote repository credentials but still requires path bounds', async () => {
    const project = await createProject('P8 export only', 'STANDARD');
    const service = new PublicationSiteService();

    const site = await service.configureSite({
      projectId: project.id,
      displayName: 'Export only',
      publicBaseUrl: 'https://export.example.com',
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      allowedPaths: ['content/news/']
    });

    expect(site.repositoryIdentity).toBeNull();
    expect(site.baseBranch).toBeNull();

    expect(() => service.configureSite({
      projectId: project.id,
      displayName: 'Unbounded export',
      publicBaseUrl: 'https://unbounded.example.com',
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      allowedPaths: []
    })).toThrow(/allowed path/i);
  });

  it('rejects channel repository templates outside the site allowlist or with traversal', async () => {
    const project = await createProject('P8 channel bounds');
    const service = new PublicationSiteService();
    const site = await service.configureSite({
      projectId: project.id,
      displayName: 'Bounds',
      publicBaseUrl: 'https://bounds.example.com',
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      allowedPaths: ['content/news/']
    });

    await expect(service.configureChannel({
      siteId: site.id,
      pathPrefix: '/news',
      displayName: 'Outside',
      repositoryPathTemplate: 'src/{slug}.ts',
      contentType: 'ARTICLE'
    })).rejects.toThrow(/allowed path/i);

    await expect(service.configureChannel({
      siteId: site.id,
      pathPrefix: '/news-2',
      displayName: 'Traversal',
      repositoryPathTemplate: 'content/news/../../secret/{slug}.md',
      contentType: 'ARTICLE'
    })).rejects.toThrow(/repository path template|allowed path/i);
  });
});
