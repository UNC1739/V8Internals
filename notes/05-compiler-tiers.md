# Phase 5 — Compiler tiers

Dump: `notes/_proofs/dumps/05-tiers.txt`. Course facts: `research/FACTS.md` §1.1–1.2.

**Companions:** [JIT design + per-tier primer](05-jit-and-tiers.md) (the theory and a dedicated
section per tier) · [hands-on workbook](05-compiler-tiers-workbook.md) (seven predict-then-run
experiments) · [self-check quiz](05-quiz.html). Read the primer first if the tier ladder is new;
this note stays as the terse reference next to the source.

## 5.1 The ladder

Default JS on this pin:

| `--max-opt` | tier | IR | compile cost |
| --- | --- | --- | --- |
| 0 | Ignition | bytecode | none |
| 1 | Sparkplug | none (bytecode → machine, one pass) | tiny |
| 2 | Maglev | SSA CFG | ~10× Sparkplug |
| 3 | TurboFan | SoN **frontend** + **Turboshaft** CFG backend | expensive |

Not tiers: Turboshaft (TF's backend IR), Turbolev (`--turbolev`, default **false**: Maglev graph builder *instead of* SoN frontend).

Heuristics: `FeedbackCell.interrupt_budget_` decremented on returns and loop back-edges. Hits zero → `TieringManager::OnInterruptTick` (`src/execution/tiering-manager.*`). Invocation counts (this pin): Maglev 400, TurboFan 3000, OSR 500. Android Maglev 1000.

Promotion **updates the JSDispatchTable entry**, not a code pointer on the JSFunction. Dump showed `dispatch_handle: 0x135200`.

**Proof:**

```
[manually marking … add … for optimization to TURBOFAN_JS, ConcurrencyMode::kSynchronous]
[completed compiling … (target TURBOFAN_JS)]
[bailout (kind: deopt-eager, reason: not a Smi): … add …]
[marking … hotLoop … MAGLEV … reason: hot and stable]
[compiling … MAGLEV) OSR, … kConcurrent]
[compiling … TURBOFAN_JS) OSR, … kConcurrent]
```

`%OptimizeFunctionOnNextCall` forced TF on `add`. Hot loop OSR'd Maglev then TF concurrently.

## 5.2 Sparkplug

`src/baseline/`, `docs/compiler/sparkplug/compiler-sparkplug.md`. No IR. Linear pass over bytecode. Interpreter-compatible frames. Almost all work is calls to the same builtins Ignition uses. Exists to kill dispatch/decode overhead before Maglev/TF are ready.

Compare Sparkplug output to bytecode: each opcode → a builtin call + control flow. `--print-opt-code-filter` / disassembler.

**Proof** (`notes/_proofs/dumps/05-workbook/ex7-sparkplug.txt`, workbook EX7): the BASELINE disassembly under `--code-comments` is annotated with each bytecode, and `AddSmi` lowers to a call to the `AddSmi_Generic_Baseline` builtin — a linear per-bytecode walk, no IR.

## 5.3 Maglev

`src/maglev/`, Maglev blog. SSA CFG, fast, uses feedback, limited speculation vs TF. ~10× slower to compile than Sparkplug, ~10× faster than TF (F1.1.6; holiday recap said 20× / 10–100× — quote the post).

`--trace-maglev` dumps JSON. Lab `labs/03-pipeline/` already has Maglev vs TF CheckBounds behavior.

## 5.4 TurboFan overview

`src/compiler/pipeline.cc` is the table of contents. Default JS job (`!turbolev`):

1. `CreateGraph` — bytecode → **Sea of Nodes** (`GraphBuilderPhase`, inlining)
2. `OptimizeTurbofanGraph` — **TyperPhase**, TypedLowering, load-elim, escape analysis, **SimplifiedLowering**, schedule
3. `CreateGraphFromTurbofan` — SoN → Turboshaft
4. `OptimizeTurboshaftGraph`
5. `GenerateCodeFromTurboshaftGraph`

Typer still runs on the default path. Module 4's historical typer bugs remain a live *class* on that frontend (`research/FACTS.md` 1.2).

## 5.5 Sea of Nodes — and why V8 is leaving

Value / effect / control edges; nodes float; scheduling is late. Cache-unfriendly, hard to debug, scheduling surprises. `docs/compiler/why-cfg.md`, v8.dev "Land ahoy".

Wasm already all-Turboshaft. JS backend all-Turboshaft since ~M120. Remaining SoN: JS frontend (migrating toward Maglev/Turbolev) and some builtins.

`--trace-turbo` still dumps the SoN graph. Effect chain: follow effect edges from Start to Return; that is "memory order."

## 5.6 Turboshaft

`src/compiler/turboshaft/`. CFG, copying reducers (semi-space IR, nodes packed linearly), linear-scan RA. `docs/compiler/turboshaft/`. `--turboshaft` default true.

## 5.7 Turbolizer

`--trace-turbo` JSON + `tools/turbolizer/index.html`.

**Proof:** `add-add-0.json` (`notes/_proofs/dumps/`) for `function add(a,b){return a+b}`. SoN frontend then Turboshaft backend, in order:

```
V8.TFBytecodeGraphBuilder
V8.TFInlining
V8.TFEarlyGraphTrimming
V8.TFTyper
V8.TFTypedLowering
V8.TFLoopPeeling
V8.TFLoadElimination
V8.TFEscapeAnalysis
V8.TFSimplifiedLowering
V8.TFUntyper
V8.TFGenericLowering
V8.TFEarlyOptimization
V8.TFTurboshaftBuildGraph          ← SoN → CFG
V8.TFTurboshaftMachineLowering
V8.TFTurboshaftLoopUnrolling
V8.TFTurboshaftLoadElimination
V8.TFTurboshaftMemoryOptimization
V8.TFTurboshaftCodeEliminationAndSimplification
V8.TFTurboshaftDecompressionOptimization
V8.TFTurboshaftSpecialRPOScheduling
```

First graph already has `SpeculativeSmallIntegerAdd[SignedSmall]` (feedback → speculation). Bytecode in the same file: `Ldar a1; Add a0; Return`.

Open: serve `tools/turbolizer/` and drop the JSON on the page (needs `npm run build` once for the rollup bundle). The JSON *is* the pipeline; the GUI is a viewer.

## 5.8 Typer

`src/compiler/types.h`. Lattice (None ⊂ Smi ⊂ Number ⊂ NumberOrOddball ⊂ Any, plus heap-object maps, ranges, …). Feedback + graph structure narrow types. Unsound typer → eliminated checks → classic JIT bug class. Maglev/Turbolev do not use this typer.

## 5.9 Speculative optimization

Feedback → `CheckMaps` / `CheckSmi` / `CheckBounds` / `CheckHeapObject`. Lowering: JS operators → simplified → machine. Missed check = eager deopt.

**Trace of one LoadIC** (from 2.4 + 3.5 + 5.1):

1. Bytecode `GetNamedProperty a0, [0:"y"], FBV[0]`
2. Feedback slot: MONOMORPHIC Map + Smi handler offset 3
3. Maglev/TF: `CheckMaps` then a tagged load at header+offset
4. Machine: `cmp` Map word, `mov` from `[obj+12]` (3 × 4-byte tagged)

## 5.10 Key passes (minimal trigger)

| pass | trigger |
| --- | --- |
| inlining | small hot callee, monomorphic call |
| escape analysis | object never leaves the function |
| load elimination | two loads of same field, no interfering store |
| redundancy elimination | GVN / CSE |
| bounds-check elimination | typed index + known length (lab 03) |
| representation selection | see 5.11 |
| DCE | typer proves a branch dead |
| control-flow opt | jump threading, merge blocks |

## 5.11 Representation selection

Tagged vs Word32 / Word64 / Float64. Boxing/unboxing inserted at uses. A Smi-typed phi can stay Word32 until a generic `+` forces tagged. Dump: `add(1,2)` optimized; `add('x',1)` **deopt-eager, reason: not a Smi**.

## 5.12 Backend

`src/compiler/backend/`. Instruction selection, scheduling, linear-scan RA, deferred blocks, spilling. After the Turboshaft conversion this is the Turboshaft backend, not the old SoN instruction selector.

## 5.13 Deoptimization

`src/deoptimizer/`, `docs/runtime/deoptimization.md`. `DeoptimizeKind`: Eager, Lazy, LazyAfterFastCall.

- **Eager**: guard failed in this instruction (`not a Smi` on `add`). Immediate exit stub → `TranslatedState` rebuilds interpreter frame(s) from deopt data (literals, stack slots, registers, captured objects).
- **Lazy**: code marked invalid (prototype change, map deprecate); fires on next return/safepoint.
- Inlined frames unpack to several interpreter frames. Builtin continuations finish inlined builtins (e.g. `forEach` loop).

**Proof:** `deopt-eager, reason: not a Smi` on `add` at bytecode offset 2. Then `hotLoop` Maglev OSR also deopted `not a Smi` (accumulator of the loop exceeded Smi — `4999950000` is > 2^30-1).

## 5.14 OSR

Hot loop, cold function: back-edge budget compiles a version whose entry is the **loop header**. Dump: `(target MAGLEV) OSR` then `(target TURBOFAN_JS) OSR`. Frame is replaced mid-loop. Sparkplug↔Ignition OSR is nearly free (same frame). Maglev/TF OSR is real translation.

## 5.15 Concurrent compilation

Dump: `ConcurrencyMode::kConcurrent` for Maglev/TF OSR; `%OptimizeFunctionOnNextCall` was `kSynchronous`.

Background threads **must not** freely read the mutator heap: objects move, Maps mutate, strings flatten. They use `LocalHeap`, persistent handles, and snapshot-like reads of feedback. Safepoints park the mutator. `docs/compiler/concurrency-and-background-compilation.md`.

That is why a compiler thread cannot `job` an arbitrary JS object without a handle — the pointer may be stale or into from-space.

## 5.16 Code objects

`Code` (trusted metadata) vs `InstructionStream` (executable bytes, maybe external code space). Reloc info, safepoint table, deopt data, source positions. Sandbox: `JSFunction` holds a **dispatch handle**, not a raw code pointer.
