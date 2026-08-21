import { Prisma, PublicationExecutionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

describe('P8-A publication persistence contract reserves later safety bindings', () => {
  it('stores every approval-staleness binding on the immutable approval row', () => {
    const approval = Prisma.dmmf.datamodel.models.find((model) => model.name === 'PublicationApproval');
    expect(approval).toBeDefined();

    const fields = new Set(approval!.fields.map((field) => field.name));
    expect(fields).toEqual(expect.objectContaining({}));
    for (const required of [
      'planVersion',
      'planHash',
      'contentVersion',
      'contentHash',
      'previewHash',
      'baseSha',
      'targetRepository',
      'targetBranch',
      'targetBlobHashes',
      'approvedRiskClass',
      'confirmedWarningCodes'
    ]) {
      expect(fields.has(required), `missing PublicationApproval.${required}`).toBe(true);
    }
  });

  it('reserves the controlled lifecycle states required by P8-A execution and verification', () => {
    expect(Object.values(PublicationExecutionStatus)).toEqual(expect.arrayContaining([
      'PLANNED',
      'PREVIEW_READY',
      'APPROVED',
      'QUEUED',
      'EXECUTING',
      'PR_CREATED',
      'DEPLOYED',
      'VERIFYING',
      'VERIFIED',
      'APPROVAL_STALE',
      'TARGET_REVISION_CHANGED',
      'VERIFICATION_FAILED',
      'FAILED'
    ]));
  });
});
