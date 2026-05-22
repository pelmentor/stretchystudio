// @ts-check

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
 * warp chain ABOVE the rotation is preserved as the part's runtime parent, so
 * body warps still deform the mesh before the bone rotates it. (Per RULE №4,
 * the bone head is FIXED — Blender — vs Cubism's warp-MOVED pivot; they
 * coincide at warp-rest and intentionally diverge under a deformed warp.)
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

  /** Resolve the rotation's chain parent into a runtime parent ref. */
  const resolveParentRef = (def) => {
    const pid = typeof def.parent === 'string' ? def.parent : null;
    if (!pid) return { type: 'root', id: null };
    const p = byId.get(pid);
    if (p && p.type === 'object' && p.objectKind === 'lattice') return { type: 'warp', id: pid };
    if (p && p.type === 'deformer' && p.deformerKind === 'warp') return { type: 'warp', id: pid };
    return { type: 'root', id: null };
  };

  const removed = new Set();
  for (const def of rotDefs) {
    const groupId = def.id.slice(GROUP_ROTATION_PREFIX.length);
    const group = byId.get(groupId);
    if (!group || group.type !== 'group') continue;

    const parts = project.nodes.filter(
      (p) => p && p.type === 'part'
        && (p.rigParent === def.id || p.mesh?.runtime?.parent?.id === def.id),
    );

    // Bone head = canvas-final rest pivot = mesh.vertices − pivot-relative keyform.
    let head = null;
    for (const p of parts) {
      const verts = p.mesh?.vertices;
      const rt = p.mesh?.runtime;
      const kf = Array.isArray(rt?.keyforms)
        ? (rt.keyforms.find((k) => (k.keyTuple?.[0] ?? 0) === 0) ?? rt.keyforms[0])
        : null;
      const kfv = kf?.vertexPositions;
      if (Array.isArray(verts) && verts.length >= 2 && Array.isArray(kfv) && kfv.length >= 2) {
        head = { x: verts[0] - kfv[0], y: verts[1] - kfv[1] };
        break;
      }
    }
    if (!head) {
      // No part to derive from → root-parented authored pivot.
      const rk = (def.keyforms ?? []).find((k) => (k.keyTuple?.[0] ?? 0) === 0) ?? def.keyforms?.[0];
      head = { x: rk?.originX ?? 0, y: rk?.originY ?? 0 };
    }

    // Group → bone.
    group.boneRole = `groupRotation_${groupId}`;
    if (!group.transform || typeof group.transform !== 'object') {
      group.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
    }
    group.transform.pivotX = head.x;
    group.transform.pivotY = head.y;
    if (!group.pose || typeof group.pose !== 'object') {
      group.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
    }

    const parentRef = resolveParentRef(def);
    for (const p of parts) {
      const verts = p.mesh?.vertices;
      if (!Array.isArray(verts)) continue;
      const n = verts.length >> 1;
      p.mesh.boneWeights = new Array(n).fill(1);
      p.mesh.jointBoneId = groupId;
      const rt = p.mesh.runtime;
      if (rt && typeof rt === 'object') {
        // Drop the ParamRotation binding (bone LBS owns the rotation now);
        // collapse to a single CANVAS-PX rest keyform; keep the warp chain
        // above as the runtime parent so body warps still deform the mesh.
        rt.bindings = (Array.isArray(rt.bindings) ? rt.bindings : [])
          .filter((b) => typeof b?.parameterId === 'string' && !b.parameterId.startsWith('ParamRotation_'));
        rt.keyforms = [{ keyTuple: [], opacity: 1, vertexPositions: verts.slice() }];
        rt.parent = parentRef;
      }
      if (Array.isArray(p.modifiers)) {
        p.modifiers = p.modifiers.filter(
          (m) => !(m && m.type === 'rotation' && m.deformerId === def.id),
        );
      }
      // rigParent pointed at the rotation deformer; clear it (the bone owns
      // this part now via boneWeights/jointBoneId).
      if (p.rigParent === def.id) p.rigParent = null;
    }

    removed.add(def.id);
  }

  if (removed.size > 0) {
    project.nodes = project.nodes.filter((n) => !(n && removed.has(n.id)));
  }
}
