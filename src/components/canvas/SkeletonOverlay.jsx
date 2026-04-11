/**
 * SkeletonOverlay — SVG overlay drawn on top of the WebGL canvas.
 *
 * Shows the armature skeleton (bone lines + joint circles) derived from group
 * nodes that have a `boneRole` property.  In skeletonEditMode, joints are
 * draggable: dragging a joint updates that group node's pivotX/pivotY in the
 * project store, which immediately changes where that bone rotates.
 *
 * Coordinate transform:
 *   image-space (px)  →  canvas CSS px:  cssX = px * zoom + panX
 *   canvas CSS px     →  image-space:    px  = (cssX - panX) / zoom
 */

import React, { useCallback, useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { SKELETON_CONNECTIONS } from '@/io/armatureOrganizer';

// Colour palette
const COLOUR_NORMAL = '#ef4444';      // red — not in edit mode
const COLOUR_EDIT   = '#facc15';      // yellow — edit mode ready to drag
const COLOUR_DRAG   = '#22d3ee';      // cyan — currently dragging
const LINE_COLOUR   = 'rgba(34,211,238,0.55)';

const JOINT_RADIUS_NORMAL = 5;
const JOINT_RADIUS_EDIT   = 8;

/** Convert image-space coords → SVG/CSS coords */
function toScreen(x, y, zoom, panX, panY) {
  return [x * zoom + panX, y * zoom + panY];
}

/** Convert SVG/CSS coords → image-space */
function toImage(cssX, cssY, zoom, panX, panY) {
  return [(cssX - panX) / zoom, (cssY - panY) / zoom];
}

export default function SkeletonOverlay({ view, editorMode, showSkeleton, skeletonEditMode }) {
  const updateProject  = useProjectStore(s => s.updateProject);
  const nodes          = useProjectStore(s => s.project.nodes);

  const dragRef  = useRef(null); // { nodeId }
  const svgRef   = useRef(null);

  const boneNodes = React.useMemo(() => {
    const map = {};
    for (const n of nodes) {
      if (n.type === 'group' && n.boneRole) map[n.boneRole] = n;
    }
    return map;
  }, [nodes]);

  /* ── Pointer handlers — defined unconditionally (Rules of Hooks) ── */

  const onPointerDown = useCallback((e, nodeId) => {
    if (!skeletonEditMode) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { nodeId };
  }, [skeletonEditMode]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const { zoom, panX, panY } = view;
    const [imgX, imgY] = toImage(cssX, cssY, zoom, panX, panY);
    const { nodeId } = dragRef.current;
    updateProject((proj) => {
      const node = proj.nodes.find(n => n.id === nodeId);
      if (node) {
        node.transform.pivotX = imgX;
        node.transform.pivotY = imgY;
      }
    });
  }, [view, updateProject]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  /* ── Early exit (after all hooks) ── */

  const hasArmature = Object.keys(boneNodes).length > 0;
  if (!hasArmature || !showSkeleton || editorMode !== 'staging') return null;

  const { zoom, panX, panY } = view;

  /* ── Build SVG elements ── */

  const radius = skeletonEditMode ? JOINT_RADIUS_EDIT : JOINT_RADIUS_NORMAL;

  const lines = [];
  for (const [fromRole, toRole] of SKELETON_CONNECTIONS) {
    const from = boneNodes[fromRole];
    const to   = boneNodes[toRole];
    if (!from || !to) continue;
    const [x1, y1] = toScreen(from.transform.pivotX, from.transform.pivotY, zoom, panX, panY);
    const [x2, y2] = toScreen(to.transform.pivotX,   to.transform.pivotY,   zoom, panX, panY);
    lines.push(
      <line key={`${fromRole}-${toRole}`}
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={LINE_COLOUR} strokeWidth={skeletonEditMode ? 2 : 1.5}
        strokeLinecap="round" pointerEvents="none"
      />
    );
  }

  const circles = [];
  for (const [role, node] of Object.entries(boneNodes)) {
    const [cx, cy] = toScreen(node.transform.pivotX, node.transform.pivotY, zoom, panX, panY);
    const isDragging = dragRef.current?.nodeId === node.id;
    const fill = isDragging ? COLOUR_DRAG : (skeletonEditMode ? COLOUR_EDIT : COLOUR_NORMAL);
    circles.push(
      <circle key={role}
        cx={cx} cy={cy} r={radius}
        fill={fill} stroke="#000" strokeWidth={1.5}
        style={{ cursor: skeletonEditMode ? 'grab' : 'default' }}
        onPointerDown={(e) => onPointerDown(e, node.id)}
      />
    );
    if (skeletonEditMode) {
      // Label under each joint in edit mode for orientation
      circles.push(
        <text key={`${role}-label`}
          x={cx} y={cy + radius + 11}
          textAnchor="middle" fontSize={9}
          fill="rgba(255,255,255,0.7)" pointerEvents="none"
          style={{ userSelect: 'none' }}
        >
          {role}
        </text>
      );
    }
  }

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ pointerEvents: skeletonEditMode ? 'all' : 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {lines}
      {circles}
    </svg>
  );
}
