// @ts-check

/**
 * v3 Phase 4F — Export validation pre-flight.
 *
 * Pure project → `{errors, warnings}` checker. Errors block the
 * export; warnings let the user override with "Export anyway". The
 * checks deliberately stay light — anything heavier (schema diff vs.
 * Cubism reference, autoRig dry-run) belongs in the Phase 4A parity
 * harness, not in the export modal.
 *
 * Each issue carries:
 *   - `code`     — stable enum so future i18n / docs can target it
 *   - `level`    — 'error' | 'warning'
 *   - `message`  — short human-readable summary
 *   - `nodeId`   — optional id of the offending node, for click-to-jump
 *
 * @module io/exportValidation
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {string} code
 * @property {'error'|'warning'} level
 * @property {string} message
 * @property {string} [nodeId]
 *
 * @typedef {Object} ValidationResult
 * @property {ValidationIssue[]} errors
 * @property {ValidationIssue[]} warnings
 */

/**
 * Run all preflight checks. Safe to call on a partially-loaded
 * project — every walk no-ops on missing arrays. Returns issues
 * grouped by severity.
 *
 * @param {any} project
 * @returns {ValidationResult}
 */
export function validateProjectForExport(project) {
  /** @type {ValidationIssue[]} */
  const errors = [];
  /** @type {ValidationIssue[]} */
  const warnings = [];

  if (!project || typeof project !== 'object') {
    errors.push({ code: 'PROJECT_MISSING', level: 'error', message: 'Project state is empty.' });
    return { errors, warnings };
  }

  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const parts = nodes.filter((n) => n?.type === 'part');
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  if (parts.length === 0) {
    errors.push({
      code: 'NO_PARTS',
      level: 'error',
      message: 'Project has no parts. Import a PSD or add geometry before exporting.',
    });
  }

  // ── Per-part geometry checks ─────────────────────────────────────
  for (const p of parts) {
    if (!p.mesh || !Array.isArray(p.mesh.vertices) || p.mesh.vertices.length < 3) {
      errors.push({
        code: 'PART_NO_MESH',
        level: 'error',
        message: `"${p.name ?? p.id}" has no mesh — re-run mesh generation in the Mesh tab.`,
        nodeId: p.id,
      });
      continue;
    }
    if (!Array.isArray(p.mesh.triangles) || p.mesh.triangles.length === 0) {
      errors.push({
        code: 'PART_NO_TRIS',
        level: 'error',
        message: `"${p.name ?? p.id}" mesh has no triangles.`,
        nodeId: p.id,
      });
    }
    if (!p.mesh.uvs || p.mesh.uvs.length !== p.mesh.vertices.length) {
      warnings.push({
        code: 'PART_UV_LENGTH',
        level: 'warning',
        message: `"${p.name ?? p.id}" UV count doesn't match vertex count — texture mapping may drift.`,
        nodeId: p.id,
      });
    }
    if (!p.textureId && !p.mesh.textureId) {
      warnings.push({
        code: 'PART_NO_TEXTURE',
        level: 'warning',
        message: `"${p.name ?? p.id}" has no texture binding.`,
        nodeId: p.id,
      });
    }
  }

  // ── Parent integrity ─────────────────────────────────────────────
  for (const n of nodes) {
    if (n.parent && !nodeById.has(n.parent)) {
      errors.push({
        code: 'ORPHAN_PARENT',
        level: 'error',
        message: `"${n.name ?? n.id}" references missing parent ${n.parent}.`,
        nodeId: n.id,
      });
    }
  }

  // ── Mask integrity ────────────────────────────────────────────────
  const maskConfigs = Array.isArray(project.maskConfigs) ? project.maskConfigs : [];
  for (const cfg of maskConfigs) {
    if (cfg.maskedMeshId && !nodeById.has(cfg.maskedMeshId)) {
      warnings.push({
        code: 'MASK_TARGET_MISSING',
        level: 'warning',
        message: `Mask config references missing masked mesh ${cfg.maskedMeshId}.`,
      });
    }
    for (const mid of cfg.maskMeshIds ?? []) {
      if (!nodeById.has(mid)) {
        warnings.push({
          code: 'MASK_MESH_MISSING',
          level: 'warning',
          message: `Mask config references missing mask mesh ${mid}.`,
        });
      }
    }
  }

  // ── Variant integrity ─────────────────────────────────────────────
  for (const n of nodes) {
    if (n?.variantOf) {
      const base = nodeById.get(n.variantOf);
      if (!base) {
        warnings.push({
          code: 'VARIANT_BASE_MISSING',
          level: 'warning',
          message: `Variant "${n.name ?? n.id}" references missing base ${n.variantOf}.`,
          nodeId: n.id,
        });
      }
    }
  }

  // ── Parameters ───────────────────────────────────────────────────
  const parameters = Array.isArray(project.parameters) ? project.parameters : [];
  for (const p of parameters) {
    if (typeof p?.min !== 'number' || typeof p?.max !== 'number' || p.min >= p.max) {
      warnings.push({
        code: 'PARAM_BAD_RANGE',
        level: 'warning',
        message: `Parameter "${p?.name ?? p?.id}" has invalid min/max range.`,
      });
    }
  }
  if (parameters.length === 0 && parts.length > 0) {
    warnings.push({
      code: 'NO_PARAMETERS',
      level: 'warning',
      message: 'Project has parts but no parameters — exported model will have nothing to drive.',
    });
  }

  // ── Textures referenced by parts must exist ───────────────────────
  const textures = Array.isArray(project.textures) ? project.textures : [];
  const textureIds = new Set(textures.map((t) => t.id));
  for (const p of parts) {
    const tid = p.textureId ?? p.mesh?.textureId;
    if (tid && !textureIds.has(tid)) {
      errors.push({
        code: 'TEXTURE_MISSING',
        level: 'error',
        message: `"${p.name ?? p.id}" references missing texture ${tid}.`,
        nodeId: p.id,
      });
    }
  }

  // ── Animations: empty motion3 export = silent failure ────────────
  for (const a of project.animations ?? []) {
    if (!Array.isArray(a.tracks) || a.tracks.length === 0) {
      warnings.push({
        code: 'ANIM_EMPTY',
        level: 'warning',
        message: `Animation "${a.name ?? a.id}" has no tracks.`,
      });
    }
  }

  return { errors, warnings };
}
