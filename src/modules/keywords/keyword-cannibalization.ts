export type P4CannibalizationRisk = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type P4CannibalizationAction = 'REVIEW' | 'REPOSITION' | null;

export function evaluateKeywordCannibalization(input: {
  growthDetected: boolean;
  mappingConflict: boolean;
  coverageUrls: readonly string[];
}): { risk: P4CannibalizationRisk; recommendedAction: P4CannibalizationAction; reasonCodes: string[]; confidence: number } {
  if (input.growthDetected) {
    return { risk: 'HIGH', recommendedAction: 'REVIEW', reasonCodes: ['GROWTH_CANNIBALIZATION_DETECTED'], confidence: 1 };
  }
  if (input.mappingConflict) {
    return { risk: 'MEDIUM', recommendedAction: 'REPOSITION', reasonCodes: ['TARGET_MAPPING_CONFLICT'], confidence: 0.7 };
  }
  if (new Set(input.coverageUrls).size > 1) {
    return { risk: 'LOW', recommendedAction: 'REVIEW', reasonCodes: ['MULTIPLE_COVERAGE_URLS'], confidence: 0.5 };
  }
  return { risk: 'NONE', recommendedAction: null, reasonCodes: ['NO_CONFLICTING_EVIDENCE'], confidence: 0 };
}
