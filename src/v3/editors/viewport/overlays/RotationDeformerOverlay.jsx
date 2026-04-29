// @ts-check

/**
 * v3 Phase 2B — Rotation Deformer Editor: pivot + handle overlay.
 *
 * Renders the active rotation deformer's pivot point + a thin handle
 * pointing along its current angle. Read-only first cut: enough to
 * visually verify auto-rig pivot placement (e.g. neck rotation
 * pivot landing inside the neck base, elbow joint pivot at the
 * shoulder of the forearm group). Drag-to-edit lands together with
 * Phase 2D's Keyform Editor.
 *
 * Coverage: same restriction as the Warp overlay — only frames in
 * `canvas-px` (the top of the rotation chain). Pivot-relative
 * children show a hint instead.
 *
 * @module v3/editors/viewport/overlays/RotationDeformerOverlay
 */

import { useEditorStore } from '../../../../store/editorStore.js';
import { useRigSpecStore } from '../../../../store/rigSpecStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';

const DEG2RAD = Math.PI / 180;

export function RotationDeformerOverlay() {
  const rigSpec = useRigSpecStore((s) => s.rigSpec);
  const view = useEditorStore((s) => s.view);
  const activeDeformerId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'deformer') return items[i].id;
    }
    return null;
  });

  if (!rigSpec || !activeDeformerId) return null;

  const rot = (rigSpec.rotationDeformers ?? []).find((r) => r?.id === activeDeformerId);
  if (!rot) return null;

  const kf = (rot.keyforms ?? [])[0];
  if (!kf) return null;

  const isCanvasPx =
    rot.parent?.type === 'root' || rot.parent?.type === 'part';
  if (!isCanvasPx) {
    return (
      <div
        className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-2 py-1
                   rounded bg-card/80 border border-border text-[10px]
                   text-muted-foreground font-mono"
      >
        {rot.name ?? rot.id} — pivot-relative; overlay Phase 2D.
      </div>
    );
  }

  const cx = kf.originX ?? 0;
  const cy = kf.originY ?? 0;
  const px = cx * view.zoom + view.panX;
  const py = cy * view.zoom + view.panY;

  // Handle length: prefer the deformer's declared canvas radius so
  // the visual matches the auto-rig's bone-bind footprint.
  const handleLen = Math.max(40, (rot.handleLengthOnCanvas ?? 200) * view.zoom);
  const radius = Math.max(6, (rot.circleRadiusOnCanvas ?? 60) * view.zoom);

  // Display angle: average across the rotation's keyforms so the
  // visualised handle reflects whatever pose the user has scrubbed
  // to. For a single-keyform rotation this is just the resting
  // angle.
  const angles = (rot.keyforms ?? []).map((k) => k.angle ?? 0);
  const angle = angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : 0;
  const rad = (rot.baseAngle ?? 0 + angle) * DEG2RAD;
  const hx = px + Math.cos(rad) * handleLen;
  const hy = py + Math.sin(rad) * handleLen;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
    >
      <g>
        <circle
          cx={px} cy={py} r={radius}
          fill="none"
          stroke="rgb(251 191 36 / 0.6)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        <line
          x1={px} y1={py} x2={hx} y2={hy}
          stroke="rgb(251 191 36 / 0.9)"
          strokeWidth={2}
        />
        <circle cx={px} cy={py} r={4}
          fill="rgb(251 191 36)" stroke="rgb(15 23 42 / 0.85)" strokeWidth={1.5} />
        <circle cx={hx} cy={hy} r={3}
          fill="rgb(251 191 36 / 0.9)" stroke="rgb(15 23 42 / 0.85)" strokeWidth={1} />
        <text
          x={px + 8} y={py - 8}
          fontSize={10}
          fill="rgb(251 191 36)"
          style={{ fontFamily: 'monospace' }}
        >
          {rot.name ?? rot.id}  {angle.toFixed(1)}°
        </text>
      </g>
    </svg>
  );
}
