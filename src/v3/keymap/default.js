// @ts-check

/**
 * v3 Phase 0A - Default key bindings.
 *
 * Maps `KeyboardEvent.code` chords to operator ids. We use `.code`
 * (physical key) rather than `.key` (layout-dependent character) so
 * bindings survive layout switches - Working Note #3 in the V3 plan.
 *
 * Format: `chord` → `operatorId`
 *   chord syntax: `[Mod+][Mod+]Code`
 *   modifiers in canonical order: `Ctrl Shift Alt Meta`
 *   examples: `KeyA`, `Ctrl+KeyZ`, `Ctrl+Shift+KeyZ`, `F5`
 *
 * Phase 0A only binds workspace shortcuts so we can verify the
 * dispatcher round-trip. Editor-specific bindings arrive with each
 * editor in Phase 1+.
 *
 * @module v3/keymap/default
 */

/** @type {Record<string, string>} */
export const DEFAULT_KEYMAP = {
  // Workspace switches - Ctrl+1..3 (collapsed from 5 to 3 workspaces
  // 2026-05-02; Layout / Modeling / Rigging merged into 'edit').
  'Ctrl+Digit1': 'workspace.set.edit',
  'Ctrl+Digit2': 'workspace.set.pose',
  'Ctrl+Digit3': 'workspace.set.animation',

  // Layout reset - uncommon enough that Ctrl+Shift+Backspace is fine.
  'Ctrl+Shift+Backspace': 'workspace.reset',

  // Undo / redo. Three chords because Ctrl+Y is muscle-memory for
  // Windows users and Ctrl+Shift+Z for everyone else; both fire the
  // same operator. Meta+ variants for macOS handled by the chord
  // builder reading metaKey alongside ctrlKey.
  'Ctrl+KeyZ': 'app.undo',
  'Meta+KeyZ': 'app.undo',
  'Ctrl+Shift+KeyZ': 'app.redo',
  'Meta+Shift+KeyZ': 'app.redo',
  'Ctrl+KeyY': 'app.redo',
  'Meta+KeyY': 'app.redo',

  // File save / load. Browser may pre-empt Ctrl+S as "save page" — the
  // dispatcher calls preventDefault before exec runs so we win.
  'Ctrl+KeyS': 'file.save',
  'Meta+KeyS': 'file.save',
  'Ctrl+KeyO': 'file.load',
  'Meta+KeyO': 'file.load',

  'Ctrl+KeyN': 'file.new',
  'Meta+KeyN': 'file.new',

  'Ctrl+KeyE': 'file.export',
  'Meta+KeyE': 'file.export',

  // Selection: drop everything. Bare Esc — same as Blender.
  'Escape': 'selection.clear',

  // Delete selected project nodes. Both Delete and Backspace are
  // common muscle memory; bind both. (Backspace alone fires inside
  // editable inputs anyway, but the dispatcher's editable-target
  // check guards that case.)
  'Delete':    'selection.delete',
  'Backspace': 'selection.delete',

  // Toggle visibility on selection. Bare H — Blender muscle memory.
  'KeyH': 'selection.toggleVisibility',

  // Frame-to-selected. Period (NumpadDecimal too) — Blender's "view
  // selected" / "frame the selection" gesture.
  'Period':         'view.frameSelected',
  'NumpadDecimal':  'view.frameSelected',

  // F3 — operator search palette. Blender's standard "what was that
  // operator called again" shortcut. cmdk dialog handles its own
  // input focus + Esc-to-close, so we don't need a second binding
  // for the close path.
  'F3': 'app.commandPalette',

  // F1 — quick reference modal. Browser leaves F1 alone outside
  // dev-tools-bound contexts, and the dispatcher preventDefault's
  // before any browser default fires.
  'F1': 'app.help',

  // Phase 2H — modal G/R/S transforms. Bare letter chords on
  // selection. The modal overlay captures mouse + key from there.
  'KeyG': 'transform.translate',
  'KeyR': 'transform.rotate',
  'KeyS': 'transform.scale',

  // Edit-mode refactor — Tab toggles into a contextual edit mode based
  // on the active selection's type (Blender pattern). Meshed part →
  // mesh edit. Bone-role group → skeleton edit. Already in edit mode
  // → exit. BlendShape edit is entered from BlendShapeTab where the
  // user picks which shape to paint.
  'Tab': 'mode.editToggle',
};

/**
 * Build the chord string for a `KeyboardEvent`. Modifiers go in
 * canonical order; the key is `event.code` (physical) so e.g. AZERTY
 * + QWERTY users get the same binding.
 *
 * @param {KeyboardEvent} e
 * @returns {string}
 */
export function chordOf(e) {
  let chord = '';
  if (e.ctrlKey)  chord += 'Ctrl+';
  if (e.shiftKey) chord += 'Shift+';
  if (e.altKey)   chord += 'Alt+';
  if (e.metaKey)  chord += 'Meta+';
  return chord + e.code;
}
