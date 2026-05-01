# Feature Gaps

Living document. Tracks where v3 lags upstream's [README.md](../reference/stretchystudio-upstream-original/README.md) feature claims, and items worth adding that upstream has. Sister document to [BUGS.md](BUGS.md).

## Conventions

- **ID** — `GAP-NNN`, monotonically increasing. Never reuse, never renumber.
- **Severity** — `critical` / `high` / `medium` / `low`. Severity reflects user-visible impact, not implementation effort.
- **Status flow** — `open` → `investigating` → `closed` (move between sections; don't delete on close).
- **Verify before adding.** Like BUGS.md, this tracker is for *real* gaps confirmed by reading the code, not marketing diff against upstream's README. Speculation belongs nowhere.

---

## Open

### GAP-011 — Project data layer not canonical (4 rig fields lost on save→load)

- **Severity:** critical (silently downgrades export from "use my edits" to "auto-regenerated" without warning)
- **Reported:** 2026-05-01 (user-flagged + audit-confirmed)
- **Affects:** every workflow that saves and reloads a project — i.e. all real-world use

**Strategic principle the audit revealed:**

> Stretchy Studio's value sits on a single invariant — *the project file is the canonical source of truth.* User edits in any editor land in `project.*`, save→reload reproduces the editing context exactly, and the export pipeline reads from `project.*` rather than re-deriving from PSD heuristics. Today this invariant is partially broken.

**Root cause (one-line):** [`saveProject`](../src/io/projectFile.js#L82) does not serialize four fields that `seedAllRig` populates: `autoRigConfig`, `faceParallax`, `bodyWarp`, `rigWarps`. After a save→load round-trip, the export pipeline's `anySeeded` check returns false and falls through to a fresh `initializeRigFromProject` heuristic harvest. The user's customisations are silently re-derived from PSD geometry rather than honoured.

**Repro (verified by audit, 2026-05-01):**

1. Open `shelby_neutral_ok.psd` → click Init Rig (populates all 4 fields in memory).
2. Export `.cmo3` → produces correct rig (matches Cubism Editor output).
3. Save project as `.stretch`.
4. Close app, reload `.stretch` → 4 fields are now null/empty (migrations default them).
5. Export `.cmo3` → falls through to fresh harvest → **visually different output from step 2**, despite no user edits between steps.

**Full audit:** [docs/PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md). Tier 1 (works) lists the 12 persisted fields. **Tier 2 (the gap)** lists the 4 lost fields. Tier 3 lists what's deterministically re-derived (fine). Tier 4 lists transient state (intentionally not persisted).

**Fix (Phase A — quick, ~30 min):** add the 4 missing fields to `saveProject`'s `projectJson` object. Migrations v7-v10 already provide null defaults on legacy saves, so no breakage. Test by exporting `.cmo3` from a freshly-loaded `.stretch` and asserting byte-equal output vs pre-save export.

**Why GAP-011 ranks above other Open entries:**

- Multiple downstream features wait on this: GAP-005 (multi-target export — without a stable data layer, every target's "use my edits" path is broken the same way), GAP-008 (Init Rig opt-out with persistence — the opt-out flag would land in `autoRigConfig` which doesn't survive save/load), GAP-009 (Project vs Auto-regenerated picker — in current state both produce identical output after save/load, defeating the picker's purpose), and the entire `project_v3_rerig_flow_gap` (no point editing in a UI surface if edits don't persist).
- It's also a verification blocker for [CUBISM_WARP_PORT.md](live2d-export/CUBISM_WARP_PORT.md) Phase 1 — the oracle-diff numeric test needs a programmatic rigSpec build path, which means the project must contain enough data to skip the wizard. Today it doesn't survive save/load, so CLI-driven oracle-diff is impossible.

**Notes:** Phase A only fixes the round-trip. Phase B (move Tier 3 fields like eye closure parabolas into Tier 1) is deferred until UI editors for them exist. See PROJECT_DATA_LAYER.md "Migration plan" section.

---

### GAP-012 — PSD reimport doesn't invalidate seeded rig data (silent corruption)

- **Severity:** high (silently corrupt exports after a normal user workflow)
- **Reported:** 2026-05-01
- **Affects:** anyone who edits a PSD after Init Rig — re-meshes a layer, adds a new layer, renames a layer, deletes a layer, etc.

**Root cause (one-line):** PSD reimport updates `project.nodes` but doesn't tell any of the seeded rig stores (`faceParallax`, `bodyWarp`, `rigWarps`, mesh boneWeights, animation tracks) that their assumptions about the node set may have changed. Stored vertex-indexed data still points at the old vertex layout; new meshes aren't covered by existing keyforms; renamed groups break variant/physics references.

**Concrete failure modes** (cross-referenced from [PROJECT_DATA_LAYER.md → Integrity gaps](PROJECT_DATA_LAYER.md#integrity-gaps-and-known-footguns)):

- **I-1**: warp keyform `positions` arrays are positionally indexed to `node.mesh.vertices`. PSD reimport that re-meshes a layer keeps the index range the same but maps to different geometry — keyforms now deform random vertices toward old silhouette points.
- **I-3**: re-Init Rig with reduced tag coverage (e.g. removed `bottomwear` group) drops `ParamSkirt` from the parameter list, but any animation track still referencing `ParamSkirt.value` becomes a dangling property path.
- **I-4**: layer renamed from `face.smile` to `face_alt` after seeding — `node.variantSuffix='smile'` is stale, but `variantNormalizer` runs from name on next import and can't reconcile.
- **I-5**: bone group renamed/deleted → `node.mesh.jointBoneId` dangles silently.
- **I-6**: physics output bone group renamed → `physicsRules[].outputs[]` dangles.

**Why this is THE umbrella issue:** these five sub-failures share the same root — *the system has no way to know when seeded data has gone stale*. Fixing each individually patches symptoms; the fix is one shared mechanism.

**Defence (Phase A — detection):**

1. ✅ **SHIPPED 2026-05-01.** At seed time, compute and store a per-mesh fingerprint as a flat `project.meshSignatures: { [partId]: {vertexCount, triCount, uvHash} }`. Module [src/io/meshSignature.js](../src/io/meshSignature.js). Hooked in `projectStore.seedAllRig`; survives save/load via [`projectFile.js`](../src/io/projectFile.js) + schema migration v12. Tests: `test:meshSignature` (29 cases). **Divergence from original sketch:** flat top-level map, not per-subsystem; positional UV hash, not sorted (reordering is an invalidating change keyform.positions cares about).
2. ⏳ **OPEN.** On project load AND on PSD reimport completion, call `validateProjectSignatures(project)` and emit warnings via `useLogsStore` for each `stale` / `missing` part. Function exists ([meshSignature.js#validateProjectSignatures](../src/io/meshSignature.js)) — needs callers.
3. ⏳ **OPEN.** UI: when divergences exist, show a banner "PSD changes detected on N meshes; rig data may be stale. Re-Init Rig to refresh, or dismiss to keep current export." Likely lives in `<Topbar>` or a dedicated `<StaleRigBanner>`. Banner is gated by `hasStaleRigData(report)` (only `stale`+`missing` count; `unseededNew` is normal pre-Init-Rig state).

This is **detection-only**. Don't auto-clear (lossy). User decides.

**Defence (Phase B — selective re-derivation):** "Re-Init Rig (preserve customisations)" mode that re-runs the wizard for changed meshes only, leaving unchanged-mesh seeds intact. Out of scope for the umbrella fix.

**Files touched (Phase A):**
- [`src/io/live2d/rig/faceParallaxStore.js`](../src/io/live2d/rig/faceParallaxStore.js) (add `meshSignatures` field to serialized spec)
- [`src/io/live2d/rig/bodyWarpStore.js`](../src/io/live2d/rig/bodyWarpStore.js) (same)
- [`src/io/live2d/rig/rigWarpsStore.js`](../src/io/live2d/rig/rigWarpsStore.js) (per-mesh signature)
- New `src/io/meshSignature.js` (the hash function)
- PSD-reimport hook (likely in `RigService` or `psdImportFinalize`) — recompute all signatures, write to `useLogsStore`
- `src/v3/shell/Topbar.jsx` or a dedicated `<StaleRigBanner>` — UI surface

**Notes:** GAP-011 (round-trip persistence) is the prerequisite — Phase A's signature fields would also be lost on save/load without GAP-011's fix. Phase A of GAP-011 is shipped (2026-05-01), so GAP-012 is unblocked.

This work was already partially planned in [NATIVE_RIG_REFACTOR_PLAN.md → Cross-cutting invariants → ID stability](live2d-export/NATIVE_RIG_REFACTOR_PLAN.md#id-stability-and-invalidation) — explicitly deferred from v1 of the refactor as a footgun acceptable for the initial ship. GAP-012 is the formal entry to track shipping it.

---

### GAP-013 — Parameter delete has no orphan-reference detection

- **Severity:** medium
- **Reported:** 2026-05-01
- **Affects:** workflows that delete custom parameters (variant suffix params, bone-rotation params), and re-Init Rig flows where tag coverage changes invalidate previously-registered params

**Root cause (one-line):** `project.parameters` is a flat list with no back-references. UI surfaces that remove a parameter (or the `paramSpec.requireTag` gating that drops a param when its tag no longer appears) leave the parameter's references dangling in three places:

- `project.animations[].tracks[].propPath` referencing the deleted parameter ID
- `bindings[].parameterId` inside `faceParallax`, `bodyWarp`, `rigWarps` keyform records
- `physicsRules[].inputs/outputs` referencing parameters as drivers

The parameter disappears, but every reference to it stays in the project, silently producing zero motion / wrong export until someone notices.

**Defence:** at parameter delete (UI action OR `seedParameters` filter dropping a tag-gated param), enumerate references in the three locations above; either (a) require user confirmation listing all references, OR (b) auto-clean dangling references after warning. Standard parameters (the 22 baked-in IDs registered unconditionally in `STANDARD_PARAMS`) are protected — UI shouldn't expose delete for them.

**Files touched:**
- New `src/io/live2d/rig/paramReferences.js` (enumerate references)
- Wherever the UI surfaces parameter delete (TBD — currently no UI for this; happens implicitly via re-Init Rig)
- `src/io/live2d/rig/paramSpec.js` `requireTag` filter site (warn before drop)

**Notes:** the bug is masked today because (a) the UI doesn't expose parameter delete, and (b) re-Init Rig with reduced tags is uncommon. But the moment we ship a "Edit parameters" UI editor (likely as part of `project_v3_rerig_flow_gap`), this becomes a daily problem. Prerequisite for safe parameter-editor UI.

---

### GAP-001 — See-Through import wizard not v3-native

- **Severity:** medium
- **Reported:** 2026-04-30
- **Affects:** PSD import flow, all imported characters

**Current state:** Upstream README sells "Native See-Through Support" as a flagship feature. We have the underlying capability — `src/io/armatureOrganizer.js` recognizes See-Through layer-tag conventions (`KNOWN_TAGS` lines 37–50: iris, eyebrow, topwear, etc.) — but the wizard UI that drives it (`PsdImportWizard`) is the v2-era component wrapped inside v3's viewport rather than a natively v3 area editor.

**What "native" would look like:** Import wizard as a v3 editor type registered in `src/v3/shell/editorRegistry.js`, mountable as an area tab, using v3's modal/area conventions instead of the bespoke v2 wizard chrome.

**Gap location:** v3 shell + `src/components/PsdImportWizard*` (v2 component) — would need a v3 wrapper or rewrite.

**Notes:** Functionally works today. This is a polish/consistency gap, not a capability gap.

---

### GAP-002 — No dedicated "Groups" editor tab

- **Severity:** low
- **Reported:** 2026-04-30
- **Affects:** Layer organization workflow

**Current state:** Upstream README's Static Character workflow says "Use the Groups tab to parent layers and adjust pivot points". v3 has no editor type called "Groups" — the equivalent functionality (parent reassignment, pivot adjustment) lives in `src/v3/editors/properties/tabs/ObjectTab.jsx`, surfaced inside the Properties area when you select a `type='group'` node.

**What's missing:** A dedicated tree-style group editor that shows just the group hierarchy. The Outliner already shows the full node tree; a "Groups-only" filtered view would match the README's framing.

**Gap location:** New editor in `src/v3/editors/`, or a filter mode on the existing Outliner.

**Notes:** Possibly redundant with Outliner. Decide before building.

---

### GAP-003 — Root README is upstream verbatim, doesn't reflect v3

- **Severity:** medium
- **Reported:** 2026-04-30
- **Affects:** First-time user impression, project identity

**Current state:** [README.md](../README.md) is byte-identical (modulo whitespace) to upstream's pristine README at `reference/stretchystudio-upstream-original/README.md`. It markets See-Through + DWPose + Spine export — true claims — but says nothing about our actual differentiators:

- **Live2D `.cmo3` / `.moc3` export pipeline** — full reverse-engineered Cubism format support, verified byte-equivalent against Cubism Editor's output (memory: `project_runtime_export_parity.md`)
- **Native rig refactor** — Blender-style workspace shell, area tabs, native rig evaluation in viewport (memory: `project_native_rig_refactor_plan.md`)
- **Variant / shape-key system** — fade rules, multi-suffix variants, eye 2D keyform grids
- **Cubism-aware physics** — pendulum hair sway, clothing physics, arm whip
- **Idle motion generator** — auto-generates loop-safe `motion3.json` (memory: `project_idle_motion_generator.md`)
- **Hot-reload PSD layers** — file-watcher refresh
- **Project structure section** — claims `src/app/layout/` and `src/components/inspector/` which don't reflect our v3 layout (`src/v3/shell/`, `src/v3/editors/`)

**What to do:** Rewrite README to lead with v3's actual capabilities and the Cubism/Live2D pipeline. Keep See-Through credit (the import path genuinely uses See-Through conventions) but reframe as "starts from See-Through-decomposed PSDs, ships as Cubism .cmo3 + native runtime".

**Notes:** Cosmetic for engineering, important for anyone landing on the GitHub page.

---

### GAP-007 — No in-app Logs panel for pipeline debugging

- **Severity:** high (blocks BUG-002 / BUG-003 / BUG-006 investigation)
- **Reported:** 2026-04-30
- **Affects:** All native-rig debugging; can't see what's happening internally without round-tripping to .cmo3 + opening the JSON log

**Current state:** The pipeline emits a structured `.rig.log.json` only when the user explicitly exports `.cmo3`. For the user's current testing (parabola fit, breath warp, opacity, etc. — all evaluated by the **native** rig in the viewport), there's no way to see what the pipeline computed. They have to export every time, or paste console.log calls and rebuild.

**What this should be:** a Logs editor panel inside v3, mountable as an area tab. Renders an in-memory ring buffer of structured log entries (`{ts, level, source, message, data}`). Pipeline modules write to it via a small `logger` helper; the panel renders the latest N entries with collapsible structured `data`.

**Decision (made 2026-04-30, autonomous):**

- New editor type `logs` in `editorRegistry`
- New zustand store `logsStore` (ring buffer, default cap ~500 entries)
- New helper `src/lib/logger.js` exposing `logger.debug/info/warn/error(source, message, data?)` — pushes to store + browser console
- Mount as `leftBottom` area; left column becomes a vertical split again (Outliner top, Logs bottom)
- First wired callsite: parabola fit (BUG-002)

**Status:** SHIPPING NOW. Will close this entry once panel is live and at least one module writes to it.

---

### GAP-006 — No "Reset to rest pose" button in Pose workspace

- **Severity:** medium
- **Reported:** 2026-04-30
- **Affects:** Posing workflow

**Current state:** When the user is posing a character in the Pose workspace (or anywhere they're applying transforms / param overrides on top of the rest pose), there's no button to **reset all live pose values back to the rest pose**. They have to manually re-zero every transformed bone / dragged vertex / nudged parameter to recover the neutral state.

**What "reset to rest" means in code:**

- Clear all keyframe overrides for the current frame? Or revert pose draft state?
- Restore `ParamAngleX/Y/Z` (and other rig params) to their default value?
- Re-apply `captureRestPose(project.nodes)` snapshot as the visible state?

The exact semantics depend on whether we're resetting *editor view* (back to the rest snapshot) or *project data* (revert pose-mode keyframe edits). Probably both, controlled by one button.

**Where it should live:**

- Topbar: a small "Reset Pose" button next to the workspace pill, visible only in Pose / Animation workspaces. **OR**
- Pose workspace dedicated toolbar (would require a sub-toolbar concept that v3 doesn't have yet).
- Topbar placement is the lower-friction choice.

**Notes:** Naming candidate: "Reset to Rest" or "Clear Pose". User's quote (Russian): "нету кнопки чтобы когда позишь ресетнуть позинг на дефолт rest pose" — literally "there's no button to reset posing to default rest pose when posing".

---

### GAP-005 — Export button regressed from multi-target to single-target

- **Severity:** medium
- **Reported:** 2026-04-30
- **Affects:** Export workflow

**Current state:** Upstream's export button surfaced multiple output targets (PNG sequence, Spine 4.0 JSON, etc.) — different formats for different downstream tools. v3's export button now drives a single Live2D `.cmo3` / `.moc3` / `.can3` pipeline. The other targets are still implemented in code (e.g. `src/io/exportSpine.js`, frame-capture code) but no longer reachable from the header.

**What was lost:**
- PNG sequence / frame export
- Spine 4.0 JSON export
- Possibly others (audit `reference/stretchystudio-upstream-original/src/components/.../ExportModal*` to enumerate)

**Why it regressed:** v3 collapsed the Export button to the single Live2D-pipeline entry point during the Blender-shell refactor. The other targets weren't deleted, they just lost their UI surface.

**What to do (when prioritized — not now):**
1. Audit upstream's ExportModal to list the original targets
2. Restore them as branches inside the v3 ExportModal — same modal, multiple format tabs
3. Wire each target to its existing exporter (most code is already there)

**Notes:** User explicitly deferred this — pipeline output quality is a higher-priority block (see BUGS.md BUG-002, BUG-003). Don't act on this until those are clean.

---

### GAP-010 — Live Preview should be its own area tab, not a Viewport sub-mode

- **Severity:** medium
- **Reported:** 2026-04-30
- **Affects:** Viewport workflow — separation between "edit a frame" and "watch the rig live"

**Current state:** the Viewport area is a single canvas that toggles between two modes via a `livePreviewActive` flag (see [CanvasViewport.jsx:294](../src/components/canvas/CanvasViewport.jsx#L294)):

- **Off (edit mode)** — params static at slider values, physics/breath/cursor-look paused. The user can scrub a parameter without it bouncing under live drivers.
- **On (live preview)** — breath auto-cycles, cursor-look writes ParamAngleX/Y/Z while LMB held, physics integrate pendulum sway every tick.

The toggle lives inside ParametersEditor and snapshots/restores around the session. Both modes draw to the same canvas. Switching is the only way to see live preview, and you lose your edit context the moment you do.

**What "native" should look like:** Live Preview as its own v3 editor type, mountable as an area tab next to the Viewport. Two canvases visible side-by-side:

- **Viewport** (left) — always edit mode. Static params, **NO live drivers AT ALL** (no physics, no breath cycle, no cursor-look). The canvas the user clicks/drags on to edit pivots, paint weights, scrub a single param. What you scrub is what you see.
- **Live Preview** (right) — the **only** place physics + breath + cursor-look ever run. Pendulum sway, breath auto-cycle, cursor-look writes ParamAngleX/Y/Z while LMB held over THIS canvas. The user looks at it the way they'd look at Cubism Viewer: "is this the rig I want to ship?"

Hard rule: **physics is enabled ONLY in Live Preview**. Confirmed by user 2026-04-30. Removes the entire `livePreviewActive` toggle path; instead, the Live Preview component owns the physics/breath/cursor-look tick loop, the Viewport never touches it. If the Live Preview tab isn't open, no live drivers run anywhere.

Both surfaces share the same `rigSpec` and `paramValues`, so dragging a slider in Parameters affects both — the difference is purely the additive overlay of live drivers on the Live Preview's render output. Slider edits the dial; Live Preview's drivers write further dial updates that the Viewport sees too (so a head-look in Live Preview also rotates the head in the Viewport — but only when the Live Preview tab is alive).

**Implementation notes:**

- New editor type `livePreview` registered in [editorRegistry.js](../src/v3/shell/editorRegistry.js).
- Component is `<LivePreviewCanvas>` — its own surface, owns physics/breath/cursor-look tick loop. Camera + zoom + pan independent from the Viewport's. No drag-to-pivot, no paint, no gizmo.
- The current `livePreviewActive` toggle in ParametersEditor goes away. Live drivers are now bound to **mount/unmount of the Live Preview component** — opening the tab starts the rAF loop, closing it stops cleanly.
- The existing CanvasViewport must be stripped of every live-driver code path: lines 326-416 (the `livePreview` block in `tick()`), the breath phase ref, the lookRef cursor handlers, the `tickPhysics` integration. All move into LivePreviewCanvas. After this, opening the Viewport alone is genuinely static — no breath cycle, no cursor tracking, no physics. (This is also fixes a long-standing minor bug: the Viewport currently respects livePreviewActive but is also where pose drag interactions happen, so the user can drag a bone while breath is also running and see fight between physics and pose.)
- Default workspace shape: add a Live Preview area to the center column or as a third column on the right. "Pose" / "Animation" presets show it by default; "Modeling" / "Rigging" presets keep it hidden (no physics noise during rig editing).

**Why it's worth doing:** matches how every other rigging tool with both an "editing surface" and a "preview surface" works (Spine 4.x, Live2D Cubism Editor → Viewer split, Maya rigging vs playback). Removes the cognitive cost of toggling. Lets users keep an editing context while watching the rig breathe.

**Notes:** depends on multi-canvas WebGL handling — currently CanvasViewport assumes one canvas per process. Either we mount two `<canvas>` and accept the GL-context cost, or share a single hidden compositor and re-render the same scene to two visible surfaces. Decide at implementation time. Doesn't block — it's a UX win, not a pipeline-correctness fix.

---

### GAP-009 — Export "Data Layer" picker: project data vs auto-regenerated

- **Severity:** high (key differentiator — flagged "КРУТАЯ ФИЧА" by user)
- **Reported:** 2026-04-30
- **Affects:** Export flow (deferred — will be tackled together with GAP-005 Export targets restoration)

**The idea:** every export should let the user pick which "data layer" feeds the writer:

1. **`Project data` (use my edits)** — export uses whatever's in the project store *right now*, i.e. the seeded rig from Init Rig **plus all user customisations made on top** (bone pivot tweaks, weight paint, custom deformer keyforms, manually-fixed iris/breath warps, etc.). What the user is editing in-app *is* what gets shipped.
2. **`Auto-regenerated` (fresh from PSD)** — ignore the project's seeded rig; pass `faceParallaxSpec: null, bodyWarpChain: null, rigWarps: null` into `generateCmo3` so cmo3writer's inline heuristics fire and produce a fresh rig from raw PSD geometry — exactly like upstream pre-v3 [cmo3writer.js](../reference/stretchystudio-upstream-original/src/io/live2d/cmo3writer.js) did when there was no project-side rig data layer. Useful for: clean baseline regeneration, sanity-check exports, regression-testing heuristic changes, or when the user's rig edits got into a bad state and they want to start over without rerunning Init Rig.

**Why it's a flagship feature:** SS's value prop sits exactly on this axis — "auto-rig is good enough, AND when it isn't you can edit on top, AND you can flip between the two cleanly". Most pipelines force one or the other.

**UI surface:** dropdown / radio in the v3 ExportModal (the same modal that GAP-005 will restore multi-target export to). Default = "Project data". Persist last-used choice per project.

**Implementation hook:** `exportLive2DProject` in [src/io/live2d/exporter.js](../src/io/live2d/exporter.js) currently does:

```
faceParallaxSpec = resolveFaceParallax(project);
bodyWarpChain   = resolveBodyWarp(project);
rigWarps        = resolveRigWarps(project);
if (!anySeeded) { harvest = await initializeRigFromProject(project, images); … }
```

For "Auto-regenerated" mode just force `faceParallaxSpec/bodyWarpChain/rigWarps` to `null` regardless of seeded state, then let cmo3writer's inline heuristics fire. That's it — the upstream-equivalent path is already inside `generateCmo3`; we're just choosing which inputs to send.

**Naming candidates:**
- "Data source": *Project edits* / *Regenerate from PSD*
- "Rig data": *Use my customisations* / *Fresh auto-rig*
- (User's framing): *Data layer = Stretchy Studio* / *Data layer = self-generated*

Pick at implementation time.

**Notes:** Pairs naturally with GAP-005 (multi-target export). Both should land in the same ExportModal overhaul. Don't ship one without the other — single-button export with no choice is the current state and shouldn't grow.

---

### GAP-008 — No opt-out for "rig hair" in Initialize Rig

- **Severity:** high
- **Reported:** 2026-04-30
- **Affects:** Init Rig flow on characters where the auto-detected hair rig is unwanted (wrong shape, breaks down, or character intentionally has rigid hair)

**Current state:** Initialize Rig auto-detects hair (front-hair / back-hair tags) and synthesises sway physics + warp deformers for them. There's no UI checkbox / option / config to skip the hair rig — even if the user wants every other rig output (face, body, eyes, mouth) but not hair, they get it anyway. The user has surfaced this multiple times: every Init Rig forces the hair rig, which is bad for short-hair / buzz-cut / accessory-hair characters where the auto-rig doesn't produce a useful result.

**What's needed (UX direction):**

A pre-init options panel (or an "advanced" expander on the Init Rig button) listing rig subsystems with checkboxes:

- ☑ Face / head rig (parallax, body angle X/Y/Z)
- ☑ Eye rig (closure, iris, eyeball)
- ☑ Mouth rig (open, smile, variants)
- ☐ Hair rig (sway physics, hair warp) ← **needs to be opt-out-able**
- ☑ Clothing rig (hem sway, basic deformers)
- ☑ Body warps (breath, body X/Y/Z)
- ☑ Arm physics (elbow pendulum)

User toggles before clicking Init Rig; unchecked subsystems are skipped entirely (no params registered, no deformers emitted, no physics entries).

**Implementation hook:** `resolveAutoRigConfig(project)` already exists in [src/io/live2d/rig/autoRigConfig.js](../src/io/live2d/rig/autoRigConfig.js) — extend it with per-subsystem booleans, surface them in a config panel, gate each subsystem's emit path on its flag. The config should persist in the project file so re-init keeps user preferences.

**Notes:** Related to BUG-008 (frozen layer after bone-move + Init Rig) and BUG-010 (Iris Offset broken after Init Rig) — collectively suggest Init Rig needs to be more controllable, not less. User-controlled gating is the orthogonal axis to "make rebuild non-destructive".

---

### GAP-004 — Audio + Spine export reachability through v3 needs verification

- **Severity:** low
- **Reported:** 2026-04-30
- **Affects:** Feature completeness through v3 shell

**Current state:** Both features are implemented:

- Audio tracks — `src/v3/editors/timeline/TimelineEditor.jsx` has full `useAudioSync()` + `AudioTrackRow` + `AudioTrackModal`
- Spine 4.0 export — `src/io/exportSpine.js:exportToSpine()`

But it's not confirmed both are surfaced through v3's UI in their final form. Spine export specifically: does the v3 ExportModal expose the Spine pathway, or only the Live2D `.cmo3` pathway?

**What to do:** Manual smoke-test in browser:
1. Open `src/v3/shell/ExportModal.jsx` — does it list Spine as an output target?
2. Drop an audio file onto the Animation timeline — does the v3 timeline accept it?

Not a fix yet; an audit task.

**Notes:** Promote to a real GAP entry only if smoke-test reveals a missing surface.

---

## Investigating

*(none yet)*

---

## Closed

*(none yet)*

---

## Verified shipped (looks-like-a-gap-but-isn't)

Items the casual code-reader might mistake for missing. Documented here so they don't get re-flagged.

| Feature | Why it looks missing | Where it actually is |
|---------|---------------------|---------------------|
| Automatic eye clipping | Grepping `eye_clip` / `iris_clip` returns nothing | Camel-case `irisClipping` flag in [editorStore.js:29](../src/store/editorStore.js#L29); stencil clipping in [scenePass.js:172](../src/renderer/scenePass.js#L172); mask configs at [io/live2d/rig/maskConfigs.js](../src/io/live2d/rig/maskConfigs.js) |
| Realistic limb bending | No "skinning" UI in v3 | Vertex-skinning rigs at [src/io/live2d/rig/](../src/io/live2d/rig/), applied during mesh upload in CanvasViewport pipeline |
| Drag-drop PSD/PNG/.stretch | No v3 shell handler visible | Routed through CanvasViewport's `onDrop` ([CanvasViewport.jsx:1319](../src/components/canvas/CanvasViewport.jsx#L1319)) which v3 mounts inside the Viewport area |
| DWPose auto-rig | "AI / ONNX" not visible in v3 shell | `loadDWPoseSession()` + `runDWPose()` in [io/armatureOrganizer.js](../src/io/armatureOrganizer.js); gated behind `mlEnabled` preference in PsdImportWizard |
| Blender-style shape keys | Not called "shape keys" anywhere | Variant system: [VariantTab.jsx](../src/v3/editors/properties/tabs/VariantTab.jsx) + `BlendShapeTab.jsx`; influence sliders driven by parameter values |
