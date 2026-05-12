import { uidLong } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

const DB_NAME = 'stretchystudio-db';
const DB_VERSION = 2; // v2 (2026-05-09): split blob out of the meta store
const META_STORE = 'projects';      // (id, name, thumbnail, updatedAt) — no blob
const BLOB_STORE = 'projectBlobs';  // (id, blob)

/**
 * Generate a project record ID. Phase 0G (Pillar P): replaces the
 * old `Math.random().toString(36).slice(2, 9)` which gave only ~36
 * bits of entropy and could collide once a user accumulated a few
 * hundred projects.  We use full 32-char hex here (versus the 12-char
 * `uid()` used for in-app IDs) because project IDs are persisted to
 * IndexedDB and may someday be shared / used as URL slugs.
 */
const newProjectId = uidLong;

/**
 * Open the IndexedDB database. v2 splits the project record into two
 * stores: a lean meta record in `projects` (id, name, thumbnail,
 * updatedAt) and the heavy `.stretch` ZIP blob in `projectBlobs`. The
 * gallery list path now reads only meta — the prior single-store
 * schema forced `getAll()` to materialise every blob into memory just
 * to render gallery cards (each project ~tens of MB; 50 projects =
 * gigabytes of transient JS heap on every list refresh).
 *
 * The v1 → v2 upgrade copies each existing record's `blob` field into
 * the new `projectBlobs` store and strips it from the meta record.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = /** @type {IDBDatabase} */ (e.target.result);
      const tx = /** @type {IDBTransaction} */ (e.target.transaction);
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      }
      if (e.oldVersion < 2) {
        const projectsStore = tx.objectStore(META_STORE);
        const blobsStore = tx.objectStore(BLOB_STORE);
        const cursorReq = projectsStore.openCursor();
        cursorReq.onsuccess = (evt) => {
          const cursor = /** @type {IDBCursorWithValue|null} */ (evt.target.result);
          if (!cursor) return;
          const record = cursor.value;
          if (record && record.blob) {
            blobsStore.put({ id: record.id, blob: record.blob });
            const meta = { ...record };
            delete meta.blob;
            cursor.update(meta);
          }
          cursor.continue();
        };
      }
    };

    request.onsuccess = (e) => resolve(/** @type {IDBDatabase} */ (e.target.result));
    request.onerror = (e) => reject(/** @type {IDBOpenDBRequest} */ (e.target).error);
  });
}

/**
 * List all projects in the database. Returns lean meta records only —
 * `blob` is NOT included; callers that need the actual project bytes
 * call `loadFromDb(id)` which joins the meta + blob stores. Gallery
 * cards only need (id, name, thumbnail, updatedAt) and reading the
 * blobs into memory just to discard them was the dominant cost of
 * mounting the gallery.
 *
 * @returns {Promise<Array<{id:string,name:string,thumbnail:string,updatedAt:number}>>}
 *          sorted by updatedAt desc.
 */
export async function listProjects() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const store = transaction.objectStore(META_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const projects = request.result;
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(projects);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a project to the database. Writes meta + blob in one
 * transaction so the two stores stay in sync.
 * @param {string|null} id - Existing ID to overwrite, or null to create.
 * @param {string} name - Project name.
 * @param {Blob} blob - .stretch ZIP blob.
 * @param {string} thumbnail - Data URL of the preview image.
 * @returns {Promise<string>} The ID of the saved project.
 */
export async function saveToDb(id, name, blob, thumbnail) {
  const db = await openDb();
  const currentId = id || newProjectId();
  const updatedAt = Date.now();
  // Cover the IndexedDB write — dominant cost on large projects.
  // `projectSave:full` only times the SaveModal flow up to blob creation;
  // the actual IDB persist happens here and was uninstrumented.
  logger.time('projectSave', 'indexedDbBlob');
  const blobSizeBytes = blob?.size ?? 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    tx.objectStore(META_STORE).put({ id: currentId, name, thumbnail, updatedAt });
    tx.objectStore(BLOB_STORE).put({ id: currentId, blob });
    tx.oncomplete = () => {
      logger.timeEnd('projectSave', 'indexedDbBlob', { blobSizeBytes });
      resolve(currentId);
    };
    tx.onerror = () => {
      logger.timeEndIfRunning('projectSave', 'indexedDbBlob', { blobSizeBytes, error: tx.error?.message ?? String(tx.error) });
      reject(tx.error);
    };
  });
}

/**
 * Load a project from the database. Joins meta + blob stores.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function loadFromDb(id) {
  const db = await openDb();
  // Cover the IndexedDB read — dominant cost on "Open from gallery"
  // path (precedes `projectLoad:full` which only times the in-memory
  // deserialize). Without this the gallery → load round-trip is invisible.
  logger.time('projectLoad', 'indexedDbBlob');
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readonly');
    const metaReq = tx.objectStore(META_STORE).get(id);
    const blobReq = tx.objectStore(BLOB_STORE).get(id);
    tx.oncomplete = () => {
      const meta = metaReq.result;
      const blobRec = blobReq.result;
      if (!meta) {
        logger.timeEnd('projectLoad', 'indexedDbBlob', { found: false });
        return resolve(null);
      }
      logger.timeEnd('projectLoad', 'indexedDbBlob', { found: true, blobSizeBytes: blobRec?.blob?.size ?? 0 });
      resolve({ ...meta, blob: blobRec?.blob ?? null });
    };
    tx.onerror = () => {
      logger.timeEndIfRunning('projectLoad', 'indexedDbBlob', { error: tx.error?.message ?? String(tx.error) });
      reject(tx.error);
    };
  });
}

/**
 * Delete a project from both stores.
 * @param {string} id
 */
export async function deleteProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update the name of an existing project. Only touches the meta
 * store — the blob doesn't change on rename.
 * @param {string} id
 * @param {string} newName
 */
export async function updateProjectName(id, newName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) return reject(new Error('Project not found'));
      record.name = newName;
      record.updatedAt = Date.now();
      const putRequest = store.put(record);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Create a copy of an existing project. Reads + writes both stores
 * inside one transaction so a partial duplicate (meta without blob)
 * cannot be observed.
 * @param {string} id
 */
export async function duplicateProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const blobStore = tx.objectStore(BLOB_STORE);
    const metaReq = metaStore.get(id);
    const blobReq = blobStore.get(id);
    tx.oncomplete = () => {
      // Resolve happens inside the meta-get success below; this is
      // the nominal completion path. If we got here without a put,
      // the resolve was already issued.
    };
    metaReq.onsuccess = () => {
      const meta = metaReq.result;
      const blobRec = blobReq.result;
      if (!meta) return reject(new Error('Project not found'));
      const newId = newProjectId();
      const newMeta = { ...meta, id: newId, name: `${meta.name} (Copy)`, updatedAt: Date.now() };
      metaStore.put(newMeta);
      if (blobRec?.blob) blobStore.put({ id: newId, blob: blobRec.blob });
      tx.oncomplete = () => resolve(newId);
    };
    tx.onerror = () => reject(tx.error);
  });
}
