// Regression for Pose Mode bone framing via Numpad . / Period
// (2026-06-12, Phase 4 paint-fidelity follow-up — Pose audit).
//
// Bug class: pressing Period or NumpadDecimal with a selected bone
// in Pose Mode silently no-op'd. computeNodeBbox walks descendant
// parts; bones have NO descendant parts (they deform parts elsewhere
// in the tree via skinning, NOT parent-child), so the bbox came back
// null and frame-selected bailed.
//
// Blender's space_view3d view3d.view_selected frames on the active
// bone's head/tail when in Pose Mode. SS port: small bbox centered
// on the bone's world pivot position (the joint position rendered
// by SkeletonOverlay). Padding=80 mesh-units gives a comfortable
// framing — bone takes ~10% of canvas at the resulting zoom.
//
// Fix: new computeBoneBbox(project, nodeId) helper called as fallback
// when computeNodeBbox returns null. Walks computeWorldMatrices to
// get the bone's world position (translation column of its matrix),
// builds a small bbox around it. Selection.findLast picks the last
// selected bone group, same as for parts.
//
// Run: node scripts/test/test_poseBoneFrameSelected.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — bone bbox math ─────────────────────────────────────────────
//
// Apply local origin (0, 0) through world matrix → translation column
// (wm[6], wm[7]). Padding 80 mesh-units in each direction.

function computeBoneBbox(wm, paddingMU = 80) {
  if (!wm) return null;
  const cx = wm[6];
  const cy = wm[7];
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return {
    minX: cx - paddingMU,
    minY: cy - paddingMU,
    maxX: cx + paddingMU,
    maxY: cy + paddingMU,
  };
}

{
  // Identity matrix (no transform) → bone at origin
  const identity = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const bbox = computeBoneBbox(identity);
  ok(bbox.minX === -80 && bbox.minY === -80, '§1 — origin bone: bbox starts at -80');
  ok(bbox.maxX === 80 && bbox.maxY === 80, '§1 — origin bone: bbox ends at +80');
}

{
  // Translation to (100, 200) — wm[6]=100, wm[7]=200
  const translated = new Float32Array([1, 0, 0, 0, 1, 0, 100, 200, 1]);
  const bbox = computeBoneBbox(translated);
  ok(bbox.minX === 20 && bbox.minY === 120, '§1 — translated (100,200): bbox min');
  ok(bbox.maxX === 180 && bbox.maxY === 280, '§1 — translated (100,200): bbox max');
  ok((bbox.minX + bbox.maxX) / 2 === 100, '§1 — bbox centroid x = 100');
  ok((bbox.minY + bbox.maxY) / 2 === 200, '§1 — bbox centroid y = 200');
}

{
  // NaN in translation → null (defensive)
  const nan = new Float32Array([1, 0, 0, 0, 1, 0, NaN, 200, 1]);
  ok(computeBoneBbox(nan) === null, '§1 — NaN tx → null (defensive)');
}

{
  // No matrix → null
  ok(computeBoneBbox(null) === null, '§1 — null matrix → null');
  ok(computeBoneBbox(undefined) === null, '§1 — undefined matrix → null');
}

// ── §2 — fall-through chain: computeNodeBbox THEN computeBoneBbox ──
//
// exec()'s policy:
//   1. Get last selected part/group as target
//   2. Try computeNodeBbox (walks mesh vertices on descendant parts)
//   3. If null, try computeBoneBbox (uses world matrix translation)
//   4. If still null, bail (no framing)

function frameSelectedFlow(getNodeBbox, getBoneBbox) {
  let bbox = getNodeBbox();
  if (!bbox) bbox = getBoneBbox();
  return bbox;
}

{
  // Bone case: computeNodeBbox returns null (no descendants), bone bbox provided
  const bbox = frameSelectedFlow(
    () => null,
    () => ({ minX: -80, minY: -80, maxX: 80, maxY: 80 }),
  );
  ok(bbox?.minX === -80, '§2 — bone fall-through: uses bone bbox');
}

{
  // Part case: computeNodeBbox returns the mesh-vertex bbox; bone bbox not called
  let boneCalled = false;
  const bbox = frameSelectedFlow(
    () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
    () => { boneCalled = true; return { minX: -999, minY: -999, maxX: 999, maxY: 999 }; },
  );
  ok(bbox?.maxX === 100, '§2 — part: uses node bbox');
  ok(boneCalled === false,
    '§2 — part: bone bbox NOT called (short-circuit avoids unnecessary worldMatrix walk)');
}

{
  // Empty group: both return null → bail (caller exits)
  const bbox = frameSelectedFlow(() => null, () => null);
  ok(bbox === null, '§2 — both null → bail');
}

// ── §3 — last-bone-in-selection picks the right target ─────────────
//
// For multi-bone selection, view.frameSelected frames on the LAST one
// (mirrors the existing part/group picker via items.findLast). The
// existing findLast scans for type === 'part' || type === 'group' —
// bones (groups with boneRole) already match the 'group' clause, so
// no change needed.

function findLastTarget(items) {
  // Existing logic — find LAST part or group
  return items.findLast?.((it) => it.type === 'part' || it.type === 'group');
}

{
  const items = [
    { type: 'group', id: 'bone_a' },
    { type: 'group', id: 'bone_b' },
    { type: 'part', id: 'part_x' },
    { type: 'group', id: 'bone_c' },
  ];
  ok(findLastTarget(items)?.id === 'bone_c',
    '§3 — last group (bone_c) is the target, parts considered too');
}

{
  // Only bones
  const items = [
    { type: 'group', id: 'bone_a' },
    { type: 'group', id: 'bone_b' },
  ];
  ok(findLastTarget(items)?.id === 'bone_b',
    '§3 — all bones: last bone is target');
}

{
  // Only parts
  const items = [
    { type: 'part', id: 'p1' },
    { type: 'part', id: 'p2' },
  ];
  ok(findLastTarget(items)?.id === 'p2',
    '§3 — all parts: last part is target (bone fallback never fires)');
}

// ── §4 — pan calculation centers bbox on canvas ─────────────────────
//
// Once we have the bbox, the existing framing math:
//   panX = vw/2 - cx*zoom
//   panY = vh/2 - cy*zoom
// centers (cx, cy) on the canvas. Bone-bbox padding doesn't change
// zoom (zoom stays at current), only shifts the pan to bring the
// bone to canvas center.

function calcPan(bbox, vw, vh, zoom) {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return {
    panX: vw / 2 - cx * zoom,
    panY: vh / 2 - cy * zoom,
  };
}

{
  // Bone at world (100, 200), canvas 800x600, zoom 1
  const bbox = { minX: 20, minY: 120, maxX: 180, maxY: 280 };
  const { panX, panY } = calcPan(bbox, 800, 600, 1);
  ok(panX === 300, '§4 — bone (100,200) zoom=1: panX places bone center at canvas center');
  ok(panY === 100, '§4 — same for panY');
}

{
  // Same bone, zoom 2 (zoomed in)
  const bbox = { minX: 20, minY: 120, maxX: 180, maxY: 280 };
  const { panX, panY } = calcPan(bbox, 800, 600, 2);
  ok(panX === 200, '§4 — zoom=2: pan adjusts to compensate for larger world→screen ratio');
  ok(panY === -100, '§4 — same for panY at zoom=2');
}

console.log(`poseBoneFrameSelected: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
