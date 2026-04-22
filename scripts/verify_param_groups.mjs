// Verify the parameter group tree + Random Pose group list match Hiyori's
// layout: root + N sub-groups, each with its own CParameterGroupGuid and
// CParameterGroupId, and CParameterSources reference their sub-group
// (not the root) as parentGroupGuid.
//
// Run: node scripts/verify_param_groups.mjs

import { generateCmo3 } from '../src/io/live2d/cmo3writer.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failed++; }
}

const TINY_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 252, 255, 255, 63, 0, 5,
  254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174,
  66, 96, 130,
]);

function mkMesh(name, tag, cx, cy, w, h) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  return {
    name, tag, partId: name,
    vertices: new Float32Array([x0, y0, x1, y0, x0, y1, x1, y1]),
    triangles: [0, 1, 2, 2, 1, 3],
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    pngData: TINY_PNG, pngPath: `${name}.png`, origin: { x: cx, y: cy },
  };
}

const meshes = [
  mkMesh('Face',       'face',       500, 300, 200, 280),
  mkMesh('FrontHair',  'front hair', 500, 220, 260, 200),
  mkMesh('BackHair',   'back hair',  500, 350, 300, 400),
  mkMesh('Topwear',    'topwear',    500, 800, 400, 300),
  mkMesh('Bottomwear', 'bottomwear', 500, 1050, 350, 250),
  mkMesh('Legwear',    'legwear',    500, 1200, 300, 200),
];

console.log('[param-groups] Building a full rig to inspect the group tree');
const out = await generateCmo3({
  canvasW: 1000, canvasH: 1500, meshes, groups: [],
  modelName: 'GroupsTest', generateRig: true,
});

// Unpack the XML directly (reuse inspect_cmo3 logic inline for robustness)
import { inflateRawSync } from 'node:zlib';
const buf = out.cmo3;
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const obfKey = dv.getInt32(14, false);
const k = obfKey & 0xFF;
function rvn(u, p, x) { let v = 0; for (;;) { const b = u[p++] ^ x; v = (v << 7) | (b & 0x7F); if ((b & 0x80) === 0) return { val: v, pos: p }; } }
function rs(u, p, x) { const { val: L, pos: p2 } = rvn(u, p, x); const o = new Uint8Array(L); for (let i = 0; i < L; i++) o[i] = u[p2 + i] ^ x; return { str: new TextDecoder().decode(o), pos: p2 + L }; }
let pos = 26 + 28;
const fileCount = dv.getInt32(pos, false) ^ obfKey; pos += 4;
const mL = BigInt(obfKey) & 0xFFFFFFFFn;
const mH = obfKey < 0 ? 0xFFFFFFFFn : mL;
const mask = (mH << 32n) | mL;
let main = null;
for (let i = 0; i < fileCount; i++) {
  const { str: fp, pos: p2 } = rs(buf, pos, k); pos = p2;
  const { pos: p3 } = rs(buf, pos, k); pos = p3;
  const startPos = Number((dv.getBigUint64(pos, false) ^ mask) & 0xFFFFFFFFFFFFFFFFn); pos += 8;
  const fileLen = dv.getInt32(pos, false) ^ obfKey; pos += 4;
  pos += 10;
  if (fp === 'main.xml') main = { startPos, fileLen };
}
const region = buf.slice(main.startPos, main.startPos + main.fileLen);
const deob = new Uint8Array(region.length);
for (let i = 0; i < region.length; i++) deob[i] = region[i] ^ k;
// Strip zip local header + data descriptor
const comp = deob.slice(38, deob.length - 16);
const xml = new TextDecoder().decode(inflateRawSync(comp));

// ──────────────────────── Assertions ────────────────────────
// Root param group block
assert(xml.includes('<s xs.n="name">Root Parameter Group</s>'),
  'root CParameterGroup name present');
assert(xml.includes('idstr="ParamGroupRoot"'),
  'ParamGroupRoot CParameterGroupId present');

// Root guid MUST be the well-known CParameterGroupGuid.ROOT_GROUP constant
// (see CParameterGroupGuid.Companion.b() in Editor Java). The Random Pose
// dialog searches parameterGroupSet.getGroups() for this exact UUID; a
// random UUID makes the dialog render empty.
assert(xml.includes('uuid="e9fe6eff-953b-4ce2-be7c-4a7c3913686b"'),
  'root CParameterGroupGuid uuid is the well-known ROOT_GROUP constant');

// Expected categories for this model: face (AngleX/Y/Z), eye (ParamEye*Open), eyeball (ParamEyeBallX/Y),
// brow (ParamBrowLY/RY), mouth (MouthForm/MouthOpenY), body (BodyAngle*, Breath),
// hair (HairFront/Side/Back), clothing (Skirt/Shirt/Pants/Bust), custom (ParamOpacity).
const expectedIdstrs = [
  'ParamGroupFace', 'ParamGroupEyes', 'ParamGroupEyeballs', 'ParamGroupBrows',
  'ParamGroupMouth', 'ParamGroupBody', 'ParamGroupHair', 'ParamGroupClothing',
  'ParamGroupCustom',
];
for (const idstr of expectedIdstrs) {
  assert(xml.includes(`idstr="${idstr}"`), `sub-group id ${idstr} declared`);
}

// CParameterGroupSet._groups count = 1 root + 9 subs = 10
const groupsMatch = xml.match(/<carray_list xs\.n="_groups" count="(\d+)"/);
assert(groupsMatch && parseInt(groupsMatch[1]) === 10,
  `_groups count=10 (got ${groupsMatch?.[1]})`);

// Each sub-group has a CParameterGroup block with name from CATEGORY_DEFS
for (const name of ['Face', 'Eye', 'Eyeball', 'Brow', 'Mouth', 'Body', 'Hair', 'Clothing', 'Custom']) {
  assert(xml.includes(`<s xs.n="name">${name}</s>`), `sub-group name "${name}" emitted`);
}

// No CParameterSource should still use the ROOT group GUID as parentGroupGuid
// (it should reference one of the sub-group GUIDs). Extract root GUID from
// the root CParameterGroup's guid ref, then confirm no CParameterSource.parentGroupGuid
// points at it.
const rootGuidMatch = xml.match(
  /<CParameterGroup[^>]*xs\.id="([^"]+)"[^>]*>\s*<s xs\.n="name">Root Parameter Group<\/s>[\s\S]*?<CParameterGroupGuid xs\.n="guid" xs\.ref="([^"]+)"/
);
assert(rootGuidMatch, 'found root CParameterGroup and its guid ref');
const rootGuidRef = rootGuidMatch?.[2];
const srcPGGMatches = xml.match(
  /<CParameterSource>[\s\S]*?<CParameterGroupGuid xs\.n="parentGroupGuid" xs\.ref="([^"]+)"/g
) || [];
const srcRefsToRoot = srcPGGMatches.filter(m => m.endsWith(`xs.ref="${rootGuidRef}"`));
assert(srcRefsToRoot.length === 0,
  `no CParameterSource still points at root as parentGroupGuid (got ${srcRefsToRoot.length})`);

// CRandomPoseSetting groups.keys count must equal 1 + activeCategories
const rpgKeysMatch = xml.match(/<array_list xs\.n="groups\.keys" count="(\d+)">/);
assert(rpgKeysMatch && parseInt(rpgKeysMatch[1]) === 10,
  `Random Pose groups.keys count=10 (got ${rpgKeysMatch?.[1]})`);

// And groups.values matches
const rpgValsMatch = xml.match(/<array_list xs\.n="groups\.values" count="(\d+)">/);
assert(rpgValsMatch && parseInt(rpgValsMatch[1]) === 10,
  `Random Pose groups.values count=10 (got ${rpgValsMatch?.[1]})`);

// And exactly 10 CRandomPoseGroupData entries with isExpand=true
const rpgDataCount = (xml.match(/<CRandomPoseGroupData>/g) || []).length;
assert(rpgDataCount === 10, `10 CRandomPoseGroupData entries (got ${rpgDataCount})`);

console.log('\n──────────────────────────────────────────────');
console.log(failed === 0 ? '[verify] ALL CHECKS PASSED ✓' : `[verify] ${failed} CHECKS FAILED ✗`);
process.exit(failed === 0 ? 0 : 1);
