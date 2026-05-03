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

import { computePoseOverrides } from '../../../renderer/animationEngine.js';

/**
 * @typedef {Object} CaptureOptions
 * @property {string|null} [animId]            - active animation id, or null for rest pose
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
    animId = null,
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

  // Compute pose at timeMs (animation playback) and bake blend-shape
  // deformations into mesh_verts so the GPU sees the right vertices.
  /** @type {Map<string, any>|null} */
  let poseOverrides = null;
  if (animId) {
    const anim = exportProject.animations.find((a) => a.id === animId);
    if (anim) {
      poseOverrides = computePoseOverrides(anim, timeMs, loopKeyframes, anim.duration ?? 0);

      for (const node of exportProject.nodes) {
        if (node.type !== 'part' || !node.mesh) continue;

        /** @type {Array<{x: number, y: number}>|null} */
        let currentMeshVerts = null;

        // Blend shapes
        if (node.blendShapes?.length) {
          const influences = node.blendShapes.map((shape) => {
            const prop = `blendShape:${shape.id}`;
            return poseOverrides.get(node.id)?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;
          });
          if (influences.some((v) => v !== 0)) {
            currentMeshVerts = node.mesh.vertices.map((v, i) => {
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

  // Upload deformed mesh verts to GPU before rendering, remember
  // which parts we touched so we can restore them after capture.
  /** @type {string[]} */
  const exportMeshOverridden = [];
  if (poseOverrides) {
    for (const [nodeId, ov] of poseOverrides) {
      if (!ov.mesh_verts) continue;
      const node = exportProject.nodes.find((n) => n.id === nodeId);
      if (node?.mesh) {
        scene.parts.uploadPositions(nodeId, ov.mesh_verts, new Float32Array(node.mesh.uvs));
        exportMeshOverridden.push(nodeId);
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
    if (node?.mesh) {
      scene.parts.uploadPositions(nodeId, node.mesh.vertices, new Float32Array(node.mesh.uvs));
    }
  }

  return dataUrl;
}
