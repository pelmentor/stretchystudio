# TBLR (Top-Bottom-Left-Right) Split Implementation

This document provides a technical breakdown of how the See-through framework handles the semantic splitting of layers into Left/Right and Depth-based components (TBLR).

## Overview

The "TBLR split" is a heuristic post-processing stage used to further decompose semantically identified layers (like "eyes" or "handwear") into distinct sub-layers suitable for Live2D rigging. While the primary model identifies "handwear" as a single semantic class, the TBLR logic separates the left hand from the right hand based on spatial connectivity and coordinates.

## Key Implementation Files

- **[common/utils/inference_utils.py](file:///home/fiery/seethrough-repo/common/utils/inference_utils.py)**: Contains the core mathematical and image processing logic.
- **[inference/scripts/heuristic_partseg.py](file:///home/fiery/seethrough-repo/inference/scripts/heuristic_partseg.py)**: Provides a CLI interface for running these splits on existing PSD files.

---

## Core Logic: Left-Right Split (`seg_wlr`)

The Left-Right split is primarily used for symmetric body parts.

### 1. Connected Component Analysis
The system uses `cv2.connectedComponentsWithStats` to analyze the alpha mask of a layer. It identifies all spatially isolated "islands" of pixels.

```python
num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
    mask.astype(np.uint8) * 255, connectivity=8)
```

### 2. Cluster Selection and Ordering
If multiple clusters are detected, the system:
1.  Filters out the background (cluster 0).
2.  Sorts remaining clusters by area (`stats[..., -1]`) to identify the two most significant parts (e.g., the two gloves).
3.  Passes the top two clusters to `label_lr_split`.

### 3. Spatial Designation (`label_lr_split`)
The centroids of the two clusters are compared. The cluster with the **lower X-coordinate** is designated as the character's right-side part (which appears on the left side of the image from the viewer's perspective), and vice-versa.

```python
def label_lr_split(labels, stats, id1, id2):
    x1 = stats[id1][0] + stats[id1][2] / 2
    x2 = stats[id2][0] + stats[id2][2] / 2
    if x2 < x1:
        return label2, label1, stats2, stats1
    else:
        return label1, label2, stats1, stats2
```

### 4. Extraction and Naming
The split parts are cropped to their individual bounding boxes and saved with suffixes:
- `-l`: Left (Viewer's right)
- `-r`: Right (Viewer's left)

---

## Specialized Handling

### Eyes and Facial Features
For facial components, the logic is more granular. In the `v3` pipeline, the following tags are automatically passed through the LR-split logic:
- `eyewhite`
- `irides`
- `eyelash`
- `eyebrow`
- `ears`

There is also a fallback for a combined `eyes` layer ([L452 in inference_utils.py](file:///home/fiery/seethrough-repo/common/utils/inference_utils.py#L452)) that attempt to extract four parts (`eyer`, `eyel`, `browr`, `browl`) by assuming the four largest connected components are the two eyes and two brows.

### Hair Depth Splitting (`cluster_inpaint_part`)
While not strictly a "Left-Right" split, the hair is often split into **front** and **back** using depth-based clustering. 
The system uses K-Means clustering on the depth map values within the hair mask to separate "Front Hair" from "Back Hair" based on their median depth values.

---

## Usage

### Integration in Main Pipeline
The split is triggered by the `--tblr_split` flag in `inference_psd.py`:
```bash
python inference/scripts/inference_psd.py --srcp assets/test_image.png --tblr_split
```

### Manual Trigger on PSD
You can selectively split layers in an existing PSD:
```bash
# Split handwear into left and right
python inference/scripts/heuristic_partseg.py seg_wlr --srcp workspace/output/sample.psd --target_tags handwear

# Split hair based on depth
python inference/scripts/heuristic_partseg.py seg_wdepth --srcp workspace/output/sample.psd --target_tags hair
```

---

## Limitations
- **Occlusion**: If two symmetric parts overlap (e.g., one hand over the other), they may be detected as a single connected component, causing the LR split to fail or result in only one layer.
- **Complexity**: Highly complex accessories with multiple floating parts may result in too many connected components, leading the heuristic to only pick the two largest ones.
