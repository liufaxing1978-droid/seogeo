import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAdvisorySources } from '../../src/modules/advisory-skills/advisory-skill.loader.js'

const tempRoots: string[] = []

function hashBytes(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function createFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'advisory-skills-'))
  tempRoots.push(rootDir)

  const sourceId = 'fixture-source'
  const sourceDir = path.join(rootDir, sourceId)
  const rawRelative = 'upstream/skill/SKILL.md'
  const projectionRelative = 'projections/SEO_AUDIT.json'
  const licenseRelative = 'LICENSE'
  const manifestRelative = `${sourceId}/manifest.json`
  const rawPath = path.join(sourceDir, rawRelative)
  const projectionPath = path.join(sourceDir, projectionRelative)
  const licensePath = path.join(sourceDir, licenseRelative)
  const manifestPath = path.join(sourceDir, 'manifest.json')
  const registryPath = path.join(rootDir, 'registry.json')

  await mkdir(path.dirname(rawPath), { recursive: true })
  await mkdir(path.dirname(projectionPath), { recursive: true })

  const raw = '# Fixture SEO audit\nRAW_UPSTREAM_SENTINEL\n'
  const license = 'MIT License fixture\n'
  const projection = {
    projectionVersion: 'ADVISORY_METHOD_PROJECTION_V1',
    skillId: 'corey.seo-audit',
    methodKey: 'SEO_AUDIT',
    title: 'Fixture SEO audit',
    purpose: 'Exercise the reviewed advisory loader.',
    whenToUse: ['When a bounded SEO audit method is needed.'],
    requiredInputs: ['Authoritative first-party evidence.'],
    steps: ['Inspect only the supplied evidence.'],
    checks: ['Keep missing evidence unknown.'],
    outputs: ['Advisory findings only.'],
    evidenceRules: ['Observed facts must come from authoritative evidence.'],
    forbiddenInferences: ['Do not fabricate rankings, citations, traffic, or verification.'],
    sourceRefs: [{ upstreamPath: rawRelative, upstreamSha256: hashBytes(raw) }],
  }
  const projectionText = jsonBytes(projection)

  await writeFile(rawPath, raw)
  await writeFile(licensePath, license)
  await writeFile(projectionPath, projectionText)

  const manifest = {
    manifestVersion: 'ADVISORY_SOURCE_MANIFEST_V1',
    sourceId,
    sourceRepo: 'fixture/repo',
    upstreamCommit: 'b'.repeat(40),
    licenseSpdx: 'MIT',
    licenseFile: { path: licenseRelative, sha256: hashBytes(license) },
    localVersion: '1.0.0',
    reviewedAt: '2026-08-22',
    skills: [
      {
        skillId: 'corey.seo-audit',
        methodKey: 'SEO_AUDIT',
        upstreamEntrypoint: rawRelative,
        capabilities: ['SEO_AUDIT_METHOD'],
        upstreamFiles: [
          {
            path: rawRelative,
            sha256: hashBytes(raw),
            mediaType: 'text/markdown',
          },
        ],
        projectionPath: projectionRelative,
        projectionSha256: hashBytes(projectionText),
      },
    ],
  }

  async function rewriteManifest(nextManifest = manifest) {
    const manifestText = jsonBytes(nextManifest)
    await writeFile(manifestPath, manifestText)
    const registry = {
      version: 'THIRD_PARTY_ADVISORY_REGISTRY_V1',
      sources: [
        {
          sourceId,
          manifestPath: manifestRelative,
          manifestSha256: hashBytes(manifestText),
        },
      ],
    }
    await writeFile(registryPath, jsonBytes(registry))
    return { manifestText, registry }
  }

  async function rewriteProjection(nextProjection: typeof projection) {
    const nextProjectionText = jsonBytes(nextProjection)
    await writeFile(projectionPath, nextProjectionText)
    manifest.skills[0].projectionSha256 = hashBytes(nextProjectionText)
    await rewriteManifest(manifest)
    return nextProjectionText
  }

  await rewriteManifest(manifest)

  return {
    rootDir,
    sourceId,
    sourceDir,
    rawRelative,
    projectionRelative,
    licenseRelative,
    manifestRelative,
    rawPath,
    projectionPath,
    licensePath,
    manifestPath,
    registryPath,
    raw,
    license,
    projection,
    manifest,
    rewriteManifest,
    rewriteProjection,
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('P9-0H advisory supply-chain loader', () => {
  it('loads a valid hash-bound source tree', async () => {
    const fixture = await createFixture()
    const sources = await loadAdvisorySources(fixture.rootDir)

    expect(sources).toHaveLength(1)
    expect(sources[0]?.manifest.sourceId).toBe(fixture.sourceId)
    expect(sources[0]?.methods).toHaveLength(1)
    expect(sources[0]?.methods[0]?.projection.methodKey).toBe('SEO_AUDIT')
  })

  it('fails when registry manifest hash no longer matches exact manifest bytes', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.manifestPath, `${await readFile(fixture.manifestPath, 'utf8')} `)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_HASH_MISMATCH',
    })
  })

  it('fails when raw markdown bytes change', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.rawPath, `${fixture.raw}tampered\n`)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_HASH_MISMATCH',
    })
  })

  it('fails when projection bytes change', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.projectionPath, `${await readFile(fixture.projectionPath, 'utf8')} `)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_HASH_MISMATCH',
    })
  })

  it('fails when LICENSE bytes change', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.licensePath, `${fixture.license}tampered\n`)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_HASH_MISMATCH',
    })
  })

  it('fails registry manifest path traversal', async () => {
    const fixture = await createFixture()
    const registry = JSON.parse(await readFile(fixture.registryPath, 'utf8')) as {
      sources: Array<{ manifestPath: string }>
    }
    registry.sources[0]!.manifestPath = '../outside.json'
    await writeFile(fixture.registryPath, jsonBytes({
      version: 'THIRD_PARTY_ADVISORY_REGISTRY_V1',
      sources: registry.sources,
    }))

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_PATH_ESCAPE',
    })
  })

  it('fails source path traversal and absolute paths', async () => {
    const fixture = await createFixture()
    fixture.manifest.licenseFile.path = '../outside-license'
    await fixture.rewriteManifest(fixture.manifest)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_PATH_ESCAPE',
    })

    const fixture2 = await createFixture()
    fixture2.manifest.skills[0].projectionPath = path.resolve(fixture2.rootDir, 'projection.json')
    await fixture2.rewriteManifest(fixture2.manifest)

    await expect(loadAdvisorySources(fixture2.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_PATH_ESCAPE',
    })
  })

  it('rejects symlinks inside the vendor root', async () => {
    const fixture = await createFixture()
    const target = path.join(fixture.sourceDir, 'target.md')
    const link = path.join(fixture.sourceDir, 'linked.md')
    await writeFile(target, 'target\n')

    try {
      await symlink(target, link)
    } catch (error) {
      if (process.platform === 'win32') return
      throw error
    }

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_SYMLINK_REJECTED',
    })
  })

  it('fails on undeclared source files', async () => {
    const fixture = await createFixture()
    await writeFile(path.join(fixture.sourceDir, 'extra.md'), 'undeclared\n')

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_FILE_UNDECLARED',
    })
  })

  it('fails on unexpected top-level files or directories', async () => {
    const fixture = await createFixture()
    await writeFile(path.join(fixture.rootDir, 'extra.txt'), 'undeclared\n')

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_FILE_UNDECLARED',
    })
  })

  it('rejects declared script payloads', async () => {
    const fixture = await createFixture()
    const scriptRelative = 'upstream/skill/run.sh'
    const scriptPath = path.join(fixture.sourceDir, scriptRelative)
    const script = '#!/bin/sh\necho unsafe\n'
    await writeFile(scriptPath, script)

    fixture.manifest.skills[0].upstreamEntrypoint = scriptRelative
    fixture.manifest.skills[0].upstreamFiles = [
      { path: scriptRelative, sha256: hashBytes(script), mediaType: 'text/plain' },
    ]
    fixture.projection.sourceRefs = [
      { upstreamPath: scriptRelative, upstreamSha256: hashBytes(script) },
    ]
    await fixture.rewriteProjection(fixture.projection)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_FILE_TYPE_REJECTED',
    })
  })

  it('fails when a declared file is missing', async () => {
    const fixture = await createFixture()
    await rm(fixture.rawPath)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_MANIFEST_INVALID',
    })
  })

  it('fails duplicate source IDs', async () => {
    const fixture = await createFixture()
    const registry = JSON.parse(await readFile(fixture.registryPath, 'utf8')) as {
      version: string
      sources: Array<{ sourceId: string; manifestPath: string; manifestSha256: string }>
    }
    registry.sources.push({ ...registry.sources[0]! })
    await writeFile(fixture.registryPath, jsonBytes(registry))

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_DUPLICATE_ID',
    })
  })

  it('fails duplicate skill IDs and method keys', async () => {
    const fixture = await createFixture()
    fixture.manifest.skills.push({ ...fixture.manifest.skills[0]! })
    await fixture.rewriteManifest(fixture.manifest)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_DUPLICATE_ID',
    })

    const fixture2 = await createFixture()
    fixture2.manifest.skills.push({
      ...fixture2.manifest.skills[0]!,
      skillId: 'another.skill',
    })
    await fixture2.rewriteManifest(fixture2.manifest)

    await expect(loadAdvisorySources(fixture2.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_DUPLICATE_METHOD_KEY',
    })
  })

  it('fails projection sourceRefs outside the skill declared upstreamFiles', async () => {
    const fixture = await createFixture()
    fixture.projection.sourceRefs = [
      { upstreamPath: 'upstream/other/SKILL.md', upstreamSha256: 'c'.repeat(64) },
    ]
    await fixture.rewriteProjection(fixture.projection)

    await expect(loadAdvisorySources(fixture.rootDir)).rejects.toMatchObject({
      code: 'ADVISORY_PROJECTION_INVALID',
    })
  })
})
