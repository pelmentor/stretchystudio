// v3 Phase 0F.34 - tests for the pure helpers in src/io/exportAnimation.js
//
// computeExportFrameSpecs / computeAnalyticalBounds / resolveAnimations
// are pure planners for the animation export pipeline. exportFrames
// itself uses DOM (document.createElement, JSZip) and is skipped here.
//
// Run: node scripts/test/test_exportAnimation.mjs

import {
  computeExportFrameSpecs,
  computeAnalyticalBounds,
  resolveAnimations,
} from '../../src/io/exportAnimation.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// ── computeExportFrameSpecs: single_frame ────────────────────────

{
  const specs = computeExportFrameSpecs({
    type: 'single_frame',
    animsToExport: [{ id: 'a1', name: 'Wave', duration: 2000 }],
    exportFps: 30,
    frameIndex: 15,
  });
  assert(specs.length === 1, 'single_frame: 1 spec per anim');
  assert(specs[0].animId === 'a1', 'single_frame: animId');
  assert(specs[0].frameIndex === 15, 'single_frame: frameIndex preserved');
  assert(near(specs[0].timeMs, 500), 'single_frame: timeMs = frame/fps * 1000');
}

{
  // Beyond duration — clamp to duration
  const specs = computeExportFrameSpecs({
    type: 'single_frame',
    animsToExport: [{ id: 'a1', name: 'Short', duration: 1000 }],
    exportFps: 30,
    frameIndex: 100,  // 3.33s, beyond the 1s duration
  });
  assert(specs[0].timeMs === 1000, 'single_frame: timeMs clamped to duration');
}

{
  // Multiple animations
  const specs = computeExportFrameSpecs({
    type: 'single_frame',
    animsToExport: [
      { id: 'a1', name: 'A', duration: 2000 },
      { id: 'a2', name: 'B', duration: 1000 },
    ],
    exportFps: 30,
    frameIndex: 5,
  });
  assert(specs.length === 2, 'single_frame: one per anim');
}

// ── computeExportFrameSpecs: sequence ────────────────────────────

{
  const specs = computeExportFrameSpecs({
    type: 'sequence',
    animsToExport: [{ id: 'a1', name: 'Loop', duration: 1000 }],
    exportFps: 24,
  });
  // 1000ms × 24fps = 24 frames
  assert(specs.length === 24, 'sequence: totalFrames = duration/1000 * fps');
  assert(specs[0].frameIndex === 0, 'sequence: starts at 0');
  assert(specs[0].timeMs === 0, 'sequence: first time = 0');
  assert(specs[23].frameIndex === 23, 'sequence: last frameIndex');
  // Frames are evenly spaced at 1/fps
  assert(near(specs[1].timeMs - specs[0].timeMs, 1000 / 24),
    'sequence: frame spacing = 1000/fps');
}

{
  // Default duration = 2000 when missing
  const specs = computeExportFrameSpecs({
    type: 'sequence',
    animsToExport: [{ id: 'a1', name: 'NoDuration' }],
    exportFps: 30,
  });
  // 2000ms × 30fps = 60 frames
  assert(specs.length === 60, 'sequence: missing duration → 2000ms default');
}

{
  // Multi-anim sequence
  const specs = computeExportFrameSpecs({
    type: 'sequence',
    animsToExport: [
      { id: 'a1', name: 'A', duration: 1000 },
      { id: 'a2', name: 'B', duration: 500 },
    ],
    exportFps: 24,
  });
  // 24 + 12 = 36 specs
  assert(specs.length === 36, 'sequence: multi-anim = sum of frames');
  // First 24 belong to a1
  for (let i = 0; i < 24; i++) {
    if (specs[i].animId !== 'a1') {
      failed++; console.error('FAIL: sequence multi-anim ordering'); break;
    }
  }
  passed++;
}

// ── computeExportFrameSpecs: empty / edge ────────────────────────

{
  const specs = computeExportFrameSpecs({
    type: 'sequence', animsToExport: [], exportFps: 30,
  });
  assert(specs.length === 0, 'empty animsToExport → 0 specs');
}

// ── computeAnalyticalBounds: empty / null project ────────────────

{
  assert(computeAnalyticalBounds(null) === null, 'bounds: null project → null');
  assert(computeAnalyticalBounds({}) === null, 'bounds: no nodes → null');
  assert(computeAnalyticalBounds({ nodes: [] }) === null, 'bounds: empty nodes → null');
  assert(computeAnalyticalBounds({ nodes: [{ type: 'group', id: 'g' }] }) === null,
    'bounds: only groups → null (no parts)');
}

// ── computeAnalyticalBounds: visible part ────────────────────────

{
  // Part at default transform (identity world matrix), 100x50 image
  const project = {
    nodes: [{
      id: 'p',
      type: 'part',
      visible: true,
      opacity: 1,
      parent: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      imageWidth: 100,
      imageHeight: 50,
    }],
  };
  const b = computeAnalyticalBounds(project);
  assert(b !== null, 'bounds: visible part → object');
  assert(b.x === 0 && b.y === 0, 'bounds: identity → top-left at origin');
  assert(b.width === 100 && b.height === 50, 'bounds: identity → image dims');
}

{
  // Translated part
  const project = {
    nodes: [{
      id: 'p',
      type: 'part',
      visible: true,
      opacity: 1,
      parent: null,
      transform: { x: 50, y: 30, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      imageWidth: 100,
      imageHeight: 50,
    }],
  };
  const b = computeAnalyticalBounds(project);
  assert(near(b.x, 50), 'bounds: translated x');
  assert(near(b.y, 30), 'bounds: translated y');
  assert(near(b.width, 100), 'bounds: translated dims preserved');
}

{
  // Invisible part skipped
  const project = {
    nodes: [
      {
        id: 'visible', type: 'part', visible: true, opacity: 1, parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        imageWidth: 50, imageHeight: 50,
      },
      {
        id: 'hidden', type: 'part', visible: false, opacity: 1, parent: null,
        transform: { x: 1000, y: 1000, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        imageWidth: 100, imageHeight: 100,
      },
    ],
  };
  const b = computeAnalyticalBounds(project);
  // Should ONLY include the visible part (50×50 at origin)
  assert(b.width === 50 && b.height === 50, 'bounds: invisible parts skipped');
}

{
  // Zero-sized image skipped
  const project = {
    nodes: [
      {
        id: 'sized', type: 'part', visible: true, opacity: 1, parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        imageWidth: 60, imageHeight: 40,
      },
      {
        id: 'zero', type: 'part', visible: true, opacity: 1, parent: null,
        transform: { x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        imageWidth: 0, imageHeight: 0,
      },
    ],
  };
  const b = computeAnalyticalBounds(project);
  assert(b.width === 60 && b.height === 40, 'bounds: zero-dim parts skipped');
}

// ── resolveAnimations ────────────────────────────────────────────

{
  const anims = [
    { id: 'a1', name: 'A' },
    { id: 'a2', name: 'B' },
  ];

  // 'staging' → synthesised single entry
  const stage = resolveAnimations(anims, 'staging', null);
  assert(stage.length === 1 && stage[0].id === 'staging', 'resolve: staging → synth entry');

  // 'current' → activeId match, fallback to anims[0]
  const cur1 = resolveAnimations(anims, 'current', 'a2');
  assert(cur1[0].id === 'a2', 'resolve: current → match by activeId');
  const cur2 = resolveAnimations(anims, 'current', null);
  assert(cur2[0].id === 'a1', 'resolve: current with null activeId → anims[0]');
  const cur3 = resolveAnimations(anims, 'current', 'a-missing');
  assert(cur3[0].id === 'a1', 'resolve: current with missing activeId → anims[0]');
  const cur4 = resolveAnimations([], 'current', 'a1');
  assert(cur4.length === 0, 'resolve: current with empty anims → []');

  // 'all'
  const all = resolveAnimations(anims, 'all');
  assert(all.length === 2, 'resolve: all → all anims');

  // Specific id
  const spec = resolveAnimations(anims, 'a1', null);
  assert(spec.length === 1 && spec[0].id === 'a1', 'resolve: specific id');

  // Missing specific id → []
  const missing = resolveAnimations(anims, 'a-missing', null);
  assert(missing.length === 0, 'resolve: missing specific → []');
}

console.log(`exportAnimation: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
