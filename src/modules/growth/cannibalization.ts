export type CannibalizationPageInput = {
  canonicalPage: string;
  impressions: number;
  position: number | null;
  ctr: number;
};

export type KeywordCannibalizationInput = {
  normalizedQuery: string;
  demandScore: number | null;
  pages: readonly CannibalizationPageInput[];
};

export type CannibalizationContext = {
  pageEvidenceStrength?: Readonly<Record<string, number>>;
};

export type CannibalizationPage = CannibalizationPageInput & {
  impressionShare: number;
};

export type KeywordCannibalizationResult =
  | {
      state: 'DETECTED';
      type: 'KEYWORD_CANNIBALIZATION';
      competingPages: CannibalizationPage[];
      primaryPageCandidate:
        | { state: 'KNOWN'; canonicalPage: string }
        | { state: 'UNKNOWN'; canonicalPage: null };
      reasonCodes: string[];
    }
  | {
      state: 'NOT_DETECTED' | 'UNKNOWN';
      type: 'KEYWORD_CANNIBALIZATION';
      competingPages: CannibalizationPage[];
      primaryPageCandidate: { state: 'UNKNOWN'; canonicalPage: null };
      reasonCodes: string[];
    };

export const CANNIBALIZATION_MAX_PAGES = 20;

function normalizeCanonicalPage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('canonicalPage is required');
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return trimmed.replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

function collapsePages(pages: readonly CannibalizationPageInput[]): CannibalizationPageInput[] {
  if (pages.length > CANNIBALIZATION_MAX_PAGES) {
    throw new Error(`Keyword cannibalization supports at most ${CANNIBALIZATION_MAX_PAGES} pages`);
  }
  const grouped = new Map<string, { impressions: number; weightedPosition: number; weightedCtr: number; positionKnown: boolean }>();
  for (const page of pages) {
    if (!Number.isFinite(page.impressions) || page.impressions < 0 || !Number.isFinite(page.ctr) || page.ctr < 0) {
      throw new Error('Invalid cannibalization page metrics');
    }
    if (page.position !== null && (!Number.isFinite(page.position) || page.position <= 0)) {
      throw new Error('Invalid cannibalization page position');
    }
    const canonicalPage = normalizeCanonicalPage(page.canonicalPage);
    const current = grouped.get(canonicalPage) ?? {
      impressions: 0,
      weightedPosition: 0,
      weightedCtr: 0,
      positionKnown: true
    };
    current.impressions += page.impressions;
    current.weightedCtr += page.ctr * page.impressions;
    if (page.position === null) current.positionKnown = false;
    else current.weightedPosition += page.position * page.impressions;
    grouped.set(canonicalPage, current);
  }
  return [...grouped.entries()].map(([canonicalPage, value]) => ({
    canonicalPage,
    impressions: value.impressions,
    position:
      value.positionKnown && value.impressions > 0
        ? value.weightedPosition / value.impressions
        : null,
    ctr: value.impressions > 0 ? value.weightedCtr / value.impressions : 0
  }));
}

function candidateFor(
  pages: readonly CannibalizationPage[],
  context: CannibalizationContext
): { state: 'KNOWN'; canonicalPage: string } | { state: 'UNKNOWN'; canonicalPage: null } {
  const ordered = [...pages].sort((a, b) => {
    if (a.impressionShare !== b.impressionShare) return b.impressionShare - a.impressionShare;
    if (a.position !== null && b.position !== null && a.position !== b.position) return a.position - b.position;
    if (a.ctr !== b.ctr) return b.ctr - a.ctr;
    const aStrength = context.pageEvidenceStrength?.[a.canonicalPage];
    const bStrength = context.pageEvidenceStrength?.[b.canonicalPage];
    if (aStrength !== undefined && bStrength !== undefined && aStrength !== bStrength) return bStrength - aStrength;
    return 0;
  });
  if (ordered.length === 0) return { state: 'UNKNOWN', canonicalPage: null };
  if (ordered.length === 1) return { state: 'KNOWN', canonicalPage: ordered[0]!.canonicalPage };

  const first = ordered[0]!;
  const second = ordered[1]!;
  if (first.impressionShare !== second.impressionShare) return { state: 'KNOWN', canonicalPage: first.canonicalPage };
  if (first.position !== null && second.position !== null && first.position !== second.position) {
    return { state: 'KNOWN', canonicalPage: first.canonicalPage };
  }
  if (first.ctr !== second.ctr) return { state: 'KNOWN', canonicalPage: first.canonicalPage };
  const firstStrength = context.pageEvidenceStrength?.[first.canonicalPage];
  const secondStrength = context.pageEvidenceStrength?.[second.canonicalPage];
  if (firstStrength !== undefined && secondStrength !== undefined && firstStrength !== secondStrength) {
    return { state: 'KNOWN', canonicalPage: first.canonicalPage };
  }
  return { state: 'UNKNOWN', canonicalPage: null };
}

export function detectKeywordCannibalization(
  input: KeywordCannibalizationInput,
  context: CannibalizationContext = {}
): KeywordCannibalizationResult {
  if (!input.normalizedQuery.trim()) throw new Error('normalizedQuery is required');
  if (input.demandScore === null || !Number.isFinite(input.demandScore)) {
    return {
      state: 'UNKNOWN', type: 'KEYWORD_CANNIBALIZATION', competingPages: [],
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['DEMAND_UNKNOWN']
    };
  }
  if (input.demandScore < 40) {
    return {
      state: 'NOT_DETECTED', type: 'KEYWORD_CANNIBALIZATION', competingPages: [],
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['DEMAND_BELOW_THRESHOLD']
    };
  }

  const collapsed = collapsePages(input.pages);
  if (collapsed.length < 2) {
    return {
      state: 'NOT_DETECTED', type: 'KEYWORD_CANNIBALIZATION', competingPages: [],
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['LESS_THAN_TWO_CANONICAL_PAGES']
    };
  }
  const totalImpressions = collapsed.reduce((sum, page) => sum + page.impressions, 0);
  if (totalImpressions <= 0) {
    return {
      state: 'UNKNOWN', type: 'KEYWORD_CANNIBALIZATION', competingPages: [],
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['IMPRESSIONS_UNKNOWN']
    };
  }

  const withShare: CannibalizationPage[] = collapsed
    .map((page) => ({ ...page, impressionShare: page.impressions / totalImpressions }))
    .sort((a, b) => b.impressionShare - a.impressionShare || a.canonicalPage.localeCompare(b.canonicalPage));

  if (withShare.some((page) => page.impressionShare >= 0.80)) {
    return {
      state: 'NOT_DETECTED', type: 'KEYWORD_CANNIBALIZATION', competingPages: [],
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['DOMINANT_PAGE_PRESENT']
    };
  }

  const material = withShare.filter((page) => page.impressionShare >= 0.20);
  if (material.length < 2) {
    return {
      state: 'NOT_DETECTED', type: 'KEYWORD_CANNIBALIZATION', competingPages: material,
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['INSUFFICIENT_MATERIAL_PAGES']
    };
  }
  if (material.some((page) => page.position === null)) {
    return {
      state: 'UNKNOWN', type: 'KEYWORD_CANNIBALIZATION', competingPages: material,
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['POSITION_UNKNOWN']
    };
  }

  let rankingCompetition = false;
  for (let left = 0; left < material.length; left += 1) {
    for (let right = left + 1; right < material.length; right += 1) {
      const a = material[left]!;
      const b = material[right]!;
      const bothTop30 = a.position! <= 30 && b.position! <= 30;
      const closePositions = Math.abs(a.position! - b.position!) <= 10;
      if (bothTop30 || closePositions) rankingCompetition = true;
    }
  }
  if (!rankingCompetition) {
    return {
      state: 'NOT_DETECTED', type: 'KEYWORD_CANNIBALIZATION', competingPages: material,
      primaryPageCandidate: { state: 'UNKNOWN', canonicalPage: null }, reasonCodes: ['NO_RANKING_COMPETITION']
    };
  }

  return {
    state: 'DETECTED',
    type: 'KEYWORD_CANNIBALIZATION',
    competingPages: material,
    primaryPageCandidate: candidateFor(material, context),
    reasonCodes: ['DEMAND_ELIGIBLE', 'BALANCED_IMPRESSION_SHARE', 'RANKING_COMPETITION']
  };
}
