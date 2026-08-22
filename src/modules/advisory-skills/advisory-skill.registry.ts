import { loadAdvisorySources } from './advisory-skill.loader.js'
import type {
  AdvisoryCapability,
  AdvisoryMethodKey,
  LoadedAdvisoryMethod,
} from './advisory-skill.types.js'

export interface AdvisorySkillRegistry {
  getByMethodKeys(keys: readonly AdvisoryMethodKey[]): LoadedAdvisoryMethod[]
  listByCapabilities(capabilities: readonly AdvisoryCapability[]): LoadedAdvisoryMethod[]
  listAll(): LoadedAdvisoryMethod[]
}

function compareMethods(a: LoadedAdvisoryMethod, b: LoadedAdvisoryMethod): number {
  return a.methodKey.localeCompare(b.methodKey) || a.skillId.localeCompare(b.skillId)
}

function copyMethod(method: LoadedAdvisoryMethod): LoadedAdvisoryMethod {
  return {
    skillId: method.skillId,
    methodKey: method.methodKey,
    authority: 'ADVISORY_ONLY',
    capabilities: [...method.capabilities],
    projection: {
      ...method.projection,
      whenToUse: [...method.projection.whenToUse],
      requiredInputs: [...method.projection.requiredInputs],
      steps: [...method.projection.steps],
      checks: [...method.projection.checks],
      outputs: [...method.projection.outputs],
      evidenceRules: [...method.projection.evidenceRules],
      forbiddenInferences: [...method.projection.forbiddenInferences],
      sourceRefs: method.projection.sourceRefs.map((sourceRef) => ({ ...sourceRef })),
    },
    provenance: {
      ...method.provenance,
      sourceFileHashes: [...method.provenance.sourceFileHashes],
    },
  }
}

export async function createAdvisorySkillRegistry(options: {
  rootDir: string
}): Promise<AdvisorySkillRegistry> {
  const sources = await loadAdvisorySources(options.rootDir)
  const methods = sources
    .flatMap((source) =>
      source.methods.map(({ skill, projection }): LoadedAdvisoryMethod => ({
        skillId: skill.skillId,
        methodKey: skill.methodKey,
        authority: 'ADVISORY_ONLY',
        capabilities: [...skill.capabilities],
        projection: {
          ...projection,
          whenToUse: [...projection.whenToUse],
          requiredInputs: [...projection.requiredInputs],
          steps: [...projection.steps],
          checks: [...projection.checks],
          outputs: [...projection.outputs],
          evidenceRules: [...projection.evidenceRules],
          forbiddenInferences: [...projection.forbiddenInferences],
          sourceRefs: projection.sourceRefs.map((sourceRef) => ({ ...sourceRef })),
        },
        provenance: {
          sourceRepo: source.manifest.sourceRepo,
          upstreamCommit: source.manifest.upstreamCommit,
          localVersion: source.manifest.localVersion,
          projectionSha256: skill.projectionSha256,
          sourceFileHashes: [...new Set(skill.upstreamFiles.map((file) => file.sha256))].sort(),
        },
      })),
    )
    .sort(compareMethods)

  return {
    getByMethodKeys(keys) {
      const requested = new Set<string>(keys)
      return methods.filter((method) => requested.has(method.methodKey)).map(copyMethod)
    },

    listByCapabilities(capabilities) {
      const requested = new Set<string>(capabilities)
      return methods
        .filter((method) => method.capabilities.some((capability) => requested.has(capability)))
        .map(copyMethod)
    },

    listAll() {
      return methods.map(copyMethod)
    },
  }
}
