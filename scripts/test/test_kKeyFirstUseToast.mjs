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

  // Audit-fix LOW-2 (sweep #82): assert the EXACT key (not just the
  // prefix); the pre-fix prefix check was vacuous when only one pref
  // had been written. The §1.2 setter already populated this exact
  // key, so we re-verify the key name here as a contract assertion.
  ok(
    storage.has('v3.prefs.kKeyFirstUseShown'),
    '§1.5 K-pref uses exact localStorage key v3.prefs.kKeyFirstUseShown',
  );

  // §1.6 Slice 7.G — kKeyOpensMenu rebind preference roundtrip.
  const prefs = usePreferencesStore.getState();
  eq(prefs.kKeyOpensMenu, false, '§1.6 kKeyOpensMenu default false (legacy fan-out)');
  prefs.setKKeyOpensMenu(true);
  eq(usePreferencesStore.getState().kKeyOpensMenu, true, '§1.6 setter flips to true');
  eq(storage.get('v3.prefs.kKeyOpensMenu'), 'true', '§1.6 persists to exact key');
  prefs.setKKeyOpensMenu(0);
  eq(usePreferencesStore.getState().kKeyOpensMenu, false, '§1.6 coerces 0 → false');
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

// ── §3 sentinel: expando assignment, descriptor sanity ──────────────
// Audit-fix MED-2 (sweep #82): the substrate now uses plain expando
// assignment (`ev.__ssAutoKey = true`) instead of `Object.defineProperty`
// for Safari ≤14 / embedded-WebView compatibility. This means the
// sentinel is enumerable + writable + configurable by default — those
// are acceptable for a synchronously-consumed event sentinel.
console.log('\n§3 sentinel expando');
{
  resetDispatched();
  runAutoKey({ autoKeyMode: 'all' });
  const ev = dispatched[0];

  // Direct access works (the contract the K-key handler depends on)
  ok(ev.__ssAutoKey === true, '§3.1 direct .__ssAutoKey access returns true');
  ok('__ssAutoKey' in ev, '§3.1 `in` operator finds __ssAutoKey');

  // Property descriptor — plain assignment yields the default
  // `writable: true, enumerable: true, configurable: true` shape.
  // These assertions PIN the contract so a future refactor to
  // Object.defineProperty would trip the test and require an
  // explicit decision to change descriptor semantics.
  const desc = Object.getOwnPropertyDescriptor(ev, '__ssAutoKey');
  ok(desc, '§3.2 descriptor exists');
  eq(desc.value, true, '§3.2 descriptor.value=true');
  eq(desc.writable, true, '§3.2 descriptor.writable=true (plain assignment default)');
  eq(desc.enumerable, true, '§3.2 descriptor.enumerable=true (plain assignment default)');
  eq(desc.configurable, true, '§3.2 descriptor.configurable=true (plain assignment default)');

  // Sanity: enumerable=true means Object.keys DOES include it. This is
  // a documented behaviour change vs the pre-audit-fix descriptor; the
  // sentinel is `__`-prefixed so it's still visually marked as internal
  // even if it shows in enumeration tooling.
  const keys = Object.keys(ev);
  ok(keys.includes('__ssAutoKey'), '§3.3 Object.keys includes __ssAutoKey (expando is enumerable)');
}

// ── summary ──────────────────────────────────────────────────────────
console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
