// Diagnostic — inspect Shelby's .stretch for NeckWarp state.
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const stretchPath = process.argv[2];
const buf = await readFile(stretchPath);
const zip = await JSZip.loadAsync(buf);
const txt = await zip.file('project.json').async('string');
const proj = JSON.parse(txt);
console.log('schemaVersion in file:', proj.schemaVersion ?? '(undefined)');

const neckNode = (proj.nodes ?? []).find(
  (n) => n?.id === 'NeckWarp' || (n?.type === 'deformer' && n?.name === 'NeckWarp'),
);
console.log('NeckWarp node present?', !!neckNode);
if (neckNode) {
  console.log(`  id: ${neckNode.id} | type: ${neckNode.type} | kind: ${neckNode.deformerKind}`);
  console.log(`  parent: ${neckNode.parent}`);
  console.log(`  keyforms: ${neckNode.keyforms?.length ?? 0}`);
  console.log(`  bindings: ${neckNode.bindings?.length ?? 0}`);
}

const parts = (proj.nodes ?? []).filter((n) => n?.type === 'part' && Array.isArray(n.modifiers));
console.log();
console.log(`Parts with modifiers: ${parts.length}`);

let totalMods = 0, modsWithData = 0, modsWithoutData = 0;
const noDataExamples = [];
for (const p of parts) {
  for (const m of p.modifiers) {
    if (!m) continue;
    totalMods++;
    if (m.data && typeof m.data === 'object') {
      modsWithData++;
    } else {
      modsWithoutData++;
      if (noDataExamples.length < 5) {
        noDataExamples.push({ partId: p.id, partName: p.name, deformerId: m.deformerId });
      }
    }
  }
}
console.log(`Total modifiers across all parts: ${totalMods}`);
console.log(`  WITH .data:    ${modsWithData}`);
console.log(`  WITHOUT .data: ${modsWithoutData}`);
if (noDataExamples.length > 0) {
  console.log('  examples without .data:', JSON.stringify(noDataExamples, null, 2));
}

console.log();
console.log('NeckWarp specifically in part stacks:');
let neckRefs = 0;
for (const p of parts) {
  const ref = p.modifiers.find((m) => m?.deformerId === 'NeckWarp');
  if (ref) {
    neckRefs++;
    const hasData = ref.data && typeof ref.data === 'object';
    console.log(`  ${p.id} (${p.name}): data ${hasData ? 'PRESENT' : 'MISSING'}`);
  }
}
console.log(`Parts referencing NeckWarp: ${neckRefs}`);

// Also check which deformers HAVE no data field across all stacks.
const missingByDeformerId = new Map();
for (const p of parts) {
  for (const m of p.modifiers) {
    if (!m?.deformerId) continue;
    if (!m.data || typeof m.data !== 'object') {
      missingByDeformerId.set(m.deformerId, (missingByDeformerId.get(m.deformerId) ?? 0) + 1);
    }
  }
}
if (missingByDeformerId.size > 0) {
  console.log();
  console.log('Deformers with at least one stack-entry MISSING .data:');
  for (const [id, count] of missingByDeformerId) {
    console.log(`  ${id}: ${count} stack-entry(ies)`);
  }
}
