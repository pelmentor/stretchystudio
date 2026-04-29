// @ts-check
/**
 * .cmo3 → SS project synthesis.
 *
 * Sweep #10 of the Phase 5 round-trip work. Builds on:
 *   - `caffUnpacker.js` — recovers the embedded `main.xml` + PNGs
 *   - `cmo3XmlParser.js` — turns the XML into a tree + xs.id pool
 *   - `cmo3PartExtract.js` — produces structured parts / groups / textures
 *   - `cmo3Inspect.js`  — reads canvas dims + parameter list
 *
 * What this module synthesises:
 *
 *   - `project.canvas`     — pixel dimensions from CImageCanvas
 *   - `project.parameters` — one ParamSpec per CParameterSource
 *   - `project.nodes`      — one node per group / part, parent links
 *                            stitched through the CPartGuid intermediary
 *   - `project.textures`   — one entry per part, pointing at a Blob URL
 *                            of the linked imageFileBuf_N.png
 *
 * What this module does NOT yet synthesise (each is its own follow-on
 * sweep — the plan row tracks them as deferred):
 *
 *   - Deformer chain (CWarpDeformerSource / CRotationDeformerSource)
 *   - Keyform grids → `project.rigWarps[partId]`
 *   - Variants (encoded via conditional keyform bindings)
 *   - Masks (`maskConfigs`)
 *   - Physics rules
 *   - Bone-baked angles / bone config
 *
 * Imported projects therefore arrive as a static reference scene: the
 * geometry is correct, the textures bind, the groups nest correctly,
 * but parameters won't drive any deformation until the rig path is
 * filled in.
 *
 * @module io/live2d/cmo3Import
 */

import { unpackCaff } from './caffUnpacker.js';
import { parseCmo3Xml } from './cmo3XmlParser.js';
import { extractScene } from './cmo3PartExtract.js';
import { CURRENT_SCHEMA_VERSION } from '../../store/projectMigrations.js';
import { uid } from '../../lib/ids.js';

/**
 * @typedef {import('./cmo3Inspect.js').ParamMetadata} ParamMetadata
 * @typedef {import('./cmo3PartExtract.js').ExtractedScene} ExtractedScene
 * @typedef {import('./cmo3PartExtract.js').ExtractedPart} ExtractedPart
 * @typedef {import('./cmo3PartExtract.js').ExtractedGroup} ExtractedGroup
 */

/**
 * @typedef {Object} ImportResult
 * @property {Object} project         The synthesised SS project (loadProject-ready)
 * @property {string[]} warnings      Non-fatal issues — surfaced in the inspector UI
 * @property {Object} stats           {parts, groups, textures, parameters} — for status banner
 */

const DEFAULT_TRANSFORM = () => ({
  x: 0, y: 0,
  rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

/**
 * Read inspect-only header bits the importer needs (canvas dims + model
 * name + parameter list) without re-running the full inspector. The
 * inspector itself can stay focused on its own UI surface; the importer
 * pulls only the structural data and tolerates a missing canvas as a
 * warning rather than a fatal.
 *
 * Mirrors the regex helpers in `cmo3Inspect.js` so behaviour stays in
 * sync; if either drifts, both should drift together.
 *
 * @param {string} xml
 */
function readHeaderBits(xml) {
  const canvasMatch = xml.match(/<CImageCanvas[^>]*xs\.n="canvas"[^>]*>[\s\S]*?<i\s+xs\.n="pixelWidth">(\d+)<\/i>[\s\S]*?<i\s+xs\.n="pixelHeight">(\d+)<\/i>/);
  const nameMatch = xml.match(/<CModelSource\b[^>]*>[\s\S]*?<s\s+xs\.n="name">([^<]*)<\/s>/);
  return {
    canvasW: canvasMatch ? Number(canvasMatch[1]) : null,
    canvasH: canvasMatch ? Number(canvasMatch[2]) : null,
    modelName: nameMatch ? nameMatch[1].trim() : '',
  };
}

/**
 * Resolve the parameter list out of main.xml the same way `cmo3Inspect`
 * does, but without going through the public inspect API (which would
 * also re-run scene extraction we already have).
 *
 * @param {string} xml
 * @returns {ParamMetadata[]}
 */
function readParameters(xml) {
  /** @type {Map<string, string>} */
  const idPool = new Map();
  const idRe = /<CParameterId\b[^>]*\bidstr="([^"]+)"[^>]*\bxs\.id="(#\d+)"[^>]*\/>/g;
  let im;
  while ((im = idRe.exec(xml)) !== null) {
    idPool.set(im[2], im[1]);
  }

  /** @type {ParamMetadata[]} */
  const out = [];
  const sourceRe = /<CParameterSource\b[^>]*>([\s\S]*?)<\/CParameterSource>/g;
  let m;
  while ((m = sourceRe.exec(xml)) !== null) {
    const body = m[1];
    const idRefMatch = body.match(/<CParameterId\b[^>]*xs\.n="id"[^>]*xs\.ref="(#\d+)"[^>]*\/>/);
    const idRef = idRefMatch ? idRefMatch[1] : null;
    const id = idRef ? (idPool.get(idRef) ?? '') : '';
    const minMatch = body.match(/<f\s+xs\.n="minValue">([^<]+)<\/f>/);
    const maxMatch = body.match(/<f\s+xs\.n="maxValue">([^<]+)<\/f>/);
    const defMatch = body.match(/<f\s+xs\.n="defaultValue">([^<]+)<\/f>/);
    const nameMatch = body.match(/<s\s+xs\.n="name">([^<]*)<\/s>/);
    const typeMatch = body.match(/<Type\s+xs\.n="paramType"\s+v="([^"]+)"\s*\/>/);
    out.push({
      id,
      name: nameMatch ? nameMatch[1] : '',
      min: minMatch ? Number(minMatch[1]) : 0,
      max: maxMatch ? Number(maxMatch[1]) : 1,
      default: defMatch ? Number(defMatch[1]) : 0,
      type: typeMatch ? typeMatch[1] : 'NORMAL',
    });
  }
  return out;
}

/**
 * Convert an `ExtractedPart`'s flat position/UV/index arrays into the SS
 * mesh shape:
 *
 *   - `vertices`: Array<{x, y, restX, restY}>  (object array, NOT typed)
 *   - `uvs`: Float32Array (flat)
 *   - `triangles`: Array<[i0, i1, i2]>
 *   - `edgeIndices`: Set<number>  (boundary detection — left empty for now)
 *
 * @param {ExtractedPart} part
 */
function partToMesh(part) {
  const vertices = [];
  for (let i = 0; i < part.positions.length; i += 2) {
    const x = part.positions[i];
    const y = part.positions[i + 1];
    vertices.push({ x, y, restX: x, restY: y });
  }

  /** @type {Array<[number,number,number]>} */
  const triangles = [];
  for (let i = 0; i < part.indices.length; i += 3) {
    triangles.push([part.indices[i], part.indices[i + 1], part.indices[i + 2]]);
  }

  return {
    vertices,
    uvs: new Float32Array(part.uvs),  // copy out; caller shouldn't share buffers
    triangles,
    edgeIndices: new Set(),  // boundary detection deferred
  };
}

/**
 * Synthesise per-mesh rig warp specs from the extracted deformer + binding
 * + grid graph. Mirrors what `cmo3writer.js`'s per-mesh emission loop
 * produces inline, so a re-export of the imported project would round-
 * trip cleanly through the writer's stored-rigWarps fast path.
 *
 * Coverage (sweep #13 honest scope):
 *
 *   - Warp deformers whose own CDeformerGuid xs.ref is referenced by
 *     exactly one `ExtractedPart.deformerGuidRef` get a full rigWarpSpec
 *     keyed by that part's SS node id.
 *   - Warps with no mesh child (intermediate / chained warps under
 *     FaceParallax / NeckWarp / BodyXWarp) are SKIPPED — they need a
 *     deformer-tree synthesis pass that doesn't exist yet.
 *   - Rotation deformers are SKIPPED here — they map to SS's
 *     groupRotation system, which is its own follow-on sweep.
 *
 * `gridSize` is the cell count (`cols × rows`); `baseGrid` is
 * `(cols+1) × (rows+1)` control-point pairs — same convention the writer
 * uses. Positions are returned in canvas-pixel space (cmo3 stores
 * `0..1`-normalised; the writer's stored-rigWarps fast path expects
 * pixel space).
 *
 * @param {import('./cmo3PartExtract.js').ExtractedScene} scene
 * @param {Map<string, string>} partGuidToNodeId   ExtractedPart.xsId → SS node id
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {{ rigWarps: Record<string, any>, warnings: string[] }}
 */
function buildRigWarpsFromScene(scene, partGuidToNodeId, canvasW, canvasH) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Record<string, any>} */
  const rigWarps = {};

  // Map warp.ownGuidRef → warp record so part.deformerGuidRef lookups are O(1)
  /** @type {Map<string, import('./cmo3PartExtract.js').ExtractedDeformer>} */
  const warpByOwnGuid = new Map();
  // Parallel map for rotation deformers — currently unused for synthesis
  // (no per-mesh SS storage equivalent), but lets us emit specific
  // warnings instead of silently skipping parts.
  /** @type {Map<string, import('./cmo3PartExtract.js').ExtractedDeformer>} */
  const rotationByOwnGuid = new Map();
  for (const d of scene.deformers) {
    if (!d.ownGuidRef) continue;
    if (d.kind === 'warp') warpByOwnGuid.set(d.ownGuidRef, d);
    else if (d.kind === 'rotation') rotationByOwnGuid.set(d.ownGuidRef, d);
  }

  // Map binding xsId → record so grid cell access keys can resolve param
  // values without re-walking the scene.
  /** @type {Map<string, import('./cmo3PartExtract.js').ExtractedKeyformBinding>} */
  const bindingsById = new Map();
  for (const b of scene.keyformBindings) {
    if (b.xsId) bindingsById.set(b.xsId, b);
  }

  // Map grid xsId → record for warp.keyformGridSourceRef → grid lookup.
  /** @type {Map<string, import('./cmo3PartExtract.js').ExtractedKeyformGrid>} */
  const gridsById = new Map();
  for (const g of scene.keyformGrids) {
    if (g.xsId) gridsById.set(g.xsId, g);
  }

  // Map binding.gridSourceRef → list of bindings that fan into that grid.
  // The order of bindings here is the parameter-axis order; later we use
  // each binding's index to lookup keyTuple values in cell access keys.
  /** @type {Map<string, import('./cmo3PartExtract.js').ExtractedKeyformBinding[]>} */
  const bindingsByGrid = new Map();
  for (const b of scene.keyformBindings) {
    if (!b.gridSourceRef) continue;
    let arr = bindingsByGrid.get(b.gridSourceRef);
    if (!arr) { arr = []; bindingsByGrid.set(b.gridSourceRef, arr); }
    arr.push(b);
  }

  for (const part of scene.parts) {
    if (!part.deformerGuidRef) continue;
    const warp = warpByOwnGuid.get(part.deformerGuidRef);
    if (!warp) {
      const rot = rotationByOwnGuid.get(part.deformerGuidRef);
      if (rot) {
        // Parts whose deformer parent is a rotation (not a warp) don't
        // get a stored rigWarp — the writer's per-mesh inline path
        // generates one on re-export, parented to the group's
        // GroupRotation_<role> deformer (whose pivot/role we set in
        // applyRotationDeformersToGroups). No warning needed.
      } else {
        warnings.push(
          `part ${part.drawableIdStr} (${part.name}) deformer ref ${part.deformerGuidRef} resolves to neither a warp nor a rotation deformer`,
        );
      }
      continue;
    }

    const partNodeId = partGuidToNodeId.get(part.xsId ?? '');
    if (!partNodeId) {
      warnings.push(`rigWarp build: part ${part.drawableIdStr} has no node id assignment`);
      continue;
    }

    // Resolve bindings for the warp's grid (parameter-axis order).
    const grid = warp.keyformGridSourceRef ? gridsById.get(warp.keyformGridSourceRef) : null;
    const gridBindings = warp.keyformGridSourceRef
      ? (bindingsByGrid.get(warp.keyformGridSourceRef) ?? [])
      : [];

    /** @type {{parameterId:string, keys:number[], interpolation:string}[]} */
    const bindings = gridBindings.map((b) => ({
      parameterId: b.description || 'ParamOpacity',
      keys: b.keys.slice(),
      interpolation: b.interpolationType || 'LINEAR',
    }));
    if (bindings.length === 0) {
      // Untagged mesh — writer emits a single ParamOpacity binding
      bindings.push({ parameterId: 'ParamOpacity', keys: [1], interpolation: 'LINEAR' });
    }

    // CWarpDeformerSource doesn't carry a top-level base positions array
    // — only the keyforms have positions. The "rest grid" is the keyform
    // whose access-key values are all closest to 0 (i.e. each parameter
    // sits at its default). For binding keys like [-1, 0, 1], that's
    // index 1; for [0, 1], index 0. We pick the cell minimising
    // sum-of-squares param distance from 0.
    if (!grid || grid.entries.length === 0 || !warp.keyforms.length) {
      warnings.push(`rigWarp build: warp ${warp.idStr} has no keyforms / grid`);
      continue;
    }
    let restCellIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < grid.entries.length; i++) {
      const cell = grid.entries[i];
      let dist = 0;
      for (const b of gridBindings) {
        const ak = cell.accessKey.find((k) => k.bindingRef === b.xsId);
        const val = ak ? (b.keys[ak.keyIndex] ?? 0) : 0;
        dist += val * val;
      }
      if (dist < bestDist) {
        bestDist = dist;
        restCellIdx = i;
      }
    }
    const restPositions = warp.keyforms[restCellIdx]?.positions;
    if (!restPositions || restPositions.length === 0) {
      warnings.push(`rigWarp build: warp ${warp.idStr} rest cell ${restCellIdx} has no positions`);
      continue;
    }
    const baseGrid = new Array(restPositions.length);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < restPositions.length; i += 2) {
      const px = restPositions[i] * canvasW;
      const py = restPositions[i + 1] * canvasH;
      baseGrid[i] = px;
      baseGrid[i + 1] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    /** @type {{keyTuple:number[], positions:number[], opacity:number}[]} */
    const keyforms = [];

    if (grid && grid.entries.length === warp.keyforms.length) {
      // Cartesian-product index match: cell N corresponds to deformer
      // keyform N. Build keyTuple by walking each cell's accessKey in
      // parameter-axis order (gridBindings order).
      for (let i = 0; i < grid.entries.length; i++) {
        const cell = grid.entries[i];
        const kfPositions = warp.keyforms[i].positions;
        if (!kfPositions) {
          warnings.push(`rigWarp build: warp ${warp.idStr} keyform ${i} missing positions`);
          continue;
        }
        // Position pixels = normalised × canvas dim (interleaved x/y)
        const positions = new Array(kfPositions.length);
        for (let j = 0; j < kfPositions.length; j += 2) {
          positions[j] = kfPositions[j] * canvasW;
          positions[j + 1] = kfPositions[j + 1] * canvasH;
        }
        // Build keyTuple in the binding-order the writer expects. The
        // cell's accessKey may be in a different order; reorder it.
        const keyTuple = [];
        for (const b of gridBindings) {
          const ak = cell.accessKey.find((k) => k.bindingRef === b.xsId);
          if (!ak || !Number.isFinite(b.keys[ak.keyIndex])) {
            keyTuple.push(0);
          } else {
            keyTuple.push(b.keys[ak.keyIndex]);
          }
        }
        keyforms.push({ keyTuple, positions, opacity: 1 });
      }
    } else {
      // No grid (untagged) or count mismatch: emit one rest keyform that
      // mirrors baseGrid. Writer produces this same shape for the
      // ParamOpacity-only fallback.
      keyforms.push({
        keyTuple: bindings[0]?.keys.slice() ?? [1],
        positions: baseGrid.slice(),
        opacity: 1,
      });
    }

    rigWarps[partNodeId] = {
      id: warp.idStr || `RigWarp_${part.name}`,
      name: warp.name || `${part.name} Warp`,
      // Parent type is conservatively 'warp' (matches the writer's
      // default). Identifying the actual chained parent (FaceParallax /
      // NeckWarp / BodyXWarp) needs deformer-tree synthesis — deferred.
      parent: { type: 'warp', id: 'BodyXWarp' },
      targetPartId: partNodeId,
      canvasBbox: {
        minX,
        minY,
        W: maxX - minX,
        H: maxY - minY,
      },
      gridSize: { rows: warp.rows, cols: warp.cols },
      baseGrid,
      localFrame: 'normalized-0to1',
      bindings,
      keyforms,
      isVisible: true,
      isLocked: false,
      isQuadTransform: warp.isQuadTransform,
    };
  }

  return { rigWarps, warnings };
}

/**
 * Map every `ExtractedGroup.guidRef` to a freshly-generated SS node id.
 * Parts use guid xs.refs to point at their parent group, so we need the
 * intermediary index to translate those into SS node parent links.
 *
 * @param {ExtractedGroup[]} groups
 */
function buildGuidToNodeIdMap(groups) {
  const map = new Map();
  for (const g of groups) {
    if (g.guidRef) map.set(g.guidRef, uid());
  }
  return map;
}

/**
 * The boneRoles the auto-rig writer recognises. Mirror of the
 * `CREATE_ORDER` list in `armatureOrganizer.js` — kept in sync so the
 * importer doesn't drift behind new role additions on the auto-rig side.
 *
 * Group names that match one of these (case-sensitive, exact) are mapped
 * straight onto `node.boneRole`. Names that don't match leave `boneRole`
 * unset — the writer's fallback (rotate-everything-not-skipped) takes
 * over there, which is no worse than the pre-import baseline.
 */
const KNOWN_BONE_ROLES = new Set([
  'root', 'torso', 'neck', 'head', 'face', 'eyes',
  'leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'bothArms',
  'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'bothLegs',
]);

/**
 * Mirror cmo3 rotation deformers onto their owning groups so the writer's
 * auto-rig path produces equivalent rotations on re-export. Two channels:
 *
 *   1. **boneRole.** When a group's name matches a known role, set
 *      `boneRole = name` so the writer recognises it (and its skip set
 *      filters out torso/eyes/neck → those go through warps instead).
 *
 *   2. **Pivot.** When a rotation deformer's parent is canvas-normalised
 *      (ROOT or a top-level body warp), translate the rest keyform's
 *      `originX/Y` (0..1) into canvas-px and stash it on
 *      `group.transform.pivotX/Y`. The writer's `deformerWorldOrigins`
 *      pass picks this up — `worldMatrix × [pivotX, pivotY, 1]` falls
 *      through identity when the group has no other transform set, so
 *      world pivot equals the stored canvas-px value.
 *
 * For rotation deformers chained under another rotation (e.g. FaceRotation
 * under Rotation_head), the cmo3 stores `originY` in pixel-OFFSET form
 * relative to the parent rotation's pivot, NOT canvas-normalised. We skip
 * pivot translation in that case and let the writer fall back to its
 * bbox-of-descendant-meshes heuristic — accurate enough for re-emission
 * without inheriting the parent-frame offset arithmetic the writer's
 * section-3d re-parenting path is responsible for.
 *
 * @param {import('./cmo3PartExtract.js').ExtractedScene} scene
 * @param {any[]} nodes               mutated in-place — group nodes get
 *                                    `boneRole` + `transform.pivotX/Y`
 * @param {Map<string, string>} guidToNodeId  group.guidRef → SS node id
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {string[]}                warnings
 */
function applyRotationDeformersToGroups(scene, nodes, guidToNodeId, canvasW, canvasH) {
  /** @type {string[]} */
  const warnings = [];

  // Pass 1: set boneRole on every group whose name matches a known role.
  // Catches the typical case where the cmo3's group structure was authored
  // by SS's auto-rig (so names ARE roles) and the cmo3 elected NOT to emit
  // a rotation deformer (e.g. torso → BodyXWarp instead). Without this,
  // torso/eyes/neck would re-emit rotations on re-export — wrong.
  for (const node of nodes) {
    if (node.type !== 'group') continue;
    if (KNOWN_BONE_ROLES.has(node.name)) {
      node.boneRole = node.name;
    }
  }

  // Pass 2: for each rotation deformer, find the owning group and copy
  // the rest pivot in canvas-px when the parent allows the simple
  // normalised-0..1 → canvas-px translation.
  /** @type {Map<string, import('./cmo3PartExtract.js').ExtractedDeformer>} */
  const deformerByGuid = new Map();
  for (const d of scene.deformers) {
    if (d.ownGuidRef) deformerByGuid.set(d.ownGuidRef, d);
  }

  for (const def of scene.deformers) {
    if (def.kind !== 'rotation') continue;
    if (!def.parentPartGuidRef) {
      warnings.push(`rotation ${def.idStr} has no parentPartGuidRef — owner group can't be resolved`);
      continue;
    }
    const ownerGroup = scene.groups.find((g) => g.guidRef === def.parentPartGuidRef);
    if (!ownerGroup) {
      warnings.push(`rotation ${def.idStr}: no group with guidRef=${def.parentPartGuidRef}`);
      continue;
    }
    const nodeId = ownerGroup.guidRef ? guidToNodeId.get(ownerGroup.guidRef) : null;
    if (!nodeId) {
      warnings.push(`rotation ${def.idStr}: group ${ownerGroup.name} has no node id assignment`);
      continue;
    }
    const node = nodes.find((n) => n.id === nodeId && n.type === 'group');
    if (!node) {
      warnings.push(`rotation ${def.idStr}: SS node ${nodeId} not found`);
      continue;
    }

    // boneRole from deformer.name if it matches a known role — covers
    // the case where the group was renamed but the deformer's localName
    // still carries the original role tag.
    if (KNOWN_BONE_ROLES.has(def.name) && !node.boneRole) {
      node.boneRole = def.name;
    }

    // Pivot translation — only safe for parents whose frame is the
    // canvas's normalised 0..1 box (ROOT and top-level warps like
    // BodyXWarp). Chained rotations carry pixel-offsets from the parent
    // pivot, which we'd need the parent's resolved canvas pivot to
    // un-translate; that's the writer's section-3d responsibility on
    // re-export, so we skip here.
    let parentIsRotation = false;
    if (def.parentDeformerGuidRef) {
      const parent = deformerByGuid.get(def.parentDeformerGuidRef);
      if (parent && parent.kind === 'rotation') parentIsRotation = true;
    }
    if (parentIsRotation) {
      // No pivot stash — writer will use bbox-of-descendant-meshes fallback.
      continue;
    }

    // Pick the rest keyform: the one whose angle is closest to 0. Origin
    // is constant across keyforms in the writer's emission (same
    // `originX/Y` across all 3 forms — see cmo3writer ~1898), but the
    // closest-to-zero pick stays robust if a future authoring tool
    // animated the pivot.
    let restIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < def.keyforms.length; i++) {
      const a = Math.abs(def.keyforms[i].angle ?? 0);
      if (a < bestDist) { bestDist = a; restIdx = i; }
    }
    const kf = def.keyforms[restIdx];
    if (!kf || kf.originX == null || kf.originY == null) {
      warnings.push(`rotation ${def.idStr}: rest keyform ${restIdx} has no origin`);
      continue;
    }

    // Sanity guard against the (0, 0) sentinel some authoring paths emit
    // for "use the default" — those would map a group's pivot to the
    // canvas origin, far from any actual descendant mesh. Fall through
    // to the writer's bbox fallback in that case.
    if (kf.originX === 0 && kf.originY === 0) {
      warnings.push(`rotation ${def.idStr}: keyform origin (0, 0) treated as unset — bbox fallback will engage`);
      continue;
    }

    if (!node.transform) node.transform = DEFAULT_TRANSFORM();
    node.transform.pivotX = kf.originX * canvasW;
    node.transform.pivotY = kf.originY * canvasH;
  }

  return warnings;
}

/**
 * Synthesise a complete SS project from a parsed cmo3.
 *
 * The output is `loadProject`-ready: every field the project store
 * touches in `loadProject` is populated (with `null` / `[]` / `{}`
 * defaults for the rig fields we don't decode yet).
 *
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {Promise<ImportResult>}
 */
export async function importCmo3(bytes) {
  const archive = await unpackCaff(bytes);
  const xmlEntry = archive.files.find((f) => f.path === 'main.xml');
  if (!xmlEntry) {
    throw new Error('cmo3Import: archive has no main.xml entry');
  }
  const xml = new TextDecoder('utf-8').decode(xmlEntry.content);

  /** @type {string[]} */
  const warnings = [];

  const { canvasW, canvasH, modelName } = readHeaderBits(xml);
  if (canvasW === null || canvasH === null) {
    warnings.push('No canvas dimensions found — falling back to 1024×1024');
  }

  const params = readParameters(xml);
  const parsed = parseCmo3Xml(xml);
  const scene = extractScene(parsed);
  for (const w of scene.warnings) warnings.push(`scene: ${w}`);

  // Build PNG → Blob URL map keyed by file name. The same imageFileBuf
  // can be referenced by multiple parts when the original PSD shared a
  // texture; sharing the Blob URL avoids redundant decode work in the
  // texture upload path. URLs are released when the project is replaced
  // (the renderer + projectStore handle that lifecycle).
  /** @type {Map<string, string>} */
  const pngBlobUrls = new Map();
  for (const f of archive.files) {
    if (!f.path.toLowerCase().endsWith('.png')) continue;
    if (f.path.startsWith('cmo3_icon_')) continue;  // editor thumbnail, not part of model
    // .slice() copies into an ArrayBuffer-backed Uint8Array; the
    // CAFF unpacker hands back ArrayBufferLike-backed views which the
    // Blob constructor's TS lib types refuse without the cast.
    const blob = new Blob([f.content.slice()], { type: 'image/png' });
    pngBlobUrls.set(f.path, URL.createObjectURL(blob));
  }

  // Group ID assignment. Parts use guidRef to point at their parent
  // group (CPartGuid intermediary), so we need the lookup table before
  // we generate part nodes.
  const guidToNodeId = buildGuidToNodeIdMap(scene.groups);

  /** @type {any[]} */
  const nodes = [];

  for (const g of scene.groups) {
    const id = g.guidRef ? guidToNodeId.get(g.guidRef) : uid();
    nodes.push({
      id,
      type: 'group',
      name: g.name || 'Group',
      parent: g.parentGuidRef ? (guidToNodeId.get(g.parentGuidRef) ?? null) : null,
      transform: DEFAULT_TRANSFORM(),
      visible: g.isVisible,
      opacity: 1,
    });
  }

  /** @type {any[]} */
  const textures = [];

  // Track ExtractedPart.xsId → SS node id so the rig-warps synthesiser
  // can resolve parts to their freshly-generated ids without re-walking
  // the parts loop.
  /** @type {Map<string, string>} */
  const partGuidToNodeId = new Map();

  for (const part of scene.parts) {
    const nodeId = uid();
    if (part.xsId) partGuidToNodeId.set(part.xsId, nodeId);
    const parent = part.parentGuidRef ? (guidToNodeId.get(part.parentGuidRef) ?? null) : null;
    if (part.parentGuidRef && parent === null) {
      warnings.push(`part ${part.drawableIdStr} (${part.name}) has unresolved parent ${part.parentGuidRef}`);
    }

    // Resolve texture file: part → GTexture2D ref → ExtractedTexture → filePath
    let textureSource = null;
    if (part.textureRef) {
      const tex = scene.textures.find((t) => t.xsId === part.textureRef);
      if (tex && tex.filePath && pngBlobUrls.has(tex.filePath)) {
        textureSource = pngBlobUrls.get(tex.filePath) ?? null;
      } else if (tex) {
        warnings.push(`part ${part.drawableIdStr} texture ${tex.filePath ?? '(unresolved)'} not found in CAFF archive`);
      }
    }
    if (textureSource) {
      textures.push({ id: nodeId, source: textureSource });
    }

    nodes.push({
      id: nodeId,
      type: 'part',
      name: part.name || part.drawableIdStr,
      parent,
      draw_order: part.drawOrder,
      opacity: 1,
      visible: part.isVisible,
      clip_mask: null,  // mask resolution deferred
      transform: DEFAULT_TRANSFORM(),
      meshOpts: null,
      mesh: partToMesh(part),
      blendShapes: null,
      blendShapeValues: {},
    });
  }

  // Sweep #13: synthesise per-mesh rig warp specs from the deformer +
  // binding + grid graph. Sets `project.rigWarps[partId]` so imported
  // models get their cmo3 rig back end-to-end (for the simple case
  // where each warp directly parents one mesh — chained warps and
  // rotation deformers are deferred).
  const { rigWarps, warnings: rigWarnings } = buildRigWarpsFromScene(
    scene, partGuidToNodeId, canvasW ?? 1024, canvasH ?? 1024,
  );
  for (const w of rigWarnings) warnings.push(`rigWarp: ${w}`);

  // Sweep #15: mirror cmo3 rotation deformers onto their owning groups so
  // the writer's auto-rig path produces equivalent rotations on re-export.
  // Sets `node.boneRole` per known-role match and `transform.pivotX/Y`
  // per rotation deformer rest origin (canvas-normalised → canvas-px).
  // Parts whose deformerGuidRef pointed at a rotation deformer (e.g.
  // handwear-l/r → Rotation_leftArm/rightArm) lose their `rigWarp:`
  // warning from sweep #14: the writer's per-mesh inline path now picks
  // up the parent group's GroupRotation_<role> deformer at re-export.
  const rotationWarnings = applyRotationDeformersToGroups(
    scene, nodes, guidToNodeId, canvasW ?? 1024, canvasH ?? 1024,
  );
  for (const w of rotationWarnings) warnings.push(`rotation: ${w}`);

  // Synthesise SS-shaped parameter list from the inspected metadata.
  // `role` defaults to 'standard'; ParamOpacity gets 'opacity' so the
  // parameter editor groups it the way the auto-rig pipeline expects.
  const parameters = params.map((p) => ({
    id: p.id,
    name: p.name || p.id,
    min: p.min,
    max: p.max,
    default: p.default,
    decimalPlaces: 1,
    repeat: false,
    role: p.id === 'ParamOpacity' ? 'opacity' : 'standard',
  }));

  const project = {
    version: '0.1',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: {
      width: canvasW ?? 1024,
      height: canvasH ?? 1024,
      x: 0, y: 0,
      bgEnabled: false,
      bgColor: '#ffffff',
    },
    textures,
    nodes,
    parameters,
    physics_groups: [],
    animations: [],
    maskConfigs: [],
    physicsRules: [],
    boneConfig: null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
    autoRigConfig: null,
    faceParallax: null,
    bodyWarp: null,
    rigWarps,
    // Stash the cmo3's own model name so callers can use it for the
    // library record / window title without re-parsing the file.
    _importedFromCmo3: { modelName, canvasW: canvasW ?? null, canvasH: canvasH ?? null },
  };

  return {
    project,
    warnings,
    stats: {
      parts: scene.parts.length,
      groups: scene.groups.length,
      textures: textures.length,
      parameters: parameters.length,
      rigWarps: Object.keys(rigWarps).length,
    },
  };
}
