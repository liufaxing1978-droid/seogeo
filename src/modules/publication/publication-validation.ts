export const PUBLICATION_VALIDATOR_VERSION = 'PUBLICATION_VALIDATOR_V1' as const;

export type PublicationValidationSeverity = 'BLOCKING' | 'WARNING' | 'INFO';

export type PublicationValidationCode =
  | 'TITLE_REQUIRED'
  | 'BODY_REQUIRED'
  | 'TARGET_URL_INVALID'
  | 'CANONICAL_MISMATCH'
  | 'SCHEMA_INVALID'
  | 'UNSAFE_HTML'
  | 'DUPLICATE_SLUG'
  | 'PATH_NOT_ALLOWED'
  | 'H1_REQUIRED'
  | 'SOURCE_GAP';

export interface PublicationValidationFinding {
  severity: PublicationValidationSeverity;
  code: PublicationValidationCode;
  message: string;
}

export interface PublicationValidationInput {
  draft: {
    title: string;
    body: string;
    slugCandidate?: string | null;
    canonicalCandidate?: string | null;
    schemaJson?: unknown;
    language: string;
  };
  target: {
    publicUrl: string;
    primaryHost: string;
    channelPathPrefix: string;
    repositoryPath: string;
    allowedRepositoryPaths: string[];
  };
  resolvedFacts: {
    urlConflict: boolean;
    sourceGaps: string[];
  };
  confirmedWarningCodes?: string[];
}

export interface PublicationValidationResult {
  validatorVersion: typeof PUBLICATION_VALIDATOR_VERSION;
  findings: PublicationValidationFinding[];
  blockingCodes: PublicationValidationCode[];
  warningCodes: PublicationValidationCode[];
  infoCodes: PublicationValidationCode[];
  unconfirmedWarningCodes: PublicationValidationCode[];
  canCreatePlan: boolean;
}

function addFinding(
  findings: PublicationValidationFinding[],
  severity: PublicationValidationSeverity,
  code: PublicationValidationCode,
  message: string
): void {
  if (findings.some((finding) => finding.code === code && finding.severity === severity)) return;
  findings.push({ severity, code, message });
}

function parseHttpsUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedPathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.length > 1 && withLeading.endsWith('/')
    ? withLeading.slice(0, -1)
    : withLeading;
}

function isPathWithinPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname.startsWith('/');
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isRepositoryPathAllowed(path: string, allowedPrefixes: string[]): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || normalized.includes('/..')) {
    return false;
  }
  return allowedPrefixes.some((allowed) => {
    const prefix = allowed.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    if (!prefix) return false;
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return normalized === prefix.replace(/\/$/, '') || normalized.startsWith(normalizedPrefix);
  });
}

function containsUnsafeHtml(body: string): boolean {
  return /<\s*script\b/i.test(body)
    || /<\s*iframe\b/i.test(body)
    || /\son[a-z]+\s*=/i.test(body);
}

function hasH1Equivalent(body: string): boolean {
  return /^\s*#\s+\S+/m.test(body) || /<h1(?:\s[^>]*)?>[\s\S]*?<\/h1\s*>/i.test(body);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidJsonLd(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const context = record['@context'];
  const type = record['@type'];
  const contextValid = context === 'https://schema.org'
    || context === 'http://schema.org'
    || (typeof context === 'object' && context !== null && !Array.isArray(context));
  const typeValid = isNonEmptyString(type)
    || (Array.isArray(type) && type.length > 0 && type.every(isNonEmptyString));
  return contextValid && typeValid;
}

function uniqueCodes(
  findings: PublicationValidationFinding[],
  severity: PublicationValidationSeverity
): PublicationValidationCode[] {
  const seen = new Set<PublicationValidationCode>();
  const result: PublicationValidationCode[] = [];
  for (const finding of findings) {
    if (finding.severity !== severity || seen.has(finding.code)) continue;
    seen.add(finding.code);
    result.push(finding.code);
  }
  return result;
}

export function validatePublicationDraft(input: PublicationValidationInput): PublicationValidationResult {
  const findings: PublicationValidationFinding[] = [];

  if (!input.draft.title.trim()) {
    addFinding(findings, 'BLOCKING', 'TITLE_REQUIRED', 'A non-empty title is required before plan creation.');
  }
  if (!input.draft.body.trim()) {
    addFinding(findings, 'BLOCKING', 'BODY_REQUIRED', 'A non-empty article body is required before plan creation.');
  }

  const targetUrl = parseHttpsUrl(input.target.publicUrl);
  if (!targetUrl) {
    addFinding(findings, 'BLOCKING', 'TARGET_URL_INVALID', 'Target public URL must be a valid HTTPS URL.');
  }

  const primaryHost = input.target.primaryHost.trim().toLowerCase();
  const canonicalCandidate = input.draft.canonicalCandidate?.trim() ?? '';
  if (canonicalCandidate) {
    const canonicalUrl = parseHttpsUrl(canonicalCandidate);
    const canonicalMatches = targetUrl !== null
      && canonicalUrl !== null
      && canonicalUrl.hostname.toLowerCase() === primaryHost
      && canonicalUrl.href === targetUrl.href;
    if (!canonicalMatches) {
      addFinding(
        findings,
        'BLOCKING',
        'CANONICAL_MISMATCH',
        'Canonical candidate must be a valid HTTPS URL on the configured primary host and exactly match the target URL.'
      );
    }
  }

  if (containsUnsafeHtml(input.draft.body)) {
    addFinding(
      findings,
      'BLOCKING',
      'UNSAFE_HTML',
      'Article body contains blocked script, iframe, or inline event-handler HTML.'
    );
  }

  if (!isValidJsonLd(input.draft.schemaJson)) {
    addFinding(
      findings,
      'BLOCKING',
      'SCHEMA_INVALID',
      'Schema candidate must be a JSON-LD object with a valid @context and non-empty @type.'
    );
  }

  if (input.resolvedFacts.urlConflict) {
    addFinding(
      findings,
      'BLOCKING',
      'DUPLICATE_SLUG',
      'The separately resolved target URL already exists and cannot silently become a create operation.'
    );
  }

  const channelPrefix = normalizedPathPrefix(input.target.channelPathPrefix);
  const targetPathAllowed = targetUrl !== null && isPathWithinPrefix(targetUrl.pathname, channelPrefix);
  const repositoryPathAllowed = isRepositoryPathAllowed(
    input.target.repositoryPath,
    input.target.allowedRepositoryPaths
  );
  if (!targetPathAllowed || !repositoryPathAllowed) {
    addFinding(
      findings,
      'BLOCKING',
      'PATH_NOT_ALLOWED',
      'Target URL or repository path is outside the configured publication channel allowlist.'
    );
  }

  if (input.draft.body.trim() && !hasH1Equivalent(input.draft.body)) {
    addFinding(
      findings,
      'BLOCKING',
      'H1_REQUIRED',
      'Article body must contain an H1-equivalent Markdown or HTML heading.'
    );
  }

  if (input.resolvedFacts.sourceGaps.some((gap) => gap.trim().length > 0)) {
    addFinding(
      findings,
      'WARNING',
      'SOURCE_GAP',
      'One or more claims still have unresolved source gaps and require explicit human review.'
    );
  }

  const blockingCodes = uniqueCodes(findings, 'BLOCKING');
  const warningCodes = uniqueCodes(findings, 'WARNING');
  const infoCodes = uniqueCodes(findings, 'INFO');
  const confirmedWarnings = new Set(input.confirmedWarningCodes ?? []);
  const unconfirmedWarningCodes = warningCodes.filter((code) => !confirmedWarnings.has(code));

  return {
    validatorVersion: PUBLICATION_VALIDATOR_VERSION,
    findings,
    blockingCodes,
    warningCodes,
    infoCodes,
    unconfirmedWarningCodes,
    canCreatePlan: blockingCodes.length === 0 && unconfirmedWarningCodes.length === 0
  };
}
