import { createHash } from 'node:crypto';
import type {
  ApprovedPlanInput,
  MutationAdapter,
  MutationApplyResult,
  MutationExecutionState,
  MutationExportArtifact,
  MutationPreview,
  MutationRollbackDraft,
  PublicationExecutionRef,
  TargetRef,
  TargetSnapshot
} from './mutation-adapter.js';

function stableStringMap(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

function patchArtifact(plan: ApprovedPlanInput): MutationExportArtifact {
  const content = plan.unifiedDiff;
  return {
    kind: 'PATCH',
    filename: `publication-${plan.publicationId}-${plan.planHash.slice(0, 12)}.patch`,
    mediaType: 'text/x-diff',
    content,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex')
  };
}

export class ExportMutationAdapter implements MutationAdapter {
  readonly capability = 'EXPORT_ONLY' as const;

  async readTargetSnapshot(input: TargetRef): Promise<TargetSnapshot> {
    return {
      repositoryIdentity: input.repositoryIdentity,
      branch: input.branch,
      headSha: input.headSha,
      touchedBlobShas: stableStringMap(input.touchedBlobShas)
    };
  }

  async preview(plan: ApprovedPlanInput): Promise<MutationPreview> {
    return {
      capability: this.capability,
      repositoryIdentity: plan.repositoryIdentity,
      branch: plan.branch,
      baseSha: plan.baseSha,
      touchedBlobShas: stableStringMap(plan.touchedBlobShas),
      operations: plan.operations.map((operation) => ({ ...operation })),
      unifiedDiff: plan.unifiedDiff,
      artifact: patchArtifact(plan)
    };
  }

  async apply(plan: ApprovedPlanInput): Promise<MutationApplyResult> {
    const preview = await this.preview(plan);
    return {
      capability: this.capability,
      status: 'MANUAL_ACTION_REQUIRED',
      remoteWritePerformed: false,
      artifact: preview.artifact
    };
  }

  async readExecutionState(execution: PublicationExecutionRef): Promise<MutationExecutionState> {
    return {
      status: 'MANUAL_ACTION_REQUIRED',
      remoteStateKnown: false,
      artifactSha256: execution.artifactSha256 ?? null
    };
  }

  async rollback(execution: PublicationExecutionRef): Promise<MutationRollbackDraft> {
    return {
      status: 'MANUAL_ACTION_REQUIRED',
      strategy: 'DISCARD_OR_REVERSE_EXPORTED_PATCH',
      remoteWritePerformed: false,
      artifactSha256: execution.artifactSha256 ?? null
    };
  }
}
