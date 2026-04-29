// v3 Phase 0F.40 - structural tests for src/lib/themePresets.js
//
// Theme presets are pure data, but the schema (each entry has
// id / name / colors with the standard CSS-variable keys) needs
// locking in. A typo or missing key causes silent UI failures
// (white text on white background style of bug). The light/dark
// preset arrays are also indexed by the theme picker UI.
//
// Run: node scripts/test/test_themePresets.mjs

import {
  lightThemePresets,
  darkThemePresets,
  defaultLightPreset,
  defaultDarkPreset,
  amethystHazeLightPreset,
  amethystHazeDarkPreset,
} from '../../src/lib/themePresets.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Required CSS variable keys every preset must define. Drift in this
// list means UI components reading `--unknown-var` get nothing and
// fall through to browser default (often white-on-white invisible).
const REQUIRED_KEYS = [
  'background', 'foreground',
  'card', 'card-foreground',
  'popover', 'popover-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'destructive', 'destructive-foreground',
  'border', 'input', 'ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
];

// Registry slot for accepted missing keys. Empty today — the
// discord-light:secondary gap that originally lived here was
// filled by adding the missing color directly. Future test runs
// surface fresh gaps; add `<presetId>:<key>` entries here if a
// fix isn't immediate.
/** @type {Set<string>} */
const KNOWN_GAPS = new Set();

function validatePreset(preset, label) {
  if (typeof preset.id !== 'string' || preset.id.length === 0) {
    failed++; console.error(`FAIL: ${label} missing id`); return;
  }
  if (typeof preset.name !== 'string' || preset.name.length === 0) {
    failed++; console.error(`FAIL: ${label} missing name`); return;
  }
  if (!preset.colors || typeof preset.colors !== 'object') {
    failed++; console.error(`FAIL: ${label} missing colors`); return;
  }
  for (const key of REQUIRED_KEYS) {
    if (typeof preset.colors[key] !== 'string') {
      if (KNOWN_GAPS.has(`${preset.id}:${key}`)) continue;
      failed++;
      console.error(`FAIL: ${label} missing colors["${key}"]`);
      return;
    }
  }
  passed++;
}

// ── Top-level arrays ─────────────────────────────────────────────

assert(Array.isArray(lightThemePresets), 'lightThemePresets is array');
assert(Array.isArray(darkThemePresets), 'darkThemePresets is array');
assert(lightThemePresets.length >= 5, 'lightThemePresets has ≥5 entries');
assert(darkThemePresets.length >= 5, 'darkThemePresets has ≥5 entries');
assert(lightThemePresets.length === darkThemePresets.length,
  'light and dark have matching counts');

// ── Default presets exist and are valid presets ─────────────────

assert(defaultLightPreset != null, 'defaultLightPreset defined');
assert(defaultDarkPreset != null, 'defaultDarkPreset defined');
validatePreset(defaultLightPreset, 'defaultLightPreset');
validatePreset(defaultDarkPreset, 'defaultDarkPreset');

// ── Each preset has full schema ─────────────────────────────────

for (const p of lightThemePresets) validatePreset(p, `light preset ${p.id}`);
for (const p of darkThemePresets) validatePreset(p, `dark preset ${p.id}`);

// ── IDs are unique within each variant ───────────────────────────

{
  const lightIds = new Set();
  let dup = false;
  for (const p of lightThemePresets) {
    if (lightIds.has(p.id)) { dup = true; break; }
    lightIds.add(p.id);
  }
  assert(!dup, 'light preset ids unique');

  const darkIds = new Set();
  dup = false;
  for (const p of darkThemePresets) {
    if (darkIds.has(p.id)) { dup = true; break; }
    darkIds.add(p.id);
  }
  assert(!dup, 'dark preset ids unique');
}

// ── ID convention: -light suffix on light, -dark on dark ────────

for (const p of lightThemePresets) {
  if (!p.id.endsWith('-light')) {
    failed++;
    console.error(`FAIL: light preset ${p.id} missing -light suffix`);
    break;
  }
}
passed++;

for (const p of darkThemePresets) {
  if (!p.id.endsWith('-dark')) {
    failed++;
    console.error(`FAIL: dark preset ${p.id} missing -dark suffix`);
    break;
  }
}
passed++;

// ── Each light preset has a matching dark sibling by name ────────
//
// Convention: ids share a base, just differ by suffix
//   amethyst_haze-light ↔ amethyst_haze-dark

{
  const baseFromLight = (p) => p.id.replace(/-light$/, '');
  const baseFromDark = (p) => p.id.replace(/-dark$/, '');
  const lightBases = new Set(lightThemePresets.map(baseFromLight));
  const darkBases = new Set(darkThemePresets.map(baseFromDark));

  let mismatch = null;
  for (const b of lightBases) {
    if (!darkBases.has(b)) { mismatch = `light "${b}" has no dark sibling`; break; }
  }
  if (!mismatch) for (const b of darkBases) {
    if (!lightBases.has(b)) { mismatch = `dark "${b}" has no light sibling`; break; }
  }
  assert(mismatch === null, mismatch ?? 'every preset has a light/dark pair');
}

// ── Specific named presets exist ────────────────────────────────

assert(amethystHazeLightPreset.id === 'amethyst_haze-light',
  'amethystHazeLightPreset shape');
assert(amethystHazeDarkPreset.id === 'amethyst_haze-dark',
  'amethystHazeDarkPreset shape');

// ── HSL value strings: every color is a "<H> <S>% <L>%" tuple ───
//
// (Also accepts "<H>" without unit and percent values - structural
// shape only, no validation of value ranges.)

{
  const HSL_PATTERN = /^[\d.\-]+\s+[\d.]+%?\s+[\d.]+%?$/;
  let badEntry = null;
  for (const p of lightThemePresets.concat(darkThemePresets)) {
    for (const [key, val] of Object.entries(p.colors)) {
      if (!HSL_PATTERN.test(val)) {
        badEntry = `${p.id}.${key} = "${val}"`;
        break;
      }
    }
    if (badEntry) break;
  }
  assert(badEntry === null,
    badEntry ? `bad HSL: ${badEntry}` : 'all colors look like HSL tuples');
}

console.log(`themePresets: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
