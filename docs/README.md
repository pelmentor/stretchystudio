# Stretchy Studio — Documentation

Stretchy Studio is a 2D rigging editor with a Live2D-style export pipeline and Blender-style authoring UX. This folder is the single source of truth for living trackers, active plans, and Live2D pipeline reference.

## Where do I look for X?

| I want to… | Go here |
|---|---|
| File a bug or check current bug status | [BUGS.md](BUGS.md) |
| File a missing feature or check gap status | [FEATURE_GAPS.md](FEATURE_GAPS.md) |
| Understand the project's data shape (what saves to `.stretch`) | [PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md) |
| Understand workspaces, edit modes, ModePill, canvas toolbar | [WORKSPACES.md](WORKSPACES.md) |
| Read what's still pending after the 2026-05-06 export polish push | [plans/POST_EXPORT_POLISH.md](plans/POST_EXPORT_POLISH.md) |
| See the bone-mode collapse plan (mostly shipped) | [plans/BONE_MODE_REFACTOR.md](plans/BONE_MODE_REFACTOR.md) |
| Export a Live2D model — formats, architecture, troubleshooting | [live2d/README.md](live2d/README.md) |
| Inspect `.moc3` binary layout | [live2d/MOC3_FORMAT.md](live2d/MOC3_FORMAT.md) |
| Inspect `.cmo3` Cubism Editor project layout | [live2d/CMO3_FORMAT.md](live2d/CMO3_FORMAT.md) |
| Track the byte-faithful warp evaluator port | [live2d/CUBISM_WARP_PORT.md](live2d/CUBISM_WARP_PORT.md) |
| Track the byte-faithful physics kernel port | [live2d/CUBISM_PHYSICS_PORT.md](live2d/CUBISM_PHYSICS_PORT.md) |
| Find a shipped plan or session post-mortem | [archive/](archive/) |

## Layout

```
docs/
├── README.md                     ← you are here
│
├── BUGS.md                       Living: bug tracker
├── FEATURE_GAPS.md               Living: feature gap tracker
├── PROJECT_DATA_LAYER.md         Living: project schema + integrity holes
├── WORKSPACES.md                 Living: workspace + edit-mode + toolbar contract
│
├── plans/                        Active plans (work pending / partial ship)
│   ├── POST_EXPORT_POLISH.md
│   └── BONE_MODE_REFACTOR.md
│
├── live2d/                       Current Live2D export reference + active ports
│   ├── README.md                 Index for the export pipeline
│   ├── ARCHITECTURE.md           Design decisions, data mapping
│   ├── MOC3_FORMAT.md            Binary format reference
│   ├── CMO3_FORMAT.md            Cubism Editor project format reference
│   ├── WARP_DEFORMERS.md         Warp coordinate system (RE notes)
│   ├── TEMPLATES.md              Live2D templates + 3D parallax research
│   ├── CUBISM_WARP_PORT.md       Living port plan (Phase 2b shipped)
│   ├── CUBISM_PHYSICS_PORT.md    Living port plan (Phase 2 shipped, Phase 3 pending)
│   ├── research/                 Paper notes on 2D-to-pseudo-3D parallax
│   ├── head-angle-x-technique/   RE notes for Hiyori AngleX
│   └── scripts/                  CAFF/.cmo3 dev-tool python scripts
│
└── archive/                      Trail of what's been shipped or superseded
    ├── README.md
    ├── plans-shipped/            21 shipped/superseded plans
    ├── sessions/                 SESSION_16..30 + DECISIONS log (gitignored)
    └── historical/               M5/M6 docs, *_implementation.md, legacy assets
```

## Conventions

- **Living docs** stay at the root and have a `Status snapshot` section near the top — the snapshot is the most recent truth, the body is detail.
- **Active plans** carry an explicit `**Status:**` line. When all phases ship, the plan moves to `archive/plans-shipped/` (renamed to drop the `_PLAN` suffix) with a `SHIPPED YYYY-MM-DD` banner; it is **not** deleted — the trail matters for regression hunts.
- **Archive is read-only.** If you find yourself editing something under `archive/`, stop — either it should be a living doc (move it back) or it shouldn't exist (let the git history hold it).
- **Cross-references use file-relative markdown links.** From this README, write `[BUGS.md](BUGS.md)` or `[live2d/MOC3_FORMAT.md](live2d/MOC3_FORMAT.md)`; from a sibling under `archive/plans-shipped/`, BUGS.md would be `../../BUGS.md`. VS Code, GitHub, and Claude Code all resolve them.
- **Code comments that point at docs** use the post-restructure path. If you move a doc, grep `src/` and `scripts/` and update the references in the same commit.

## What's NOT here

- **Per-session memory** — see `~/.claude/projects/.../memory/` (used by Claude Code; not committed).
- **Reference clones** (Blender source, upstream SS source, Live2D samples) — under `reference/` at repo root; gitignored.
- **External assets** (test PSDs, .cmo3 reference files) — under repo root or user paths; see [BUGS.md § Test setup](BUGS.md) for the canonical list.
