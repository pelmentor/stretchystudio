// @ts-check

/**
 * armatureMeta — boot-light metadata extracted from `armatureOrganizer.js`.
 *
 * Phase A2 loading sweep (2026-05-09): the eager consumers (CanvasViewport
 * for `detectCharacterFormat`, SkeletonOverlay for `SKELETON_CONNECTIONS`,
 * PsdImportWizard for `KNOWN_TAGS`) used to pull the entire
 * `armatureOrganizer.js` module — 744 lines including DWPose ONNX glue
 * and the bone-tree builder. With this split, eager consumers import
 * from here; the heavy pipeline stays behind `armatureOrganizer.js`
 * (kept under the lazy wizard / dwposeService graph).
 *
 * `armatureOrganizer.js` re-exports these so existing imports keep
 * working without churn; new code should target this module directly.
 *
 * @module io/armatureMeta
 */

import { extractVariant } from './psdOrganizer.js';

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

/**
 * Match a layer name against KNOWN_TAGS. Exact match first (so
 * 'handwear' doesn't claim 'handwear-l'), then prefix match for
 * variants like 'front hair 2' → 'front hair'.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function matchTag(name) {
  // Variants pair with their base tag (e.g. "mouth.smile" → "mouth").
  const { baseName } = extractVariant(name);
  const lower = baseName.toLowerCase().trim();
  for (const tag of KNOWN_TAGS) {
    if (lower === tag) return tag;
  }
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

/* ─── Skeleton connectivity ─────────────────────────────────────────────────── */

/**
 * Bone-graph edges drawn by SkeletonOverlay. The renderer skips any
 * (from, to) pair where either side is missing in the project, so
 * partial skeletons (no `neck`, no eyes) render correctly without
 * code branches.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const SKELETON_CONNECTIONS = [
  // Root → direct children
  ['root',  'torso'],
  ['root',  'leftLeg'],
  ['root',  'rightLeg'],
  ['root',  'bothLegs'],
  // Spine
  ['torso', 'neck'],
  ['neck',  'head'],
  ['head',  'eyes'],
  // Arms
  ['torso', 'leftArm'],
  ['torso', 'rightArm'],
  ['leftArm',  'leftElbow'],
  ['rightArm', 'rightElbow'],
  ['torso', 'bothArms'],
  // Legs
  ['leftLeg',  'leftKnee'],
  ['rightLeg', 'rightKnee'],
];
