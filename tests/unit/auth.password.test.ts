import { describe, expect, it } from 'vitest';
import { passwordHasher } from '../../src/auth/password.js';

describe('passwordHasher', () => {
  it('creates the bounded P10-A scrypt format and verifies the correct password', async () => {
    const encoded = await passwordHasher.hash('correct horse battery staple');

    expect(encoded).toMatch(/^scrypt\$1\$32768\$8\$1\$/);
    expect(await passwordHasher.verify('correct horse battery staple', encoded)).toBe(true);
    expect(await passwordHasher.verify('wrong', encoded)).toBe(false);
  });

  it('fails closed for malformed stored hashes', async () => {
    expect(await passwordHasher.verify('x', 'broken')).toBe(false);
  });
});
