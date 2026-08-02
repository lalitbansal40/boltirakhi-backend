import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * bcrypt only reads the first 72 bytes. Anything past that is silently ignored,
 * which would mean a 100-character password and its 72-character prefix both
 * unlock the account — so schemas cap password length at this value rather than
 * letting the truncation happen quietly.
 */
export const MAX_PASSWORD_BYTES = 72;

export function hashPassword(plain: string): Promise<string> {
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }

  // 10 rounds: 12+ costs one to two seconds per login on a small Railway
  // instance, which is felt on every admin page load that re-authenticates.
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
