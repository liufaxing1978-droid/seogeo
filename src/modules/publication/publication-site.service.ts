import type {
  Prisma,
  PublicationAdapterType,
  PublicationWriteCapability
} from '@prisma/client';
import {
  PublicationRepository,
  publicationRepository
} from './publication.repository.js';

export interface ConfigurePublicationSiteInput {
  projectId: string;
  displayName: string;
  publicBaseUrl: string;
  adapterType: PublicationAdapterType;
  writeCapability: PublicationWriteCapability;
  repositoryIdentity?: string | null;
  baseBranch?: string | null;
  allowedPaths: string[];
  enabled?: boolean;
}

export interface ConfigurePublicationChannelInput {
  siteId: string;
  pathPrefix: string;
  displayName: string;
  repositoryPathTemplate: string;
  contentType?: string | null;
  defaultSchemaTypes?: Prisma.InputJsonValue;
  allowedOperationClasses?: Prisma.InputJsonValue;
  enabled?: boolean;
}

function invalidSite(message: string): never {
  throw new Error(`Invalid publication site: ${message}`);
}

function invalidChannel(message: string): never {
  throw new Error(`Invalid publication channel: ${message}`);
}

function normalizePublicBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidSite('base URL must be an absolute HTTPS URL');
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return invalidSite('base URL must be a clean absolute HTTPS origin');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return invalidSite('base URL must contain a hostname');
  return hostname;
}

function normalizeRepositoryPrefix(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (
    !trimmed ||
    trimmed.includes('\0') ||
    trimmed.includes('\\') ||
    trimmed.startsWith('/') ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return invalidSite('allowed path must be a safe relative repository prefix');
  }

  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return invalidSite('allowed path must not contain traversal or empty segments');
  }

  return `${trimmed}/`;
}

function normalizeAllowedPaths(values: string[]): string[] {
  if (values.length === 0) return invalidSite('at least one allowed path is required');
  return [...new Set(values.map(normalizeRepositoryPrefix))].sort();
}

function parseStoredAllowedPaths(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((entry) => typeof entry === 'string')) {
    return invalidChannel('site allowed path configuration is missing or invalid');
  }
  return value as string[];
}

function normalizePublicPathPrefix(value: string): string {
  const trimmed = value.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('\\')
  ) {
    return invalidChannel('public path prefix must be an absolute URL path');
  }

  const withoutTrailingSlash = trimmed === '/' ? '/' : trimmed.replace(/\/+$/, '');
  const segments = withoutTrailingSlash.split('/').slice(1);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return invalidChannel('public path prefix must not contain traversal or empty segments');
  }
  return withoutTrailingSlash;
}

function validateRepositoryPathTemplate(template: string, allowedPaths: string[]): string {
  const trimmed = template.trim();
  if (!trimmed) return invalidChannel('repository path template is required');
  if (!trimmed.includes('{slug}')) {
    return invalidChannel('repository path template must include {slug}');
  }
  if (
    trimmed.includes('\0') ||
    trimmed.includes('\\') ||
    trimmed.startsWith('/') ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return invalidChannel('repository path template must be a safe relative path');
  }

  const samplePath = trimmed.replaceAll('{slug}', 'publication-slug');
  const segments = samplePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return invalidChannel('repository path template must not contain traversal or empty segments');
  }

  const allowed = allowedPaths.some((prefix) => samplePath.startsWith(prefix));
  if (!allowed) return invalidChannel('repository path template is outside the site allowed path list');
  return trimmed;
}

function validateRepositoryIdentity(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    return invalidSite('repository identity is required in owner/name form');
  }
  return trimmed;
}

function validateBaseBranch(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('..') || /[\s~^:?*\[\\]/.test(trimmed)) {
    return invalidSite('base branch is required and must be a safe Git ref name');
  }
  return trimmed;
}

export class PublicationSiteService {
  constructor(private readonly repository: PublicationRepository = publicationRepository) {}

  configureSite(input: ConfigurePublicationSiteInput) {
    const domain = normalizePublicBaseUrl(input.publicBaseUrl);
    const allowedPaths = normalizeAllowedPaths(input.allowedPaths);
    const displayName = input.displayName.trim();
    if (!displayName) invalidSite('display name is required');

    let repositoryIdentity: string | null = null;
    let baseBranch: string | null = null;

    if (input.adapterType === 'GITHUB_GIT') {
      if (input.writeCapability !== 'GIT_DRAFT_PR') {
        invalidSite('Git-backed sites require GIT_DRAFT_PR write capability');
      }
      repositoryIdentity = validateRepositoryIdentity(input.repositoryIdentity);
      baseBranch = validateBaseBranch(input.baseBranch);
    } else if (input.adapterType === 'EXPORT_ONLY') {
      if (input.writeCapability !== 'EXPORT_ONLY') {
        invalidSite('export-only sites require EXPORT_ONLY write capability');
      }
    } else {
      invalidSite('unsupported adapter type');
    }

    return this.repository.createSite({
      projectId: input.projectId,
      displayName,
      domain,
      repositoryIdentity,
      baseBranch,
      adapterType: input.adapterType,
      writeCapability: input.writeCapability,
      allowedPaths,
      enabled: input.enabled ?? true
    });
  }

  async configureChannel(input: ConfigurePublicationChannelInput) {
    const site = await this.repository.getSite(input.siteId);
    if (!site) invalidChannel('site not found');

    const allowedPaths = parseStoredAllowedPaths(site.allowedPaths);
    const pathPrefix = normalizePublicPathPrefix(input.pathPrefix);
    const repositoryPathTemplate = validateRepositoryPathTemplate(
      input.repositoryPathTemplate,
      allowedPaths
    );
    const displayName = input.displayName.trim();
    if (!displayName) invalidChannel('display name is required');

    return this.repository.createChannel({
      siteId: site.id,
      pathPrefix,
      displayName,
      repositoryPathTemplate,
      contentType: input.contentType?.trim() || null,
      defaultSchemaTypes: input.defaultSchemaTypes,
      allowedOperationClasses: input.allowedOperationClasses,
      enabled: input.enabled ?? true
    });
  }

  async listChannelMappings(siteId: string) {
    const site = await this.repository.getSite(siteId);
    if (!site) invalidChannel('site not found');
    return this.repository.listChannels(siteId);
  }
}

export const publicationSiteService = new PublicationSiteService();
