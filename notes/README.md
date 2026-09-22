# V8 internals notes (cohort pin)

Self-study notes for `V8-INTERNALS-TODO.md`. One file per phase. Written against the **cohort pin**, not `main`.

| | |
| --- | --- |
| V8 | **15.3.76.13** `d1fed5cd7e3b114dea70f18b20d26f816322833d` |
| Chrome | M153 (`153.0.8010.52`) |
| Tree | `build/checkouts/cohort/v8` |
| d8 | `build/artifacts/cohort/teaching-debug.sandbox-on/d8` |
| Proofs | `notes/_proofs/` (JS) and `notes/_proofs/dumps/` (raw `%DebugPrint` / traces) |

Convention: a note is done when a dump in `_proofs/dumps/` shows the claim. Source paths are pin-relative (`src/...`). In-tree design docs live under `docs/` in that checkout — they are the best index after `src/flags/flag-definitions.h`.

## Files

| File | Phase |
| --- | --- |
| [00-ground.md](00-ground.md) | 0 — build, flags, `src/` map, tests, gdbinit |
| [01-data-representation.md](01-data-representation.md) | 1 — tagging, compression, Maps, elements, strings, Torque |
| [02-property-access.md](02-property-access.md) | 2 — LookupIterator, ICs, feedback, handlers, globals |
| [03-parsing-bytecode.md](03-parsing-bytecode.md) | 3 — parser, Ignition ISA, desugaring, generators |
| [04-builtins-runtime.md](04-builtins-runtime.md) | 4 — Torque/CSA/C++/ASM, frames, isolate, snapshot |
| [05-compiler-tiers.md](05-compiler-tiers.md) | 5 — Ignition → Sparkplug → Maglev → TurboFan/Turboshaft, deopt, OSR |
| [06-memory.md](06-memory.md) | 6 — spaces, scavenger, mark-compact, write barriers, handles |
| [07-wasm.md](07-wasm.md) | 7 — Liftoff / Turboshaft, object model, JS boundary |
| [08-long-tail.md](08-long-tail.md) | 8 — Irregexp, promises, inspector, sandbox-as-architecture |
| [09-synthesis.md](09-synthesis.md) | 9 — one function / load / allocation end to end |
| [09-compiler-log.md](09-compiler-log.md) | 9.5 — compiler direction (shallow clone) |
| [unknown.md](unknown.md) | H.3 — things I don't understand yet |
| [habits.md](habits.md) | H.1–H.4 standing habits |
| [embedder/hello.cc](embedder/hello.cc) | 4.7 — Isolate + nativeAdd (printed 42) |
| [04-torque-builtin.md](04-torque-builtin.md) | 4.3 — Math.is42 (reverted) |

Exploitation course material stays in `TODO.md` / `labs/` / `research/FACTS.md`. These notes are the engine-background track.

## How to re-run proofs

```sh
D8=build/artifacts/cohort/teaching-debug.sandbox-on
( cd "$D8" && ./d8 --allow-natives-syntax ../../../../notes/_proofs/01-tagging-maps-elements.js )
```

`cd` into the artifact dir so `snapshot_blob.bin` / `icudtl.dat` resolve.
