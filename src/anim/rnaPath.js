// @ts-check

/**
 * RNA-path resolver -- reads / writes a project property by string path.
 *
 * Phase 5 scaffold. Loose port of Blender's RNA path semantics
 * (`reference/blender/source/blender/makesrna/intern/rna_path.cc`),
 * scoped to the property addresses SS exposes today plus the Phase 1+
 * shape. Blender's full RNA system supports method calls
 * (`obj.location.length()`), enum values, function arg lists, and
 * collection iteration -- none of which we need for FCurve / Driver
 * targets. We cover the property-slot subset only.
 *
 *   - `objects['<id>'].transform.rotation`
 *   - `objects['<id>'].transform.pivotX`
 *   - `objects['<id>'].pose.rotation`              (bone groups)
 *   - `objects['<id>'].pose.x`                     (bone groups)
 *   - `objects['<id>'].opacity`
 *   - `objects['<id>'].visible`
 *   - `objects['<id>'].mesh.vertices[<i>].x`       (mesh vertex coords)
 *   - `objects['<id>'].blendShapeValues['<sid>']`
 *   - `objects['<id>'].modifiers[<i>].payload.<field>`  (Phase 3+)
 *   - `objects['<id>'].constraints[<i>].influence`     (Phase 4+)
 *   - `objects['__params__'].values['ParamAngleZ']`     (Live2D params)
 *   - `objects['__armature__'].pose.channels['<role>'].rotation`
 *
 * Indexing is bracket-style; field access is dot-style. The grammar is
 * deliberately small -- no ternary, no function calls, no method chains.
 * That's intentional; full Blender RNA paths can call methods, but for
 * driver / FCurve targets we only need to resolve to a property slot.
 *
 * # Why this exists
 *
 * Drivers and FCurves both need a way to address "the thing I'm
 * driving" by string. Hard-coding callable accessors (`writeNodeRotation(node, value)`)
 * doesn't scale once you can drive arbitrary properties. RNA paths give
 * us a parsed-once / evaluated-many decoupling: parse the path string
 * into a path of `{kind: 'field' | 'index' | 'key', value}` segments,
 * then walk the project tree at eval time.
 *
 * # Resolver entry point: `objects[<id>]`
 *
 * The path always starts with `objects[<id>]` -- Blender's "ID datablock
 * map" pattern. SS's flat `project.nodes` array becomes
 * `objects[<id>]` keyed lookups via a one-pass index built per call.
 * The synthetic `__params__` and `__armature__` ids resolve via the
 * existing helpers (`paramValuesStore`, `getArmature`).
 *
 * @module anim/rnaPath
 */

import { getMesh, getArmature } from '../store/objectDataAccess.js';

/**
 * Tokenise a path like `objects['p1'].transform.rotation` or
 * `modifiers[0].payload.amount` into segments.
 *
 * Returns `null` on malformed input (caller logs / falls back).
 *
 * @param {string} path
 * @returns {Array<{kind: 'field' | 'index' | 'key', value: string|number}>|null}
 */
export function parseRnaPath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  /** @type {Array<{kind: 'field' | 'index' | 'key', value: string|number}>} */
  const segments = [];
  let i = 0;
  // First segment -- bare identifier (e.g. `objects`).
  let m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(path);
  if (!m) return null;
  segments.push({ kind: 'field', value: m[0] });
  i = m[0].length;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      i += 1;
      m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(path.slice(i));
      if (!m) return null;
      segments.push({ kind: 'field', value: m[0] });
      i += m[0].length;
    } else if (ch === '[') {
      const end = path.indexOf(']', i + 1);
      if (end < 0) return null;
      const inside = path.slice(i + 1, end);
      // String key: `'foo'` or `"foo"`.
      const strMatch = /^(['"])(.*)\1$/.exec(inside);
      if (strMatch) {
        segments.push({ kind: 'key', value: strMatch[2] });
      } else {
        const num = Number(inside);
        if (!Number.isFinite(num)) return null;
        segments.push({ kind: 'index', value: num });
      }
      i = end + 1;
    } else {
      // Anything else is malformed.
      return null;
    }
  }
  return segments;
}

/**
 * Resolve `objects[<id>]` to a project node OR a synthetic root.
 * Synthetic ids:
 *   - `__params__` → returns a `{ values }` view backed by
 *     `project.parameters` defaults; mutating `.values[id]` is the
 *     live-param convention.
 *   - `__armature__` → returns the synthetic ArmatureView from
 *     `getArmature(project)`.
 *
 * @param {object} project
 * @param {string} id
 * @returns {object|null}
 */
function resolveObjectId(project, id) {
  if (id === '__armature__') return getArmature(project);
  if (id === '__params__') {
    return _paramsView(project);
  }
  return (project.nodes ?? []).find((n) => n?.id === id) ?? null;
}

/**
 * Build a `{ values: {paramId: number} }` view from `project.parameters`.
 * Read-only at the helper level -- drivers / FCurves write through the
 * paramValues store at runtime, not here.
 */
function _paramsView(project) {
  const out = {};
  for (const p of project?.parameters ?? []) {
    if (p?.id) out[p.id] = p.default ?? 0;
  }
  return { values: out };
}

/**
 * Walk a parsed path against `project` and return the value at the
 * leaf, or `undefined` if any segment misses.
 *
 * @param {object} project
 * @param {string} path
 * @returns {*}
 */
export function evaluateRnaPath(project, path) {
  const segs = parseRnaPath(path);
  if (!segs || segs.length < 2) return undefined;
  // First segment must be `objects`; second segment is the id.
  const first = segs[0];
  const second = segs[1];
  if (first.kind !== 'field' || first.value !== 'objects') return undefined;
  if (second.kind !== 'index' && second.kind !== 'key') return undefined;
  const objectId = String(second.value);
  let cur = resolveObjectId(project, objectId);
  if (!cur) return undefined;

  // Special-case: `mesh` field on a part -- route through `getMesh`
  // so v18 dataId resolution works.
  for (let i = 2; i < segs.length; i++) {
    const seg = segs[i];
    if (cur == null) return undefined;
    if (seg.kind === 'field') {
      if (seg.value === 'mesh' && cur.type === 'part') {
        cur = getMesh(cur, project);
      } else {
        cur = cur[seg.value];
      }
    } else if (seg.kind === 'index') {
      if (!Array.isArray(cur) && !ArrayBuffer.isView(cur)) return undefined;
      cur = cur[seg.value];
    } else if (seg.kind === 'key') {
      cur = cur[seg.value];
    }
  }
  return cur;
}

/**
 * Walk a parsed path and write `value` at the leaf. Creates nested
 * fields when missing (so a fresh project can be driver-targeted
 * without pre-population). Returns true on success.
 *
 * Caller is responsible for being inside an Immer recipe / store
 * mutation context; this helper just mutates the draft.
 *
 * @param {object} project
 * @param {string} path
 * @param {*} value
 * @returns {boolean}
 */
export function setRnaPath(project, path, value) {
  const segs = parseRnaPath(path);
  if (!segs || segs.length < 3) return false; // need objects[id].field at minimum
  const [first, second, ...rest] = segs;
  if (first.kind !== 'field' || first.value !== 'objects') return false;
  if (second.kind !== 'index' && second.kind !== 'key') return false;
  const objectId = String(second.value);
  let cur = resolveObjectId(project, objectId);
  if (!cur) return false;
  for (let i = 0; i < rest.length - 1; i++) {
    const seg = rest[i];
    let next;
    if (seg.kind === 'field') {
      if (seg.value === 'mesh' && cur.type === 'part') {
        next = getMesh(cur, project);
      } else {
        next = cur[seg.value];
      }
    } else if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return false;
      next = cur[seg.value];
    } else {
      next = cur[seg.value];
    }
    if (next == null) {
      // Create intermediate object/array based on next segment kind.
      const after = rest[i + 1];
      next = (after?.kind === 'index') ? [] : {};
      if (seg.kind === 'field') cur[seg.value] = next;
      else cur[seg.value] = next;
    }
    cur = next;
  }
  const leaf = rest[rest.length - 1];
  if (leaf.kind === 'field') cur[leaf.value] = value;
  else cur[leaf.value] = value;
  return true;
}
