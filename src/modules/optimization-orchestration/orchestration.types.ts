export const OPTIMIZATION_RUN_VERSION = 'OPTIMIZATION_RUN_V1' as const;
export const OPTIMIZATION_RUN_ITEM_VERSION = 'OPTIMIZATION_RUN_ITEM_V1' as const;

export type GrowthTriggerInput = {
  projectId: string;
  asOfDate: string;
  materializationVersion: string;
  formulaVersion: string;
  state: 'COMPLETED' | 'INELIGIBLE';
  selectedGscSnapshotIds: readonly string[];
};
