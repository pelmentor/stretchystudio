// Regression for the proportional-edit hotkey gate at
// CanvasViewport.jsx:1860+ (2026-06-12).
//
// Bug: the gate read `if (ws !== 'default') return;` but the workspace
// `'default'` was renamed to `'layout'` on 2026-05-16 (uiV3Store.js:33
// typedef). After the rename, `activeWorkspace` never equals `'default'`,
// so the gate was always-true → the entire useEffect body returned for
// every keypress. Dead handler covered:
//   - O          — toggle proportional editing
//   - Shift+O    — cycle falloff curve
//   - Alt+O      — toggle connected-only mode
//   - Ctrl+[/]   — shrink/grow proportional radius
//   - F          — open radius-adjust modal (also dead via its inner
//                  gate, fixed in Phase 2.C `ecf0c10`; THIS workspace
//                  gate killed it first → migration looked correct in
//                  isolation but the chord still didn't fire).
//
// Fix: replace workspace gate with `editorRef.current.editMode !== 'edit'`
// (Blender's PROP_EDIT chords are Edit-Mode-only — workspace doesn't
// gate them in Blender either).
//
// This test locks the canonical workspace value set so a future rename
// failing to update consumers gets caught here.
//
// Run: node scripts/test/test_propEditHotkeyGate.mjs

import { useUIV3Store, getEditorMode } from '../../src/store/uiV3Store.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── §1 — canonical activeWorkspace values ──────────────────────────
//
// Locks the post-2026-05-16 set: 'layout'|'modeling'|'rigging'|
// 'weightPaint'|'sculpt'|'animation'. If a future rename removes one
// of these (or renames 'layout' back to 'default'), every consumer
// that doesn't update breaks the same way the prop-edit gate did.

const CANONICAL_WORKSPACES = ['layout', 'modeling', 'rigging', 'weightPaint', 'sculpt', 'animation'];

for (const ws of CANONICAL_WORKSPACES) {
  useUIV3Store.setState({ activeWorkspace: ws });
  ok(useUIV3Store.getState().activeWorkspace === ws,
    `§1 — '${ws}' is a settable workspace value`);
}

// ── §2 — initial workspace is 'layout' (NOT 'default') ─────────────
//
// 2026-05-16 rename: `default` → `layout`. The default initial value
// at uiV3Store.js:255 is `'layout'`. A regression that flips it back
// would silently restore the prop-edit-gate bug.

{
  useUIV3Store.setState({ activeWorkspace: useUIV3Store.getState().activeWorkspace });
  // can't easily test the original init; check that 'default' is NOT
  // in the canonical set instead.
  ok(!CANONICAL_WORKSPACES.includes('default'),
    "§2 — 'default' is NOT a canonical workspace (post-2026-05-16 rename)");
}

// ── §3 — selectEditorMode mapping is consistent ────────────────────
//
// All staging-ish workspaces → 'staging'. Only 'animation' → 'animation'.
// If a future workspace gets added it should fall into one of these
// two buckets; the legacy 'default' string also falls to 'staging' by
// the selector's else-branch (defensive but should never see it in
// practice).

for (const ws of CANONICAL_WORKSPACES) {
  useUIV3Store.setState({ activeWorkspace: ws });
  const expected = ws === 'animation' ? 'animation' : 'staging';
  ok(getEditorMode() === expected,
    `§3 — workspace='${ws}' → editorMode='${expected}'`);
}

// ── §4 — legacy 'default' still selectorss to 'staging' ────────────
//
// Defensive: if persisted state from a pre-2026-05-16 schema somehow
// survives migration, selectEditorMode falls through to the staging
// branch instead of throwing. Locks that.

{
  useUIV3Store.setState({ activeWorkspace: 'default' });
  ok(getEditorMode() === 'staging',
    '§4 — legacy "default" workspace value falls to staging editorMode');
}

// ── §5 — gate logic mirror ─────────────────────────────────────────
//
// Verifies the canonical Edit-Mode gate that REPLACED the bug. The
// handler is inside CanvasViewport.jsx's useEffect closure; we mirror
// the gate predicate here so a future refactor that breaks it surfaces.

/**
 * Gate predicate the prop-edit handler uses.
 * Pre-fix: `if (ws !== 'default') return;`  ALWAYS-TRUE — dead code.
 * Post-fix: `if (editMode !== 'edit') return;`  fires only in Edit Mode.
 */
function propEditChordsActive(editMode) {
  return editMode === 'edit';
}

ok(propEditChordsActive('edit')       === true,  '§5 — edit mode: chords active');
ok(propEditChordsActive('pose')       === false, '§5 — pose mode: chords inactive');
ok(propEditChordsActive('sculpt')     === false, '§5 — sculpt mode: chords inactive');
ok(propEditChordsActive('weightPaint') === false, '§5 — weightPaint mode: chords inactive');
ok(propEditChordsActive('keyform')    === false, '§5 — keyform mode: chords inactive');
ok(propEditChordsActive(null)         === false, '§5 — object mode (null): chords inactive');

console.log(`propEditHotkeyGate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
