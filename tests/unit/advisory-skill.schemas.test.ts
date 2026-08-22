import { describe, expect, it } from 'vitest'
import {
  advisoryMethodProjectionSchema,
  advisoryRegistrySchema,
  advisorySourceManifestSchema,
} from '../../src/modules/advisory-skills/advisory-skill.schemas.js'
import {
  ADVISORY_CAPABILITIES,
  ADVISORY_METHOD_IDENTITIES,
} from '../../src/modules/advisory-skills/advisory-skill.policy.js'

const sha256 = 'a'.repeat(64)
const commitSha = 'b'.repeat(40)

function validProjectionFixture() {
  return {
    projectionVersion: 'ADVISORY_METHOD_PROJECTION_V1',
    skillId: 'corey.seo-audit',
    methodKey: 'SEO_AUDIT',
    title: 'SEO audit',
    purpose: 'Review SEO issues without claiming observed facts.',
    whenToUse: ['When a reviewed SEO audit method is needed.'],
    requiredInputs: ['Authoritative first-party evidence.'],
    steps: ['Inspect supplied evidence and identify bounded issues.'],
    checks: ['Keep missing evidence unknown.'],
    outputs: ['Advisory findings only.'],
    evidenceRules: ['Observed facts must come from authoritative first-party evidence.'],
    forbiddenInferences: ['Do not fabricate rankings, citations, traffic, or verification.'],
    sourceRefs: [{ upstreamPath: 'upstream/skills/seo-audit/SKILL.md', upstreamSha256: sha256 }],
  }
}

function validSkillFixture() {
  return {
    skillId: 'corey.seo-audit',
    methodKey: 'SEO_AUDIT',
    upstreamEntrypoint: 'upstream/skills/seo-audit/SKILL.md',
    capabilities: ['SEO_AUDIT_METHOD'],
    upstreamFiles: [
      {
        path: 'upstream/skills/seo-audit/SKILL.md',
        sha256,
        mediaType: 'text/markdown',
      },
    ],
    projectionPath: 'projections/SEO_AUDIT.json',
    projectionSha256: sha256,
  }
}

function validManifestFixture() {
  return {
    manifestVersion: 'ADVISORY_SOURCE_MANIFEST_V1',
    sourceId: 'coreyhaines31-marketingskills',
    sourceRepo: 'coreyhaines31/marketingskills',
    upstreamCommit: commitSha,
    licenseSpdx: 'MIT',
    licenseFile: { path: 'LICENSE', sha256 },
    localVersion: '1.0.0',
    reviewedAt: '2026-08-22',
    skills: [validSkillFixture()],
  }
}

describe('P9-0H advisory skill V1 contracts', () => {
  it('locks exactly 13 unique V1 method identities', () => {
    expect(ADVISORY_METHOD_IDENTITIES).toHaveLength(13)
    expect(new Set(ADVISORY_METHOD_IDENTITIES.map((x) => x.skillId)).size).toBe(13)
    expect(new Set(ADVISORY_METHOD_IDENTITIES.map((x) => x.methodKey)).size).toBe(13)
    expect(new Set(ADVISORY_METHOD_IDENTITIES.map((x) => x.capability)).size).toBe(13)
  })

  it('locks exactly 13 advisory capability tags', () => {
    expect(ADVISORY_CAPABILITIES).toHaveLength(13)
    expect(new Set(ADVISORY_CAPABILITIES).size).toBe(13)
  })

  it('accepts a valid strict V1 registry', () => {
    expect(
      advisoryRegistrySchema.safeParse({
        version: 'THIRD_PARTY_ADVISORY_REGISTRY_V1',
        sources: [
          {
            sourceId: 'coreyhaines31-marketingskills',
            manifestPath: 'coreyhaines31-marketingskills/manifest.json',
            manifestSha256: sha256,
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects unknown registry versions and extra fields', () => {
    expect(
      advisoryRegistrySchema.safeParse({
        version: 'THIRD_PARTY_ADVISORY_REGISTRY_V2',
        sources: [],
      }).success,
    ).toBe(false)
    expect(
      advisoryRegistrySchema.safeParse({
        version: 'THIRD_PARTY_ADVISORY_REGISTRY_V1',
        sources: [],
        authority: 'AUTHORITATIVE',
      }).success,
    ).toBe(false)
  })

  it('rejects symbolic, short, or uppercase upstream commit refs', () => {
    for (const upstreamCommit of ['main', 'abc1234', 'B'.repeat(40)]) {
      expect(
        advisorySourceManifestSchema.safeParse({
          ...validManifestFixture(),
          upstreamCommit,
        }).success,
      ).toBe(false)
    }
  })

  it('rejects unknown license and capability values', () => {
    expect(
      advisorySourceManifestSchema.safeParse({
        ...validManifestFixture(),
        licenseSpdx: 'GPL-3.0',
      }).success,
    ).toBe(false)

    const manifest = validManifestFixture()
    expect(
      advisorySourceManifestSchema.safeParse({
        ...manifest,
        skills: [{ ...manifest.skills[0], capabilities: ['EXECUTE_SHELL'] }],
      }).success,
    ).toBe(false)
  })

  it('rejects malformed or uppercase SHA-256 digests', () => {
    for (const badHash of ['a'.repeat(63), 'A'.repeat(64), 'x'.repeat(64)]) {
      expect(
        advisorySourceManifestSchema.safeParse({
          ...validManifestFixture(),
          licenseFile: { path: 'LICENSE', sha256: badHash },
        }).success,
      ).toBe(false)
    }
  })

  it('accepts a complete projection and rejects vendor authority elevation', () => {
    expect(advisoryMethodProjectionSchema.safeParse(validProjectionFixture()).success).toBe(true)
    expect(
      advisoryMethodProjectionSchema.safeParse({
        ...validProjectionFixture(),
        authority: 'AUTHORITATIVE',
      }).success,
    ).toBe(false)
  })

  it('requires non-empty advisory method fields and source refs', () => {
    for (const key of [
      'whenToUse',
      'requiredInputs',
      'steps',
      'checks',
      'outputs',
      'evidenceRules',
      'forbiddenInferences',
      'sourceRefs',
    ] as const) {
      expect(
        advisoryMethodProjectionSchema.safeParse({
          ...validProjectionFixture(),
          [key]: [],
        }).success,
      ).toBe(false)
    }
  })

  it('rejects unknown projection versions, method keys, and extra execution fields', () => {
    expect(
      advisoryMethodProjectionSchema.safeParse({
        ...validProjectionFixture(),
        projectionVersion: 'ADVISORY_METHOD_PROJECTION_V2',
      }).success,
    ).toBe(false)
    expect(
      advisoryMethodProjectionSchema.safeParse({
        ...validProjectionFixture(),
        methodKey: 'RUN_CONNECTOR',
      }).success,
    ).toBe(false)
    expect(
      advisoryMethodProjectionSchema.safeParse({
        ...validProjectionFixture(),
        execute: 'curl https://example.com',
      }).success,
    ).toBe(false)
  })
})
