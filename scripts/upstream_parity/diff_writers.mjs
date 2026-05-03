#!/usr/bin/env node
// Upstream parity audit — runs both v3's and upstream's `generateCmo3`
// on the same input, decodes the resulting CAFF archives, masks
// non-deterministic UUIDs, and produces a structural diff of the
// resulting `main.xml` payloads.
//
// Goal: surface places where v3's writer drifted from
// `reference/stretchystudio-upstream-original/` during the v3
// refactor sweeps. Each diff is then categorised in Stage 1
// (intentional v3 change / refactor regression / cosmetic / order-only).
//
// Usage:
//   node scripts/upstream_parity/diff_writers.mjs [fixture]
//
// Default fixture: `minimal` — a one-mesh, no-rig project. Other
// fixtures can be added under `FIXTURES` below.
//
// Plan: docs/UPSTREAM_PARITY_AUDIT.md (Stage 0).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const importPath = (p) => import(pathToFileURL(p).href);

// ── Browser-API stubs for Node ──────────────────────────────────────
// Both writers indirectly touch Blob / URL via shared helpers (e.g.
// the texture pipeline, even when no real texture data is present).
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class StubBlob {
    constructor(parts, opts) { this.parts = parts; this.type = opts?.type ?? ''; }
  };
}
if (typeof globalThis.URL === 'undefined' || !globalThis.URL.createObjectURL) {
  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'stub://harness';
  globalThis.URL.revokeObjectURL = () => {};
}

// ── Repo paths ──────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const UPSTREAM_ROOT = path.join(REPO_ROOT, 'reference', 'stretchystudio-upstream-original');

// ── 1×1 red PNG (minimal valid texture) ─────────────────────────────
const MINIMAL_PNG = Uint8Array.from(Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
  '890000000d49444154789c63f8cf00000003000100b8b1f88a0000000049454e' +
  '44ae426082',
  'hex',
));

// ── Fixtures ────────────────────────────────────────────────────────
// Each fixture is a Cmo3Input both writers should accept. Start
// minimal; add more as the audit reveals drift hotspots.
function makeMesh(name, opts = {}) {
  const {
    partId = name.toLowerCase(),
    parentGroupId = null,
    minX = 100, minY = 100, maxX = 200, maxY = 200,
    tag = null,
  } = opts;
  return {
    name,
    partId,
    parentGroupId,
    tag,
    vertices: [minX, minY, maxX, minY, minX, maxY, maxX, maxY],
    triangles: [0, 1, 2, 1, 3, 2],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    pngData: MINIMAL_PNG,
    texWidth: 1,
    texHeight: 1,
  };
}

const FIXTURES = {
  // Fixture 1 — single mesh, no rig. Exercises: caff packer, xml builder,
  // texture pipeline, basic mesh emission. Drift here = a writer-core
  // refactor regression.
  minimal: () => ({
    canvasW: 1024,
    canvasH: 1024,
    modelName: 'parity-minimal',
    meshes: [makeMesh('ArtMesh0')],
    groups: [],
    parameters: [],
    generateRig: false,
  }),

  // Fixture 2 — two meshes in two groups, still no rig. Exercises the
  // groups → CPartSource emission and child-of-group mesh handling.
  two_groups: () => ({
    canvasW: 1024,
    canvasH: 1024,
    modelName: 'parity-two-groups',
    meshes: [
      makeMesh('ArtMesh0', { partId: 'p0', parentGroupId: 'g_face' }),
      makeMesh('ArtMesh1', {
        partId: 'p1', parentGroupId: 'g_body',
        minX: 300, minY: 300, maxX: 400, maxY: 400,
      }),
    ],
    groups: [
      { id: 'g_face', name: 'face', parent: null },
      { id: 'g_body', name: 'body', parent: null },
    ],
    parameters: [],
    generateRig: false,
  }),

  // Fixture 3 — generateRig=true with a face/body/topwear shape. Exercises
  // body warp chain, face union, FaceParallax (v3-only), per-part rig
  // warps, eye closure (none — no eye tag here), variant fade rules.
  // This is where intentional v3-only changes show up.
  with_rig: () => ({
    canvasW: 1024,
    canvasH: 1024,
    modelName: 'parity-with-rig',
    meshes: [
      makeMesh('Face',    { partId: 'face',    tag: 'face',    minX: 380, minY: 200, maxX: 620, maxY: 480 }),
      makeMesh('Body',    { partId: 'body',    tag: 'body',    minX: 350, minY: 480, maxX: 650, maxY: 800 }),
      makeMesh('Topwear', { partId: 'topwear', tag: 'topwear', minX: 360, minY: 460, maxX: 640, maxY: 700 }),
    ],
    groups: [],
    parameters: [],
    generateRig: true,
  }),

  // Fixture 4 — shelby-shape: full mesh set covering the standard Live2D
  // tag landscape (face, eyes, eyebrows, irides, hair front+back, ears,
  // neck, topwear, legwear, hands). The actual shelby reference at
  // shelby.cmo3 uses this layout. Exercises every code path that fires
  // when a "complete" character is exported.
  shelby_like: () => ({
    canvasW: 1792,
    canvasH: 1792,
    modelName: 'parity-shelby-like',
    meshes: [
      // Face region.
      makeMesh('face',       { partId: 'face',       tag: 'face',       minX: 660, minY: 480, maxX: 1130, maxY: 1000 }),
      makeMesh('back hair',  { partId: 'back-hair',  tag: 'back hair',  minX: 580, minY: 380, maxX: 1210, maxY: 1080 }),
      makeMesh('front hair', { partId: 'front-hair', tag: 'front hair', minX: 600, minY: 360, maxX: 1190, maxY: 980 }),
      makeMesh('ears-l',     { partId: 'ears-l',     tag: 'ears',       minX: 1090, minY: 600, maxX: 1180, maxY: 760 }),
      makeMesh('ears-r',     { partId: 'ears-r',     tag: 'ears',       minX: 610, minY: 600, maxX: 700, maxY: 760 }),
      makeMesh('eyebrow-l',  { partId: 'eyebrow-l', tag: 'eyebrow',     minX: 920, minY: 660, maxX: 1050, maxY: 720 }),
      makeMesh('eyebrow-r',  { partId: 'eyebrow-r', tag: 'eyebrow',     minX: 740, minY: 660, maxX: 870, maxY: 720 }),
      makeMesh('eyelash-l',  { partId: 'eyelash-l', tag: 'eyelash',     minX: 920, minY: 760, maxX: 1050, maxY: 820 }),
      makeMesh('eyelash-r',  { partId: 'eyelash-r', tag: 'eyelash',     minX: 740, minY: 760, maxX: 870, maxY: 820 }),
      makeMesh('eyewhite-l', { partId: 'eyewhite-l', tag: 'eyewhite',   minX: 920, minY: 780, maxX: 1050, maxY: 850 }),
      makeMesh('eyewhite-r', { partId: 'eyewhite-r', tag: 'eyewhite',   minX: 740, minY: 780, maxX: 870, maxY: 850 }),
      makeMesh('irides-l',   { partId: 'irides-l',   tag: 'irides',     minX: 950, minY: 790, maxX: 1020, maxY: 840 }),
      makeMesh('irides-r',   { partId: 'irides-r',   tag: 'irides',     minX: 770, minY: 790, maxX: 840, maxY: 840 }),
      // Body region.
      makeMesh('neck',       { partId: 'neck',     tag: 'neck',     minX: 800, minY: 1000, maxX: 990, maxY: 1100 }),
      makeMesh('topwear',    { partId: 'topwear',  tag: 'topwear',  minX: 600, minY: 1080, maxX: 1190, maxY: 1380 }),
      makeMesh('legwear',    { partId: 'legwear',  tag: 'legwear',  minX: 660, minY: 1380, maxX: 1130, maxY: 1700 }),
      makeMesh('handwear-l', { partId: 'handwear-l', tag: 'arm',    minX: 1190, minY: 1180, maxX: 1300, maxY: 1480 }),
      makeMesh('handwear-r', { partId: 'handwear-r', tag: 'arm',    minX: 490,  minY: 1180, maxX: 600,  maxY: 1480 }),
    ],
    groups: [],
    parameters: [],
    generateRig: true,
  }),
};

// ── Deterministic UUIDs ─────────────────────────────────────────────
// Both writers call `crypto.randomUUID()` from xmlbuilder.js. Patching
// with a counter gives both sides the SAME sequence — IF the order
// of uuid() calls matches. When it doesn't, the diff will surface
// the structural divergence directly (different elements get
// different "UUIDs" → easier to spot).
let uuidCounter = 0;
function patchCrypto() {
  uuidCounter = 0;
  const realRandomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (!globalThis.crypto) globalThis.crypto = {};
  globalThis.crypto.randomUUID = () => {
    const n = uuidCounter++;
    // Format as a UUID-like string so existing validation doesn't trip.
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
  return realRandomUUID;
}
function restoreCrypto(real) {
  if (real) globalThis.crypto.randomUUID = real;
}

// ── Run a writer in isolation ───────────────────────────────────────
async function runWriter(generateCmo3, input, label) {
  const real = patchCrypto();
  try {
    const result = await generateCmo3(input);
    if (!result?.cmo3) throw new Error(`${label}: writer returned no cmo3 bytes`);
    return { cmo3: result.cmo3, uuidCalls: uuidCounter };
  } finally {
    restoreCrypto(real);
  }
}

// ── CAFF unpacker (decode .cmo3 → main.xml + textures) ──────────────
async function extractMainXml(cmo3Bytes, unpackCaff) {
  const archive = await unpackCaff(cmo3Bytes);
  const xmlEntry = archive.files?.find?.(f => /main\.xml$/i.test(f.path));
  if (!xmlEntry) {
    const names = (archive.files ?? []).map(f => f.path).join(', ');
    throw new Error(`No main.xml in archive (files: ${names || '<empty>'})`);
  }
  // unpacker returns { content: Uint8Array }; convert to UTF-8.
  const data = xmlEntry.content;
  if (typeof data === 'string') return data;
  return new TextDecoder('utf-8').decode(data);
}

// ── Mask non-deterministic content for fair diff ────────────────────
// Cubism's XML uses a `<shared>` index table where every reusable
// node has `xs.id="#N" xs.idx="N"` and consumers reference via
// `xs.ref="#N"`. Both writers can emit the same set of nodes in
// different ORDER → identical-semantically but different-numerically.
// Normalising the `#N` token to `#<note-or-tag>` collapses this.
//
// Strategy:
//   1. Walk shared declarations in document order. For each
//      `xs.id="#N"`, derive a stable label from `note=...` (preferred)
//      or the tag name + occurrence index. Build N → label map.
//   2. Replace every `xs.id`, `xs.idx`, `xs.ref` occurrence using
//      the map.
function buildIdMap(xml) {
  const map = new Map();
  // Walk every '<TagName ...attrs...' opening; match attrs that contain
  // `xs.id="#N"`. Preserves document order so labels stay stable.
  const re = /<([A-Za-z_][\w]*)\s([^>]*?)>/g;
  const tagSeen = new Map();
  const usedLabels = new Set();
  let m;
  while ((m = re.exec(xml)) !== null) {
    const [, tagName, attrs] = m;
    const idMatch = /\bxs\.id="#(\d+)"/.exec(attrs);
    if (!idMatch) continue;
    const id = idMatch[1];
    let label;
    const noteMatch = /\bnote="([^"]+)"/.exec(attrs);
    if (noteMatch) {
      label = `${tagName}:${noteMatch[1]}`;
    } else {
      const k = tagSeen.get(tagName) ?? 0;
      tagSeen.set(tagName, k + 1);
      label = `${tagName}#${k}`;
    }
    // De-duplicate.
    if (usedLabels.has(label)) {
      let i = 2;
      while (usedLabels.has(`${label}~${i}`)) i++;
      label = `${label}~${i}`;
    }
    usedLabels.add(label);
    map.set(id, label);
  }
  return map;
}

function maskXml(xml) {
  // 1. UUIDs (use bracketless placeholder so it doesn't confuse downstream regexes).
  let out = xml.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '__UUID__');
  // 2. xs.id / xs.ref renumbering.
  const idMap = buildIdMap(out);
  out = out.replace(/(xs\.(?:id|ref))="#(\d+)"/g, (full, attr, n) => {
    const lbl = idMap.get(n);
    return lbl ? `${attr}="${lbl}"` : full;
  });
  out = out.replace(/(xs\.idx)="(\d+)"/g, (full, attr, n) => {
    const lbl = idMap.get(n);
    return lbl ? `${attr}="${lbl}"` : full;
  });
  // 3. Trim trailing whitespace per line.
  return out.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).join('\n');
}

// Insert a newline between every adjacent element so each tag-open / tag-
// close lands on its own line. Makes line-diffs meaningful for the kind
// of single-line XML the cmo3 writer emits. Preserves text content
// (including whitespace inside <s>...</s> nodes).
function prettyPrintXml(xml) {
  // Step 1: split between adjacent tags '><'.
  let s = xml.replace(/>(<)/g, '>\n$1');
  // Step 2: indent based on a running depth counter. Self-closing and
  // text-only nodes don't change depth.
  const lines = s.split('\n');
  let depth = 0;
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isClose = /^<\//.test(line);
    const isSelfClose = /\/>\s*$/.test(line);
    const isOpenClose = /^<[^!?][^>]*>[^<]+<\/[^>]+>$/.test(line); // <tag>text</tag>
    const isPI = /^<\?/.test(line);
    if (isClose) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + line);
    if (!isClose && !isSelfClose && !isOpenClose && !isPI) depth++;
  }
  return out.join('\n');
}

// ── Simple unified diff (line-by-line; good enough for first pass) ──
function unifiedDiff(a, b, labelA = 'a', labelB = 'b', context = 3) {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const out = [];
  // Naive LCS-free diff: walk both arrays, log any line where they differ.
  // Good enough for a first cut — refine to a real LCS-based diff if needed.
  const maxLen = Math.max(linesA.length, linesB.length);
  let i = 0;
  let runStart = -1;
  const flush = () => {
    if (runStart < 0) return;
    const start = Math.max(0, runStart - context);
    const end = Math.min(maxLen, i + context);
    out.push(`@@ lines ${start + 1}-${end} @@`);
    for (let k = start; k < end; k++) {
      const la = linesA[k] ?? '';
      const lb = linesB[k] ?? '';
      if (la === lb) {
        out.push(` ${la}`);
      } else {
        if (k < linesA.length) out.push(`-${la}`);
        if (k < linesB.length) out.push(`+${lb}`);
      }
    }
    out.push('');
    runStart = -1;
  };
  for (i = 0; i < maxLen; i++) {
    const la = linesA[i] ?? '';
    const lb = linesB[i] ?? '';
    if (la !== lb) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0 && i - runStart > 2 * context) {
      flush();
    }
  }
  flush();
  if (out.length === 0) return null;
  return `--- ${labelA}\n+++ ${labelB}\n${out.join('\n')}`;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const fixtureName = process.argv[2] ?? 'minimal';
  const fixtureFn = FIXTURES[fixtureName];
  if (!fixtureFn) {
    console.error(`[error] unknown fixture '${fixtureName}'. Available: ${Object.keys(FIXTURES).join(', ')}`);
    process.exit(1);
  }

  console.log(`[upstream-parity] fixture: ${fixtureName}`);
  console.log(`[upstream-parity] upstream path: ${path.relative(REPO_ROOT, UPSTREAM_ROOT)}`);

  // Load v3's writer + unpacker.
  console.log('[upstream-parity] loading v3 writer...');
  const v3Writer = await importPath(path.join(REPO_ROOT, 'src/io/live2d/cmo3writer.js'));
  const v3Unpacker = await importPath(path.join(REPO_ROOT, 'src/io/live2d/caffUnpacker.js'));

  // Load upstream's writer.
  console.log('[upstream-parity] loading upstream writer...');
  const upstreamWriter = await importPath(path.join(UPSTREAM_ROOT, 'src/io/live2d/cmo3writer.js'));

  // Build inputs (one per side; some writers may mutate input).
  const inputV3 = fixtureFn();
  const inputUpstream = fixtureFn();

  // Run both writers.
  console.log('[upstream-parity] running v3.generateCmo3...');
  const v3 = await runWriter(v3Writer.generateCmo3, inputV3, 'v3');
  console.log(`[upstream-parity] v3 cmo3 size: ${v3.cmo3.length} bytes (uuid calls: ${v3.uuidCalls})`);

  console.log('[upstream-parity] running upstream.generateCmo3...');
  const upstream = await runWriter(upstreamWriter.generateCmo3, inputUpstream, 'upstream');
  console.log(`[upstream-parity] upstream cmo3 size: ${upstream.cmo3.length} bytes (uuid calls: ${upstream.uuidCalls})`);

  // Extract main.xml from each.
  const xmlV3 = await extractMainXml(v3.cmo3, v3Unpacker.unpackCaff);
  const xmlUpstream = await extractMainXml(upstream.cmo3, v3Unpacker.unpackCaff);

  // Mask + pretty-print + diff.
  const maskedV3 = prettyPrintXml(maskXml(xmlV3));
  const maskedUpstream = prettyPrintXml(maskXml(xmlUpstream));

  // Persist masked outputs for offline inspection.
  const outDir = path.join(REPO_ROOT, 'scripts/upstream_parity/_out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${fixtureName}_v3.xml`), maskedV3);
  fs.writeFileSync(path.join(outDir, `${fixtureName}_upstream.xml`), maskedUpstream);
  console.log(`[upstream-parity] masked outputs written under ${path.relative(REPO_ROOT, outDir)}/`);

  if (maskedV3 === maskedUpstream) {
    console.log('\n✅ writer outputs are byte-identical after UUID masking.');
    return;
  }

  const diff = unifiedDiff(maskedUpstream, maskedV3, 'upstream', 'v3');
  console.log('\n⚠ writer outputs differ. Unified diff (upstream → v3):\n');
  console.log(diff ?? '(no diff)');
  console.log(`\nTotal lines: upstream=${maskedUpstream.split('\n').length}, v3=${maskedV3.split('\n').length}`);
}

main().catch((e) => {
  console.error('[upstream-parity] FAILED:', e);
  process.exit(1);
});
