// @ts-check

/**
 * Asset hot-reload via the File System Access API.
 *
 * v3 Phase 5 — lets the user pick a folder of `.png` files and have the
 * running editor automatically pick up edits to those files. Useful for
 * iterating on character art in Photoshop/Krita without re-importing the
 * PSD: save the PNG, the canvas re-renders.
 *
 * Match strategy: each PNG's basename (without extension) is matched
 * case-insensitively against `node.name` for every part node in the
 * project. If a part matches, its texture source is replaced with a
 * fresh blob URL on every change.
 *
 * The watcher polls (`setInterval`, 1.5 s) and reads `file.lastModified`.
 * Browsers don't expose a real fs-watch event for arbitrary directories,
 * so polling is the only portable approach.
 *
 * Browser support: Chromium-based only at the moment (Chrome, Edge,
 * Brave, Arc). Firefox/Safari throw on `showDirectoryPicker` — the host
 * UI should display the watcher button only when `isSupported()` is
 * true.
 *
 * @module io/assetHotReload
 */

/** @returns {boolean} true on browsers exposing showDirectoryPicker */
export function isSupported() {
  return typeof window !== 'undefined' && typeof (/** @type {any} */ (window)).showDirectoryPicker === 'function';
}

/**
 * @typedef {Object} HotReloadEntry
 * @property {string} fileName        - PNG filename including extension
 * @property {string} matchedNodeId   - project.nodes[].id this file feeds
 * @property {string} matchedNodeName - cached for status display
 * @property {number} lastModified    - file.lastModified at last successful read
 * @property {string} blobUrl         - active object URL we issued
 */

/**
 * @typedef {Object} HotReloadHandle
 * @property {string} folderName               - the picked directory's name
 * @property {Array<HotReloadEntry>} entries   - one per matched file
 * @property {Array<string>} unmatched         - PNG basenames the project had no part for
 * @property {() => void} stop                 - revokes blob URLs + clears the poll loop
 */

/**
 * @typedef {Object} HotReloadOptions
 * @property {() => any} getProject            - returns the latest project (for resolving node ids)
 * @property {(updater: (p: any) => void) => void} updateProject
 *                                             - same signature as projectStore.updateProject
 * @property {(msg: string) => void} [onStatus]
 * @property {(entry: HotReloadEntry) => void} [onChange]
 * @property {number} [pollMs=1500]
 */

/**
 * Pick a folder and start watching its PNGs.
 *
 * @param {HotReloadOptions} opts
 * @returns {Promise<HotReloadHandle>}
 */
export async function pickFolderAndWatch(opts) {
  if (!isSupported()) {
    throw new Error('Asset hot-reload requires a Chromium-based browser (showDirectoryPicker).');
  }
  const { getProject, updateProject } = opts;
  const onStatus = opts.onStatus ?? (() => {});
  const onChange = opts.onChange ?? (() => {});
  const pollMs = Math.max(500, opts.pollMs ?? 1500);

  const dir = await (/** @type {any} */ (window)).showDirectoryPicker({ mode: 'read' });

  const project = getProject();
  const partsByName = new Map();
  for (const n of project?.nodes ?? []) {
    if (n && n.type === 'part' && typeof n.name === 'string') {
      partsByName.set(n.name.trim().toLowerCase(), n);
    }
  }

  /** @type {Array<HotReloadEntry>} */
  const entries = [];
  /** @type {Map<string, FileSystemFileHandle>} */
  const handlesByFile = new Map();
  /** @type {Array<string>} */
  const unmatched = [];

  // Iterate the directory; collect PNG entries.
  // @ts-ignore — the entries() async iterator is FS Access API specific.
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    if (!/\.png$/i.test(name)) continue;
    const base = name.replace(/\.png$/i, '').trim().toLowerCase();
    const node = partsByName.get(base);
    if (!node) {
      unmatched.push(name);
      continue;
    }
    handlesByFile.set(name, /** @type {FileSystemFileHandle} */ (handle));
    entries.push({
      fileName: name,
      matchedNodeId: node.id,
      matchedNodeName: node.name,
      lastModified: 0,
      blobUrl: '',
    });
  }

  if (entries.length === 0) {
    onStatus(`No PNGs in "${dir.name}" matched any part name. Nothing to watch.`);
  }

  // Initial sync — push every matched file once so the editor reflects
  // the current on-disk state (handy if the user tweaks before linking).
  for (const e of entries) {
    await syncEntry(e, handlesByFile, updateProject, onChange).catch((err) => {
      onStatus(`Initial read of ${e.fileName} failed: ${(err && err.message) || err}`);
    });
  }

  let intervalId = setInterval(() => {
    // Fire-and-forget: each tick checks every file. Errors per-file are
    // swallowed so a single bad file doesn't kill the whole watcher.
    Promise.all(
      entries.map((e) =>
        syncEntry(e, handlesByFile, updateProject, onChange).catch((err) => {
          onStatus(`${e.fileName}: ${(err && err.message) || err}`);
        }),
      ),
    );
  }, pollMs);

  return {
    folderName: dir.name,
    entries,
    unmatched,
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = /** @type {any} */ (null);
      }
      for (const e of entries) {
        if (e.blobUrl) {
          try { URL.revokeObjectURL(e.blobUrl); } catch { /* ignore */ }
          e.blobUrl = '';
        }
      }
    },
  };
}

/**
 * Read a file via its handle, and if `lastModified` advanced, push a
 * fresh blob URL into `project.textures`. Old blob URLs are revoked
 * to release the previous decoded copy.
 */
async function syncEntry(entry, handlesByFile, updateProject, onChange) {
  const handle = handlesByFile.get(entry.fileName);
  if (!handle) return;
  const file = await handle.getFile();
  if (file.lastModified === entry.lastModified) return;

  const url = URL.createObjectURL(file);
  const oldUrl = entry.blobUrl;
  entry.blobUrl = url;
  entry.lastModified = file.lastModified;

  updateProject((p) => {
    const idx = p.textures?.findIndex((t) => t.id === entry.matchedNodeId);
    if (idx === undefined || idx < 0) {
      // No texture entry for this part yet (rare — usually means PSD
      // hasn't been imported). Push one so CanvasViewport's sync loop
      // can pick it up.
      if (!Array.isArray(p.textures)) p.textures = [];
      p.textures.push({ id: entry.matchedNodeId, source: url });
    } else {
      p.textures[idx].source = url;
    }
  });

  onChange(entry);

  // Defer revoke so any in-flight Image() decode against the old URL
  // can finish. CanvasViewport's `img.onload` typically fires within
  // a frame or two — 5 s is comfortably safe.
  if (oldUrl) {
    setTimeout(() => {
      try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
    }, 5000);
  }
}
