import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const feedbackRoot = path.resolve(here, '../../src/modules/optimization-feedback');

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolute));
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function relative(file: string): string {
  return path.relative(feedbackRoot, file).replaceAll('\\', '/');
}

const FORBIDDEN_IMPORTS = [
  /from\s+['"][^'"]*\/ai\//i,
  /from\s+['"][^'"]*\/visibility\//i,
  /from\s+['"][^'"]*\/search-console\//i,
  /from\s+['"][^'"]*\/search-facts\//i,
  /from\s+['"][^'"]*\/search-providers\//i,
  /from\s+['"][^'"]*\/publication\//i,
  /from\s+['"][^'"]*(?:github|git-adapter|deployment|rollback)[^'"]*['"]/i,
] as const;

const FORBIDDEN_RUNTIME_TOKENS = [
  /\bDeepSeekProvider\b/,
  /\bAiGateway\b/,
  /\bGitHub(?:Client|Service|Adapter)?\b/,
  /\bdeploy(?:ment)?\s*\(/i,
  /\brollback\s*\(/i,
] as const;

const FORBIDDEN_NON_FEEDBACK_MUTATIONS = [
  /\.optimizationPlan\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.optimizationCandidate\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.optimizationExperiment\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.optimizationExperimentObservation\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.publicationExecution\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.publicationVerification\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.publicationPlan\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.publicationApproval\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.growth[A-Za-z0-9_]*\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.gsc[A-Za-z0-9_]*\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\.visibility[A-Za-z0-9_]*\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/,
] as const;

describe('P9-E feedback authority boundary', () => {
  it('keeps the entire optimization-feedback module free of provider, Git, publication, Search, and Visibility authority', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(feedbackRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_IMPORTS) {
        if (pattern.test(source)) violations.push(`${relative(file)} forbidden import ${pattern}`);
      }
      for (const pattern of FORBIDDEN_RUNTIME_TOKENS) {
        if (pattern.test(source)) violations.push(`${relative(file)} forbidden runtime token ${pattern}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('allows feedback creates and persisted reads but no mutation of P7/P8/P9-A/P9-D/Search/Visibility facts', () => {
    const violations: string[] = [];
    let feedbackEvidenceCreate = false;
    let feedbackProfileCreate = false;

    for (const file of sourceFiles(feedbackRoot)) {
      const source = readFileSync(file, 'utf8');
      feedbackEvidenceCreate ||= /\.optimizationFeedbackEvidence\.create\s*\(/.test(source);
      feedbackProfileCreate ||= /\.optimizationFeedbackProfile\.create\s*\(/.test(source);
      for (const pattern of FORBIDDEN_NON_FEEDBACK_MUTATIONS) {
        if (pattern.test(source)) violations.push(`${relative(file)} forbidden mutation ${pattern}`);
      }
    }

    expect(feedbackEvidenceCreate).toBe(true);
    expect(feedbackProfileCreate).toBe(true);
    expect(violations).toEqual([]);
  });

  it('exposes only GET routes from the P9-E public feedback router', () => {
    const source = readFileSync(path.join(feedbackRoot, 'feedback.routes.ts'), 'utf8');

    expect(source).toContain("router.get(");
    expect(source).not.toMatch(/router\.(?:post|put|patch|delete)\s*\(/i);
    expect(source).not.toMatch(/\.enqueue(?:Observation)?\s*\(/);
    expect(source.toLowerCase()).not.toContain('deepseek');
    expect(source.toLowerCase()).not.toContain('github');
  });

  it('keeps feedback reconciliation bounded and recovery-only', () => {
    const worker = readFileSync(path.join(feedbackRoot, 'feedback.worker.ts'), 'utf8');
    const queue = readFileSync(path.join(feedbackRoot, 'feedback.queue.ts'), 'utf8');
    const repository = readFileSync(path.join(feedbackRoot, 'feedback.repository.ts'), 'utf8');

    expect(worker).toContain('OPTIMIZATION_FEEDBACK_RECONCILE_DAYS = 90');
    expect(worker).toContain('OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT = 100');
    expect(queue).toContain('OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS = 2');
    expect(repository).toContain('listRecentTerminalCandidates');
    expect(repository).toContain('feedbackEvidence: { none: {} }');
    expect(repository).toContain("optimizationExperimentObservation.findMany");
    expect(repository).not.toMatch(/optimizationExperimentObservation\.(?:create|update|delete|upsert)\s*\(/);
  });
});
