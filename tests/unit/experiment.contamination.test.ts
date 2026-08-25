import { describe, expect, it } from 'vitest';
import {
  detectExperimentContamination,
  type ExperimentContaminationEvent,
  type ExperimentContaminationReadPort
} from '../../src/modules/optimization-experiments/experiment.contamination.js';

const anchor = new Date('2026-08-24T00:00:00.000Z');
const observedEnd = new Date('2026-09-07T23:59:59.999Z');
const targetUrl = 'https://xingshantang.org/page';

function event(overrides: Partial<ExperimentContaminationEvent> = {}): ExperimentContaminationEvent {
  return {
    projectId: 'project-1',
    executionId: 'execution-other',
    eventType: 'DEPLOYED',
    targetUrl,
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    ...overrides
  };
}

function repository(events: readonly ExperimentContaminationEvent[] | null): ExperimentContaminationReadPort {
  return {
    listPublicationEvents: async () => events
  };
}

async function detect(events: readonly ExperimentContaminationEvent[] | null) {
  return detectExperimentContamination({
    experimentId: 'experiment-1',
    projectId: 'project-1',
    publicationExecutionId: 'execution-original',
    targetUrl,
    verifiedAnchorAt: anchor,
    observedWindowEnd: observedEnd,
    repository: repository(events)
  });
}

describe('P9-D publication contamination detector', () => {
  it('prioritizes rollback of the original execution as verification invalidation', async () => {
    await expect(detect([
      event({ executionId: 'execution-other', eventType: 'DEPLOYED' }),
      event({ executionId: 'execution-original', eventType: 'ROLLED_BACK' })
    ])).resolves.toEqual({
      state: 'VERIFICATION_INVALIDATED',
      reasonCodes: ['EXPERIMENT_ORIGINAL_EXECUTION_ROLLED_BACK']
    });
  });

  it.each(['DEPLOYED', 'VERIFIED', 'ROLLED_BACK'] as const)(
    'treats another same-target %s event inside the observation interval as a conflicting mutation',
    async (eventType) => {
      await expect(detect([event({ eventType })])).resolves.toEqual({
        state: 'CONFLICTING_MUTATION',
        reasonCodes: ['EXPERIMENT_CONFLICTING_PUBLICATION_EVENT']
      });
    }
  );

  it('classifies another same-target revision-change event after mutation conflicts', async () => {
    await expect(detect([
      event({ eventType: 'TARGET_REVISION_CHANGED' })
    ])).resolves.toEqual({
      state: 'TARGET_REVISION_CHANGED',
      reasonCodes: ['EXPERIMENT_TARGET_REVISION_CHANGED']
    });
  });

  it('keeps mutation conflict precedence over target revision change', async () => {
    await expect(detect([
      event({ eventType: 'TARGET_REVISION_CHANGED' }),
      event({ eventType: 'VERIFIED', createdAt: new Date('2026-09-01T00:00:00.000Z') })
    ])).resolves.toEqual({
      state: 'CONFLICTING_MUTATION',
      reasonCodes: ['EXPERIMENT_CONFLICTING_PUBLICATION_EVENT']
    });
  });

  it('ignores the original verification event and events outside the exact project/target/time boundary', async () => {
    await expect(detect([
      event({ executionId: 'execution-original', eventType: 'VERIFIED' }),
      event({ projectId: 'project-2' }),
      event({ targetUrl: 'https://xingshantang.org/other' }),
      event({ createdAt: new Date('2026-08-23T23:59:59.999Z') }),
      event({ createdAt: new Date('2026-09-08T00:00:00.000Z') })
    ])).resolves.toEqual({
      state: 'CLEAR',
      reasonCodes: []
    });
  });

  it('fails closed to UNKNOWN when required publication authority cannot be read', async () => {
    await expect(detect(null)).resolves.toEqual({
      state: 'UNKNOWN',
      reasonCodes: ['EXPERIMENT_CONTAMINATION_AUTHORITY_UNKNOWN']
    });
  });

  it('fails closed to UNKNOWN when the publication read port throws', async () => {
    const failingRepository: ExperimentContaminationReadPort = {
      listPublicationEvents: async () => {
        throw new Error('database unavailable');
      }
    };

    await expect(detectExperimentContamination({
      experimentId: 'experiment-1',
      projectId: 'project-1',
      publicationExecutionId: 'execution-original',
      targetUrl,
      verifiedAnchorAt: anchor,
      observedWindowEnd: observedEnd,
      repository: failingRepository
    })).resolves.toEqual({
      state: 'UNKNOWN',
      reasonCodes: ['EXPERIMENT_CONTAMINATION_AUTHORITY_UNKNOWN']
    });
  });
});
