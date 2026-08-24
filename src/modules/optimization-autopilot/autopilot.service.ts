import { OptimizationAutopilotRepository } from './autopilot.repository.js';
import type { AutopilotRunItemContext } from './autopilot.types.js';

export class OptimizationAutopilotService {
  constructor(
    private readonly repository: OptimizationAutopilotRepository = new OptimizationAutopilotRepository()
  ) {}

  loadRunItemContext(
    runItemId: string,
    projectId: string
  ): Promise<AutopilotRunItemContext | null> {
    return this.repository.loadRunItemContext(runItemId, projectId);
  }

  listReadyItemsWithoutEffectiveDecision(
    limit: number
  ): Promise<Array<{ id: string; projectId: string }>> {
    return this.repository.listReadyItemsWithoutEffectiveDecision(limit);
  }
}
