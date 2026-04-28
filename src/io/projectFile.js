import JSZip from 'jszip';
import { CURRENT_SCHEMA_VERSION, migrateProject } from '../store/projectMigrations.js';

/**
 * Serialize the current project to a .stretch ZIP file.
 * @param {object} project — projectStore.project snapshot
 * @returns {Promise<Blob>} ZIP blob ready for download
 */
export async function saveProject(project) {
  const zip = new JSZip();
  const texturesFolder = zip.folder('textures');
  const audiosFolder = zip.folder('audios');

  // Serialize textures: fetch blob URL → store as PNG files
  const serializedTextures = [];
  for (const tex of project.textures) {
    try {
      const response = await fetch(tex.source);
      const blob = await response.blob();
      texturesFolder.file(`${tex.id}.png`, blob);
      serializedTextures.push({ id: tex.id, source: `textures/${tex.id}.png` });
    } catch (err) {
      console.error(`Failed to fetch texture ${tex.id}:`, err);
      serializedTextures.push({ id: tex.id, source: '' });
    }
  }

  // Serialize audio tracks: fetch blob URL → store in audios/ folder
  const serializedAnimations = project.animations.map(anim => ({
    ...anim,
    audioTracks: (anim.audioTracks ?? []).map(track => {
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

  // Async fetch of audio blobs and add to zip
  for (const anim of serializedAnimations) {
    for (const track of anim.audioTracks) {
      if (track._sourceBlob) {
        try {
          const response = await fetch(track._sourceBlob);
          const blob = await response.blob();
          const ext = track.mimeType ? track.mimeType.split('/')[1] : 'wav';
          audiosFolder.file(`${track.id}.${ext}`, blob);
        } catch (err) {
          console.error(`Failed to fetch audio ${track.id}:`, err);
        }
        delete track._sourceBlob;
      }
    }
  }

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
    animations: serializedAnimations,
    parameters: project.parameters ?? [],
    physics_groups: project.physics_groups ?? [],
    maskConfigs: project.maskConfigs ?? [],
    physicsRules: project.physicsRules ?? [],
    boneConfig: project.boneConfig ?? null,
    variantFadeRules: project.variantFadeRules ?? null,
    eyeClosureConfig: project.eyeClosureConfig ?? null,
    rotationDeformerConfig: project.rotationDeformerConfig ?? null,
  };

  zip.file('project.json', JSON.stringify(projectJson, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Deserialize a .stretch ZIP file.
 * @param {Blob|File} file - the .stretch blob from file input or fetch
 * @returns {Promise<object>}
 */
export async function loadProject(file) {
  const zip = await JSZip.loadAsync(file);

  const projectJsonStr = await zip.file('project.json').async('string');
  const project = JSON.parse(projectJsonStr);

  // Apply schema migrations before any consumer sees this project.
  // This replaces the scattered forward-compat field defaults that used
  // to live in this function and in projectStore.loadProject — they're
  // now centralised in projectMigrations.js (the v1 migration).
  migrateProject(project);

  // Restore textures: load PNGs from zip → create blob URLs + Image elements
  const images = new Map();
  for (const tex of project.textures) {
    if (!tex.source) continue;
    try {
      const pngBlob = await zip.file(tex.source).async('blob');
      const blobUrl = URL.createObjectURL(pngBlob);

      // Wait for image to load
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          images.set(tex.id, img);
          resolve();
        };
        img.onerror = reject;
        img.src = blobUrl;
      });

      tex.source = blobUrl;
    } catch (err) {
      console.error(`Failed to load texture ${tex.id}:`, err);
    }
  }

  // Restore mesh typed data. Field defaults (blendShapes, blendShapeValues,
  // audioTracks) are now handled by migrateProject above.
  for (const node of project.nodes) {
    if (node.mesh) {
      node.mesh.uvs = new Float32Array(node.mesh.uvs);
      // edgeIndices stays as Array — partRenderer handles both Array and Set
    }
  }

  // Restore audio tracks: load from zip → create blob URLs
  for (const anim of project.animations) {
    for (const track of anim.audioTracks) {
      if (track.source) {
        try {
          const audioBlob = await zip.file(track.source).async('blob');
          track.sourceUrl = URL.createObjectURL(audioBlob);
          delete track.source;
        } catch (err) {
          console.error(`Failed to load audio ${track.id}:`, err);
          track.sourceUrl = null;
        }
      }
    }
  }

  return { project, images };
}
