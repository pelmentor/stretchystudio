/**
 * WarpLatticeOverlay — SVG grid of draggable control points for a selected warpDeformer node.
 *
 * Rendered inside the GizmoOverlay SVG when a warp deformer is selected.
 * Drag a control point → updates draftPose for live preview.
 * Pointer up → commits the grid positions as a mesh_verts keyframe on the bound
 * animation track at the time that corresponds to the current parameter value.
 */
import React, { useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { useParameterStore } from '@/store/parameterStore';
import { interpolateMeshVerts, upsertKeyframe } from '@/renderer/animationEngine';

/** Build the regular (col+1)×(row+1) rest grid from the warp deformer node bounds. */
function buildRestGrid(wdNode) {
  const col = wdNode.col ?? 2;
  const row = wdNode.row ?? 2;
  const gx  = wdNode.gridX ?? 0;
  const gy  = wdNode.gridY ?? 0;
  const gw  = wdNode.gridW ?? 100;
  const gh  = wdNode.gridH ?? 100;
  const pts = [];
  for (let r = 0; r <= row; r++) {
    for (let c = 0; c <= col; c++) {
      pts.push({ x: gx + (col > 0 ? c * gw / col : 0), y: gy + (row > 0 ? r * gh / row : 0) });
    }
  }
  return pts;
}

export function WarpLatticeOverlay({ wdNode, view }) {
  const dragRef = useRef(null);
  const viewRef = useRef(view);
  React.useEffect(() => { viewRef.current = view; }, [view]);

  const parameters    = useProjectStore(s => s.project.parameters);
  const animations    = useProjectStore(s => s.project.animations);
  const updateProject = useProjectStore(s => s.updateProject);
  const paramValues   = useParameterStore(s => s.values);
  const draftPose     = useAnimationStore(s => s.draftPose);

  const col      = wdNode.col ?? 2;
  const row      = wdNode.row ?? 2;
  const stride   = col + 1; // points per row
  const numPts   = stride * (row + 1);

  const restGrid = React.useMemo(
    () => buildRestGrid(wdNode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wdNode.col, wdNode.row, wdNode.gridX, wdNode.gridY, wdNode.gridW, wdNode.gridH],
  );

  // --- Determine current control point positions ---
  // Priority: 1) draftPose (active drag)  2) parameter-interpolated  3) rest grid
  let currentGrid = restGrid;

  const draft = draftPose.get(wdNode.id)?.mesh_verts;
  if (draft && draft.length === numPts) {
    currentGrid = draft;
  } else {
    const param   = parameters.find(p => p.id === wdNode.parameterId);
    const binding = param?.bindings?.find(b => b.nodeId === wdNode.id && b.property === 'mesh_verts');
    if (param && binding) {
      const anim  = animations.find(a => a.id === binding.animationId);
      const track = anim?.tracks.find(t => t.nodeId === wdNode.id && t.property === 'mesh_verts');
      if (track?.keyframes?.length >= 1) {
        const curVal = paramValues[param.id] ?? param.default ?? 0;
        const norm   = Math.max(0, Math.min(1, (curVal - param.min) / (param.max - param.min)));
        const t0     = track.keyframes[0].time;
        const tN     = track.keyframes[track.keyframes.length - 1].time;
        const timeMs = t0 + norm * (tN - t0);
        const interp = interpolateMeshVerts(track.keyframes, timeMs);
        if (interp && interp.length === numPts) currentGrid = interp;
      }
    }
  }

  // --- Screen-space helpers ---
  const { zoom, panX, panY } = view;
  const toS = (pt) => [pt.x * zoom + panX, pt.y * zoom + panY];

  // --- Build SVG grid lines ---
  const gridLines = [];
  // Horizontal lines (one per row)
  for (let r = 0; r <= row; r++) {
    const pts = [];
    for (let c = 0; c <= col; c++) {
      const [sx, sy] = toS(currentGrid[r * stride + c]);
      pts.push(`${sx.toFixed(1)},${sy.toFixed(1)}`);
    }
    gridLines.push(
      <polyline key={`h${r}`} points={pts.join(' ')}
        fill="none" stroke="rgba(100,220,255,0.65)" strokeWidth="1" strokeDasharray="4 2" />,
    );
  }
  // Vertical lines (one per col)
  for (let c = 0; c <= col; c++) {
    const pts = [];
    for (let r = 0; r <= row; r++) {
      const [sx, sy] = toS(currentGrid[r * stride + c]);
      pts.push(`${sx.toFixed(1)},${sy.toFixed(1)}`);
    }
    gridLines.push(
      <polyline key={`v${c}`} points={pts.join(' ')}
        fill="none" stroke="rgba(100,220,255,0.65)" strokeWidth="1" strokeDasharray="4 2" />,
    );
  }

  // --- Pointer handlers ---
  function onPtDown(e, ptIdx) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      ptIdx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPts: currentGrid.map(p => ({ x: p.x, y: p.y })),
    };
  }

  function onPtMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const z = viewRef.current.zoom;
    const dx = (e.clientX - drag.startClientX) / z;
    const dy = (e.clientY - drag.startClientY) / z;
    const newPts = drag.startPts.map((p, i) =>
      i === drag.ptIdx ? { x: p.x + dx, y: p.y + dy } : { x: p.x, y: p.y },
    );
    useAnimationStore.getState().setDraftPose(wdNode.id, { mesh_verts: newPts });
  }

  function onPtUp(e) {
    const drag = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!drag) return;

    const finalPts = useAnimationStore.getState().draftPose.get(wdNode.id)?.mesh_verts;
    if (!finalPts) return;

    // Commit as a keyframe if a parameter binding exists
    const param   = parameters.find(p => p.id === wdNode.parameterId);
    const binding = param?.bindings?.find(b => b.nodeId === wdNode.id && b.property === 'mesh_verts');

    if (param && binding) {
      const curVal = paramValues[param.id] ?? param.default ?? 0;
      const norm   = Math.max(0, Math.min(1, (curVal - param.min) / (param.max - param.min)));

      updateProject(proj => {
        const anim = proj.animations.find(a => a.id === binding.animationId);
        if (!anim) return;
        let track = anim.tracks.find(t => t.nodeId === wdNode.id && t.property === 'mesh_verts');
        if (!track) {
          track = { nodeId: wdNode.id, property: 'mesh_verts', keyframes: [] };
          anim.tracks.push(track);
        }

        // Map the current parameter norm to a time on the animation track
        let timeMs;
        if (track.keyframes.length >= 2) {
          const t0 = track.keyframes[0].time;
          const tN = track.keyframes[track.keyframes.length - 1].time;
          timeMs = t0 + norm * (tN - t0);
        } else if (track.keyframes.length === 1) {
          // Spread the new keyframe ±1 s from the existing one
          const existing = track.keyframes[0].time;
          timeMs = norm <= 0.5 ? Math.min(existing - 1000, 0) : Math.max(existing + 1000, 1000);
        } else {
          // Empty track: place min at 0 ms, max at 1000 ms
          timeMs = Math.round(norm * 1000);
        }

        upsertKeyframe(track.keyframes, Math.round(timeMs), finalPts, 'linear');
      });
    }

    // Clear drag draftPose so the committed keyframe drives the display
    useAnimationStore.getState().clearDraftPoseForNode(wdNode.id);
  }

  const isCornerIdx = (i) => {
    const r = Math.floor(i / stride), c = i % stride;
    return (r === 0 || r === row) && (c === 0 || c === col);
  };

  const hasBoundParam = !!(wdNode.parameterId && parameters.find(p => p.id === wdNode.parameterId));

  return (
    <>
      {/* Grid lines */}
      {gridLines}

      {/* Instruction label when no binding is configured */}
      {!hasBoundParam && (
        <text
          x={toS(restGrid[0])[0]}
          y={toS(restGrid[0])[1] - 10}
          fill="rgba(100,220,255,0.8)"
          fontSize="11"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          Set a parameter in the Inspector to record keyforms
        </text>
      )}

      {/* Control point handles */}
      {currentGrid.map((pt, i) => {
        const [sx, sy] = toS(pt);
        const corner = isCornerIdx(i);
        return (
          <circle
            key={i}
            cx={sx} cy={sy}
            r={corner ? 6 : 4.5}
            fill={corner ? 'rgba(80,200,255,0.9)' : 'rgba(50,170,230,0.85)'}
            stroke="white"
            strokeWidth={corner ? 1.5 : 1}
            style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
            onPointerDown={e => onPtDown(e, i)}
            onPointerMove={onPtMove}
            onPointerUp={onPtUp}
          />
        );
      })}
    </>
  );
}
