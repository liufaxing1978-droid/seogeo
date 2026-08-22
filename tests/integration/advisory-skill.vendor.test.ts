import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdvisorySkillRegistry } from '../../src/modules/advisory-skills/advisory-skill.registry.js'

const COREY_PIN = '3df87f97621e18fbed7f6aa684edba54f49779a7'
const AARON_PIN = '17296c71d1ff822975efb1ea28de52668c9c9022'

const COREY_METHOD_KEYS = [
  'AI_SEO',
  'ANALYTICS',
  'CONTENT_STRATEGY',
  'EXPERIMENT_DESIGN',
  'PROGRAMMATIC_SEO',
  'SCHEMA',
  'SEO_AUDIT',
  'SITE_ARCHITECTURE',
].sort()

const AARON_METHOD_KEYS = [
  'CONTENT_QUALITY_AUDIT',
  'DOMAIN_TRUST_AUDIT',
  'OFFSITE_SIGNAL_ANALYSIS',
  'ON_PAGE_SEO_CHECK',
  'TECHNICAL_SEO_CHECK',
].sort()

describe('P9-0H real vendored advisory methods', () => {
  it('loads exactly the thirteen reviewed methods at the approved pins', async () => {
    const registry = await createAdvisorySkillRegistry({
      rootDir: path.resolve('vendor/third-party-skills'),
    })
    const all = registry.listAll()
    const corey = all.filter((method) => method.skillId.startsWith('corey.'))
    const aaron = all.filter((method) => method.skillId.startsWith('aaron.'))

    expect(all).toHaveLength(13)
    expect(corey).toHaveLength(8)
    expect(aaron).toHaveLength(5)
    expect(corey.map((method) => method.methodKey).sort()).toEqual(COREY_METHOD_KEYS)
    expect(aaron.map((method) => method.methodKey).sort()).toEqual(AARON_METHOD_KEYS)

    expect(all.every((method) => method.authority === 'ADVISORY_ONLY')).toBe(true)

    expect(corey.every((method) => method.provenance.sourceRepo === 'coreyhaines31/marketingskills')).toBe(true)
    expect(corey.every((method) => method.provenance.upstreamCommit === COREY_PIN)).toBe(true)
    expect(corey.every((method) => method.provenance.localVersion === '1.0.0')).toBe(true)

    expect(aaron.every((method) => method.provenance.sourceRepo === 'aaron-he-zhu/aaron-marketing-skills')).toBe(true)
    expect(aaron.every((method) => method.provenance.upstreamCommit === AARON_PIN)).toBe(true)
    expect(aaron.every((method) => method.provenance.localVersion === '1.0.0')).toBe(true)

    expect(all.every((method) => /^[0-9a-f]{64}$/.test(method.provenance.projectionSha256))).toBe(true)
    expect(JSON.stringify(all)).not.toContain('child_process')
    expect(JSON.stringify(all)).not.toContain('npx skills add')
  })
})
