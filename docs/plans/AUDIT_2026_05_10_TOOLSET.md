# Toolset Blender-Parity Plan — Independent Audit

Date:     2026-05-10
Auditor:  Claude Opus 4.7 (independent read; no prior-session context)
Scope:    Toolset Plan Phases 0 + 1 (the only phases marked SHIPPED in the
          progress docs).
Source:   docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md (REFINED v2)
          docs/plans/TOOLSET_PHASE_0_PROGRESS.md
          docs/plans/TOOLSET_PHASE_1_PROGRESS.md
Commits:  Phase 0 = `4a59d62` (16 files, +1434 LOC)
          Phase 1 = `f7fba11` (14 files, +1833 LOC)
Method:   Re-read each plan section bullet-by-bullet, verified against the
          actual code via Read / Grep / running the test files. Did NOT
          trust progress-doc summaries — every claim re-checked at source.

---

## TL;DR — Verdict by sub-phase

| Sub  | Plan §                                | Verdict |
|------|---------------------------------------|---------|
| 0.A  | store slot + actions                  | ⚠️ partial — 3 plan-named read helpers MISSING (`isVertexSelected`, `getSelectedVertexCount`, `getAllSelectedVertices`); progress-doc claim "Nine actions" is wrong (there are 8). 2 actions added beyond plan (`setVertexSelectionForPart`, `invalidateVertexSelectionForPart`). |
| 0.B  | hit-test + BFS + dispatch             | ✅ shipped — BFS shortest-path on `buildVertexAdjacency` is wired; threshold `6/zoom` matches plan; `hitTestVertices` API signature differs from plan (per-part not per-project) but is a sensible refinement. ⚠️ minor: Edit-Mode Ctrl+LMB-drag from EMPTY canvas does NOT open the lasso modal — see §Phase 1.B Gap 5. |
| 0.C  | KeyA / Alt+KeyA mode-aware            | ✅ shipped — both operators registered, mode-aware branch matches plan exactly. Minor lint: `available` field omitted (consistency with sibling `selection.clear`). |
| 0.D  | VertexSelectionOverlay mounted        | ✅ shipped — colours match plan (HSL 25 95% 55% selected, 60% white unselected, white-bordered active), mount in CanvasArea correct, read-only with `pointerEvents: 'none'`. |
| 0.E  | default toolMode flip + T-panel       | ✅ shipped — `enterEditMode('edit')` defaults to `'select'` (sticky `lastToolByMode` respected), Select is FIRST entry in `TOOLS_BY_MODE.mesh`. |
| 0.F  | persistence + invalidation            | ⚠️ partial — Edit↔Pose preserves; exitEditMode + setSelection clear; add_vertex / remove_vertex paths invalidate. **MISSING: `dispatchMeshWorker` → `setMesh` path (CanvasViewport.jsx:1528) replaces topology without invalidating.** |
| 0.G  | 4 test files / 79 assertions          | ✅ shipped — file names match plan; 28+11+9+31 = 79 assertions; tests pass. |
| 0.H  | manual exit gate                      | ⏳ user-pending (not part of this audit) |
| 1.A  | boxSelect operator + B chord          | ⚠️ partial — operator registered, B keymap wired, modifiers Shift=add / Ctrl=subtract / default=replace work for box. **MISSING: mid-drag `A` "select all under" toggle** explicitly named in plan §1.A. |
| 1.B  | Lasso (Ctrl+LMB-drag)                 | ⚠️ partial — gesture wired, BFS click-fallback preserved, even-odd polygon test (plan said "winding number" but Blender itself uses even-odd; SS aligns with Blender, diverges from plan text). **MISSING: `selection.lassoSelect` operator (plan §1.B explicitly names it).** **BUG: Lasso commit ALWAYS reads ctrlKey on release → modifier defaults to `subtract` (Ctrl was held to start the gesture). Replace + add via Shift work; pure-replace lasso is unreachable.** **GAP: Edit-Mode Ctrl+LMB-drag from empty canvas does not open lasso (deselect-all branch swallows it).** |
| 1.C  | quadtree optimization                 | ⏳ DEFERRED (clean — plan listed it as 1.C but did NOT make it part of Phase 1 exit gate; deferral is acceptable per Rule №2 since current O(n) is fine for Live2D mesh sizes). |
| 1.D  | BoxSelectOverlay + LassoSelectOverlay | ⚠️ partial — single `BoxSelectOverlay.jsx` handles both kinds (plan asked for two separate files). **DIVERGENCE: plan §1.D says `pointer-events: all`; shipped uses `pointer-events: none` + window-level event listeners.** Both divergences are arguably architectural improvements but unannounced. |
| 1.E  | 4 test files / 65 assertions          | ✅ shipped — file names match, 13+13+20+19 = 65 assertions, all pass. |
| 1.F  | manual exit gate                      | ⏳ user-pending |

**Bottom line:** Phases 0 and 1 are largely shipped but with 1 missing-feature bug in lasso modifier handling, 1 missing topology-invalidation hook (`dispatchMeshWorker`), 3 missing read-only store helpers, 1 missing mid-drag chord, and several documentation/comment inaccuracies. None are blockers for daily use; all are addressable in a small follow-up commit.

---

## Phase 0 — Vertex selection model

### Sub-phase 0.A — `editorStore.selectedVertexIndices` + actions

**Plan §0.A bullets (per docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md:309-325):**

| Plan bullet                                                  | Verdict | Evidence |
|--------------------------------------------------------------|---------|----------|
| `selectedVertexIndices: Map<partId, Set<number>>`            | ✅      | src/store/editorStore.js:232 |
| `selectVertex(partId, vertIndex, additive=false)`            | ✅      | src/store/editorStore.js:526-539 |
| `deselectVertex(partId, vertIndex)`                          | ✅      | src/store/editorStore.js:544-558 |
| `toggleVertexSelection(partId, vertIndex)`                   | ✅      | src/store/editorStore.js:563-582 |
| `selectAllVertices(partId)`                                  | ✅      | src/store/editorStore.js:604-612 (signature is `(partId, vertCount)` — caller passes count, dependency-free of project state; sensible refinement) |
| `deselectAllVertices(partId)`                                | ✅      | src/store/editorStore.js:616-624 |
| `clearAllVertexSelections()`                                 | ✅      | src/store/editorStore.js:628-631 |
| `isVertexSelected(partId, vertIndex) → boolean`              | ❌      | NOT in editorStore.js. Grep confirms zero references anywhere in the codebase. |
| `getSelectedVertexCount(partId) → number`                    | ❌      | Same — missing entirely. |
| `getAllSelectedVertices(partId) → number[]`                  | ❌      | Same — missing entirely. |
| `activeVertex` slot (Blender "active element")               | ✅ extra | src/store/editorStore.js:240 — added beyond plan, paired with the white-bordered active mark in the overlay (plan only mentioned active in §0.D render; the slot itself is post-plan). |
| `setVertexSelectionForPart(partId, vertIndices)`             | ✅ extra | src/store/editorStore.js:587-599 — added beyond plan, used by box / lasso commit. |
| `invalidateVertexSelectionForPart(partId)`                   | ✅ extra | src/store/editorStore.js:638-646 — added beyond plan, used by topology-change hooks. |

**Discrepancy with progress doc.** Phase 0 progress doc claims "Nine actions mirror Blender's Edit Mode operator set" and lists 8 names (the count even disagrees with the prose). The actual count of writer actions is **8**: select / deselect / toggle / set / selectAll / deselectAll / clearAll / invalidate. The 3 read-only helpers from the plan are not implemented.

**Severity.** Low: the read-only helpers are convenience wrappers any caller can construct via `editor.selectedVertexIndices.get(partId)?.has(idx)`, etc. But they're a Rule №2 violation in the opposite direction — the plan promised them; not shipping without removing from the plan leaves dangling spec.

### Sub-phase 0.B — Click semantics + hit-test + BFS

**Plan §0.B bullets (lines 327-340):**

| Plan bullet                                                                                                              | Verdict | Evidence |
|--------------------------------------------------------------------------------------------------------------------------|---------|----------|
| LMB on vertex → replace                                                                                                  | ✅      | src/components/canvas/CanvasViewport.jsx:2299-2304 (calls `selectVertex(partId, idx, /* additive */ false)`) |
| Shift+LMB → toggle                                                                                                       | ✅      | src/components/canvas/CanvasViewport.jsx:2299-2302 (`if (e.shiftKey) toggleVertexSelection`) |
| **Ctrl+LMB → topology shortest-path via BFS on `buildVertexAdjacency`** (audit-HIGH from v2)                             | ✅      | src/components/canvas/CanvasViewport.jsx:2273-2289 (`onClickFallback` calls `shortestPathBetweenVertices(adj, av.vertIndex, clickedIdx)`). NOT spatial-nearest. Verified the helper exists at src/io/hitTest.js:383-415. |
| LMB on empty space → deselect all                                                                                        | ✅      | src/components/canvas/CanvasViewport.jsx:2255-2261 |
| `hitTestVertices(parts, point, threshold) → {partId, vertIndex} \| null` plan signature                                  | ⚠️ diverged | Shipped: `hitTestVertices(verts, worldX, worldY, threshold) → number` at src/io/hitTest.js:289. Per-part input (caller supplies the active part's verts), returns vertex index. Refinement makes sense (caller knows the part), but signature diverges from plan. |
| **Threshold = 6px scaled by zoom (matches Blender's vertex pick threshold)**                                             | ✅      | src/components/canvas/CanvasViewport.jsx:2246 (`const threshold = 6 / view.zoom;`) |

**Cross-check against Blender reference (per RULE: Blender source is source of truth).** Verified Blender's `mesh.shortest_path_pick` (via `reference/blender/source/blender/editors/mesh/editmesh_select.cc`) — BFS topology distance is correct.

**Minor wart.** Line 2263 enters the Ctrl branch unconditionally on Ctrl+LMB; doesn't filter `!e.shiftKey`. Shift+Ctrl+LMB on a vertex therefore runs the BFS path AND the Shift modifier never reaches the toggle line at 2299-2300. Inconsistent with Object Mode's Ctrl+LMB lasso candidate at line 2454, which DOES filter `&& !e.shiftKey`. Low severity (Shift+Ctrl+LMB has no documented meaning in Blender either).

### Sub-phase 0.C — `A` / `Alt+A` keymap

**Plan §0.C bullets (lines 342-347):**

| Plan bullet                                          | Verdict | Evidence |
|------------------------------------------------------|---------|----------|
| `A` toggles select-all/none scoped to active part    | ✅      | src/v3/keymap/default.js:64 binds `KeyA` → `selection.selectAllToggle`; src/v3/operators/registry.js:173-212 has the mode-aware branch (lines 178-196) for Edit Mode + select tool. |
| `Alt+A` deselects all                                | ✅      | src/v3/keymap/default.js:69 binds `Alt+KeyA` → `selection.deselectAll`; src/v3/operators/registry.js:218-237 has the mode-aware branch. |

**Lint findings:**
- Both new operators omit the `available` field (defaults to true). Sibling `selection.clear` (line 153-161) DOES gate by selection-non-empty. Inconsistent style; functionally fine because both new operators internally no-op when there's nothing to do.
- `selection.deselectAll` description in the operator registry says "mirrors Escape but matches Blender muscle memory" — accurate.

### Sub-phase 0.D — `VertexSelectionOverlay` mount

**Plan §0.D bullets (lines 349-355):**

| Plan bullet                                                              | Verdict | Evidence |
|--------------------------------------------------------------------------|---------|----------|
| Selected: orange (HSL 25 95% 55%)                                        | ✅      | src/v3/editors/viewport/overlays/VertexSelectionOverlay.jsx:96 (`fill="hsl(25 95% 55%)"` r=4) |
| Unselected: white (HSL 0 0% 100% at 60% alpha)                           | ✅      | VertexSelectionOverlay.jsx:108-115 (white r=2.2, fillOpacity 0.6) |
| Active: white-bordered orange dot                                        | ✅      | VertexSelectionOverlay.jsx:119-130 (orange r=5.5, white stroke 1.6) |
| File path `VertexSelectionOverlay.jsx`                                   | ✅      | Created at src/v3/editors/viewport/overlays/VertexSelectionOverlay.jsx (143 lines). |
| Mounted in `CanvasArea`                                                  | ✅      | src/v3/shell/CanvasArea.jsx:125 (gated `!isPreview`). |
| Read-only / pointer events pass through                                  | ✅      | VertexSelectionOverlay.jsx:135 (`pointerEvents: 'none'`). |

Bonus: stable EMPTY_ARRAY at line 37 prevents infinite-loop-via-getSnapshot (per `feedback_filter_in_selector` memory entry). Good defensive pattern.

### Sub-phase 0.E — Default + T-panel

**Plan §0.E bullets (lines 357-369):**

| Plan bullet                                                              | Verdict | Evidence |
|--------------------------------------------------------------------------|---------|----------|
| Default `toolMode` for Edit Mode flips from `'brush'` → `'select'`        | ✅      | src/store/editorStore.js:362 (`if (kind === 'edit') toolMode = 'select';`). Sticky `lastToolByMode` overrides preserved at line 354-356. |
| T-panel Edit Mode tool list adds Select as **first** entry                | ✅      | src/v3/shell/canvasToolbar/tools.js:111-152 — `mesh` array order: select, brush, add_vertex, remove_vertex (matches plan order verbatim). |
| Brush remains for "soft modify"                                          | ✅      | tools.js:123-130 |

Minor terminology drift: tools.js still keys the table by `'mesh'` (TOOLS_BY_MODE.mesh) and `toolsFor()` resolves `editMode === 'edit'` → `TOOLS_BY_MODE.mesh`. Functionally correct but the legacy mode name lingers in this file (the rest of the codebase has migrated to `'edit'`). Pre-existing, not introduced by this phase.

### Sub-phase 0.F — Mode-switch persistence + invalidation

**Plan §0.F bullets (lines 371-379):**

| Plan bullet                                                              | Verdict | Evidence |
|--------------------------------------------------------------------------|---------|----------|
| Selection preserved across Edit↔Pose                                     | ✅      | Direct `setState({ editMode: 'pose' })` doesn't touch selectedVertexIndices. Test `test_vertexSelection_persistence.mjs` Test 1 passes. |
| Cleared on leaving Edit Mode for Object Mode (`exitEditMode`)            | ✅      | src/store/editorStore.js:420-423 |
| Cleared on switching active part                                         | ✅      | src/store/editorStore.js:310-314 (`setSelection` head-change resets the Map) |
| Cleared on mesh topology change                                          | ⚠️ PARTIAL | Wired in 2 paths (`add_vertex` line 2339; `remove_vertex` line 2381). **NOT wired in `dispatchMeshWorker` path (line 1528).** |

**Topology-change paths in CanvasViewport that DO mutate `mesh.vertices`:**

| Path                                                | Invalidates? | File:line |
|-----------------------------------------------------|--------------|-----------|
| `add_vertex` toolMode click                         | ✅ yes       | CanvasViewport.jsx:2339 |
| `remove_vertex` toolMode click                      | ✅ yes       | CanvasViewport.jsx:2381 |
| **`dispatchMeshWorker` → `setMesh(node, ..., proj)`** | ❌ NO        | CanvasViewport.jsx:1528 |

The `dispatchMeshWorker` path is triggered by:
- `remeshPart()` — Properties → MeshTab regeneration (CanvasViewport.jsx:1569; published via captureStore.remeshPart at line 1589)
- Any auto-remesh triggered by mesh-spec changes

After a remesh, vertex count and indexing may change completely. A stale `selectedVertexIndices` set will point at random vertices. **This is a Rule №2 / Phase 0.F gap.**

**Other vertex mutation paths checked (no invalidation needed — these don't change topology):**
- `proportionalEdit.js` — moves `vertices[i].x/y` only, indices stable (per the comment at src/lib/proportionalEdit.js:90-99). Confirmed.
- Brush dragging — same, position-only.

### Sub-phase 0.G — Tests

**Plan §0.G bullets (lines 381-387):**

| Plan-named test file                                | Shipped? | Assertions |
|-----------------------------------------------------|----------|------------|
| `test_vertexSelection_basic.mjs`                    | ✅       | 28 (`grep -c "  assert(" …`) |
| `test_vertexSelection_persistence.mjs`              | ✅       | 11 |
| `test_vertexSelection_invalidation.mjs`             | ✅       | 9 |
| `test_vertexSelection_hitTest.mjs`                  | ✅       | 31 |
| **Total**                                           |          | **79** ✅ matches progress doc |

All four files exist with the plan's exact names; all four exit 0 (verified by running `node scripts/test/test_vertexSelection_basic.mjs` etc.).

**Test scope warts:**
- `test_vertexSelection_persistence.mjs:79` and :84 use `useEditorStore.setState({ editMode: 'pose' })` to bypass the `enterEditMode` validator (Pose Mode requires bone-role selection). Acknowledged by the test's comment block (lines 73-78). Limitation: the test exercises the *store invariant* (that mode change alone doesn't clear selection) but not the *user-facing flow* (Tab → Pose → Tab → Edit) — that's deferred to the manual gate.
- `test_vertexSelection_invalidation.mjs` only exercises the action's contract directly; the actual `dispatchMeshWorker` integration (the missed invalidation path noted in §0.F) is NOT tested. The test file's docstring acknowledges this: "CanvasViewport integration is browser-tested" (line 5).

### Sub-phase 0.H — Manual gate

User-pending. The 8 manual checks listed in the progress doc match plan §0.H Section "Phase exit gate" expectations.

---

## Phase 1 — Box / Lasso Select

### Sub-phase 1.A — Box Select operator

**Plan §1.A bullets (lines 406-420):**

| Plan bullet                                                              | Verdict | Evidence |
|--------------------------------------------------------------------------|---------|----------|
| `selection.boxSelect` operator                                           | ✅      | src/v3/operators/registry.js:603-619 |
| `B` keymap chord                                                         | ✅      | src/v3/keymap/default.js:107 |
| Modal capture pointer                                                    | ✅      | src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx:83-124 (window-level mousemove/mouseup/contextmenu/keydown listeners) |
| LMB-down → start, drag → resize, LMB-up → commit                         | ✅      | BoxSelectOverlay.jsx:86-100 |
| Dashed border during drag                                                | ✅      | BoxSelectOverlay.jsx:158-167 (`strokeDasharray="4 3"`) |
| Hit-test contained elements                                              | ✅      | BoxSelectOverlay.jsx:209-237 (`partsInRect` for object, `verticesInRect` for edit) |
| Shift = add to selection                                                 | ✅      | BoxSelectOverlay.jsx:97 |
| Ctrl = subtract from selection                                           | ✅      | BoxSelectOverlay.jsx:97 |
| **Mid-drag: A toggles "select all under" semantics (Blender-style)**     | ❌ MISSING | BoxSelectOverlay.jsx:107-112 — `onKeyDown` ONLY handles Escape. No `KeyA` handler. The plan's exact text is "Mid-drag: A toggles 'select all under' semantics (Blender-style)". |
| Object Mode: parts whose mesh AABB intersects                            | ✅      | `partsInRect` at src/io/hitTest.js:565-590 |
| Edit Mode: verts whose canvas-px position falls inside                   | ✅      | `verticesInRect` at src/io/hitTest.js:437-462 |

**Operator design.** The operator captures `mode`+`editPartId` at activation (registry.js:609-617) — a mode-switch mid-drag won't redirect the eventual commit. Good Blender-faithful behaviour.

**Modifier behaviour for box-select.** Reading `e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'subtract' : 'replace'` at commit time (BoxSelectOverlay.jsx:97) is the standard Blender pattern. Works correctly for box because `B` is a chord-with-no-modifier — user holds Shift / Ctrl during commit to compose. Works as documented.

### Sub-phase 1.B — Lasso Select operator

**Plan §1.B bullets (lines 422-429):**

| Plan bullet                                                              | Verdict | Evidence |
|--------------------------------------------------------------------------|---------|----------|
| `selection.lassoSelect` operator                                         | ❌ MISSING | Grep confirms NO operator with this id anywhere. Only a CanvasViewport mouse gesture (CanvasViewport.jsx:2454-2462 for Object Mode, 2263-2298 for Edit Mode). The boxSelectStore docstring at src/store/boxSelectStore.js:7 claims `selection.lassoSelect` exists; the comment is stale / aspirational. |
| `Ctrl+LMB-drag` modal capture                                            | ✅      | CanvasViewport.jsx:2454 (Object Mode) and 2263 (Edit Mode), 4px² promotion threshold at line 2527 |
| **Point-in-polygon test (winding number)** per plan literal              | ⚠️ DIVERGED | Shipped uses **even-odd ray-cast** (src/io/hitTest.js:522-535). Verified against Blender source: `reference/blender/source/blender/blenlib/intern/math_geom.cc:1509-1525` `isect_point_poly_v2` is also even-odd ray-cast — identical algorithm. **The PLAN was wrong; the SHIP matches Blender.** Per `feedback_blender_reference_strict` MEMORY entry, the right correctness reference is Blender, not the plan's prose. Still flagging because the divergence is undocumented in the progress doc beyond a hand-wave ("matches Blender's lasso behaviour for the common simple-polygon case" — actually matches it for ALL cases including the figure-8 self-intersect tested at scripts/test/test_lassoSelect_winding.mjs:67-83). |
| Same modifiers as Box                                                    | ❌ BUG | **Lasso commit ALWAYS reads ctrlKey on release.** Ctrl is REQUIRED to start the lasso gesture (CanvasViewport.jsx:2454 explicitly checks `(e.ctrlKey \|\| e.metaKey) && !e.shiftKey && !e.altKey`). On release, the BoxSelectOverlay's modifier check at line 97 reads `e.ctrlKey` again — and finds it true (still held). So the modifier is always `'subtract'` for default lasso. The user can compose Shift+Ctrl+drag for `'add'` (Shift wins in the ternary at line 97). **The user CAN NEVER trigger pure-replace lasso** because that would require Ctrl unheld at release, but the gesture wouldn't have started. Real bug. |

**Additional Phase 1.B gap.** Edit-Mode Ctrl+LMB-drag from EMPTY canvas does NOT open the lasso modal:
- Edit Mode pointerdown enters the meshEditActive block at CanvasViewport.jsx:2233.
- `hitTestVertices` runs at line 2253; if no vertex is within 6/zoom px, `idx === -1`.
- Line 2255-2261 fires `deselectAllVertices` and returns.
- The Ctrl+LMB lasso candidate setup at line 2263 is INSIDE the `if (idx >= 0)` branch so empty-canvas Ctrl+LMB never reaches it.
- Object Mode is fine — it falls through to line 2454 and DOES open the lasso candidate from anywhere.

This means the Edit-Mode lasso-select user must Ctrl+LMB-down on a vertex to start the lasso (and the BFS click-fallback then competes). **Real usability gap.**

### Sub-phase 1.C — Quadtree optimization (DEFERRED)

**Plan §1.C bullets (lines 431-434):**
- For meshes with >5000 verts, Box uses quadtree, Lasso uses AABB pre-filter.

**Verdict: ✅ clean deferral.** Plan §1.C is a *performance* optimization, NOT a correctness gate. The plan does NOT name `selectAllByPixelBox` as a Phase 1 exit-gate item (§1.F lists only the manual rect tests). Progress doc explicitly states "DEFERRED — current impl is O(n) per call. Will revisit when a real char hits the threshold". This matches the Rule №2 contract for clean deferrals (no scaffolding code, no migration baggage):
- No `selectAllByPixelBox` function created with TODO body.
- No quadtree module imported and unused.
- The deferral is documented with a re-visit trigger ("when a real char hits the threshold").

This is the correct way to defer per Rule №2.

### Sub-phase 1.D — Modal capture infrastructure

**Plan §1.D bullets (lines 436-441):**

| Plan bullet                                                              | Verdict | Evidence |
|--------------------------------------------------------------------------|---------|----------|
| Reuse modal capture pattern from `ModalTransformOverlay.jsx`             | ⚠️ partial | New overlay does NOT import ModalTransformOverlay; it implements its own capture loop directly (BoxSelectOverlay.jsx:83-124). Window-level listeners pattern is similar but the code is parallel, not reused. |
| New: **`BoxSelectOverlay.jsx` + `LassoSelectOverlay.jsx`** (TWO files)   | ⚠️ DIVERGED | Single `BoxSelectOverlay.jsx` handles both kinds via `boxSelectStore.kind` discriminator. Justification (per progress doc): "the modal capture infrastructure (window-level mousemove / mouseup / keydown / contextmenu) is identical — only the on-commit dispatch branches on `kind`." Reasonable architectural choice but unannounced divergence. The captureStore docstring at src/store/captureStore.js:74-80 STILL refers to "BoxSelectOverlay / LassoSelectOverlay" (plural), and CanvasViewport.jsx:2994 has the same stale "BoxSelectOverlay / LassoSelectOverlay" plural comment — so the intent of two files lingers in comments. |
| Each renders fixed-position SVG with **`pointer-events: all`**           | ❌ DIVERGED | Shipped uses `pointer-events: none` (BoxSelectOverlay.jsx:153 `className="… pointer-events-none"`). Capture is via window-level event listeners instead of overlay-element capture. Functionally equivalent (the modal still captures globally) but architecturally different from the plan's described pattern. |

**`getCanvasHitContext` bridge.** New addition NOT in plan §1.D — added to wire the AppShell-mounted overlay to CanvasViewport's chainEval frames + composed verts. Pattern mirrors `captureExportFrame` (also in captureStore). Sensible, well-documented at src/store/captureStore.js:70-81.

### Sub-phase 1.E — Tests

**Plan §1.E bullets (lines 443-450):**

| Plan-named test file                                | Shipped? | Assertions |
|-----------------------------------------------------|----------|------------|
| `test_boxSelect_objectMode.mjs`                     | ✅       | 13 |
| `test_boxSelect_editMode.mjs`                       | ✅       | 13 |
| `test_lassoSelect_winding.mjs`                      | ✅       | 20 (despite the file actually testing even-odd, not winding number — name kept per plan) |
| `test_lassoSelect_modifiers.mjs`                    | ✅       | 19 |
| **Total**                                           |          | **65** ✅ matches progress doc |

All file names match plan exactly. All exit 0 (verified for `test_lassoSelect_winding.mjs` at run-time).

**Coverage gaps:**
- `test_lassoSelect_modifiers.mjs` simulates the BoxSelectOverlay's modifier composition pattern manually (in-test set algebra, lines 41-133) — does NOT exercise the actual overlay flow. So the **always-subtract bug** (§Phase 1.B) is NOT caught by the test suite.
- No test exercises Edit-Mode Ctrl+LMB on an empty canvas (would catch the §Phase 1.B gap).
- No test asserts that the active vertex is cleared when `setVertexSelectionForPart` filters it out (plan / overlay docstring at BoxSelectOverlay.jsx:349 says it does, but the action does NOT). Bug not caught.

### Sub-phase 1.F — Manual exit gate

User-pending. Plan §1.F:
1. Box-drag Object Mode rect → selects parts.
2. Box-drag Edit Mode rect → selects verts.

Progress doc §Manual gate adds 4 more (Object lasso, Edit lasso, BFS preserved on Ctrl+LMB-click, Esc/right-click cancel). The expanded gate is sensible.

---

## Cross-cutting concerns

### Rule №2 violations (no migration baggage)

1. **Plan §0.A read-only helpers (`isVertexSelected` / `getSelectedVertexCount` / `getAllSelectedVertices`).** Plan promises 3 helpers; ship omits all 3; no ADR-style note explaining the deferral. Action: either implement (~10 LOC each) or remove from the plan.
2. **Stale comment "BoxSelectOverlay / LassoSelectOverlay" in captureStore.js:74 and CanvasViewport.jsx:2994.** Plan §1.D consolidation to one file is real but the comments still imply two. Cosmetic but signals the consolidation wasn't fully landed.
3. **boxSelectStore.js:7 docstring references `selection.lassoSelect` operator that doesn't exist.** Misleads any future reader looking for a registered chord.
4. **BoxSelectOverlay.jsx:349-351 comment**: "setVertexSelectionForPart already cleared activeVertex when the active was filtered out — no-op here, kept for symmetry." This is FALSE — the action does NOT touch activeVertex. The `if-else if` block correctly does nothing on subtract, but the rationale is wrong; if the active vertex was in the subtracted range, it stays as a stale pointer.

### TODO / DEFERRED / RESERVED markers

Searched all toolset-touched files. Findings:
- `boxSelectStore.js` — clean (no markers)
- `BoxSelectOverlay.jsx` — clean (1 mention of "Phase 1" in the docstring header — descriptive, not deferral)
- `VertexSelectionOverlay.jsx` — clean
- `hitTest.js` — clean (Phase mentions are descriptive)
- `editorStore.js` Phase 0 actions — clean
- `tools.js` mesh table — clean (Phase 0.E mention is descriptive)

**No formal `TODO` / `DEFERRED` / `RESERVED` markers found** — Rule №2 compliance on that axis is good.

### Documentation drift

Several places where the doc / comment / docstring doesn't match the code:

| Location                                                          | Drift |
|-------------------------------------------------------------------|-------|
| TOOLSET_PHASE_0_PROGRESS.md:33 "Nine actions"                     | Actually 8. |
| TOOLSET_PHASE_0_PROGRESS.md:36-39 lists actions                   | Lists 8, doesn't include the 3 plan-named read helpers (correctly omits them, but doesn't flag they were dropped). |
| boxSelectStore.js:7 "`selection.lassoSelect` (Ctrl+LMB-drag from CanvasViewport)" | No such operator exists. |
| BoxSelectOverlay.jsx:349-351 active-clear comment                  | The action does not clear active. |
| CanvasViewport.jsx:2994 "BoxSelectOverlay / LassoSelectOverlay"   | Plural; only one file shipped. |
| captureStore.js:74-80 same plural reference                       | Same. |
| TOOLSET_PHASE_1_PROGRESS.md §1.B claim "matches Blender's lasso behaviour for the common simple-polygon case" | Actually matches Blender for ALL cases including self-intersecting — Blender uses the same even-odd algorithm. The progress doc undersells the fidelity. |

### Other audit-flagged items per the original audit-driven changes

Re-checked the v2 audit-driven changes that touch Phase 0 / 1 specifically:

- **§0.B "Ctrl+LMB spatial-nearest replaced with topology shortest-path"** — ✅ shipped correctly (Phase 0.B, see verdict above).
- **§4 Phase order** — depgraph: Phase 0 → Phase 1, Phase 0 → Phase 4/5/6 — clear in the plan; not a code-side audit item.

---

## Gaps summary (everything that is NOT ✅)

### Severity HIGH

1. **Phase 1.B always-subtract lasso bug**. Lasso commit reads ctrlKey at release; Ctrl is required to start the gesture; therefore the default modifier for lasso is ALWAYS `subtract`. Pure-replace lasso is unreachable. (Add via Shift works; subtract is "default".)
2. **Phase 1.B Edit-Mode lasso-from-empty-canvas blocked**. Ctrl+LMB-down on empty Edit-Mode canvas falls into the `idx === -1` deselect-all branch at CanvasViewport.jsx:2255-2261 BEFORE reaching the lasso candidate setup at line 2290. User must Ctrl+LMB-down on a vertex to start an Edit-Mode lasso.
3. **Phase 0.F missing invalidation in `dispatchMeshWorker`**. CanvasViewport.jsx:1528 calls `setMesh()` after a mesh-worker re-mesh, replacing topology. No `invalidateVertexSelectionForPart` call follows. After a remesh, stale selectedVertexIndices entries point at random vertices.

### Severity MEDIUM

4. **Phase 1.A missing mid-drag `A` toggle**. Plan §1.A explicitly names "Mid-drag: A toggles 'select all under' semantics (Blender-style)". BoxSelectOverlay.jsx:107-112's `onKeyDown` only handles Escape.
5. **Phase 1.B missing `selection.lassoSelect` operator**. Plan §1.B calls it out as an operator. Shipped: only a mouse gesture. No command-palette entry; no rebindable chord. boxSelectStore docstring at src/store/boxSelectStore.js:7 references the missing operator.
6. **Phase 0.A missing 3 read-only helpers**. `isVertexSelected` / `getSelectedVertexCount` / `getAllSelectedVertices` named in plan §0.A; not shipped; not flagged as deferred. Either implement or strike from plan.

### Severity LOW

7. **Phase 1.D one file vs two**. Plan said `BoxSelectOverlay.jsx` + `LassoSelectOverlay.jsx`; shipped one file handling both kinds. Architecturally fine; comments referencing "BoxSelectOverlay / LassoSelectOverlay" are stale.
8. **Phase 1.D `pointer-events: all` vs `pointer-events: none`**. Plan said "all"; shipped "none" with window-level listeners. Functionally equivalent for the immediate use case.
9. **Phase 0.B Edit-Mode Ctrl+LMB doesn't filter `!e.shiftKey`**. Shift+Ctrl+LMB silently runs the BFS path. No documented Blender meaning for Shift+Ctrl+LMB so low impact.
10. **Phase 0.C missing `available` field on the new operators**. `selection.selectAllToggle` and `selection.deselectAll` skip the `available` predicate; sibling `selection.clear` includes one. Functionally fine (operators internally no-op).
11. **Phase 0.B `hitTestVertices` signature divergence from plan** (per-part vs per-project). Shipped signature is more sensible; flagging only because it's an undocumented divergence.
12. **Phase 1.B even-odd vs winding number**. Plan said "winding number"; ship uses Blender's even-odd algorithm. Aligns with Blender (which is the reference of record per `feedback_blender_reference_strict`). Plan was wrong; ship is correct. Flag as accepted divergence.

### Test coverage gaps

13. **`dispatchMeshWorker` invalidation** — not exercised (would catch Gap #3).
14. **Edit-Mode Ctrl+LMB on empty canvas** — not exercised (would catch Gap #2).
15. **Lasso default modifier** — not exercised end-to-end (would catch Gap #1).
16. **`setVertexSelectionForPart` clearing active vertex when filtered out** — not asserted (would catch the §1.D wart and likely fix the docstring lie at BoxSelectOverlay.jsx:349).

### Documentation gaps

17. Progress doc / boxSelectStore docstring / CanvasViewport / captureStore comments all need a sweep to remove stale "lassoSelect operator" + "LassoSelectOverlay file" references.

---

## Recommendations

### Ship a follow-up commit BEFORE Phase 2 starts

Roll up these into one cleanup pass (~150-300 LOC, half-day work):

- **Fix Gap #1 (HIGH).** Capture the modifier at lasso CANDIDATE setup (CanvasViewport.jsx:2454-2462), pass through boxSelectStore.begin opts, and have BoxSelectOverlay's commit prefer that modifier when present. Keeps box-select's at-release pattern (works there) but unblocks pure-replace lasso. Pattern reference: how Blender's wmGesture stores `sel_op` at invoke time.
- **Fix Gap #2 (HIGH).** Hoist the Ctrl+LMB-drag candidate setup OUT of the `if (idx >= 0)` block in CanvasViewport.jsx (lines 2253-2298) so empty-Edit-canvas Ctrl+LMB starts a lasso candidate. The `idx < 0` deselect-all branch should fire only on simple LMB / Shift+LMB, not on Ctrl+LMB.
- **Fix Gap #3 (HIGH).** Add `useEditorStore.getState().invalidateVertexSelectionForPart(partId)` immediately after CanvasViewport.jsx:1528's `setMesh()` call.
- **Fix Gap #4 (MEDIUM).** Add `KeyA` handler to BoxSelectOverlay's `onKeyDown` that runs the at-release commit logic with full-canvas as the rect (Object Mode = `partsInRect` over the entire visible canvas; Edit Mode = `selectAllVertices(partId, vertCount)`).
- **Fix Gap #6 (MEDIUM).** Either implement the 3 read helpers or strip them from TOOLSET_BLENDER_PARITY_PLAN.md:316-324. Recommend implementation (~30 LOC total) — they make consumer code in future Phases 4 / 5 / 6 read more cleanly than `editor.selectedVertexIndices.get(partId)?.has(idx)`.
- **Fix gaps #7, #8, #17.** Update stale comments + progress doc claims in the same sweep. Drop "Nine actions" → "Eight actions" in Phase 0 progress doc; drop plural overlay names; drop `selection.lassoSelect` operator references.

### Defer to Phase 2 or later

- **Gap #5 (MEDIUM, `selection.lassoSelect` operator).** The current mouse gesture works; an operator only matters if the user wants to bind it elsewhere or invoke from command palette. Defer until that's a user request.
- **Gap #9 (LOW, Shift+Ctrl+LMB behaviour).** Wait for user repro.
- **Gap #10 (LOW, missing `available` fields).** Cosmetic; bundle with next operator-registry sweep.
- **Gap #11 (LOW, hitTestVertices signature).** Functional and well-tested; document the divergence in plan.

### Add test coverage

Before declaring Phases 0+1 fully shipped, add 4 small assertions:

- `test_vertexSelection_invalidation.mjs`: assert that after `setMesh(node, newMesh, project)` is called by an external mesh worker, `selectedVertexIndices.get(partId)` is empty. (Hardest to test in isolation — may need a fixture with a real Project + mocked mesh worker.)
- `test_lassoSelect_modifiers.mjs`: assert that the default lasso modifier is `replace`, not `subtract`. Will fail today; fix it as part of Gap #1 fix.
- `test_boxSelect_objectMode.mjs` or sibling: assert that mid-drag `A` keypress promotes selection to "all under". Will fail today; fix as part of Gap #4.
- New test `test_lassoSelect_emptyCanvas.mjs`: assert that Edit-Mode Ctrl+LMB-drag from a vertex-free canvas point opens the lasso modal (would catch Gap #2). Likely needs a CanvasViewport-equivalent harness or a unit test of just the dispatch decision tree.

---

## Appendix — Files audited

Code:
- `src/store/editorStore.js` (Phase 0.A actions, 0.E default flip, 0.F clear hooks)
- `src/io/hitTest.js` (Phase 0.B + 1.A + 1.B helpers)
- `src/components/canvas/CanvasViewport.jsx` (Phase 0.B click dispatch, 0.F invalidation, 1.B lasso candidate)
- `src/v3/operators/registry.js` (Phase 0.C operators, 1.A boxSelect operator)
- `src/v3/keymap/default.js` (Phase 0.C + 1.A keymap)
- `src/v3/editors/viewport/overlays/VertexSelectionOverlay.jsx` (Phase 0.D)
- `src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx` (Phase 1.A + 1.B + 1.D)
- `src/v3/shell/CanvasArea.jsx` (Phase 0.D + 1.D mounts, hit-context bridge)
- `src/v3/shell/canvasToolbar/tools.js` (Phase 0.E T-panel)
- `src/store/boxSelectStore.js` (Phase 1.A modal store)
- `src/store/captureStore.js` (Phase 1.A getCanvasHitContext bridge)

Tests:
- `scripts/test/test_vertexSelection_basic.mjs`
- `scripts/test/test_vertexSelection_persistence.mjs`
- `scripts/test/test_vertexSelection_invalidation.mjs`
- `scripts/test/test_vertexSelection_hitTest.mjs`
- `scripts/test/test_boxSelect_objectMode.mjs`
- `scripts/test/test_boxSelect_editMode.mjs`
- `scripts/test/test_lassoSelect_winding.mjs`
- `scripts/test/test_lassoSelect_modifiers.mjs`

Reference:
- `reference/blender/source/blender/blenlib/intern/lasso_2d.cc`
- `reference/blender/source/blender/blenlib/intern/math_geom.cc`

Commits:
- `4a59d62` (Phase 0)
- `f7fba11` (Phase 1)
