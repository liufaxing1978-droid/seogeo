import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { KeywordDiscoveryRepository } from '../keywords/keyword-discovery.repository.js';
import { KeywordDiscoveryService } from '../keywords/keyword-discovery.service.js';
import {
  GoogleSearchConsoleClient,
  type GoogleOAuthConfig,
} from '../search-console/google-search-console.client.js';
import {
  createOAuthCredentialVault,
  parseOAuthCredentialKey,
} from '../search-console/oauth-credential-vault.js';
import { searchConsoleObservability } from '../search-console/search-console.observability.js';
import { searchConsoleRepository } from '../search-console/search-console.repository.js';
import { SearchConsoleService } from '../search-console/search-console.service.js';
import {
  SearchConsoleSyncError,
  syncSearchConsoleDay,
  type SearchConsoleSyncDependencies,
} from '../search-console/search-console.worker.js';
import { SearchFactMaterializer } from '../search-facts/search-fact.materializer.js';
import { officialSearchSyncRepository } from './official-search-sync.repository.js';
import { OfficialSearchSyncService } from './official-search-sync.service.js';
import type { OfficialSearchBindingRepositoryPort } from './official-search-sync.types.js';

const marketCodeSchema = z.enum(['CN', 'GLOBAL', 'HK', 'TW', 'SG', 'MY']);
const bindingBodySchema = z.object({
  provider: z.enum(['GOOGLE_SEARCH_CONSOLE', 'BING_WEBMASTER']),
  propertyRef: z.string().trim().min(1).max(2048),
  marketCode: marketCodeSchema,
  locale: z.string().trim().min(1).max(64),
}).strict();
const bindingPatchSchema = z.object({
  isActive: z.boolean(),
}).strict();
const syncBodySchema = z.object({
  bindingId: z.string().uuid(),
  dateFrom: z.string().trim().min(1),
  dateTo: z.string().trim().min(1),
}).strict();

let configuredGoogleDependencies: SearchConsoleSyncDependencies | null = null;

function googleSyncDependencies(): SearchConsoleSyncDependencies {
  if (configuredGoogleDependencies) return configuredGoogleDependencies;

  if (
    !env.GOOGLE_OAUTH_CLIENT_ID
    || !env.GOOGLE_OAUTH_CLIENT_SECRET
    || !env.GOOGLE_OAUTH_REDIRECT_URI
    || !env.OAUTH_CREDENTIAL_ENCRYPTION_KEY
  ) {
    throw new SearchConsoleSyncError(
      'Google Search Console sync is not configured',
      'SYNC_NOT_CONFIGURED',
    );
  }

  try {
    const oauthConfig: GoogleOAuthConfig = {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    };
    const transport = new GoogleSearchConsoleClient(oauthConfig);
    const vault = createOAuthCredentialVault({
      key: parseOAuthCredentialKey(env.OAUTH_CREDENTIAL_ENCRYPTION_KEY),
      keyVersion: env.OAUTH_CREDENTIAL_KEY_VERSION,
      store: searchConsoleRepository,
    });
    const searchConsoleService = new SearchConsoleService({
      repository: searchConsoleRepository,
      vault,
      transport,
      oauthConfig,
    });

    configuredGoogleDependencies = {
      repository: searchConsoleRepository,
      transport,
      accessTokenProvider: {
        getAccessToken: (projectId) => searchConsoleService.getAccessTokenForSync(projectId),
      },
      observability: searchConsoleObservability,
    };
    return configuredGoogleDependencies;
  } catch (error) {
    if (error instanceof SearchConsoleSyncError) throw error;
    throw new SearchConsoleSyncError(
      'Google Search Console sync configuration is invalid',
      'SYNC_NOT_CONFIGURED',
      { cause: error },
    );
  }
}

const lazyGoogleDependencies: SearchConsoleSyncDependencies = {
  repository: searchConsoleRepository,
  transport: {
    exchangeCode: (input) => googleSyncDependencies().transport.exchangeCode(input),
    refreshToken: (refreshToken) => googleSyncDependencies().transport.refreshToken(refreshToken),
    listSites: (accessToken) => googleSyncDependencies().transport.listSites(accessToken),
    querySearchAnalytics: (accessToken, siteUrl, request) =>
      googleSyncDependencies().transport.querySearchAnalytics(accessToken, siteUrl, request),
  },
  accessTokenProvider: {
    getAccessToken: (projectId) => googleSyncDependencies().accessTokenProvider.getAccessToken(projectId),
  },
  observability: searchConsoleObservability,
};

function createDefaultOfficialSearchSyncService(
  repository: OfficialSearchBindingRepositoryPort,
): OfficialSearchSyncService {
  return new OfficialSearchSyncService({
    bindingRepository: repository,
    googlePropertyRepository: searchConsoleRepository,
    googleDailySync: async (input) => {
      const dependencies = googleSyncDependencies();
      return syncSearchConsoleDay(input, dependencies);
    },
    googleDependencies: lazyGoogleDependencies,
    materializer: new SearchFactMaterializer(prisma),
    discoveryService: new KeywordDiscoveryService({
      repository: new KeywordDiscoveryRepository(prisma),
    }),
  });
}

function routeParam(value: string | string[]): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

export function createOfficialSearchSyncRoutes(
  repository: OfficialSearchBindingRepositoryPort = officialSearchSyncRepository,
  syncService?: Pick<OfficialSearchSyncService, 'sync'>,
) {
  const router = Router();
  let defaultSyncService: OfficialSearchSyncService | null = null;
  const resolvedSyncService = () => {
    if (syncService) return syncService;
    defaultSyncService ??= createDefaultOfficialSearchSyncService(repository);
    return defaultSyncService;
  };
  const readGuards = [
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
  ];
  const mutationGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_SETTINGS_WRITE'),
  ];

  router.get(
    '/projects/:projectId/search-provider-bindings',
    ...readGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        res.json({ data: await repository.listBindings(projectId) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/search-provider-bindings',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const body = bindingBodySchema.parse(req.body);
        const input = { projectId, ...body };
        const existing = await repository.findBindingByIdentity(input);
        if (existing) {
          return res.json({ data: existing });
        }
        const created = await repository.createBinding(input);
        return res.status(201).json({ data: created });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/projects/:projectId/search-provider-bindings/:bindingId',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const bindingId = routeParam(req.params.bindingId);
        const body = bindingPatchSchema.parse(req.body);
        const updated = await repository.setBindingActive(
          projectId,
          bindingId,
          body.isActive,
        );
        if (!updated) {
          throw new NotFoundError(
            'Search provider binding not found',
            'SEARCH_PROVIDER_BINDING_NOT_FOUND',
          );
        }
        res.json({ data: updated });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/search-sync',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const body = syncBodySchema.parse(req.body);
        const result = await resolvedSyncService().sync({ projectId, ...body });
        res.json({ data: result });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
