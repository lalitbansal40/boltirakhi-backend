import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export type TokenRole = 'customer' | 'admin';

export interface TokenPayload {
  sub: string;
  role: TokenRole;
}

/**
 * The payload carries only the user id and role. Name, email and the like would
 * be a copy of data the client cannot refresh — it goes stale the moment the
 * record changes, and every consumer would be reading the old value.
 */
export function signToken(payload: TokenPayload): string {
  const options: SignOptions = {
    // @types/jsonwebtoken v9 types expiresIn as `number | StringValue`, not
    // `string`, so the env value needs the cast to typecheck.
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };

  return jwt.sign({ sub: payload.sub, role: payload.role }, env.JWT_SECRET, options);
}

/**
 * Throws `JsonWebTokenError` / `TokenExpiredError` on failure. Left unwrapped
 * on purpose — the error handler already maps both to 401.
 */
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);

  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.sub !== 'string') {
    throw new jwt.JsonWebTokenError('Malformed token payload');
  }

  return { sub: decoded.sub, role: (decoded as { role: TokenRole }).role };
}

/** Reads `Authorization: Bearer <token>`; null when the header is absent or malformed. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token.trim() || null;
}
