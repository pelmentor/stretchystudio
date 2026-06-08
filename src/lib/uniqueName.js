// @ts-check

/**
 * Blender-style name disambiguation — `name`, `name.001`, `name.002`, ...
 *
 * Mirrors `BLI_uniquename` in the Blender source: when a candidate name is
 * already taken, return the candidate suffixed with the lowest unused
 * `.NNN` (zero-padded to 3 digits, starting at .001). Same convention
 * Blender uses for datablocks (objects, actions, materials, ...).
 *
 * Used by the idle motion generator dialog so two generated motions never
 * share an action name — which would silently collide on the exported
 * `.motion3.json` filename (the exporter derives it from `action.name`).
 *
 * @param {string} candidate    - desired name
 * @param {Set<string> | ReadonlyArray<string>} existing - taken names
 * @returns {string} `candidate` if free, else `candidate.NNN`
 */
export function uniqueName(candidate, existing) {
  const set = existing instanceof Set ? existing : new Set(existing);
  if (!set.has(candidate)) return candidate;
  for (let n = 1; n < 1000; n++) {
    const suffixed = `${candidate}.${String(n).padStart(3, '0')}`;
    if (!set.has(suffixed)) return suffixed;
  }
  // 999 collisions is pathological — never expected in practice (you'd
  // need 999 actions all named `Idle (calm)`). Throw rather than fall
  // back to a timestamp, per RULE №1: silent fallbacks mask bugs. A loud
  // throw forces the caller to investigate why the collision space is
  // saturated.
  throw new Error(`uniqueName: 999 collisions for "${candidate}" — name space saturated`);
}
