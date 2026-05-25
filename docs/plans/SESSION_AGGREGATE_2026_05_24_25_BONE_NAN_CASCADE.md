# Session aggregate 2026-05-24 / 2026-05-25 — Shelby bone-NaN cascade fix

Compact-resumption anchor for the autonomous bug-hunt that:

- **Reverted `1ada7b2`** (modifier-toggle reproject-abort) after user
  reported invisible body parts on Shelby — initial hypothesis was the
  abort path emitted the wrong chain. **REVERTED** as commit `675912b`.
- **Shipped `7ae01e4`** — `groupWorldMatrices` guard for the case where
  descendant meshes exist but all have zero vertices. Body parts
  (jacket, jeans) became visible. Bones still NaN — separate bug.
- **Diagnosed 4 rounds**, ending with the inline-message-string
  diagnostic in `95b3336` revealing the smoking gun:
  `firstPartVert0=[[object Object],[object Object]]`.
- **Shipped `94ae9f5`** — THE REAL FIX: `deriveCanvasPivot` handles
  BOTH the object-shape (`[{x, y, restX?, restY?}, ...]`, real PSD
  import shape) AND the flat-array shape (`[x0, y0, ...]`, test
  fixture shape) of `mesh.vertices`. Pre-fix the migration treated
  `verts[0]` uniformly as a number, producing `object - number = NaN`
  for real PSDs, cascading into bone `transform.pivotX/Y` →
  SkeletonOverlay NaN SVG flood.

Continues from `SESSION_AGGREGATE_2026_05_24_TS_CHECK_SWEEP.md` which
covered the morning's RULE-№4 follow-on + @ts-check sweep.

## What shipped — chronological

| # | Commit | Author | Slice | LOC | Notes |
|---|--------|--------|-------|-----|-------|
| 1 | `675912b` | Claude | **REVERT** `1ada7b2` (reproject-abort) | −280/+68 | User report: post-Init-Rig invisible body parts on Shelby. Hypothesis: abort path emitted wrong chain. Reverted; sister to `0687179` per the [[verify-mutation-path-before-prune]] lesson. |
| 2 | `1304fbf` | Claude | Audit-fix: annotate `1ada7b2` revert in session aggregate | +10/-5 | Architecture audit MED. Updated 4 sites in `SESSION_AGGREGATE_2026_05_24_TS_CHECK_SWEEP.md` to record the REVERT. |
| 3 | `7ae01e4` | Pelmentor | **Guard NaN bbox** in `groupWorldMatrices` empty-vertex descendant case | +40/-10 | Body parts became visible (warps now compute). Bones STILL NaN. Added regression tests (21/21). |
| 4 | `bc68c5b` | Claude | DIAGNOSTIC: NaN-pivot detection in `SkeletonOverlay` + `groupRotationToBone` | +53/+0 | Pure log, no behavior change. |
| 5 | `39faf3a` | Claude | Fix immer-extensibility bug in the new diagnostic | +13/−6 | The `__nanLogged` per-node property mutation throws on immer-frozen nodes — switched to module-level `Set` dedup. |
| 6 | `ffdc3fd` | Claude | **CRUTCH** — `Number.isFinite ? x : 0` boundary guards | +45/-7 | User reviewed: "No crutches" — these silent fallbacks mask real bugs. |
| 7 | `32706f8` | **BuildTools** (mis-authored — RULE-№5 violation) | REVERT `ffdc3fd` per RULE №1 | +7/-45 | `git revert --no-edit` used default git config because I forgot `GIT_AUTHOR_*` env vars. Lesson: [[git-revert-default-author]]. |
| 8 | `9209ca9` | Claude | DIAGNOSTIC: narrow to `computeGroupWorldMatrices.hasPivot` branch | +26/+0 | Probe: did NOT fire on retest → confirmed `computeGroupWorldMatrices` is NOT the NaN source. |
| 9 | `95b3336` | Pelmentor | DIAGNOSTIC: inline fields into log message string | +6/-18 | User's console-paste collapses `Object` payload to `[object Object]`. Inlining all fields into the string revealed the smoking gun: `firstPartVert0=[[object Object],[object Object]]`. Lesson: [[inline-diagnostic-fields]]. |
| 10 | `94ae9f5` | Pelmentor | **THE FIX** — `deriveCanvasPivot` handles both `mesh.vertices` shapes | +112/-2 | Discriminate object vs flat array, read `v.restX ?? v.x` for objects, preserve `v[0]/v[1]` access for flat. 3 regression tests added (15/15 total). Lesson: [[mesh-vertices-dual-shape]]. |

## The actual root cause (pinned 2026-05-25)

`mesh.vertices` has TWO canonical shapes in this codebase:

  (a) **Object array** `[{x, y, restX?, restY?}, ...]` — the
      runtime / PSD-import shape (per `exporter.js` line 493).
  (b) **Flat number array** `[x0, y0, x1, y1, ...]` — the
      test-fixture / some-synthesis-path shape.

`mesh.runtime.keyforms[i].vertexPositions` is ALWAYS the flat shape
(per `selectRigSpec._buildArtMeshes` writes `Float32Array(flatVerts)`;
`persistArtMeshRuntime` copies).

The pre-fix `deriveCanvasPivot` path 1 (in
`src/store/migrations/groupRotationToBone.js`) treated `verts[0]`
uniformly as a number:

```js
head = { x: verts[0] - kfv[0], y: verts[1] - kfv[1] };
```

Fine for shape (b). For shape (a) `verts[0]` is `{x, y, ...}`, and
`object - number === NaN` per JS coercion rules. NaN cascaded:

1. `migrateGroupRotationDeformersToBones` writes
   `group.transform.pivotX = head.x` (NaN)
2. `SkeletonOverlay.pivotScreenPos`: `wm[0] * NaN + ... = NaN`
3. `0 * NaN === NaN` in IEEE 754 — even though `parent_world[2] = 0`,
   the world-matrix cascade through `mat3Mul` propagates NaN to
   ALL descendants' `m[6..8]`
4. SVG attributes get NaN values, console flooded with warnings,
   bone-baked parts skin to NaN-pivot bones → invisible

Test fixtures only used shape (b) so the bug was undetectable in CI.
Real Shelby PSD triggered shape (a) → NaN cascade.

## The fix (commit `94ae9f5`)

```js
const verts = p.mesh?.vertices;
const kfv = kf?.vertexPositions;
if (!Array.isArray(verts) || !Array.isArray(kfv) || kfv.length < 2) continue;
let vx, vy;
const v0 = verts[0];
if (typeof v0 === 'object' && v0 !== null) {
  // Shape (a) — object array. restX/restY override x/y when present
  // (post-pose-bake convention, per exporter.js:493).
  vx = v0.restX ?? v0.x;
  vy = v0.restY ?? v0.y;
} else if (typeof v0 === 'number' && verts.length >= 2 && typeof verts[1] === 'number') {
  // Shape (b) — flat number array.
  vx = v0;
  vy = verts[1];
} else {
  continue;
}
if (typeof vx === 'number' && typeof vy === 'number') {
  head = { x: vx - kfv[0], y: vy - kfv[1] };
  break;
}
```

The math (`canvas vertex − pivot-relative keyform = canvas pivot`)
is identical for both shapes once read.

## RULE-№1 compliance — no crutches

Every commit in this session was audited against RULE-№1:

  - ✅ `7ae01e4` empty-bbox guard: matches the function's documented
    contract ("If the descendant set is empty, fall back to canvas
    centre") + logs WARN (not silent). Extended to cover the
    all-zero-vertex case (functionally the same as empty).
  - ✅ Diagnostic commits (`bc68c5b`, `39faf3a`, `9209ca9`, `95b3336`):
    pure logging, no behavior change, no silent fallbacks. Labeled
    `diag(rig):` not `fix(rig):`.
  - ❌ `ffdc3fd` `Number.isFinite ? x : 0` boundary guards: silent
    substitutions that mask upstream bugs. **REVERTED** by user
    direction ("No crutches"). Lesson lives in [[typeof-nan-is-number]].
  - ✅ `94ae9f5` shape-discriminate fix: reads correct field for each
    documented shape. No silent fallback. The math itself was correct
    — only the read site was wrong. Continue on unrecognized shape is
    fail-closed behavior (try next part, then path 2/3 of
    `deriveCanvasPivot`).

## RULE-№5 compliance — authorship

Tally for 2026-05-24/25 (this session):
  - 6 Claude commits (mechanical refactor / diagnostic / audit-fix /
    immer-fix / revert)
  - 3 Pelmentor commits (user-driven: the bbox fix, the inline
    diagnostic that pinned the bug, the actual fix)
  - 1 BuildTools commit (mis-authored revert — `git revert --no-edit`
    fell through to default git config when `GIT_AUTHOR_*` env vars
    were not set; can't be amended retroactively without destructive
    history rewrite). Lesson: [[git-revert-default-author]].

Going forward: explicitly pass `GIT_AUTHOR_*` + `GIT_COMMITTER_*` on
every `git revert`, even `--no-edit`.

## What's NOT in this fix

  - Doesn't unify the two `mesh.vertices` shapes upstream. Both are
    intentionally used (real PSDs vs test fixtures). The fix
    accommodates both at the read site.
  - Doesn't address the broken `typeof === 'number'` guards in
    `deformerNodeSync.js:110-111` or `buildRigSpecFromCmo3.js:490-491`.
    They pass NaN through (because `typeof NaN === 'number'` is `true`)
    but are no longer reachable from this NaN source after `94ae9f5`.
    Could be cleaned up in a future refactor; not blocking.
  - The diagnostic logs (`bc68c5b`, `9209ca9`, `95b3336`) stay live as
    observability for any future NaN regression at these sites.

## Open work — remaining viewport issues

User's 2026-05-25 post-fix screenshot shows:

  - ✅ Bones render correctly (no NaN flood)
  - ✅ Body (jacket + jeans) renders at correct position
  - ✅ Bone joint dots at correct positions on the body
  - ❌ **Head detached at top-left** (canvas ~320, 260) while body
    is at center (canvas ~900, 600). 580px gap between face mesh
    and `RigWarp_face` cage (which is at center per chainEvalLift).
  - ❌ **Arms not visible** — handwear-l/r bone-baked to leftElbow/
    rightElbow but not rendered (or rendered off-screen).

These are SEPARATE bugs from the NaN cascade. Possibilities for the
detached head:
  - (a) `Shelby_neutral_ok.psd` has head + body laid out separately
    by the artist (PSD-design choice, not a rig bug)
  - (b) Face's modifier chain has a bug — rest position doesn't
    align with its rigwarp cage
  - (c) Body parts get translated to canvas center by body warps,
    head parts don't get an equivalent translation

**Awaiting user clarification on expected layout** for this PSD
before pursuing further fixes. The original Shelby (anime-style
girl PSD with head above body) was the canonical test character;
this `Shelby_neutral_ok.psd` (man PSD) appears unusual.

## Validation summary

  - test:groupRotationMigration .......... 15/15 ✓ (was 12 + 3 new)
  - test:groupRotationMigrationRealRig ... 17/17 ✓
  - test:groupWorldMatrices .............. 21/21 ✓
  - test:selectRigSpec ................... 75/75 ✓
  - test:modifierStacks .................. 49/49 ✓
  - test:chainEval ....................... 25/25 ✓
  - npm run typecheck .................... clean

Runtime: Shelby_neutral_ok.psd → Init Rig succeeds, no NaN console
errors, body parts render correctly.

## Memory entries created

  - [[shelby-invisible-bones-fix-2026-05-25]] — the fix shipped
  - [[mesh-vertices-dual-shape]] — codebase dual-shape lesson
  - [[git-revert-default-author]] — env var trap on `git revert`
  - [[inline-diagnostic-fields]] — console-paste collapses Object payload

## Cross-references

  - [[typeof-nan-is-number]] — the broken guard pattern this bug
    exposed (typeof NaN === 'number' passes NaN through)
  - [[revert-reproject-abort-2026-05-24]] — sister revert (1ada7b2)
    on the same Shelby render-broken regression
  - [[verify-mutation-path-before-prune]] — the speculative-defensive
    pattern that landed `578540e` revert
  - [[feedback_verify_render_path_before_ui_fix]] — browser-verify
    requirement that this whole session enforced (4 user retests)

## Resume hint for compact

State at handoff:
  - Bone NaN cascade FIXED (`94ae9f5`)
  - Body+bones render correctly on Shelby_neutral_ok.psd
  - Diagnostic logs stay live (no perf concern — only fire on NaN)
  - **OPEN**: detached-head + missing-arms on this specific PSD
    (awaiting user clarification — may be PSD-design vs rig bug)
  - **OPEN**: dual-shape `mesh.vertices` is a footgun across the
    codebase — many other read sites might have similar bugs.
    `Number.isFinite` guards in `deformerNodeSync.js` + `buildRigSpecFromCmo3.js`
    could catch upstream NaN but are crutch-flavored; defer until
    a real upstream NaN source emerges (the boundary diagnostic added
    in `9209ca9` will surface it).
  - Working tree CLEAN. All commits pushed to origin/master.
