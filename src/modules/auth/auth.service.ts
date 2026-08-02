import { User, type IUser } from '../../models/User';
import { ApiError } from '../../utils';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signToken } from '../../utils/jwt';
import type { ChangePasswordInput, LoginInput } from './auth.schema';

/**
 * A bcrypt hash of a value nobody uses, compared against when the email does
 * not exist. Without it a missing account answers noticeably faster than a
 * wrong password, and the response time alone tells an attacker which emails
 * are registered.
 */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface SafeUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: IUser['role'];
  lastLoginAt?: Date;
}

function toSafeUser(user: IUser): SafeUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    lastLoginAt: user.lastLoginAt,
  };
}

export async function login(input: LoginInput): Promise<{ token: string; user: SafeUser }> {
  const email = input.email.toLowerCase().trim();
  const user = await User.findOne({ email }).select('+passwordHash');

  // Same message for "no such account", "no password set" and "wrong
  // password". Distinguishing them turns login into an account-enumeration
  // oracle for anyone with an email list.
  if (!user?.passwordHash) {
    await verifyPassword(input.password, DUMMY_HASH);
    throw ApiError.unauthorized('Invalid credentials');
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  if (user.isBlocked) {
    throw new ApiError(403, 'This account has been blocked', 'USER_BLOCKED');
  }

  // This endpoint is the admin panel's. A customer's credentials are valid but
  // do not belong here.
  if (user.role !== 'admin') {
    throw ApiError.forbidden('This account cannot access the admin panel');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken({ sub: String(user._id), role: user.role });

  return { token, user: toSafeUser(user) };
}

export async function getMe(userId: string): Promise<SafeUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  return toSafeUser(user);
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');

  if (!user?.passwordHash) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  user.passwordHash = await hashPassword(input.newPassword);
  // requireAuth rejects tokens issued before this instant, which is what makes
  // a password change end existing sessions.
  user.passwordChangedAt = new Date();
  await user.save();
}
