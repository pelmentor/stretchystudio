// @ts-check

/**
 * Parameter-reference enumerator — the shared mechanism behind
 * GAP-013 (param delete orphan detection) and Hole I-3 of the
 * data-layer audit.
 *
 * # The problem this exists to solve
 *
 * `project.parameters` is a flat list with no back-references. When
 * a parameter disappears (UI delete, or `paramSpec.requireTag` gating
 * drops it because its tag no longer appears in the project), every
 * place that referenced it stays in the project as a dangling string:
 *
 *   - `project.animations[].tracks[].paramId` — motion3.json output
 *     references a property path that no parameter resolves
 *   - `bindings[].parameterId` inside `faceParallax`, `bodyWarp`,
 *     `rigWarps` keyform records — deformer reads default value 0
 *     silently, keyform interpolation broken
 *   - `physicsRules[].inputs[].paramId` — physics driver reads 0
 *     instead of the user's input parameter, sway dies silently
 *
 * Detection-only here: enumerate the references, return them as a
 * structured report. Caller (UI delete confirm dialog, seedParameters
 * filter, parameter-delete operator) decides on remediation.
 *
 * @module io/live2d/rig/paramReferences
 */

/**
 * @typedef {Object} ParamReference
 * @property {('animationTrack'|'binding'|'physicsInput')} kind
 *   What references the parameter — one of the three categories
 *   above.
 * @property {string} location
 *   Human-readable pointer that uniquely identifies this reference,
 *   for use in UI ("Delete this parameter? It's used in: ..."):
 *     - animation tracks: `"animation:<animId>:track[<index>]"`
 *     - face parallax bindings: `"faceParallax:bindings[<i>]"`
 *     - body warp bindings: `"bodyWarp:specs[<i>]:bindings[<j>]"`
 *     - rig warp bindings: `"rigWarps[<partId>]:bindings[<i>]"`
 *     - physics inputs: `"physicsRules[<i>]:inputs[<j>]"`
 * @property {string} [paramId]
 *   The parameter id this reference points at — included when the
 *   caller wanted "all references in the project, grouped by id"
 *   instead of "references to a specific id".
 */

/**
 * @typedef {Object} ReferenceReport
 * @property {ParamReference[]} animationTracks
 * @property {ParamReference[]} bindings
 *   Combined faceParallax + bodyWarp + rigWarps binding refs.
 * @property {ParamReference[]} physicsInputs
 * @property {number} total
 *   Sum of the three arrays — quick "is this param referenced" check.
 */

function emptyReport() {
  return {
    animationTracks: [],
    bindings: [],
    physicsInputs: [],
    total: 0,
  };
}

function pushTotal(report) {
  report.total =
    report.animationTracks.length +
    report.bindings.length +
    report.physicsInputs.length;
  return report;
}

/**
 * Enumerate every reference to a single parameter id in the project.
 *
 * Returns an empty report when the parameter is unreferenced (safe to
 * delete) or the project is malformed. Does not throw.
 *
 * @param {object} project
 * @param {string} paramId
 * @returns {ReferenceReport}
 */
export function findReferences(project, paramId) {
  const report = emptyReport();
  if (!project || typeof paramId !== 'string') return pushTotal(report);

  // Animation tracks: track.paramId is the param reference (other
  // tracks like 'x'/'rotation' use track.property and don't touch
  // parameters at all).
  for (const anim of project.animations ?? []) {
    const tracks = anim?.tracks;
    if (!Array.isArray(tracks)) continue;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (track?.paramId === paramId) {
        report.animationTracks.push({
          kind: 'animationTrack',
          location: `animation:${anim.id}:track[${i}]`,
        });
      }
    }
  }

  // Bindings — BFA-006 Phase 6: read from `project.nodes` deformer
  // entries (the legacy `faceParallax` / `bodyWarp` / `rigWarps`
  // sidetables are gone). Every deformer node carries
  // `bindings[].parameterId`; iterate them all and tag the location
  // by the node id (more useful for debugging than the prior
  // sidetable-relative paths since deformer nodes are first-class).
  for (const n of project.nodes ?? []) {
    if (!n || n.type !== 'deformer') continue;
    const bindings = Array.isArray(n.bindings) ? n.bindings : [];
    bindings.forEach((b, bi) => {
      if (b?.parameterId === paramId) {
        report.bindings.push({
          kind: 'binding',
          location: `deformer[${n.id}]:bindings[${bi}]`,
        });
      }
    });
  }

  // Physics inputs: rule.inputs[].paramId references parameters.
  // (rule.outputs are bone group names — covered by Hole I-6 work.)
  for (let ri = 0; ri < (project.physicsRules ?? []).length; ri++) {
    const rule = project.physicsRules[ri];
    const inputs = rule?.inputs;
    if (!Array.isArray(inputs)) continue;
    for (let ii = 0; ii < inputs.length; ii++) {
      if (inputs[ii]?.paramId === paramId) {
        report.physicsInputs.push({
          kind: 'physicsInput',
          location: `physicsRules[${ri}]:inputs[${ii}]`,
        });
      }
    }
  }

  return pushTotal(report);
}

/**
 * Sweep the entire project for references that don't resolve to any
 * parameter in `project.parameters`. Returns a `{ [paramId]:
 * ReferenceReport }` map keyed by the orphan id; empty map means no
 * orphans.
 *
 * Standard parameter ids (the 22 baked-in `STANDARD_PARAMS` registered
 * unconditionally in `paramSpec.js`) are NOT considered orphan even
 * if missing from `project.parameters` — they're added on demand by
 * the resolver. Caller (orphan-cleanup UI) treats them as "ignore".
 *
 * @param {object} project
 * @returns {Record<string, ReferenceReport>}
 */
export function findOrphanReferences(project) {
  /** @type {Record<string, ReferenceReport>} */
  const out = {};
  if (!project) return out;

  const known = new Set();
  for (const p of project.parameters ?? []) {
    if (p?.id) known.add(p.id);
  }

  /** Helper: collect param ids referenced anywhere. */
  const referenced = new Set();
  for (const anim of project.animations ?? []) {
    for (const t of anim?.tracks ?? []) {
      if (t?.paramId) referenced.add(t.paramId);
    }
  }
  // BFA-006 Phase 6 — deformer bindings live on nodes now.
  for (const n of project.nodes ?? []) {
    if (!n || n.type !== 'deformer') continue;
    for (const b of n.bindings ?? []) {
      if (b?.parameterId) referenced.add(b.parameterId);
    }
  }
  for (const rule of project.physicsRules ?? []) {
    for (const inp of rule?.inputs ?? []) {
      if (inp?.paramId) referenced.add(inp.paramId);
    }
  }

  for (const id of referenced) {
    if (known.has(id)) continue;
    if (isStandardParam(id)) continue;
    out[id] = findReferences(project, id);
  }
  return out;
}

/**
 * Unconditional-parameter allowlist. These ids are hardcoded in
 * `paramSpec.STANDARD_PARAMS` WITHOUT a `requireTag` gate, plus the
 * always-present `ParamOpacity`. Resolver injects them on demand so
 * references to them survive even when `project.parameters` is empty.
 *
 * **Tag-gated standard params (ParamHairFront, ParamSkirt, etc.) are
 * deliberately NOT in this allowlist** — Hole I-3's whole point is
 * that they DO become orphan when their tag stops being present.
 *
 * Keep in sync with [`paramSpec.js` STANDARD_PARAMS](./paramSpec.js):
 * include only entries without `requireTag`.
 *
 * @param {string} paramId
 * @returns {boolean}
 */
function isStandardParam(paramId) {
  if (STANDARD_PARAM_IDS.has(paramId)) return true;
  // Bone rotation params follow a fixed prefix pattern; their bone
  // existence is a separate concern (Hole I-5). For orphan detection
  // we treat them as "managed elsewhere" so they don't flood the
  // report when no UI surfaces them today.
  if (paramId.startsWith('ParamRotation_')) return true;
  return false;
}

const STANDARD_PARAM_IDS = new Set([
  'ParamOpacity',
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
  'ParamBreath',
  'ParamEyeLOpen', 'ParamEyeROpen',
  'ParamEyeBallX', 'ParamEyeBallY',
  'ParamBrowLY', 'ParamBrowRY',
  'ParamMouthForm', 'ParamMouthOpenY',
]);
