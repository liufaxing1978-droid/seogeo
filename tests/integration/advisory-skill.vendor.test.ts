import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdvisorySkillRegistry } from '../../src/modules/advisory-skills/advisory-skill.registry.js'

const COREY_PIN = '3df87f97621e18fbed7f6aa684edba54f49779a7'

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

describe('P9-0H real vendored advisory methods', () => {
  it('loads exactly the eight reviewed Corey methods at the approved pin', async () => {
    const registry = await createAdvisorySkillRegistry({
      rootDir: path.resolve('vendor/third-party-skills'),
    })
    const corey = registry.listAll().filter((method) => method.skillId.startsWith('corey.'))

    expect(corey).toHaveLength(8)
    expect(corey.map((method) => method.methodKey).sort()).toEqual(COREY_METHOD_KEYS)
    expect(corey.every((method) => method.authority === 'ADVISORY_ONLY')).toBe(true)
    expect(corey.every((method) => method.provenance.sourceRepo === 'coreyhaines31/marketingskills')).toBe(true)
    expect(corey.every((method) => method.provenance.upstreamCommit === COREY_PIN)).toBe(true)
    expect(corey.every((method) => method.provenance.localVersion === '1.0.0')).toBe(true)
    expect(corey.every((method) => /^[0-9a-f]{64}$/.test(method.provenance.projectionSha256))).toBe(true)
    expect(JSON.stringify(corey)).not.toContain('child_process')
    expect(JSON.stringify(corey)).not.toContain('npx skills add')
  })
})
