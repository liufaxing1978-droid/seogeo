import { syncAuditIssues } from './issue-service.js';
import { BUILTIN_CRAWL_RULES, BUILTIN_PAGE_RULES } from './rule-catalog.js';
import { getCrawlRuleEvaluator, getPageRuleEvaluator } from './rule-registry.js';
import { syncBuiltinRules } from './rule-sync.js';
import { calculateAndPersistSeoScore } from './score-engine.js';
import {
  seoRepository,
  type PersistedRuleResult,
  type SeoRepository
} from './seo.repository.js';

const DEFAULT_ENGINE_VERSION = '0.1.0';

export interface RunSeoAuditOptions {
  repository?: SeoRepository;
  engineVersion?: string;
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 1000)
    : 'Unknown SEO audit failure';
}

function logSeoEvent(event: string, data: Record<string, unknown>) {
  console.log({ event, ...data });
}

function summarizeOutcomes(rows: PersistedRuleResult[]) {
  let passed = 0;
  let failed = 0;
  let unknown = 0;

  for (const row of rows) {
    if (row.outcome === 'PASS') passed += 1;
    else if (row.outcome === 'FAIL') failed += 1;
    else unknown += 1;
  }

  return { passed, failed, unknown };
}

export async function executeSeoAudit(
  auditRunId: string,
  options: RunSeoAuditOptions = {}
): Promise<void> {
  const repository = options.repository ?? seoRepository;
  const engineVersion = options.engineVersion ?? DEFAULT_ENGINE_VERSION;
  const context = await repository.getAuditContext(auditRunId);

  if (context.status === 'COMPLETED') return;

  try {
    if (context.crawlStatus !== 'COMPLETED') {
      throw new Error('SEO audit requires a completed crawl run');
    }

    await repository.markAuditRunning(auditRunId, engineVersion);
    logSeoEvent('seo.audit.started', { auditRunId, engineVersion });

    const [input, ruleIdentities] = await Promise.all([
      repository.getAuditInput(auditRunId),
      syncBuiltinRules()
    ]);

    const rows: PersistedRuleResult[] = [];

    for (const page of input.pages) {
      for (const definition of BUILTIN_PAGE_RULES) {
        const identity = ruleIdentities.get(definition.ruleCode);
        if (!identity) throw new Error(`Missing synchronized SEO rule: ${definition.ruleCode}`);

        const result = getPageRuleEvaluator(definition.ruleCode)(page);
        rows.push({
          pageId: page.pageId,
          ruleVersionId: identity.ruleVersionId,
          resultKey: `page:${page.pageId}`,
          outcome: result.outcome,
          evidence: result.evidence
        });
      }
    }

    const crawlFact = {
      robots: input.robots,
      sitemaps: input.sitemaps
    };
    for (const definition of BUILTIN_CRAWL_RULES) {
      const identity = ruleIdentities.get(definition.ruleCode);
      if (!identity) throw new Error(`Missing synchronized SEO rule: ${definition.ruleCode}`);

      const result = getCrawlRuleEvaluator(definition.ruleCode)(crawlFact);
      rows.push({
        pageId: null,
        ruleVersionId: identity.ruleVersionId,
        resultKey: `crawl:${definition.ruleCode}`,
        outcome: result.outcome,
        evidence: result.evidence
      });
    }

    const outcomeSummary = summarizeOutcomes(rows);
    logSeoEvent('seo.rule.evaluated.summary', {
      auditRunId,
      eligiblePages: input.pages.length,
      rulesEvaluated: rows.length,
      ...outcomeSummary
    });

    await repository.replaceRuleResults(auditRunId, rows);
    await syncAuditIssues(auditRunId);
    logSeoEvent('seo.issues.synced', {
      auditRunId,
      failedResults: outcomeSummary.failed,
      failingRuleVersions: new Set(
        rows.filter((row) => row.outcome === 'FAIL').map((row) => row.ruleVersionId)
      ).size
    });

    await calculateAndPersistSeoScore(auditRunId);
    logSeoEvent('seo.score.calculated', { auditRunId });

    await repository.markAuditCompleted(auditRunId, {
      eligiblePages: input.pages.length,
      rulesEvaluated: rows.length,
      engineVersion
    });
    logSeoEvent('seo.audit.completed', {
      auditRunId,
      engineVersion,
      eligiblePages: input.pages.length,
      rulesEvaluated: rows.length,
      ...outcomeSummary
    });
  } catch (error) {
    const message = safeError(error);
    await repository.markAuditFailed(auditRunId, message);
    logSeoEvent('seo.audit.failed', { auditRunId, engineVersion, error: message });
    throw error;
  }
}