import { createHash } from 'node:crypto';

const CONTENT_HASH_VERSION = 'PUBLICATION_CONTENT_HASH_V1';
const PREVIEW_HASH_VERSION = 'PUBLICATION_PREVIEW_HASH_V1';
const PLAN_HASH_VERSION = 'PUBLICATION_PLAN_HASH_V1';
const APPROVAL_HASH_VERSION = 'PUBLICATION_APPROVAL_HASH_V1';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Publication hash input must contain only finite numbers');
      return JSON.stringify(value);
    case 'object': {
      if (seen.has(value)) throw new TypeError('Publication hash input must not contain cycles');
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map((item) => canonicalize(item, seen)).join(',')}]`;
        }
        if (!isPlainObject(value)) {
          throw new TypeError('Publication hash input must contain only plain JSON objects');
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
          throw new TypeError('Publication hash input must not contain symbol keys');
        }
        const entries = Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], seen)}`);
        return `{${entries.join(',')}}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      throw new TypeError(`Unsupported publication hash value: ${typeof value}`);
  }
}

export function canonicalPublicationJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

function sha256Versioned(version: string, value: unknown): string {
  return createHash('sha256')
    .update(version, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalPublicationJson(value), 'utf8')
    .digest('hex');
}

function stableOperationIdentity(operation: unknown): string {
  if (!isPlainObject(operation)) return canonicalPublicationJson(operation);
  const type = typeof operation.type === 'string' ? operation.type : '';
  const path = typeof operation.path === 'string' ? operation.path : '';
  const primaryUrl = typeof operation.primaryUrl === 'string' ? operation.primaryUrl : '';
  const targetUrl = typeof operation.targetUrl === 'string' ? operation.targetUrl : '';
  return `${type}\0${path}\0${primaryUrl}\0${targetUrl}\0${canonicalPublicationJson(operation)}`;
}

function normalizeSetLikeArray(values: unknown[]): unknown[] {
  return [...values].sort((left, right) => canonicalPublicationJson(left).localeCompare(canonicalPublicationJson(right)));
}

function normalizePlanPayload(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const normalized: Record<string, unknown> = { ...value };

  if (Array.isArray(value.files)) {
    normalized.files = normalizeSetLikeArray(value.files);
  }
  if (Array.isArray(value.operations)) {
    normalized.operations = [...value.operations].sort((left, right) =>
      stableOperationIdentity(left).localeCompare(stableOperationIdentity(right))
    );
  }

  return normalized;
}

function normalizeApprovalPayload(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  if (Array.isArray(value.confirmedWarningCodes)) {
    normalized.confirmedWarningCodes = normalizeSetLikeArray(value.confirmedWarningCodes);
  }
  return normalized;
}

export function contentHashV1(content: unknown): string {
  return sha256Versioned(CONTENT_HASH_VERSION, content);
}

export function previewHashV1(preview: unknown): string {
  return sha256Versioned(PREVIEW_HASH_VERSION, preview);
}

export function planHashV1(plan: unknown): string {
  return sha256Versioned(PLAN_HASH_VERSION, normalizePlanPayload(plan));
}

export function approvalHashV1(approvalBinding: unknown): string {
  return sha256Versioned(APPROVAL_HASH_VERSION, normalizeApprovalPayload(approvalBinding));
}
