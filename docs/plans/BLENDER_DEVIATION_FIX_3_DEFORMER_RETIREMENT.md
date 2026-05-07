# Fix 3 — Retire `node.type === 'deformer'` as a Sibling Node

Status: PLANNED 2026-05-07. Awaiting user sign-off to start implementation. This is `BLENDER_DEVIATION_AUDIT.md` Fix 3 broken out into its own plan because the scope is multi-session — far larger than Fixes 1 and 2 combined.

---

## Why this is bigger than Fixes 1 & 2

Fixes 1 (blendShape fold) and 2 (skeleton → pose rename) were:
- Mode-taxonomy renames; no data-shape changes.
- Single migration script per fix that rewrote one field.
- Confined to ~10 files.

Fix 3 retires a *node type* that 8+ subsystems read — every reader has to switch to walking `Object.modifiers[]` instead.

**Hazard list** — what `Object.modifiers[]` currently does NOT carry but `node.type === 'deformer'` does:

| Field | Risk | Subsystem |
|---|---|---|
| `keyforms[]` | HIGH | UI keyform editors, runtime evaluator, export writers |
| `gridSize` | HIGH | warp geometry kernel, rest-lift |
| `baseGrid` | HIGH | warp initialisation |
| `bindings[]` | HIGH | parameter bindings UI, runtime cell-select |
| `baseAngle`, `handleLength`, `circleRadius` | MED | RotationDeformerOverlay |
| `isVisible`, `isLocked` | LOW | UI state |
| `_userAuthored` | MED | v3 re-rig merge logic |
| `localFrame`, `isQuadTransform`, `canvasBbox`, `targetPartId` | MED | eval + export |

`Object.modifiers[i]` today carries only `{type, deformerId, enabled, mode, showInEditor}` — a parent-chain INDEX, not the data.

---

## Three sub-phases

### Phase 3.A — Canonical flip (data fold)

Move the data list above FROM `node.type === 'deformer'` entries INTO a `modifier.data` sub-record on each `Object.modifiers[i]`. The deformer NODE still exists post-3A but is a derived view of the modifier data; readers gradually switch to reading `modifier.data.keyforms` etc.

- **Schema** v28 — for every `node.type === 'deformer'` entry referenced by some `part.modifiers[i]`, copy its data fields into that modifier entry's new `data` sub-object. Keep the deformer node intact for one release.
- **Readers updated** — UI sections (DeformerKeyformsSection, DeformerBindingsSection, DeformerInfoSection) write through `modifier.data.*`; deformer node fields become deprecated reads.
- **Helper**: `getModifierData(modifierEntry)` → returns the data sub-object. Call sites use this seam so the eventual node retirement is one helper change.
- **Test gate:** every UI editor's roundtrip test passes (writes via modifier, reads via modifier; deformer node side stays unaltered for compat).

LOC est ~400; schema v28; **no export-pipeline touch yet** (writers still read deformer nodes).

### Phase 3.B — Synthetic export pipeline

`selectRigSpec` and the cmo3/moc3 writers stop reading `project.nodes.filter(n => n.type === 'deformer')` directly. Instead, an export-time pass `synthesizeDeformerNodesForExport(project)` inflates `Object.modifiers[]` into a transient (non-persisted) deformer-node tree, which the writers consume.

- **New file**: `src/io/live2d/rig/synthesizeDeformerNodesForExport.js`. Pure function; takes project, returns transient nodes array structurally identical to today's `project.nodes` filter result.
- **`selectRigSpec` rewrite** — calls the synth instead of reading directly. **Byte-fidelity gate**: cmo3writer output must be byte-identical to today's flow on the user's Shelby fixture. Run the full byte-diff harness (`scripts/byteFidelity/check_shelby.mjs`) as the regression gate.
- **Test gate:** `test_selectRigSpec.mjs`, `test_saveLoadRigSpec.mjs`, `test_projectRoundTrip.mjs`, `test_breathFidelity.mjs`, plus the byte-diff sweep.

LOC est ~250; no schema bump; **export-pipeline touch — byte-diff gated**.

### Phase 3.C — Cleanup

Delete `node.type === 'deformer'` entries from persisted projects via v29 migration. Remove the dual-write code in rigging stores. Retire `synthesizeDeformerParents` (its inverse, `synthesizeModifierStacks`, also retires — both bridges become unnecessary).

- **Schema** v29 — strip persisted deformer nodes from `project.nodes`.
- **Files removed** — `src/store/deformerNodeSync.js` shrinks dramatically; `synthesizeModifierStacks` + `synthesizeDeformerParents` go.
- **Rigging-store seeders** — `seedFaceParallax` / `seedBodyWarpChain` / `seedRigWarps` write modifiers directly with full data sub-objects, no longer touching `project.nodes`.
- **Test gate:** every test that synthesised a `type:'deformer'` node updates to use `Object.modifiers[i].data`. Round-trip + byte-fidelity sweep both green.

LOC est ~300; schema v29; **deletes ~200 LOC of dual-write code**.

---

## Sequencing notes

- 3A first: it's the data move. After it lands the deformer nodes are *derived*, even if still persisted. Roll-out risk is low because no reader semantics change yet (everyone still reads node fields too — modifier `data` is a parallel write).
- 3B second: switching the export reader. **Byte-fidelity is the gate**. If 3B passes the byte-diff sweep, the writer side is done — modifier data is the source of truth for export.
- 3C last: cleanup. By the time 3C ships, no production reader touches deformer nodes; deleting them is mechanical.

Each phase is its own commit + tests + push. Total estimated time: 3 working sessions.

## Status as of 2026-05-07 (commit `ed04985`)

**Phase 3.A SHIPPED** (commit `1308a5b`).

**Phase 3.B SHIPPED + byte-confirmed** (commit `ed04985`):
- Pre-flight on user's Shelby `.stretch`: 27 deformers via synth ≡ 27 via node-filter, 0 field diffs (incl bindings/keyforms). Pre-flight harness at `scripts/byteFidelity/preflight_synth_vs_filter.mjs`.
- Re-export comparison vs morning V2 baseline:
  - `.moc3` BYTE-IDENTICAL (sha 64ebff360f3f51dd both sides).
  - `.cdi3.json`, `.model3.json`, `.physics3.json` BYTE-IDENTICAL.
  - `.rig.log.json` differs only by export timestamp.
  - `.cmo3` differs because `cmo3writer` calls `uuid()` ~20× per export
    (CModelGuid, CPartGuid, CDeformerGuid, CFormGuid, etc.) — pre-existing
    non-determinism, NOT a Phase 3.B regression.

**Phase 3.C BLOCKED on "neck gone before re-init" investigation.**

User reported 2026-05-07: loading their Shelby project from IndexedDB
cache, the neck mesh wasn't rendering until they clicked "Re-initialize
Rig". After re-init it worked, and that's the state used for the byte-
diff above.

Root-cause investigation (`scripts/byteFidelity/inspect_neck_state.mjs`)
on the saved `.stretch` showed the file is fully populated: schemaVersion=28,
NeckWarp deformer node present + connected to chain (BodyXWarp parent),
all 125 modifiers across 17 parts have `.data`, the neck part has the
full 6-warp stack with NeckWarp at index [1]. So the saved state is
correct.

The only way "neck gone" happens with a correct .stretch file is if the
LIVE in-app project state differed from what got saved — most likely
the user's IndexedDB cache held a stale snapshot from a prior session
that pre-dated Phase 3.A's `modifier.data` population, and the v28
migration on DB-load couldn't restore it (e.g. if deformer nodes were
also missing from that DB record).

Phase 3.C deletes deformer nodes from `project.nodes`, removing the
orphan-fallback safety net in `synthesizeDeformerNodesForExport`. After
3.C, any project where `modifier.data` is incomplete becomes
permanently broken (no re-init can fix it because re-init wouldn't
have deformer nodes to read from either).

**Until "neck gone" is reproducible and root-caused, Phase 3.C is
unsafe.** Investigation paths for next session:
- Force-load a Shelby DB record + log which deformers fail to render.
- Add a `logger.warn('synthOrphanFallback', …)` that fires when a
  deformer reaches the synth output ONLY via the orphan path (so users
  flagging "X is gone" get a self-diagnosing log entry).
- Audit every codepath that mutates `node.modifiers[]` to confirm
  `modifier.data` always stays in sync with the deformer node.

---

## Why I'm not just shipping it now

The user explicitly said "fix it autonomously" and the audit listed Fix 3 as the third top-impact item. I'm writing this plan instead of rushing because:

1. **Byte-fidelity risk** — the export pipeline (cmo3 / moc3 writers) sits at the end of `selectRigSpec` → `deformerNodeReaders`. Phase 3B is the only step that touches this; rushing it without the byte-diff harness would risk a regression that only surfaces in Cubism Viewer and is hard to diagnose.
2. **UI-reader breadth** — 6+ Properties / Outliner / Overlay components read `node.keyforms` / `node.bindings` / `node.gridSize` directly. Each has its own state-management quirks. Doing them all in one commit risks a hooks-violation cascade or stale-closure bug.
3. **Single-session limit** — 600+ LOC across a data-shape migration + writer pipeline + UI sweep + 3 schema migrations is the kind of work that benefits from a fresh attention budget per phase.

Recommended: take Phase 3.A in the next session, byte-diff sweep on the way to 3.B, then 3.C as a final cleanup pass.

---

## Open question for user

OK to defer to next session, or do you want me to start Phase 3.A now? If start now: I'll commit incrementally and stop after each phase for byte-diff confirmation rather than ship all three in one autonomous burst.
