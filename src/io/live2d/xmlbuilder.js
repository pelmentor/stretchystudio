// @ts-check

/**
 * Shared XML builder for Live2D .cmo3 and .can3 generators.
 *
 * Provides a fluent API for constructing the serialized Java-object XML format
 * used by Cubism Editor 5.0 project files.
 *
 * @module io/live2d/xmlbuilder
 */

/**
 * @typedef {{tag: string, attrs: Record<string, any>, children: any[], text?: string}} XmlNode
 */

export function uuid() {
  return crypto.randomUUID();
}

export class XmlBuilder {
  constructor() {
    /** @type {XmlNode[]} */
    this._shared = [];
    this._nextId = 0;
  }

  /**
   * Create an element (not shared).
   * @param {string} tag
   * @param {Record<string, any>} [attrs]
   * @returns {XmlNode}
   */
  el(tag, attrs = {}) {
    return { tag, attrs: { ...attrs }, children: [] };
  }

  /**
   * Allocate a shared object — gets xs.id and xs.idx.
   * @param {string} tag
   * @param {Record<string, any>} [attrs]
   * @returns {[XmlNode, string]}
   */
  shared(tag, attrs = {}) {
    const xid = `#${this._nextId++}`;
    const node = {
      tag,
      attrs: { ...attrs, 'xs.id': xid, 'xs.idx': String(this._shared.length) },
      children: [],
    };
    this._shared.push(node);
    return [node, xid];
  }

  /**
   * Reference to a shared object.
   * @param {string} tag
   * @param {string} xid
   * @param {Record<string, any>} [attrs]
   * @returns {XmlNode}
   */
  ref(tag, xid, attrs = {}) {
    return { tag, attrs: { ...attrs, 'xs.ref': xid }, children: [] };
  }

  /**
   * Append child element to parent; return child.
   * @param {XmlNode} parent
   * @param {string} tag
   * @param {Record<string, any>} [attrs]
   * @returns {XmlNode}
   */
  sub(parent, tag, attrs = {}) {
    const child = this.el(tag, attrs);
    parent.children.push(child);
    return child;
  }

  /**
   * Append a reference as child.
   * @param {XmlNode} parent
   * @param {string} tag
   * @param {string} xid
   * @param {Record<string, any>} [attrs]
   * @returns {XmlNode}
   */
  subRef(parent, tag, xid, attrs = {}) {
    const child = this.ref(tag, xid, attrs);
    parent.children.push(child);
    return child;
  }

  /**
   * Serialize to XML string.
   * @param {object} root - Root element
   * @param {Array<[string,string]>} versionPis - Version processing instructions
   * @param {string[]} importPis - Import processing instructions
   */
  serialize(root, versionPis = [], importPis = []) {
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    for (const [name, ver] of versionPis) {
      lines.push(`<?version ${name}:${ver}?>`);
    }
    for (const imp of importPis) {
      lines.push(`<?import ${imp}?>`);
    }
    lines.push(this._nodeToXml(root));
    return lines.join('\n');
  }

  _nodeToXml(node) {
    const parts = [`<${node.tag}`];
    for (const [k, v] of Object.entries(node.attrs)) {
      // WRT-2 — per RULE-№1 + [[typeof-nan-is-number]]: NaN / Infinity
      // would serialise as literal "NaN" / "Infinity" / "-Infinity" via
      // String(v), which the Cubism Editor XML loader rejects (recovered
      // status — see [[blank-load-ask-for-log]]) or silently substitutes
      // 0. Surface the bad emitter site loudly instead. Mirror of the F6
      // guard in moc3/binaryWriter.js writeF32.
      if (typeof v === 'number' && !Number.isFinite(v)) {
        throw new Error(`XmlBuilder: non-finite attribute value at <${node.tag}>/@${k} = ${v}`);
      }
      parts.push(` ${this._escAttrName(k)}="${this._escXml(String(v))}"`);
    }
    if (node.children.length === 0 && node.text == null) {
      parts.push('/>');
      return parts.join('');
    }
    parts.push('>');
    if (node.text != null) {
      // WRT-2 — same guard on text content.
      if (typeof node.text === 'number' && !Number.isFinite(node.text)) {
        throw new Error(`XmlBuilder: non-finite text content at <${node.tag}> = ${node.text}`);
      }
      parts.push(this._escXml(String(node.text)));
    }
    for (const child of node.children) {
      parts.push(this._nodeToXml(child));
    }
    parts.push(`</${node.tag}>`);
    return parts.join('');
  }

  _escAttrName(name) {
    return name;
  }

  _escXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
}
