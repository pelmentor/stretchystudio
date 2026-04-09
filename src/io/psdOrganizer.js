/**
 * PSD character format auto-organizer.
 *
 * Detects whether imported PSD layers follow the expected character part naming
 * convention, and if so, organizes them into a Head / Body / Extras group hierarchy
 * with a correct back-to-front draw_order.
 */

export const KNOWN_TAGS = [
  'back hair', 'front hair',
  'headwear', 'face', 'irides', 'eyebrow', 'eyewhite', 'eyelash', 'eyewear',
  'ears', 'earwear', 'nose', 'mouth',
  'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear', 'footwear',
  'tail', 'wings', 'objects',
];

// Back-to-front canonical render order
const DRAW_ORDER_LIST = [
  'back hair',
  'wings', 'tail',
  'neck', 'topwear', 'bottomwear', 'legwear', 'footwear', 'handwear', 'neckwear',
  'ears', 'face',
  'eyewhite', 'irides', 'eyebrow', 'eyelash',
  'nose', 'mouth',
  'earwear', 'eyewear',
  'front hair', 'headwear',
  'objects',
];

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
  'bottomwear': ['body'],
  'legwear':    ['body'],
  'footwear':   ['body'],
  'tail':       ['body', 'extras'],
  'wings':      ['body', 'extras'],
  'objects':    ['body', 'extras'],
};

// Parent group for each group name (null = root)
const GROUP_PARENT = {
  eyes:      'head',
  head:      'upperbody',
  upperbody: 'body',
  extras:    'body',
  body:      null,
};

// Creation order — parents before children
const GROUP_CREATE_ORDER = ['body', 'upperbody', 'head', 'extras', 'eyes'];

/** Returns the matched tag for a layer name, or null. */
export function matchTag(name) {
  const lower = name.toLowerCase().trim();
  for (const tag of KNOWN_TAGS) {
    if (
      lower === tag ||
      lower.startsWith(tag + '-') ||
      lower.startsWith(tag + ' ') ||
      lower.startsWith(tag + '_')
    ) {
      return tag;
    }
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

  // Sort layers: primary = DRAW_ORDER_LIST index, secondary = original order (stable)
  const drawIdx = tag => {
    const i = DRAW_ORDER_LIST.indexOf(tag);
    return i === -1 ? DRAW_ORDER_LIST.length : i;
  };
  const sorted = [...tagged].sort((a, b) => {
    const d = drawIdx(a.tag) - drawIdx(b.tag);
    return d !== 0 ? d : a.i - b.i;
  });

  // Build assignments map: original layer index → { parentGroupId, drawOrder }
  const assignments = new Map();
  sorted.forEach((item, sortedIdx) => {
    const groups = item.tag ? TAG_TO_GROUPS[item.tag] : null;
    const innermost = groups ? groups[groups.length - 1] : null;
    assignments.set(item.i, {
      parentGroupId: innermost ? (groupIds[innermost] ?? null) : null,
      drawOrder: sortedIdx,
    });
  });

  return { groupDefs, assignments };
}
