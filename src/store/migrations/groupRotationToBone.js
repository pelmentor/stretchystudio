// @ts-check

import { logger } from '../../lib/logger.js';

/**
 * RULE №4 — convert Cubism GroupRotation deformer nodes into armature BONES.
 *
 * A `{type:'deformer', deformerKind:'rotation', id:'GroupRotation_<g>'}` node
 * is, in Blender, the group `<g>` acting as a bone that rotates its weighted
 * meshes around its head (the pivot). This pure transform rewrites the project
 * to that Blender model:
 *   - the group `<g>` gains `boneRole: 'groupRotation_<g>'`, `transform.pivotX/Y`
 *     = the canvas-final rest pivot (the bone head), and a rest `pose`;
 *   - every part driven by the rotation is bound to the bone (boneWeights=1,
 *     jointBoneId=<g>), its runtime collapses to a single CANVAS-PX rest
 *     keyform (the part's `mesh.vertices`), and the `ParamRotation` binding +
 *     the `rotation` modifier-stack entry are dropped — the depgraph's LBS
 *     (driven by `pose.rotation`) now owns the rotation;
 *   - the transient Cubism deformer is re-synthesised at export/eval time by
 *     `synthesizeGroupRotationDeformers` (the downstream adapter).
 *
 * # Bone head (grounded by test_groupRotationRealRig)
 *
 * Group rotations are WARP-PARENTED (authored pivot is warp-local). The
 * canvas-final REST pivot — what the part actually rotates around, = the bone
 * head — is `mesh.vertices[i] − runtime.keyform[0].vertexPositions[i]` (a
 * constant; the part's canvas-px verts minus its pivot-relative keyform). The
 * warp chain ABOVE the rotation is no longer written into `runtime.parent`
 * (M3.3 retired that cache); the leaf is derived from project topology by
 * `synthesizeModifierStacks` via `findInnermostBodyWarpId` so body warps
 * still deform the mesh before the bone rotates it. (Per RULE №4, the bone
 * head is FIXED — Blender — vs Cubism's warp-MOVED pivot; they coincide at
 * warp-rest and intentionally diverge under a deformed warp.)
 *
 * @module store/migrations/groupRotationToBone
 */

const GROUP_ROTATION_PREFIX = 'GroupRotation_';

/**
 * @param {object} project - mutated in place
 */
export function migrateGroupRotationDeformersToBones(project) {
  if (!project || !Array.isArray(project.nodes)) return;
  const byId = new Map();
  for (const n of project.nodes) if (n?.id) byId.set(n.id, n);

  const rotDefs = project.nodes.filter(
    (n) => n && n.type === 'deformer' && n.deformerKind === 'rotation'
      && typeof n.id === 'string' && n.id.startsWith(GROUP_ROTATION_PREFIX),
  );
  if (rotDefs.length === 0) return;

  /** The rotation deformer's rest (keyTuple 0) keyform. */
  const restKeyform = (def) =>
    (def.keyforms ?? []).find((k) => (k.keyTuple?.[0] ?? 0) === 0) ?? def.keyforms?.[0] ?? null;

  // Parts driven directly by this rotation deformer — topology signal:
  // a part is driven by `GroupRotation_<g>` iff its tree-parent is the
  // group `<g>`. Pre-v44 saves always place parts as direct children of
  // their owning group (the rig pipeline never moves them); the topology
  // signal subsumes the two retired alternatives (`rigParent === def.id`
  // retired in M4 with the field itself; `mesh.runtime.parent.id ===
  // def.id` retired in M3.3 with the cache field). Grounded by
  // test_groupRotationMigrationRealRig.
  const partsOf = (def) => {
    const groupName = def.id.slice(GROUP_ROTATION_PREFIX.length);
    return project.nodes.filter(
      (p) => p && p.type === 'part' && p.parent === groupName,
    );
  };

  /**
   * Bone head = the rotation's CANVAS-FINAL rest pivot. Derivation, in order:
   *  1. A directly-driven part: `mesh.vertices − pivot-relative keyform` (the
   *     part's canvas-px verts minus its pivot-relative rest keyform = the
   *     pivot the part rotates around). Grounded by test_groupRotationRealRig.
   *  2. No direct part (a container rotation holding only sub-rotations): a
   *     child rotation's pivot minus the child's authored origin. A
   *     rotation-parented deformer expresses its origin as a CANVAS-PX offset
   *     from its parent's pivot, so `childPivot − childOrigin = thisPivot`.
   *     Recurse so a chain of containers resolves bottom-up. (The authored
   *     `originX/Y` on a warp-parented container is warp-LOCAL — unusable
   *     directly; the child-rotation route recovers canvas-final without any
   *     warp math.)
   *  3. Root-parented leaf with neither: the authored `originX/Y`, which is
   *     already canvas-px for a root parent.
   */
  const pivotCache = new Map();
  const deriveCanvasPivot = (def, guard = 0) => {
    if (pivotCache.has(def.id)) return pivotCache.get(def.id);
    if (guard > 256) return null;
    pivotCache.set(def.id, null); // cycle guard

    let head = null;
    for (const p of partsOf(def)) {
      // `mesh.vertices` has TWO canonical shapes in this codebase:
      //   (a) object array `[{x, y, restX?, restY?}, ...]` — the
      //       runtime/PSD-import shape (see `exporter.js` line 493:
      //       `v.restX ?? v.x`). `restX/restY` carry the un-baked rest
      //       position when a pose has been committed; fall back to
      //       `x/y` otherwise.
      //   (b) flat number array `[x0, y0, x1, y1, ...]` — the
      //       test-fixture + some-synthesis-path shape.
      // `mesh.runtime.keyforms[i].vertexPositions` is ALWAYS the flat
      // shape (per `selectRigSpec._buildArtMeshes` writes
      // `Float32Array(flatVerts)`; `persistArtMeshRuntime` copies).
      // The pre-2026-05-25 code treated `verts[0]` uniformly as a
      // number — fine for shape (b), but for shape (a) it picked up
      // the whole `{x, y, ...}` object → `object - number = NaN`,
      // cascading into bone `transform.pivotX/Y` and the
      // SkeletonOverlay NaN flood (Shelby invisible-character
      // regression 2026-05-25). Discriminate the shape and read
      // accordingly. The math (canvas vertex − pivot-relative keyform
      // = canvas pivot) is identical for both shapes once read.
      const verts = p.mesh?.vertices;
      const kf = Array.isArray(p.mesh?.runtime?.keyforms)
        ? (p.mesh.runtime.keyforms.find((k) => (k.keyTuple?.[0] ?? 0) === 0) ?? p.mesh.runtime.keyforms[0])
        : null;
      const kfv = kf?.vertexPositions;
      if (!Array.isArray(verts) || !Array.isArray(kfv) || kfv.length < 2) continue;
      let vx, vy;
      const v0 = verts[0];
      if (typeof v0 === 'object' && v0 !== null) {
        // Shape (a) — object array.
        vx = v0.restX ?? v0.x;
        vy = v0.restY ?? v0.y;
      } else if (typeof v0 === 'number' && verts.length >= 2 && typeof verts[1] === 'number') {
        // Shape (b) — flat number array.
        vx = v0;
        vy = verts[1];
      } else {
        continue;
      }
      if (typeof vx === 'number' && typeof vy === 'number') {
        head = { x: vx - kfv[0], y: vy - kfv[1] };
        break;
      }
    }
    if (!head) {
      const childRot = rotDefs.find((d) => d.parent === def.id);
      if (childRot) {
        const childPivot = deriveCanvasPivot(childRot, guard + 1);
        const ck = restKeyform(childRot);
        if (childPivot && ck) head = { x: childPivot.x - (ck.originX ?? 0), y: childPivot.y - (ck.originY ?? 0) };
      }
    }
    if (!head) {
      const rk = restKeyform(def);
      head = { x: rk?.originX ?? 0, y: rk?.originY ?? 0 };
    }
    pivotCache.set(def.id, head);
    return head;
  };

  const removed = new Set();
  for (const def of rotDefs) {
    const groupId = def.id.slice(GROUP_ROTATION_PREFIX.length);
    const group = byId.get(groupId);
    if (!group || group.type !== 'group') continue;

    const parts = partsOf(def);
    const head = deriveCanvasPivot(def);

    // Group → bone.
    group.boneRole = `groupRotation_${groupId}`;
    if (!group.transform || typeof group.transform !== 'object') {
      group.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
    }
    // Diagnostic: surface the NaN-source for the Shelby invisible-character
    // regression 2026-05-24. ALL fields inlined into the message string
    // because user's console-paste collapses Object payload to
    // `[object Object]`. Each value matters — they pin which path of
    // deriveCanvasPivot produced NaN.
    if (!Number.isFinite(head.x) || !Number.isFinite(head.y)) {
      const firstPart = parts[0] ?? null;
      const firstKf = firstPart?.mesh?.runtime?.keyforms?.[0] ?? null;
      const childRot = rotDefs.find((d) => d.parent === def.id) ?? null;
      const rk = restKeyform(def);
      const parentGroup = byId.get(group.parent);
      logger.error(
        'groupRotationToBoneNaNPivot',
        `BONE-NaN bone=${groupId} def=${def.id} groupParent=${group.parent ?? 'null'} parentType=${parentGroup?.type ?? '?'} parentRole=${parentGroup?.boneRole ?? '?'} | parts=${parts.length} firstPartId=${firstPart?.id ?? '?'} firstPartVertCount=${Array.isArray(firstPart?.mesh?.vertices) ? firstPart.mesh.vertices.length : 'N/A'} firstPartVert0=[${Array.isArray(firstPart?.mesh?.vertices) ? `${firstPart.mesh.vertices[0]},${firstPart.mesh.vertices[1]}` : 'N/A'}] firstKfV0=[${Array.isArray(firstKf?.vertexPositions) ? `${firstKf.vertexPositions[0]},${firstKf.vertexPositions[1]}` : 'N/A'}] | childRot=${childRot?.id ?? 'NONE'} | restKf.originX=${rk?.originX} restKf.originY=${rk?.originY} restKf.keyforms#=${(def.keyforms ?? []).length}`,
      );
    }
    group.transform.pivotX = head.x;
    group.transform.pivotY = head.y;
    if (!group.pose || typeof group.pose !== 'object') {
      group.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
    }

    for (const p of parts) {
      const verts = p.mesh?.vertices;
      if (!Array.isArray(verts) || verts.length === 0) continue;
      // `mesh.vertices` is dual-shape — discriminate (see deriveCanvasPivot
      // above + [[mesh-vertices-dual-shape]]). Write sites must match the
      // canonical `vertexPositions` shape (flat Float32Array) regardless
      // of which input shape was provided, otherwise the renderer reads
      // `{x,y}` objects as numbers and produces NaN/Infinity vertices.
      // (Shelby handwear "scaled infinitely" regression 2026-05-25.)
      const v0 = verts[0];
      const isObjectShape = typeof v0 === 'object' && v0 !== null;
      const n = isObjectShape ? verts.length : (verts.length >> 1);
      p.mesh.boneWeights = new Array(n).fill(1);
      p.mesh.jointBoneId = groupId;
      const rt = p.mesh.runtime;
      if (rt && typeof rt === 'object') {
        // Drop the ParamRotation binding (bone LBS owns the rotation now)
        // and collapse to a single CANVAS-PX rest keyform. The runtime-parent
        // pointer is no longer written (retired in M3.3 — bone-baked parts
        // derive their leaf from project topology via
        // `findInnermostBodyWarpId` in `synthesizeModifierStacks`).
        rt.bindings = (Array.isArray(rt.bindings) ? rt.bindings : [])
          .filter((b) => typeof b?.parameterId === 'string' && !b.parameterId.startsWith('ParamRotation_'));
        const flatVerts = new Float32Array(n * 2);
        if (isObjectShape) {
          for (let i = 0; i < n; i++) {
            const vi = verts[i];
            flatVerts[i * 2]     = vi.restX ?? vi.x;
            flatVerts[i * 2 + 1] = vi.restY ?? vi.y;
          }
        } else {
          for (let i = 0; i < n * 2; i++) flatVerts[i] = verts[i];
        }
        rt.keyforms = [{ keyTuple: [], opacity: 1, vertexPositions: flatVerts }];
      }
      if (Array.isArray(p.modifiers)) {
        p.modifiers = p.modifiers.filter(
          (m) => !(m && m.type === 'rotation' && m.deformerId === def.id),
        );
      }
      // M4 (RULE-№4, 2026-05-23): the prior `rigParent = null` cleanup
      // is retired — `rigParent` is no longer persisted (v48 strips it
      // post-v44; the field has no live readers post-M4).
    }

    removed.add(def.id);
  }

  if (removed.size > 0) {
    project.nodes = project.nodes.filter((n) => !(n && removed.has(n.id)));
  }
}
