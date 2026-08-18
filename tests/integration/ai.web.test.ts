import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function createAiWebFixture() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'AI Analysis Center Fixture',
      slug: `ai-web-${suffix}`,
      primaryDomain: 'example.com',
      planLevel: 'STANDARD'
    }
  });
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId: project.id,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com/',
      crawlerVersion: 'fixture',
      finishedAt: new Date()
    }
  });
  const seoAudit = await prisma.seoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      eligiblePages: 3,
      rulesEvaluated: 20,
      engineVersion: 'seo-fixture',
      finishedAt: new Date()
    }
  });
  const geoAudit = await prisma.geoAuditRun.create({
    data: {
      projectId: project.id,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      eligiblePages: 3,
      rulesEvaluated: 10,
      engineVersion: 'geo-fixture',
      finishedAt: new Date()
    }
  });
  const task = await prisma.aiTask.create({
    data: {
      projectId: project.id,
      taskType: 'SEO_AUDIT_ANALYSIS',
      status: 'COMPLETED',
      requestKey: `fixture:${suffix}`,
      promptVersion: 'seo-audit-analysis-v1',
      factSnapshot: { secret: 'api-key-fixture-secret', auditId: seoAudit.id },
      sourceReferences: [{ type: 'SEO_AUDIT', id: seoAudit.id }]
    }
  });
  const run = await prisma.aiTaskRun.create({
    data: {
      aiTaskId: task.id,
      attemptNo: 1,
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      mode: 'FAST',
      responseFormat: 'JSON',
      status: 'COMPLETED',
      promptVersion: 'seo-audit-analysis-v1',
      requestHash: 'fixture-hash',
      finishedAt: new Date()
    }
  });
  await prisma.aiProviderCall.create({
    data: {
      aiTaskRunId: run.id,
      attemptNo: 1,
      providerResponseId: 'provider-response-fixture',
      latencyMs: 120,
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      cacheHitTokens: 20,
      cacheMissTokens: 80,
      finishReason: 'stop'
    }
  });
  await prisma.aiAnalysisResult.create({
    data: {
      aiTaskRunId: run.id,
      resultType: 'SEO_AUDIT_ANALYSIS',
      summary: '优先修复可验证的 SEO 问题。',
      structuredOutput: {
        summary: '优先修复可验证的 SEO 问题。',
        priorities: [],
        recommendations: []
      },
      sourceReferences: [{ type: 'SEO_AUDIT', id: seoAudit.id }],
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      promptVersion: 'seo-audit-analysis-v1'
    }
  });

  return { project, seoAudit, geoAudit, task };
}

describe('P4 AI Analysis Center web UI', () => {
  it('renders Standard-plan AI actions from completed audits and keeps AI Visibility separate', async () => {
    const { project, seoAudit, geoAudit } = await createAiWebFixture();
    const response = await request(createApp()).get(`/projects/${project.id}/ai`).expect(200);

    expect(response.text).toContain('DeepSeek AI 分析中心');
    expect(response.text).toContain('SEO 分析');
    expect(response.text).toContain('GEO 分析');
    expect(response.text).toContain('Entity Enrichment');
    expect(response.text).toContain(seoAudit.id);
    expect(response.text).toContain(geoAudit.id);
    expect(response.text).toContain('AI Visibility');
    expect(response.text).toContain('P6');
    expect(response.text).not.toContain('api-key-fixture-secret');
  });

  it('renders persisted result detail without factSnapshot/provider reasoning/API secrets', async () => {
    const { project, task } = await createAiWebFixture();
    const response = await request(createApp())
      .get(`/projects/${project.id}/ai/tasks/${task.id}`)
      .expect(200);

    expect(response.text).toContain('优先修复可验证的 SEO 问题。');
    expect(response.text).toContain('deepseek-v4-flash');
    expect(response.text).toContain('seo-audit-analysis-v1');
    expect(response.text).not.toContain('api-key-fixture-secret');
    expect(response.text).not.toMatch(/reasoning_content/i);
  });
});
