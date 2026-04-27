// Canonicalize export outputs to remove known sources of non-determinism
// before structural comparison.
//
// See docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md ("The diff harness")
// for the rationale. Two consecutive exports of the same .stretch differ at:
//   - crypto.randomUUID() in xmlbuilder.js (one fresh UUID per deformer/mesh/param)
//   - new Date().toISOString() in cmo3writer.js (export wall-clock)
//   - Date.now() in idle/builder.js (motion ID suffix)
//
// We canonicalize rather than making export deterministic because Cubism
// Editor compares some UUIDs by value (well-known ones like the ROOT_GROUP
// guid `e9fe6eff-953b-4ce2-be7c-4a7c3913686b`) and replacing random UUIDs
// with content-hashed ones risks breaking those checks.

const UUID_RE =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

const ISO_TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

const MOTION_ID_TS_RE = /(__motion_[A-Za-z0-9]+)_\d{10,}/g;

/**
 * Replace every UUID with a structural alias (`uuid_0001`, `uuid_0002`, …)
 * assigned in first-occurrence order. Two texts with the same UUID structure
 * (same shape, same internal references) produce identical output even if
 * the underlying randomUUID() draws differed.
 *
 * @param {string} text
 * @returns {{ canonical: string, remap: Map<string, string> }}
 */
export function canonicalizeUuids(text) {
  const remap = new Map();
  const canonical = text.replace(UUID_RE, (uuid) => {
    let alias = remap.get(uuid);
    if (alias === undefined) {
      alias = `uuid_${String(remap.size + 1).padStart(4, '0')}`;
      remap.set(uuid, alias);
    }
    return alias;
  });
  return { canonical, remap };
}

/**
 * Blank ISO 8601 timestamps and motion-ID timestamp suffixes. After this
 * pass, the only timestamps remaining are user-supplied ones (animation
 * keyframe times, etc.) that legitimately belong to the data.
 *
 * @param {string} text
 * @returns {string}
 */
export function canonicalizeTimestamps(text) {
  return text
    .replace(ISO_TIMESTAMP_RE, '<ISO_TIMESTAMP>')
    .replace(MOTION_ID_TS_RE, '$1_<TS>');
}

/**
 * Apply the full canonicalization pipeline. Order matters: timestamps
 * first (so any ISO that happens to look UUID-adjacent isn't misread),
 * UUIDs second.
 *
 * @param {string} text
 * @returns {{ canonical: string, uuidRemap: Map<string, string> }}
 */
export function canonicalize(text) {
  const t1 = canonicalizeTimestamps(text);
  const { canonical, remap } = canonicalizeUuids(t1);
  return { canonical, uuidRemap: remap };
}

/**
 * Walk a JSON-shaped value (already parsed) and return a new value with
 * UUIDs and timestamps in string fields canonicalized. Useful when diffing
 * structurally-parsed JSON (model3.json, physics3.json, etc.) where we want
 * to compare object shape rather than string-formatted output.
 *
 * Numeric and non-string fields pass through unchanged. Float canonicalization
 * is intentionally not done here — when needed, callers should round numerics
 * to a fixed precision before comparison.
 *
 * @param {*} value
 * @returns {*}
 */
export function canonicalizeJson(value) {
  const remap = new Map();

  const transformString = (s) => {
    let out = s.replace(ISO_TIMESTAMP_RE, '<ISO_TIMESTAMP>');
    out = out.replace(MOTION_ID_TS_RE, '$1_<TS>');
    out = out.replace(UUID_RE, (uuid) => {
      let alias = remap.get(uuid);
      if (alias === undefined) {
        alias = `uuid_${String(remap.size + 1).padStart(4, '0')}`;
        remap.set(uuid, alias);
      }
      return alias;
    });
    return out;
  };

  const walk = (v) => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return transformString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };

  return { canonical: walk(value), uuidRemap: remap };
}
