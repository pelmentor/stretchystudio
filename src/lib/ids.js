// @ts-check

/**
 * v3 Phase 0G - Shared ID generators (Pillar P).
 *
 * Replaces the five duplicate `function uid() { return
 * Math.random().toString(36).slice(2, 9); }` definitions scattered
 * across the codebase. Two problems with the old approach:
 *
 *   1. **Entropy.** ~36 bits of randomness collides at ~65 K IDs by
 *      birthday bound. A user with a few hundred parts × a few
 *      animations × a few keyframes can hit it.  We've already seen
 *      one bug in the wild that's compatible with an ID collision.
 *   2. **Predictability.** `Math.random()` is not cryptographic, so
 *      IDs are guessable and not safe for any future sharing path.
 *
 * Browsers since 2022 ship `crypto.randomUUID()` (HTTPS / localhost
 * only).  We strip the dashes for URL-friendliness and slice to a
 * manageable length - 12 chars of hex = ~48 bits, comfortable for
 * project-scope IDs and still short enough to be readable.
 *
 * Use `uid()` for node / keyframe / track / project record IDs.
 * Use `uidLong()` (full 32-char hex) when you want maximum entropy
 * - currently nothing in the app needs it but the helper is here
 * for future cryptographic uses.
 *
 * @module lib/ids
 */

/**
 * 12-character hex ID. ~48 bits of entropy → birthday collision at
 * ~17 M IDs, safe for app-scope object IDs.
 * @returns {string}
 */
export function uid() {
  return uidLong().slice(0, 12);
}

/** Full 32-char hex ID (no dashes). ~128 bits of entropy. */
export function uidLong() {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  // Last-resort fallback for environments that ship neither (rare —
  // node ≥ 19, all modern browsers, jsdom all support crypto). Better
  // than nothing but not collision-free at scale.
  return (
    Date.now().toString(16).padStart(12, '0') +
    Math.random().toString(16).slice(2, 22).padEnd(20, '0')
  );
}
