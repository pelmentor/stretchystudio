// @ts-check

/**
 * NodeTree visual layout helpers (pure functions, no DOM).
 *
 * Phase N-4 of the V2 plan. Walks a NodeTree and produces:
 *   - Node positions (uses node.position if set; otherwise auto-layouts
 *     in topological order, source-left → sink-right).
 *   - Link path control points (cubic Bézier from source-output socket
 *     to dest-input socket).
 *
 * Pure JS so the layout can be tested in Node without a renderer.
 *
 * @module v3/editors/nodetree/nodeLayout
 */

import { topoOrderTree } from '../../../anim/nodetree/types.js';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const COL_GAP = 40;
const ROW_GAP = 30;

/**
 * @typedef {object} NodeRect
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 *
 * @typedef {object} LinkPath
 * @property {string} fromNode
 * @property {string} toNode
 * @property {string} fromSocket
 * @property {string} toSocket
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {string} d   - SVG path d= attribute (cubic Bézier)
 *
 * @typedef {object} TreeLayout
 * @property {NodeRect[]} nodes
 * @property {LinkPath[]} links
 */

/**
 * Auto-layout a tree. Topo-orders nodes, places sources at column 0,
 * incrementing column by 1 per topo step. Within a column, stack
 * vertically with ROW_GAP.
 *
 * @param {import('../../../anim/nodetree/types.js').NodeTree} tree
 * @returns {TreeLayout}
 */
export function layoutTree(tree) {
  /** @type {NodeRect[]} */
  const nodes = [];
  /** @type {Map<string, NodeRect>} */
  const byId = new Map();

  if (!tree || !Array.isArray(tree.nodes)) return { nodes, links: [] };

  // Compute topo column for each node.
  const ordered = topoOrderTree(tree);
  /** @type {Map<string, number>} */
  const colByNode = new Map();
  for (const n of ordered) {
    let col = 0;
    for (const l of tree.links ?? []) {
      if (l.toNode === n.id) {
        col = Math.max(col, (colByNode.get(l.fromNode) ?? 0) + 1);
      }
    }
    colByNode.set(n.id, col);
  }

  // Stack rows per column.
  /** @type {Map<number, number>} - col -> next-row-index */
  const colRow = new Map();
  for (const n of ordered) {
    const col = colByNode.get(n.id) ?? 0;
    const row = colRow.get(col) ?? 0;
    colRow.set(col, row + 1);
    const px = (n.position?.[0] ?? (col * (NODE_WIDTH + COL_GAP)));
    const py = (n.position?.[1] ?? (row * (NODE_HEIGHT + ROW_GAP)));
    const rect = { id: n.id, x: px, y: py, w: NODE_WIDTH, h: NODE_HEIGHT };
    nodes.push(rect);
    byId.set(n.id, rect);
  }

  /** @type {LinkPath[]} */
  const links = [];
  for (const l of tree.links ?? []) {
    const from = byId.get(l.fromNode);
    const to = byId.get(l.toNode);
    if (!from || !to) continue;
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const dx = (x2 - x1) * 0.5;
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    links.push({
      fromNode: l.fromNode,
      toNode: l.toNode,
      fromSocket: l.fromSocket,
      toSocket: l.toSocket,
      x1, y1, x2, y2, d,
    });
  }

  return { nodes, links };
}

/**
 * Compute the bounding box of a layout — useful for sizing the
 * visual canvas.
 *
 * @param {TreeLayout} layout
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
export function layoutBounds(layout) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of layout.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
