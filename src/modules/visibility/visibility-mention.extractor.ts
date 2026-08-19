import type {
  VisibilityMentionType,
  VisibilitySubjectType
} from '@prisma/client';
import {
  findDeterministicOccurrences,
  normalizeVisibilityName
} from './visibility-normalization.js';
import type { VisibilitySubjectSnapshot } from './visibility-subject.service.js';

export interface DerivedMention {
  subjectId: string;
  subjectType: VisibilitySubjectType;
  subjectValue: string;
  matchedValue: string;
  mentionType: VisibilityMentionType;
  occurrenceCount: number;
  firstPosition: number;
}

export type MentionExtractionResult =
  | { status: 'EXTRACTED'; mentions: DerivedMention[] }
  | { status: 'KNOWN_EMPTY'; mentions: [] }
  | { status: 'UNKNOWN'; mentions: [] };

function mentionSort(left: DerivedMention, right: DerivedMention): number {
  return left.firstPosition - right.firstPosition
    || left.subjectId.localeCompare(right.subjectId)
    || left.mentionType.localeCompare(right.mentionType)
    || left.matchedValue.localeCompare(right.matchedValue);
}

function pushMention(
  mentions: DerivedMention[],
  subject: VisibilitySubjectSnapshot['subjects'][number],
  matchedValue: string,
  mentionType: VisibilityMentionType,
  positions: number[]
) {
  if (!positions.length) return;
  mentions.push({
    subjectId: subject.id,
    subjectType: subject.subjectType,
    subjectValue: subject.subjectType === 'OWNED_DOMAIN' || subject.subjectType === 'COMPETITOR'
      ? subject.normalizedValue
      : subject.canonicalValue,
    matchedValue,
    mentionType,
    occurrenceCount: positions.length,
    firstPosition: positions[0]!
  });
}

export function extractMentions(
  answerText: unknown,
  subjectSnapshot: VisibilitySubjectSnapshot
): MentionExtractionResult {
  if (typeof answerText !== 'string' || answerText.trim().length === 0) {
    return { status: 'UNKNOWN', mentions: [] };
  }

  const ambiguousAliases = new Set(
    subjectSnapshot.ambiguousAliases
      .map((alias) => normalizeVisibilityName(alias))
      .filter(Boolean)
  );
  const mentions: DerivedMention[] = [];

  for (const subject of subjectSnapshot.subjects) {
    const isDomainSubject = subject.subjectType === 'OWNED_DOMAIN' || subject.subjectType === 'COMPETITOR';
    const canonicalMatchedValue = subject.normalizedValue;
    const canonicalPositions = findDeterministicOccurrences(
      answerText,
      canonicalMatchedValue,
      isDomainSubject ? 'DOMAIN' : 'AUTO'
    );
    pushMention(
      mentions,
      subject,
      canonicalMatchedValue,
      isDomainSubject ? 'DOMAIN' : 'EXACT',
      canonicalPositions
    );

    for (const aliasValue of subject.aliases) {
      const normalizedAlias = normalizeVisibilityName(aliasValue);
      if (!normalizedAlias) continue;
      if (ambiguousAliases.has(normalizedAlias)) continue;
      if (normalizedAlias === subject.normalizedValue) continue;

      const aliasPositions = findDeterministicOccurrences(
        answerText,
        normalizedAlias,
        'AUTO'
      );
      pushMention(
        mentions,
        subject,
        normalizedAlias,
        'NORMALIZED_ALIAS',
        aliasPositions
      );
    }
  }

  if (!mentions.length) {
    return { status: 'KNOWN_EMPTY', mentions: [] };
  }

  mentions.sort(mentionSort);
  return { status: 'EXTRACTED', mentions };
}
