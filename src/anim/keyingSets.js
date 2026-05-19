// @ts-check

/**
 * Keying Set registry — Phase 7.A substrate.
 *
 * Port target: Blender's `KeyingSet` registry (the "Insert Keyframe"
 * menu). The runtime kernel that actually walks a set + writes
 * keyframes is Slice 7.B; this slice ships ONLY the registry +
 * channel-collection helpers + per-project CRUD.
 *
 * # Blender reference (re-SOURCED per memory rule 9)
 *
 *   - `reference/blender/scripts/startup/keyingsets_builtins.py:27-34`
 *     declares the canonical `bl_idname`s as Python constants and
 *     notes "Keep these in sync with those in ED_keyframing.hh!".
 *     The 8 ANIM_KS_* ids are the load-bearing string keys; SS adopts
 *     5 of them verbatim ("Available", "Location", "Rotation",
 *     "Scaling", "LocRotScale").
 *   - `reference/blender/scripts/startup/keyingsets_builtins.py:38-82`
 *     Location/Rotation/Scaling class defs. Note `BUILTIN_KSI_Scaling`
 *     at `:70-82` carries `bl_idname = "Scaling"` (line 72) but
 *     `bl_label = "Scale"` (line 73) — the machine id and UI label
 *     differ. SS DEV 20 documents this carry-over.
 *   - `reference/blender/scripts/startup/keyingsets_builtins.py:126-144`
 *     `BUILTIN_KSI_LocRotScale` composes the three single-axis
 *     generators in order (loc/rot/scale per `:140-144`).
 *   - `reference/blender/scripts/startup/keyingsets_builtins.py:348-362`
 *     `BUILTIN_KSI_Available` walks the active action's existing
 *     fcurves and emits one path per fcurve (`:157-162` — the
 *     `RKS_GEN_available` generator).
 *   - `reference/blender/scripts/startup/keyingsets_builtins.py:647-670`
 *     `classes` tuple sets the menu order. Available first
 *     (`:648`), Location/Rotation/Scaling next (`:649-651`),
 *     LocRotScale-family after. SS mirrors that ordering for the
 *     first 5 entries; BlendShape + AllParams (SS-original) append.
 *   - `reference/blender/scripts/modules/_keyingsets_utils.py:194-217`
 *     `RKS_GEN_location` generator. Blender emits ONE 3-component
 *     vector path (`location`) and uses `array_index` to split into
 *     3 fcurves at insertion time. SS DEV 21 documents the
 *     per-component path divergence — SS evaluates `transform.x` and
 *     `transform.y` as 2 separate scalar paths (no array_index
 *     concept in `evaluateRnaPath`).
 *   - `reference/blender/scripts/modules/_keyingsets_utils.py:220-245`
 *     `RKS_GEN_rotation`. Blender picks `rotation_euler` /
 *     `rotation_quaternion` / `rotation_axis_angle` per the object's
 *     `rotation_mode`. SS DEV 22 documents the Euler-only collapse:
 *     SS rotation is always a scalar (`transform.rotation` /
 *     `pose.rotation`) because Live2D is 2D — no quaternion or
 *     axis-angle representation exists.
 *   - `reference/blender/scripts/modules/_keyingsets_utils.py:248-270`
 *     `RKS_GEN_scaling`. Same per-component divergence as
 *     `RKS_GEN_location` (DEV 21).
 *
 * # SS additions (SS-original sets — NOT Blender ports)
 *
 *   - `BlendShape` — collects `blendShapeValues["*"]` for the active
 *     mesh node. Live2D blend-shape concept; no Blender analog
 *     (Blender uses shape-key fcurves on the mesh datablock, a
 *     different model). DEV 24.
 *   - `AllParams` — collects all `__params__.values["*"]` for the
 *     project. Live2D parameter pool; no Blender analog. DEV 25.
 *
 * # SS DEVIATIONS this slice (20-25)
 *
 *   - DEV 20 — Scaling carries `id="Scaling"` + `label="Scale"`.
 *     Byte-faithful to Blender's split at `keyingsets_builtins.py:72/73`;
 *     SS legacy plan text said "Scale" as id but Blender canon is "Scaling".
 *   - DEV 21 — Per-component RNA paths (`transform.x` + `transform.y`
 *     for Location; `transform.scaleX` + `transform.scaleY` for
 *     Scaling). Blender uses single-vector path + `array_index`.
 *     SS `evaluateRnaPath` has no array_index concept; scalars only.
 *   - DEV 22 — Rotation collapsed to single scalar (`transform.rotation`
 *     / `pose.rotation`). Blender's mode-dependent
 *     euler/quaternion/axis_angle dispatch absent — SS is 2D-only.
 *   - DEV 23 — User-defined sets stored at `project.keyingSets[]`.
 *     Blender stores at `scene.keying_sets[]`; SS's project IS the
 *     scene per Phase 1 Stage 1.D `__scene__` pseudo-Object, so the
 *     storage shift is honest (1:1 mapping).
 *   - DEV 24 — `BlendShape` set is SS-original. No Blender analog.
 *   - DEV 25 — `AllParams` set is SS-original. No Blender analog.
 *
 * # Schema (sparse boolean idiom — Rule №2: missing = default)
 *
 *   - `project.keyingSets?: Array<{id, label, paths}>` — user-defined
 *     sets. Default `[]`. Built-ins live in this module's static
 *     registry, NOT in the project file. No schema version bump.
 *   - `project.activeKeyingSetId?: string | null` — id of the
 *     currently active set (built-in or user). Default `null` (no
 *     active set; I-menu opens at first applicable per object type).
 *
 * @module anim/keyingSets
 */

import { isBoneGroup } from '../store/objectDataAccess.js';

/**
 * @typedef {object} KeyingSetPath
 * @property {string} path  -- RNA path string (e.g. `objects["X"].transform.x`).
 * @property {string|null} group  -- group name for fcurve organisation,
 *   typically the source object's name. `null` when no grouping.
 */

/**
 * @typedef {object} KeyingSetDef
 * @property {string} id  -- machine id (e.g. "Location"); stable across
 *   project saves and used as the active-id pointer.
 * @property {string} label  -- UI label (e.g. "Location"; may differ
 *   from id per DEV 20 for Scaling).
 * @property {string} description  -- tooltip / I-menu hover text.
 * @property {boolean} isBuiltin  -- false for user-defined sets.
 * @property {boolean} insertNew  -- if true, the operator may CREATE
 *   missing fcurves; if false (Available pattern), only existing
 *   fcurves are touched.
 * @property {(project: any, objectIds: string[]) => KeyingSetPath[]} [collect]
 *   — channel collector; built-ins implement this. User-defined sets
 *   carry an explicit `paths` array instead.
 * @property {KeyingSetPath[]} [paths]  -- user-defined sets ship a
 *   static list of paths (no collector). Built-ins use `collect`.
 */

/**
 * Canonical menu order. Mirrors the order in
 * `keyingsets_builtins.py:647-670` for the 5 ported sets, with
 * SS-original sets (BlendShape, AllParams) appended.
 */
export const BUILTIN_KEYING_SET_IDS = Object.freeze([
  'Available',
  'Location',
  'Rotation',
  'Scaling',
  'LocRotScale',
  'BlendShape',
  'AllParams',
]);

/** Per-component path emission helpers — Rule №1, no path-string magic at call sites. */
function locationPaths(node) {
  if (!node) return [];
  const id = node.id;
  if (isBoneGroup(node)) {
    return [
      { path: `objects["${id}"].pose.x`, group: node.name ?? id },
      { path: `objects["${id}"].pose.y`, group: node.name ?? id },
    ];
  }
  return [
    { path: `objects["${id}"].transform.x`, group: node.name ?? id },
    { path: `objects["${id}"].transform.y`, group: node.name ?? id },
  ];
}

function rotationPaths(node) {
  if (!node) return [];
  const id = node.id;
  const base = isBoneGroup(node) ? 'pose.rotation' : 'transform.rotation';
  return [{ path: `objects["${id}"].${base}`, group: node.name ?? id }];
}

function scalingPaths(node) {
  if (!node) return [];
  const id = node.id;
  if (isBoneGroup(node)) {
    return [
      { path: `objects["${id}"].pose.scaleX`, group: node.name ?? id },
      { path: `objects["${id}"].pose.scaleY`, group: node.name ?? id },
    ];
  }
  return [
    { path: `objects["${id}"].transform.scaleX`, group: node.name ?? id },
    { path: `objects["${id}"].transform.scaleY`, group: node.name ?? id },
  ];
}

function blendShapePaths(node) {
  if (!node || node.type !== 'part') return [];
  const values = node.blendShapeValues;
  if (!values || typeof values !== 'object') return [];
  const out = [];
  const groupName = node.name ?? node.id;
  for (const sid of Object.keys(values)) {
    out.push({ path: `objects["${node.id}"].blendShapeValues["${sid}"]`, group: groupName });
  }
  return out;
}

function allParamsPaths(project) {
  if (!project || !Array.isArray(project.parameters)) return [];
  const out = [];
  for (const p of project.parameters) {
    if (p?.id) {
      out.push({ path: `objects["__params__"].values["${p.id}"]`, group: 'Parameters' });
    }
  }
  return out;
}

/**
 * "Available" — emit one path per fcurve already living in the
 * active action of each object. Mirrors
 * `_keyingsets_utils.py:130-162` (RKS_GEN_available); SS reads
 * `node.animData.actionId` to locate the action.
 *
 * Per the Blender pattern: paths are emitted with NO scoping mask
 * (i.e. fcurves whose `rnaPath` belongs to OTHER objects are also
 * emitted if they live in the same action). The kernel's job is to
 * iterate selection, the action's job is to enumerate fcurves.
 */
function availablePaths(project, objectIds) {
  if (!project || !Array.isArray(project.actions) || !Array.isArray(objectIds)) {
    return [];
  }
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const seen = new Set();
  const out = [];
  for (const oid of objectIds) {
    const node = nodes.find((n) => n?.id === oid);
    if (!node) continue;
    const actionId = node.animData?.actionId;
    if (!actionId) continue;
    const action = project.actions.find((a) => a?.id === actionId);
    if (!action || !Array.isArray(action.fcurves)) continue;
    for (const fc of action.fcurves) {
      if (!fc?.rnaPath || typeof fc.rnaPath !== 'string') continue;
      if (seen.has(fc.rnaPath)) continue;
      seen.add(fc.rnaPath);
      out.push({ path: fc.rnaPath, group: node.name ?? oid });
    }
  }
  return out;
}

/** Internal: built-in registry, keyed by id. */
const BUILTIN_DEFS = Object.freeze({
  Available: Object.freeze({
    id: 'Available',
    label: 'Available',
    description: 'Insert a keyframe on each of the already existing F-Curves',
    isBuiltin: true,
    insertNew: false,
    collect: availablePaths,
  }),
  Location: Object.freeze({
    id: 'Location',
    label: 'Location',
    description: 'Insert a keyframe on each of the location channels',
    isBuiltin: true,
    insertNew: true,
    collect: (project, objectIds) => collectPerObject(project, objectIds, locationPaths),
  }),
  Rotation: Object.freeze({
    id: 'Rotation',
    label: 'Rotation',
    description: 'Insert a keyframe on each of the rotation channels',
    isBuiltin: true,
    insertNew: true,
    collect: (project, objectIds) => collectPerObject(project, objectIds, rotationPaths),
  }),
  Scaling: Object.freeze({
    id: 'Scaling',
    label: 'Scale',
    description: 'Insert a keyframe on each of the scale channels',
    isBuiltin: true,
    insertNew: true,
    collect: (project, objectIds) => collectPerObject(project, objectIds, scalingPaths),
  }),
  LocRotScale: Object.freeze({
    id: 'LocRotScale',
    label: 'Location, Rotation & Scale',
    description: 'Insert a keyframe on each of the location, rotation, and scale channels',
    isBuiltin: true,
    insertNew: true,
    collect: (project, objectIds) =>
      collectPerObject(project, objectIds, (node) => [
        ...locationPaths(node),
        ...rotationPaths(node),
        ...scalingPaths(node),
      ]),
  }),
  BlendShape: Object.freeze({
    id: 'BlendShape',
    label: 'Blend Shapes',
    description: 'Insert a keyframe for each blend-shape value on the active mesh',
    isBuiltin: true,
    insertNew: true,
    collect: (project, objectIds) => collectPerObject(project, objectIds, blendShapePaths),
  }),
  AllParams: Object.freeze({
    id: 'AllParams',
    label: 'All Parameters',
    description: 'Insert a keyframe for every Live2D parameter in the project',
    isBuiltin: true,
    insertNew: true,
    collect: (project) => allParamsPaths(project),
  }),
});

/** Helper: walk objectIds, resolve to nodes, apply per-object emitter, concat. */
function collectPerObject(project, objectIds, emitter) {
  if (!project || !Array.isArray(objectIds)) return [];
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const out = [];
  for (const oid of objectIds) {
    const node = nodes.find((n) => n?.id === oid);
    if (!node) continue;
    for (const p of emitter(node)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Look up a keying set by id. Checks built-ins first, then
 * `project.keyingSets[]`.
 *
 * @param {object|null|undefined} project
 * @param {string|null|undefined} id
 * @returns {KeyingSetDef|null}
 */
export function getKeyingSet(project, id) {
  if (typeof id !== 'string' || id.length === 0) return null;
  if (id in BUILTIN_DEFS) return BUILTIN_DEFS[/** @type {keyof typeof BUILTIN_DEFS} */ (id)];
  if (!project || !Array.isArray(project.keyingSets)) return null;
  const def = project.keyingSets.find((/** @type {any} */ k) => k?.id === id);
  if (!def) return null;
  // Normalise read shape (user-defined sets carry static `paths`).
  return {
    id: def.id,
    label: def.label ?? def.id,
    description: def.description ?? '',
    isBuiltin: false,
    insertNew: def.insertNew !== false,
    paths: Array.isArray(def.paths) ? def.paths : [],
  };
}

/**
 * Return a stable-ordered list of every keying set the project sees:
 * built-ins in canonical menu order, then user-defined in
 * `project.keyingSets[]` insertion order.
 *
 * @param {object|null|undefined} project
 * @returns {KeyingSetDef[]}
 */
export function listKeyingSets(project) {
  /** @type {KeyingSetDef[]} */
  const out = [];
  for (const id of BUILTIN_KEYING_SET_IDS) {
    out.push(BUILTIN_DEFS[/** @type {keyof typeof BUILTIN_DEFS} */ (id)]);
  }
  if (project && Array.isArray(project.keyingSets)) {
    for (const def of project.keyingSets) {
      if (!def?.id || def.id in BUILTIN_DEFS) continue; // ignore shadowing attempts
      out.push({
        id: def.id,
        label: def.label ?? def.id,
        description: def.description ?? '',
        isBuiltin: false,
        insertNew: def.insertNew !== false,
        paths: Array.isArray(def.paths) ? def.paths : [],
      });
    }
  }
  return out;
}

/**
 * Resolve the project's currently active keying set, or `null`.
 *
 * @param {object|null|undefined} project
 * @returns {KeyingSetDef|null}
 */
export function getActiveKeyingSet(project) {
  if (!project) return null;
  return getKeyingSet(project, project.activeKeyingSetId);
}

/**
 * Set the active keying set id (immer-friendly mutator). Pass `null`
 * to clear. Throws (Rule №1) on unknown id; caller must look up first.
 *
 * @param {object} project  -- immer draft
 * @param {string|null} id
 */
export function setActiveKeyingSet(project, id) {
  if (!project) throw new Error('setActiveKeyingSet: project required');
  if (id === null || id === undefined) {
    project.activeKeyingSetId = null;
    return;
  }
  if (typeof id !== 'string') throw new Error(`setActiveKeyingSet: id must be string|null, got ${typeof id}`);
  if (!getKeyingSet(project, id)) {
    throw new Error(`setActiveKeyingSet: unknown keying set id '${id}'`);
  }
  project.activeKeyingSetId = id;
}

/**
 * Walk a keying set + object selection → return the RNA paths to key.
 *
 * Built-in sets dispatch through their `collect` function; user-defined
 * sets emit their static `paths` (ignoring the selection — Blender's
 * absolute-paths user-defined-set semantic at `keyingsets.cc:355-364`
 * `BKE_keyingset_add_path`).
 *
 * @param {object|null|undefined} project
 * @param {KeyingSetDef|null|undefined} set
 * @param {string[]} objectIds  -- node ids currently selected / scoped
 * @returns {KeyingSetPath[]}
 */
export function collectChannels(project, set, objectIds) {
  if (!set) return [];
  if (set.isBuiltin && typeof set.collect === 'function') {
    return set.collect(project, objectIds);
  }
  if (Array.isArray(set.paths)) {
    return set.paths.map((p) => ({ path: p.path, group: p.group ?? null }));
  }
  return [];
}

/** Reject invalid user-defined-set definitions (Rule №1 — no silent drop). */
function validateUserDef(def) {
  if (!def || typeof def !== 'object') throw new Error('keyingSet: definition must be an object');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new Error('keyingSet: id required');
  if (def.id in BUILTIN_DEFS) throw new Error(`keyingSet: id '${def.id}' shadows a built-in`);
  if (!Array.isArray(def.paths)) throw new Error('keyingSet: paths[] required');
  for (const p of def.paths) {
    if (!p || typeof p.path !== 'string' || p.path.length === 0) {
      throw new Error('keyingSet: each path must carry a non-empty `path` string');
    }
  }
}

/**
 * Add a user-defined keying set (immer-friendly mutator). Throws on
 * collision with a built-in or with an existing user id.
 *
 * @param {object} project  -- immer draft
 * @param {{id: string, label?: string, description?: string, insertNew?: boolean, paths: KeyingSetPath[]}} def
 */
export function addKeyingSet(project, def) {
  validateUserDef(def);
  if (!Array.isArray(project.keyingSets)) project.keyingSets = [];
  if (project.keyingSets.some((/** @type {any} */ k) => k?.id === def.id)) {
    throw new Error(`addKeyingSet: id '${def.id}' already exists`);
  }
  project.keyingSets.push({
    id: def.id,
    label: def.label ?? def.id,
    description: def.description ?? '',
    insertNew: def.insertNew !== false,
    paths: def.paths.map((p) => ({ path: p.path, group: p.group ?? null })),
  });
}

/**
 * Remove a user-defined set. Built-ins cannot be removed (Rule №1
 * throw). Returns true if removed.
 *
 * @param {object} project  -- immer draft
 * @param {string} id
 * @returns {boolean}
 */
export function removeKeyingSet(project, id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('removeKeyingSet: id required');
  }
  if (id in BUILTIN_DEFS) {
    throw new Error(`removeKeyingSet: '${id}' is built-in (not removable)`);
  }
  if (!Array.isArray(project.keyingSets)) return false;
  const i = project.keyingSets.findIndex((/** @type {any} */ k) => k?.id === id);
  if (i < 0) return false;
  project.keyingSets.splice(i, 1);
  if (project.activeKeyingSetId === id) project.activeKeyingSetId = null;
  return true;
}

/**
 * Clone any set (built-in or user) into a new user-defined set with a
 * fresh id. Built-in sets are resolved to their current collect output
 * via the supplied `objectIds` (snapshot at clone time — mirrors
 * Blender's "Add Empty Set" + populate-from-selection pattern).
 *
 * @param {object} project  -- immer draft
 * @param {string} sourceId
 * @param {string} newId
 * @param {string} [newLabel]
 * @param {string[]} [objectIds]
 * @returns {KeyingSetDef}
 */
export function cloneKeyingSet(project, sourceId, newId, newLabel, objectIds) {
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new Error('cloneKeyingSet: sourceId required');
  }
  if (typeof newId !== 'string' || newId.length === 0) {
    throw new Error('cloneKeyingSet: newId required');
  }
  if (newId in BUILTIN_DEFS) {
    throw new Error(`cloneKeyingSet: newId '${newId}' shadows a built-in`);
  }
  const source = getKeyingSet(project, sourceId);
  if (!source) throw new Error(`cloneKeyingSet: unknown source '${sourceId}'`);
  const ids = Array.isArray(objectIds) ? objectIds : [];
  const paths = source.isBuiltin
    ? collectChannels(project, source, ids)
    : source.paths ?? [];
  if (!Array.isArray(project.keyingSets)) project.keyingSets = [];
  if (project.keyingSets.some((/** @type {any} */ k) => k?.id === newId)) {
    throw new Error(`cloneKeyingSet: newId '${newId}' already exists`);
  }
  const entry = {
    id: newId,
    label: newLabel ?? source.label,
    description: source.description,
    insertNew: source.insertNew,
    paths: paths.map((p) => ({ path: p.path, group: p.group ?? null })),
  };
  project.keyingSets.push(entry);
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    isBuiltin: false,
    insertNew: entry.insertNew,
    paths: entry.paths,
  };
}
