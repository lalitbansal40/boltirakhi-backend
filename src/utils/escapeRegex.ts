/**
 * Escapes regex metacharacters in user-supplied search text.
 *
 * Without this a search for "5.5" matches far too much, "(" throws, and a
 * pattern like "(a+)+" can pin a CPU. Search boxes are user input.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" matcher for a search box. */
export function containsRegex(input: string): RegExp {
  return new RegExp(escapeRegex(input.trim()), 'i');
}
