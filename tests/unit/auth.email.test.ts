import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/auth/email.js';

describe('normalizeEmail', () => {
  it('trims and lowercases the complete email string', () => {
    expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
  });

  it('does not rewrite provider-specific plus addressing', () => {
    expect(normalizeEmail('a+b@example.com')).toBe('a+b@example.com');
  });
});
