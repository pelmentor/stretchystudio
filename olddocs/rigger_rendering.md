# See-through PSD Rigger: Rendering & Transforms

This document details the mathematical and technical logic used to render the character's layers correctly in their posed state.

## Hierarchical Transformations

The rigger uses a standard scene-graph approach where each layer is attached to a "bone". The final position of a layer is determined by its bone's world matrix.

### World Matrix Calculation
The world matrix for a bone is calculated recursively by multiplying the parent's world matrix by the local transformation of the current bone.

**Local Transformation Chain:**
1. **Translate** to the bone's translation offset (`tx`, `ty`).
2. **Translate** to the bone's `pivot` point (image space).
3. **Rotate** by the `rot` angle.
4. **Translate** back by the negative `pivot` point.

```javascript
function computeWorldMatrix(boneName) {
  const b = state.bones[boneName];
  if (!b) return new DOMMatrix();
  
  let m = new DOMMatrix();
  m = m.translate(b.tx, b.ty);
  m = m.translate(b.pivot.x, b.pivot.y);
  m = m.rotate(b.rot);
  m = m.translate(-b.pivot.x, -b.pivot.y);
  
  if (b.parent) {
    // ParentWorld * LocalTransform
    return computeWorldMatrix(b.parent).multiply(m);
  }
  return m;
}
```

## Iris Clipping Mechanism

A key feature of the rigger is the ability for eyes to "look around" while staying within the boundaries of the eye socket. This is achieved using an offscreen canvas and `globalCompositeOperation`.

### Logic Steps:
1. **Identify Pairing**: Map the iris layer (e.g., `irides-l`) to its corresponding eyewhite layer (`eyewhite-l`).
2. **Draw Destination**: Draw the eyewhite layer onto an offscreen canvas using the head's world matrix.
3. **Clipping Mode**: Set the `globalCompositeOperation` to `'source-in'`. This ensures subsequent draws only appear where the current canvas content is opaque.
4. **Draw Source**: Apply the additional `irisOffset` translation and draw the iris layer.
5. **Composite**: Draw the final offscreen result onto the main canvas.

```javascript
// Inside the main render loop:
if (IRIS_TAGS.has(name)) {
  const ew = getEyewhiteLayer(name); // returns 'eyewhite-l' etc.
  if (ew) {
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
    offCtx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    
    // 1. Draw eyewhite as the destination mask
    offCtx.drawImage(ew.canvas, ew.left, ew.top);
    
    // 2. Set composite to 'source-in'
    offCtx.globalCompositeOperation = 'source-in';
    
    // 3. Apply look-around offset and draw iris
    offCtx.translate(state.irisOffset.x, state.irisOffset.y);
    offCtx.drawImage(layer.canvas, layer.left, layer.top);
    
    offCtx.globalCompositeOperation = 'source-over';
    
    // 4. Draw result to main canvas
    ctx.drawImage(offCanvas, 0, 0);
    continue;
  }
}
```

## Composition Order
To ensure correct occlusion (e.g., hair behind head, clothes on top of body), the rigger iterates through the layers in the exact order they were declared in the PSD (provided by `ag-psd`'s children list). Since the list is processed from start to finish (bottom-to-top), standard alpha compositing handles the depth correctly.
