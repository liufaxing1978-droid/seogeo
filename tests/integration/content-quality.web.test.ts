import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { contentQualityService } from '../../src/modules/content/content-quality.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

type AuthFixture = Awaited<ReturnType<typeof seedAuthenticatedUser>>;

function csrfFor(fixture: AuthFixture): string {
  return deriveCsrfToken(env.SESSION_SECRET, fixture.csrfInput.sessionId, fixture.csrfInput.tokenHash);
}

async function createQualityFixture(projectId: string) {
  const suffix = randomUUID();
  const now = new Date();
  const crawl = await prisma.crawlRun.create({
    data: { projectId, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${suffix}.example.com/`, crawlerVersion: 'test' },
  });
  const page = await prisma.page.create({
    data: { projectId, url: `https://${suffix}.example.com/guide`, normalizedUrl: `https://${suffix}.example.com/guide`, host: `${suffix}.example.com`, path: '/guide' },
  });
  const beforeSnapshot = await prisma.pageSnapshot.create({
    data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, statusCode: 200, wordCount: 900, contentHash: `before-${suffix}`, parserVersion: 'test' },
  });
  const afterSnapshot = await prisma.pageSnapshot.create({
    data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, statusCode: 200, wordCount: 300, contentHash: `after-${suffix}`, parserVersion: 'test' },
  });
  const document = await prisma.contentDocument.create({
    data: { projectId, pageId: page.id, latestPageSnapshotId: afterSnapshot.id, canonicalUrl: page.url, wordCount: 300, schemaTypes: [], contentHash: `after-${suffix}`, extractedAt: now },
  });
  const run = await prisma.contentQualityRun.create({
    data: { projectId, rulesetVersion: 3, status: 'COMPLETED', inputSnapshotCutoffAt: now, inputDocumentCount: 1, findingCount: 1, completedAt: now },
  });
  const finding = await prisma.contentQualityFinding.create({
    data: {
      projectId,
      contentDocumentId: document.id,
      latestRunId: run.id,
      findingKey: 'CONTENT_DECAY',
      ruleVersion: 3,
      category: 'CONTENT_DECAY',
      priority: 'HIGH',
      summary: '页面内容明显减少，需要人工审核。',
      evidence: {
        status: 'UNKNOWN',
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: beforeSnapshot.id }, { type: 'PAGE_SNAPSHOT', id: afterSnapshot.id }],
        previousSnapshotId: beforeSnapshot.id,
        currentSnapshotId: afterSnapshot.id,
        previousWordCount: 900,
        currentWordCount: 300,
      },
      firstDetectedAt: now,
      lastDetectedAt: now,
    },
  });
  await prisma.contentQualityFindingHistory.create({
    data: { findingId: finding.id, fromStatus: 'OPEN', toStatus: 'IN_REVIEW', actorId: randomUUID(), reason: '人工复核', metadata: { source: 'test' } },
  });
  return { run, finding, document, beforeSnapshot, afterSnapshot };
}

describe('P13-A content quality review center web', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('renders project-scoped evidence and labels unknown comparison data as 证据不足', async () => {
    const operator = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'STANDARD', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    cleanups.push(operator.cleanup);
    const fixture = await createQualityFixture(operator.project.id);

    const center = await request(createApp())
      .get(`/projects/${operator.project.id}/content/quality`)
      .set('Cookie', operator.sessionCookie)
      .expect(200);
    expect(center.text).toContain('内容质量建议');
    expect(center.text).toContain('证据不足');
    expect(center.text).toContain(fixture.run.id);
    expect(center.text).toContain(fixture.finding.summary);
    expect(center.text).toContain('name="category"');
    expect(center.text).toContain('name="status"');
    expect(center.text).toContain('name="priority"');
    expect(center.text).toContain(`/projects/${operator.project.id}/content/documents/${fixture.document.id}`);
    expect(center.text).toContain(new Date(fixture.afterSnapshot.capturedAt).toLocaleString('zh-CN'));
    expect(center.text).not.toContain('发布执行');

    const detail = await request(createApp())
      .get(`/projects/${operator.project.id}/content/quality/${fixture.finding.id}`)
      .set('Cookie', operator.sessionCookie)
      .expect(200);
    expect(detail.text).toContain('规则版本：3');
    expect(detail.text).toContain(fixture.beforeSnapshot.id);
    expect(detail.text).toContain('900');
    expect(detail.text).toContain('300');
    expect(detail.text).toContain('IN_REVIEW');
    expect(detail.text).toContain('人工复核');

    const otherFinding = await prisma.contentQualityFinding.create({
      data: {
        projectId: operator.project.id,
        contentDocumentId: fixture.document.id,
        findingKey: 'FILTERED_QA_FIXTURE',
        ruleVersion: 1,
        category: 'CONTENT_QA',
        priority: 'LOW',
        summary: 'This finding must be filtered out.',
        evidence: { status: 'FAIL', sourceReferences: [] },
        firstDetectedAt: new Date(),
        lastDetectedAt: new Date(),
      },
    });
    const filtered = await request(createApp())
      .get(`/projects/${operator.project.id}/content/quality?category=CONTENT_DECAY&status=OPEN&priority=HIGH`)
      .set('Cookie', operator.sessionCookie)
      .expect(200);
    expect(filtered.text).toContain(fixture.finding.summary);
    expect(filtered.text).not.toContain(otherFinding.summary);

    await request(createApp())
      .get(`/projects/${operator.project.id}/content/quality?category=NOT_A_CATEGORY`)
      .set('Cookie', operator.sessionCookie)
      .expect(400);
  });

  it('renders allowlisted internal-link and P5 QA evidence instead of hiding persisted rule inputs', async () => {
    const operator = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'STANDARD', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    cleanups.push(operator.cleanup);
    const fixture = await createQualityFixture(operator.project.id);
    const internalLinkFinding = await prisma.contentQualityFinding.create({
      data: {
        projectId: operator.project.id,
        contentDocumentId: fixture.document.id,
        findingKey: 'CONTENT_INTERNAL_LINK_SUPPORT',
        ruleVersion: 1,
        category: 'INTERNAL_LINK_SUPPORT',
        priority: 'MEDIUM',
        summary: '内部链接不足。',
        evidence: {
          status: 'FAIL',
          sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: fixture.afterSnapshot.id }],
          observedInternalLinkCount: 1,
          requiredInternalLinkCount: 3,
        },
        firstDetectedAt: new Date(),
        lastDetectedAt: new Date(),
      },
    });
    const qaFinding = await prisma.contentQualityFinding.create({
      data: {
        projectId: operator.project.id,
        contentDocumentId: fixture.document.id,
        findingKey: 'CONTENT_QA_P5A_FAILED_OPPORTUNITY',
        ruleVersion: 1,
        category: 'CONTENT_QA',
        priority: 'HIGH',
        summary: 'P5 QA 证据需人工审核。',
        evidence: {
          status: 'FAIL',
          sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: fixture.afterSnapshot.id }],
          p5OpportunityId: randomUUID(),
          p5OpportunityKey: 'CONTENT_BODY_SUBSTANTIVE:v2',
          p5OpportunityVersion: 2,
          p5OpportunityStatus: 'OPEN',
          p5SignalId: randomUUID(),
          p5SignalRuleKey: 'CONTENT_BODY_SUBSTANTIVE',
          p5SignalRuleVersion: 2,
          p5SignalStatus: 'FAIL',
        },
        firstDetectedAt: new Date(),
        lastDetectedAt: new Date(),
      },
    });

    const app = createApp();
    const internalLinkDetail = await request(app)
      .get(`/projects/${operator.project.id}/content/quality/${internalLinkFinding.id}`)
      .set('Cookie', operator.sessionCookie)
      .expect(200);
    expect(internalLinkDetail.text).toContain('已观测内部链接数');
    expect(internalLinkDetail.text).toContain('要求最少内部链接数');
    expect(internalLinkDetail.text).toContain('1');
    expect(internalLinkDetail.text).toContain('3');

    const qaDetail = await request(app)
      .get(`/projects/${operator.project.id}/content/quality/${qaFinding.id}`)
      .set('Cookie', operator.sessionCookie)
      .expect(200);
    expect(qaDetail.text).toContain('P5 Opportunity ID');
    expect(qaDetail.text).toContain('P5 Signal ID');
    expect(qaDetail.text).toContain('CONTENT_BODY_SUBSTANTIVE:v2');
    expect(qaDetail.text).toContain('CONTENT_BODY_SUBSTANTIVE');
    expect(qaDetail.text).toContain('OPEN');
    expect(qaDetail.text).toContain('FAIL');
  });

  it('requires membership to read and CONTENT_WRITE plus CSRF to request analysis', async () => {
    const operator = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'STANDARD', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    const viewer = await seedAuthenticatedUser({ role: 'VIEWER', planLevel: 'STANDARD', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    cleanups.push(operator.cleanup, viewer.cleanup);
    await prisma.projectMembership.create({ data: { projectId: operator.project.id, userId: viewer.user.id, role: 'VIEWER', status: 'ACTIVE' } });

    await request(createApp())
      .get(`/projects/${operator.project.id}/content/quality`)
      .set('Cookie', viewer.sessionCookie)
      .expect(200);

    await request(createApp())
      .post(`/projects/${operator.project.id}/content/quality/runs`)
      .set('Cookie', viewer.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(viewer) })
      .expect(403);

    const enqueueRun = vi.spyOn(contentQualityService, 'enqueueRun').mockResolvedValue({ jobId: 'content-quality-test', runId: randomUUID(), deduplicated: false });
    const response = await request(createApp())
      .post(`/projects/${operator.project.id}/content/quality/runs`)
      .set('Cookie', operator.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(operator) })
      .expect(303);
    expect(response.headers.location).toBe(`/projects/${operator.project.id}/content/quality`);
    expect(enqueueRun).toHaveBeenCalledWith(operator.project.id, operator.user.id);
  });

  it('redirects review, dismiss and accept actions safely and scopes finding lookup to the project', async () => {
    const operator = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'STANDARD', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    const foreign = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'STANDARD', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    cleanups.push(operator.cleanup, foreign.cleanup);
    const fixture = await createQualityFixture(operator.project.id);
    const foreignFixture = await createQualityFixture(foreign.project.id);
    const dismissedFixture = await createQualityFixture(operator.project.id);
    const app = createApp();

    await request(app)
      .post(`/projects/${operator.project.id}/content/quality/${fixture.finding.id}/transition`)
      .set('Cookie', operator.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(operator), status: 'IN_REVIEW', reason: '需要人工确认' })
      .expect(303)
      .expect('Location', `/projects/${operator.project.id}/content/quality/${fixture.finding.id}`);

    await request(app)
      .post(`/projects/${operator.project.id}/content/quality/${dismissedFixture.finding.id}/transition`)
      .set('Cookie', operator.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(operator), status: 'DISMISSED', reason: '证据不支持此建议' })
      .expect(303)
      .expect('Location', `/projects/${operator.project.id}/content/quality/${dismissedFixture.finding.id}`);

    await request(app)
      .post(`/projects/${operator.project.id}/content/quality/${foreignFixture.finding.id}/accept`)
      .set('Cookie', operator.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(operator) })
      .expect(404);

    const accepted = await request(app)
      .post(`/projects/${operator.project.id}/content/quality/${fixture.finding.id}/accept`)
      .set('Cookie', operator.sessionCookie)
      .type('form')
      .send({ _csrf: csrfFor(operator) })
      .expect(303);
    expect(accepted.headers.location).toMatch(new RegExp(`^/projects/${operator.project.id}/publication/opportunities\\?proposalId=`));
    const detail = await request(app)
      .get(`/projects/${operator.project.id}/content/quality/${fixture.finding.id}`)
      .set('Cookie', operator.sessionCookie)
      .expect(200);
    expect(detail.text).toContain('查看发布提案详情');
    expect(detail.text).toContain('/publication/opportunities?proposalId=');
    const acceptedFinding = await prisma.contentQualityFinding.findUniqueOrThrow({
      where: { id: fixture.finding.id },
      select: { acceptedPublicationProposalId: true },
    });
    const proposal = await request(app)
      .get(`/projects/${operator.project.id}/publication/opportunities?proposalId=${acceptedFinding.acceptedPublicationProposalId}`)
      .set('Cookie', operator.sessionCookie)
      .expect(200);
    expect(proposal.text).toContain('P13-A content-quality finding');
    expect(proposal.text).toContain(`proposal-${acceptedFinding.acceptedPublicationProposalId}`);

    await request(app)
      .get(`/projects/${operator.project.id}/publication/opportunities?proposalId=${acceptedFinding.acceptedPublicationProposalId}`)
      .expect(401);
  });
});
