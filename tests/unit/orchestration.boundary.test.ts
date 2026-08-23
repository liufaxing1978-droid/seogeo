import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const orchestrationSourceDir = path.resolve('src/modules/optimization-orchestration');

async function walkFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  }))).flat().sort();
}

async function orchestrationSource(): Promise<string> {
  const files = (await walkFiles(orchestrationSourceDir)).filter((file) => file.endsWith('.ts'));
  return (await Promise.all(
    files.map(async (file) => `${file}\n${await readFile(file, 'utf8')}`)
  )).join('\n');
}

describe('P9-B orchestration authority boundaries', () => {
  it('does not import upstream scoring/raw-fact, AI ranking, or downstream P8 execution authorities', async () => {
    const source = await orchestrationSource();
    const forbiddenImports = [
      /from ['"][^'"]*\/growth\/[^'"]*['"]/iu,
      /from ['"][^'"]*\/(?:content|competitor|visibility|search-console|seo|geo)\/[^'"]*['"]/iu,
      /from ['"][^'"]*\/ai\/[^'"]*['"]/iu,
      /from ['"][^'"]*\/(?:publication|distribution)\/[^'"]*['"]/iu,
      /from ['"][^'"]*(?:git|github|deploy|rollback)[^'"]*['"]/iu,
      /from ['"]node:events['"]/u
    ];

    for (const pattern of forbiddenImports) {
      expect(source, `forbidden P9-B authority import: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('cannot mutate P7 facts, P9-A immutable rows, or P8 publication state', async () => {
    const source = await orchestrationSource();
    const forbiddenMutationPatterns = [
      /growthOpportunity(?:Identity|Snapshot|Evidence|Lifecycle|LifecycleEvent)\.(?:create|update|updateMany|delete|deleteMany|upsert)\s*\(/u,
      /optimization(?:Candidate|Plan)\.(?:update|updateMany|delete|deleteMany|upsert)\s*\(/u,
      /publication(?:Proposal|Plan|Preview|Approval|Execution|ExecutionEvent)\.(?:create|update|updateMany|delete|deleteMany|upsert)\s*\(/u,
      /distribution(?:Artifact|TargetEvent)\.(?:create|update|updateMany|delete|deleteMany|upsert)\s*\(/u
    ];

    for (const pattern of forbiddenMutationPatterns) {
      expect(source, `forbidden P9-B authority mutation: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('does not acquire Git/deploy/rollback or asynchronous AI continuation authority', async () => {
    const source = await orchestrationSource();
    const forbiddenPatterns = [
      /\b(?:createDraftPr|createPullRequest|mergePullRequest|merge|deploy|rollback)\s*\(/iu,
      /\buseAi\s*:\s*true\b/u,
      /\bOPTIMIZATION_PLAN_RANKING\b/u,
      /\bEventEmitter\b/u,
      /event[-_. ]bus/iu
    ];

    for (const pattern of forbiddenPatterns) {
      expect(source, `forbidden P9-B execution authority: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('keeps the only completed item checkpoint at READY_FOR_POLICY rather than asserting P9-C/P8 state', async () => {
    const source = await orchestrationSource();

    expect(source).toContain("currentStage: 'READY_FOR_POLICY'");
    expect(source).not.toMatch(/currentStage:\s*['"](?:APPROVED|AUTOPILOT|PUBLICATION|EXECUTED|VERIFIED|DEPLOYED)['"]/iu);
    expect(source).not.toMatch(/\b(?:approvalRequired|riskLevel|publicationPlanId|publicationExecutionId|deploymentStatus)\s*:/iu);
  });
});
