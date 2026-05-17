// @ts-check

/**
 * Animation Phase 5 Slice 5.S — Driver editor data module.
 *
 * Pure data layer backing the FCurveEditor's "Driver" editor surface
 * (DriverBanner expandable body). Mirrors the data half of Blender's
 * `graph_draw_driver_settings_panel`
 * (`reference/blender/source/blender/editors/space_graph/graph_buttons.cc:972-1247`),
 * with React rendering layered on top in `DriverBanner.jsx`.
 *
 * Sister architecture to `activeKeyformPanelData.js` ↔ `ActiveKeyformPanel.jsx`
 * (Slices 5.Q + 5.R) — same preflight/recipe shape, same sparse-field
 * discipline, same data/UI split.
 *
 * # Scope
 *
 * Six edits per active driver:
 *   1. **Driver type** (dropdown — 5-entry Blender enum verbatim) —
 *      Blender: `graph_buttons.cc:990` (`driver_ptr.prop("type")`).
 *   2. **Expression** (text — scripted-type only) —
 *      Blender: `graph_buttons.cc:1015` (`driver_ptr.prop("expression")`).
 *   3. **Add variable** (button) —
 *      Blender: `graph_buttons.cc:1079-1091` (`driver_add_new_variable`).
 *   4. **Remove variable** (per-row X button) —
 *      Blender: `graph_buttons.cc:1161-1173` (`driver_delete_var_cb`).
 *   5. **Variable name** (per-row text input) —
 *      Blender: `graph_buttons.cc:1139` (`dvar_ptr.prop("name")`).
 *   6. **Variable RNA path** (per-row text input — `target.rnaPath`) —
 *      Blender: `graph_buttons.cc:779` `template_path_builder` against
 *      `dtar_ptr.prop("data_path")`, for the `DVAR_TYPE_SINGLE_PROP`
 *      target. SS's `evaluateDriver` resolves the value via
 *      `evaluateRnaPath(project, target.rnaPath)` (see `driver.js:128-131`).
 *
 * # The driver-editor context resolution
 *
 * `resolveDriverEditorContext(action, fcurveId)` returns
 * `{ fcurve, driver, variables }` for the named fcurve, or `null` when
 * the fcurve doesn't exist or has no driver attached. Sister to
 * `resolveActiveKeyformContext` (Slice 5.Q/5.R) — same null-on-bad-input
 * shape.
 *
 * # Edit recipes — undo-coupled
 *
 * Each edit mutator runs inside `update(recipe)` (no `skipHistory:true`).
 * All recipes mutate the driver in place via the immer draft.
 *
 *   - **`applyEditDriverType`** — direct write to `driver.type`. Does
 *     NOT clear `driver.expression` on type-switch (matches Blender —
 *     the expression field is preserved across type toggles so a user
 *     can flip back to scripted without retyping).
 *
 *   - **`applyEditDriverExpression`** — direct write to
 *     `driver.expression`. Sparse-default '' DELETES the field per
 *     Rule №2 (matches Blender storing `expression[256] = ""` as the
 *     "no expression" state).
 *
 *   - **`applyAddDriverVariable`** — push a new `DriverVariable` onto
 *     `driver.variables[]` with a `var` / `var_001` / `var_002` …
 *     unique-name (matches `driver_add_new_variable`'s
 *     `BLI_uniquename(…, "var", '_', …)` at `fcurve_driver.cc:1029-1031`).
 *     Default type `'singleProp'`, default target `{id:'', rnaPath:''}`.
 *     Initializes `driver.variables` to `[]` if missing.
 *
 *   - **`applyRemoveDriverVariable`** — splice index out of
 *     `driver.variables[]`. No-op on out-of-bounds.
 *
 *   - **`applyEditDriverVariableName`** — direct write to
 *     `variable.name`. Does NOT auto-uniquify on every keystroke (would
 *     fight the user's input). Uniqueness enforced on subsequent
 *     "add new" calls; Blender behaves the same — name conflicts at
 *     edit-time just flag `DVAR_FLAG_INVALID_NAME` for the row, which
 *     SS surfaces as a static warning in a future slice.
 *
 *   - **`applyEditDriverVariableRnaPath`** — direct write to
 *     `variable.target.rnaPath`. Sparse-default '' is allowed (the
 *     resolver just returns 0 for unresolvable paths — see
 *     `driver.js:125-132`); we still WRITE the field so the editor
 *     reads back what the user typed.
 *
 * # Preflight readers — phantom-undo gates
 *
 * Sister to Slice 5.M/5.N/5.O/5.Q/5.R: every edit recipe has a paired
 * `would*Change` preflight that mirrors mutation logic without writes.
 * The dispatcher checks BEFORE calling `update()` so a re-commit of
 * the same value (user types existing value + Enter) doesn't burn an
 * undo slot.
 *
 * Note: `wouldAddDriverVariableChange` always returns true when the
 * driver exists (add is structural — every call materially changes the
 * variables[] array). Sister to the always-true preflights on Insert
 * Keyframe / Add F-Modifier elsewhere.
 *
 * # SS deviations from Blender
 *
 * **Deviation 1 — variable type fixed at `'singleProp'`.** Blender
 * surfaces a type dropdown per variable
 * (`graph_buttons.cc:1129` — `dvar_ptr.prop("type")`) with 5 options:
 * `DVAR_TYPE_SINGLE_PROP` / `DVAR_TYPE_ROT_DIFF` / `DVAR_TYPE_LOC_DIFF`
 * / `DVAR_TYPE_TRANSFORM_CHAN` / `DVAR_TYPE_CONTEXT_PROP`. SS's
 * `evaluateDriver` only handles singleProp (see `driver.js:51-55`
 * "Deviations from Blender"); surfacing the type dropdown with only
 * one option would be a crutch per Rule №2. The dropdown is omitted;
 * new variables default to singleProp. Closure tied to a future
 * compound-variable port.
 *
 * **Deviation 2 — variable `target.id` not surfaced.** Blender's
 * `DVAR_TYPE_SINGLE_PROP` requires both a target ID datablock
 * (`graph_buttons.cc:769` — `template_any_id`) and an RNA path
 * (`graph_buttons.cc:779` — `template_path_builder`). SS uses the
 * RNA path as the universal address (the path starts with
 * `objects["<id>"]` per `rnaPath.js:14-24` so the ID is encoded in
 * the path string); `target.id` is vestigial — written as `''` for
 * shape consistency, never read. Closure tied to a future multi-
 * datablock isolation pass (Blender keeps `id` separate so RNA paths
 * stay relative).
 *
 * **Deviation 3 — no error/warning labels in the editor body.**
 * Blender surfaces error labels at `graph_buttons.cc:1021-1067`:
 * "Python restricted for security", "Slow Python expression",
 * "ERROR: Invalid Python expression", "WARNING: Driver expression
 * may not work correctly", "ERROR: Driver is useless without any
 * inputs". SS's `evaluateDriver` returns NaN silently on bad
 * expressions and the FCurve falls back to keyform eval (see
 * `driver.js:140-145`); there's no persisted invalid-flag on the
 * ChannelDriver object today, and the empty-variables case still
 * evaluates safely (sum/min/max/avg over [] returns 0 per
 * `driver.js:150-157`). Closure tied to adding a
 * `DRIVER_FLAG_INVALID`-style status field.
 *
 * **Deviation 4 — no influence slider.** Blender's `ChannelDriver`
 * has an `influence` property (mix the driver output with the FCurve
 * value); SS's driver either fully overrides or doesn't fire (see
 * `driver.js:56-58` "Deviations from Blender"). Closure tied to
 * adding `ChannelDriver.influence` to the schema + evaluator.
 *
 * **Deviation 6 — no expression-cache invalidation hook.** Blender's
 * `driver_add_new_variable` (`fcurve_driver.cc:1037`) ends with
 * `BKE_driver_invalidate_expression(driver, false, true)`, and
 * `rna_DriverVariable_update_name` (`rna_fcurve.cc:339-352`) does the
 * same when a variable is renamed. These flush a compiled-expression
 * cache (`ChannelDriver::expr_simple` / `expr_comp`) so the next eval
 * re-parses with the updated variable set. SS's `evaluateDriver`
 * (see [driver.js](../../../anim/driver.js)) builds a fresh
 * `new Function(...)` on every call — no compiled cache exists, so
 * the invalidate hook would be a no-op. Closure tied to a future
 * compile-cache pass; until then, add/remove/rename can skip it.
 *
 * **Deviation 7 — no `use_self` toggle.** Blender's
 * `graph_draw_driver_settings_panel` surfaces a `use_self` checkbox
 * under the Scripted Expression row (`graph_buttons.cc:1016` —
 * `expr_col.prop(&driver_ptr, "use_self", …)`). Setting it exposes a
 * `self` magic identifier inside the expression bound to the
 * datablock owning the FCurve — see `DRIVER_FLAG_USE_SELF` at
 * `rna_fcurve.cc:2256-2258` + `BPY_driver_eval` for the runtime
 * binding. SS's `driver.js:128-132` resolves variables only via
 * RNA paths; there's no "owning datablock" concept exposed to the
 * sandbox. Closure tied to a future `self` binding pass.
 *
 * **Deviation 5 — no per-variable live value display.** Blender
 * shows each variable's resolved value at `graph_buttons.cc:1199-1225`
 * (`dvar.curval`). The DriverBanner's main `value` (Slice 5.D)
 * already shows the driver's final output; per-variable values
 * would require either threading `evaluateRnaPath` into the data
 * module (couples it to project state) or computing inside the
 * component (already does this for the top-level `value`). Closure
 * tied to a future "per-variable inspector" pass; the driver value
 * is the primary debug signal.
 *
 * @module v3/editors/fcurve/driverEditorData
 */

/**
 * Driver type tokens — SS uses lowercase strings, Blender uses
 * uppercase enum keys (`SCRIPTED` / `AVERAGE` / `SUM` / `MIN` / `MAX`).
 * The labels match Blender's RNA verbatim from
 * `reference/blender/source/blender/makesrna/intern/rna_fcurve.cc:2221-2227`
 * (`prop_type_items`):
 *   - DRIVER_TYPE_AVERAGE  "AVERAGE"  "Averaged Value"
 *   - DRIVER_TYPE_SUM      "SUM"      "Sum Values"
 *   - DRIVER_TYPE_PYTHON   "SCRIPTED" "Scripted Expression"
 *   - DRIVER_TYPE_MIN      "MIN"      "Minimum Value"
 *   - DRIVER_TYPE_MAX      "MAX"      "Maximum Value"
 *
 * Token mapping: SS `'scripted'` ↔ Blender SCRIPTED (DRIVER_TYPE_PYTHON),
 * SS `'avg'` ↔ Blender AVERAGE, SS `'sum'/'min'/'max'` ↔ Blender same.
 * The SS token vocabulary was set by `driver.js:71-74` before this
 * slice; we surface the Blender enum order in the dropdown.
 */
export const DRIVER_TYPES = Object.freeze([
  { token: 'avg', label: 'Averaged Value' },
  { token: 'sum', label: 'Sum Values' },
  { token: 'scripted', label: 'Scripted Expression' },
  { token: 'min', label: 'Minimum Value' },
  { token: 'max', label: 'Maximum Value' },
]);

const DRIVER_TYPE_SET = new Set(DRIVER_TYPES.map((d) => d.token));

/**
 * @typedef {{
 *   name: string,
 *   type: string,
 *   target: { id: string, rnaPath: string },
 * }} DriverVariableLike
 *
 * @typedef {{
 *   type: string,
 *   expression?: string,
 *   variables?: Array<DriverVariableLike>,
 * }} ChannelDriverLike
 *
 * @typedef {{
 *   id: string,
 *   driver?: ChannelDriverLike,
 * }} FCurveLike
 *
 * @typedef {{
 *   fcurve: FCurveLike,
 *   driver: ChannelDriverLike,
 *   variables: Array<DriverVariableLike>,
 * }} DriverEditorContext
 */

/**
 * Resolve `(fcurve, driver, variables)` for the named fcurve, or
 * `null` if no fcurve or no driver. Variables defaults to `[]` when
 * the field is missing on a driver.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @returns {DriverEditorContext|null}
 */
export function resolveDriverEditorContext(action, fcurveId) {
  if (!action || typeof fcurveId !== 'string') return null;
  const fcurves = Array.isArray(action.fcurves) ? action.fcurves : null;
  if (!fcurves) return null;
  const fcurve = fcurves.find((f) => f && f.id === fcurveId);
  if (!fcurve || !fcurve.driver) return null;
  const driver = fcurve.driver;
  const variables = Array.isArray(driver.variables) ? driver.variables : [];
  return { fcurve, driver, variables };
}

// ── Driver type ──────────────────────────────────────────────────────

/**
 * Preflight for {@link applyEditDriverType}. Returns true iff calling
 * the mutator with `newType` would change `driver.type`. Unknown types
 * short-circuit to false (don't burn an undo on garbage input).
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {string} newType
 * @returns {boolean}
 */
export function wouldEditDriverTypeChange(action, fcurveId, newType) {
  if (!DRIVER_TYPE_SET.has(newType)) return false;
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return false;
  return ctx.driver.type !== newType;
}

/**
 * Apply a type edit to the active driver. Direct write to
 * `driver.type`. Does NOT clear `driver.expression` — matches Blender
 * where the expression buffer is preserved across type toggles
 * (`graph_draw_driver_settings_panel` re-renders the expression row
 * via `if (driver->type == DRIVER_TYPE_PYTHON)` gate at `graph_buttons.cc:1006`
 * without wiping the underlying field).
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {string} newType
 * @returns {{ changed: boolean }}
 */
export function applyEditDriverType(action, fcurveId, newType) {
  if (!DRIVER_TYPE_SET.has(newType)) return { changed: false };
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return { changed: false };
  if (ctx.driver.type === newType) return { changed: false };
  ctx.driver.type = newType;
  return { changed: true };
}

// ── Expression ───────────────────────────────────────────────────────

/**
 * Preflight for {@link applyEditDriverExpression}. Returns true iff
 * calling the mutator with `newExpr` would change `driver.expression`.
 * Sparse-tolerance: missing field collapses to `''` for the comparison.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {string} newExpr
 * @returns {boolean}
 */
export function wouldEditDriverExpressionChange(action, fcurveId, newExpr) {
  if (typeof newExpr !== 'string') return false;
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return false;
  const current = typeof ctx.driver.expression === 'string' ? ctx.driver.expression : '';
  return current !== newExpr;
}

/**
 * Apply an expression edit. Sparse-default `''` DELETES the field
 * (matches Blender's "empty expression" state where the buffer is
 * just a zero-terminated empty string). Writing the same value as
 * the current is a no-op (preflight handles this earlier).
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {string} newExpr
 * @returns {{ changed: boolean }}
 */
export function applyEditDriverExpression(action, fcurveId, newExpr) {
  if (typeof newExpr !== 'string') return { changed: false };
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return { changed: false };
  const current = typeof ctx.driver.expression === 'string' ? ctx.driver.expression : '';
  if (current === newExpr) return { changed: false };
  if (newExpr === '') {
    delete ctx.driver.expression;
  } else {
    ctx.driver.expression = newExpr;
  }
  return { changed: true };
}

// ── Variables — add / remove ─────────────────────────────────────────

/**
 * Compute the next unique variable name for the given list. Mirrors
 * Blender's `BLI_uniquename(&driver->variables, dvar, "var", '_', …)`
 * at `fcurve_driver.cc:1029-1031`: starts at `"var"`, then `"var_001"`,
 * `"var_002"`, … skipping any existing names. The leading zero-pad
 * width matches Blender's `BLI_uniquename` `_NNN` convention.
 *
 * @param {Array<{name?: string}>} variables
 * @returns {string}
 */
export function nextVariableName(variables) {
  const taken = new Set();
  for (const v of variables) {
    if (v && typeof v.name === 'string') taken.add(v.name);
  }
  if (!taken.has('var')) return 'var';
  for (let i = 1; i < 1000; i++) {
    const candidate = `var_${String(i).padStart(3, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `var_${Date.now()}`; // pathological-overflow escape — 999 vars
}

/**
 * Preflight for {@link applyAddDriverVariable}. Returns true when the
 * driver exists (every add materially mutates `variables[]`).
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @returns {boolean}
 */
export function wouldAddDriverVariableChange(action, fcurveId) {
  return !!resolveDriverEditorContext(action, fcurveId);
}

/**
 * Add a new variable to the active driver. Push a singleProp variable
 * with a unique `var` / `var_NNN` name and an empty target.
 *
 * Initializes `driver.variables` to `[]` if missing — sparse-tolerance.
 *
 * Mirrors `driver_add_new_variable` (`fcurve_driver.cc:1012-1041`):
 *   1. Allocate variable
 *   2. Append to `driver->variables` ListBase
 *   3. Set default name (uniquified)
 *   4. Set default type SINGLE_PROP
 *
 * @param {object} action
 * @param {string} fcurveId
 * @returns {{ changed: boolean, index: number, name: string }}
 */
export function applyAddDriverVariable(action, fcurveId) {
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return { changed: false, index: -1, name: '' };
  if (!Array.isArray(ctx.driver.variables)) {
    ctx.driver.variables = [];
  }
  const name = nextVariableName(ctx.driver.variables);
  const variable = {
    name,
    type: 'singleProp',
    target: { id: '', rnaPath: '' },
  };
  ctx.driver.variables.push(variable);
  return { changed: true, index: ctx.driver.variables.length - 1, name };
}

/**
 * Preflight for {@link applyRemoveDriverVariable}. Returns true iff
 * the index points to a real variable.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {number} idx
 * @returns {boolean}
 */
export function wouldRemoveDriverVariableChange(action, fcurveId, idx) {
  if (!Number.isInteger(idx) || idx < 0) return false;
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return false;
  return idx < ctx.variables.length;
}

/**
 * Remove variable at `idx`. No-op on out-of-bounds.
 *
 * Mirrors `driver_delete_var_cb` (`graph_buttons.cc:674-680`) which
 * calls `driver_free_variable_ex(driver, dvar)` — that frees the
 * DriverVar struct and removes it from the ListBase. SS just splices
 * the array entry.
 *
 * Audit-fix HIGH-A1 (Slice 5.S dual-audit 2026-05-17): bounds-check
 * uses `ctx.variables.length` (the normalized alias from
 * `resolveDriverEditorContext` that defaults to `[]` on missing
 * `driver.variables`) — the original code read
 * `ctx.driver.variables.length` directly, which would crash on a
 * sparse driver lacking a `variables` field if the preflight were
 * bypassed. Same fix applied to `applyEditDriverVariableName` and
 * `applyEditDriverVariableRnaPath`.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {number} idx
 * @returns {{ changed: boolean }}
 */
export function applyRemoveDriverVariable(action, fcurveId, idx) {
  if (!Number.isInteger(idx) || idx < 0) return { changed: false };
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return { changed: false };
  if (idx >= ctx.variables.length) return { changed: false };
  ctx.driver.variables.splice(idx, 1);
  return { changed: true };
}

// ── Variables — per-row name + rnaPath ───────────────────────────────

/**
 * Preflight for {@link applyEditDriverVariableName}. Returns true iff
 * the index points to a real variable AND the name differs.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {number} idx
 * @param {string} newName
 * @returns {boolean}
 */
export function wouldEditDriverVariableNameChange(action, fcurveId, idx, newName) {
  if (typeof newName !== 'string') return false;
  if (!Number.isInteger(idx) || idx < 0) return false;
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return false;
  if (idx >= ctx.variables.length) return false;
  const v = ctx.variables[idx];
  const current = typeof v?.name === 'string' ? v.name : '';
  return current !== newName;
}

/**
 * Apply a variable-name edit. Direct write to `variable.name`. Does
 * NOT auto-uniquify on every keystroke — would fight the user's input.
 * Uniqueness is enforced only by {@link applyAddDriverVariable}; name
 * conflicts at edit-time just shadow each other in
 * `driver.js:resolveVariables` (last-write-wins on the `out` map).
 * Matches Blender's `dvar_ptr.prop("name")` direct write
 * (`graph_buttons.cc:1139`); Blender flags `DVAR_FLAG_INVALID_NAME`
 * for display only — the underlying buffer is set verbatim.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {number} idx
 * @param {string} newName
 * @returns {{ changed: boolean }}
 */
export function applyEditDriverVariableName(action, fcurveId, idx, newName) {
  if (typeof newName !== 'string') return { changed: false };
  if (!Number.isInteger(idx) || idx < 0) return { changed: false };
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return { changed: false };
  if (idx >= ctx.variables.length) return { changed: false };
  const v = ctx.driver.variables[idx];
  const current = typeof v.name === 'string' ? v.name : '';
  if (current === newName) return { changed: false };
  v.name = newName;
  return { changed: true };
}

/**
 * Preflight for {@link applyEditDriverVariableRnaPath}. Returns true
 * iff the index points to a real variable AND the rnaPath differs.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {number} idx
 * @param {string} newPath
 * @returns {boolean}
 */
export function wouldEditDriverVariableRnaPathChange(action, fcurveId, idx, newPath) {
  if (typeof newPath !== 'string') return false;
  if (!Number.isInteger(idx) || idx < 0) return false;
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return false;
  if (idx >= ctx.variables.length) return false;
  const v = ctx.variables[idx];
  const current = typeof v?.target?.rnaPath === 'string' ? v.target.rnaPath : '';
  return current !== newPath;
}

/**
 * Apply a variable rnaPath edit. Direct write to
 * `variable.target.rnaPath`. Initializes `variable.target` to
 * `{id:'', rnaPath:''}` if missing — sparse-tolerance.
 *
 * Mirrors `template_path_builder(&col, &dtar_ptr, "data_path", …)`
 * at `graph_buttons.cc:779` for `DVAR_TYPE_SINGLE_PROP`.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {number} idx
 * @param {string} newPath
 * @returns {{ changed: boolean }}
 */
export function applyEditDriverVariableRnaPath(action, fcurveId, idx, newPath) {
  if (typeof newPath !== 'string') return { changed: false };
  if (!Number.isInteger(idx) || idx < 0) return { changed: false };
  const ctx = resolveDriverEditorContext(action, fcurveId);
  if (!ctx) return { changed: false };
  if (idx >= ctx.variables.length) return { changed: false };
  const v = ctx.driver.variables[idx];
  if (!v.target || typeof v.target !== 'object') {
    v.target = { id: '', rnaPath: '' };
  }
  const current = typeof v.target.rnaPath === 'string' ? v.target.rnaPath : '';
  if (current === newPath) return { changed: false };
  v.target.rnaPath = newPath;
  return { changed: true };
}
