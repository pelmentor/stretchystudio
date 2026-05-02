/**
 * ScenePass — orchestrates the full render pass.
 *
 * - Computes per-node world matrices (depth-first hierarchy pass)
 * - Sorts parts by draw_order
 * - Builds camera MVP from view (zoom/pan)
 * - Multiplies camera MVP × world matrix for each part
 * - Issues draw calls via PartRenderer
 * - Respects editor.viewLayers and node.visible
 */
import { createProgram } from './program.js';
import { MESH_VERT, MESH_FRAG, WIRE_VERT, WIRE_FRAG } from './shaders/mesh.js';
import { PartRenderer } from './partRenderer.js';
import { BackgroundRenderer } from './backgroundRenderer.js';
import { computeWorldMatrices, computeEffectiveProps, mat3Mul } from './transforms.js';
import { resolveMaskConfigs } from '../io/live2d/rig/maskConfigs.js';
import { allocateMaskStencils } from './maskStencil.js';

/**
 * Build the camera MVP: maps image-pixel world coords → NDC.
 *   scale by zoom, translate by pan, flip Y, normalise by canvas size.
 *
 * @returns {Float32Array} 9-element column-major mat3
 */
function buildCameraMatrix(canvasW, canvasH, zoom, panX, panY) {
  const sx = (2 * zoom) / canvasW;
  const sy = -(2 * zoom) / canvasH; // flip Y (WebGL Y is up)
  const tx = (panX / canvasW) * 2 - 1;
  const ty = 1 - (panY / canvasH) * 2;

  // Column-major mat3:
  // [ sx   0  0 ]
  // [  0  sy  0 ]
  // [ tx  ty  1 ]
  return new Float32Array([
    sx,  0,   0,
    0,   sy,  0,
    tx,  ty,  1,
  ]);
}

export class ScenePass {
  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;

    const meshProg = createProgram(gl, MESH_VERT, MESH_FRAG);
    const wireProg = createProgram(gl, WIRE_VERT, WIRE_FRAG);

    this.meshProgram  = meshProg.program;
    this.meshUniforms = meshProg.uniforms;
    this.wireProgram  = wireProg.program;
    this.wireUniforms = wireProg.uniforms;

    this.bgRenderer   = new BackgroundRenderer(gl);
    this.partRenderer = new PartRenderer(gl, this.meshProgram, this.wireProgram);

    this.uIsPointLoc = gl.getUniformLocation(this.wireProgram, 'u_is_point');

    this.gl.enable(gl.BLEND);
    this.gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Main draw call. Called once per rAF when the scene is dirty.
   *
   * @param {Object}  project       - projectStore.project
   * @param {Object}  editor        - editorStore state
   * @param {boolean} isDark        - whether current theme is dark
   * @param {Map}     poseOverrides - optional Map<nodeId, {x?,y?,rotation?,scaleX?,scaleY?,opacity?}>
   *                                  from animationStore; applied on top of stored transforms
   * @param {Object}  [opts]
   * @param {boolean} [opts.skipResize=false]
   * @param {boolean} [opts.exportMode=false]
   * @param {Set<string>|null} [opts.rigDrivenParts=null]
   *   v2 R6 / v3 -1B: parts whose mesh_verts came from `evalRig` are
   *   already in canvas-px (absolute) — chainEval composes the entire
   *   parent chain to root, with the rotation→warp boundary scale fix
   *   from chainEval.js (Phase 1E commit `c07751b`) producing canonical
   *   canvas-px output. For those parts, applying the per-part
   *   `worldMatrix` on top would double-transform.
   *
   *   Specifically: when the user drags a SkeletonOverlay rotation arc,
   *   the same gesture writes BOTH `node.transform.rotation` AND the
   *   bone rotation parameter. evalRig's chain applies the rotation via
   *   the deformer; `worldMatrix` would apply it again via the
   *   transform. Skip-worldMatrix for rig-driven parts prevents the
   *   double rotation.
   *
   *   When this set contains a part id, draw uses `camera` directly
   *   (no worldMatrix multiplication). Empty/null = legacy behavior
   *   (every part gets its worldMatrix).
   */
  draw(project, editor, isDark = true, poseOverrides = null, { skipResize = false, exportMode = false, rigDrivenParts = null } = {}) {
    const { gl } = this;
    const { canvas } = gl;

    // Resize if needed (skipped during export to preserve export dimensions)
    if (!skipResize) {
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width  = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }
    }

    gl.viewport(0, 0, canvas.width, canvas.height);

    // Clear stencil buffer (requires mask to be enabled)
    gl.stencilMask(0xFF);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);

    // In export mode, clear to transparent and skip background renderer
    if (exportMode) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    const { zoom, panX, panY } = editor.view;
    const canvasArea = project?.canvas ?? null;
    if (!exportMode) {
      this.bgRenderer.draw(zoom, panX, panY, canvas.width, canvas.height, isDark, canvasArea);
    }

    if (!project || project.nodes.length === 0) return;

    const camera = buildCameraMatrix(canvas.width, canvas.height, zoom, panX, panY);

    const viewLayers   = editor.viewLayers ?? {};
    const selectionSet = new Set(editor.selection ?? []);
    // Dim non-selected parts when the user is in mesh / blendShape edit
    // — both are vertex-level edit contexts where focusing on the
    // selection helps. Skeleton edit doesn't dim (bones move, mesh stays
    // legible).
    const dimUnselected = (editor.editMode === 'mesh' || editor.editMode === 'blendShape')
      && selectionSet.size > 0;

    // ── Apply pose overrides (from animation playback) ────────────────────
    // Build an effective node list with interpolated transforms merged in.
    // This avoids mutating projectStore state during playback.
    const effectiveNodes = (poseOverrides && poseOverrides.size > 0)
      ? project.nodes.map(node => {
          const ov = poseOverrides.get(node.id);
          if (!ov) return node;
          const transformOv = { ...node.transform };
          for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY']) {
            if (ov[k] !== undefined) transformOv[k] = ov[k];
          }
          return {
            ...node,
            transform: transformOv,
            opacity: ov.opacity !== undefined ? ov.opacity : node.opacity,
            visible: ov.visible !== undefined ? ov.visible : node.visible,
          };
        })
      : project.nodes;

    // ── Hierarchy pass: compute world matrix and effective vis/opacity ────
    const worldMatrices = computeWorldMatrices(effectiveNodes);
    const { visMap, opMap } = computeEffectiveProps(effectiveNodes);

    // Sort parts by draw_order ascending (groups are never rendered directly)
    const parts = effectiveNodes
      .filter(n => n.type === 'part')
      .sort((a, b) => a.draw_order - b.draw_order);

    // ── Stencil mask state ────────────────────────────────────────────────
    // R7 — generalised mask system. Each unique mask mesh referenced by
    // any clip pair gets a 1-based stencil ID; masked meshes test against
    // that ID. Replaces the old `getIrisStencilInfo(name)` heuristic that
    // relied on hardcoded "irides" / "eyewhite" tag names + side suffix
    // parsing. `viewLayers.irisClipping` is preserved as the master toggle
    // (the option's user-facing label still says "iris clipping" but it
    // now governs all clip-mask pairs).
    const stencilState = viewLayers.irisClipping !== false
      ? allocateMaskStencils(resolveMaskConfigs(project))
      : { stencilByMaskMeshId: new Map(), stencilsByMaskedMeshId: new Map(), overflow: 0 };

    // ── Textured mesh pass ────────────────────────────────────────────────
    if (viewLayers.image !== false) {
      gl.useProgram(this.meshProgram);
      const uMvp     = this.meshUniforms('u_mvp');
      const uTexture = this.meshUniforms('u_texture');
      const uOpacity = this.meshUniforms('u_opacity');

      for (const part of parts) {
        if (!visMap.get(part.id)) continue;

        // ── Stencil clipping ──
        // Three cases:
        //   1. Mesh is a *mask* — write its allocated stencil ID, use REPLACE.
        //   2. Mesh is *masked* — test stencil against its target IDs.
        //      Multi-mask uses one draw call per target (today's data is
        //      single-mask, so this collapses to one call).
        //   3. Neither — disable the stencil test for this mesh.
        const writeStencil = stencilState.stencilByMaskMeshId.get(part.id);
        const readStencils = stencilState.stencilsByMaskedMeshId.get(part.id);

        const worldMatrix = worldMatrices.get(part.id);
        const isRigDriven = rigDrivenParts?.has(part.id);
        const partMvp     = isRigDriven
          ? camera
          : (worldMatrix ? mat3Mul(camera, worldMatrix) : camera);

        const baseOpacity = opMap.get(part.id) ?? 1;
        const effectiveOpacity = dimUnselected && !selectionSet.has(part.id)
          ? baseOpacity * 0.5
          : baseOpacity;

        if (writeStencil != null) {
          gl.enable(gl.STENCIL_TEST);
          gl.stencilFunc(gl.ALWAYS, writeStencil, 0xFF);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
          gl.stencilMask(0xFF);
          this.partRenderer.drawPart(part.id, partMvp, effectiveOpacity, uMvp, uTexture, uOpacity);
        } else if (readStencils && readStencils.length > 0) {
          gl.enable(gl.STENCIL_TEST);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          gl.stencilMask(0x00);
          for (const s of readStencils) {
            gl.stencilFunc(gl.EQUAL, s, 0xFF);
            this.partRenderer.drawPart(part.id, partMvp, effectiveOpacity, uMvp, uTexture, uOpacity);
          }
        } else {
          gl.disable(gl.STENCIL_TEST);
          this.partRenderer.drawPart(part.id, partMvp, effectiveOpacity, uMvp, uTexture, uOpacity);
        }
      }
      gl.disable(gl.STENCIL_TEST);
    }

    // ── Overlay pass (wireframe / vertices / edge outline) ────────────────
    const needWirePass = viewLayers.wireframe || viewLayers.vertices ||
                         viewLayers.edgeOutline || selectionSet.size > 0;

    if (needWirePass) {
      gl.useProgram(this.wireProgram);
      const uMvpW  = this.wireUniforms('u_mvp');
      const uColor = this.wireUniforms('u_color');

      // Mesh edit forces wireframe + vertices on for the active part —
      // Blender pattern: in Edit Mode you always see what you're
      // editing, regardless of "show wireframe" toggle. selection is
      // the active part's identity, so we only force on the SELECTED
      // part(s), not all parts. (The user-side viewLayers toggle
      // continues to govern visibility for unselected parts.)
      const inMeshEdit = editor.editMode === 'mesh';

      for (const part of parts) {
        if (!visMap.get(part.id)) continue;
        const isSelected = selectionSet.has(part.id);
        const forceWire = inMeshEdit && isSelected;

        const worldMatrix = worldMatrices.get(part.id);
        const isRigDriven = rigDrivenParts?.has(part.id);
        const partMvp     = isRigDriven
          ? camera
          : (worldMatrix ? mat3Mul(camera, worldMatrix) : camera);

        gl.uniform1i(this.uIsPointLoc, 0); // not a point

        // Edge outline — semi-transparent dark gray
        if (viewLayers.edgeOutline || isSelected) {
          gl.uniform4f(uColor, 0.0, 0.0, 0.0, isSelected ? 0.7 : 0.35);
          this.partRenderer.drawEdgeOutline(part.id, partMvp, uMvpW);
        }

        // Wireframe triangles — 25% opaque dark gray
        if (viewLayers.wireframe || isSelected || forceWire) {
          gl.uniform4f(uColor, 0.0, 0.0, 0.0, 0.25);
          this.partRenderer.drawWireframe(part.id, partMvp, uMvpW, uColor);
        }

        // Vertices — white circles with black outline (shader handles styling)
        gl.uniform1i(this.uIsPointLoc, 1);
        if (viewLayers.vertices || isSelected || forceWire) {
          this.partRenderer.drawVertices(part.id, partMvp, uMvpW, uColor);
        }
      }
    }
  }

  /** Pass-through to PartRenderer for external callers */
  get parts() { return this.partRenderer; }

  destroy() {
    this.partRenderer.destroyAll();
    const { gl } = this;
    this.bgRenderer.destroy();
    gl.deleteProgram(this.meshProgram);
    gl.deleteProgram(this.wireProgram);
  }
}
