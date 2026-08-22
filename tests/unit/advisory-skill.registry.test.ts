import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAdvisorySkillRegistry } from '../../src/modules/advisory-skills/advisory-skill.registry.js'
import type {
  AdvisoryCapability,
  AdvisoryMethodKey,
} from '../../src/modules/advisory-skills/advisory-skill.types.js'

const tempRoots: string[] = []

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeRegistryFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'advisory-registry-'))
  tempRoots.push(rootDir)
  const sourceId = 'fixture-source'
  const sourceDir = path.join(rootDir, sourceId)
  await mkdir(path.join(sourceDir, 'upstream'), { recursive: true })
  await mkdir(path.join(sourceDir, 'projections'), { recursive: true })

  const license = 'MIT fixture\n'
  await writeFile(path.join(sourceDir, 'LICENSE'), license)

  const definitions = [
    {
      skillId: 'corey.seo-audit',
      methodKey: 'SEO_AUDIT',
      capability: 'SEO_AUDIT_METHOD',
      title: 'SEO audit',
      raw: '# SEO audit\nRAW_UPSTREAM_SENTINEL_ONE\n',
    },
    {
      skillId: 'corey.ai-seo',
      methodKey: 'AI_SEO',
      capability: 'AI_SEO_METHOD',
      title: 'AI SEO',
      raw: '# AI SEO\nRAW_UPSTREAM_SENTINEL_TWO\n',
    },
  ] as const

  const skills = []
  for (const definition of definitions) {
    const rawRelative = `upstream/${definition.methodKey}.md`
    const projectionRelative = `projections/${definition.methodKey}.json`
    await writeFile(path.join(sourceDir, rawRelative), definition.raw)

    const projection = {
      projectionVersion: 'ADVISORY_METHOD_PROJECTION_V1',
      skillId: definition.skillId,
      methodKey: definition.methodKey,
      title: definition.title,
      purpose: `Use ${definition.title} as a bounded advisory method.`,
      whenToUse: ['When this reviewed method is explicitly selected.'],
      requiredInputs: ['Authoritative first-party evidence.'],
      steps: ['Analyze only the supplied evidence.'],
      checks: ['Keep missing evidence unknown.'],
      outputs: ['Advisory recommendations only.'],
      evidenceRules: ['Observed facts remain owned by first-party evidence.'],
      forbiddenInferences: ['Do not fabricate ranking, citation, traffic, risk, approval, or verification.'],
      sourceRefs: [{ upstreamPath: rawRelative, upstreamSha256: sha256(definition.raw) }],
    }
    const projectionText = json(projection)
    await writeFile(path.join(sourceDir, projectionRelative), projectionText)

    skills.push({
      skillId: definition.skillId,
      methodKey: definition.methodKey,
      upstreamEntrypoint: rawRelative,
      capabilities: [definition.capability],
      upstreamFiles: [
        {
          path: rawRelative,
          sha256: sha256(definition.raw),
          mediaType: 'text/markdown',
        },
      ],
      projectionPath: projectionRelative,
      projectionSha256: sha256(projectionText),
    })
  }

  // Deliberately reverse declaration order; the public API must sort deterministically.
  skills.reverse()

  const manifest = {
    manifestVersion: 'ADVISORY_SOURCE_MANIFEST_V1',
    sourceId,
    sourceRepo: 'fixture/repo',
    upstreamCommit: 'b'.repeat(40),
    licenseSpdx: 'MIT',
    licenseFile: { path: 'LICENSE', sha256: sha256(license) },
    localVersion: '1.0.0',
    reviewedAt: '2026-08-22',
    skills,
  }
  const manifestText = json(manifest)
  await writeFile(path.join(sourceDir, 'manifest.json'), manifestText)
  await writeFile(
    path.join(rootDir, 'registry.json'),
    json({
      version: 'THIRD_PARTY_ADVISORY_REGISTRY_V1',
      sources: [
        {
          sourceId,
          manifestPath: `${sourceId}/manifest.json`,
          manifestSha256: sha256(manifestText),
        },
      ],
    }),
  )

  return { rootDir }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('P9-0H projection-only advisory registry', () => {
  it('returns only first-party advisory projections with exact provenance', async () => {
    const { rootDir } = await writeRegistryFixture()
    const registry = await createAdvisorySkillRegistry({ rootDir })
    const method = registry.getByMethodKeys(['SEO_AUDIT'])[0]

    expect(method).toMatchObject({
      skillId: 'corey.seo-audit',
      methodKey: 'SEO_AUDIT',
      authority: 'ADVISORY_ONLY',
      provenance: {
        sourceRepo: 'fixture/repo',
        upstreamCommit: 'b'.repeat(40),
        localVersion: '1.0.0',
      },
    })
    expect(method?.provenance.projectionSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(method?.provenance.sourceFileHashes).toHaveLength(1)
    expect(JSON.stringify(method)).not.toContain('RAW_UPSTREAM_SENTINEL')
  })

  it('sorts results deterministically by methodKey then skillId', async () => {
    const { rootDir } = await writeRegistryFixture()
    const registry = await createAdvisorySkillRegistry({ rootDir })

    expect(registry.listAll().map((method) => method.methodKey)).toEqual(['AI_SEO', 'SEO_AUDIT'])
  })

  it('dedupes requested keys and never falls back for unknown keys', async () => {
    const { rootDir } = await writeRegistryFixture()
    const registry = await createAdvisorySkillRegistry({ rootDir })

    expect(registry.getByMethodKeys(['SEO_AUDIT', 'SEO_AUDIT'])).toHaveLength(1)
    expect(registry.getByMethodKeys(['NOT_A_METHOD' as AdvisoryMethodKey])).toEqual([])
  })

  it('lists matching capabilities once even when the query repeats', async () => {
    const { rootDir } = await writeRegistryFixture()
    const registry = await createAdvisorySkillRegistry({ rootDir })

    const methods = registry.listByCapabilities([
      'SEO_AUDIT_METHOD',
      'SEO_AUDIT_METHOD',
    ] as AdvisoryCapability[])
    expect(methods.map((method) => method.methodKey)).toEqual(['SEO_AUDIT'])
  })

  it('does not let caller mutation change later registry reads', async () => {
    const { rootDir } = await writeRegistryFixture()
    const registry = await createAdvisorySkillRegistry({ rootDir })
    const first = registry.listAll()

    try {
      first[0]!.projection.title = 'mutated by caller'
      first[0]!.capabilities.push('SEO_AUDIT_METHOD')
      first[0]!.provenance.sourceFileHashes.push('c'.repeat(64))
    } catch {
      // Deep-frozen results are also acceptable; the registry must remain unchanged either way.
    }

    const second = registry.listAll()
    expect(second[0]?.projection.title).toBe('AI SEO')
    expect(second[0]?.capabilities).toEqual(['AI_SEO_METHOD'])
    expect(second[0]?.provenance.sourceFileHashes).toHaveLength(1)
  })
})
