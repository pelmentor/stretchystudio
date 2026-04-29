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
  // Workspace switches - Ctrl+1..5 (not just digits, so keymap doesn't
  // collide with future editor ops bound to bare digits).
  'Ctrl+Digit1': 'workspace.set.layout',
  'Ctrl+Digit2': 'workspace.set.modeling',
  'Ctrl+Digit3': 'workspace.set.rigging',
  'Ctrl+Digit4': 'workspace.set.pose',
  'Ctrl+Digit5': 'workspace.set.animation',

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

  // Selection: drop everything. Bare Esc — same as Blender.
  'Escape': 'selection.clear',
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
