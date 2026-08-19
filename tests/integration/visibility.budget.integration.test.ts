import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilityBudgetService } from '../../src/modules/visibility/visibility-budget.js';

describe('P6-A visibility historical budget accounting', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  async function fixture(label: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: `Budget ${label}`,
        slug: `budget-${suffix}`,
        primaryDomain: `budget-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);
    await prisma.visibilityProjectSettings.create({
      data: {
        projectId: project.id,
        dailyBudgetMicros: 100_000,
        defaultRunBudgetMicros: 50_000,
        maxObservationsPerRun: 20,
        defaultCurrency: 'USD'
      }
    });
    const set = await prisma.visibilityPromptSet.create({ data: { projectId: project.id, name: 'Budget set' } });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: set.id,
        promptKey: 'budget',
        version: 1,
        promptText: 'Budget fixture prompt',
        promptHash: `hash-${suffix}`
      }
    });
    const run = await prisma.visibilityRun.create({
      data: {
        projectId: project.id,
        promptSetId: set.id,
        runType: 'MANUAL',
        requestedProviderConfigs: [],
        maxObservations: 20,
        budgetCeilingMicros: 50_000,
        currency: 'USD',
        policySnapshotJson: { dailyBudgetMicros: 100_000 }
      }
    });
    return { project, set, prompt, run };
  }

  it('sums recorded historical costMicros without repricing observations', async () => {
    const { project, prompt, run } = await fixture('history');
    const today = new Date('2026-08-19T12:00:00.000Z');
    const yesterday = new Date('2026-08-18T12:00:00.000Z');

    for (const [index, input] of [
      { costMicros: 12_000, pricingVersion: 'provider-price-v1', observedAt: today },
      { costMicros: 8_000, pricingVersion: 'provider-price-v2', observedAt: today },
      { costMicros: 99_000, pricingVersion: 'provider-price-old', observedAt: yesterday }
    ].entries()) {
      await prisma.platformObservation.create({
        data: {
          projectId: project.id,
          visibilityRunId: run.id,
          visibilityPromptId: prompt.id,
          promptVersion: 1,
          samplingUnitKey: `budget-history-${project.id}-${index}`,
          provider: 'OPENAI',
          model: 'gpt-5-mini',
          channel: 'API',
          groundingMode: 'WEB_SEARCH',
          status: 'COMPLETED',
          citationsJson: [],
          searchMetadataJson: {},
          costMicros: input.costMicros,
          costCurrency: 'USD',
          pricingVersion: input.pricingVersion,
          observedAt: input.observedAt
        }
      });
    }

    const service = new VisibilityBudgetService();
    expect(await service.getDailyRecordedSpendMicros(project.id, today)).toBe(20_000);
    expect((await prisma.platformObservation.findMany({ where: { projectId: project.id }, orderBy: { observedAt: 'asc' } })).map((row) => row.pricingVersion)).toContain('provider-price-v1');
  });

  it('evaluates run and daily ceilings from persisted spend and marks a blocked running observation as BUDGET_SKIPPED', async () => {
    const { project, prompt, run } = await fixture('preflight');
    const now = new Date('2026-08-19T15:00:00.000Z');

    await prisma.platformObservation.create({
      data: {
        projectId: project.id,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey: `budget-spend-${project.id}`,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        status: 'COMPLETED',
        citationsJson: [],
        searchMetadataJson: {},
        costMicros: 45_000,
        costCurrency: 'USD',
        pricingVersion: 'fixture-1',
        observedAt: now
      }
    });
    const pending = await prisma.platformObservation.create({
      data: {
        projectId: project.id,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey: `budget-next-${project.id}`,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        status: 'RUNNING',
        citationsJson: [],
        searchMetadataJson: {},
        observedAt: now
      }
    });

    const service = new VisibilityBudgetService();
    const decision = await service.preflightObservation(pending.id, 6_000, now);
    expect(decision).toMatchObject({ allowed: false, reason: 'RUN_BUDGET_EXCEEDED', runRecordedSpendMicros: 45_000 });

    await service.markBudgetSkipped(pending.id, decision.reason);
    const stored = await prisma.platformObservation.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.status).toBe('BUDGET_SKIPPED');
    expect(stored.errorCode).toBe('RUN_BUDGET_EXCEEDED');
    expect(stored.costMicros).toBeNull();
  });

  it('fails closed when cost estimate is unavailable under a finite budget', async () => {
    const { prompt, run } = await fixture('unknown-estimate');
    const observation = await prisma.platformObservation.create({
      data: {
        projectId: run.projectId,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey: `budget-unknown-${run.id}`,
        provider: 'GEMINI',
        model: 'gemini-2.5-flash',
        channel: 'API',
        groundingMode: 'SEARCH_GROUNDING',
        status: 'RUNNING',
        citationsJson: [],
        searchMetadataJson: {}
      }
    });

    const decision = await new VisibilityBudgetService().preflightObservation(observation.id, null, new Date('2026-08-19T16:00:00.000Z'));
    expect(decision).toMatchObject({ allowed: false, reason: 'BUDGET_ESTIMATE_UNAVAILABLE' });
  });
});
