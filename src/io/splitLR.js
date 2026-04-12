/**
 * splitLR.js
 *
 * Client-side Left/Right split for a single merged layer (e.g. "handwear").
 * Mirrors the server-side TBLR heuristic documented in docs/TBLR_implementation.md.
 *
 * Algorithm:
 *   1. Label every opaque pixel with a connected-component ID (8-connectivity, union-find).
 *   2. Find the two largest components by pixel count.
 *   3. Designate the component with the lower centroid X as "left" (Viewer's left), 
 *      and the higher X as "right" (Viewer's right). This matches the project's
 *      convention in armatureOrganizer.js where 'l' is at lower X.
 *   4. Crop each component to its minimal bounding box and return two PsdLayer objects.
 */

/** Threshold below which a pixel is treated as transparent. */
const ALPHA_THRESHOLD = 10;

/* ── Union-Find ────────────────────────────────────────────────────────────── */

function makeUF(n) {
  const parent = new Int32Array(n);
  const rank   = new Uint8Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  return { parent, rank };
}

function find(uf, x) {
  while (uf.parent[x] !== x) {
    uf.parent[x] = uf.parent[uf.parent[x]]; // path compression (halving)
    x = uf.parent[x];
  }
  return x;
}

function unite(uf, a, b) {
  a = find(uf, a); b = find(uf, b);
  if (a === b) return;
  if (uf.rank[a] < uf.rank[b]) { const t = a; a = b; b = t; }
  uf.parent[b] = a;
  if (uf.rank[a] === uf.rank[b]) uf.rank[a]++;
}

/* ── Main split function ───────────────────────────────────────────────────── */

/**
 * Split a merged layer into left and right components.
 *
 * @param {object} layer   A PsdLayer object (has .imageData, .x, .y, .width, .height, .name, …)
 * @param {number} psdW    Full PSD canvas width
 * @param {number} psdH    Full PSD canvas height
 * @returns {{ right: object|null, left: object|null, componentCount: number }}
 *   right = character's right (lower centroid X in image = viewer's left)
 *   left  = character's left  (higher centroid X = viewer's right)
 *   Returns null for a side if no component was found.
 *   componentCount = total number of opaque connected components found.
 */
export function splitLayerLR(layer, psdW, psdH) {
  const { imageData, width: W, height: H, x: offX, y: offY } = layer;
  const data = imageData.data;
  const N = W * H;

  /* 1. Build a mask of opaque pixels */
  const opaque = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    opaque[i] = data[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
  }

  /* 2. Union-Find connected-component labeling (8-connectivity) */
  const uf = makeUF(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!opaque[idx]) continue;
      // Connect to left neighbour
      if (x > 0 && opaque[idx - 1])     unite(uf, idx, idx - 1);
      // Connect to upper-left / above / upper-right (8-connectivity)
      if (y > 0) {
        if (                   opaque[idx - W])     unite(uf, idx, idx - W);
        if (x > 0          && opaque[idx - W - 1]) unite(uf, idx, idx - W - 1);
        if (x < W - 1      && opaque[idx - W + 1]) unite(uf, idx, idx - W + 1);
      }
    }
  }

  /* 3. Collect stats per root: pixel count, sum of x/y for centroid */
  const pixCount   = new Map(); // root → count
  const sumX       = new Map(); // root → ΣpixelX
  const sumY       = new Map(); // root → ΣpixelY
  const minXMap    = new Map();
  const minYMap    = new Map();
  const maxXMap    = new Map();
  const maxYMap    = new Map();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!opaque[idx]) continue;
      const root = find(uf, idx);
      const cnt = (pixCount.get(root) ?? 0) + 1;
      pixCount.set(root, cnt);
      sumX.set(root, (sumX.get(root) ?? 0) + x);
      sumY.set(root, (sumY.get(root) ?? 0) + y);
      if (!minXMap.has(root) || x < minXMap.get(root)) minXMap.set(root, x);
      if (!minYMap.has(root) || y < minYMap.get(root)) minYMap.set(root, y);
      if (!maxXMap.has(root) || x > maxXMap.get(root)) maxXMap.set(root, x);
      if (!maxYMap.has(root) || y > maxYMap.get(root)) maxYMap.set(root, y);
    }
  }

  const componentCount = pixCount.size;

  if (componentCount < 2) {
    // Can't split — only one (or zero) connected components
    return { right: null, left: null, componentCount };
  }

  /* 4. Pick the two largest components */
  const sorted = Array.from(pixCount.entries()).sort((a, b) => b[1] - a[1]);
  const [root1, cnt1] = sorted[0];
  const [root2, cnt2] = sorted[1];

  /* 5. Centroids — use pixel-space X centroid within the layer */
  const cx1 = sumX.get(root1) / cnt1;
  const cx2 = sumX.get(root2) / cnt2;

  // Lower centroid X → Viewer's left (-l)
  const rootLeft  = cx1 < cx2 ? root1 : root2;
  const rootRight = cx1 < cx2 ? root2 : root1;

  /* 6. Extract each component into its own cropped ImageData */
  function extractComponent(root) {
    const minX = minXMap.get(root), minY = minYMap.get(root);
    const maxX = maxXMap.get(root), maxY = maxYMap.get(root);
    const cW = maxX - minX + 1;
    const cH = maxY - minY + 1;

    const out = new ImageData(cW, cH);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const srcIdx = y * W + x;
        if (!opaque[srcIdx]) continue;
        if (find(uf, srcIdx) !== root) continue;
        const dstIdx = (y - minY) * cW + (x - minX);
        out.data[dstIdx * 4]     = data[srcIdx * 4];
        out.data[dstIdx * 4 + 1] = data[srcIdx * 4 + 1];
        out.data[dstIdx * 4 + 2] = data[srcIdx * 4 + 2];
        out.data[dstIdx * 4 + 3] = data[srcIdx * 4 + 3];
      }
    }

    return {
      imageData: out,
      x: offX + minX,
      y: offY + minY,
      width: cW,
      height: cH,
    };
  }

  const rightExtract = extractComponent(rootRight);
  const leftExtract  = extractComponent(rootLeft);

  return {
    right: rightExtract,
    left:  leftExtract,
    componentCount,
  };
}
