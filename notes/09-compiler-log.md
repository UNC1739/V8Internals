# 9.5 — Where `src/compiler/` is going

The cohort checkout is **shallow** (`git rev-parse --is-shallow-repository` → true). `git log --since=2026-03-01 -- src/compiler/` only shows the pin bump `d1fed5cd Version 15.3.76.13`. Cannot walk six months locally without `git fetch --unshallow` (do not do that to the shared tree).

Direction from primary sources + in-tree docs, still valid at 15.3:

1. **Leave Sea of Nodes.** JS backend already Turboshaft CFG. Default JS frontend still SoN (`CreateGraph` → `OptimizeTurbofanGraph` → convert). Proven by `add-add-0.json` phase list: last SoN pass `V8.TFEarlyOptimization`, then `V8.TFTurboshaftBuildGraph`.
2. **Turbolev** (`--turbolev`, default **false**): Maglev graph builder *instead of* the SoN frontend, then Turboshaft. Files: `src/compiler/turboshaft/turbolev-graph-builder.*`, `turbolev-frontend-pipeline.*`. Tests moved to `test/mjsunit/turbolev/` (~late 2025). This is the intended 4th-tier replacement, not a 5th tier.
3. **Renames 2025–2026:** Maglev-to-ts → Turbolev; `--maglev-truncate-int32-phis` → `--turbolev-truncate-int32-phis`; Wasm-in-JS wrapper inlining on the Turbolev path (experimental, some reverts).
4. **Wasm** already all-Turboshaft. No deopt.
5. **Cache locality / copying IR** (`docs/compiler/turboshaft/compiler-turboshaft-copying-approach.md`) is the stated reason, not "CFG is more optimizing."

When you can unshallow or clone full: `git log --since=6.months --oneline -- src/compiler/ | rg -i 'turbolev|turboshaft|son|typer'`.
