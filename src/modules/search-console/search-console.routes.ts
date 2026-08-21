import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { AppError } from '../../core/errors.js';
import { env } from '../../config/env.js';
import {
  createOAuthCredentialVault,
  parseOAuthCredentialKey
} from './oauth-credential-vault.js';
import {
  GoogleSearchConsoleClient,
  GoogleSearchConsoleTransportError
} from './google-search-console.client.js';
import {
  SearchConsoleRepository,
  searchConsoleRepository
} from './search-console.repository.js';
import {
  SearchConsoleService,
  SearchConsoleServiceError
} from './search-console.service.js';

const emptyBodySchema = z.object({}).strict();
const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(16).max(4096)
}).strict();
const propertyBodySchema = z.object({
  propertyUri: z.string().trim().min(1).max(2048)
}).strict();

let defaultService: SearchConsoleService | null = null;

function configuredService(): SearchConsoleService {
  if (defaultService) return defaultService;
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  const encryptionKey = env.OAUTH_CREDENTIAL_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    throw new SearchConsoleServiceError(
      'Google Search Console OAuth is not configured',
      'SEARCH_CONSOLE_OAUTH_NOT_CONFIGURED',
      503
    );
  }
  const repository: SearchConsoleRepository = searchConsoleRepository;
  const vault = createOAuthCredentialVault({
    key: parseOAuthCredentialKey(encryptionKey),
    keyVersion: env.OAUTH_CREDENTIAL_KEY_VERSION,
    store: repository
  });
  const oauthConfig = { clientId, clientSecret, redirectUri };
  defaultService = new SearchConsoleService({
    repository,
    vault,
    transport: new GoogleSearchConsoleClient(oauthConfig),
    oauthConfig
  });
  return defaultService;
}

function asAppError(error: unknown): never {
  if (error instanceof SearchConsoleServiceError) {
    throw new AppError(error.message, error.status, error.code);
  }
  if (error instanceof GoogleSearchConsoleTransportError) {
    throw new AppError(error.message, 502, error.code, {
      providerHttpStatus: error.httpStatus
    });
  }
  throw error;
}

export function createSearchConsoleRoutes(injectedService?: SearchConsoleService) {
  const router = Router();
  const service = () => injectedService ?? configuredService();
  const searchConsoleGate = requireFeature('SEARCH_CONSOLE');

  router.get('/projects/:projectId/search-console/status', searchConsoleGate, async (req, res, next) => {
    try {
      res.json({ data: await service().getStatus(req.params.projectId) });
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:projectId/search-console/oauth/start', searchConsoleGate, async (req, res, next) => {
    try {
      emptyBodySchema.parse(req.body ?? {});
      const actorId = `project-api:${req.params.projectId}`;
      const data = await service().beginGoogleOAuth(req.params.projectId, actorId);
      res.status(201).json({ data });
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.get('/search-console/oauth/callback', async (req, res, next) => {
    try {
      const input = callbackQuerySchema.parse(req.query);
      const data = await service().completeGoogleOAuth(input.code, input.state);
      res.json({ data });
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.get('/projects/:projectId/search-console/properties', searchConsoleGate, async (req, res, next) => {
    try {
      res.json({ data: await service().listReadableProperties(req.params.projectId) });
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:projectId/search-console/property', searchConsoleGate, async (req, res, next) => {
    try {
      const input = propertyBodySchema.parse(req.body);
      const data = await service().bindProperty(req.params.projectId, input.propertyUri);
      res.json({ data });
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.delete('/projects/:projectId/search-console/connection', searchConsoleGate, async (req, res, next) => {
    try {
      await service().disconnect(req.params.projectId);
      res.status(204).end();
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  return router;
}
