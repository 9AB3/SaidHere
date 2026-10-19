import crypto from 'node:crypto';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function normalizeAdminUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validateAdminPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }
  if (password.length > 200) {
    throw new Error('Password must be 200 characters or fewer.');
  }
}

export function hashAdminPassword(password) {
  validateAdminPassword(password);
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyAdminPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    if (expected.length !== KEY_LENGTH) return false;
    const actual = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}
