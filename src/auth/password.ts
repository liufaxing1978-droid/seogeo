import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const FORMAT = 'scrypt';
const VERSION = 1;
const N = 32768;
const R = 8;
const P = 1;
const SALT_BYTES = 32;
const KEY_BYTES = 64;
const MAXMEM = 64 * 1024 * 1024;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, { N: n, r, p, maxmem: MAXMEM }, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export const passwordHasher: PasswordHasher = {
  async hash(password) {
    const salt = randomBytes(SALT_BYTES);
    const derivedKey = await deriveKey(password, salt, N, R, P);
    return [
      FORMAT,
      String(VERSION),
      String(N),
      String(R),
      String(P),
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$');
  },

  async verify(password, encoded) {
    try {
      const parts = encoded.split('$');
      if (parts.length !== 7) return false;

      const [algorithm, versionRaw, nRaw, rRaw, pRaw, saltRaw, derivedKeyRaw] = parts;
      if (algorithm !== FORMAT || versionRaw !== String(VERSION)) return false;

      const n = Number(nRaw);
      const r = Number(rRaw);
      const p = Number(pRaw);
      if (n !== N || r !== R || p !== P) return false;

      const salt = Buffer.from(saltRaw, 'base64url');
      const expected = Buffer.from(derivedKeyRaw, 'base64url');
      if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;

      const actual = await deriveKey(password, salt, n, r, p);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  },
};
