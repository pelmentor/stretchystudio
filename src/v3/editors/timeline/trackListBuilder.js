// @ts-check

/**
 * v3 Phase 1.Timeline — track display row builder.
 *
 * Pure function pulled out of TimelineEditor so it has a node-test
 * lock-down without dragging React + zustand into the test runner.
 *
 * Maps raw `animation.tracks` (`{nodeId, property, keyframes}[]`)
 * into display rows (`{id, label, keyframes}[]`) sorted by node
 * order then property name so siblings group together visually.
 *
 * Property-label conventions:
 *   - 'mesh_verts'           → 'mesh'
 *   - 'blendShape:<id>'      → 'blendshape · <shape.name | id>'
 *   - everything else        → unchanged
 *
 * @module v3/editors/timeline/trackListBuilder
 */

/**
 * @typedef {Object} Keyframe
 * @property {number} time
 * @property {number|number[]} value
 * @property {string} [easing]
 *
 * @typedef {Object} Track
 * @property {string} nodeId
 * @property {string} property
 * @property {Keyframe[]} keyframes
 *
 * @typedef {Object} ProjectNode
 * @property {string} id
 * @property {string} [name]
 * @property {Array<{id:string, name?:string}>} [blendShapes]
 *
 * @typedef {Object} TrackRow
 * @property {string} id
 * @property {string} label
 * @property {Keyframe[]} keyframes
 */

/**
 * @param {Track[]}        tracks
 * @param {ProjectNode[]}  nodes
 * @returns {TrackRow[]}
 */
export function buildTrackList(tracks, nodes) {
  const nodeIndex = new Map(
    (nodes ?? []).map((n, i) => [n.id, { name: n.name ?? n.id, order: i, node: n }]),
  );

  const rows = (tracks ?? []).map((t, i) => {
    const meta = nodeIndex.get(t.nodeId);
    const nodeName = meta?.name ?? t.nodeId;
    const propLabel = formatPropertyLabel(t.property, meta?.node);
    return {
      id: `${t.nodeId}::${t.property}::${i}`,
      label: `${nodeName} · ${propLabel}`,
      keyframes: Array.isArray(t.keyframes) ? t.keyframes : [],
      _order: meta?.order ?? Number.MAX_SAFE_INTEGER,
      _prop: t.property,
    };
  });

  rows.sort((a, b) => a._order - b._order || a._prop.localeCompare(b._prop));

  // Strip the sort keys before returning so callers can't accidentally
  // depend on them.
  return rows.map(({ id, label, keyframes }) => ({ id, label, keyframes }));
}

/**
 * @param {string} prop
 * @param {ProjectNode|undefined} node
 * @returns {string}
 */
export function formatPropertyLabel(prop, node) {
  if (typeof prop !== 'string') return String(prop);
  if (prop === 'mesh_verts') return 'mesh';
  if (prop.startsWith('blendShape:')) {
    const id = prop.slice('blendShape:'.length);
    const shape = node?.blendShapes?.find((s) => s.id === id);
    return `blendshape · ${shape?.name ?? id}`;
  }
  return prop;
}
