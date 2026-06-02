/**
 * exportSpine.js
 *
 * Logic to export the Stretchy Studio project to Spine 4.0 JSON format.
 */
import { computeWorldMatrices } from '../renderer/transforms.js';
import { uid } from '../lib/ids.js';
import { getMesh } from '../store/objectDataAccess.js';
import { decodeFCurveTarget } from '../anim/animationFCurve.js';

/**
 * Require a finite number for a Spine-exported field. `value == null`
 * (legitimately absent) returns `fallbackForAbsent` so the export uses
 * the identity value. Any other non-finite input (NaN / Infinity /
 * string / object) throws — per RULE-№1, exporting NaN to disk is a
 * silent corruption and the user must see the failure.
 *
 * `|| 0` and `?? 0` both mask NaN (NaN is falsy; NaN is a real number
 * so `??` doesn't trigger) — the documented anti-pattern in
 * `feedback_typeof_nan_is_number`.
 *
 * @param {unknown} value
 * @param {string} fieldName
 * @param {string} nodeName
 * @param {number} fallbackForAbsent — used when value is null/undefined
 * @returns {number}
 */
function requireFinite(value, fieldName, nodeName, fallbackForAbsent) {
  if (value == null) return fallbackForAbsent;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new RangeError(`Spine export: ${nodeName}.${fieldName} is not finite (got ${String(value)}). Fix the source data and re-export.`);
}

/**
 * Main entry point for Spine export.
 * Returns a ZIP blob containing the skeleton.json and images.
 */
export async function exportToSpine({ project, onProgress }) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  onProgress?.('Preparing skeleton data...');
  const skeletonData = buildSpineJson(project);
  zip.file('skeleton.json', JSON.stringify(skeletonData, null, 2));

  onProgress?.('Collecting textures...');
  const imagesFolder = zip.folder('images');
  
  for (const node of project.nodes) {
    if (node.type !== 'part') continue;
    
    const tex = project.textures.find(t => t.id === node.id) || project.textures.find(t => t.id === node.textureId);
    if (!tex || !tex.source) continue;

    try {
      const response = await fetch(tex.source);
      const blob = await response.blob();
      const ext = blob.type === 'image/webp' ? 'webp' : 'png';
      const filename = `${sanitizeName(node.name)}.${ext}`;
      imagesFolder.file(filename, blob);
      onProgress?.(`Packing image: ${filename}`);
    } catch (err) {
      console.warn(`[Spine Export] Failed to fetch texture for ${node.name}:`, err);
    }
  }

  onProgress?.('Generating ZIP...');
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return zipBlob;
}

/**
 * Builds the Spine 4.0 JSON structure.
 *
 * Coordinate system:
 *   SS  — Y-down, origin top-left, transforms are stored in parent-local space
 *         (computeWorldMatrices gives true world canvas positions via mat[6/7])
 *   Spine — Y-up. Each bone's x/y is in the parent bone's local space (no rotation for setup pose).
 *
 * Conversion for a canvas of height H:
 *   spineWorldX = canvasWorldX
 *   spineWorldY = H - canvasWorldY
 *
 * Bone offset from parent:
 *   boneX = childSpineWorldX - parentSpineWorldX
 *   boneY = childSpineWorldY - parentSpineWorldY
 */
function buildSpineJson(project) {
  const { width: canvasW, height: canvasH } = project.canvas;
  const nodes = project.nodes;

  // ── World positions ───────────────────────────────────────────────────────
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Spine expects bone setup coordinates (x,y) to be local to the parent bone.
  // In Stretchy Studio, a node's local transform places its pivot at (x + pivotX, y + pivotY)
  // within its parent's un-transformed internal coordinate space.
  // The distance from the parent's pivot to the child's pivot in this local space is simply:
  // dx = (child.x + child.pivotX) - parent.pivotX
  // dy = (child.y + child.pivotY) - parent.pivotY
  const getLocalSpineOffset = (node) => {
    const nx = (node.transform?.x ?? 0) + (node.transform?.pivotX ?? 0);
    const ny = (node.transform?.y ?? 0) + (node.transform?.pivotY ?? 0);

    // If node has no parent, it attaches to Spine's anchor 'root' at (0,0).
    // So its local offset is just its Spine world position.
    if (!node.parent) {
      return { x: nx, y: canvasH - ny };
    }

    const parentNode = nodeMap.get(node.parent);
    if (!parentNode) {
      return { x: nx, y: canvasH - ny };
    }

    const px = parentNode.transform?.pivotX ?? 0;
    const py = parentNode.transform?.pivotY ?? 0;

    return {
      x: nx - px,
      y: -(ny - py) // Flip Y for Spine's coordinate system
    };
  };


  // ── 1. Skeleton info ──────────────────────────────────────────────────────
  const skeleton = {
    spine: "4.0",
    hash: uid(),
    name: "Exported Skeleton",
    width: canvasW,
    height: canvasH,
    fps: 24,
  };

  // ── 2. Bones ──────────────────────────────────────────────────────────────
  // Spine requires every file to have a bone named exactly "root" with no parent.
  const groups = nodes.filter(n => n.type === 'group');
  const bones = [{ name: 'root' }];
  const processedBones = new Set(['root']);
  let remaining = [...groups];

  while (remaining.length > 0) {
    const startCount = remaining.length;
    remaining = remaining.filter(group => {
      const parentName = group.parent ? nodeNameById(nodes, group.parent) : 'root';
      if (!processedBones.has(parentName)) return true; // parent not yet processed

      const t = group.transform || {};
      const pos = getLocalSpineOffset(group);

      bones.push({
        name: sanitizeName(group.name),
        parent: parentName,
        x: pos.x,
        y: pos.y,
        rotation: -requireFinite(t.rotation, 'rotation', group.name, 0),   // SS CW → Spine CCW
        scaleX: requireFinite(t.scaleX, 'scaleX', group.name, 1),
        scaleY: requireFinite(t.scaleY, 'scaleY', group.name, 1),
      });
      processedBones.add(sanitizeName(group.name));
      return false;
    });

    if (remaining.length === startCount) {
      // Cycle / missing parent — attach orphans directly to root
      remaining.forEach(g => {
        const pos = getLocalSpineOffset(g);
        bones.push({ name: sanitizeName(g.name), parent: 'root', x: pos.x, y: pos.y });
        processedBones.add(sanitizeName(g.name));
      });
      break;
    }
  }

  // ── 3. Slots ──────────────────────────────────────────────────────────────
  const parts = [...nodes]
    .filter(n => n.type === 'part')
    .sort((a, b) => (a.draw_order ?? 0) - (b.draw_order ?? 0));

  const slots = parts.map(part => ({
    name: sanitizeName(part.name),
    bone: part.parent ? nodeNameById(nodes, part.parent) : 'root',
    attachment: sanitizeName(part.name),
  }));

  // ── 4. Skins ──────────────────────────────────────────────────────────────
  // Region attachment x/y = center of the image in the parent bone's local space.
  // We get this by taking the part's world canvas position (which is the pivot
  // point — typically image center) and expressing it relative to the parent bone.
  const skinAttachments = {};

  for (const part of parts) {
    const t = part.transform || {};
    const pos = getLocalSpineOffset(part);  // pivot offset relative to parent bone's pivot

    const attachment = {
      type: "region",
      name: sanitizeName(part.name),
      x: pos.x,
      y: pos.y,
      rotation: -requireFinite(t.rotation, 'rotation', part.name, 0),
      width: part.imageWidth ?? canvasW,
      height: part.imageHeight ?? canvasH,
    };

    const partMesh = getMesh(part, project);
    if (partMesh) {
      attachment.type = "mesh";
      attachment.vertices = partMesh.vertices;
      attachment.uvs = partMesh.uvs;
      attachment.triangles = partMesh.triangles;
    }

    const slotKey = sanitizeName(part.name);
    if (!skinAttachments[slotKey]) skinAttachments[slotKey] = {};
    skinAttachments[slotKey][slotKey] = attachment;
  }

  const skins = [{ name: "default", attachments: skinAttachments }];

  // ── 5. Animations ─────────────────────────────────────────────────────────
  const animations = {};

  for (const action of project.actions) {
    const animName = sanitizeName(action.name);
    const spineAnim = { bones: {}, slots: {} };

    // Group node-target fcurves by node id (parameter-target fcurves don't
    // map to any Spine concept yet, so they're skipped here).
    const fcurvesByNode = {};
    for (const fc of action.fcurves) {
      const target = decodeFCurveTarget(fc);
      if (!target || target.kind !== 'node') continue;
      if (!fcurvesByNode[target.nodeId]) fcurvesByNode[target.nodeId] = [];
      fcurvesByNode[target.nodeId].push({ fcurve: fc, property: target.property });
    }

    for (const [nodeId, nodeFCurves] of Object.entries(fcurvesByNode)) {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;

      const targetName = sanitizeName(node.name);
      const isBone = node.type === 'group';

      if (isBone) {
        if (!spineAnim.bones[targetName]) spineAnim.bones[targetName] = {};
        const boneEntry = spineAnim.bones[targetName];

        for (const { fcurve, property } of nodeFCurves) {
          if (property === 'x' || property === 'y') {
            if (!boneEntry.translate) boneEntry.translate = [];
            for (const kf of fcurve.keyforms) {
              const time = kf.time / 1000;
              let entry = boneEntry.translate.find(e => Math.abs(e.time - time) < 0.001);
              if (!entry) { entry = { time, x: 0, y: 0 }; boneEntry.translate.push(entry); }
              const setup = node.transform[property] ?? 0;
              const delta = kf.value - setup;
              if (property === 'x') entry.x = delta;
              else entry.y = -delta;
              applySpineCurve(entry, kf);
            }
          } else if (property === 'rotation') {
            if (!boneEntry.rotate) boneEntry.rotate = [];
            for (const kf of fcurve.keyforms) {
              const setup = node.transform.rotation ?? 0;
              const entry = { time: kf.time / 1000, value: -(kf.value - setup) };
              applySpineCurve(entry, kf);
              boneEntry.rotate.push(entry);
            }
          } else if (property === 'scaleX' || property === 'scaleY') {
            if (!boneEntry.scale) boneEntry.scale = [];
            for (const kf of fcurve.keyforms) {
              const time = kf.time / 1000;
              let entry = boneEntry.scale.find(e => Math.abs(e.time - time) < 0.001);
              if (!entry) { entry = { time, x: 1, y: 1 }; boneEntry.scale.push(entry); }
              const setup = node.transform[property] ?? 1;
              if (property === 'scaleX') entry.x = kf.value / setup;
              else entry.y = kf.value / setup;
              applySpineCurve(entry, kf);
            }
          }
        }

        // Sort timelines
        boneEntry.translate?.sort((a, b) => a.time - b.time);
        boneEntry.rotate?.sort((a, b) => a.time - b.time);
        boneEntry.scale?.sort((a, b) => a.time - b.time);

      } else {
        // Slot animations (opacity → rgba)
        if (!spineAnim.slots[targetName]) spineAnim.slots[targetName] = {};
        const slotEntry = spineAnim.slots[targetName];

        for (const { fcurve, property } of nodeFCurves) {
          if (property === 'opacity') {
            if (!slotEntry.rgba) slotEntry.rgba = [];
            for (const kf of fcurve.keyforms) {
              const hexA = Math.round(kf.value * 255).toString(16).padStart(2, '0');
              const entry = { time: kf.time / 1000, color: `ffffff${hexA}` };
              applySpineCurve(entry, kf);
              slotEntry.rgba.push(entry);
            }
            slotEntry.rgba.sort((a, b) => a.time - b.time);
          }
        }
      }
    }

    animations[animName] = spineAnim;
  }

  return { skeleton, bones, slots, skins, animations };
}

function nodeNameById(nodes, id) {
  const n = nodes.find(x => x.id === id);
  return n ? sanitizeName(n.name) : 'root';
}

function sanitizeName(name) {
  const s = (name ?? 'item')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s === 'root' ? 'rig_root' : s;
}

function applySpineCurve(entry, kf) {
  // v39 BezTriple: read kf.interpolation (was kf.easing pre-v39).
  // Slice 2.G will derive Spine's curve[] from kf.handleLeft / kf.handleRight
  // for true per-keyform bezier export. Today bezier degrades to the
  // legacy ease-both preset (matches pre-v39 default).
  const interp = kf.interpolation;
  if (interp === 'linear') return;
  if (interp === 'constant') {
    entry.curve = 'stepped';
    return;
  }
  // 'bezier' or any named easing → preset cubic-bezier.
  // Slice 2.C ships the per-easing preset table; Slice 2.G upgrades to
  // handle-derived control points.
  entry.curve = [0.42, 0, 0.58, 1];
}


