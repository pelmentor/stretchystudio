/**
 * Rig data layer — single source of truth shared by `cmo3writer.js`
 * (XML emission) and `moc3writer.js` (binary emission). Replaces the inline
 * rig-construction logic that used to live across cmo3writer + cmo3/* helpers.
 *
 * The contract: rig generators (warpDeformers.js, rotationDeformers.js, …)
 * return pure data structured below. Both writers translate the data into
 * their target format. Anything that diverges between the two outputs is a
 * translator bug, not a logic difference — parity is by construction.
 *
 * This module defines ONLY types (JSDoc) plus a couple of trivial helpers.
 * No emission logic. No XmlBuilder. No binary writers. Pure data.
 *
 * See `docs/live2d-export/RUNTIME_PARITY_PLAN.md` for the migration plan
 * mapping legacy inline code to the new modules.
 *
 * @module io/live2d/rig/rigSpec
 */

// ---------------------------------------------------------------------------
// Coordinate frames
// ---------------------------------------------------------------------------

/**
 * Local-frame conventions used by warp/rotation deformer keyform positions.
 *
 * Each warp/rotation deformer stores keyform positions in a coordinate space
 * relative to its parent. The Cubism Editor's `DeformerLocal` label is the
 * SAME for all of them, but the actual scale depends on the parent type:
 *
 * - `'canvas-px'`        — positions are in raw canvas pixels. Used when the
 *                          deformer's parent is the ROOT part (no enclosing
 *                          deformer). Body X Warp / Body Y / Breath / etc
 *                          all sit at the top of the chain in this frame.
 *
 * - `'normalized-0to1'`  — positions are normalised to [0..1] within the
 *                          parent warp deformer's grid. Used when the parent
 *                          is another CWarpDeformerSource. The parent's grid
 *                          maps its own keyform-position 0..1 box to its
 *                          own local frame, so children must pre-normalise
 *                          theirs.
 *
 * - `'pivot-relative'`   — positions are canvas-px OFFSETS from the parent
 *                          rotation deformer's pivot point. Used when the
 *                          parent is a CRotationDeformerSource. The parent
 *                          applies its rotation around its pivot; the child
 *                          contributes pre-rotated offsets.
 *
 * Rule of thumb (mirrors `reference_cubism_deformer_local_frames` memory):
 *
 *     ROOT parent              → canvas-px
 *     Warp parent              → normalized-0to1
 *     Rotation parent          → pivot-relative
 *
 * `RigSpec` translators consume `localFrame` to compute the right scaling
 * when emitting (cmo3 keeps it as-is in XML; moc3 may need additional
 * normalisation for its binary keyform_position section).
 *
 * @typedef {('canvas-px'|'normalized-0to1'|'pivot-relative')} LocalFrame
 */

// ---------------------------------------------------------------------------
// Parent reference
// ---------------------------------------------------------------------------

/**
 * A parent reference. Deformers and art meshes are parented either to a part,
 * to another deformer, or to the implicit root (which is encoded as a part in
 * cmo3 and as `parent_part_index = -1` in moc3).
 *
 * `id` is the RigSpec-level identifier of the parent. Translators look it up
 * in the appropriate map (parts / warpDeformers / rotationDeformers) when
 * producing format-specific references.
 *
 * @typedef {Object} RigSpecParent
 * @property {('root'|'part'|'warp'|'rotation')} type
 * @property {string|null} id  - Parent's RigSpec id; null for type='root'.
 */

// ---------------------------------------------------------------------------
// Parameter binding (one parameter axis driving a deformer / art mesh)
// ---------------------------------------------------------------------------

/**
 * A binding ties a parameter axis to a set of key values where keyforms exist.
 * One deformer / art mesh can have multiple bindings (cross-product 2D grid,
 * e.g. eye 2D compound: ParamEyeLOpen × Param<Suffix>).
 *
 * The number of keyforms a host has = product of `keys.length` across all
 * its bindings (cross-product). Keyforms are ordered such that the first
 * binding varies slowest (cmo3 / moc3 both use this convention — verified
 * against Hiyori).
 *
 * @typedef {Object} KeyformBindingSpec
 * @property {string} parameterId          - Live2D param id (e.g. "ParamAngleZ")
 * @property {number[]} keys               - Param values at which keyforms exist;
 *                                            usually 2 or 3 (e.g. [-30, 0, 30]).
 * @property {('LINEAR'|'BEZIER')} [interpolation='LINEAR']
 *                                            How runtime interpolates between
 *                                            keys. Defaults to LINEAR (matches
 *                                            current emitKfBinding behaviour).
 */

// ---------------------------------------------------------------------------
// Keyforms
// ---------------------------------------------------------------------------

/**
 * One cell in a deformer's cross-product keyform grid.
 *
 * `keyTuple` is the list of key values, one per binding (in binding order).
 * For a single-binding deformer with keys `[-30, 0, 30]`, you get three
 * keyforms with `keyTuple` `[-30]`, `[0]`, `[30]` respectively.
 *
 * @typedef {Object} WarpKeyformSpec
 * @property {number[]} keyTuple
 * @property {Float64Array} positions      - (cols+1)*(rows+1)*2 floats; semantics
 *                                            controlled by `WarpDeformerSpec.localFrame`.
 * @property {number} [opacity=1.0]
 */

/**
 * @typedef {Object} RotationKeyformSpec
 * @property {number[]} keyTuple
 * @property {number} angle                - Rotation angle in degrees.
 * @property {number} originX              - Pivot X (in deformer's local frame).
 * @property {number} originY              - Pivot Y (in deformer's local frame).
 * @property {number} [scale=1.0]
 * @property {boolean} [reflectX=false]
 * @property {boolean} [reflectY=false]
 * @property {number} [opacity=1.0]
 */

/**
 * @typedef {Object} ArtMeshKeyformSpec
 * @property {number[]} keyTuple
 * @property {Float32Array} vertexPositions - 2*N floats matching the host
 *                                            ArtMeshSpec.verticesCanvas count.
 *                                            Semantics: parent-deformer-local
 *                                            (translator handles canvas →
 *                                            local conversion using parent's
 *                                            world origin / pivot).
 * @property {number} [opacity=1.0]
 * @property {number} [drawOrder=500]
 */

// ---------------------------------------------------------------------------
// Deformers
// ---------------------------------------------------------------------------

/**
 * A grid-based warp deformer. Vertex offsets across the cross-product of
 * its bindings define the deformation field.
 *
 * `baseGrid` is the rest-pose grid — the position of every control point
 * when ALL bindings are at their "rest" key (typically 0 for symmetric
 * params, `default` for asymmetric ones). `keyforms` provide the offsets
 * for each cross-product cell.
 *
 * `gridSize` is `{rows, cols}` where the grid has `(rows+1) × (cols+1)`
 * control points. Most rig warps use 5×5 (6×6 control points). Per-mesh
 * structural warps can be smaller.
 *
 * @typedef {Object} WarpDeformerSpec
 * @property {string} id                    - RigSpec-level identifier; emitted
 *                                            as cmo3's CDeformerId idstr and
 *                                            also drives moc3 deformer ordering.
 * @property {string} name                  - Display name in Cubism Editor.
 * @property {RigSpecParent} parent         - Parent (part / deformer / root).
 * @property {{rows:number, cols:number}} gridSize
 * @property {Float64Array} baseGrid        - (cols+1)*(rows+1)*2 floats.
 * @property {LocalFrame} localFrame
 * @property {KeyformBindingSpec[]} bindings
 * @property {WarpKeyformSpec[]} keyforms   - In cross-product order: first
 *                                            binding varies slowest.
 * @property {boolean} [isVisible=true]
 * @property {boolean} [isLocked=false]
 * @property {boolean} [isQuadTransform=false]
 */

/**
 * A rotation deformer (CRotationDeformerSource). Applies a single rotation
 * around `originX/originY` in the parent's local frame. Multiple keyforms
 * permit angle morphing across a parameter axis (e.g. ParamAngleZ -30..+30
 * → -10..+10 rotation).
 *
 * @typedef {Object} RotationDeformerSpec
 * @property {string} id
 * @property {string} name
 * @property {RigSpecParent} parent
 * @property {KeyformBindingSpec[]} bindings
 * @property {RotationKeyformSpec[]} keyforms
 * @property {number} [baseAngle=0]
 * @property {number} [handleLengthOnCanvas=200]
 * @property {number} [circleRadiusOnCanvas=100]
 * @property {boolean} [isVisible=true]
 * @property {boolean} [isLocked=false]
 * @property {boolean} [useBoneUiTestImpl=true]
 */

// ---------------------------------------------------------------------------
// Art meshes
// ---------------------------------------------------------------------------

/**
 * A renderable mesh. `verticesCanvas` are the rest positions in canvas pixels;
 * the translator converts them to deformer-local for keyform emission. Each
 * `keyform.vertexPositions` lives in PARENT-DEFORMER-LOCAL space already
 * (the rig builder is responsible for this conversion — see
 * `feedback_dual_positions` memory and the body of cmo3writer's CArtMeshSource
 * emission, lines 3635–4068).
 *
 * @typedef {Object} ArtMeshSpec
 * @property {string} id
 * @property {string} name
 * @property {RigSpecParent} parent
 * @property {Float32Array} verticesCanvas - [x0,y0, x1,y1, …] canvas-px.
 * @property {Uint16Array}  triangles      - Flat [i0,j0,k0, …].
 * @property {Float32Array} uvs            - [u0,v0, …] 0..1 of full source PSD;
 *                                           atlas remap happens in the moc3
 *                                           translator using PackedRegion.
 * @property {string|null} variantSuffix   - For variant pairing; null otherwise.
 * @property {string|null} textureId       - Project node id used to look up
 *                                           the atlas region.
 * @property {KeyformBindingSpec[]} bindings
 * @property {ArtMeshKeyformSpec[]} keyforms
 * @property {string[]} [maskMeshIds]      - Other art mesh ids that mask this one.
 * @property {boolean} [isVisible=true]
 * @property {number}  [drawOrder]
 */

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/**
 * A part (CPartSource in cmo3, parts entry in moc3). Pure structural node.
 *
 * @typedef {Object} PartSpec
 * @property {string} id
 * @property {string} name
 * @property {string|null} parentPartId    - null for root.
 * @property {boolean} [isVisible=true]
 * @property {number}  [opacity=1]
 */

// ---------------------------------------------------------------------------
// Top-level RigSpec
// ---------------------------------------------------------------------------

/**
 * The full rig data passed to format translators.
 *
 * Order of arrays is the canonical emission order. cmo3 / moc3 writers walk
 * each array in sequence — array index === emission index. Translators must
 * NOT reorder; if reordering is needed (e.g. parent-before-child), the rig
 * builder should produce the array in the right order to begin with.
 *
 * @typedef {Object} RigSpec
 * @property {import('./paramSpec.js').ParamSpec[]} parameters
 * @property {PartSpec[]} parts
 * @property {WarpDeformerSpec[]} warpDeformers
 * @property {RotationDeformerSpec[]} rotationDeformers
 * @property {ArtMeshSpec[]} artMeshes
 * @property {{w:number, h:number}} canvas
 * @property {((cx:number)=>number)|null} [canvasToInnermostX]
 *   When the body warp chain is built, this is the canvas-px → innermost-warp
 *   (BodyXWarp) 0..1 normaliser. moc3writer uses it to project mesh vertex
 *   positions into the parent deformer's frame so deformations layer
 *   correctly in the runtime.
 * @property {((cy:number)=>number)|null} [canvasToInnermostY]
 * @property {string|null} [innermostBodyWarpId]
 *   ID of the innermost body warp (typically `'BodyXWarp'`). Mesh
 *   `parent_deformer_index` defaults to this in moc3.
 * @property {Object} [debug]              - Optional rig debug log; mirrors the
 *                                            existing `rigDebugLog` shape so
 *                                            cmo3writer can keep emitting it
 *                                            without behaviour change.
 */

// ---------------------------------------------------------------------------
// Empty-rig factory
// ---------------------------------------------------------------------------

/**
 * Build an empty RigSpec ready for rig generators to populate.
 *
 * @param {{w:number, h:number}} canvas
 * @returns {RigSpec}
 */
export function emptyRigSpec(canvas) {
  return {
    parameters: [],
    parts: [],
    warpDeformers: [],
    rotationDeformers: [],
    artMeshes: [],
    canvas,
    canvasToInnermostX: null,
    canvasToInnermostY: null,
    innermostBodyWarpId: null,
    bodyWarpChain: null,
    debug: null,
  };
}

/**
 * Look up a deformer (warp or rotation) by id within a RigSpec.
 *
 * @param {RigSpec} rig
 * @param {string} id
 * @returns {WarpDeformerSpec|RotationDeformerSpec|null}
 */
export function findDeformer(rig, id) {
  return (
    rig.warpDeformers.find(d => d.id === id) ??
    rig.rotationDeformers.find(d => d.id === id) ??
    null
  );
}

/**
 * Look up a part by id within a RigSpec.
 *
 * @param {RigSpec} rig
 * @param {string} id
 * @returns {PartSpec|null}
 */
export function findPart(rig, id) {
  return rig.parts.find(p => p.id === id) ?? null;
}
