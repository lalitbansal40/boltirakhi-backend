/**
 * The storefront session cookie's name, in one place.
 *
 * Both the middleware that reads it and the controller that sets and clears it
 * need this string. A cookie cleared under a different name than it was set
 * with is not cleared at all — the user stays signed in and nothing reports an
 * error — so the two must never be able to drift apart.
 */
export const SESSION_COOKIE = 'br_session';
