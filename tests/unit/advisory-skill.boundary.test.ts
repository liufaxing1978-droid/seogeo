import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdvisorySkillRegistry } from '../../src/modules/advisory-skills/advisory-skill.registry.js'

async function walkFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name)
      return entry.isDirectory() ? walkFiles(fullPath) : [fullPath]
    }),
  )
  return files.flat().sort()
}

const advisorySourceDir = path.resolve('src/modules/advisory-skills')
const vendorRoot = path.resolve('vendor/third-party-skills')

describe('P9-0H advisory safety boundaries', () => {
  it('has no forbidden runtime execution, network, persistence, queue, MCP, or env-root imports', async () => {
    const sourceFiles = (await walkFiles(advisorySourceDir)).filter((file) => file.endsWith('.ts'))
    const source = (
      await Promise.all(sourceFiles.map(async (file) => `${file}\n${await readFile(file, 'utf8')}`))
    ).join('\n')

    const forbidden = [
      /node:child_process/u,
      /from ['"]child_process['"]/u,
      /\beval\s*\(/u,
      /\bnew Function\s*\(/u,
      /\bfetch\s*\(/u,
      /from ['"](?:axios|undici)['"]/u,
      /from ['"]bullmq['"]/u,
      /from ['"]ioredis['"]/u,
      /@prisma\/client/u,
      /\bprisma\./u,
      /\bprocess\.env\b/u,
      /from ['"][^'"]*(?:mcp|plugin)[^'"]*['"]/iu,
    ]

    for (const pattern of forbidden) {
      expect(source, `forbidden advisory runtime pattern: ${pattern}`).not.toMatch(pattern)
    }
  })

  it('exposes bounded projections and provenance but no raw upstream body or executable handle', async () => {
    const registry = await createAdvisorySkillRegistry({ rootDir: vendorRoot })
    const method = registry.getByMethodKeys(['SEO_AUDIT'])[0]

    expect(method).toBeDefined()
    expect(method.authority).toBe('ADVISORY_ONLY')
    expect(method.projection.methodKey).toBe('SEO_AUDIT')
    expect(method.provenance.upstreamCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(Object.keys(method).sort()).toEqual(['authority', 'capabilities', 'methodKey', 'projection', 'provenance', 'skillId'].sort())
    expect(JSON.stringify(method)).not.toContain('RAW_UPSTREAM_SENTINEL')
    expect(JSON.stringify(method)).not.toContain('child_process')
    expect(JSON.stringify(method)).not.toContain('npx skills add')
  })

  it('does not let environment variables redirect an explicit vendor root', async () => {
    const original = process.env.ADVISORY_SKILL_ROOT
    process.env.ADVISORY_SKILL_ROOT = path.resolve('definitely-not-the-advisory-root')
    try {
      const registry = await createAdvisorySkillRegistry({ rootDir: vendorRoot })
      expect(registry.listAll()).toHaveLength(13)
    } finally {
      if (original === undefined) delete process.env.ADVISORY_SKILL_ROOT
      else process.env.ADVISORY_SKILL_ROOT = original
    }
  })

  it('keeps the real vendor tree data-only', async () => {
    const files = await walkFiles(vendorRoot)
    expect(files.length).toBeGreaterThan(0)

    const executableExtensions = new Set([
      '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.exe', '.dll', '.so', '.dylib',
      '.py', '.pyc', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.wasm', '.jar',
    ])

    for (const file of files) {
      expect(executableExtensions.has(path.extname(file).toLowerCase()), file).toBe(false)
    }
  })

  it('keeps P7 scoring and P8 risk/approval/mutation/verification modules independent', async () => {
    const srcFiles = (await walkFiles(path.resolve('src'))).filter((file) => file.endsWith('.ts'))
    const protectedFiles = srcFiles.filter((file) => {
      if (file.includes(`${path.sep}advisory-skills${path.sep}`)) return false
      return /(score|risk|approval|mutation|verification)/iu.test(path.basename(file))
    })

    for (const file of protectedFiles) {
      const source = await readFile(file, 'utf8')
      expect(source, file).not.toMatch(/advisory-skills/u)
    }
  })
})
