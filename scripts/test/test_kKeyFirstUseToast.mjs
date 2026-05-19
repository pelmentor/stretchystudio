// scripts/test/test_kKeyFirstUseToast.mjs — Phase 7 Slice 7.E.
//
// Verifies:
//   §1 preferencesStore.kKeyFirstUseShown — default false, setter writes
//      through localStorage, re-init loads persisted value
//   §2 runAutoKey('all') tags synthetic K event with __ssAutoKey sentinel
//      (so CanvasViewport K-key handler can distinguish manual vs auto)
//   §3 sentinel non-enumerable (Object.keys doesn't include it but
//      direct property access still works)

import { runAutoKey } from '../../src/anim/autoKeyDispatch.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; } else { fail += 1; console.error(`FAIL: ${msg}`); }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.error(`expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
  ok(same, msg);
}

// In-memory localStorage stub for node — preferencesStore reads at
// module-load time via `loadBool`, so the stub MUST be installed before
// the dynamic import below.
const storage = new Map();
globalThis.localStorage = {
  getItem(k) { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
  clear() { storage.clear(); },
  key(i) { return Array.from(storage.keys())[i] ?? null; },
  get length() { return storage.size; },
};

// KeyboardEvent + window stubs for §2/§3 (Node 20+ has KeyboardEvent;
// guard for older / non-DOM contexts).
if (typeof globalThis.KeyboardEvent === 'undefined') {
  globalThis.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.key = init.key;
      this.code = init.code;
    }
  };
}
const dispatched = [];
globalThis.window = globalThis.window ?? {};
globalThis.window.dispatchEvent = (ev) => {
  dispatched.push(ev);
  return true;
};
function resetDispatched() { dispatched.length = 0; }

// ── §1 preferencesStore.kKeyFirstUseShown roundtrip ──────────────────
console.log('\n§1 preferencesStore.kKeyFirstUseShown');
{
  // Default load (nothing in localStorage) → false
  const { usePreferencesStore } = await import('../../src/store/preferencesStore.js');
  eq(usePreferencesStore.getState().kKeyFirstUseShown, false, '§1.1 default false (no localStorage entry)');

  // Setter flips + persists
  usePreferencesStore.getState().setKKeyFirstUseShown(true);
  eq(usePreferencesStore.getState().kKeyFirstUseShown, true, '§1.2 setter updates state');
  eq(storage.get('v3.prefs.kKeyFirstUseShown'), 'true', '§1.2 setter writes localStorage');

  // Coercion: setter accepts truthy/falsy non-boolean
  usePreferencesStore.getState().setKKeyFirstUseShown(0);
  eq(usePreferencesStore.getState().kKeyFirstUseShown, false, '§1.3 0 coerces to false');
  eq(storage.get('v3.prefs.kKeyFirstUseShown'), 'false', '§1.3 false persists');

  usePreferencesStore.getState().setKKeyFirstUseShown('non-empty-string');
  eq(usePreferencesStore.getState().kKeyFirstUseShown, true, '§1.4 truthy string coerces to true');

  // Re-init test: re-importing the module (already cached) would NOT
  // re-run loadBool; verifying persistence requires inspecting the
  // localStorage write directly. The setter already did that in §1.2.
  // §1.5 confirms the localStorage shape is the same key prefix family
  // (`v3.prefs.*`) used by every sibling pref.
  ok(
    [...storage.keys()].every((k) => k.startsWith('v3.prefs.')),
    '§1.5 K-pref shares the v3.prefs.* localStorage namespace',
  );
}

// ── §2 runAutoKey('all') tags synthetic K with __ssAutoKey ──────────
console.log('\n§2 runAutoKey all-mode synthetic K sentinel');
{
  resetDispatched();
  runAutoKey({ autoKeyMode: 'all' });
  eq(dispatched.length, 1, '§2.1 dispatched exactly one event');
  const ev = dispatched[0];
  eq(ev.type, 'keydown', '§2.1 type=keydown');
  eq(ev.key, 'K', '§2.1 key=K');
  eq(ev.code, 'KeyK', '§2.1 code=KeyK');
  eq(ev.__ssAutoKey, true, '§2.2 __ssAutoKey sentinel present');

  // Default (sparse) mode also tags
  resetDispatched();
  runAutoKey({});
  eq(dispatched.length, 1, '§2.3 sparse default dispatches one event');
  eq(dispatched[0].__ssAutoKey, true, '§2.3 sparse default carries sentinel');
}

// ── §3 sentinel non-enumerable + direct-access reliable ──────────────
console.log('\n§3 sentinel non-enumerable');
{
  resetDispatched();
  runAutoKey({ autoKeyMode: 'all' });
  const ev = dispatched[0];

  // Non-enumerable: Object.keys / for-in / JSON.stringify exclude it
  const keys = Object.keys(ev);
  ok(!keys.includes('__ssAutoKey'), '§3.1 Object.keys excludes __ssAutoKey');

  // But direct access works
  ok(ev.__ssAutoKey === true, '§3.2 direct .__ssAutoKey access returns true');
  ok('__ssAutoKey' in ev, '§3.2 `in` operator finds __ssAutoKey');

  // Property descriptor sanity
  const desc = Object.getOwnPropertyDescriptor(ev, '__ssAutoKey');
  ok(desc, '§3.3 descriptor exists');
  eq(desc.value, true, '§3.3 descriptor.value=true');
  eq(desc.enumerable, false, '§3.3 descriptor.enumerable=false');
}

// ── summary ──────────────────────────────────────────────────────────
console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
