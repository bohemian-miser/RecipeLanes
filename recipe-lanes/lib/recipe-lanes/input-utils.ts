/**
 * Pure helpers for validating recipe text input on the client.
 */

/**
 * Returns true when the trimmed input looks like nothing but a URL — i.e. the
 * user pasted a link to a recipe instead of the recipe text itself.
 *
 * We only flag inputs that are essentially a single bare URL so we don't warn
 * on real recipes that happen to mention a link somewhere in the body.
 */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  // A single token (no internal whitespace) starting with http(s):// or www.
  if (/\s/.test(trimmed)) return false;
  return /^(https?:\/\/|www\.)\S+$/i.test(trimmed);
}
