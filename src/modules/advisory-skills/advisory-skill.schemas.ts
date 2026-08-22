import { z } from 'zod'
import {
  ADVISORY_CAPABILITY_VALUES,
  ADVISORY_LICENSE_VALUES,
  ADVISORY_METHOD_KEYS,
} from './advisory-skill.types.js'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/)
const nonEmptyString = z.string().min(1)
const nonEmptyStringArray = z.array(nonEmptyString).min(1)

export const advisoryCapabilitySchema = z.enum(ADVISORY_CAPABILITY_VALUES)
export const advisoryMethodKeySchema = z.enum(ADVISORY_METHOD_KEYS)
export const advisoryLicenseSchema = z.enum(ADVISORY_LICENSE_VALUES)

export const hashedLegalFileSchema = z
  .object({
    path: nonEmptyString,
    sha256: sha256Schema,
  })
  .strict()

export const advisoryRegistrySchema = z
  .object({
    version: z.literal('THIRD_PARTY_ADVISORY_REGISTRY_V1'),
    sources: z
      .array(
        z
          .object({
            sourceId: nonEmptyString,
            manifestPath: nonEmptyString,
            manifestSha256: sha256Schema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

const upstreamFileSchema = z
  .object({
    path: nonEmptyString,
    sha256: sha256Schema,
    mediaType: z.enum(['text/markdown', 'application/json', 'text/plain']),
  })
  .strict()

const advisorySkillManifestEntrySchema = z
  .object({
    skillId: nonEmptyString,
    methodKey: advisoryMethodKeySchema,
    upstreamEntrypoint: nonEmptyString,
    capabilities: z.array(advisoryCapabilitySchema).min(1),
    upstreamFiles: z.array(upstreamFileSchema).min(1),
    projectionPath: nonEmptyString,
    projectionSha256: sha256Schema,
  })
  .strict()

export const advisorySourceManifestSchema = z
  .object({
    manifestVersion: z.literal('ADVISORY_SOURCE_MANIFEST_V1'),
    sourceId: nonEmptyString,
    sourceRepo: nonEmptyString,
    upstreamCommit: commitShaSchema,
    licenseSpdx: advisoryLicenseSchema,
    licenseFile: hashedLegalFileSchema,
    noticeFile: hashedLegalFileSchema.optional(),
    localVersion: nonEmptyString,
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    skills: z.array(advisorySkillManifestEntrySchema).min(1),
  })
  .strict()

const advisorySourceRefSchema = z
  .object({
    upstreamPath: nonEmptyString,
    upstreamSha256: sha256Schema,
  })
  .strict()

export const advisoryMethodProjectionSchema = z
  .object({
    projectionVersion: z.literal('ADVISORY_METHOD_PROJECTION_V1'),
    skillId: nonEmptyString,
    methodKey: advisoryMethodKeySchema,
    title: nonEmptyString,
    purpose: nonEmptyString,
    whenToUse: nonEmptyStringArray,
    requiredInputs: nonEmptyStringArray,
    steps: nonEmptyStringArray,
    checks: nonEmptyStringArray,
    outputs: nonEmptyStringArray,
    evidenceRules: nonEmptyStringArray,
    forbiddenInferences: nonEmptyStringArray,
    sourceRefs: z.array(advisorySourceRefSchema).min(1),
  })
  .strict()
