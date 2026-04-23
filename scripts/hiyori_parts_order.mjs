import fs from 'fs';
const xml = fs.readFileSync('reference/live2d-sample/Hiyori/cmo3_extracted/main.xml', 'utf8');

// Build GUID→localName by walking CPartSource blocks individually.
const partBlocks = Array.from(xml.matchAll(/<CPartSource xs\.id="(#\d+)"[\s\S]*?<\/CPartSource>/g));
const guidToName = new Map();
for (const [block] of partBlocks) {
  const nameM = block.match(/<s xs\.n="localName">([^<]*)<\/s>/);
  const guidM = block.match(/<CPartGuid xs\.n="guid" xs\.ref="([^"]+)"/);
  if (nameM && guidM) guidToName.set(guidM[1], nameM[1]);
}

// Also map GUID→uuid note for groups (so we can see both for the root-part list)
const guidDecls = Array.from(xml.matchAll(/<CPartGuid uuid="[^"]+" note="([^"]+)" xs\.id="(#\d+)"/g));
const guidToNote = new Map();
for (const [, note, id] of guidDecls) guidToNote.set(id, note);

// Extract Root Part _childGuids
const rootMatch = xml.match(/<CPartSource xs\.id="#4500"[\s\S]*?<carray_list xs\.n="_childGuids" count="\d+">([\s\S]*?)<\/carray_list>/);
const refs = Array.from(rootMatch[1].matchAll(/xs\.ref="([^"]+)"/g)).map(m => m[1]);

console.log('Hiyori Root Part _childGuids order:');
refs.forEach((r, i) => {
  const name = guidToName.get(r) || guidToNote.get(r) || '(unknown)';
  console.log(String(i).padStart(2), r, '→', name);
});
