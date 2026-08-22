import {
  ADVISORY_CAPABILITY_VALUES,
  type AdvisoryCapability,
  type AdvisoryMethodKey,
} from './advisory-skill.types.js'

export const ADVISORY_CAPABILITIES = ADVISORY_CAPABILITY_VALUES

export interface AdvisoryMethodIdentity {
  skillId: string
  methodKey: AdvisoryMethodKey
  capability: AdvisoryCapability
}

export const ADVISORY_METHOD_IDENTITIES = [
  { skillId: 'corey.seo-audit', methodKey: 'SEO_AUDIT', capability: 'SEO_AUDIT_METHOD' },
  { skillId: 'corey.ai-seo', methodKey: 'AI_SEO', capability: 'AI_SEO_METHOD' },
  { skillId: 'corey.schema', methodKey: 'SCHEMA', capability: 'SCHEMA_METHOD' },
  {
    skillId: 'corey.programmatic-seo',
    methodKey: 'PROGRAMMATIC_SEO',
    capability: 'PROGRAMMATIC_SEO_METHOD',
  },
  {
    skillId: 'corey.site-architecture',
    methodKey: 'SITE_ARCHITECTURE',
    capability: 'SITE_ARCHITECTURE_METHOD',
  },
  {
    skillId: 'corey.content-strategy',
    methodKey: 'CONTENT_STRATEGY',
    capability: 'CONTENT_STRATEGY_METHOD',
  },
  { skillId: 'corey.analytics', methodKey: 'ANALYTICS', capability: 'ANALYTICS_METHOD' },
  {
    skillId: 'corey.ab-testing',
    methodKey: 'EXPERIMENT_DESIGN',
    capability: 'EXPERIMENT_METHOD',
  },
  {
    skillId: 'aaron.content-quality-auditor',
    methodKey: 'CONTENT_QUALITY_AUDIT',
    capability: 'CONTENT_QUALITY_METHOD',
  },
  {
    skillId: 'aaron.domain-authority-auditor',
    methodKey: 'DOMAIN_TRUST_AUDIT',
    capability: 'DOMAIN_TRUST_METHOD',
  },
  {
    skillId: 'aaron.technical-seo-checker',
    methodKey: 'TECHNICAL_SEO_CHECK',
    capability: 'TECHNICAL_SEO_METHOD',
  },
  {
    skillId: 'aaron.on-page-seo-checker',
    methodKey: 'ON_PAGE_SEO_CHECK',
    capability: 'ON_PAGE_SEO_METHOD',
  },
  {
    skillId: 'aaron.offsite-signal-analyzer',
    methodKey: 'OFFSITE_SIGNAL_ANALYSIS',
    capability: 'OFFSITE_SIGNAL_METHOD',
  },
] as const satisfies readonly AdvisoryMethodIdentity[]

export const ADVISORY_SKILL_ERROR_CODES = [
  'ADVISORY_REGISTRY_INVALID',
  'ADVISORY_MANIFEST_INVALID',
  'ADVISORY_PATH_ESCAPE',
  'ADVISORY_SYMLINK_REJECTED',
  'ADVISORY_FILE_UNDECLARED',
  'ADVISORY_FILE_TYPE_REJECTED',
  'ADVISORY_HASH_MISMATCH',
  'ADVISORY_LICENSE_REJECTED',
  'ADVISORY_DUPLICATE_ID',
  'ADVISORY_DUPLICATE_METHOD_KEY',
  'ADVISORY_CAPABILITY_REJECTED',
  'ADVISORY_PROJECTION_INVALID',
] as const

export type AdvisorySkillErrorCode = (typeof ADVISORY_SKILL_ERROR_CODES)[number]

export class AdvisorySkillError extends Error {
  readonly code: AdvisorySkillErrorCode

  constructor(code: AdvisorySkillErrorCode, message: string) {
    super(message)
    this.name = 'AdvisorySkillError'
    this.code = code
  }
}
