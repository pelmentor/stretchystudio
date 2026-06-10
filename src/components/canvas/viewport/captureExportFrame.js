// @ts-check

/**
 * v3 Phase 0F.2 — Export-frame capture (extracted from CanvasViewport).
 *
 * Produces a `dataURL` of the project rendered at a specific
 * animation timestamp into a target canvas. Used by:
 *
 *   - PNG / JPG / WebP single-frame export
 *   - per-frame loops for animation export (caller iterates timeMs)
 *
 * The function is pure-ish: it takes the canvas / scene / editor /
 * project state as inputs and returns the data URL. The only side
 * effects are on the DOM canvas (resized to target dimensions and
 * its GPU buffers temporarily overridden with deformed mesh verts);
 * those are restored before return.
 *
 * Plan §3 viewport/ split + Phase 0F.2 of the V3 refactor.
 *
 * @module components/canvas/viewport/captureExportFrame
 */

import { computePoseOverrides, computeParamOverrides } from '../../../renderer/animationEngine.js';
import { evalProjectFrameViaDepgraph } from '../../../anim/depgraph/evalProjectFrame.js';
import { getMesh } from '../../../store/objectDataAccess.js';

/**
 * @typedef {Object} CaptureOptions
 * @property {string|null} [actionId]          - active action id, or null for rest pose
 * @property {number} [timeMs=0]
 * @property {boolean} [bgEnabled=false]
 * @property {string} [bgColor]                - composited under transparent render when bgEnabled
 * @property {number} exportWidth
 * @property {number} exportHeight
 * @property {('png'|'jpg'|'webp')} [format='png']
 * @property {number} [quality=0.92]           - 0..1 for jpg/webp; ignored for png
 * @property {{x: number, y: number}|null} [cropOffset]
 * @property {boolean} [loopKeyframes=false]
 *
 * @typedef {Object} CaptureContext
 * @property {HTMLCanvasElement} canvas
 * @property {{
 *   parts: { uploadPositions: (id: string, verts: any, uvs: Float32Array) => void },
 *   draw: (project: any, editor: any, isDark: boolean, poseOverrides: Map<string, any>|null, opts: object) => void,
 * }} scene
 * @property {object} editor
 * @property {object} project
 * @property {boolean} isDark
 * @property {number} [globalOpacity=1]   - PP2-008 — ParamOpacity multiplier (1 = opaque)
 */

/**
 * Capture a single export frame and return its data URL.
 *
 * @param {CaptureContext} ctx
 * @param {CaptureOptions} opts
 * @returns {string|null}
 */
export function captureExportFrame(ctx, opts) {
  const { canvas, scene, editor, project, isDark, globalOpacity = 1 } = ctx;
  if (!canvas || !scene) return null;

  const {
    actionId = null,
    timeMs = 0,
    bgEnabled = false,
    bgColor,
    exportWidth,
    exportHeight,
    format = 'png',
    quality = 0.92,
    cropOffset = null,
    loopKeyframes = false,
  } = opts ?? {};

  // Set canvas to export dimensions.
  canvas.width = exportWidth;
  canvas.height = exportHeight;

  // Mock editor: 1:1 pixel space, image only — every overlay stripped so
  // the captured frame is render-clean (matches what a viewer ships).
  const panX = cropOffset ? -cropOffset.x : 0;
  const panY = cropOffset ? -cropOffset.y : 0;
  const exportEditor = {
    ...editor,
    view: { zoom: 1, panX, panY },
    selection: [],
    editMode: null,
    activeBlendShapeId: null,
    viewLayers: {
      image: true,
      wireframe: false,
      vertices: false,
      edgeOutline: false,
      skeleton: false,
      irisClipping: editor?.viewLayers?.irisClipping ?? true,
      warpGrids: false,
      rotationPivots: false,
    },
  };

  // Always render transparent; composite the bg colour ourselves
  // afterwards so JPG / WebP exports get a solid background and PNG
  // exports stay alpha-clean.
  const exportProject = {
    ...project,
    canvas: { ...project.canvas, bgEnabled: false },
  };

  // Compute pose + param overrides at timeMs (animation playback) and
  // bake every art mesh's deformed vertices via the depgraph.
  //
  // Pre-fix this path only computed `computePoseOverrides` (which
  // walks node-targeted fcurves — bone rotation, slot opacity, etc.).
  // Param-targeted fcurves (which drive Live2D's per-param warp grids
  // — i.e. EVERY procedural motion: idle, look-*, embarrassed, etc.)
  // were silently skipped, so PNG sequence exports of param-driven
  // motions came out as identical rest-pose frames (user report
  // 2026-06-10).
  //
  // Mirrors CanvasViewport's live tick at `CanvasViewport.jsx:773-799`
  // + `:1252` — `computeParamOverrides` populates the param values
  // for the action at this time, then `evalProjectFrameViaDepgraph`
  // runs every kernel (TRANSFORM_COMPOSE, ART_MESH_EVAL, …) to
  // produce final per-part vertex positions. Mesh blend-shape bake
  // still happens here for the rare blendShape-driven case the
  // depgraph doesn't cover yet.
  /** @type {Map<string, any>|null} */
  let poseOverrides = null;
  /** @type {Record<string, number>} */
  let paramValuesForEval = {};
  /** @type {any} */
  let actionForEval = null;
  if (actionId) {
    const action = exportProject.actions.find((a) => a.id === actionId);
    if (action) {
      actionForEval = action;
      const endMs = action.duration ?? 0;
      poseOverrides = computePoseOverrides(action, timeMs, loopKeyframes, endMs);

      // Seed paramValues: project defaults → action's param fcurves
      // override at timeMs. The depgraph's ANIMATION_TRACK_EVAL also
      // walks the action internally, but pre-seeding ensures dependent
      // chain inputs (e.g. driver formulas reading other params) read
      // the animated values consistently.
      for (const p of exportProject.parameters ?? []) {
        if (p && typeof p.id === 'string' && typeof p.default === 'number') {
          paramValuesForEval[p.id] = p.default;
        }
      }
      const paramOv = computeParamOverrides(action, timeMs, loopKeyframes, endMs);
      for (const [pid, v] of paramOv) {
        if (Number.isFinite(v)) paramValuesForEval[pid] = v;
      }

      for (const node of exportProject.nodes) {
        const mesh = getMesh(node, exportProject);
        if (node.type !== 'part' || !mesh) continue;

        /** @type {Array<{x: number, y: number}>|null} */
        let currentMeshVerts = null;

        // Blend shapes
        if (node.blendShapes?.length) {
          const influences = node.blendShapes.map((shape) => {
            const prop = `blendShape:${shape.id}`;
            return poseOverrides.get(node.id)?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;
          });
          if (influences.some((v) => v !== 0)) {
            currentMeshVerts = mesh.vertices.map((v, i) => {
              let bx = v.restX;
              let by = v.restY;
              for (let j = 0; j < node.blendShapes.length; j++) {
                const d = node.blendShapes[j].deltas[i];
                if (d) {
                  bx += d.dx * influences[j];
                  by += d.dy * influences[j];
                }
              }
              return { x: bx, y: by };
            });
          }
        }

        if (currentMeshVerts) {
          const existing = poseOverrides.get(node.id) ?? {};
          poseOverrides.set(node.id, { ...existing, mesh_verts: currentMeshVerts });
        }
      }
    }
  }

  // Depgraph eval — produces per-part `vertexPositions` arrays after
  // every warp / rotation / bone-driven deformer has run with the
  // animated param values. We upload these to the GPU instead of (or
  // in addition to) the blend-shape baked verts above.
  /** @type {string[]} */
  const exportMeshOverridden = [];
  if (actionForEval) {
    let frames = [];
    try {
      frames = evalProjectFrameViaDepgraph(exportProject, paramValuesForEval, {
        action: actionForEval,
        timeMs,
        poseOverrides: poseOverrides ?? undefined,
      });
    } catch (err) {
      // Depgraph throws on malformed input — we'd rather export a
      // rest-pose frame than crash the whole sequence. Logged via
      // console so the failure is visible in DevTools without
      // toasting the user on every frame.
      console.error('[captureExportFrame] depgraph eval failed:', err);
      frames = [];
    }
    for (const frame of frames) {
      if (!frame?.id || !frame.vertexPositions) continue;
      const node = exportProject.nodes.find((n) => n.id === frame.id);
      const m = getMesh(node, exportProject);
      if (!m) continue;
      scene.parts.uploadPositions(frame.id, frame.vertexPositions, new Float32Array(m.uvs));
      exportMeshOverridden.push(frame.id);
    }
  }

  // Blend-shape mesh_verts overrides (rare, depgraph doesn't cover
  // them yet) — upload AFTER the depgraph pass so they win for
  // shapekey-only parts.
  if (poseOverrides) {
    for (const [nodeId, ov] of poseOverrides) {
      if (!ov.mesh_verts) continue;
      const node = exportProject.nodes.find((n) => n.id === nodeId);
      const m = getMesh(node, exportProject);
      if (m) {
        scene.parts.uploadPositions(nodeId, ov.mesh_verts, new Float32Array(m.uvs));
        if (!exportMeshOverridden.includes(nodeId)) exportMeshOverridden.push(nodeId);
      }
    }
  }

  // Render. skipResize / exportMode skip the rAF resize guard and
  // background renderer that the live tick uses.
  scene.draw(exportProject, exportEditor, isDark, poseOverrides, {
    skipResize: true,
    exportMode: true,
    globalOpacity,
  });

  const mimeType = format === 'jpg'
    ? 'image/jpeg'
    : format === 'webp' ? 'image/webp' : 'image/png';

  let dataUrl;
  if (bgEnabled && bgColor) {
    // Composite over solid bg colour for JPG / WebP exports.
    const off = document.createElement('canvas');
    off.width = exportWidth;
    off.height = exportHeight;
    const ctx2d = off.getContext('2d');
    if (!ctx2d) return null;
    ctx2d.fillStyle = bgColor;
    ctx2d.fillRect(0, 0, exportWidth, exportHeight);
    ctx2d.drawImage(canvas, 0, 0);
    dataUrl = off.toDataURL(mimeType, quality);
  } else {
    dataUrl = canvas.toDataURL(mimeType, quality);
  }

  // Restore original mesh positions in the GPU so the next live
  // render sees the correct rest verts.
  for (const nodeId of exportMeshOverridden) {
    const node = exportProject.nodes.find((n) => n.id === nodeId);
    const m = getMesh(node, exportProject);
    if (m) {
      scene.parts.uploadPositions(nodeId, m.vertices, new Float32Array(m.uvs));
    }
  }

  return dataUrl;
}
