// @ts-check
/**
 * Reusable XElement readers for cmo3 main.xml extraction.
 *
 * `findField` / `findChild` already live in `cmo3XmlParser.js`; this
 * module adds the next layer up: typed scalar readers (`readBoolField`,
 * `readNumberField`, `readStringField`), tree walker (`findAllByTag`),
 * and `readSizedArray` which validates the declared `count` attr against
 * the actual entry count to catch truncated / mis-edited XML before
 * downstream code starts misindexing.
 *
 * @module io/live2d/cmo3PartExtract/xmlHelpers
 */

import {
  findField,
  readNumberArray,
  elementText,
} from '../cmo3XmlParser.js';

/**
 * @typedef {import('../cmo3XmlParser.js').XElement} XElement
 */

/**
 * @param {XElement} root
 * @param {string} tag
 * @returns {XElement[]}
 */
export function findAllByTag(root, tag) {
  /** @type {XElement[]} */
  const out = [];
  /** @param {XElement} node */
  function walk(node) {
    if (node.tag === tag) out.push(node);
    for (const c of node.children) {
      if (typeof c !== 'string') walk(c);
    }
  }
  walk(root);
  return out;
}

/**
 * Read `<b xs.n="…">true|false</b>` with an explicit default if the field
 * isn't present. Cubism writes both lowercase booleans.
 *
 * @param {XElement} parent
 * @param {string} fieldName
 * @param {boolean} fallback
 */
export function readBoolField(parent, fieldName, fallback) {
  const el = findField(parent, fieldName);
  if (!el) return fallback;
  return elementText(el).trim().toLowerCase() === 'true';
}

/**
 * Read `<i xs.n="…">N</i>` / `<f xs.n="…">N</f>` numerically, with an
 * explicit fallback if the field is missing or unparseable.
 *
 * @param {XElement} parent
 * @param {string} fieldName
 * @param {number} fallback
 */
export function readNumberField(parent, fieldName, fallback) {
  const el = findField(parent, fieldName);
  if (!el) return fallback;
  const v = Number(elementText(el).trim());
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Pull the text of a `<s xs.n="…">…</s>` (or null if missing).
 *
 * @param {XElement} parent
 * @param {string} fieldName
 */
export function readStringField(parent, fieldName) {
  const el = findField(parent, fieldName);
  if (!el) return null;
  return elementText(el);
}

/**
 * Extract the `count` attribute from a `<*-array count="N">` element and
 * verify it matches the actual entry count. Returns the parsed entries on
 * success; throws when the declared count is wrong (catches truncated /
 * mis-edited XML before downstream code starts misindexing).
 *
 * @param {XElement} el
 */
export function readSizedArray(el) {
  const arr = readNumberArray(el);
  const declared = Number(el.attrs.count);
  if (Number.isFinite(declared) && declared !== arr.length) {
    throw new Error(
      `cmo3PartExtract: ${el.tag} xs.n="${el.attrs['xs.n']}" declares count=${declared} but contains ${arr.length} values`,
    );
  }
  return arr;
}
