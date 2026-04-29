// @ts-check
/**
 * Minimal XStream-style XML reader for Cubism `main.xml`.
 *
 * The format is a Java XStream-flavoured serialisation: every node is
 * either `<tag attr="…" attr="…"/>` (self-closing) or
 * `<tag attr="…">…children-and-text…</tag>`. Shared objects carry an
 * `xs.id="#NNN"` declaration and an `xs.idx="NNN"` ordinal; references
 * elsewhere in the document use `xs.ref="#NNN"` to point back at them.
 *
 * The Cubism XML is well-formed and predictable enough that we don't
 * need a full SAX parser, but regex alone breaks down once you have to
 * resolve `<Tag xs.ref="…"/>` and balance arbitrarily-nested same-name
 * elements. A small lexer + recursive tree builder is the right shape.
 *
 * Limitations (deliberate — keeps the module tight):
 *   - No DTD / doctype / CDATA support
 *   - No XML namespaces (xs.* are treated as plain attribute names)
 *   - Numeric / hex character references in text are decoded; everything
 *     else is left alone
 *
 * @module io/live2d/cmo3XmlParser
 */

/**
 * @typedef {Object} XElement
 * @property {string} tag
 * @property {Record<string, string>} attrs
 * @property {(XElement|string)[]} children    raw child stream — text is plain string
 */

/**
 * @typedef {Object} ParsedXml
 * @property {XElement} root
 * @property {Map<string, XElement>} idPool    `xs.id` → element (declared with that id)
 * @property {Array<[string, string]>} versionPis    e.g. [["CModelSource","14"], ...]
 * @property {string[]} importPis
 */

const ENTITY_TABLE = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

/**
 * Decode XML entities in attribute values + text.
 * Decimal: `&#NNN;`. Hex: `&#xHH;`. Named: `&amp;` etc.
 *
 * @param {string} s
 */
function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (whole, _g1, hex, dec, named) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    if (named && Object.prototype.hasOwnProperty.call(ENTITY_TABLE, named)) {
      return ENTITY_TABLE[/** @type {keyof typeof ENTITY_TABLE} */ (named)];
    }
    return whole;
  });
}

/**
 * Parse the attribute fragment between the tag name and `>` / `/>`.
 * The attribute regex tolerates spaces around `=` and either quote style
 * but does NOT support unquoted values — Cubism's writer always quotes.
 *
 * @param {string} chunk
 */
function parseAttrs(chunk) {
  /** @type {Record<string,string>} */
  const out = {};
  const re = /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const name = m[1];
    const raw = m[3] !== undefined ? m[3] : m[4];
    out[name] = decodeEntities(raw);
  }
  return out;
}

/**
 * Parse a Cubism main.xml string into an element tree + xs.id pool +
 * processing-instruction lists.
 *
 * Throws on unbalanced tags or bad XML so that consumers never silently
 * misread a malformed file.
 *
 * @param {string} xml
 * @returns {ParsedXml}
 */
export function parseCmo3Xml(xml) {
  let i = 0;
  const N = xml.length;

  /** @type {Array<[string,string]>} */
  const versionPis = [];
  /** @type {string[]} */
  const importPis = [];
  /** @type {Map<string, XElement>} */
  const idPool = new Map();

  // Skip XML declaration `<?xml ... ?>` if present.
  if (xml.startsWith('<?xml', i)) {
    const close = xml.indexOf('?>', i);
    if (close === -1) throw new Error('cmo3XmlParser: unterminated <?xml ?>');
    i = close + 2;
  }

  // Eat whitespace + processing instructions before the root.
  /** @returns {boolean} true if a PI/whitespace was consumed */
  function consumePiOrWhitespace() {
    while (i < N && /\s/.test(xml[i])) i++;
    if (xml.startsWith('<?', i)) {
      const close = xml.indexOf('?>', i);
      if (close === -1) throw new Error('cmo3XmlParser: unterminated processing instruction');
      const body = xml.slice(i + 2, close).trim();
      if (body.startsWith('version ')) {
        const m = /^version\s+([A-Za-z0-9_]+):(\d+)$/.exec(body);
        if (m) versionPis.push([m[1], m[2]]);
      } else if (body.startsWith('import ')) {
        importPis.push(body.slice(7).trim());
      }
      i = close + 2;
      return true;
    }
    return false;
  }

  while (consumePiOrWhitespace()) { /* drain */ }

  /**
   * Read one element starting at the current `<` cursor. Returns the
   * element plus its closing-end position. Self-closing elements have an
   * empty `children` array.
   *
   * @returns {XElement}
   */
  function readElement() {
    if (xml[i] !== '<') {
      throw new Error(`cmo3XmlParser: expected '<' at offset ${i}, got ${JSON.stringify(xml.slice(i, i + 20))}`);
    }

    // Find end of opening tag — careful: attribute values may contain '>'.
    // Re-scan attribute by attribute via the same regex used in parseAttrs;
    // simpler — find the first unquoted `>` past the tag name.
    let j = i + 1;
    // Tag name
    const nameStart = j;
    while (j < N && !/[\s/>]/.test(xml[j])) j++;
    const tag = xml.slice(nameStart, j);

    // Walk attribute region, tracking quote state, until '>' or '/>'.
    let inQuote = '';
    while (j < N) {
      const c = xml[j];
      if (inQuote) {
        if (c === inQuote) inQuote = '';
        j++;
        continue;
      }
      if (c === '"' || c === "'") { inQuote = c; j++; continue; }
      if (c === '/' && xml[j + 1] === '>') break;
      if (c === '>') break;
      j++;
    }
    if (j >= N) throw new Error(`cmo3XmlParser: unterminated tag <${tag}> at offset ${i}`);

    const attrChunk = xml.slice(nameStart + tag.length, j);
    const attrs = parseAttrs(attrChunk);

    const selfClosing = xml[j] === '/' && xml[j + 1] === '>';
    i = j + (selfClosing ? 2 : 1);

    /** @type {XElement} */
    const el = { tag, attrs, children: [] };

    if (attrs['xs.id']) {
      idPool.set(attrs['xs.id'], el);
    }

    if (selfClosing) return el;

    // Children + text content. Loop until matching </tag>.
    while (i < N) {
      if (xml.startsWith('</', i)) {
        const closeEnd = xml.indexOf('>', i);
        if (closeEnd === -1) throw new Error(`cmo3XmlParser: unterminated closing tag at offset ${i}`);
        const closeName = xml.slice(i + 2, closeEnd).trim();
        if (closeName !== tag) {
          throw new Error(`cmo3XmlParser: closing tag </${closeName}> doesn't match opening <${tag}> at offset ${i}`);
        }
        i = closeEnd + 1;
        return el;
      }
      if (xml.startsWith('<!--', i)) {
        const end = xml.indexOf('-->', i);
        if (end === -1) throw new Error(`cmo3XmlParser: unterminated comment at offset ${i}`);
        i = end + 3;
        continue;
      }
      if (xml[i] === '<') {
        el.children.push(readElement());
      } else {
        // Text run until next '<'.
        const runEnd = xml.indexOf('<', i);
        const text = xml.slice(i, runEnd === -1 ? N : runEnd);
        if (text.length > 0) el.children.push(decodeEntities(text));
        i = runEnd === -1 ? N : runEnd;
      }
    }
    throw new Error(`cmo3XmlParser: ran out of input inside <${tag}>`);
  }

  if (i >= N || xml[i] !== '<') {
    throw new Error('cmo3XmlParser: no root element found');
  }
  const root = readElement();
  return { root, idPool, versionPis, importPis };
}

/**
 * Resolve the element a `<Tag xs.ref="#NNN"/>` points at. Returns null if
 * the ref isn't in the id pool (caller decides whether to warn or throw).
 *
 * @param {XElement} ref
 * @param {Map<string, XElement>} idPool
 */
export function resolveRef(ref, idPool) {
  const r = ref.attrs['xs.ref'];
  if (!r) return null;
  return idPool.get(r) ?? null;
}

/**
 * First child element with the given tag (and optional `xs.n` field name).
 * Skips text nodes. Returns null if not found.
 *
 * @param {XElement} parent
 * @param {string} tag
 * @param {string} [fieldName]
 */
export function findChild(parent, tag, fieldName) {
  for (const c of parent.children) {
    if (typeof c === 'string') continue;
    if (c.tag !== tag) continue;
    if (fieldName !== undefined && c.attrs['xs.n'] !== fieldName) continue;
    return c;
  }
  return null;
}

/**
 * Every child element matching tag (and optional `xs.n` field name).
 * Order-preserving.
 *
 * @param {XElement} parent
 * @param {string} tag
 * @param {string} [fieldName]
 * @returns {XElement[]}
 */
export function findChildren(parent, tag, fieldName) {
  const out = [];
  for (const c of parent.children) {
    if (typeof c === 'string') continue;
    if (c.tag !== tag) continue;
    if (fieldName !== undefined && c.attrs['xs.n'] !== fieldName) continue;
    out.push(c);
  }
  return out;
}

/**
 * Find a descendant by `xs.n` field name regardless of tag. Useful for
 * hopping past the `<ACDrawableSource xs.n="super">` wrappers Cubism uses.
 *
 * @param {XElement} parent
 * @param {string} fieldName
 */
export function findField(parent, fieldName) {
  for (const c of parent.children) {
    if (typeof c === 'string') continue;
    if (c.attrs['xs.n'] === fieldName) return c;
  }
  return null;
}

/**
 * Read the inline text of a leaf element like `<i>5</i>` / `<f>3.14</f>`.
 *
 * @param {XElement} el
 */
export function elementText(el) {
  let out = '';
  for (const c of el.children) {
    if (typeof c === 'string') out += c;
  }
  return out;
}

/**
 * Decode a typed-array element (`<float-array count="N">v0 v1 …</float-array>`,
 * `<int-array>`, `<short-array>`, `<byte-array>`). Returns an array of
 * numbers (Number, not typed-array — caller can copy if needed).
 *
 * @param {XElement} el
 * @returns {number[]}
 */
export function readNumberArray(el) {
  const text = elementText(el).trim();
  if (text.length === 0) return [];
  return text.split(/\s+/).map(Number);
}
