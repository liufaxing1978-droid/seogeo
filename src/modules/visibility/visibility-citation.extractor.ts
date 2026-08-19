import { createHash } from 'node:crypto';
import {
  normalizeVisibilityDomain
} from './visibility-normalization.js';
import type { VisibilitySubjectSnapshot } from './visibility-subject.service.js';

export interface VisibilityCitationExtractionInput {
  id?: string;
  status: string;
  citationEvidenceState: string;
  citationsJson: unknown;
  answerText?: unknown;
}

export interface DerivedCitation {
  citationKey: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  position: number | null;
  title: string | null;
  sourceType: string | null;
  occurrenceCount: number;
  isOwnedDomain: boolean;
  ownedSubjectId: string | null;
  competitorId: string | null;
  competitorSubjectId: string | null;
}

export type CitationExtractionResult =
  | { status: 'EXTRACTED'; citations: DerivedCitation[] }
  | { status: 'KNOWN_EMPTY'; citations: [] }
  | { status: 'UNKNOWN'; citations: [] }
  | { status: 'NOT_ELIGIBLE'; citations: [] };

interface NativeCitation {
  url: string;
  normalizedUrl: string;
  domain: string;
  position: number | null;
  title: string | null;
  sourceType: string | null;
  inputOrder: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizePosition(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeNativeUrl(value: string): { normalizedUrl: string; domain: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';
  parsed.searchParams.sort();

  const domain = normalizeVisibilityDomain(parsed.hostname);
  if (!domain) return null;

  return {
    normalizedUrl: parsed.toString().replace(/\/$/u, parsed.pathname === '/' && !parsed.search ? '' : '/'),
    domain
  };
}

function parseNativeCitation(value: unknown, inputOrder: number): NativeCitation | null {
  const record = asRecord(value);
  if (!record) return null;
  const url = nonEmptyString(record.url);
  if (!url) return null;
  const normalized = normalizeNativeUrl(url);
  if (!normalized) return null;

  return {
    url,
    normalizedUrl: normalized.normalizedUrl,
    domain: normalized.domain,
    position: normalizePosition(record.position),
    title: nonEmptyString(record.title),
    sourceType: nonEmptyString(record.sourceType),
    inputOrder
  };
}

function citationRepresentative(left: NativeCitation, right: NativeCitation): NativeCitation {
  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
  if (rightPosition < leftPosition) return right;
  if (rightPosition > leftPosition) return left;
  return right.inputOrder < left.inputOrder ? right : left;
}

function uniqueDomainSubject(
  domain: string,
  subjectSnapshot: VisibilitySubjectSnapshot
): VisibilitySubjectSnapshot['subjects'][number] | null {
  const matches = subjectSnapshot.subjects.filter((subject) =>
    (subject.subjectType === 'OWNED_DOMAIN' || subject.subjectType === 'COMPETITOR')
    && subject.normalizedValue === domain
  );
  return matches.length === 1 ? matches[0]! : null;
}

function citationKey(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

function materializeCitation(
  entries: NativeCitation[],
  subjectSnapshot: VisibilitySubjectSnapshot
): DerivedCitation {
  const representative = entries.reduce(citationRepresentative);
  const positions = entries
    .map((entry) => entry.position)
    .filter((position): position is number => position !== null)
    .sort((left, right) => left - right);
  const position = positions[0] ?? null;
  const positionedRepresentative = position === null
    ? representative
    : entries
        .filter((entry) => entry.position === position)
        .sort((left, right) => left.inputOrder - right.inputOrder)[0] ?? representative;
  const byInputOrder = [...entries].sort((left, right) => left.inputOrder - right.inputOrder);
  const fallbackTitle = byInputOrder.find((entry) => entry.title !== null)?.title ?? null;
  const fallbackSourceType = byInputOrder.find((entry) => entry.sourceType !== null)?.sourceType ?? null;

  const subject = uniqueDomainSubject(representative.domain, subjectSnapshot);
  const ownedSubjectId = subject?.subjectType === 'OWNED_DOMAIN' ? subject.id : null;
  const competitorSubjectId = subject?.subjectType === 'COMPETITOR' ? subject.id : null;
  const competitorId = subject?.subjectType === 'COMPETITOR' ? subject.competitorId : null;

  return {
    citationKey: citationKey(representative.normalizedUrl),
    url: positionedRepresentative.url,
    normalizedUrl: representative.normalizedUrl,
    domain: representative.domain,
    position,
    title: positionedRepresentative.title ?? fallbackTitle,
    sourceType: positionedRepresentative.sourceType ?? fallbackSourceType,
    occurrenceCount: entries.length,
    isOwnedDomain: ownedSubjectId !== null,
    ownedSubjectId,
    competitorId,
    competitorSubjectId
  };
}

export function extractCitations(
  observation: VisibilityCitationExtractionInput,
  subjectSnapshot: VisibilitySubjectSnapshot
): CitationExtractionResult {
  if (observation.status !== 'COMPLETED' || observation.citationEvidenceState === 'NOT_APPLICABLE') {
    return { status: 'NOT_ELIGIBLE', citations: [] };
  }

  if (observation.citationEvidenceState === 'UNKNOWN') {
    return { status: 'UNKNOWN', citations: [] };
  }

  if (observation.citationEvidenceState === 'KNOWN_EMPTY') {
    if (!Array.isArray(observation.citationsJson) || observation.citationsJson.length > 0) {
      return { status: 'UNKNOWN', citations: [] };
    }
    return { status: 'KNOWN_EMPTY', citations: [] };
  }

  if (observation.citationEvidenceState !== 'KNOWN_PRESENT') {
    return { status: 'UNKNOWN', citations: [] };
  }

  if (!Array.isArray(observation.citationsJson) || observation.citationsJson.length === 0) {
    return { status: 'UNKNOWN', citations: [] };
  }

  const nativeCitations = observation.citationsJson
    .map((entry, index) => parseNativeCitation(entry, index))
    .filter((entry): entry is NativeCitation => entry !== null);
  if (!nativeCitations.length) {
    return { status: 'UNKNOWN', citations: [] };
  }

  const byUrl = new Map<string, NativeCitation[]>();
  for (const citation of nativeCitations) {
    const entries = byUrl.get(citation.normalizedUrl) ?? [];
    entries.push(citation);
    byUrl.set(citation.normalizedUrl, entries);
  }

  const citations = [...byUrl.values()]
    .map((entries) => materializeCitation(entries, subjectSnapshot))
    .sort((left, right) =>
      (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
      || left.normalizedUrl.localeCompare(right.normalizedUrl)
    );

  return { status: 'EXTRACTED', citations };
}
