export type PublicationRiskClass = 'LOW' | 'MEDIUM' | 'HIGH';
export type PublicationPolicyReasonCode =
  | 'OPERATION_NOT_ALLOWED'
  | 'PATH_NOT_ALLOWED'
  | 'PLAN_LIMIT_EXCEEDED';

export interface PublicationOperation {
  type: string;
  path?: string;
  primaryUrl?: string;
  [key: string]: unknown;
}

export interface P8AOperationPlan {
  files: string[];
  operations: PublicationOperation[];
  primaryUrl?: string;
  primaryUrls?: string[];
  allowedPaths?: string[];
}

const LOW_OPERATIONS = new Set([
  'CREATE_CONTENT_PAGE',
  'SET_TITLE',
  'SET_META_DESCRIPTION',
  'SET_H1',
  'ADD_INTERNAL_LINK',
  'UPSERT_JSON_LD'
]);

const MEDIUM_OPERATIONS = new Set([
  'REPLACE_BOUNDED_CONTENT_BLOCK',
  'SET_CANONICAL',
  'SET_META_ROBOTS',
  'ROBOTS_RULE_CHANGE'
]);

const HIGH_OPERATIONS = new Set([
  'DELETE_PAGE',
  'BULK_REDIRECT',
  'MASS_NOINDEX',
  'MUTATE_TEMPLATE',
  'MUTATE_GLOBAL_NAVIGATION',
  'DEPLOY_PRODUCTION'
]);

export class PublicationPolicyError extends Error {
  readonly code: PublicationPolicyReasonCode;

  constructor(code: PublicationPolicyReasonCode, message: string) {
    super(message);
    this.name = 'PublicationPolicyError';
    this.code = code;
  }
}

function operationRisk(type: string): PublicationRiskClass {
  if (LOW_OPERATIONS.has(type)) return 'LOW';
  if (MEDIUM_OPERATIONS.has(type)) return 'MEDIUM';
  if (HIGH_OPERATIONS.has(type)) return 'HIGH';
  return 'HIGH';
}

export function classifyPublicationRisk(operations: PublicationOperation[]): PublicationRiskClass {
  let highest: PublicationRiskClass = 'LOW';

  for (const operation of operations) {
    const risk = operationRisk(operation.type);
    if (risk === 'HIGH') return 'HIGH';
    if (risk === 'MEDIUM') highest = 'MEDIUM';
  }

  return highest;
}

function assertSafeRelativePath(path: string): void {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new PublicationPolicyError('PATH_NOT_ALLOWED', `Publication path is not a safe relative path: ${path}`);
  }

  const segments = path.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new PublicationPolicyError('PATH_NOT_ALLOWED', `Publication path traversal is not allowed: ${path}`);
  }
}

function normalizeAllowedPrefix(prefix: string): string {
  assertSafeRelativePath(prefix.replace(/\/+$/, ''));
  return prefix.replace(/\/+$/, '');
}

function assertPathAllowed(path: string, allowedPaths?: string[]): void {
  assertSafeRelativePath(path);
  if (!allowedPaths || allowedPaths.length === 0) return;

  const allowed = allowedPaths.some((prefix) => {
    const normalized = normalizeAllowedPrefix(prefix);
    return path === normalized || path.startsWith(`${normalized}/`);
  });

  if (!allowed) {
    throw new PublicationPolicyError('PATH_NOT_ALLOWED', `Publication path is outside configured allowlists: ${path}`);
  }
}

function collectPrimaryUrls(plan: P8AOperationPlan): Set<string> {
  const urls = new Set<string>();
  if (plan.primaryUrl) urls.add(plan.primaryUrl);
  for (const url of plan.primaryUrls ?? []) {
    if (url) urls.add(url);
  }
  for (const operation of plan.operations) {
    if (typeof operation.primaryUrl === 'string' && operation.primaryUrl) urls.add(operation.primaryUrl);
  }
  return urls;
}

export function assertP8AOperationPolicy(plan: P8AOperationPlan): void {
  if (plan.files.length > 20) {
    throw new PublicationPolicyError('PLAN_LIMIT_EXCEEDED', 'P8-A plans may touch at most 20 files');
  }
  if (plan.operations.length > 50) {
    throw new PublicationPolicyError('PLAN_LIMIT_EXCEEDED', 'P8-A plans may contain at most 50 operations');
  }
  if (collectPrimaryUrls(plan).size > 1) {
    throw new PublicationPolicyError('PLAN_LIMIT_EXCEEDED', 'P8-A plans may target only one primary public URL');
  }

  for (const file of plan.files) assertPathAllowed(file, plan.allowedPaths);
  for (const operation of plan.operations) {
    if (operation.path !== undefined) assertPathAllowed(operation.path, plan.allowedPaths);

    if (!LOW_OPERATIONS.has(operation.type) && !MEDIUM_OPERATIONS.has(operation.type)) {
      throw new PublicationPolicyError('OPERATION_NOT_ALLOWED', `P8-A operation is not allowed: ${operation.type}`);
    }
  }
}
