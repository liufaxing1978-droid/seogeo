import {
  Prisma,
  type AutomationDefinition,
  type AutomationOverlapPolicy,
  type PrismaClient
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type AutomationDefinitionDbClient = Pick<PrismaClient, 'automationDefinition'>;

export type CreateAutomationDefinitionInput = {
  projectId: string;
  key: string;
  actionType: string;
  actionConfig: unknown;
  enabled: boolean;
  scheduleCron: string | null;
  overlapPolicy: AutomationOverlapPolicy;
  maxAttempts: number;
  timeoutMs: number;
};

export type UpdateAutomationDefinitionInput = {
  definitionId: string;
  projectId: string;
  patch: {
    key?: string;
    actionType?: string;
    actionConfig?: unknown;
    enabled?: boolean;
    scheduleCron?: string | null;
    maxAttempts?: number;
    timeoutMs?: number;
  };
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return canonicalize(value) as Prisma.InputJsonValue;
}

export class AutomationDefinitionManagementRepository {
  constructor(private readonly db: AutomationDefinitionDbClient = prisma) {}

  listAutomationDefinitions(projectId: string): Promise<AutomationDefinition[]> {
    return this.db.automationDefinition.findMany({
      where: { projectId },
      orderBy: [{ key: 'asc' }, { id: 'asc' }]
    });
  }

  createAutomationDefinition(
    input: CreateAutomationDefinitionInput
  ): Promise<AutomationDefinition> {
    return this.db.automationDefinition.create({
      data: {
        projectId: input.projectId,
        key: input.key,
        actionType: input.actionType,
        actionConfig: asJson(input.actionConfig),
        enabled: input.enabled,
        scheduleCron: input.scheduleCron,
        overlapPolicy: input.overlapPolicy,
        maxAttempts: input.maxAttempts,
        timeoutMs: input.timeoutMs
      }
    });
  }

  async updateAutomationDefinition(
    input: UpdateAutomationDefinitionInput
  ): Promise<AutomationDefinition | null> {
    const patch = input.patch;
    const updated = await this.db.automationDefinition.updateMany({
      where: {
        id: input.definitionId,
        projectId: input.projectId
      },
      data: {
        ...(patch.key !== undefined ? { key: patch.key } : {}),
        ...(patch.actionType !== undefined ? { actionType: patch.actionType } : {}),
        ...(patch.actionConfig !== undefined
          ? { actionConfig: asJson(patch.actionConfig) }
          : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.scheduleCron !== undefined ? { scheduleCron: patch.scheduleCron } : {}),
        ...(patch.maxAttempts !== undefined ? { maxAttempts: patch.maxAttempts } : {}),
        ...(patch.timeoutMs !== undefined ? { timeoutMs: patch.timeoutMs } : {})
      }
    });
    if (updated.count !== 1) return null;

    return this.db.automationDefinition.findUnique({
      where: { id: input.definitionId }
    });
  }
}

export const automationDefinitionManagementRepository =
  new AutomationDefinitionManagementRepository();
