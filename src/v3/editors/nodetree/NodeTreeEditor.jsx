// @ts-check

/**
 * V2 Phase N-4 — Visual NodeTree editor (read-only).
 *
 * Renders a single NodeTree (RigTree / DriverTree / AnimationTree)
 * as an SVG graph: rectangles for nodes, cubic Bézier paths for
 * links. Read-only in N-4 — Phase N-5 adds drag/connect/delete.
 *
 * Mode pill switches between the three tree types:
 *   - 'rig'      → renders the active part's RigTree.
 *   - 'driver'   → renders the active parameter's DriverTree.
 *   - 'animation'→ renders the active animation's AnimationTree.
 *
 * Empty-state when no tree exists for the active selection (e.g.
 * driver mode while the active parameter has no driver).
 *
 * @module v3/editors/nodetree/NodeTreeEditor
 */

import { useMemo } from 'react';
import { layoutTree, layoutBounds } from './nodeLayout.js';
import { getNodeType } from '../../../anim/nodetree/registry.js';

/**
 * @param {Object} props
 * @param {import('../../../anim/nodetree/types.js').NodeTree | null} props.tree
 * @param {string} [props.title]
 * @param {string | null} [props.activeNodeId]
 * @param {(nodeId: string) => void} [props.onSelectNode]
 */
export function NodeTreeEditor({ tree, title, activeNodeId, onSelectNode }) {
  const layout = useMemo(() => (tree ? layoutTree(tree) : { nodes: [], links: [] }), [tree]);
  const bounds = useMemo(() => layoutBounds(layout), [layout]);

  if (!tree) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No tree available for this selection.
      </div>
    );
  }

  const padding = 40;
  const viewW = Math.max(400, bounds.maxX - bounds.minX + padding * 2);
  const viewH = Math.max(300, bounds.maxY - bounds.minY + padding * 2);
  const viewBoxX = bounds.minX - padding;
  const viewBoxY = bounds.minY - padding;

  return (
    <div className="flex flex-col h-full bg-background">
      {title && (
        <div className="text-xs text-muted-foreground px-2 py-1 border-b border-border">
          {title}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <svg
          width={viewW}
          height={viewH}
          viewBox={`${viewBoxX} ${viewBoxY} ${viewW} ${viewH}`}
          className="block"
          style={{ background: 'hsl(var(--muted) / 0.2)' }}
        >
          {/* Links first so nodes overlay on top. */}
          {layout.links.map((l, i) => (
            <path
              key={`l-${i}`}
              d={l.d}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              opacity={0.7}
            />
          ))}
          {layout.nodes.map((rect) => {
            const node = tree.nodes.find((n) => n.id === rect.id);
            if (!node) return null;
            const typeInfo = getNodeType(node.typeId);
            const isActive = activeNodeId === node.id;
            return (
              <g
                key={rect.id}
                transform={`translate(${rect.x}, ${rect.y})`}
                onClick={() => onSelectNode?.(node.id)}
                className="cursor-pointer"
              >
                <rect
                  x={0}
                  y={0}
                  width={rect.w}
                  height={rect.h}
                  rx={6}
                  ry={6}
                  fill="hsl(var(--card))"
                  stroke={isActive ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                  strokeWidth={isActive ? 2 : 1}
                />
                <text
                  x={10}
                  y={20}
                  fontSize={11}
                  fontWeight={600}
                  fill="hsl(var(--foreground))"
                >
                  {typeInfo?.label ?? node.typeId}
                </text>
                <text
                  x={10}
                  y={36}
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                >
                  {nodeSubtitle(node)}
                </text>
                {/* Input socket dots on the LEFT edge. */}
                {(node.inputs ?? []).map((sock, i) => (
                  <circle
                    key={`in-${i}`}
                    cx={0}
                    cy={rect.h / 2 + (i - (node.inputs.length - 1) / 2) * 8}
                    r={3}
                    fill="hsl(var(--muted-foreground))"
                  >
                    <title>{`${sock.identifier} (${sock.type})`}</title>
                  </circle>
                ))}
                {/* Output socket dots on the RIGHT edge. */}
                {(node.outputs ?? []).map((sock, i) => (
                  <circle
                    key={`out-${i}`}
                    cx={rect.w}
                    cy={rect.h / 2 + (i - (node.outputs.length - 1) / 2) * 8}
                    r={3}
                    fill="hsl(var(--primary))"
                  >
                    <title>{`${sock.identifier} (${sock.type})`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/**
 * Subtitle line under the node label — surfaces type-specific info.
 *
 * @param {import('../../../anim/nodetree/types.js').NodeTreeNode} node
 * @returns {string}
 */
function nodeSubtitle(node) {
  const s = node.storage;
  if (!s) return '';
  if (typeof s.deformerId === 'string') return s.deformerId + (s.synthetic ? ' (synth)' : '');
  if (typeof s.paramId === 'string') return s.paramId;
  if (typeof s.value === 'number') return String(s.value);
  if (typeof s.op === 'string') return s.op;
  if (s.driver?.expression) return String(s.driver.expression).slice(0, 30);
  if (s.track) return s.track.paramId ?? `${s.track.nodeId}.${s.track.property}`;
  return '';
}
