// Animation Phase 5 Slice 5.AA — tests for src/anim/keymapPresets.js
//
// Coverage:
//   - coerceKeymapPreset: handles 'default' / 'industry_compatible' /
//     unknown strings / null / undefined / non-string types
//   - resolveSelectAllAction:
//     - default preset: A → toggle, Alt+A → clear, Ctrl+I → invert
//     - default preset: rejects modifier permutations (Ctrl+A, Shift+A, etc.)
//     - industry_compatible preset: Ctrl+A → add, Ctrl+Shift+A → clear,
//       Ctrl+I → invert
//     - industry_compatible preset: A (no modifiers) returns null (no toggle)
//     - macOS Cmd treated as Ctrl-equivalent (metaKey works)
//     - preset coercion: unknown preset falls back to default
//     - null/missing event returns null
//   - Constants: KEYMAP_PRESETS list + KEYMAP_PRESET_DEFAULT
//
// Run: node scripts/test/test_keymapPresets.mjs

import {
  KEYMAP_PRESETS,
  KEYMAP_PRESET_DEFAULT,
  coerceKeymapPreset,
  resolveSelectAllAction,
} from '../../src/anim/keymapPresets.js';

let passed = 0;
let failed = 0;

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function ev(code, modifiers = {}) {
  return {
    code,
    ctrlKey: !!modifiers.ctrl,
    metaKey: !!modifiers.meta,
    altKey: !!modifiers.alt,
    shiftKey: !!modifiers.shift,
  };
}

// ── Constants ────────────────────────────────────────────────────
{
  eq(KEYMAP_PRESETS.length, 2, 'KEYMAP_PRESETS has 2 entries');
  eq(KEYMAP_PRESETS.includes('default'), true, 'KEYMAP_PRESETS includes default');
  eq(KEYMAP_PRESETS.includes('industry_compatible'), true, 'KEYMAP_PRESETS includes industry_compatible');
  eq(KEYMAP_PRESET_DEFAULT, 'default', 'KEYMAP_PRESET_DEFAULT is default');
}

// ── coerceKeymapPreset ───────────────────────────────────────────
{
  eq(coerceKeymapPreset('default'), 'default', 'coerce: default → default');
  eq(coerceKeymapPreset('industry_compatible'), 'industry_compatible', 'coerce: IC → IC');
  eq(coerceKeymapPreset('bogus'), 'default', 'coerce: unknown → default');
  eq(coerceKeymapPreset(null), 'default', 'coerce: null → default');
  eq(coerceKeymapPreset(undefined), 'default', 'coerce: undefined → default');
  eq(coerceKeymapPreset(42), 'default', 'coerce: number → default');
  eq(coerceKeymapPreset({}), 'default', 'coerce: object → default');
}

// ── resolveSelectAllAction: default preset ───────────────────────
{
  eq(resolveSelectAllAction('default', ev('KeyA')), 'toggle', 'default: A → toggle');
  eq(resolveSelectAllAction('default', ev('KeyA', { alt: true })), 'clear', 'default: Alt+A → clear');
  eq(resolveSelectAllAction('default', ev('KeyI', { ctrl: true })), 'invert', 'default: Ctrl+I → invert');
  eq(resolveSelectAllAction('default', ev('KeyI', { meta: true })), 'invert', 'default: Cmd+I (macOS) → invert');
}

// ── default preset rejects industry-compatible bindings ─────────
{
  eq(resolveSelectAllAction('default', ev('KeyA', { ctrl: true })), null, 'default: Ctrl+A → null (IC binding)');
  eq(resolveSelectAllAction('default', ev('KeyA', { ctrl: true, shift: true })), null, 'default: Ctrl+Shift+A → null');
  eq(resolveSelectAllAction('default', ev('KeyA', { shift: true })), null, 'default: Shift+A → null');
  eq(resolveSelectAllAction('default', ev('KeyA', { alt: true, shift: true })), null, 'default: Alt+Shift+A → null (no binding)');
  eq(resolveSelectAllAction('default', ev('KeyA', { alt: true, ctrl: true })), null, 'default: Alt+Ctrl+A → null');
  eq(resolveSelectAllAction('default', ev('KeyI')), null, 'default: I (no modifiers) → null');
  eq(resolveSelectAllAction('default', ev('KeyI', { alt: true })), null, 'default: Alt+I → null');
  eq(resolveSelectAllAction('default', ev('KeyI', { ctrl: true, shift: true })), null, 'default: Ctrl+Shift+I → null');
}

// ── resolveSelectAllAction: industry_compatible preset ──────────
{
  eq(resolveSelectAllAction('industry_compatible', ev('KeyA', { ctrl: true })), 'add', 'IC: Ctrl+A → add');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyA', { meta: true })), 'add', 'IC: Cmd+A (macOS) → add');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyA', { ctrl: true, shift: true })), 'clear', 'IC: Ctrl+Shift+A → clear');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyA', { meta: true, shift: true })), 'clear', 'IC: Cmd+Shift+A (macOS) → clear');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyI', { ctrl: true })), 'invert', 'IC: Ctrl+I → invert');
}

// ── IC preset rejects default-only bindings ─────────────────────
{
  eq(resolveSelectAllAction('industry_compatible', ev('KeyA')), null, 'IC: A (no modifiers) → null (no toggle in IC)');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyA', { alt: true })), null, 'IC: Alt+A → null (default-only binding)');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyA', { ctrl: true, alt: true })), null, 'IC: Ctrl+Alt+A → null');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyI')), null, 'IC: I (no modifiers) → null');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyI', { alt: true })), null, 'IC: Alt+I → null');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyI', { ctrl: true, shift: true })), null, 'IC: Ctrl+Shift+I → null');
}

// ── preset coercion in resolver: unknown falls back to default ──
{
  eq(resolveSelectAllAction('bogus', ev('KeyA')), 'toggle', 'unknown preset coerced to default; A → toggle');
  eq(resolveSelectAllAction(null, ev('KeyA')), 'toggle', 'null preset coerced to default');
  eq(resolveSelectAllAction(undefined, ev('KeyA')), 'toggle', 'undefined preset coerced to default');
  eq(resolveSelectAllAction(42, ev('KeyA')), 'toggle', 'numeric preset coerced to default');
}

// ── resolver: null/missing event returns null ────────────────────
{
  eq(resolveSelectAllAction('default', null), null, 'null event → null');
  eq(resolveSelectAllAction('default', undefined), null, 'undefined event → null');
  eq(resolveSelectAllAction('default', 'not-an-object'), null, 'string event → null');
}

// ── resolver: other keys (B, C, …) return null in both presets ──
{
  eq(resolveSelectAllAction('default', ev('KeyB')), null, 'default: B → null');
  eq(resolveSelectAllAction('default', ev('KeyB', { ctrl: true })), null, 'default: Ctrl+B → null');
  eq(resolveSelectAllAction('industry_compatible', ev('KeyB', { ctrl: true })), null, 'IC: Ctrl+B → null');
}

// ── final report ───────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} keymapPresets assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
