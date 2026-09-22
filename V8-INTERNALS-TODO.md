# TODO — Understand V8 All The Way Down

A self-study track for someone who wants the whole engine in their head: every major
component, how they fit together, and *why* each one is shaped the way it is.

This is **not** an exploitation track. There's no flag at the end. The goal is that you can
open any file in `v8/src/` and know roughly why it exists.

**Notes (2026-09-22):** filled against cohort pin 15.3.76.13 in `notes/`. Proof dumps in
`notes/_proofs/dumps/`. Still open (upstream only):
9.4 land a patch upstream (needs Chromium Gerrit; not done from this tree).

---

## How to use this

**The one rule that makes this work: instrument the engine, don't just read it.**

Reading V8 source without running modified builds is how people spend six months and retain
nothing. Almost every task below ends in *"add a printf / patch a flag / dump the thing."*
That's the point. The engine is too large to hold by reading; you hold it by poking it and
watching what moves.

**Setup conventions:**

- Keep a `notes/` directory, one file per component. Write the note *after* you've made the
  engine print something that proves you understood it.
- Keep a debug build with `v8_enable_object_print=true`, `v8_enable_disassembler=true`,
  `v8_enable_slow_dchecks=true`, `symbol_level=2`. You want slow and loud, not fast.
- Also keep a `release + dcheck_always_on` build for anything that's too slow in full debug
  (GC stress, fuzzing, Wasm).
- Pin a commit. Re-pin deliberately every few months. Chasing tip-of-tree while learning
  means your notes contradict your build.
- Read `src/flags/flag-definitions.h` end to end, once, early. It's the best index to the
  engine's features that exists, and it's one file.

**Rough sequencing logic:** data representation → execution → optimization → memory → the
long tail. You can't understand the compilers without the object model, and you can't
understand GC pressure without knowing what allocates.

---

## Phase 0 — Ground yourself

- [x] **0.1** Build `d8` from your pin, debug profile. Time it. Know how long a rebuild costs
  you, because it determines how you'll work.
- [x] **0.2** Learn the incremental rebuild loop: touch one `.cc`, rebuild, measure. Get this
  under a couple of minutes or you'll avoid experimenting.
- [x] **0.3** Set up GDB with V8's `tools/gdbinit` plus GEF or pwndbg. Confirm `job`,
  `jco`, `jst` (or current equivalents) work on a live object.
- [x] **0.4** Read `src/flags/flag-definitions.h` cover to cover. Star ~30 flags that look
  interesting. This is your map.
- [x] **0.5** Tour the source tree top level. Write a one-line "what lives here" for every
  directory under `src/`. You'll be wrong about some; fix them as you go.
- [x] **0.6** Read the v8.dev docs index and the `//docs` directory in-tree. Note which design
  docs exist — you'll come back to them per-component.
- [x] **0.7** Learn to read the test suites: `test/mjsunit/` (JS-level), `test/unittests/`,
  `test/cctest/`. Tests are the best documentation V8 has. When a component confuses you,
  find its tests first.

---

## Phase 1 — Data representation

This is the foundation. Everything else is downstream of "how is a value stored."

- [x] **1.1 Tagging.** Smi vs HeapObject tagging. Read `src/objects/smi.h`, the tagging
  scheme docs. Understand the 32-bit vs 64-bit Smi range difference and why.
  *Prove it:* print raw tagged values and decode them by hand.
- [x] **1.2 Pointer compression.** The cage, the isolate root, compressed vs full pointers,
  decompression on access. Read the design doc and `src/common/ptr-compr*`.
  *Prove it:* take a compressed pointer from `%DebugPrint` output and reconstruct the full
  address manually in GDB.
- [x] **1.3 The Map (HiddenClass).** `src/objects/map.h` — instance type, instance size,
  bit fields, prototype, descriptor array, transition pointers.
  *Prove it:* dump a Map and annotate every field.
- [x] **1.4 Transition trees.** How adding properties walks/creates transitions; back
  pointers; how two objects come to share a Map. Read `src/objects/transitions.h`.
  *Prove it:* build a transition tree in JS and draw it from `--trace-maps` output.
- [x] **1.5 Descriptor arrays and property details.** Field vs constant, representation
  (Smi/Double/Tagged/HeapObject), field types, attributes.
  *Prove it:* trigger a representation generalization and observe the Map changing.
- [x] **1.6 Map deprecation and migration.** Why Maps get deprecated, what
  `MigrateToMap` does, why this exists at all. This is one of the least-understood and most
  interesting corners.
- [x] **1.7 In-object vs out-of-object properties.** Slack tracking — why V8 over-allocates
  in-object slots initially and then shrinks. Read the slack-tracking logic.
  *Prove it:* watch instance size shrink after enough instantiations.
- [x] **1.8 Dictionary mode.** When objects go slow, `NameDictionary` /
  `SwissNameDictionary`, and what you lose.
  *Prove it:* force dictionary mode three different ways.
- [x] **1.9 Elements kinds.** The full lattice: `PACKED_SMI` → `PACKED_DOUBLE` → `PACKED` →
  their `HOLEY_` counterparts → `DICTIONARY_ELEMENTS`. Read `src/objects/elements-kind.h`
  and `src/objects/elements.cc` (the elements accessor dispatch is a masterclass in C++
  template dispatch).
  *Prove it:* write a table of every transition and the JS operation that triggers it.
- [x] **1.10 Holes.** `the_hole` as a sentinel, why holey arrays are slow, prototype-chain
  lookups on holes.
- [x] **1.11 Strings.** This is a bigger topic than people expect: SeqString (one-byte vs
  two-byte), ConsString, SlicedString, ThinString, ExternalString, and the flattening rules.
  Read `src/objects/string.h`.
  *Prove it:* construct each string type from JS and identify it via `%DebugPrint`.
- [x] **1.12 String internalization** and the string table.
- [x] **1.13 Numbers.** Smi vs HeapNumber vs MutableHeapNumber, double boxing, when V8 can
  keep unboxed doubles.
- [x] **1.14 TypedArrays and ArrayBuffers.** Backing stores, on-heap vs off-heap,
  detaching, resizable ArrayBuffers, SharedArrayBuffer.
- [x] **1.15 Other exotic objects.** JSProxy, arguments objects, bound functions,
  `JSFunction` layout, `SharedFunctionInfo`, `ScopeInfo`, Context objects.
- [x] **1.16 Torque.** Read a few `.tq` files (`src/objects/*.tq`, `src/builtins/*.tq`).
  Understand that object layouts and many builtins are generated. Find the generated output
  in your build dir and read it.
  *Prove it:* trace one Torque-defined object field from `.tq` source to generated C++.

---

## Phase 2 — Property access and inline caches

The bridge between data representation and execution speed.

- [x] **2.1** The generic path: `LookupIterator` (`src/objects/lookup.h`). Read how a property
  lookup actually walks.
- [x] **2.2 Prototype chains.** Prototype Maps, prototype validity cells, why mutating a
  prototype invalidates caches globally.
  *Prove it:* invalidate a validity cell and watch ICs go megamorphic.
- [x] **2.3 Feedback vectors.** `src/objects/feedback-vector.h` — slot kinds, how feedback is
  allocated per function, lazy feedback allocation.
  *Prove it:* dump a feedback vector before and after a function warms up.
- [x] **2.4 IC states.** uninitialized → premonomorphic → monomorphic → polymorphic →
  megamorphic. Read `src/ic/ic.cc`.
  *Prove it:* drive one call site through every state and print the transitions.
- [x] **2.5 The megamorphic stub cache.** Hashing, the two-level cache, why it exists.
- [x] **2.6 Handlers.** Smi handlers vs code handlers, load/store handler encoding.
- [x] **2.7 Accessors and interceptors.** AccessorPair, AccessorInfo, API interceptors, and
  how they force slow paths.
- [x] **2.8 Property access on the global object** — why it's special (property cells).

---

## Phase 3 — Parsing and bytecode

- [x] **3.1 Scanner and parser.** `src/parsing/` — the scanner, the recursive descent parser,
  AST node types in `src/ast/`.
- [x] **3.2 The preparser and lazy parsing.** Why V8 skips function bodies on first pass and
  what it records instead. Read about preparse data.
  *Prove it:* use `--trace-parse` / parse-timing flags to see lazy vs eager decisions.
- [x] **3.3 Scope analysis.** `src/ast/scopes.*`, variable allocation, context allocation vs
  stack allocation, `ScopeInfo`.
  *Prove it:* find a case where a variable gets context-allocated and explain exactly why.
- [x] **3.4 Bytecode generation.** `src/interpreter/bytecode-generator.*`, the register
  allocator, the accumulator.
- [x] **3.5 The bytecode ISA.** Read `src/interpreter/bytecodes.h` — every bytecode, its
  operands, its operand scaling (Wide/ExtraWide prefixes).
  *Prove it:* hand-decode a `--print-bytecode` dump without reading the mnemonics column.
- [x] **3.6 Bytecode handlers.** How each bytecode's handler is generated via CodeStubAssembler,
  the dispatch table, the interpreter's register machine model.
- [x] **3.7 Bytecode peephole/optimizations** and the bytecode array layout
  (`BytecodeArray`, source position table, handler table, constant pool).
- [x] **3.8 Desugaring.** Find where these become bytecode: `for-of`, destructuring,
  optional chaining, class fields, spread.
  *Prove it:* pick three syntactic features and write out their bytecode shape.
- [x] **3.9 Generators and async functions.** How suspend/resume works at the bytecode level —
  the generator object, register file save/restore, `SuspendGenerator`/`ResumeGenerator`.
  This is one of the most satisfying things in the engine to finally understand.

---

## Phase 4 — Builtins and the runtime

- [x] **4.1 The four kinds of builtins:** C++ (`src/builtins/builtins-*.cc`), Torque, CSA, and
  platform assembly. Know which is which and why each exists.
- [x] **4.2 CodeStubAssembler.** Read `src/codegen/code-stub-assembler.h`. Understand it as a
  portable macro-assembler with a TurboFan backend.
- [x] **4.3 Torque as the modern layer on top of CSA.** Write a trivial Torque builtin and
  call it from JS. *This is the single highest-value hands-on exercise in this phase.*
- [x] **4.4 The runtime.** `src/runtime/` — when does compiled code call into the C++ runtime,
  and what does that cost.
  *Prove it:* use `--runtime-call-stats` (or current equivalent) on a workload and interpret it.
- [x] **4.5 Calling conventions.** JS calling convention, the dispatch/entry trampoline, how
  arguments and the receiver are passed, `CallInterfaceDescriptor`.
- [x] **4.6 Frames.** Read `src/execution/frames.h`. Know every frame type: interpreted,
  baseline, optimized, builtin exit, internal. Know how the stack walker works.
  *Prove it:* hand-walk a mixed stack in GDB across an interpreted → optimized boundary.
- [x] **4.7 Isolates, Contexts, and the embedder API.** `v8::Isolate`, `v8::Context`, native
  context vs context, `HandleScope`, `Local` vs `Persistent` vs `Global`, handle
  dereferencing, the handle scope stack.
  *Prove it:* write a small C++ embedder from scratch (~100 lines) that creates an isolate,
  runs a script, and exposes one native function. Don't skip this one.
- [x] **4.8 The snapshot.** Startup snapshot, context snapshot, the serializer/deserializer,
  read-only heap sharing, custom snapshots via `mksnapshot`.
  *Prove it:* build with and without the snapshot and compare startup time.
- [x] **4.9 Code cache.** Compile cache, code caching for scripts, what gets cached.

---

## Phase 5 — The compiler tiers

The heart of the engine. Budget the most time here.

- [x] **5.1 The tiering picture.** Current order: Ignition → Sparkplug → Maglev → TurboFan.
  Understand the tier-up heuristics: interrupt budgets, invocation counts, what triggers each
  promotion. Read `src/execution/tiering-manager.*`.
  *Prove it:* instrument tier-up decisions and graph a function's journey through all tiers.
- [x] **5.2 Sparkplug.** The baseline compiler: no IR, single pass over bytecode, why it's
  so fast to compile. Read the design doc and `src/baseline/`.
  *Prove it:* compare Sparkplug output to the bytecode it came from, side by side.
- [x] **5.3 Maglev.** Mid-tier: SSA-based, a real IR but fast compilation, no heavy
  speculation. Read `src/maglev/` and the design doc.
  *Prove it:* dump Maglev graphs on a small function and read them.
- [x] **5.4 TurboFan overview.** The full optimizing pipeline: phases, phase ordering, where
  each optimization happens. Read `src/compiler/pipeline.cc` — the phase list is a table of
  contents for the whole optimizer.
- [x] **5.5 Sea of nodes.** Understand it properly: value/effect/control edges, floating
  nodes, scheduling. Then understand **why V8 is moving off it** (`Turboshaft`) — the
  arguments about cache locality, scheduling complexity, and debuggability.
  *Prove it:* take a small function, dump the graph, and hand-identify the effect chain.
- [x] **5.6 Turboshaft.** The CFG-based replacement IR. Read `src/compiler/turboshaft/`.
  Understand what it changed and which parts of the pipeline it now owns.
- [x] **5.7 Turbolizer.** Get it running. Step a function through every pipeline phase
  visually. This tool is the difference between understanding the optimizer and pretending to.
- [x] **5.8 The typer.** Type lattice, how types are inferred and narrowed, `Type` in
  `src/compiler/types.h`.
- [x] **5.9 Speculative optimization.** How feedback becomes speculation: `CheckMaps`,
  `CheckSmi`, `CheckBounds`, and friends. Lowering from JS operators → simplified →
  machine operators.
  *Prove it:* trace one `LoadIC` from feedback vector through to a machine-level load.
- [x] **5.10 Key optimization passes,** one at a time, each with a minimal example that
  triggers it: inlining (and the inlining heuristics), escape analysis, load elimination,
  redundancy elimination, bounds-check elimination, representation selection, dead code
  elimination, control-flow optimization.
- [x] **5.11 Representation selection.** Tagged vs untagged, Word32/Word64/Float64, where
  boxing and unboxing get inserted. Underrated and important.
- [x] **5.12 Instruction selection, scheduling, register allocation.** The backend:
  `src/compiler/backend/`. Linear-scan register allocation, deferred blocks, spilling.
- [x] **5.13 Deoptimization.** The deoptimizer (`src/deoptimizer/`), deopt reasons, eager vs
  lazy vs soft deopt, translated frames, how the optimized frame is reconstructed into
  interpreted frames.
  *Prove it:* cause each deopt reason you can and read `--trace-deopt` for each. Then
  hand-reconstruct one deopt's frame translation.
- [x] **5.14 OSR (on-stack replacement).** How a running loop gets promoted mid-flight.
- [x] **5.15 Concurrent compilation.** Background compilation threads, what can and cannot be
  touched off the main thread, persistent handles, the `LocalHeap`, the compilation job
  lifecycle.
  *Prove it:* explain exactly why a background compiler thread can't just read the heap freely.
- [x] **5.16 Code objects.** `Code`/`InstructionStream` layout, relocation info, safepoint
  tables, deopt data, source position tables.

---

## Phase 6 — Memory management

- [x] **6.1 Heap layout.** Spaces: new space (semispaces), old space, large object space,
  code space, read-only space, trusted space. Read `src/heap/heap.h`.
  *Prove it:* place an object in each space deliberately and confirm with `%DebugPrint` /
  heap iteration.
- [x] **6.2 Allocation.** Bump-pointer allocation, linear allocation areas, allocation folding,
  allocation sites and pretenuring.
- [x] **6.3 The Scavenger.** Semispace copying collection, Cheney's algorithm, promotion
  rules, scavenger parallelism.
- [x] **6.4 Mark-Compact.** Marking, evacuation, compaction, sweeping. Read
  `src/heap/mark-compact.cc` — slowly.
- [x] **6.5 Incremental and concurrent marking.** The tri-color invariant, marking worklists,
  and why this is the hardest part of the GC to get right.
- [x] **6.6 Write barriers.** Why they exist, the generational barrier, the marking barrier,
  remembered sets, slot sets, typed slots. Read `src/heap/remembered-set.h`.
  *Prove it:* find the write barrier emission in generated code and explain when it's elided.
- [x] **6.7 Safepoints.** How V8 stops threads, stack scanning, conservative vs precise
  stack scanning (know which V8 uses where, and that this has been changing).
- [x] **6.8 Weakness.** WeakMap/WeakSet, weak references, ephemerons, FinalizationRegistry,
  and how ephemeron marking actually terminates.
- [x] **6.9 Handles and roots.** Root sets, handle scopes as roots, global handles, tracing
  handles for the embedder.
- [x] **6.10 Oilpan / cppgc.** The C++ garbage collector used for Blink objects, unified heap
  marking between V8 and Oilpan, cross-heap references.
- [x] **6.11 Heap profiling.** Heap snapshots, the sampling heap profiler, how retainer paths
  are computed.
  *Prove it:* take a heap snapshot from d8 and find a deliberate leak you planted.
- [x] **6.12 GC stress testing.** `--stress-gc`, `--gc-interval`, `--verify-heap`. Run a
  workload under heap verification and watch what it costs.

---

## Phase 7 — WebAssembly

Often skipped; it's roughly a second engine living inside the first.

- [x] **7.1** Module decoding and validation (`src/wasm/`).
- [x] **7.2 Liftoff** — the baseline Wasm compiler. Single-pass, fast.
- [x] **7.3 TurboFan for Wasm** and the Wasm tier-up story (and how it differs from JS tiering:
  no deopt, no speculation).
- [x] **7.4 Wasm object model.** `WasmInstanceObject`, `WasmTrustedInstanceData`, the
  in-sandbox vs out-of-sandbox split, indirect function tables, memory objects.
- [x] **7.5 JS ↔ Wasm boundary.** Wrappers, import/export call sequences, and the cost model.
- [x] **7.6 Wasm memory.** Bounds checking strategies, guard regions, trap handlers, 64-bit
  memory.
- [x] **7.7 Wasm GC and reference types** — the newer proposals and how they map onto V8's
  object model.

---

## Phase 8 — The long tail

The components everyone skips and then wishes they hadn't.

- [x] **8.1 Irregexp.** The regexp engine: parsing, the automaton, backtracking, the regexp
  bytecode interpreter, and native regexp code generation.
  *Prove it:* dump regexp bytecode with the relevant flag and trace a match.
- [x] **8.2 Promises and microtasks.** The microtask queue, job scheduling, how `await`
  desugars, and where the event loop boundary actually sits (spoiler: mostly in the embedder).
- [x] **8.3 The `Promise` fast path** and promise hooks.
- [x] **8.4 Debugger and inspector.** `src/debug/`, `src/inspector/`, the CDP protocol,
  breakpoints in bytecode vs optimized code, debug-evaluate, live edit.
  *Prove it:* set a breakpoint in optimized code and explain what V8 had to do to honor it.
- [x] **8.5 The profiler.** Sampling CPU profiler, tick processing, how ticks map to JS frames.
- [x] **8.6 Tracing and logging.** `--log-all`, `--prof`, the `tools/` directory —
  `system-analyzer`, `tickprocessor`, map processor. Most of these are undiscovered by most
  V8 users.
- [x] **8.7 Intl / ICU integration.**
- [x] **8.8 The V8 Sandbox as an architecture** (not as an attack surface): the cage, external
  pointer table, trusted space, code pointer table, JSDispatchTable / leaptiering. Understand
  why each indirection exists from a *design* standpoint.
- [x] **8.9 Threading model.** Isolates as the unit of isolation, the platform interface,
  task runners, worker threads, SharedArrayBuffer and the shared heap work.
- [x] **8.10 Embedder integration.** How Node and Chrome each drive V8 differently: microtask
  policy, snapshots, external memory accounting, the ArrayBuffer allocator.

---

## Phase 9 — Synthesis

Do these when the phases above feel solid. They're the ones that actually consolidate it.

- [x] **9.1 Trace one function end to end.** Pick a nontrivial JS function. Follow it: source →
  preparse → parse → AST → bytecode → feedback accumulation → Sparkplug → Maglev → TurboFan →
  deopt → back to bytecode. Write it up with real dumps at each stage. This is the capstone.
- [x] **9.2 Trace one property access end to end.** `obj.x` from parser through bytecode,
  through IC miss → handler installation → monomorphic hit → TurboFan inlining of the load →
  the eventual machine instruction.
- [x] **9.3 Trace one allocation end to end.** From `new Foo()` through the allocation path,
  into new space, surviving a scavenge, promotion to old space, and eventual collection.
- [ ] **9.4 Write a small patch and land it upstream.** A docs fix, a test, a small cleanup.
  The code review process teaches you the project's actual values faster than reading does.
- [x] **9.5 Read six months of `git log` on `src/compiler/`.** Skim commit titles, open the
  interesting ones. This is how you develop a feel for where the engine is *going*.
- [x] **9.6 Write the explainer you wanted at the start.** Pick the component you found worst
  documented and write it up properly. Teaching is the test.

---

## Standing habits

- [x] **H.1** Subscribe to the v8.dev blog and the v8-dev mailing list. Skim design docs as
  they appear.
- [x] **H.2** When a new optimization or component lands, find its CL, read the description and
  the tests before the code.
- [x] **H.3** Keep a "things I don't understand yet" list. It should grow for the first year.
  That's the correct behavior, not a problem.
- [x] **H.4** Re-pin every few months and diff your notes against reality. The engine will have
  moved. Especially the compiler pipeline.

---

## Reading list (verify links; several of these move)

**Primary, in priority order:**
- v8.dev/blog — the whole archive is worth skimming; the deep posts (Maglev, Sparkplug, Sea of
  Nodes departure, pointer compression, Orinoco series, Ignition/TurboFan) are the best
  single source.
- v8.dev/docs — official docs including the sandbox docs.
- In-tree `//docs` and design docs linked from `//docs/README.md`.
- The V8 source itself, especially: `src/flags/flag-definitions.h`, `src/compiler/pipeline.cc`,
  `src/objects/*.h`, `src/heap/heap.h`, `src/interpreter/bytecodes.h`.

**Secondary:**
- Franziska Hinkelmann's talks and posts on V8 internals.
- Mathias Bynens / Benedikt Meurer talks on element kinds, ICs, and the object model —
  the element-kinds material in particular is definitive.
- Vyacheslav Egorov's writing on JIT internals and optimization (broad and deep; not all
  V8-current but conceptually excellent).
- Jay Conrod's V8 internals writeups.
- The "JS engine fundamentals" series.

**Adjacent theory worth having:**
- Any solid compiler book for SSA, dataflow analysis, and register allocation.
- *The Garbage Collection Handbook* (Jones, Hosking, Moss) — the GC phase will click much
  harder with it.
- Papers on sea of nodes (Click & Paleczny) and on inline caching (Hölzle, Chambers, Ungar).

---

## Realistic expectations

- Phases 1–3 are a few weeks of evenings. Phase 5 alone is months. Phase 6 is months.
- The compiler and GC phases have the steepest ratio of "time spent" to "pages read." That's
  normal — you're building mental models, not consuming text.
- You will forget Phase 1 details while doing Phase 5 and have to go back. Build the notes
  directory so going back is cheap.
- The pipeline content ages fastest. Object model and GC fundamentals age slowly. If you're
  time-constrained, front-load the durable parts.
