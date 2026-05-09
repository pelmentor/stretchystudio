// @ts-check

/**
 * test_alphaMask.mjs — exhaustive correctness for the M7b downsampler.
 *
 * Properties checked:
 *   1. Tiny sources (<= 256 px) pass through 1:1 (no downsample).
 *   2. Square 4K sources downsample to exactly 256×256.
 *   3. Non-square sources preserve aspect (longer dim → 256).
 *   4. Sample-at-source-coordinate matches the alpha at the nearest
 *      source pixel for ≥ 95% of canvas-px samples on a clean rectangle
 *      mask.
 *   5. Out-of-canvas coordinates return 0 (no spurious hits beyond
 *      the source).
 *   6. Empty / zero-sized inputs return zero-length records and
 *      return-0 from sampleAlphaMask.
 */

import { downsampleAlphaMask, sampleAlphaMask } from '../../src/components/canvas/viewport/alphaMask.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

function makeRect(w, h, box, alpha = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      data[(y * w + x) * 4 + 3] = alpha;
    }
  }
  return { data, width: w, height: h };
}

// 1. Tiny source — passes through 1:1.
{
  const src = makeRect(64, 32, { x0: 10, y0: 5, x1: 50, y1: 25 });
  const r = downsampleAlphaMask(src);
  assert(r.w === 64 && r.h === 32, '1:1 small-source dims');
  assert(r.srcW === 64 && r.srcH === 32, '1:1 srcW/srcH');
  // mask values match src alpha exactly
  let matches = 0;
  for (let i = 0; i < r.mask.length; i++) {
    if (r.mask[i] === src.data[i * 4 + 3]) matches++;
  }
  assert(matches === r.mask.length, '1:1 mask matches alpha exactly');
}

// 2. Square 4K source downsamples to 256.
{
  const src = makeRect(4096, 4096, { x0: 1024, y0: 1024, x1: 3072, y1: 3072 });
  const r = downsampleAlphaMask(src);
  assert(r.w === 256 && r.h === 256, '4K square → 256×256');
  assert(r.srcW === 4096 && r.srcH === 4096, '4K srcW/srcH preserved');
  // Cell at center of source rect — should be opaque.
  assert(sampleAlphaMask(r, 2048, 2048) === 255, '4K center sample opaque');
  // Cell at corner outside the rect — should be transparent.
  assert(sampleAlphaMask(r, 100, 100) === 0, '4K corner sample transparent');
}

// 3. Non-square source preserves aspect.
{
  const src = makeRect(2048, 1024, { x0: 0, y0: 0, x1: 2048, y1: 1024 });
  const r = downsampleAlphaMask(src);
  assert(r.w === 256, 'landscape: longer dim → 256');
  assert(r.h === 128, 'landscape: aspect preserved (2:1 → 256:128)');

  const src2 = makeRect(1024, 2048, { x0: 0, y0: 0, x1: 1024, y1: 2048 });
  const r2 = downsampleAlphaMask(src2);
  assert(r2.h === 256, 'portrait: longer dim → 256');
  assert(r2.w === 128, 'portrait: aspect preserved (1:2 → 128:256)');
}

// 4. Sample correctness on rectangle mask.
{
  const src = makeRect(2048, 2048, { x0: 500, y0: 500, x1: 1500, y1: 1500 });
  const r = downsampleAlphaMask(src);
  // Sample 1000 random points; ≥ 95% should classify same as full-res.
  let agreeCount = 0;
  let totalCount = 0;
  for (let s = 0; s < 1000; s++) {
    const x = Math.floor(Math.random() * 2048);
    const y = Math.floor(Math.random() * 2048);
    const fullAlpha = src.data[(y * 2048 + x) * 4 + 3];
    const maskAlpha = sampleAlphaMask(r, x, y);
    const fullHit = fullAlpha > 0;
    const maskHit = maskAlpha > 0;
    if (fullHit === maskHit) agreeCount++;
    totalCount++;
  }
  const agreement = agreeCount / totalCount;
  assert(agreement >= 0.95, `sample agreement ${(agreement * 100).toFixed(1)}% ≥ 95%`);
}

// 5. Out-of-canvas → 0.
{
  const src = makeRect(100, 100, { x0: 0, y0: 0, x1: 100, y1: 100 });
  const r = downsampleAlphaMask(src);
  assert(sampleAlphaMask(r, -1, 50) === 0, 'negative x → 0');
  assert(sampleAlphaMask(r, 50, -1) === 0, 'negative y → 0');
  assert(sampleAlphaMask(r, 200, 50) === 0, 'x ≥ srcW → 0');
  assert(sampleAlphaMask(r, 50, 200) === 0, 'y ≥ srcH → 0');
}

// 6. Edge cases.
{
  const empty = downsampleAlphaMask({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
  assert(empty.w === 0 && empty.h === 0, 'empty source → zero record');
  assert(sampleAlphaMask(empty, 0, 0) === 0, 'empty record sample → 0');
  assert(sampleAlphaMask(/** @type {any} */ (null), 0, 0) === 0, 'null record sample → 0');
}

// 7. Memory sanity — 1024² source → 256² × 1 byte mask = 64 KB.
{
  const src = makeRect(1024, 1024, { x0: 0, y0: 0, x1: 1024, y1: 1024 });
  const r = downsampleAlphaMask(src);
  const expectedBytes = 256 * 256;
  assert(r.mask.byteLength === expectedBytes, `1024² → 64KB mask (got ${r.mask.byteLength})`);
  // Compare against the full-resolution storage we replaced.
  const fullResBytes = 1024 * 1024 * 4; // RGBA
  const ratio = fullResBytes / expectedBytes;
  assert(ratio === 64, `64× memory reduction (got ${ratio}×)`);
}

console.log(`alphaMask: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
