import JSZip from 'jszip';
import { CURRENT_SCHEMA_VERSION, migrateProject } from '../store/projectMigrations.js';

/**
 * Serialize the current project to a .stretch ZIP file.
 *
 * Default mode: per-asset failures (texture fetch, audio fetch) emit
 * `console.error` and the save continues with an empty placeholder
 * source. End-user save flow benefits from this — losing one texture
 * shouldn't kill the whole save.
 *
 * Strict mode (`{ strict: true }`): the first per-asset failure
 * throws. Right for automated harnesses / CI / batch tools where a
 * silent partial-save is the actual problem.
 *
 * @param {object} project — projectStore.project snapshot
 * @param {{strict?: boolean}} [opts]
 * @returns {Promise<Blob>} ZIP blob ready for download
 */
export async function saveProject(project, opts = {}) {
  const strict = opts.strict === true;
  const zip = new JSZip();
  const texturesFolder = zip.folder('textures');
  const audiosFolder = zip.folder('audios');

  // Serialize textures: fetch blob URLs in parallel → store as PNG files.
  // Each fetch is independent; awaiting them sequentially is N round-trips
  // through the blob: scheme handler when one Promise.all gets them all
  // pipelined. For 50 textures over slow handlers that's the difference
  // between "save freezes the UI for seconds" and "save completes in one
  // round-trip's worth of time".
  const textureResults = await Promise.all(project.textures.map(async (tex) => {
    try {
      const response = await fetch(tex.source);
      const blob = await response.blob();
      return { id: tex.id, blob, error: null };
    } catch (err) {
      return { id: tex.id, blob: null, error: err };
    }
  }));
  const serializedTextures = [];
  for (const r of textureResults) {
    if (r.blob) {
      texturesFolder.file(`${r.id}.png`, r.blob);
      serializedTextures.push({ id: r.id, source: `textures/${r.id}.png` });
    } else {
      if (strict) throw new Error(`saveProject(strict): texture ${r.id} fetch failed: ${r.error?.message ?? r.error}`);
      console.error(`Failed to fetch texture ${r.id}:`, r.error);
      serializedTextures.push({ id: r.id, source: '' });
    }
  }

  // Serialize audio tracks: fetch blob URL → store in audios/ folder
  const serializedActions = (project.actions ?? []).map(action => ({
    ...action,
    audioTracks: (action.audioTracks ?? []).map(track => {
      const t = { ...track };
      if (track.sourceUrl) {
        const ext = track.mimeType ? track.mimeType.split('/')[1] : 'wav';
        const path = `audios/${track.id}.${ext}`;
        // Fetch will happen during zip generation, store placeholder path
        t._sourceBlob = track.sourceUrl; // temp placeholder for fetch
        t.source = path;
        delete t.sourceUrl;
      } else {
        t.source = null;
      }
      return t;
    }),
  }));

  // Audio blobs in parallel — same rationale as textures.
  const audioFetches = [];
  for (const action of serializedActions) {
    for (const track of action.audioTracks) {
      if (track._sourceBlob) {
        audioFetches.push((async () => {
          try {
            const response = await fetch(track._sourceBlob);
            const blob = await response.blob();
            const ext = track.mimeType ? track.mimeType.split('/')[1] : 'wav';
            audiosFolder.file(`${track.id}.${ext}`, blob);
          } catch (err) {
            if (strict) throw new Error(`saveProject(strict): audio ${track.id} fetch failed: ${err?.message ?? err}`);
            console.error(`Failed to fetch audio ${track.id}:`, err);
          }
          delete track._sourceBlob;
        })());
      }
    }
  }
  await Promise.all(audioFetches);

  // Serialize nodes: convert non-JSON types
  const serializedNodes = project.nodes.map(node => {
    const n = { ...node };
    if (n.mesh) {
      n.mesh = {
        ...n.mesh,
        uvs: Array.from(n.mesh.uvs),
        edgeIndices: Array.from(n.mesh.edgeIndices),
        // Explicitly preserve skinning data (boneWeights + jointBoneId).
        // The spread should already copy them, but immer proxies can sometimes
        // omit dynamically-added properties — be explicit to be safe.
        ...(n.mesh.boneWeights ? { boneWeights: Array.from(n.mesh.boneWeights) } : {}),
        ...(n.mesh.jointBoneId ? { jointBoneId: n.mesh.jointBoneId } : {}),
      };
    }
    return n;
  });

  const projectJson = {
    version: project.version,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: project.canvas,
    textures: serializedTextures,
    nodes: serializedNodes,
    actions: serializedActions,
    parameters: project.parameters ?? [],
    physics_groups: project.physics_groups ?? [],
    maskConfigs: project.maskConfigs ?? [],
    physicsRules: project.physicsRules ?? [],
    boneConfig: project.boneConfig ?? null,
    variantFadeRules: project.variantFadeRules ?? null,
    eyeClosureConfig: project.eyeClosureConfig ?? null,
    rotationDeformerConfig: project.rotationDeformerConfig ?? null,
    // GAP-011 — these four were silently dropped from the saved JSON, so any
    // user customisation that landed in them (Init Rig harvest, future warp
    // editor, autoRigConfig opt-outs) was lost on save→load. See
    // docs/PROJECT_DATA_LAYER.md (Tier 2).
    autoRigConfig: project.autoRigConfig ?? null,
    // BFA-006 Phase 6 — `faceParallax` / `bodyWarp` / `rigWarps`
    // sidetables removed; deformer state persists in `project.nodes`
    // as `type:'deformer'` entries (already part of `nodes` above).
    // The body warp's layout block stays as a tiny dedicated sidetable:
    bodyWarpLayout: project.bodyWarpLayout ?? null,
    // GAP-012 Phase A — per-mesh fingerprint captured at seed time;
    // load + reimport recompute and compare to detect stale keyforms.
    // See docs/PROJECT_DATA_LAYER.md hole I-1 + src/io/meshSignature.js.
    meshSignatures: project.meshSignatures ?? {},
    // Hole I-8: explicit "Init Rig completed at this time" marker.
    // Replaces the exporter's old heuristic that inferred seeded state
    // from `faceParallax/bodyWarp/rigWarps` field presence.
    lastInitRigCompletedAt: project.lastInitRigCompletedAt ?? null,
    // V3 Re-Rig Phase 1: per-stage refit telemetry (Record<stage, ISO ts>).
    // Empty {} means no per-stage refit has run yet.
    rigStageLastRunAt: project.rigStageLastRunAt ?? {},
  };

  // The .stretch wrapper is gzipped by JSZip; the pretty-printed
  // 2-space indent shaved zero compressed bytes but burned ~30% extra
  // CPU + allocations in JSON.stringify on big projects.
  zip.file('project.json', JSON.stringify(projectJson));
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Deserialize a .stretch ZIP file.
 *
 * Default mode: per-asset load failures (texture decode, audio
 * decode) emit `console.error` and the load continues with the
 * other assets. End-user load benefits from this — one corrupt
 * texture shouldn't kill the project open.
 *
 * Strict mode (`{ strict: true }`): the first per-asset failure
 * throws. Right for automated harnesses / CI / batch tools.
 *
 * @param {Blob|File} file - the .stretch blob from file input or fetch
 * @param {{strict?: boolean}} [opts]
 * @returns {Promise<object>}
 */
export async function loadProject(file, opts = {}) {
  const strict = opts.strict === true;
  const zip = await JSZip.loadAsync(file);

  const projectJsonStr = await zip.file('project.json').async('string');
  const project = JSON.parse(projectJsonStr);

  // Apply schema migrations before any consumer sees this project.
  // This replaces the scattered forward-compat field defaults that used
  // to live in this function and in projectStore.loadProject — they're
  // now centralised in projectMigrations.js (the v1 migration).
  migrateProject(project);

  // Restore textures in parallel: each (zip-extract → blob URL → Image)
  // chain is independent; previously this was a serial `for await` loop.
  // For 50 textures of ~1024² that's tens-of-seconds → ~one round trip.
  const images = new Map();
  await Promise.all(project.textures.map(async (tex) => {
    if (!tex.source) return;
    try {
      const pngBlob = await zip.file(tex.source).async('blob');
      const blobUrl = URL.createObjectURL(pngBlob);

      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { images.set(tex.id, img); resolve(); };
        img.onerror = reject;
        img.src = blobUrl;
      });

      tex.source = blobUrl;
    } catch (err) {
      if (strict) throw new Error(`loadProject(strict): texture ${tex.id} load failed: ${err?.message ?? err}`);
      console.error(`Failed to load texture ${tex.id}:`, err);
    }
  }));

  // Restore mesh typed data. Field defaults (blendShapes, blendShapeValues,
  // audioTracks) are now handled by migrateProject above.
  for (const node of project.nodes) {
    if (node.mesh) {
      node.mesh.uvs = new Float32Array(node.mesh.uvs);
      // edgeIndices stays as Array — partRenderer handles both Array and Set
    }
  }

  // Audio tracks in parallel — same rationale. Post-v36 the field is
  // `project.actions` (Action datablocks); older saves are migrated by
  // `migrateProject` above before we get here.
  const audioRestores = [];
  for (const action of project.actions ?? []) {
    for (const track of action.audioTracks ?? []) {
      if (track.source) {
        audioRestores.push((async () => {
          try {
            const audioBlob = await zip.file(track.source).async('blob');
            track.sourceUrl = URL.createObjectURL(audioBlob);
            delete track.source;
          } catch (err) {
            if (strict) throw new Error(`loadProject(strict): audio ${track.id} load failed: ${err?.message ?? err}`);
            console.error(`Failed to load audio ${track.id}:`, err);
            track.sourceUrl = null;
          }
        })());
      }
    }
  }
  await Promise.all(audioRestores);

  return { project, images };
}
