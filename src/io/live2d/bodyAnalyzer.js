import { logger } from '../../lib/logger.js';

// bodyAnalyzer.js — Step 1 of body-parallax measure-first refactor.
//
// Pure measurement pass: decodes body-mesh PNG alphas, unions them into per-row
// silhouette masks, and extracts spine axis + anchor Ys + width profile.
// Zero visual effect on export; results land in rigDebugLog.body for review.
//
// Motivation: current Session-15 body warps (Body X/Y/Z, Breath) use parametric
// bell curves centered on the geometric bbox. On characters whose torso is not
// symmetric about the bbox X-center, this produces an asymmetric pull. The
// feet clamp (FEET_FRAC=0.75) also only applies to one layer of the chain.
// Step 2 will consume these metrics; Step 1 just captures them.

const ALPHA_THRESHOLD = 16;

const CORE_TAGS = new Set(['topwear', 'bottomwear']);
const LIMB_TAGS = new Set([
  'legwear', 'legwear-l', 'legwear-r',
  'footwear', 'footwear-l', 'footwear-r',
]);

/**
 * Union of every tag whose PNG alpha must be rendered for body silhouette
 * analysis. `buildMeshesForRig` consumes this so `analyzeBody` actually
 * sees the bytes — without it every body mesh logged "missing pngData",
 * `analyzeBody` returned `skipped: 'no-core'`, and the body warp chain
 * fell back to default HIP_FRAC=0.45 / FEET_FRAC=0.75 — visible to the
 * user as legwear stretching far below the canvas after Init Rig (because
 * BodyWarpZ's bottom edge derives from the wrong feetY).
 */
export const BODY_ANALYSIS_TAGS = new Set([...CORE_TAGS, ...LIMB_TAGS]);

async function decodeAlphaMask(pngData) {
  if (!pngData || !pngData.length) return null;
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  try {
    const blob = new Blob([pngData], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    let img;
    try {
      img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = (e) => reject(e);
        el.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    const canvas = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(img.width, img.height)
      : Object.assign(document.createElement('canvas'), {
          width: img.width, height: img.height,
        });
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);
    return { data: imgData.data, width: img.width, height: img.height };
  } catch {
    return null;
  }
}

function bboxFromVertices(vertices) {
  if (!vertices || vertices.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 2) {
    if (vertices[i]     < minX) minX = vertices[i];
    if (vertices[i]     > maxX) maxX = vertices[i];
    if (vertices[i + 1] < minY) minY = vertices[i + 1];
    if (vertices[i + 1] > maxY) maxY = vertices[i + 1];
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function unionBbox(a, b) {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.minX, b.minX);
  const minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.maxX, b.maxX);
  const maxY = Math.max(a.maxY, b.maxY);
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/**
 * Analyze body silhouette from mesh PNG alphas.
 *
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {Array<{tag: string|null, pngData: Uint8Array, vertices: Float32Array}>} meshes
 * @returns {Promise<object|null>} analysis result, or object with `skipped` reason
 */
export async function analyzeBody(canvasW, canvasH, meshes) {
  if (!Number.isFinite(canvasW) || !Number.isFinite(canvasH)) return null;
  const W = canvasW | 0, H = canvasH | 0;
  if (W <= 0 || H <= 0) return null;
  if (typeof Image === 'undefined') {
    return { skipped: 'no-dom', warnings: ['DOM unavailable (non-browser env)'] };
  }

  const coreMask = new Uint8Array(W * H);
  const fullMask = new Uint8Array(W * H);
  const coreTagsFound = [];
  const limbTagsFound = [];
  const warnings = [];

  let topwearBbox = null;
  let bottomwearBbox = null;

  for (const m of meshes) {
    if (!m.tag) continue;
    const isCore = CORE_TAGS.has(m.tag);
    const isLimb = LIMB_TAGS.has(m.tag);
    if (!isCore && !isLimb) continue;

    if (m.tag === 'topwear')    topwearBbox    = unionBbox(topwearBbox,    bboxFromVertices(m.vertices));
    if (m.tag === 'bottomwear') bottomwearBbox = unionBbox(bottomwearBbox, bboxFromVertices(m.vertices));

    if (!m.pngData || !m.pngData.length) {
      warnings.push(`${m.tag}: missing pngData`);
      continue;
    }
    const alpha = await decodeAlphaMask(m.pngData);
    if (!alpha) {
      warnings.push(`${m.tag}: PNG decode failed`);
      continue;
    }
    if (alpha.width !== W || alpha.height !== H) {
      warnings.push(`${m.tag}: PNG size ${alpha.width}x${alpha.height} != canvas ${W}x${H}`);
      continue;
    }

    if (isCore) coreTagsFound.push(m.tag);
    if (isLimb) limbTagsFound.push(m.tag);

    const a = alpha.data;
    const n = W * H;
    if (isCore) {
      for (let i = 0, p = 3; i < n; i++, p += 4) {
        if (a[p] > ALPHA_THRESHOLD) { coreMask[i] = 1; fullMask[i] = 1; }
      }
    } else {
      for (let i = 0, p = 3; i < n; i++, p += 4) {
        if (a[p] > ALPHA_THRESHOLD) { fullMask[i] = 1; }
      }
    }
  }

  if (!coreTagsFound.length) {
    logger.warn('bodyAnalyzer', 'No core (topwear/bottomwear) tagged meshes — body anatomy NOT measured', {
      reason: 'no-core',
      limbTagsFound,
      warnings,
      consequence: 'BodyWarpZ/Y/X + Breath fall back to default HIP_FRAC=0.45, FEET_FRAC=0.75 — accuracy reduced for upper-body-only or unusually-proportioned characters',
    });
    return {
      skipped: 'no-core',
      coreTagsFound, limbTagsFound,
      warnings: [...warnings, 'No topwear/bottomwear alpha decoded — body analysis skipped'],
    };
  }

  const coreLeft  = new Int32Array(H).fill(-1);
  const coreRight = new Int32Array(H).fill(-1);
  const fullLeft  = new Int32Array(H).fill(-1);
  const fullRight = new Int32Array(H).fill(-1);

  for (let y = 0; y < H; y++) {
    const rowStart = y * W;
    let cl = -1, cr = -1, fl = -1, fr = -1;
    for (let x = 0; x < W; x++) {
      const i = rowStart + x;
      if (coreMask[i]) { if (cl < 0) cl = x; cr = x; }
      if (fullMask[i]) { if (fl < 0) fl = x; fr = x; }
    }
    coreLeft[y] = cl;  coreRight[y] = cr;
    fullLeft[y] = fl;  fullRight[y] = fr;
  }

  let coreTopY = -1, coreBottomY = -1, fullTopY = -1, fullBottomY = -1;
  for (let y = 0; y < H; y++) {
    if (coreLeft[y] >= 0) {
      if (coreTopY < 0) coreTopY = y;
      coreBottomY = y;
    }
    if (fullLeft[y] >= 0) {
      if (fullTopY < 0) fullTopY = y;
      fullBottomY = y;
    }
  }

  if (coreTopY < 0) {
    return { skipped: 'empty-core-mask', coreTagsFound, limbTagsFound, warnings };
  }

  const widthAt     = (y) => (y >= 0 && y < H && coreLeft[y] >= 0) ? (coreRight[y] - coreLeft[y] + 1) : 0;
  const fullWidthAt = (y) => (y >= 0 && y < H && fullLeft[y] >= 0) ? (fullRight[y] - fullLeft[y] + 1) : 0;
  const centerAt    = (y) => (y >= 0 && y < H && coreLeft[y] >= 0) ? +((coreLeft[y] + coreRight[y]) / 2).toFixed(2) : null;

  // Width-weighted spine axis + widest point — both needed before hipY candidates.
  let sumNum = 0, sumDen = 0;
  let maxCoreWidth = 0, maxCoreWidthY = coreTopY;
  for (let y = coreTopY; y <= coreBottomY; y++) {
    if (coreLeft[y] < 0) continue;
    const w  = coreRight[y] - coreLeft[y] + 1;
    const cx = (coreLeft[y] + coreRight[y]) / 2;
    sumNum += cx * w;
    sumDen += w;
    if (w > maxCoreWidth) { maxCoreWidth = w; maxCoreWidthY = y; }
  }
  const spineX_overall = sumDen > 0 ? +(sumNum / sumDen).toFixed(2) : null;

  // Hip Y candidates (Step 2 picks based on whether bottomwear exists):
  //  - topwearMaxY  : waist-level when top/bottom garments are distinct (e.g. waifu shirt→shorts)
  //  - widestCoreY  : anatomical widest point — better for dress-only characters (girl/shelby)
  //  - spanMid      : fallback midpoint of core span
  const hipCandidates = {
    topwearMaxY: topwearBbox ? Math.max(coreTopY, Math.min(coreBottomY, Math.round(topwearBbox.maxY))) : null,
    widestCoreY: maxCoreWidthY,
    spanMid: Math.round((coreTopY + coreBottomY) / 2),
  };
  // Primary: topwearMaxY if a real bottomwear exists (clothes are split); else widestCoreY.
  const hipY = (bottomwearBbox && hipCandidates.topwearMaxY !== null)
    ? hipCandidates.topwearMaxY
    : (hipCandidates.widestCoreY ?? hipCandidates.spanMid);

  // Diagnostic warnings.
  if (fullBottomY >= H - 1) {
    warnings.push(`feetY at canvas edge (y=${fullBottomY}, canvasH=${H}) — character may be truncated or alpha leaking to last row`);
  }
  if (topwearBbox && coreBottomY > topwearBbox.maxY + 10 && !bottomwearBbox) {
    warnings.push(`core alpha extends ${coreBottomY - Math.round(topwearBbox.maxY)}px below topwear vertex bbox — likely a dress; using widestCoreY for hipY`);
  }

  const SAMPLES = 20;
  const widthProfile = [];
  for (let s = 0; s <= SAMPLES; s++) {
    const t = s / SAMPLES;
    const y = Math.round(coreTopY + t * (coreBottomY - coreTopY));
    widthProfile.push({
      t: +t.toFixed(3),
      y,
      coreWidth: widthAt(y),
      fullWidth: fullWidthAt(y),
      spineX: centerAt(y),
      coreLeft: coreLeft[y] >= 0 ? coreLeft[y] : null,
      coreRight: coreRight[y] >= 0 ? coreRight[y] : null,
    });
  }

  const uniq = (arr) => [...new Set(arr)];

  logger.info('bodyAnalyzer', 'Body silhouette analyzed', {
    coreTags: uniq(coreTagsFound),
    limbTags: uniq(limbTagsFound),
    anchorsCanvasY: { shoulderY: coreTopY, hipY, feetY: fullBottomY },
    spineX: { atShoulder: centerAt(coreTopY), atHip: centerAt(hipY), overall: spineX_overall },
    widthStats: {
      maxCore: maxCoreWidth, shoulder: widthAt(coreTopY), hip: widthAt(hipY),
    },
    warnings: warnings.length ? warnings : undefined,
  });

  return {
    coreTagsFound: uniq(coreTagsFound),
    coreMeshCount: coreTagsFound.length,
    limbTagsFound: uniq(limbTagsFound),
    limbMeshCount: limbTagsFound.length,
    warnings,
    topwearBbox,
    bottomwearBbox,
    anchors: {
      shoulderY: coreTopY,
      hipY,
      hipCandidates,
      feetY: fullBottomY,
      spineX_atShoulder: centerAt(coreTopY),
      spineX_atHip: centerAt(hipY),
      spineX_overall,
    },
    widthStats: {
      maxCoreWidth,
      maxCoreWidthY,
      shoulderWidth: widthAt(coreTopY),
      hipWidth: widthAt(hipY),
      feetSpreadWidth: fullWidthAt(fullBottomY),
      coreHeight: coreBottomY - coreTopY + 1,
      fullHeight: fullBottomY - fullTopY + 1,
    },
    widthProfile,
  };
}
