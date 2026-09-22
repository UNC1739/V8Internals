# Phase 5 primer — JIT design and the four tiers

The [reference note](05-tiers) is terse and the [workbook](05-workbook) is hands-on. This is
the *why*: the design theory behind adaptive JIT compilers, then a dedicated section on each of
V8's four tiers — role, IR, cost, failure mode, and the exercise that shows it running.

Read this once for the mental model, then keep the reference note next to the source.

---

## Part 1 — JIT design theory

This part is engine-agnostic on purpose: it is the theory any adaptive JIT (HotSpot, JSC, SpiderMonkey, V8) is built on. Part 2 then grounds each idea in a specific V8 tier.

### 1.1 The problem a JIT exists to solve

JavaScript is delivered as source and must start running *now*. Two classic strategies each
lose at one end:

- **Pure interpreter.** Zero startup cost, but every operation pays dispatch + decode + dynamic
  type checks forever. Slow for hot code.
- **Pure ahead-of-time compiler.** Fast steady state, but you cannot AOT-compile JavaScript
  well: types are unknown until runtime, and compiling everything up front wastes time on code
  that runs once (most code runs once).

A **Just-In-Time** compiler resolves the tension by compiling *at runtime, on demand, using
information the interpreter has already observed.* Three empirical facts make this pay off, and
every design decision in Phase 5 traces back to one of them:

1. **The 90/10 rule.** A tiny fraction of functions dominate runtime. Spend compile budget only
   there, and only after they prove it.
2. **Type stability.** Although JS types are dynamic, at any given *call site* the same few
   object shapes recur. The site is dynamic in principle, near-static in practice. Runtime
   feedback captures this so the compiler can bet on it.
3. **Warmup is a curve, not a step.** A function is not "cold" then "hot"; it passes through
   warm. The height of each rung should match how much the function has proven itself so far.

**The warmup curve.** Plot cumulative time against invocations and you get the shape the whole
ladder is designed around:

```
 speed
   ^                                   ______ TurboFan  (fastest, expensive to reach)
   |                            ______/
   |                     ______/  Maglev
   |              ______/  Sparkplug
   |   __________/  Ignition
   +--------------------------------------------> invocations
       ^cheap start     ^each rung earns the next
```

The interpreter must win the *left* edge (start instantly), the top optimizer must win the
*right* edge (asymptotic speed), and the middle tiers exist so the curve has no cliff in
between. A one-JIT engine is a single diagonal line: either it starts too slow or it tops out
too low.

### 1.2 Compilation as an investment decision

The cleanest way to think about tiering is **economics**. Compiling a function is *spending* CPU
now to *save* CPU later. Whether it pays off depends on a simple inequality:

```
  compile_cost(tier)   <   remaining_runs × per_run_saving(tier)
```

You do not know `remaining_runs` in advance — so the engine treats past hotness as a predictor of
future hotness and raises its bet in stages. Each tier is a different point on the
cost/saving trade:

| tier | compile_cost | per_run_saving | good bet when |
| --- | --- | --- | --- |
| Sparkplug | tiny | small (~2×) | function ran more than a handful of times |
| Maglev | medium | large | function is clearly hot and shapes are stable |
| TurboFan | high | largest | function is *scorching* and stable enough to justify it |

This framing explains behaviors that otherwise look arbitrary:

- **Why not jump straight to TurboFan?** Because if `remaining_runs` turns out small, you burned
  an expensive compile for nothing. Cheap tiers are hedges against being wrong about hotness.
- **Why deopt back all the way to Ignition** (not to Maglev)? Because a deopt is *evidence the
  bet was mispriced*. Dropping to the interpreter re-collects feedback before re-investing.
- **Why concurrent compilation?** Because the compile_cost is paid on the main thread's clock
  unless you move it off — so V8 moves it off (1.9).

### 1.3 Adaptive optimization and the tiering ladder

Putting 1.1 and 1.2 together: you do not want *one* JIT, you want a **ladder**, each rung
matched to a point on the warmup curve.

```
              compile cost →   run speed →   IR
  Ignition    none             slow          bytecode
  Sparkplug   tiny             ~2x           none (one-pass)
  Maglev      medium           fast          SSA CFG (light)
  TurboFan    high             fastest       SoN → Turboshaft (full)
```

This is **adaptive optimization**, whose lineage runs from the **Self** language (Chambers,
Ungar, Hölzle, late 1980s) — which introduced polymorphic inline caches, dynamic deoptimization,
and type feedback — through Java **HotSpot** (the C1/C2 client/server split is exactly a two-tier
ladder) to every modern JS engine. V8's own history is the ladder *filling in*:

- **2008–2010:** a single JIT (full-codegen), then **Crankshaft** added as an optimizer.
- **2017:** **Ignition + TurboFan** — a clean interpreter feeding one strong optimizer.
- **2021:** **Sparkplug** — the gap from "interpret" to "TurboFan" was too wide; add a
  near-free baseline.
- **2023:** **Maglev** — warm-but-not-scorching functions still had no good tier; add a fast
  mid optimizer.

The number of tiers is not fundamental; it is the current best answer to "how many points on the
cost/saving curve are worth having a dedicated compiler for."

**The tier-up trigger.** Each function carries an **interrupt budget**
(`FeedbackCell.interrupt_budget_`), decremented on returns and on loop back-edges — so both
"called a lot" and "loops a lot" count as heat. When it hits zero, `TieringManager::OnInterruptTick`
(`src/execution/tiering-manager.*`) decides the next tier from invocation count and feedback
stability (it will *not* promote a site whose feedback is still churning). Approximate invocation
thresholds on this pin: **Maglev ~400, TurboFan ~3000, OSR ~500** (Android uses a higher Maglev
threshold, ~1000, because compile cost matters more there). *Watch the whole ladder in
[EX1](05-workbook).*

### 1.4 Type feedback and the degrees of polymorphism

Speculation needs something to speculate *on*. That something is **object shape**. V8 gives every
object a **Map** (a "hidden class", Phase 1) that encodes its layout; objects created the same way
share a Map. A property access is then "check the Map, load at a known offset" — which is only
possible because shapes are explicit and comparable.

An **inline cache** (Phase 2) records, per source site, which Maps have appeared. The number of
distinct Maps at a site — its **degree of polymorphism** — is the single most important input to
the optimizer:

| state | Maps seen | what the optimizer does |
| --- | --- | --- |
| **monomorphic** | 1 | specialize hard: one `CheckMaps`, direct offset load, inline the callee |
| **polymorphic** | 2–4 | emit a small switch over the known Maps, still fast |
| **megamorphic** | many | give up specializing; emit a generic dispatch (stub cache) |

Inline caching (Deutsch & Schiffman 1984; **polymorphic** ICs, Hölzle, Chambers, Ungar 1991) is
the hinge of the whole design because the feedback vector is simultaneously the **runtime fast
path** and the **compiler's input**. This is why "keep your objects the same shape" is *the*
JS performance rule: a site that stays monomorphic is a green light for every downstream
optimization; a site that goes megamorphic poisons speculation, inlining, and typing at once.
Feedback also records *representations* (was this number always a Smi? always Float64?), which
feeds representation selection (1.7, [EX3](05-workbook)).

### 1.5 Speculation and the guard/deopt contract

Here is the central idea of the whole phase, stated once:

> Optimized code is compiled against **assumptions drawn from feedback**, and every assumption
> is protected by a cheap runtime **guard**. If a guard fails, the code **deoptimizes**: V8
> discards it and rebuilds an interpreter frame, resuming as if the fast path never ran.

This is what lets a dynamically typed language run at near-static speed *safely*. The optimizer
compiles `a + b` as an integer add guarded by "a and b are Smis" — fast when the guess holds,
and correct (via deopt) when it does not. **Correctness never depends on the speculation; only
speed does.** The guards are cheap (a compare-and-branch) precisely so the fast path stays fast.
The common ones:

- **`CheckMaps`** — the object still has the shape we specialized for (shape stability).
- **`CheckSmi` / `CheckHeapObject`** — the value has the representation we assumed.
- **`CheckBounds`** — the index is inside the array we proved a length for.
- **`CheckString`, `CheckNumber`, `CheckInternalizedString`** — type-tag guards feedback implied.

Two flavors of assumption, guarded differently:

- **Local assumptions** (this value is a Smi) → an inline guard that deopts *eagerly* on failure.
- **Global assumptions** (nobody has changed `Array.prototype`) → too expensive to re-check per
  use, so instead a **dependency** is registered on a *validity cell* / *dependent code* list;
  when the world changes, all dependent optimized code is invalidated at once and deopts
  *lazily*. This is why mutating a prototype can silently de-optimize code all over the program.

*See the contract fire in [EX2](05-workbook) and [EX3](05-workbook).*

### 1.6 Deoptimization mechanics — the safety net in detail

New engineers read "deopt" as a bug. It is the opposite: deopt is the mechanism that *permits*
aggressive speculation in the first place. Its job is to reconstruct, at the exact failure point,
the interpreter state that the optimizer had dissolved.

**How a frame is rebuilt.** When TurboFan optimizes a function it also records, for each possible
deopt point, a **frame translation**: a recipe mapping optimized state back to interpreter state
— "interpreter register r0 is currently in machine register rax; r1 is the constant 3; the
accumulator is spilled at [rsp+16]." On deopt the **deoptimizer** (`src/deoptimizer/`) reads that
recipe (a `TranslatedState`) and materializes a fresh interpreter frame with every register and
stack slot in place, then resumes Ignition at the recorded **bytecode offset** as if the fast
path had never run.

Three subtleties make this the hard part of the engine:

- **Inlining unpacks.** If the optimizer inlined `g` into `f`, a single optimized frame must
  explode into *several* interpreter frames (`f` and `g` separately). The translation encodes the
  whole virtual call stack the optimizer had flattened.
- **Eliminated objects must be re-materialized.** If escape analysis ([EX5](05-workbook)) dissolved
  an object into registers and *then* the code deopts, the object has to be rebuilt on the heap
  before the interpreter can see it — the translation carries enough to reconstruct it.
- **Builtin continuations.** Deopt in the middle of an inlined builtin (say `Array.forEach`) needs
  to resume that builtin's loop, not restart it; V8 uses continuation frames for this.

**Kinds of deopt:**

- **Eager** — a guard failed in the current instruction; exit immediately via a deopt exit,
  rebuild, resume in Ignition.
- **Lazy** — the code was invalidated from outside (a prototype changed, a Map deprecated); it is
  marked and drops out on its next return or safepoint, not mid-instruction.
- **Soft** — a "we lack feedback here, go collect more" deopt, used to bail to the interpreter
  rather than compile on thin information.

**OSR is this machinery in reverse.** On-stack replacement ([EX6](05-workbook)) uses the same
kind of translation, but interpreter → optimized: it takes a live interpreter frame at a loop
header and materializes an *optimized* frame from it, so a running loop can speed up without
restarting. Deopt and OSR are two directions of one idea: a verified mapping between the state of
the same program at two different tiers.

A single deopt on a type transition is **routine and healthy**. The pathology is a **deopt loop**
— re-optimize on the same bad assumption, guard fails, deopt, repeat — which shows up as a
function that is hot but never stays optimized. That is a real performance bug worth chasing with
`--trace-deopt`.

### 1.7 Representation selection — the untagged story

A tagged value (Phase 1) is a machine word whose low bits say "Smi" or "pointer". Arithmetic on
tagged values is slow: untag, operate, re-tag, maybe box into a `HeapNumber`. The optimizer's
**representation selection** pass chooses, for every SSA value, a concrete machine representation —
`Tagged`, `Word32`, `Word64`, `Float64` — and inserts the minimum boxing/unboxing at the
boundaries where representations meet.

This is where a lot of real speed comes from and where a lot of intuition is wrong. The guards you
see in a deopt are on **representations chosen from feedback**, not on your mental model of the
values — which is exactly what [EX3](05-workbook) demonstrates: an integer that overflows Smi
range but still fits `Word32` does *not* deopt, because the pass had selected `Word32` for it. The
lesson: "is it a Smi?" is a question about representation, and representation is the optimizer's
decision, not yours.

### 1.8 IR design: SSA, sea-of-nodes, and why V8 is moving to a CFG

Optimizers work on an **intermediate representation**, and the shape of the IR determines which
optimizations are easy. Two ideas dominate:

- **SSA (static single assignment).** Every variable is assigned exactly once; where control flow
  merges, `phi` nodes select which definition reached the merge. SSA makes data flow explicit, so
  constant folding, dead-code elimination, and value numbering become almost trivial. Every modern
  optimizer (Maglev, TurboFan) is SSA-based.
- **Sea of Nodes (SoN)** (Click & Paleczny, 1995), TurboFan's historical frontend IR. It drops
  the notion of a fixed instruction order and represents a program as a graph with three edge
  kinds: **value** (data dependence), **effect** (ordering between operations that touch memory or
  the world), and **control** (branches/merges). Nodes "float" — they have no position until a late
  **scheduling** pass places them — which lets the optimizer move code freely as long as the three
  edge kinds are respected.

SoN is powerful but has real costs, which is why V8 is migrating to **Turboshaft**, a CFG-based IR
(explicit basic blocks in a fixed order):

- **Cache locality.** A big pointer-graph is cache-unfriendly to traverse; linear blocks are not.
- **Debuggability.** "Where is this node in the program?" has no answer until scheduling, which
  makes SoN graphs hard to reason about and to correlate with source.
- **Scheduling surprises.** Floating nodes can be scheduled in non-obvious places, causing
  performance cliffs that are hard to predict.

Turboshaft keeps SSA but fixes an explicit control-flow order up front, trading some of SoN's code-
motion freedom for locality and predictability. Wasm is already all-Turboshaft; the JS backend is,
and the frontend is migrating (via Maglev/Turbolev). (`docs/compiler/why-cfg.md`, v8.dev "Land ahoy".)

### 1.9 The backend: instruction selection, scheduling, register allocation

After high-level optimization, the backend turns the IR into actual machine instructions. Three
classic stages, each a whole subfield:

- **Instruction selection** — pattern-match IR subgraphs onto target instructions (fold
  `(a*b)+c` into a single fused multiply-add where the ISA has one).
- **Scheduling** — order the instructions to hide latency and respect dependencies.
- **Register allocation** — map the unbounded SSA values onto a finite register file, spilling to
  the stack when they do not fit. The two schools are **graph coloring** (model interference as a
  graph, color it with K registers; higher quality, slower) and **linear scan** (walk live
  intervals left to right; faster, good enough) — a JIT lives under a compile-time budget, so V8
  uses **linear-scan** allocation, with deferred blocks for cold paths so spills land off the hot
  path.

The through-line: an AOT compiler can afford the expensive backend algorithms; a JIT deliberately
picks the cheaper ones because *compile time is part of the program's running time*.

### 1.10 Method JITs vs tracing JITs (where V8 sits)

Two schools of adaptive JIT:

- **Tracing JITs** (TraceMonkey, LuaJIT, PyPy) record a *linear trace* of one hot loop path
  across function boundaries and compile that single path, guarding at every point where the real
  program could diverge from the trace. Brilliant on tight numeric loops; fragile on branchy or
  polymorphic code, where you get **trace explosion** (a trace per path).
- **Method JITs** (V8, JSC, HotSpot) compile whole *functions*, using **inlining** to cross call
  boundaries and **feedback** to specialize. More predictable across varied code shapes, at the
  cost of optimizing some code within a function that never actually runs hot.

V8 is firmly a **method JIT**. Inlining ([EX4](05-workbook)) is how it recovers the cross-function
optimization that tracing gets for free, and OSR ([EX6](05-workbook)) is how it still handles the
hot-loop-in-a-cold-function case that tracing was invented for.

### 1.11 Concurrency: compile off the hot path

Optimizing compilation is expensive, so V8 runs it on **background threads** while the main
thread keeps executing lower-tier code — directly paying down the `compile_cost` term from 1.2 by
moving it off the main thread's clock. The catch: a background compiler must not freely read the
mutator heap — objects move under the GC, Maps mutate, strings flatten, feedback changes. So it
works through a `LocalHeap`, **persistent handles**, and snapshot-like reads of feedback, and the
main thread is parked at **safepoints** when the heap must be touched coherently. Compilation is
split into three phases for exactly this reason: a main-thread **prepare** (read the heap safely),
a concurrent **execute** (optimize using only the snapshot), and a main-thread **finalize**
(install the code, register dependencies). This is why "just read the object from the compiler
thread" is unsafe, and why so much of `src/compiler/` is careful about what is main-thread-only.
(`docs/compiler/concurrency-and-background-compilation.md`.)

### 1.12 Why the JIT is a security-relevant subsystem

This course was spun out of an exploitation track, so it is worth naming *why* JITs are a favorite
target — as design consequences, not techniques:

- **Speculation trades safety checks for guards.** If the compiler's reasoning is unsound — a
  typer bug that concludes a value is always in a range it is not, an eliminated bounds check that
  was actually needed — the generated code omits a check the interpreter would have made. A
  correctness bug in an optimizer is therefore often a *memory-safety* bug, not just a wrong
  answer.
- **The JIT writes executable code at runtime**, so the pipeline from feedback to machine code is
  inside the trust boundary in a way an interpreter is not.
- **Deopt is a state-translation engine.** Anything that reconstructs frames, registers, and
  materialized objects from metadata is intricate, and intricate state machines are where bugs
  live.

The V8 **sandbox** (Phase 8) exists partly to contain the blast radius of exactly these bugs. For
this phase the takeaway is conceptual: *the optimizer's assumptions are a correctness contract,
and a broken assumption is a broken invariant, not merely a slow path.*

---

## Part 2 — the four tiers, one section each

### Tier 0 — Ignition (the interpreter)

- **Role:** run everything, immediately, and *collect feedback*. Every function starts here.
- **Input/IR:** register-based **bytecode** (`src/interpreter/bytecodes.h`), an accumulator plus
  a register file. No graph.
- **Design:** the bytecode handlers are themselves generated with CodeStubAssembler and share a
  dispatch table; the interpreter is a register machine, not a stack machine, which keeps
  bytecode compact. Feedback vectors are populated *here* — Ignition is the sensor the whole
  ladder depends on.
- **Cost/speed:** zero compile cost; slowest execution (dispatch + decode per bytecode).
- **Why it exists:** startup latency and memory. Most code runs once; interpreting it is
  cheaper than compiling it. Also the only tier that can run before any feedback exists.
- **See:** bytecode in [EX7](05-workbook) (shown next to its Sparkplug code); Phase 3 for the
  ISA itself.

### Tier 1 — Sparkplug (the baseline compiler)

- **Role:** remove interpreter overhead for warm code, as cheaply as possible.
- **Input/IR:** bytecode → machine code in **one linear pass. No IR at all.**
- **Design:** walk the bytecode once; emit a small stub of machine code per bytecode, mostly
  calls to the *same builtins Ignition already uses*. Frames are interpreter-compatible, so
  Sparkplug↔Ignition transitions are nearly free (no frame translation). It does **no**
  optimization, register allocation, or scheduling — deliberately.
- **Cost/speed:** compiles ~1000× faster than TurboFan; roughly 2× interpreter speed. The win is
  purely from deleting the fetch/decode/dispatch loop.
- **Why it exists:** the jump from Ignition to a real optimizer was too expensive to make early.
  Sparkplug is a cheap intermediate win V8 can afford almost eagerly. (`docs/compiler/sparkplug/`.)
- **See:** [EX7](05-workbook) — the BASELINE disassembly is literally annotated with each
  bytecode, `AddSmi` lowering to an `AddSmi_Generic_Baseline` builtin call.

### Tier 2 — Maglev (the fast optimizer)

- **Role:** give hot-but-not-scorching code real optimization without TurboFan's compile bill.
- **Input/IR:** a **static single assignment (SSA) CFG** — a real IR, but a simple one built in
  close to a single forward pass.
- **Design:** uses feedback (Maps, representations) to specialize and to do *light* speculation —
  it inserts guards and can deopt like TurboFan, but does far less heavy analysis. It has its own
  escape analysis, phi untagging, and a light typer-like range analysis, but not TurboFan's full
  lattice typer. Roughly ~10× slower to compile than Sparkplug and ~10× faster than TurboFan.
- **Cost/speed:** medium compile, most of TurboFan's win on typical code.
- **Why it exists:** the Sparkplug→TurboFan gap. Many functions deserve *some* optimization but
  never get hot enough to justify TurboFan; Maglev serves exactly them, and pre-warms the
  feedback TurboFan will later use. (`src/maglev/`, the Maglev blog post.)
- **See:** `--trace-maglev` dumps its IR as JSON; [EX6](05-workbook) OSRs into Maglev.

### Tier 3 — TurboFan (the full optimizer)

- **Role:** maximum throughput for the hottest code. Budget the most study time here.
- **Input/IR:** historically **Sea of Nodes** for the JS frontend; the backend and increasingly
  the whole pipeline are now **Turboshaft** (a CFG-based IR). On the default JS path both run:
  SoN frontend → converted to Turboshaft → Turboshaft backend.
- **Design — the pipeline is the syllabus.** `src/compiler/pipeline.cc` lists the phases in
  order; that list *is* a table of contents for optimization theory:
  - **graph building** from bytecode, with **inlining** ([EX4](05-workbook)) — the master pass.
  - **typing** — a real type lattice (`None ⊂ Smi ⊂ Number ⊂ … ⊂ Any`, plus Map sets and
    ranges) narrows values so checks can be proven redundant.
  - **typed lowering, load elimination, escape analysis** ([EX5](05-workbook)) — high-level JS
    operators become simplified operators; redundant loads and non-escaping allocations vanish.
  - **representation selection** ([EX3](05-workbook)) — choose Tagged / Word32 / Word64 /
    Float64 for every value and insert the box/unbox conversions. Underrated and central.
  - **simplified → machine lowering**, then the **backend**: instruction selection, scheduling,
    linear-scan register allocation, spilling.
- **Cost/speed:** expensive compile (run concurrently), fastest code.
- **Failure mode:** its speculation is defended by guards; a bad bet **deopts** all the way back
  to Ignition ([EX2](05-workbook)). Because it inlines, one deopt can unpack many frames.
- **Why Sea of Nodes is leaving:** floating nodes and late scheduling are cache-unfriendly, hard
  to debug, and full of scheduling surprises. Turboshaft's explicit CFG trades some optimization
  freedom for locality, predictability, and debuggability. Wasm is already all-Turboshaft; the
  JS frontend is migrating. (`docs/compiler/why-cfg.md`, v8.dev "Land ahoy".)
- **See:** [EX2](05-workbook)/[EX3](05-workbook)/[EX4](05-workbook)/[EX5](05-workbook), and
  Turbolizer (5.7 in the reference note) to step a function through every phase visually.

---

## Part 3 — how the tiers relate (one picture)

```
   source
     │  parse (Phase 3)
     ▼
  bytecode ──run & collect feedback──►  Ignition        (tier 0, always)
     │                                     │ warm
     │                                     ▼
     │                                  Sparkplug        (tier 1, ~2x, no IR)
     │                                     │ hot
     │                                     ▼
     │                                   Maglev          (tier 2, SSA, light speculation)
     │                                     │ very hot
     │                                     ▼
     └───────────── deopt ◄──────────  TurboFan          (tier 3, full opt + speculation)
                    (guard failed:        ▲
                     rebuild interp    OSR │ (hot loop, cold function — enter at loop header)
                     frame, resume)        │
                                        running loop
```

Three arrows are the ones people miss:

1. **Deopt goes *down*** — all the way to Ignition, not to the tier below ([EX2](05-workbook)).
2. **OSR goes *up mid-execution*** — you do not need a fresh call to optimize
   ([EX6](05-workbook)).
3. **Feedback flows *sideways*** — every tier reads and enriches the same feedback vectors, so
   time spent in Ignition/Maglev is what makes a good TurboFan compile possible.

Next: do the seven experiments in the [workbook](05-workbook), then take the
[self-check quiz](05-quiz.html).
