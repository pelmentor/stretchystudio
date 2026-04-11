# See-through PSD Rigger: Auto-Rigging Strategies

The rigger provides two ways to automatically generate a skeleton from a PSD. This documentation explains the logic behind both the heuristic (fast) and the AI (precision) methods.

## Method 1: Bounding-Box Heuristic (`estimateSkeletonFromBounds`)

This is the default, local method. it uses the spatial footprints of named layers to "guess" where joints should be.

### Key Logic:
- **Head**: Anchored to the center of the `face` layer.
- **Torso/Neck**: Uses the top edge of the `topwear` layer.
- **Arms**: If a `handwear` layer is present, the wrist is placed near its bottom edge, and the elbow is interpolated halfway between the shoulder and wrist.
- **Legs**: Similar to arms, using `legwear` or `footwear` bounds.

**Example snippet (Heuristic face detection):**
```javascript
const face = getBbox('face') || firstBbox(['front hair', 'headwear']);
if (face) {
  kp.nose = { x: face.cx, y: face.cy + face.h * 0.08 };
  kp.lEye = { x: face.cx - face.w * 0.18, y: face.cy - face.h * 0.05 };
  // ...
}
```

## Method 2: DWPose ONNX Inference (`runAndApplyDWPose`)

This method runs a whole-body pose detection model (`DWPose`) directly in the browser using **ONNX Runtime Web**.

### 1. Preparation
Since the model expects a standard image, the rigger composites all layers into their rest positions onto a black background.

### 2. Preprocessing
The image is resized and letterboxed to the model's expected input dimensions (typically 288x384). The pixel data is then normalized (mean/std subtraction) and converted into a Float32 tensor.

### 3. Inference
The model is executed via `onnxruntime-web`. The outputs (SimCC) are heatmap-like representations of joint positions along the X and Y axes.

### 4. Post-processing
- **Decoding**: The SimCC outputs are searched for the max probability index to find the X and Y coordinates in model-space.
- **Rescaling**: Coordinates are scaled back from the letterboxed 288x384 space to the original image dimensions.
- **Mapping**: The standard COCO 133-keypoint output is mapped to the rigger's internal skeleton dictionary.

```javascript
// Mapping COCO results to rigger skeleton
function applyDWPoseKeypoints(kps) {
  kp.nose       = kps[0];
  kp.lShoulder  = kps[5];
  kp.rShoulder  = kps[6];
  // Calculate midpoints for internal nodes
  kp.neck = {
    x: (kp.lShoulder.x + kp.rShoulder.x) / 2,
    y: (kp.lShoulder.y + kp.rShoulder.y) / 2,
  };
  // ...
}
```

## Comparisons

| Feature | Bounding Box Heuristic | DWPose ONNX |
| :--- | :--- | :--- |
| **Speed** | Instantaneous | 1-5 seconds (depends on GPU/CPU) |
| **Accuracy** | Rough guess | High precision |
| **Dependencies** | None | ~50MB Model File |
| **Internet Req.** | No | Yes (to download model first time) |
| **Reliability** | Depends on layer naming | Works regardless of layer naming |
