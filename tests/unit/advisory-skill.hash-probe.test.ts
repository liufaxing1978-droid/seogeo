import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('P9-0H temporary staging probe', () => {
  it('decodes staged base64 and prints exact hashes', async () => {
    const base64Path = 'vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/site-architecture/SKILL.md.b64'
    const encoded = (await readFile(base64Path, 'utf8')).replace(/\s+/gu, '')
    const decoded = Buffer.from(encoded, 'base64')
    console.log('P9_0H_SITE_ARCH_BLOB_BASE64=' + decoded.toString('base64'))
    console.log('P9_0H_SITE_ARCH_SHA256=' + createHash('sha256').update(decoded).digest('hex'))
    expect(decoded.length).toBeGreaterThan(0)
  })
})
