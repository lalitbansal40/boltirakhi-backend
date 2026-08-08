import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { OtpSession, MAX_OTP_ATTEMPTS } from '../../models/OtpSession';
import { User, type IUser } from '../../models/User';
import { notify } from '../../services/notify';
import { toGatewayNumber } from '../../services/notify/sms';
import { signToken } from '../../utils/jwt';
import { ApiError } from '../../utils/ApiError';

/**
 * Login by one-time code.
 *
 * The first login is also the signup — there is no separate registration form.
 * Someone who can receive a code on a number has proved as much about that
 * number as any password would, and one screen loses far fewer people than two.
 *
 * The code itself never leaves this file in readable form: it is hashed before
 * it is stored and sent straight to the gateway. It is never returned in a
 * response and never written to our own logs.
 */

/** Long enough to find a phone that is in another room, short enough to matter. */
const OTP_TTL_MINUTES = 10;

/** Between two requests for the same number. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Per number, per hour. SMS costs money and this is the ceiling on that cost. */
const MAX_OTP_PER_HOUR = 3;

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Six digits, from a cryptographic source.
 *
 * `Math.random()` is predictable enough that an attacker who sees a few codes
 * can work out the next one, which would defeat the entire mechanism.
 */
function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Every phone number is stored in exactly one shape: 91XXXXXXXXXX.
 *
 * `toGatewayNumber` is the only normaliser in the codebase, and this reuses it
 * rather than adding a second. Two normalisers that disagree would create the
 * same customer twice, each with half their orders.
 */
function normalisePhone(raw: string): string {
  const phone = toGatewayNumber(raw);

  if (!phone) {
    throw new ApiError(400, 'Enter a valid Indian mobile number', 'INVALID_PHONE');
  }

  return phone;
}

export async function requestOtp(rawPhone: string): Promise<{ expiresInSeconds: number }> {
  const phone = normalisePhone(rawPhone);

  const now = Date.now();

  // Cooldown: the most recent request for this number, whatever its state.
  const latest = await OtpSession.findOne({ phone }).sort({ createdAt: -1 });

  if (latest) {
    const sinceLast = (now - latest.createdAt.getTime()) / 1000;

    if (sinceLast < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast);
      throw new ApiError(
        429,
        `Please wait ${wait} seconds before asking for another code`,
        'OTP_COOLDOWN',
        { retryAfterSeconds: wait },
      );
    }
  }

  /**
   * Per-number hourly cap.
   *
   * The IP limiter in front of this route stops one machine hammering the
   * endpoint, but an attacker with a pool of addresses gets past it — and
   * every SMS to a single victim's number costs us the same either way.
   */
  const recentCount = await OtpSession.countDocuments({
    phone,
    createdAt: { $gte: new Date(now - ONE_HOUR_MS) },
  });

  if (recentCount >= MAX_OTP_PER_HOUR) {
    throw new ApiError(
      429,
      'Too many codes requested. Please try again in an hour.',
      'OTP_RATE_LIMITED',
    );
  }

  const code = generateCode();
  const otpHash = await bcrypt.hash(code, 10);

  /**
   * Older sessions for this number are dropped rather than left to expire.
   *
   * Two live codes at once means a code the customer has already abandoned
   * still opens the account, and it doubles the guessing surface for free.
   */
  await OtpSession.deleteMany({ phone });

  await OtpSession.create({
    phone,
    channel: 'sms',
    otpHash,
    expiresAt: new Date(now + OTP_TTL_MINUTES * 60 * 1000),
    attempts: 0,
  });

  // notify() never throws, so a gateway outage cannot take the request down —
  // but it also means the result has to be checked rather than assumed.
  const result = await notify('sms', {
    to: phone,
    // The brand is added by the SMS sender, which must lead the message for it
    // to be delivered at all — so it is deliberately not repeated here.
    message: `${code} is your verification code. It is valid for ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.`,
  });

  if (!result.ok) {
    // The session is removed so the customer is not left waiting on a cooldown
    // for a code that was never sent.
    await OtpSession.deleteMany({ phone });
    throw new ApiError(
      502,
      'We could not send the code just now. Please try again.',
      'OTP_SEND_FAILED',
    );
  }

  return { expiresInSeconds: OTP_TTL_MINUTES * 60 };
}

export async function verifyOtp(
  rawPhone: string,
  code: string,
): Promise<{ user: IUser; token: string }> {
  const phone = normalisePhone(rawPhone);

  const session = await OtpSession.findOne({ phone }).sort({ createdAt: -1 });

  /**
   * One message for "no code was requested", "the code expired" and "the code
   * is wrong".
   *
   * Distinguishing them tells an attacker which numbers have accounts and
   * which of their guesses got closer, and tells an honest customer nothing
   * they can act on beyond "ask for a new one".
   */
  const rejected = () =>
    new ApiError(400, 'That code is not valid. Please request a new one.', 'OTP_INVALID');

  if (!session || session.verifiedAt) throw rejected();

  // The TTL index only sweeps up; expiry is enforced here, where it matters.
  if (session.expiresAt.getTime() < Date.now()) {
    await OtpSession.deleteMany({ phone });
    throw rejected();
  }

  if (session.attempts >= MAX_OTP_ATTEMPTS) {
    await OtpSession.deleteMany({ phone });
    throw rejected();
  }

  // bcrypt.compare is constant-time. A plain === on the hash would leak how
  // much of a guess matched through how long the comparison took.
  const matches = await bcrypt.compare(code, session.otpHash);

  if (!matches) {
    session.attempts += 1;
    await session.save();

    if (session.attempts >= MAX_OTP_ATTEMPTS) {
      await OtpSession.deleteMany({ phone });
    }

    throw rejected();
  }

  // Consumed. Every session for this number goes, so the code cannot be
  // replayed even in the moment before the TTL sweeps it.
  await OtpSession.deleteMany({ phone });

  /**
   * Find or create.
   *
   * `role` is hard-coded rather than taken from anywhere: nothing a caller
   * sends should ever be able to mint an admin.
   */
  let user = await User.findOne({ phone });

  if (!user) {
    user = await User.create({ phone, role: 'customer' });
  }

  if (user.isBlocked) {
    throw new ApiError(403, 'This account has been blocked', 'USER_BLOCKED');
  }

  const token = signToken({ sub: String(user._id), role: 'customer' });

  return { user, token };
}
