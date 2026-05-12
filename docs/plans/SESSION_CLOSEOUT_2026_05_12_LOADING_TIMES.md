# Session Close-out — 2026-05-12 (Loading-Times Instrumentation deroute)

Sister to [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md) — same calendar day, decoupled work thread. User explicitly **derouted** from the queued Phase 2 BezTriple work to instrument loading times across the program "so we know how much we improved" before optimizing.

Two-stage ship per Rule №1 ("no quick fixes / no silent fallbacks"):

- **Stage 0** — substrate `475527e`: `logger.time/timeEnd/timed` helpers + 10 instrumented paths.
- **Stage 0.B** — audit-fix `8b99483`: 4 HIGH timer-leak fixes + 3 MED missed-path additions + 2 LOW polish + new `logger.timeEndIfRunning` helper + 54-assertion audit-pin.

Stage 1 (audit) ran in-session as two parallel `general-purpose` agents and produced the gap inventory; Stage 2 (optimization sweep) is **gated on user-side baseline measurements**.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `475527e` | feat(logger): loading-time instrumentation — `time/timeEnd/timed` helpers + 10 path coverage. New helper API in `lib/logger.js` (with `customMessage` 4th param for rich human-readable text); refactored 5 existing `performance.now()` callsites in SaveModal/initRig/RigService through the helper (Rule №2: one timing system, not two parallel ones); added timers to 6 previously-uninstrumented paths (boot, projectLoad, projectSave inner substages, psdImport finalize, migrations walker, exporter per-substage, lazy-load resolution). 10 source strings registered: `boot`, `projectLoad`, `projectSave`, `psdImport`, `rigInit`, `rigStageRun`, `migrations`, `export`, `lazyLoad`, `depgraph`. Net: +369 / −104 across 10 files. |
| `8b99483` | fix(audit): loading-times instrumentation Stage 0.B — 4 HIGH leaks + 3 MED missed paths + 2 LOW polish. HIGH G-1..G-4: every outer `time()` body now wrapped in try/catch, catch handlers use new `timeEndIfRunning` helper (silently no-op when conditional sub-timer wasn't opened). MED G-5..G-7: instrumented `psdImport:workerDecode` (RLE decode in psd.js), `projectSave:indexedDbBlob` + `projectLoad:indexedDbBlob` (IDB persist), `lazyLoad:onnxruntime` (DWPose dynamic import — heaviest in codebase). LOW G-8/G-9: `time()` overwrite WARN reports `orphanAgeMs`; `customMessage` JSDoc clarifies ms is not auto-appended. New helper `timeEndIfRunning` with explicit Rule №1 docstring (intentional opt-in for catch handlers, NOT silent fallback for sloppy pairing). Audit-pin: 54 assertions across 10 blocks. Net: +471 / −33 across 10 files. |

## What was the gap

Before this deroute, loading-time costs across the SS pipeline were anecdotal: "Init Rig feels slow on Hiyori-class projects", "export takes a while", "saving big projects freezes the UI". No instrumented baseline → no way to (a) know which path dominated wall time, (b) prioritize Stage 2 work, or (c) tell whether a future optimization actually helped vs caused a regression.

Five hand-rolled `performance.now()` callsites already existed in SaveModal / initRig / RigService — but they used different data field names (`elapsedMs` vs `ms`), inconsistent message formats, and didn't route through `lib/logger.js` (so the in-app Logs panel only saw some of them). Per Rule №2 ("no migration baggage / no parallel systems"), the substrate had to consolidate these AND extend coverage in the same sweep.

## The conversion

### Stage 0 substrate (`475527e`)

- **`lib/logger.js`** — added `time(source, label)`, `timeEnd(source, label, data?, customMessage?)`, `timed(source, label, fn, data?)` helpers. Module-scope `_timers: Map<string, number>` keyed by `${source}:${label}`. Per Rule №1: explicit WARN on overlapping `time()` start; explicit WARN + `null` return on unmatched `timeEnd()` — no silent fallback. Default emit shape: `INFO [<source>] <label>: <ms>ms { ms, ...data }`. `customMessage` overrides the default text only (ms stays in data, NOT auto-appended to the rendered string).
- **Existing callsites refactored** (SaveModal `executeSave`, initRig `initializeRigFromProject` outer + `rigInit:authored-path` inner + `rigInit:buildMeshes` + `rigInit:heuristic-path-generateCmo3`, RigService `runStage` + `refitAll`). The hand-rolled `t0 = performance.now()` boilerplate goes away; rich-message paths (SaveModal's "download OK: 14p / 8d / …") use `customMessage`.
- **Six previously-uninstrumented paths instrumented**:
  - `boot:reactRender` + `boot:firstPaint` (main.jsx) + `boot:idleDone` (idlePrefetch.js) — all milestones emitting `{ msSinceTimeOrigin }`. Bracket the full boot window: React render returns → first paint → idle-prefetch queue drained. (Note: prior `boot:moduleEval` interval timer was removed in the same sweep — it wrapped only the synchronous `createRoot().render()` dispatch, NOT actual module evaluation; honest milestone replaces it. See hotfix sweep `2026-05-12` for the rationale.)
  - `projectLoad:full` + `:unzip` + `:parseJson` + `:textures` + `:audio` (projectFile.js).
  - `projectSave:serialize:full` + `:textures` + `:audio` + `:zip` (inner timers; outer `projectSave:<mode>` stays in SaveModal).
  - `psdImport:finalize` + `psdImport:workerPool:composite` (CanvasViewport.jsx callback).
  - `migrations:walk:vN->vM` (skipped on no-op for already-current saves).
  - `export:live2d:full|cmo3:full` + 6 substages each (resolveKeyformSpecs, packAtlas, generateMoc3 sync, generateCmo3, generateCan3, lazyJSZip, zip).
  - `lazyLoad:rig:harvestPipeline` + `lazyLoad:seeds:11modules` (first-call only — subsequent calls share resolved promise).

`CURRENT_SCHEMA_VERSION` unchanged; no migration; no behavioral change to running code; no dead code introduced.

### Same-day dual audit

Per the **established convention** (memory: `feedback_dual_audit_after_phase_ship.md`), two parallel `general-purpose` agents ran against `475527e`. This time both audits were **filtered through Rule №1** (per the user's explicit request):

1. **Hot-spot audit** — for each of the 10 paths: primary cost driver + Rule №1-compliant improvement candidate + confidence calibration. Output framed as Stage 2 backlog. Identified 5 cross-cutting wins (highest leverage: `loadProjectTextures` serial loop in `imageHelpers.js:21` reaches 3 paths) and 5 path-specific candidates.
2. **Hygiene audit** — helper correctness, instrumentation completeness, timer-leak hygiene, parallel-system risk. Surfaced 4 HIGH timer-leak clusters (one per major path: initRig, exporter ×2, projectFile load+save, finalizePsdImport), 3 MED missed paths (PSD worker decode, IndexedDB I/O, ONNX dynamic import), 2 LOW polish (orphan-age in WARN, customMessage doc precision). Verified author's "skip" judgments on `sideBySide.js` and `operatorStore.js` were correct.

The audits are **orthogonal**: Queue A (hygiene) is "make the timers actually trustworthy"; Queue B (hot-spot) is "what to optimize". Both reports kept inline in the conversation; close-out captures the actionable findings.

### Audit-fix sweep (`8b99483`)

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| G-1 | HIGH | Hygiene | initRig.js: outer try/catch ends `rigInit:full` + `authored-path` via `timeEndIfRunning` on throw |
| G-2 | HIGH | Hygiene | exporter.js: outer try/catch on both `exportLive2D` + `exportLive2DProject`; inner try/finally around sync `generateMoc3` with `byteSize` fallback |
| G-3 | HIGH | Hygiene | projectFile.js: outer try/catch on `saveProject` (4 inner timers cleaned up) + `loadProject` (3 inner timers cleaned up) |
| G-4 | HIGH | Hygiene | CanvasViewport.jsx#finalizePsdImport: outer try/catch + moved `workerPool:composite` timeEnd INTO the existing `pool.destroy` try/finally |
| G-5 | MED | Completeness | psd.js#importPsd: `psdImport:workerDecode` covers worker round-trip (multi-second RLE decode for big PSDs — survey missed it) |
| G-6 | MED | Completeness | projectDb.js: `projectSave:indexedDbBlob` + `projectLoad:indexedDbBlob` cover IDB writes/reads (dominant on "Open from gallery" — survey missed) |
| G-7 | MED | Completeness | armatureOrganizer.js#_ensureOrt: `lazyLoad:onnxruntime` covers heaviest dynamic import (DWPose); error path also nulls `_ortPromise` for retry |
| G-8 | LOW | Polish | logger.js#time(): overwrite WARN reports `orphanAgeMs` so triage can distinguish "race" from "leaked-since-page-load" |
| G-9 | LOW | Polish | logger.js#timeEnd: JSDoc clarifies `customMessage` overrides text only — ms is NOT auto-inserted into the custom string |

**New helper**: `logger.timeEndIfRunning(source, label, data?)` — silently returns `null` when no matching timer exists, vs strict `timeEnd` which WARNs. Docstring explicitly cites Rule №1: "this is NOT a silent fallback for sloppy timer pairing — it is an explicit 'I don't know if this was opened' intent". Used by all 4 Queue A catch handlers to clean up conditional sub-timers without false-positive WARNs that strict `timeEnd` would emit.

**Audit-pin** `test_audit_fixes_2026_05_12_loading_times.mjs` — 54 assertions across 10 blocks:
- Block 1 (6): Helper API surface — `timeEndIfRunning` defined + exported + Rule №1 cited; `orphanAgeMs` in overwrite WARN; customMessage doc precision.
- Block 2 (5): Live behaviour via real `import('../../src/lib/logger.js')` — `timeEndIfRunning` returns `null` on no-match, returns `ms` on match, idempotent on second call; `timed` re-throws caller error; `timed` cleans registry on throw.
- Blocks 3-6 (one per HIGH): try/catch comment + `timeEndIfRunning` calls present in each leak-fix file.
- Blocks 7-9 (one per MED): logger import + `time/timeEnd/timeEndIfRunning` triple in each missed-path file.
- Block 10 (negative assertion): catch handlers use `timeEndIfRunning` consistently — no strict `timeEnd` inside `catch` blocks (would itself fire WARN if timer already-ended).

Wired into npm test chain after `auditFixes20260512Phase1Stage1eD1Reresolution`.

## Test scoreboard

All loading-times-touched suites green. Sister suites untouched (no behavioral change):

| Suite | Assertions |
|-------|------------|
| `test_audit_fixes_2026_05_12_loading_times` (NEW) | 54 |
| `test_initRig` | 60 |
| `test_runStageIntegration` | 31 |
| `test_projectRoundTrip` | 41 |
| `test_actionExportMotion3` | 39 |
| `test_actionExportCan3` | 30 |
| `test_PsdImportService` | 32 |
| `test_armatureOrganizer` | 47 |
| `test_migrationV37` (sample sister) | 57 |

Typecheck clean.

## Day-end commit chain (this sub-session only)

| Order | Commit  | What |
|-------|---------|------|
| 1     | `475527e` | feat(logger): loading-time instrumentation — `time/timeEnd/timed` helpers + 10 path coverage |
| 2     | `8b99483` | fix(audit): loading-times instrumentation Stage 0.B — 4 HIGH leaks + 3 MED missed paths + 2 LOW polish |
| 3     | (next)    | docs(plan): Loading-times instrumentation close-out doc (this file) |

## Schemas after this sub-session

`CURRENT_SCHEMA_VERSION = 38` unchanged. No migration; no project-shape change; no UI surface change; no runtime behavior change beyond the new logger entries.

## Hotkey reservations

None. Logs panel is opt-in via existing UI surface; no new keybindings.

## Status of Phase 1 Blender-parity work (unchanged by this deroute)

Phase 1.G manual Cubism Viewer .moc3 acceptance gates on **Shelby + test_image4** PSDs remain the only Phase 1 ship gate (per dual-PSD requirement shipped in `070ae5c` earlier the same day; see [STAGE1F_POST](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md) + [STAGE1E_D1_RERESOLUTION](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md)). Phase 2 (BezTriple handles, schema v39) blocks on 1.G manual confirmation. The user explicitly paused Phase 2 to run this loading-times deroute first.

## Resume paths for fresh session

### A. User-side baseline measurement (recommended next)

User opens the app, opens the Logs panel, runs the typical flow (cold-start → drop PSD → Init Rig → poke around → export → save → reload), captures the `{ ms }` numbers per source. Suggested capture sequence (from the conversation, copied here for resumability):

1. Cold-start the app — note `boot:reactRender`, `boot:firstPaint`, `boot:idleDone` (all milestones — `msSinceTimeOrigin` brackets the full perceived load window).
2. Drop `shelby_neutral_ok.psd` — `psdImport:workerDecode` (NEW post-`8b99483`) → wizard → finalize → `psdImport:finalize` + `workerPool:composite`.
3. Click Auto-organize (if used) — `lazyLoad:onnxruntime` (NEW, first time only).
4. Init Rig — `rigInit:full` + `buildMeshes` + `heuristic-path-generateCmo3` (+ `lazyLoad:rig:harvestPipeline` on first ever invocation; + `lazyLoad:seeds:11modules` on first seed).
5. Refit each stage — `rigStageRun:runStage:<stage>`.
6. Click Export — `export:cmo3:full` + per-substage; `export:live2d:full` if also runtime-exporting.
7. Save .stretch — `projectSave:<mode>` (outer) + `serialize:full|textures|audio|zip` + `projectSave:indexedDbBlob` (NEW, library mode).
8. Reload from gallery — `projectLoad:indexedDbBlob` (NEW) + `projectLoad:full` + per-substage + `migrations:walk:vN->v38` (only if older save).
9. Repeat the whole flow on `test_image4.psd` for anime-topology baseline.

### B. Stage 2 optimization sweep — gated on numbers from A

Audit Queue B (hot-spot, Rule №1-filtered). Prioritized by leverage; **start order should be confirmed against the actual numbers** so we don't optimize a path that the baseline shows isn't dominant. Headline candidates regardless of numbers:

| ID | Leverage | Where | Improvement |
|----|----------|-------|-------------|
| H-1 | ★★★ (3 paths) | `src/io/imageHelpers.js:21` | `loadProjectTextures` serial `for await Image.onload` → `Promise.all`. Reaches `rigInit`, `runStage` keyform stages, `export` keyform resolve. Single highest-leverage fix. |
| H-2 | ★★ | `src/io/live2d/rig/initRig.js:634` | `rigInitIdentityDiag` runs full `evalRig(rs, {})` unconditionally — gate on store flag, leave on for diag sessions. Cheap; pays back every Init Rig + Refit. |
| H-3 | ★★ | `src/components/canvas/CanvasViewport.jsx:1816+` | PSD finalize encodes PNG in worker then re-decodes via `<img>` for GL upload. Use `OffscreenCanvas.transferToImageBitmap()` zero-copy + keep PNG only for serialization. |
| H-4 | ★★ | `projectFile.js` + `exporter.js` | JSZip `{ compression: 'STORE' }` for PNG/audio entries (already-compressed); keep DEFLATE for project.json. Affects projectSave + live2d:zip. |
| H-5 | ★ | `src/io/live2d/textureAtlas.js:133` | `findMaxScale` runs MaxRectsPacker 16× during binary search; memoize fits/fails by scale precision. |
| H-6 | ★★ | `src/io/live2d/exporter.js:458` | `cmo3` per-part PNG render is `for...await` serial — parallelize via `Promise.all`. |
| H-7 | ★ | `src/io/projectFile.js:212` | `Image.onload` → `createImageBitmap(blob)` (off-main-thread decode + GPU-direct upload). |
| H-8 | ★ | `src/store/projectMigrations.js:945` | Single `nodesById` index built once at walk entry, threaded as ctx — v18/v19/v29/v32/v35 each rebuild internally. |
| H-9 | ★ | `src/lib/idlePrefetch.js` | Add `initRig.js` + `projectStoreSeeds.js` to idle queue — hides first-Init-Rig import cost behind first-paint idle. |
| H-10 | ★★ (boot) | `src/store/projectStore.js` | Split eager facade vs lazy actions — current 1849-line module loads ~30 store actions eagerly even though most are post-gesture. Biggest architectural lift. |

### C. Resume the queued Phase 1.G + Phase 2 thread

Independent of A/B above. User runs Phase 1.G manual gate on both PSDs (per `070ae5c`), then Phase 2 BezTriple work unblocks. The loading-times deroute does not block this thread — both can advance in parallel once the user is ready.

### Recommended order

A → B → C (or A → C while B optimizations run separately). The instrumentation must be exercised before optimization decisions are made; A is user-side and quick (~30 min for both PSDs). After A, B's first 2 candidates (H-1 + H-2) are unambiguous regardless of measured numbers and can ship without further input.

## Cross-references

- Stage 0 substrate: commit `475527e`
- Stage 0.B audit-fix: commit `8b99483`
- Audit-pin: [scripts/test/test_audit_fixes_2026_05_12_loading_times.mjs](../../scripts/test/test_audit_fixes_2026_05_12_loading_times.mjs)
- Helper module: [src/lib/logger.js](../../src/lib/logger.js)
- Sister close-out (same day): [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md)
- Phase 1 ship gate context: [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md)
- Memory: dual-audit-after-every-phase-ship pattern (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
- Memory: in-flight plans pointer (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_blender_parity_plans_in_flight.md`)
- Memory: loading-times instrumentation (NEW — `C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_loading_times_instrumentation.md`)
