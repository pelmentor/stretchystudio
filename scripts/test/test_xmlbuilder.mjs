// v3 Phase 0F.25 - tests for src/io/live2d/xmlbuilder.js
//
// Critical infrastructure - every .cmo3 / .can3 export goes through
// XmlBuilder. The shared-object IDs (`xs.id` / `xs.idx` / `xs.ref`)
// are how the Java-object format encodes references; if those drift
// the file becomes unreadable in Cubism Editor.
//
// Run: node scripts/test/test_xmlbuilder.mjs

import { XmlBuilder, uuid } from '../../src/io/live2d/xmlbuilder.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── uuid ──────────────────────────────────────────────────────────

{
  const a = uuid();
  const b = uuid();
  assert(typeof a === 'string', 'uuid returns string');
  assert(/^[0-9a-f-]+$/.test(a), 'uuid is hex+dashes');
  assert(a !== b, 'uuid generates distinct values');
}

// ── el: plain element ─────────────────────────────────────────────

{
  const x = new XmlBuilder();
  const node = x.el('Foo', { bar: 'baz' });
  assert(node.tag === 'Foo', 'el: tag');
  assert(node.attrs.bar === 'baz', 'el: attrs');
  assert(Array.isArray(node.children) && node.children.length === 0, 'el: children []');

  // attrs are copied (mutation-safe)
  const attrs = { x: '1' };
  const node2 = x.el('Foo', attrs);
  attrs.x = 'CHANGED';
  assert(node2.attrs.x === '1', 'el: attrs copied (mutation-safe)');
}

// ── shared: gets xs.id + xs.idx, registered on builder ────────────

{
  const x = new XmlBuilder();
  const [node1, xid1] = x.shared('Bar');
  const [node2, xid2] = x.shared('Bar');

  assert(typeof xid1 === 'string' && xid1.startsWith('#'), 'shared: xid is "#N"');
  assert(xid1 === '#0' && xid2 === '#1', 'shared: xid increments');
  assert(node1.attrs['xs.id'] === '#0', 'shared: xs.id on node');
  assert(node1.attrs['xs.idx'] === '0', 'shared: xs.idx is 0-based');
  assert(node2.attrs['xs.idx'] === '1', 'shared: xs.idx increments');

  // Builder tracks the shared list
  assert(x._shared.length === 2, 'shared: registered on builder');
  assert(x._shared[0] === node1, 'shared: first entry is node1');
}

// ── ref: produces an xs.ref attribute, not registered ─────────────

{
  const x = new XmlBuilder();
  const [, xid] = x.shared('Source');
  const r = x.ref('Use', xid);
  assert(r.attrs['xs.ref'] === xid, 'ref: xs.ref points to shared');
  assert(x._shared.length === 1, 'ref: not added to shared list');
  assert(r.attrs['xs.id'] === undefined, 'ref: no xs.id');
}

// ── sub / subRef ──────────────────────────────────────────────────

{
  const x = new XmlBuilder();
  const root = x.el('Root');
  const child = x.sub(root, 'Child', { v: '1' });
  assert(root.children.length === 1, 'sub: appends to parent');
  assert(root.children[0] === child, 'sub: reference appended');
  assert(child.attrs.v === '1', 'sub: attrs forwarded');

  const [, xid] = x.shared('S');
  const refChild = x.subRef(root, 'Use', xid);
  assert(root.children.length === 2, 'subRef: appends to parent');
  assert(refChild.attrs['xs.ref'] === xid, 'subRef: ref attribute');
}

// ── serialize: basic structure ────────────────────────────────────

{
  const x = new XmlBuilder();
  const root = x.el('Root');
  x.sub(root, 'Empty');
  const c = x.sub(root, 'WithText');
  c.text = 'hello';

  const out = x.serialize(root);
  assert(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
    'serialize: starts with XML decl');
  assert(out.includes('<Root>') && out.includes('</Root>'),
    'serialize: root tag present');
  assert(out.includes('<Empty/>'),
    'serialize: empty element self-closes');
  assert(out.includes('<WithText>hello</WithText>'),
    'serialize: text content rendered');
}

// ── serialize: version + import PIs ──────────────────────────────

{
  const x = new XmlBuilder();
  const root = x.el('Root');
  const out = x.serialize(
    root,
    [['CModelSource', '402030000']],
    ['com.live2d.cubism.modeler.CModelSource'],
  );
  assert(out.includes('<?version CModelSource:402030000?>'),
    'serialize: version PI emitted');
  assert(out.includes('<?import com.live2d.cubism.modeler.CModelSource?>'),
    'serialize: import PI emitted');
}

// ── serialize: XML escapes special chars in attrs and text ────────

{
  const x = new XmlBuilder();
  const root = x.el('Root', { attr: 'a < b > c & d "e" \'f\'' });
  const c = x.sub(root, 'Text');
  c.text = '<>&"\'';
  const out = x.serialize(root);

  // Attribute escapes
  assert(out.includes('&lt;'), 'escape: &lt;');
  assert(out.includes('&gt;'), 'escape: &gt;');
  assert(out.includes('&amp;'), 'escape: &amp;');
  assert(out.includes('&quot;'), 'escape: &quot;');
  assert(out.includes('&apos;'), 'escape: &apos;');

  // Raw special chars must NOT appear inside attribute values
  // (test by counting unescaped < chars - should only be in tags)
  const tagOpens = (out.match(/<[A-Za-z?\/!]/g) ?? []).length;
  const allLT = (out.match(/</g) ?? []).length;
  assert(tagOpens === allLT, 'escape: no unescaped < outside tags');
}

// ── serialize: nested elements indent-free ───────────────────────

{
  const x = new XmlBuilder();
  const root = x.el('A');
  const b = x.sub(root, 'B');
  x.sub(b, 'C');
  const out = x.serialize(root);
  // Format is unchanged from existing — test we're getting a single
  // line of nested tags (no indenting promised, but is what we output)
  assert(out.endsWith('<A><B><C/></B></A>'),
    'serialize: nested tags collapsed (current convention)');
}

// ── multiple shared with refs interleaved ────────────────────────

{
  const x = new XmlBuilder();
  const [, xidA] = x.shared('A', { name: 'a' });
  const [, xidB] = x.shared('B', { name: 'b' });
  const root = x.el('Doc');
  x.subRef(root, 'UseA', xidA);
  x.subRef(root, 'UseB', xidB);
  const out = x.serialize(root);
  assert(out.includes(`xs.ref="${xidA}"`), 'serialize: ref to A');
  assert(out.includes(`xs.ref="${xidB}"`), 'serialize: ref to B');
}

console.log(`xmlbuilder: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
