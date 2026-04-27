// Thin diff helpers on top of canonicalize.mjs.
//
// For Stage 0 we keep this small: enough to answer "are these two canonical
// outputs equal?" and to point at the first divergence when not. A pretty
// unified diff would be nice but it isn't load-bearing for the gating
// decision.

import { canonicalize, canonicalizeJson } from './canonicalize.mjs';

/**
 * Compare two text outputs (e.g., XML or raw JSON strings) after canonicalization.
 *
 * @param {string} a
 * @param {string} b
 * @returns {{ equal: boolean, firstDiff?: { lineNo: number, aLine: string, bLine: string } }}
 */
export function diffText(a, b) {
  const ca = canonicalize(a).canonical;
  const cb = canonicalize(b).canonical;
  if (ca === cb) return { equal: true };

  const aLines = ca.split('\n');
  const bLines = cb.split('\n');
  const limit = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < limit; i++) {
    if (aLines[i] !== bLines[i]) {
      return {
        equal: false,
        firstDiff: {
          lineNo: i + 1,
          aLine: aLines[i] ?? '<EOF>',
          bLine: bLines[i] ?? '<EOF>',
        },
      };
    }
  }
  // Lines all matched but raw strings didn't — trailing whitespace, etc.
  return { equal: false, firstDiff: { lineNo: 0, aLine: '<trailing-diff>', bLine: '<trailing-diff>' } };
}

/**
 * Compare two parsed JSON values after canonicalization. Returns the path of
 * the first divergence in dot/bracket form (e.g. `Curves[0].Id`).
 *
 * @param {*} a
 * @param {*} b
 * @returns {{ equal: boolean, firstDiff?: { path: string, aValue: any, bValue: any } }}
 */
export function diffJson(a, b) {
  const ca = canonicalizeJson(a).canonical;
  const cb = canonicalizeJson(b).canonical;
  const path = [];
  const found = walk(ca, cb, path);
  if (!found) return { equal: true };
  return {
    equal: false,
    firstDiff: {
      path: pathToString(found.path),
      aValue: found.aValue,
      bValue: found.bValue,
    },
  };
}

function walk(a, b, path) {
  if (a === b) return null;

  if (typeof a !== typeof b) {
    return { path: [...path], aValue: a, bValue: b };
  }

  if (a === null || b === null || typeof a !== 'object') {
    return { path: [...path], aValue: a, bValue: b };
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return { path: [...path], aValue: a, bValue: b };
  }

  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return { path: [...path, 'length'], aValue: a.length, bValue: b.length };
    }
    for (let i = 0; i < a.length; i++) {
      const sub = walk(a[i], b[i], [...path, i]);
      if (sub) return sub;
    }
    return null;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return { path: [...path, '<keys>'], aValue: aKeys, bValue: bKeys };
  }
  for (const k of aKeys) {
    if (!(k in b)) {
      return { path: [...path, k], aValue: a[k], bValue: '<missing>' };
    }
    const sub = walk(a[k], b[k], [...path, k]);
    if (sub) return sub;
  }
  return null;
}

function pathToString(path) {
  let s = '$';
  for (const seg of path) {
    if (typeof seg === 'number') s += `[${seg}]`;
    else s += `.${seg}`;
  }
  return s;
}
