# Joint Implementation & Vertex Skinning

Stretchy Studio uses a custom, lightweight JavaScript-driven skinning engine to achieve realistic limb bending (elbows and knees). This document details the technical implementation, mathematical model, and identified technical debt.

## 1. Overview

To maintain rendering performance and avoid complex GPU shader logic, limb deformation is calculated on the CPU and injected into the existing vertex override pipeline.

- **Weighting**: Performed during mesh generation/remeshing.
- **Deformation**: Performed in real-time within the input handling loop of the `SkeletonOverlay`.
- **Interpolation**: Handled by the standard `animationEngine` using vertex array blending.

## 2. Vertex Weighting Model

Limb layers (e.g., `handwear-l`) are parented to a "shoulder" bone (`leftArm`). An "elbow" bone (`leftElbow`) acts as a child pivot.

### Axis-Aware Projection
The system calculates weights by projecting each vertex onto the vector defined by the shoulder-to-elbow axis.

```javascript
// Axis vector from shoulder (sx, sy) to elbow (jx, jy)
const axDx = jx - sx;
const axDy = jy - sy;
const axLen = Math.sqrt(axDx * axDx + axDy * axDy) || 1;
const axX = axDx / axLen;
const axY = axDy / axLen;

// Signed distance of vertex past the elbow pivot along the axis
const proj = (v.x - jx) * axX + (v.y - jy) * axY;

// Normalize weight with a 40px blending zone
const weight = Math.max(0, Math.min(1, proj / 40 + 0.5));
```

- **Weight 0.0**: Rigidly bound to the shoulder (Upper Limb).
- **Weight 1.0**: Rigidly bound to the elbow rotation (Lower Limb).
- **0.0 - 1.0**: Blended deformation (The Joint).

## 3. Real-time Interaction

### Interaction Intercept
`SkeletonOverlay.jsx` intercepts pointer events for bones with roles matching `leftElbow`, `rightElbow`, `leftKnee`, or `rightKnee`.

1. **PointerDown**: Captures the "starting" vertex positions of all dependent parts (parts where `mesh.jointBoneId` matches the bone being dragged).
2. **PointerMove**: Calculates a rotation matrix for each vertex. The rotation angle is scaled by the vertex weight (`rad * weight`).
3. **DraftPose Streaming**: The resulting deformed vertices are written directly to `draftPose.mesh_verts`.

### Render Loop Integration
The `rAF` tick in `CanvasViewport.jsx` was modified to always inject `draftPose.mesh_verts` into the `poseOverrides` map. This allows the GPU to upload the new positions even if the editor is in **Staging** mode, providing instant visual feedback during rigging.

## 4. Keyframing

When a joint bone (elbow/knee) is keyframed (via the `K` key), the system automatically expands the selection to include all "dependent parts." This ensures that the current vertex deformation is saved as a vertex keyframe on the part, tightly syncing the bone rotation with the mesh warp.

## 5. Technical Debt & Caveats

> [!IMPORTANT]
> **Hardcoded Role Tokens**: The implementation relies on exact string matches for `leftElbow`, `rightElbow`, `leftKnee`, and `rightKnee`. Adding new limb joints would require updating sets in `CanvasViewport.jsx`, `SkeletonOverlay.jsx`, and `Inspector.jsx`.

> [!WARNING]
> **Linear Projection Bias**: The current weighting model assumes limbs are relatively straight segments. Highly curved or "L-shaped" limbs in the base texture may result in uneven weight distributions.

> [!NOTE]
> **Staging Feedback**: Using `draftPose` for staging feedback is a slight deviation from the original intention of `draftPose` (which was for animation mode only). This creates a dependency where staging-mode "pose" logic is coupled with the animation store.

## 6. Future Recommendations

- **Bone Grouping**: Implement a more robust tagging system instead of hardcoded strings to allow for tail joints, neck segments, etc.
- **Volume Preservation**: The current linear skinning can cause "candy-wrapper" effects on 180-degree bends. Implementing Dual Quaternion Skinning (DQS) in JS would solve this, though it is significantly more complex.
