export const ADVISORY_METHOD_KEYS = [
  'SEO_AUDIT',
  'AI_SEO',
  'SCHEMA',
  'PROGRAMMATIC_SEO',
  'SITE_ARCHITECTURE',
  'CONTENT_STRATEGY',
  'ANALYTICS',
  'EXPERIMENT_DESIGN',
  'CONTENT_QUALITY_AUDIT',
  'DOMAIN_TRUST_AUDIT',
  'TECHNICAL_SEO_CHECK',
  'ON_PAGE_SEO_CHECK',
  'OFFSITE_SIGNAL_ANALYSIS',
] as const

export type AdvisoryMethodKey = (typeof ADVISORY_METHOD_KEYS)[number]

export const ADVISORY_CAPABILITY_VALUES = [
  'SEO_AUDIT_METHOD',
  'AI_SEO_METHOD',
  'SCHEMA_METHOD',
  'PROGRAMMATIC_SEO_METHOD',
  'SITE_ARCHITECTURE_METHOD',
  'CONTENT_STRATEGY_METHOD',
  'ANALYTICS_METHOD',
  'EXPERIMENT_METHOD',
  'CONTENT_QUALITY_METHOD',
  'DOMAIN_TRUST_METHOD',
  'TECHNICAL_SEO_METHOD',
  'ON_PAGE_SEO_METHOD',
  'OFFSITE_SIGNAL_METHOD',
] as const

export type AdvisoryCapability = (typeof ADVISORY_CAPABILITY_VALUES)[number]

export const ADVISORY_LICENSE_VALUES = ['MIT', 'Apache-2.0'] as const
export type AdvisoryLicenseSpdx = (typeof ADVISORY_LICENSE_VALUES)[number]

export interface HashedLegalFile {
  path: string
  sha256: string
}

export interface AdvisoryRegistryV1 {
  version: 'THIRD_PARTY_ADVISORY_REGISTRY_V1'
  sources: Array<{
    sourceId: string
    manifestPath: string
    manifestSha256: string
  }>
}

export interface AdvisorySourceManifestV1 {
  manifestVersion: 'ADVISORY_SOURCE_MANIFEST_V1'
  sourceId: string
  sourceRepo: string
  upstreamCommit: string
  licenseSpdx: AdvisoryLicenseSpdx
  licenseFile: HashedLegalFile
  noticeFile?: HashedLegalFile
  localVersion: string
  reviewedAt: string
  skills: Array<{
    skillId: string
    methodKey: AdvisoryMethodKey
    upstreamEntrypoint: string
    capabilities: AdvisoryCapability[]
    upstreamFiles: Array<{
      path: string
      sha256: string
      mediaType: 'text/markdown' | 'application/json' | 'text/plain'
    }>
    projectionPath: string
    projectionSha256: string
  }>
}

export interface AdvisoryMethodProjectionV1 {
  projectionVersion: 'ADVISORY_METHOD_PROJECTION_V1'
  skillId: string
  methodKey: AdvisoryMethodKey
  title: string
  purpose: string
  whenToUse: string[]
  requiredInputs: string[]
  steps: string[]
  checks: string[]
  outputs: string[]
  evidenceRules: string[]
  forbiddenInferences: string[]
  sourceRefs: Array<{
    upstreamPath: string
    upstreamSha256: string
  }>
}

export interface LoadedAdvisoryMethod {
  skillId: string
  methodKey: AdvisoryMethodKey
  authority: 'ADVISORY_ONLY'
  capabilities: AdvisoryCapability[]
  projection: AdvisoryMethodProjectionV1
  provenance: {
    sourceRepo: string
    upstreamCommit: string
    localVersion: string
    projectionSha256: string
    sourceFileHashes: string[]
  }
}
