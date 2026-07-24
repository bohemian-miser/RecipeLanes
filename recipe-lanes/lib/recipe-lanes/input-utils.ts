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

/** Minimal shape of a keyboard event we need to decide submission. */
export interface SubmitKeyEvent {
  key?: string;
  keyCode?: number;
  shiftKey?: boolean;
  /** True while an IME composition session is active (native event field). */
  isComposing?: boolean;
}

/**
 * Returns true when a keydown in the single-line "Adjust recipe" box should
 * submit the adjustment (issue #110 — Enter did nothing on mobile).
 *
 * The old check was `e.key === 'Enter'`, which fails on mobile soft keyboards:
 * Android GBoard fires keydown during IME composition with `keyCode === 229`
 * and `key === 'Unidentified'`, and some mobile keyboards only surface the
 * action key through the legacy `keyCode === 13`. We therefore:
 *  - accept Enter reported via `key` OR the legacy `keyCode === 13`,
 *  - never submit mid-composition (`isComposing` or the `229` sentinel), and
 *  - ignore Shift+Enter so it can stay free for a newline affordance later.
 */
export function isAdjustSubmitKey(e: SubmitKeyEvent): boolean {
  if (e.shiftKey) return false;
  if (e.isComposing) return false;
  if (e.keyCode === 229) return false; // IME composition sentinel
  return e.key === 'Enter' || e.keyCode === 13;
}
