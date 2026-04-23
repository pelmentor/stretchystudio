/**
 * PSD character format auto-organizer.
 *
 * Detects whether imported PSD layers follow the expected character part naming
 * convention, and if so, organizes them into a Head / Body / Extras group hierarchy
 * while PRESERVING the original PSD draw order.
 */

export const KNOWN_TAGS = [
  'back hair', 'front hair',
  'headwear', 'face', 'irides', 'eyebrow', 'eyewhite', 'eyelash', 'eyewear',
  'ears', 'earwear', 'nose', 'mouth',
  'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear', 'footwear',
  'tail', 'wings', 'objects',
];

/**
 * Reference list of the emotion/state suffixes we've thought through —
 * kept for documentation. Detection is *not* gated on this list: ANY
 * `<base>.<suffix>` layer name where suffix is a reasonable identifier
 * (alpha start, ≥3 chars) is treated as a variant. This lets users
 * freely add outfit / seasonal / accessory variants (`topwear.summer`,
 * `topwear-l.winter`, `face.beard`, …) without a code change.
 *
 * Pipeline for any detected variant:
 *   - organizer groups the variant with its base by tag (suffix stripped)
 *   - variantNormalizer pairs it with the base and normalizes parent +
 *     draw_order
 *   - cmo3writer auto-registers `Param<Suffix>` and emits the fade
 */
export const VARIANT_SUFFIXES = [
  // emotions
  'smile', 'sad', 'angry', 'surprised', 'blush', 'wink',
  // outfit / seasonal (examples — not exhaustive)
  'summer', 'winter', 'spring', 'fall', 'autumn',
  'casual', 'formal',
];

/**
 * Regex for the suffix portion after the last dot: letter/underscore start,
 * alphanumeric+underscore body, minimum total length 3. Excludes `.l`, `.r`,
 * `.1`, `.01`, `.v1` (too short / numeric prefix) and similar non-variant
 * dotted patterns that might appear in layer names.
 */
const VARIANT_SUFFIX_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{2,}$/;

/** Turn a variant suffix into the Live2D parameter id, e.g. `smile` → `ParamSmile`. */
export function variantParamId(suffix) {
  if (!suffix) return null;
  return 'Param' + suffix.charAt(0).toUpperCase() + suffix.slice(1).toLowerCase();
}

/**
 * Split a layer name into base + variant.
 *   "mouth.smile"     → { baseName: "mouth",     variant: "smile" }
 *   "topwear.summer"  → { baseName: "topwear",   variant: "summer" }
 *   "topwear-l.winter"→ { baseName: "topwear-l", variant: "winter" }
 *   "topwear"         → { baseName: "topwear",   variant: null }
 *   "face.shadow"     → { baseName: "face",      variant: "shadow" }
 *   "hair.2"          → { baseName: "hair.2",    variant: null }   // numeric
 *   "foo.l"           → { baseName: "foo.l",     variant: null }   // too short
 *
 * Detection is structural (regex), not allowlist-based — any plausible
 * variant suffix works. Case-insensitive on the suffix; preserves
 * original base-name casing.
 */
export function extractVariant(name) {
  const trimmed = (name ?? '').trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) return { baseName: trimmed, variant: null };
  const candidate = trimmed.slice(lastDot + 1);
  if (!VARIANT_SUFFIX_PATTERN.test(candidate)) {
    return { baseName: trimmed, variant: null };
  }
  return {
    baseName: trimmed.slice(0, lastDot),
    variant: candidate.toLowerCase(),
  };
}


// tag → group path (outermost → innermost)
const TAG_TO_GROUPS = {
  'back hair':  ['body', 'upperbody', 'head'],
  'front hair': ['body', 'upperbody', 'head'],
  'headwear':   ['body', 'upperbody', 'head'],
  'face':       ['body', 'upperbody', 'head'],
  'irides':     ['body', 'upperbody', 'head', 'eyes'],
  'eyebrow':    ['body', 'upperbody', 'head', 'eyes'],
  'eyewhite':   ['body', 'upperbody', 'head', 'eyes'],
  'eyelash':    ['body', 'upperbody', 'head', 'eyes'],
  'eyewear':    ['body', 'upperbody', 'head', 'eyes'],
  'ears':       ['body', 'upperbody', 'head'],
  'earwear':    ['body', 'upperbody', 'head'],
  'nose':       ['body', 'upperbody', 'head'],
  'mouth':      ['body', 'upperbody', 'head'],
  'neck':       ['body', 'upperbody'],
  'neckwear':   ['body', 'upperbody'],
  'topwear':    ['body', 'upperbody'],
  'handwear':   ['body', 'upperbody'],
  'bottomwear': ['body', 'lowerbody'],
  'legwear':    ['body', 'lowerbody'],
  'footwear':   ['body', 'lowerbody'],
  'tail':       ['body', 'extras'],
  'wings':      ['body', 'extras'],
  'objects':    ['body', 'extras'],
};

// Parent group for each group name (null = root)
const GROUP_PARENT = {
  eyes:      'head',
  head:      'upperbody',
  upperbody: 'body',
  lowerbody: 'body',
  extras:    'body',
  body:      null,
};

// Creation order — parents before children
const GROUP_CREATE_ORDER = ['body', 'upperbody', 'lowerbody', 'head', 'extras', 'eyes'];

/** Returns the matched tag for a layer name, or null. */
export function matchTag(name) {
  // Variants pair with their base tag (e.g. "mouth.smile" → "mouth").
  const { baseName } = extractVariant(name);
  const lower = baseName.toLowerCase().trim();
  // Exact match first — prevents 'handwear' from matching 'handwear-l', etc.
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

/** Returns true if at least 4 layers match known character part tags. */
export function detectCharacterFormat(layers) {
  const hits = layers.filter(l => matchTag(l.name) !== null).length;
  return hits >= 4;
}

/**
 * Computes group definitions and per-layer assignments for organized import.
 *
 * @param {object[]} layers   - flat array from importPsd
 * @param {()=>string} uidFn  - uid generator (same as used for part nodes)
 * @returns {{
 *   groupDefs: {id:string, name:string, parentId:string|null}[],
 *   assignments: Map<number, {parentGroupId:string|null, drawOrder:number}>
 * }}
 */
export function organizeCharacterLayers(layers, uidFn) {
  const tagged = layers.map((layer, i) => ({ i, tag: matchTag(layer.name) }));

  // Which groups are actually needed?
  const neededGroups = new Set();
  tagged.forEach(({ tag }) => {
    if (tag) TAG_TO_GROUPS[tag]?.forEach(g => neededGroups.add(g));
  });

  // Create group nodes (parents first so IDs exist when children reference them)
  const groupIds = {};
  const groupDefs = [];
  for (const gName of GROUP_CREATE_ORDER) {
    if (!neededGroups.has(gName)) continue;
    const id = uidFn();
    groupIds[gName] = id;
    groupDefs.push({ id, name: gName, parentId: GROUP_PARENT[gName] ? groupIds[GROUP_PARENT[gName]] : null });
  }

  // Build assignments map: original layer index → { parentGroupId, drawOrder }
  const assignments = new Map();
  const numLayers = layers.length;
  tagged.forEach((item) => {
    const groups = item.tag ? TAG_TO_GROUPS[item.tag] : null;
    const innermost = groups ? groups[groups.length - 1] : null;
    assignments.set(item.i, {
      parentGroupId: innermost ? (groupIds[innermost] ?? null) : null,
      drawOrder: numLayers - 1 - item.i,
    });
  });

  return { groupDefs, assignments };
}
