import { describe, expect, it } from 'vitest'
import type { AdvisorySkillRegistry } from '../../src/modules/advisory-skills/advisory-skill.registry.js'
import type { AdvisoryMethodKey, LoadedAdvisoryMethod } from '../../src/modules/advisory-skills/advisory-skill.types.js'
import { buildAdvisoryContext } from '../../src/modules/optimization/optimization.advisory.js'
import type { RecommendedActionType } from '../../src/modules/optimization/optimization.types.js'

function method(methodKey: AdvisoryMethodKey, skillId = `skill.${methodKey.toLowerCase()}`): LoadedAdvisoryMethod {
  return {
    skillId,
    methodKey,
    authority: 'ADVISORY_ONLY',
    capabilities: [],
    projection: {
      projectionVersion: 'ADVISORY_METHOD_PROJECTION_V1',
      skillId,
      methodKey,
      title: `${methodKey} title`,
      purpose: 'test projection',
      whenToUse: ['never persisted'],
      requiredInputs: ['never persisted'],
      steps: ['RAW VENDOR-DERIVED STEP MUST NOT ENTER PLAN CONTEXT'],
      checks: ['never persisted'],
      outputs: ['never persisted'],
      evidenceRules: ['never persisted'],
      forbiddenInferences: ['never persisted'],
      sourceRefs: [],
    },
    provenance: {
      sourceRepo: `owner/${skillId}`,
      upstreamCommit: '1'.repeat(40),
      localVersion: '1.0.0',
      projectionSha256: 'a'.repeat(64),
      sourceFileHashes: ['b'.repeat(64)],
    },
  }
}

function registry(methods: LoadedAdvisoryMethod[]): AdvisorySkillRegistry {
  return {
    getByMethodKeys(keys) {
      const requested = new Set(keys)
      return methods.filter((item) => requested.has(item.methodKey))
    },
    listByCapabilities() {
      return []
    },
    listAll() {
      return [...methods]
    },
  }
}

const EXPECTED: Record<RecommendedActionType, AdvisoryMethodKey[]> = {
  ON_PAGE_OPTIMIZATION: ['ON_PAGE_SEO_CHECK', 'SEO_AUDIT'],
  SERP_SNIPPET_OPTIMIZATION: ['ON_PAGE_SEO_CHECK', 'ANALYTICS'],
  CONTENT_CREATION: ['CONTENT_STRATEGY', 'CONTENT_QUALITY_AUDIT'],
  TECHNICAL_SEO_REMEDIATION: ['TECHNICAL_SEO_CHECK', 'SEO_AUDIT'],
  GEO_CITABILITY_IMPROVEMENT: ['AI_SEO', 'CONTENT_QUALITY_AUDIT'],
  AI_VISIBILITY_IMPROVEMENT: ['AI_SEO', 'CONTENT_QUALITY_AUDIT'],
  CANNIBALIZATION_REMEDIATION: ['SITE_ARCHITECTURE', 'SEO_AUDIT'],
  CONTENT_REFRESH: ['CONTENT_QUALITY_AUDIT', 'CONTENT_STRATEGY'],
}

describe('P9-A advisory packaging', () => {
  it('uses the exact versioned action-to-method mapping in deterministic order', () => {
    const allMethods = [...new Set(Object.values(EXPECTED).flat())].map((key) => method(key))
    const fakeRegistry = registry(allMethods.reverse())

    for (const [actionType, expectedKeys] of Object.entries(EXPECTED) as Array<[RecommendedActionType, AdvisoryMethodKey[]]>) {
      expect(buildAdvisoryContext({ actionType, registry: fakeRegistry }).map((item) => item.methodKey)).toEqual(expectedKeys)
    }
  })

  it('persists only bounded ADVISORY_ONLY identity and provenance fields', () => {
    const onPage = method('ON_PAGE_SEO_CHECK', 'aaron.on-page-seo-checker')
    const audit = method('SEO_AUDIT', 'corey.seo-audit')

    const context = buildAdvisoryContext({
      actionType: 'ON_PAGE_OPTIMIZATION',
      registry: registry([audit, onPage]),
    })

    expect(context).toEqual([
      {
        skillId: 'aaron.on-page-seo-checker',
        methodKey: 'ON_PAGE_SEO_CHECK',
        authority: 'ADVISORY_ONLY',
        projectionSha256: 'a'.repeat(64),
        sourceRepo: 'owner/aaron.on-page-seo-checker',
        upstreamCommit: '1'.repeat(40),
        localVersion: '1.0.0',
      },
      {
        skillId: 'corey.seo-audit',
        methodKey: 'SEO_AUDIT',
        authority: 'ADVISORY_ONLY',
        projectionSha256: 'a'.repeat(64),
        sourceRepo: 'owner/corey.seo-audit',
        upstreamCommit: '1'.repeat(40),
        localVersion: '1.0.0',
      },
    ])

    expect(JSON.stringify(context)).not.toContain('RAW VENDOR-DERIVED STEP')
    expect(JSON.stringify(context)).not.toContain('sourceFileHashes')
    expect(JSON.stringify(context)).not.toContain('projection')
  })

  it('fails closed when a required advisory method is missing or duplicated', () => {
    expect(() => buildAdvisoryContext({
      actionType: 'CONTENT_CREATION',
      registry: registry([method('CONTENT_STRATEGY')]),
    })).toThrow(/advisory/i)

    expect(() => buildAdvisoryContext({
      actionType: 'CONTENT_CREATION',
      registry: registry([
        method('CONTENT_STRATEGY', 'one.content-strategy'),
        method('CONTENT_STRATEGY', 'two.content-strategy'),
        method('CONTENT_QUALITY_AUDIT'),
      ]),
    })).toThrow(/advisory/i)
  })
})
