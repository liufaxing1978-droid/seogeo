import type { AdvisorySkillRegistry } from '../advisory-skills/advisory-skill.registry.js'
import type { AdvisoryMethodKey, LoadedAdvisoryMethod } from '../advisory-skills/advisory-skill.types.js'
import type { RecommendedActionType } from './optimization.types.js'

const METHODS_BY_ACTION: Readonly<Record<RecommendedActionType, readonly AdvisoryMethodKey[]>> = Object.freeze({
  ON_PAGE_OPTIMIZATION: ['ON_PAGE_SEO_CHECK', 'SEO_AUDIT'],
  SERP_SNIPPET_OPTIMIZATION: ['ON_PAGE_SEO_CHECK', 'ANALYTICS'],
  CONTENT_CREATION: ['CONTENT_STRATEGY', 'CONTENT_QUALITY_AUDIT'],
  TECHNICAL_SEO_REMEDIATION: ['TECHNICAL_SEO_CHECK', 'SEO_AUDIT'],
  GEO_CITABILITY_IMPROVEMENT: ['AI_SEO', 'CONTENT_QUALITY_AUDIT'],
  AI_VISIBILITY_IMPROVEMENT: ['AI_SEO', 'CONTENT_QUALITY_AUDIT'],
  CANNIBALIZATION_REMEDIATION: ['SITE_ARCHITECTURE', 'SEO_AUDIT'],
  CONTENT_REFRESH: ['CONTENT_QUALITY_AUDIT', 'CONTENT_STRATEGY'],
})

export type AdvisoryPlanContext = Array<{
  skillId: string
  methodKey: AdvisoryMethodKey
  authority: 'ADVISORY_ONLY'
  projectionSha256: string
  sourceRepo: string
  upstreamCommit: string
  localVersion: string
}>

function boundedContext(method: LoadedAdvisoryMethod): AdvisoryPlanContext[number] {
  if (method.authority !== 'ADVISORY_ONLY') {
    throw new Error(`Invalid advisory authority for ${method.methodKey}`)
  }

  return {
    skillId: method.skillId,
    methodKey: method.methodKey,
    authority: 'ADVISORY_ONLY',
    projectionSha256: method.provenance.projectionSha256,
    sourceRepo: method.provenance.sourceRepo,
    upstreamCommit: method.provenance.upstreamCommit,
    localVersion: method.provenance.localVersion,
  }
}

export function buildAdvisoryContext(input: {
  actionType: RecommendedActionType
  registry: AdvisorySkillRegistry
}): AdvisoryPlanContext {
  const requestedKeys = METHODS_BY_ACTION[input.actionType]
  const loaded = input.registry.getByMethodKeys(requestedKeys)

  return requestedKeys.map((methodKey) => {
    const matches = loaded.filter((method) => method.methodKey === methodKey)
    if (matches.length !== 1) {
      throw new Error(`Required advisory method ${methodKey} must resolve exactly once`)
    }
    return boundedContext(matches[0]!)
  })
}
