import fs from 'fs';
const xml = fs.readFileSync('reference/live2d-sample/Hiyori/cmo3_extracted/main.xml', 'utf8');
const drawSourcesMatch = xml.match(/drawableSourceSet[\s\S]*?<carray_list xs\.n="_sources" count="(\d+)">([\s\S]*?)<\/carray_list>/);
const refs = Array.from(drawSourcesMatch[2].matchAll(/xs\.ref="([^"]+)"/g)).map(m => m[1]);

function nameFor(id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp('xs\\.id="' + esc + '"[\\s\\S]*?<s xs\\.n="localName">([^<]*)</s>'));
  return m ? m[1] : '(no name)';
}

console.log('=== ALL 140 meshes in _sources order (index = render position) ===');
refs.forEach((r, i) => console.log(String(i).padStart(3), nameFor(r)));
