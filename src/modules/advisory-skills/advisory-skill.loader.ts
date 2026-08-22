import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  advisoryMethodProjectionSchema,
  advisoryRegistrySchema,
  advisorySourceManifestSchema,
} from './advisory-skill.schemas.js'
import { AdvisorySkillError } from './advisory-skill.policy.js'
import type {
  AdvisoryMethodProjectionV1,
  AdvisorySourceManifestV1,
} from './advisory-skill.types.js'

export interface LoadedAdvisorySource {
  manifest: AdvisorySourceManifestV1
  methods: Array<{
    skill: AdvisorySourceManifestV1['skills'][number]
    projection: AdvisoryMethodProjectionV1
  }>
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isInside(baseDir: string, target: string): boolean {
  return target === baseDir || target.startsWith(`${baseDir}${path.sep}`)
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new AdvisorySkillError('ADVISORY_PATH_ESCAPE', `Unsafe advisory path: ${relativePath}`)
  }

  const segments = relativePath.split(/[\\/]/u)
  if (segments.some((segment) => segment === '' || segment === '..')) {
    throw new AdvisorySkillError('ADVISORY_PATH_ESCAPE', `Unsafe advisory path: ${relativePath}`)
  }
}

function assertAllowedDataPath(relativePath: string, legal = false): void {
  assertSafeRelativePath(relativePath)
  const basename = path.basename(relativePath)
  const extension = path.extname(relativePath).toLowerCase()

  if (legal && (basename === 'LICENSE' || basename === 'NOTICE')) {
    return
  }

  if (!['.md', '.json', '.txt'].includes(extension)) {
    throw new AdvisorySkillError(
      'ADVISORY_FILE_TYPE_REJECTED',
      `Unsupported advisory file type: ${relativePath}`,
    )
  }
}

async function readRegularFileInside(
  baseDir: string,
  relativePath: string,
  options: { legal?: boolean; missingCode?: 'ADVISORY_MANIFEST_INVALID' | 'ADVISORY_REGISTRY_INVALID' } = {},
): Promise<Buffer> {
  assertSafeRelativePath(relativePath)
  assertAllowedDataPath(relativePath, options.legal)

  const resolvedBase = path.resolve(baseDir)
  const resolvedTarget = path.resolve(resolvedBase, relativePath)
  if (!isInside(resolvedBase, resolvedTarget)) {
    throw new AdvisorySkillError('ADVISORY_PATH_ESCAPE', `Advisory path escapes root: ${relativePath}`)
  }

  let stat
  try {
    stat = await lstat(resolvedTarget)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new AdvisorySkillError(
        options.missingCode ?? 'ADVISORY_MANIFEST_INVALID',
        `Declared advisory file is missing: ${relativePath}`,
      )
    }
    throw error
  }

  if (stat.isSymbolicLink()) {
    throw new AdvisorySkillError('ADVISORY_SYMLINK_REJECTED', `Symlink rejected: ${relativePath}`)
  }
  if (!stat.isFile()) {
    throw new AdvisorySkillError(
      options.missingCode ?? 'ADVISORY_MANIFEST_INVALID',
      `Declared advisory path is not a regular file: ${relativePath}`,
    )
  }

  const realBase = await realpath(resolvedBase)
  const realTarget = await realpath(resolvedTarget)
  if (!isInside(realBase, realTarget)) {
    throw new AdvisorySkillError('ADVISORY_PATH_ESCAPE', `Advisory path resolves outside root: ${relativePath}`)
  }

  return readFile(realTarget)
}

async function assertNoSymlinks(rootDir: string): Promise<void> {
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) {
        throw new AdvisorySkillError(
          'ADVISORY_SYMLINK_REJECTED',
          `Symlink rejected inside advisory root: ${path.relative(rootDir, absolute)}`,
        )
      }
      if (stat.isDirectory()) {
        await walk(absolute)
      }
    }
  }

  await walk(rootDir)
}

async function collectRelativeFiles(rootDir: string): Promise<string[]> {
  const result: string[] = []

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) {
        throw new AdvisorySkillError(
          'ADVISORY_SYMLINK_REJECTED',
          `Symlink rejected inside advisory root: ${path.relative(rootDir, absolute)}`,
        )
      }
      if (stat.isDirectory()) {
        await walk(absolute)
      } else if (stat.isFile()) {
        result.push(path.relative(rootDir, absolute).split(path.sep).join('/'))
      }
    }
  }

  await walk(rootDir)
  return result.sort()
}

async function assertSourceFileCensus(sourceDir: string, declared: Set<string>): Promise<void> {
  const files = await collectRelativeFiles(sourceDir)
  for (const file of files) {
    if (!declared.has(file)) {
      throw new AdvisorySkillError('ADVISORY_FILE_UNDECLARED', `Undeclared advisory file: ${file}`)
    }
  }

  for (const declaredFile of declared) {
    if (!files.includes(declaredFile)) {
      throw new AdvisorySkillError(
        'ADVISORY_MANIFEST_INVALID',
        `Declared advisory file is missing: ${declaredFile}`,
      )
    }
  }
}

async function assertRootCensus(rootDir: string, declaredSourceDirs: Set<string>): Promise<void> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'registry.json' && entry.isFile()) {
      continue
    }
    if (entry.isDirectory() && declaredSourceDirs.has(entry.name)) {
      continue
    }
    throw new AdvisorySkillError(
      'ADVISORY_FILE_UNDECLARED',
      `Unexpected advisory root entry: ${entry.name}`,
    )
  }
}

function parseJson(bytes: Buffer, code: 'ADVISORY_REGISTRY_INVALID' | 'ADVISORY_MANIFEST_INVALID' | 'ADVISORY_PROJECTION_INVALID'): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new AdvisorySkillError(code, 'Invalid advisory JSON')
  }
}

function assertHash(bytes: Buffer, expected: string, label: string): void {
  if (hashBytes(bytes) !== expected) {
    throw new AdvisorySkillError('ADVISORY_HASH_MISMATCH', `Advisory hash mismatch: ${label}`)
  }
}

export async function loadAdvisorySources(rootDir: string): Promise<LoadedAdvisorySource[]> {
  const resolvedRoot = path.resolve(rootDir)

  await assertNoSymlinks(resolvedRoot)

  const registryBytes = await readRegularFileInside(resolvedRoot, 'registry.json', {
    missingCode: 'ADVISORY_REGISTRY_INVALID',
  })
  const registryParsed = advisoryRegistrySchema.safeParse(
    parseJson(registryBytes, 'ADVISORY_REGISTRY_INVALID'),
  )
  if (!registryParsed.success) {
    throw new AdvisorySkillError('ADVISORY_REGISTRY_INVALID', 'Invalid advisory registry')
  }
  const registry = registryParsed.data

  const sourceIds = new Set<string>()
  for (const source of registry.sources) {
    if (sourceIds.has(source.sourceId)) {
      throw new AdvisorySkillError('ADVISORY_DUPLICATE_ID', `Duplicate advisory source: ${source.sourceId}`)
    }
    sourceIds.add(source.sourceId)
  }

  const declaredSourceDirs = new Set<string>()
  for (const source of registry.sources) {
    assertSafeRelativePath(source.manifestPath)
    const segments = source.manifestPath.split(/[\\/]/u)
    if (segments.length < 2) {
      throw new AdvisorySkillError('ADVISORY_PATH_ESCAPE', `Manifest must be inside a source directory: ${source.manifestPath}`)
    }
    declaredSourceDirs.add(segments[0]!)
  }

  await assertRootCensus(resolvedRoot, declaredSourceDirs)

  const seenSkillIds = new Set<string>()
  const seenMethodKeys = new Set<string>()
  const loadedSources: LoadedAdvisorySource[] = []

  for (const source of registry.sources) {
    const manifestBytes = await readRegularFileInside(resolvedRoot, source.manifestPath, {
      missingCode: 'ADVISORY_MANIFEST_INVALID',
    })
    assertHash(manifestBytes, source.manifestSha256, source.manifestPath)

    const manifestParsed = advisorySourceManifestSchema.safeParse(
      parseJson(manifestBytes, 'ADVISORY_MANIFEST_INVALID'),
    )
    if (!manifestParsed.success) {
      throw new AdvisorySkillError('ADVISORY_MANIFEST_INVALID', `Invalid advisory manifest: ${source.sourceId}`)
    }
    const manifest = manifestParsed.data

    if (manifest.sourceId !== source.sourceId) {
      throw new AdvisorySkillError(
        'ADVISORY_MANIFEST_INVALID',
        `Registry/manifest source ID mismatch: ${source.sourceId}`,
      )
    }

    for (const skill of manifest.skills) {
      if (seenSkillIds.has(skill.skillId)) {
        throw new AdvisorySkillError('ADVISORY_DUPLICATE_ID', `Duplicate advisory skill ID: ${skill.skillId}`)
      }
      if (seenMethodKeys.has(skill.methodKey)) {
        throw new AdvisorySkillError(
          'ADVISORY_DUPLICATE_METHOD_KEY',
          `Duplicate advisory method key: ${skill.methodKey}`,
        )
      }
      seenSkillIds.add(skill.skillId)
      seenMethodKeys.add(skill.methodKey)
    }

    const sourceDirRelative = path.dirname(source.manifestPath).split(path.sep).join('/')
    assertSafeRelativePath(sourceDirRelative)
    const sourceDir = path.resolve(resolvedRoot, sourceDirRelative)
    if (!isInside(resolvedRoot, sourceDir)) {
      throw new AdvisorySkillError('ADVISORY_PATH_ESCAPE', `Source directory escapes root: ${sourceDirRelative}`)
    }

    const licenseBytes = await readRegularFileInside(sourceDir, manifest.licenseFile.path, {
      legal: true,
      missingCode: 'ADVISORY_MANIFEST_INVALID',
    })
    assertHash(licenseBytes, manifest.licenseFile.sha256, manifest.licenseFile.path)

    if (manifest.noticeFile) {
      const noticeBytes = await readRegularFileInside(sourceDir, manifest.noticeFile.path, {
        legal: true,
        missingCode: 'ADVISORY_MANIFEST_INVALID',
      })
      assertHash(noticeBytes, manifest.noticeFile.sha256, manifest.noticeFile.path)
    }

    const methods: LoadedAdvisorySource['methods'] = []
    const declaredFiles = new Set<string>(['manifest.json', manifest.licenseFile.path])
    if (manifest.noticeFile) declaredFiles.add(manifest.noticeFile.path)

    for (const skill of manifest.skills) {
      const upstreamByPath = new Map<string, string>()
      for (const upstreamFile of skill.upstreamFiles) {
        assertAllowedDataPath(upstreamFile.path)
        const upstreamBytes = await readRegularFileInside(sourceDir, upstreamFile.path, {
          missingCode: 'ADVISORY_MANIFEST_INVALID',
        })
        assertHash(upstreamBytes, upstreamFile.sha256, upstreamFile.path)
        upstreamByPath.set(upstreamFile.path, upstreamFile.sha256)
        declaredFiles.add(upstreamFile.path)
      }

      if (!upstreamByPath.has(skill.upstreamEntrypoint)) {
        throw new AdvisorySkillError(
          'ADVISORY_MANIFEST_INVALID',
          `Entrypoint is not a declared upstream file: ${skill.upstreamEntrypoint}`,
        )
      }

      assertAllowedDataPath(skill.projectionPath)
      const projectionBytes = await readRegularFileInside(sourceDir, skill.projectionPath, {
        missingCode: 'ADVISORY_MANIFEST_INVALID',
      })
      assertHash(projectionBytes, skill.projectionSha256, skill.projectionPath)
      declaredFiles.add(skill.projectionPath)

      const projectionParsed = advisoryMethodProjectionSchema.safeParse(
        parseJson(projectionBytes, 'ADVISORY_PROJECTION_INVALID'),
      )
      if (!projectionParsed.success) {
        throw new AdvisorySkillError(
          'ADVISORY_PROJECTION_INVALID',
          `Invalid advisory projection: ${skill.projectionPath}`,
        )
      }
      const projection = projectionParsed.data

      if (projection.skillId !== skill.skillId || projection.methodKey !== skill.methodKey) {
        throw new AdvisorySkillError(
          'ADVISORY_PROJECTION_INVALID',
          `Projection identity mismatch: ${skill.projectionPath}`,
        )
      }

      for (const sourceRef of projection.sourceRefs) {
        if (upstreamByPath.get(sourceRef.upstreamPath) !== sourceRef.upstreamSha256) {
          throw new AdvisorySkillError(
            'ADVISORY_PROJECTION_INVALID',
            `Projection sourceRef is not declared by the skill: ${sourceRef.upstreamPath}`,
          )
        }
      }

      methods.push({ skill, projection })
    }

    await assertSourceFileCensus(sourceDir, declaredFiles)
    loadedSources.push({ manifest, methods })
  }

  return loadedSources
}
