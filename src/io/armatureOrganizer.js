/**
 * armatureOrganizer.js
 *
 * Converts a see-through PSD into a joint-based armature by:
 *   1. Running DWPose ONNX inference on the composited character to get keypoints
 *      — OR — estimating skeleton positions from layer bounding boxes (heuristic)
 *   2. Mapping keypoints to named joints (neck, shoulders, hips, …)
 *   3. Building a bone hierarchy of group nodes with pivot points set from those joints
 *   4. Routing each semantic layer to its parent bone group
 */


// Lazy-loaded onnxruntime-web
let _ortPromise = null;

async function _ensureOrt() {
  if (_ortPromise) return _ortPromise;
  
  _ortPromise = (async () => {
    const module = await import('onnxruntime-web');
    // Support both namespace and default export styles depending on bundler behavior
    const instance = module.env ? module : (module.default || module);
    
    // Point wasm runtime at CDN to avoid bundling the large .wasm files
    instance.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
    return instance;
  })();
  
  return _ortPromise;
}


/* ─── Tag sets ──────────────────────────────────────────────────────────────── */

export const KNOWN_TAGS = [
  'back hair', 'front hair', 'headwear', 'face',
  'irides', 'irides-l', 'irides-r',
  'eyebrow', 'eyebrow-l', 'eyebrow-r',
  'eyewhite', 'eyewhite-l', 'eyewhite-r',
  'eyelash', 'eyelash-l', 'eyelash-r',
  'eyewear', 'ears', 'ears-l', 'ears-r', 'earwear',
  'nose', 'mouth', 'neck', 'neckwear', 'topwear',
  'handwear', 'handwear-l', 'handwear-r',
  'bottomwear',
  'legwear', 'legwear-l', 'legwear-r',
  'footwear', 'footwear-l', 'footwear-r',
  'tail', 'wings', 'objects',
];

// Tags whose layers follow the neck bone.
const NECK_TAGS = new Set([
  'neck', 'neckwear',
]);

// Tags whose layers follow the head bone.
const HEAD_TAGS = new Set([
  'face', 'front hair', 'back hair', 'headwear',
  'nose', 'mouth',
  'eyewhite', 'eyewhite-l', 'eyewhite-r',
  'eyelash', 'eyelash-l', 'eyelash-r',
  'eyebrow', 'eyebrow-l', 'eyebrow-r',
  'eyewear', 'ears', 'ears-l', 'ears-r', 'earwear',
  // V1/V2 collapsed eye layer (full eye composite — no separate eyewhite)
  'eyes', 'eyel', 'eyer',
]);

// Tags whose layers move with iris offset (child of head's "eyes" sub-group).
export const IRIS_TAGS = new Set([
  'irides', 'irides-l', 'irides-r',
  // V1/V2: the whole eye layer acts as an iris
  'eyes', 'eyel', 'eyer',
]);

/* ─── Layer tag matching ────────────────────────────────────────────────────── */

/** Returns the canonical tag for a layer name, or null if unrecognised. */
export function matchTag(name) {
  const lower = name.toLowerCase().trim();
  // Exact match first — prevents 'handwear' from matching 'handwear-l', etc.
  for (const tag of KNOWN_TAGS) {
    if (lower === tag) return tag;
  }
  // Then prefix match (e.g. 'front hair 2' → 'front hair')
  for (const tag of KNOWN_TAGS) {
    if (
      lower.startsWith(tag + '-') ||
      lower.startsWith(tag + ' ') ||
      lower.startsWith(tag + '_')
    ) return tag;
  }
  return null;
}

/** True if ≥4 layers match known character-part tags. */
export function detectCharacterFormat(layers) {
  return layers.filter(l => matchTag(l.name) !== null).length >= 4;
}

/* ─── Group analysis ────────────────────────────────────────────────────────── */

/**
 * Detects split / merged / partial / missing status for arms, legs, and feet.
 * @param {Object} layerMap  normalized-name → layer
 */
export function analyzeGroups(layerMap) {
  const has = (n) => !!layerMap[n];
  function splitState(base) {
    const l = has(base + '-l'), r = has(base + '-r');
    if (l && r)    return 'split';
    if (l || r)    return 'partial';
    if (has(base)) return 'merged';
    return 'missing';
  }
  return {
    head:  has('face') || has('front hair') || has('back hair') || has('headwear'),
    torso: has('topwear') || has('neckwear'),
    hips:  has('bottomwear'),
    arms:  splitState('handwear'),
    legs:  splitState('legwear'),
    feet:  splitState('footwear'),
  };
}

/* ─── Bounding-box heuristic skeleton ──────────────────────────────────────── */

/**
 * Estimate skeleton keypoints from the spatial footprints of named layers.
 * Instantaneous; no model required. Accuracy depends on layer naming.
 *
 * @param {Array}  layers  Flat layer array from importPsd (each has x, y, width, height)
 * @param {number} psdW
 * @param {number} psdH
 * @returns {Object} Named keypoints dict compatible with buildArmatureNodes
 */
export function estimateSkeletonFromBounds(layers, psdW, psdH) {
  // Build tag → bbox map (first occurrence wins per tag)
  const tagBboxes = {};
  layers.forEach(layer => {
    const tag = matchTag(layer.name);
    if (!tag || !layer.width || !layer.height) return;
    if (tagBboxes[tag]) return;
    const x = layer.x ?? 0, y = layer.y ?? 0;
    tagBboxes[tag] = { x, y, w: layer.width, h: layer.height,
                       cx: x + layer.width / 2, cy: y + layer.height / 2 };
  });

  const getBbox = tag => tagBboxes[tag] ?? null;
  const firstOf = tags => { for (const t of tags) { const b = getBbox(t); if (b) return b; } return null; };

  const kp = {};

  // Head / Face
  const face = getBbox('face') ?? firstOf(['front hair', 'headwear']);
  if (face) {
    kp.nose    = { x: face.cx,                   y: face.cy + face.h * 0.08 };
    kp.lEye    = { x: face.cx + face.w * 0.18,   y: face.cy - face.h * 0.05 };
    kp.rEye    = { x: face.cx - face.w * 0.18,   y: face.cy - face.h * 0.05 };
    kp.midEye  = { x: face.cx,                   y: face.cy - face.h * 0.05 };
    kp.lEar    = { x: face.cx + face.w * 0.45,   y: face.cy };
    kp.rEar    = { x: face.cx - face.w * 0.45,   y: face.cy };
    // Head joint at bottom of face layer
    kp.headBase = { x: face.cx,                   y: face.y + face.h };
  }

  // Torso / Shoulders
  const topwear = getBbox('topwear');
  if (topwear) {
    kp.neck        = { x: topwear.cx,                       y: topwear.y };
    kp.lShoulder   = { x: topwear.x + topwear.w * 0.85,    y: topwear.y + topwear.h * 0.12 };
    kp.rShoulder   = { x: topwear.x + topwear.w * 0.15,    y: topwear.y + topwear.h * 0.12 };
    kp.shoulderMid = { x: topwear.cx,                       y: topwear.y + topwear.h * 0.12 };
    kp.spine       = { x: topwear.cx,                       y: topwear.cy };
    kp.waist       = { x: topwear.cx,                       y: topwear.y + topwear.h * 0.85 };
  } else if (face) {
    // No topwear: place neck at bottom of face (for bust-only characters)
    kp.neck        = { x: face.cx,                          y: face.y + face.h };
    kp.lShoulder   = { x: face.cx - face.w * 0.2,          y: face.y + face.h };
    kp.rShoulder   = { x: face.cx + face.w * 0.2,          y: face.y + face.h };
    kp.shoulderMid = { x: face.cx,                          y: face.y + face.h };
    kp.spine       = { x: face.cx,                          y: face.y + face.h };
    kp.waist       = { x: face.cx,                          y: face.y + face.h };
  }

  // Arms — wrist from handwear bounds, elbow interpolated halfway
  const handL = getBbox('handwear-l') ?? getBbox('handwear');
  const handR = getBbox('handwear-r') ?? getBbox('handwear');
  if (kp.lShoulder && handL) {
    kp.lWrist = { x: handL.cx, y: handL.y + handL.h * 0.1 };
    kp.lElbow = { x: (kp.lShoulder.x + kp.lWrist.x) / 2, y: (kp.lShoulder.y + kp.lWrist.y) / 2 };
  }
  if (kp.rShoulder && handR) {
    kp.rWrist = { x: handR.cx, y: handR.y + handR.h * 0.1 };
    kp.rElbow = { x: (kp.rShoulder.x + kp.rWrist.x) / 2, y: (kp.rShoulder.y + kp.rWrist.y) / 2 };
  }

  // Hips / Pelvis
  const bottomwear = getBbox('bottomwear');
  if (bottomwear) {
    kp.pelvis = { x: bottomwear.cx,                        y: bottomwear.cy };
    kp.lHip   = { x: bottomwear.cx + bottomwear.w * 0.2,  y: bottomwear.y + bottomwear.h * 0.15 };
    kp.rHip   = { x: bottomwear.cx - bottomwear.w * 0.2,  y: bottomwear.y + bottomwear.h * 0.15 };
  } else if (kp.waist) {
    kp.pelvis = { x: kp.waist.x,           y: kp.waist.y + psdH * 0.08 };
    kp.lHip   = { x: kp.pelvis.x - psdW * 0.1, y: kp.pelvis.y };
    kp.rHip   = { x: kp.pelvis.x + psdW * 0.1, y: kp.pelvis.y };
  }

  // Legs — knee interpolated, ankle from footwear or bottom of legwear
  const legL  = getBbox('legwear-l') ?? getBbox('legwear');
  const legR  = getBbox('legwear-r') ?? getBbox('legwear');
  const footL = getBbox('footwear-l') ?? getBbox('footwear');
  const footR = getBbox('footwear-r') ?? getBbox('footwear');
  if (kp.lHip && legL) {
    const ankle = footL ? { x: footL.cx, y: footL.cy } : { x: legL.cx, y: legL.y + legL.h };
    kp.lAnkle = ankle;
    kp.lKnee  = { x: (kp.lHip.x + ankle.x) / 2, y: (kp.lHip.y + ankle.y) / 2 };
  }
  if (kp.rHip && legR) {
    const ankle = footR ? { x: footR.cx, y: footR.cy } : { x: legR.cx, y: legR.y + legR.h };
    kp.rAnkle = ankle;
    kp.rKnee  = { x: (kp.rHip.x + ankle.x) / 2, y: (kp.rHip.y + ankle.y) / 2 };
  }

  // Mandatory fallbacks for keypoints buildArmatureNodes always reads
  const cx = psdW / 2, cy = psdH / 2;
  if (!kp.pelvis)      kp.pelvis      = { x: cx,              y: cy };
  if (!kp.neck)        kp.neck        = { x: cx,              y: psdH * 0.25 };
  if (!kp.headBase)    kp.headBase    = { x: cx,              y: psdH * 0.22 };
  if (!kp.lShoulder)   kp.lShoulder   = { x: cx + psdW * 0.15, y: psdH * 0.30 };
  if (!kp.rShoulder)   kp.rShoulder   = { x: cx - psdW * 0.15, y: psdH * 0.30 };
  if (!kp.shoulderMid) kp.shoulderMid = { x: cx,              y: psdH * 0.30 };
  if (!kp.waist)       kp.waist       = { x: cx,              y: psdH * 0.55 };
  if (!kp.spine)       kp.spine       = { x: cx,              y: psdH * 0.42 };
  if (!kp.lHip)        kp.lHip        = { x: cx + psdW * 0.1, y: psdH * 0.58 };
  if (!kp.rHip)        kp.rHip        = { x: cx - psdW * 0.1, y: psdH * 0.58 };
  if (!kp.midEye)      kp.midEye      = { x: cx,              y: psdH * 0.18 };

  return kp;
}

/* ─── DWPose ONNX inference ─────────────────────────────────────────────────── */

const DWPOSE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/pose_landmark_full.tflite';
// The actual DWPose model — whole-body 133-point, 288×384 input
export const DWPOSE_URL = 'https://huggingface.co/yzd-v/DWPose/resolve/main/dw-ll_ucoco_384.onnx';

/** Cache the session across imports so we only download / compile once. */
let _cachedSession = null;

/**
 * Load the ONNX session from a URL or ArrayBuffer.
 * Reuses the cached session if already loaded.
 */
export async function loadDWPoseSession(payload) {
  const ort = await _ensureOrt();
  if (_cachedSession) return _cachedSession;
  _cachedSession = await ort.InferenceSession.create(payload, {
    executionProviders: ['wasm'],
  });
  return _cachedSession;
}

/** Discard the cached session (e.g. on error). */
export function clearDWPoseSession() { _cachedSession = null; }

/**
 * Composite all PSD layers onto a single canvas and run DWPose inference.
 *
 * @param {Array}  layers       Flat layer array from importPsd
 * @param {number} psdW
 * @param {number} psdH
 * @param {*}      onnxSession  InferenceSession from loadDWPoseSession
 * @param {Function} [onStatus] Optional callback(msg) for progress updates
 * @returns {Object} Named keypoints dict ({ nose, neck, lShoulder, … })
 */
export async function runDWPose(layers, psdW, psdH, onnxSession, onStatus) {
  const ort = await _ensureOrt();
  const TARGET_W = 288;
  const TARGET_H = 384;

  onStatus?.('Compositing character…');

  // Build composite from ImageData layers (ag-psd gives us imageData on each layer)
  const tmp = document.createElement('canvas');
  tmp.width = psdW; tmp.height = psdH;
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#000';
  tctx.fillRect(0, 0, psdW, psdH);

  for (const layer of layers) {
    if (!layer.imageData) continue;
    const lc = document.createElement('canvas');
    lc.width = layer.width; lc.height = layer.height;
    lc.getContext('2d').putImageData(layer.imageData, 0, 0);
    tctx.drawImage(lc, layer.x, layer.y);
  }

  // Letterbox to model input size
  const scale  = Math.min(TARGET_W / psdW, TARGET_H / psdH);
  const newW   = psdW * scale;
  const newH   = psdH * scale;
  const padX   = (TARGET_W - newW) / 2;
  const padY   = (TARGET_H - newH) / 2;

  const proc = document.createElement('canvas');
  proc.width = TARGET_W; proc.height = TARGET_H;
  const pctx = proc.getContext('2d');
  pctx.fillStyle = '#000';
  pctx.fillRect(0, 0, TARGET_W, TARGET_H);
  pctx.drawImage(tmp, padX, padY, newW, newH);

  onStatus?.('Running DWPose inference…');

  // ImageNet normalisation (same as prototype)
  const imgData  = pctx.getImageData(0, 0, TARGET_W, TARGET_H).data;
  const mean     = [123.675, 116.28,  103.53];
  const std      = [58.395,  57.12,   57.375];
  const f32      = new Float32Array(3 * TARGET_H * TARGET_W);
  const planeSize = TARGET_H * TARGET_W;
  for (let i = 0; i < planeSize; i++) {
    f32[i]               = (imgData[i * 4]     - mean[0]) / std[0];
    f32[planeSize + i]   = (imgData[i * 4 + 1] - mean[1]) / std[1];
    f32[2 * planeSize + i] = (imgData[i * 4 + 2] - mean[2]) / std[2];
  }

  const tensor = new ort.Tensor('float32', f32, [1, 3, TARGET_H, TARGET_W]);
  const feeds  = { [onnxSession.inputNames[0]]: tensor };
  const results = await onnxSession.run(feeds);

  // Find simcc_x (576 bins) and simcc_y (768 bins) outputs by shape
  let simcc_x = null, simcc_y = null;
  for (const key in results) {
    const t = results[key];
    if (!t.dims || t.dims.length !== 3) continue;
    if (t.dims[2] === 576) simcc_x = t.data;
    else if (t.dims[2] === 768) simcc_y = t.data;
  }
  if (!simcc_x || !simcc_y) throw new Error('DWPose: unexpected output format (no simcc_x/simcc_y).');

  // Decode argmax from SimCC bins → model coords → PSD image coords
  const nKp = 133, xBins = 576, yBins = 768;
  const kps = [];
  for (let i = 0; i < nKp; i++) {
    let mx = -Infinity, mxI = 0;
    for (let j = 0; j < xBins; j++) {
      const v = simcc_x[i * xBins + j];
      if (v > mx) { mx = v; mxI = j; }
    }
    let my = -Infinity, myI = 0;
    for (let j = 0; j < yBins; j++) {
      const v = simcc_y[i * yBins + j];
      if (v > my) { my = v; myI = j; }
    }
    kps.push({
      x:    (mxI / 2.0 - padX) / scale,
      y:    (myI / 2.0 - padY) / scale,
      conf: Math.min(mx, my),
    });
  }

  return applyDWPoseKeypoints(kps, psdW, psdH);
}

/**
 * Map raw DWPose keypoint array (COCO-133 ordering) to our named skeleton dict.
 * Clamps all points to image bounds.
 */
function applyDWPoseKeypoints(kps, psdW, psdH) {
  function clamp(p) {
    return { x: Math.max(0, Math.min(psdW, p.x)), y: Math.max(0, Math.min(psdH, p.y)) };
  }
  const sk = {
    nose:       clamp(kps[0]),
    lEye:       clamp(kps[1]),
    rEye:       clamp(kps[2]),
    lEar:       clamp(kps[3]),
    rEar:       clamp(kps[4]),
    lShoulder:  clamp(kps[5]),
    rShoulder:  clamp(kps[6]),
    lElbow:     clamp(kps[7]),
    rElbow:     clamp(kps[8]),
    lWrist:     clamp(kps[9]),
    rWrist:     clamp(kps[10]),
    lHip:       clamp(kps[11]),
    rHip:       clamp(kps[12]),
    lKnee:      clamp(kps[13]),
    rKnee:      clamp(kps[14]),
    lAnkle:     clamp(kps[15]),
    rAnkle:     clamp(kps[16]),
  };

  // Shoulder midpoint (actual shoulder line, used for bothArms pivot)
  sk.shoulderMid = {
    x: (sk.lShoulder.x + sk.rShoulder.x) / 2,
    y: (sk.lShoulder.y + sk.rShoulder.y) / 2,
  };

  sk.pelvis = {
    x: (sk.lHip.x + sk.rHip.x) / 2,
    y: (sk.lHip.y + sk.rHip.y) / 2,
  };

  // Neck: base of neck, above the shoulder line.
  // Image-space y increases downward, so nose.y < shoulderMid.y.
  // Move 20% of the way from shoulder toward nose to reach throat/collarbone.
  sk.neck = {
    x: sk.shoulderMid.x,
    y: sk.shoulderMid.y + (sk.nose.y - sk.shoulderMid.y) * 0.2,
  };

  // Waist: where the torso bends — 30% of the way from hips toward shoulders.
  // Keeps torso pivot well above the hip line so it doesn't overlap with legs.
  sk.waist = {
    x: sk.pelvis.x,
    y: sk.pelvis.y + (sk.shoulderMid.y - sk.pelvis.y) * 0.3,
  };

  sk.spine = {
    x: (sk.neck.x + sk.pelvis.x) / 2,
    y: (sk.neck.y + sk.pelvis.y) / 2,
  };
  sk.midEye = {
    x: (sk.lEye.x + sk.rEye.x) / 2,
    y: (sk.lEye.y + sk.rEye.y) / 2,
  };
  return sk;
}

/* ─── Armature node builder ─────────────────────────────────────────────────── */

/**
 * Which bone does this tag belong to?
 * Returns a bone name string. Bones that don't exist for a given groups config
 * fall back to 'root'.
 */
function boneForTag(tag, groups) {
  if (IRIS_TAGS.has(tag))                             return 'eyes';
  if (NECK_TAGS.has(tag))                             return 'neck';
  if (HEAD_TAGS.has(tag))                             return 'head';
  if (tag === 'topwear')                              return 'torso';
  if (tag === 'bottomwear')                           return 'root';
  if (tag === 'handwear-l')                           return 'leftArm';
  if (tag === 'handwear-r')                           return 'rightArm';
  if (tag === 'handwear')                             return 'bothArms';
  if (tag === 'legwear-l' || tag === 'footwear-l')    return 'leftLeg';
  if (tag === 'legwear-r' || tag === 'footwear-r')    return 'rightLeg';
  if (tag === 'legwear'   || tag === 'footwear')      return 'bothLegs';
  return 'root';
}

/**
 * Build the armature group hierarchy and per-layer bone assignments.
 *
 * @param {Object}   skeleton  Named keypoints from runDWPose / applyDWPoseKeypoints
 * @param {Object}   groups    From analyzeGroups()
 * @param {Array}    layers    Flat layer array from importPsd (indexed)
 * @param {string[]} partIds   Pre-generated IDs, 1:1 with layers
 * @param {Function} uidFn     ID generator
 * @returns {{
 *   groupDefs: Array<{id,name,parentId,boneRole,pivotX,pivotY}>,
 *   assignments: Map<number, {parentGroupId, drawOrder}>
 * }}
 */
export function buildArmatureNodes(skeleton, groups, layers, partIds, uidFn) {
  const kp = skeleton;

  // Ensure headBase is set from face layer bounding box (DWPose doesn't provide this)
  if (!kp.headBase) {
    const tagBboxes = {};
    layers.forEach(layer => {
      const tag = matchTag(layer.name);
      if (!tag || !layer.width || !layer.height) return;
      if (tagBboxes[tag]) return;
      const x = layer.x ?? 0, y = layer.y ?? 0;
      tagBboxes[tag] = { x, y, w: layer.width, h: layer.height, cx: x + layer.width / 2, cy: y + layer.height / 2 };
    });
    const face = tagBboxes['face'] ?? tagBboxes['front hair'] ?? tagBboxes['headwear'];
    if (face) {
      kp.headBase = { x: face.cx, y: face.y + face.h };
    }
  }

  /* ── Decide which groups to create ── */
  const hasNeck = layers.some(l => NECK_TAGS.has(matchTag(l.name)));
  const hasHead = groups.head || layers.some(l => HEAD_TAGS.has(matchTag(l.name)));
  const needGroup = {
    root:      true,
    torso:     groups.torso || hasNeck || hasHead,
    neck:      hasNeck || hasHead,
    head:      hasHead,
    eyes:      layers.some(l => IRIS_TAGS.has(matchTag(l.name))),
    leftArm:   groups.arms === 'split' || (groups.arms === 'partial' && layers.some(l => matchTag(l.name) === 'handwear-l')),
    rightArm:  groups.arms === 'split' || (groups.arms === 'partial' && layers.some(l => matchTag(l.name) === 'handwear-r')),
    bothArms:  groups.arms === 'merged',
    leftElbow: groups.arms === 'split' || (groups.arms === 'partial' && layers.some(l => matchTag(l.name) === 'handwear-l')),
    rightElbow:groups.arms === 'split' || (groups.arms === 'partial' && layers.some(l => matchTag(l.name) === 'handwear-r')),
    leftLeg:   groups.legs === 'split' || (groups.legs === 'partial' && layers.some(l => matchTag(l.name) === 'legwear-l')),
    rightLeg:  groups.legs === 'split' || (groups.legs === 'partial' && layers.some(l => matchTag(l.name) === 'legwear-r')),
    leftKnee:  groups.legs === 'split' || (groups.legs === 'partial' && layers.some(l => matchTag(l.name) === 'legwear-l')),
    rightKnee: groups.legs === 'split' || (groups.legs === 'partial' && layers.some(l => matchTag(l.name) === 'legwear-r')),
    bothLegs:  groups.legs === 'merged',
  };

  /* ── Pivot positions from skeleton ── */
  const pivots = {
    root:      kp.pelvis,
    torso:     kp.waist,        // waist level — above hips, distinct from legs pivot
    neck:      kp.neck,         // base of neck, above shoulder line
    head:      kp.headBase ?? kp.midEye, // bottom of face — where head rotates on neck
    eyes:      kp.midEye,       // between eyes — iris offset center
    leftArm:   kp.lShoulder,
    rightArm:  kp.rShoulder,
    leftElbow: kp.lElbow,
    rightElbow:kp.rElbow,
    bothArms:  kp.shoulderMid,  // actual shoulder midpoint
    leftLeg:   kp.lHip,
    rightLeg:  kp.rHip,
    leftKnee:  kp.lKnee,
    rightKnee: kp.rKnee,
    bothLegs:  kp.pelvis,       // hip line
  };

  /* ── Parent relationships ── */
  const parentBone = {
    root:      null,
    torso:     'root',
    neck:      needGroup.torso ? 'torso' : 'root',
    head:      needGroup.neck  ? 'neck'  : (needGroup.torso ? 'torso' : 'root'),
    eyes:      needGroup.head  ? 'head'  : (needGroup.neck ? 'neck' : 'root'),
    leftArm:   needGroup.torso ? 'torso' : 'root',
    rightArm:  needGroup.torso ? 'torso' : 'root',
    leftElbow: needGroup.leftArm ? 'leftArm' : (needGroup.torso ? 'torso' : 'root'),
    rightElbow:needGroup.rightArm ? 'rightArm' : (needGroup.torso ? 'torso' : 'root'),
    bothArms:  needGroup.torso ? 'torso' : 'root',
    leftLeg:   'root',
    rightLeg:  'root',
    leftKnee:  needGroup.leftLeg ? 'leftLeg' : 'root',
    rightKnee: needGroup.rightLeg ? 'rightLeg' : 'root',
    bothLegs:  'root',
  };

  /* ── Create in parent-before-child order ── */
  const CREATE_ORDER = ['root','torso','neck','head','eyes','leftArm','rightArm','leftElbow','rightElbow','bothArms','leftLeg','rightLeg','leftKnee','rightKnee','bothLegs'];

  const groupIds = {};
  const groupDefs = [];

  for (const bone of CREATE_ORDER) {
    if (!needGroup[bone]) continue;
    const id  = uidFn();
    const piv = pivots[bone] ?? { x: 0, y: 0 };
    groupIds[bone] = id;
    const parentBoneName = parentBone[bone];
    const parentId = parentBoneName ? (groupIds[parentBoneName] ?? null) : null;
    groupDefs.push({ id, name: bone, parentId, boneRole: bone, pivotX: piv.x, pivotY: piv.y });
  }

  /* ── Build layerMap for fast lookup (normalized name → layer index) ── */
  const tagToLayerIndex = {};
  layers.forEach((layer, i) => {
    const t = matchTag(layer.name);
    if (t && tagToLayerIndex[t] === undefined) tagToLayerIndex[t] = i;
  });

  /* ── Assign each layer to a bone group ── */
  const assignments = new Map();

  layers.forEach((layer, i) => {
    const tag = matchTag(layer.name);
    const bone = tag ? boneForTag(tag, groups) : 'root';

    // Fall back to root if the target bone wasn't created
    const resolvedBone = (needGroup[bone] && groupIds[bone]) ? bone : 'root';
    const parentGroupId = groupIds[resolvedBone] ?? null;

    assignments.set(i, {
      parentGroupId,
      drawOrder: layers.length - 1 - i,
    });
  });

  return { groupDefs, assignments };
}

/* ─── Skeleton topology (for SkeletonOverlay) ──────────────────────────────── */

/**
 * Lines to draw connecting bone joints.
 * Each entry is [fromBoneRole, toBoneRole].
 */
export const SKELETON_CONNECTIONS = [
  ['torso', 'neck'],
  ['neck',  'head'],
  ['head',  'eyes'],
  ['torso', 'leftArm'],
  ['torso', 'rightArm'],
  ['leftArm', 'leftElbow'],
  ['rightArm', 'rightElbow'],
  ['torso',  'leftLeg'],
  ['torso',  'rightLeg'],
  ['leftLeg', 'leftKnee'],
  ['rightLeg', 'rightKnee'],
  // merged variants
  ['torso', 'bothArms'],
  ['torso',  'bothLegs'],
];

/**
 * Given the current project nodes, extract a keypoints dict suitable for
 * SkeletonOverlay — just the pivot of each bone group.
 *
 * @param {Array} nodes  project.nodes
 * @returns {Object}     boneRole → {x, y}
 */
export function getSkeletonFromNodes(nodes) {
  const result = {};
  for (const node of nodes) {
    if (node.type === 'group' && node.boneRole) {
      result[node.boneRole] = {
        x: node.transform.pivotX,
        y: node.transform.pivotY,
      };
    }
  }
  return result;
}
