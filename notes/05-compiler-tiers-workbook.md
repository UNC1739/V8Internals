# Phase 5 workbook — tiers, deopt, and the optimizer, hands-on

A companion to [`05-compiler-tiers.md`](05-compiler-tiers.md). That note is the map;
this is the field trip. Seven experiments you **run yourself** on the cohort-pin `d8`,
each in the shape *predict → run → check → explain*. Do the predicting out loud before
you run. The gap between your prediction and the real output is where the learning is.

Every command and every quoted output here was produced on the pin (`V8 15.3.76.13`).
Scripts: [`_proofs/05-workbook/`](_proofs/05-workbook/). Captured output:
[`_proofs/dumps/05-workbook/`](_proofs/dumps/05-workbook/).

## Setup

```sh
D8=../V8Pwn/build/artifacts/cohort/teaching-debug.sandbox-on
run() { ( cd "$D8" && ./d8 --allow-natives-syntax "$(cd notes/_proofs/05-workbook && pwd)/$1" "${@:2}" ); }
```

Then each exercise is `run ex1-four-tiers.js --trace-opt` and so on. `--allow-natives-syntax`
turns on the `%Native` helpers (`%OptimizeFunctionOnNextCall`, `%ActiveTierIsMaglev`, …); the
teaching build already allows them.

The natives that matter here:

| Native | Does |
| --- | --- |
| `%PrepareFunctionForOptimization(f)` | arm `f` for the manual-optimize helpers (required first) |
| `%CompileBaseline(f)` | force-compile `f` to Sparkplug |
| `%OptimizeMaglevOnNextCall(f)` | next call compiles `f` with Maglev |
| `%OptimizeFunctionOnNextCall(f)` | next call compiles `f` with TurboFan |
| `%OptimizeOsr()` | OSR the loop currently running |
| `%ActiveTierIs{Ignition,Sparkplug,Maglev,Turbofan}(f)` | which tier `f` runs in now |

---

## EX1 — Watch one function climb all four tiers

Script: `ex1-four-tiers.js`. Concept: 5.1, the tier ladder.

The engine has four tiers for JS: **Ignition** (bytecode interpreter), **Sparkplug**
(baseline, no IR), **Maglev** (fast SSA), **TurboFan** (full optimizer). Normally the
tiering manager decides when to climb, using interrupt budgets. Here we drive it by hand so
every step is visible.

```js
function work(x) { return x * 3 + 1; }
%PrepareFunctionForOptimization(work);
work(1);                                     // step 1
%CompileBaseline(work); work(1);             // step 2
%OptimizeMaglevOnNextCall(work); work(1);    // step 3
%OptimizeFunctionOnNextCall(work); work(1);  // step 4
```

**Predict:** after each step, what does `%ActiveTierIs…` report?

**Run:** `run ex1-four-tiers.js --trace-opt --trace-baseline`

**Real output:**

```
1. after first call        : Ignition
[completed compiling <SharedFunctionInfo work> (target BASELINE) - took 0.123 ms]
2. after %CompileBaseline  : Sparkplug
[compiling method <JSFunction work> (target MAGLEV), mode: kSynchronous]
3. after Maglev on next    : Maglev
[compiling method <JSFunction work> (target TURBOFAN_JS), mode: kSynchronous]
4. after TurboFan on next  : TurboFan
```

**What happened:** one function, one address, four different bodies of machine code over its
life. Note the compile order matches the ladder — you cannot ask for TurboFan without the
function existing at a lower tier first. In real code the same climb happens on its own once
`work` gets hot; `--trace-opt` shows the reason as `hot and stable`.

**Go further:** delete the natives and instead call `work` 30000 times in a loop under
`--trace-opt`. You will see it reach Maglev via `reason: hot and stable` with no help. Reaching
TurboFan naturally needs a lot more heat, which is the point — most functions never deserve it.

---

## EX2 — Cause a deopt by breaking a type guess

Script: `ex2-deopt-type.js`. Concept: 5.9 speculation, 5.13 deoptimization.

Optimized code is built on **assumptions from feedback**. `add(a,b)` that has only ever seen
small integers gets compiled with a guard: *"trap out if either operand is not a Smi."* Feed
it a string and the guard fires.

```js
function add(a, b) { return a + b; }
%PrepareFunctionForOptimization(add);
add(1, 2); add(3, 4);            // feedback: SignedSmall + SignedSmall
%OptimizeFunctionOnNextCall(add);
add(5, 6);                       // fast path
add('x', 'y');                   // guard fails here
```

**Predict:** what is the deopt *reason*? Which tier is `add` in afterward?

**Run:** `run ex2-deopt-type.js --trace-opt --trace-deopt`

**Real output:**

```
warm  : 11   tier = TurboFan
[bailout (kind: deopt-eager, reason: not a Smi): ... <JSFunction add>, <Code TURBOFAN_JS>,
   opt id 0, node id 36, bytecode offset 2, deopt exit 0, ...]
break : xy
after : tier = Ignition
```

**What happened:** an **eager** deopt — the guard failed *in the current instruction*, so V8
threw away the optimized code, rebuilt an interpreter frame from the deopt metadata, and
resumed in **Ignition** at `bytecode offset 2` as if the fast path had never run. The result
(`'xy'`) is still correct; correctness never depended on the speculation, only speed did. This
round trip — optimize, assume, guard, fall back — is the single most important loop in the
engine to internalize.

**Go further:** add `%PrepareFunctionForOptimization(add); add('a','b'); %OptimizeFunctionOnNextCall(add);`
after the break, then call it with both strings and both numbers. Now the feedback is
polymorphic and TurboFan compiles a version that handles both without deopting.

---

## EX3 — Which boundary actually deopts? (representation selection)

Script: `ex3-smi-boundary.js`. Concept: 5.11 representation selection.

On 64-bit V8 with pointer compression a **Smi is a signed 31-bit integer**: the largest is
`2**30 - 1 = 1073741823`. Bigger integers must be boxed as a `HeapNumber`. So which crossing
makes optimized `sum` deopt — the *result* leaving Smi range, or the *inputs*?

```js
function sum(a, b) { return a + b; }
%PrepareFunctionForOptimization(sum);
sum(1, 2); sum(3, 4);
%OptimizeFunctionOnNextCall(sum);
sum(1073741823, 1);          // A: result 2**30 overflows Smi; inputs are Smi
sum(1073741824, 1073741824); // B: inputs are already HeapNumbers
```

**Predict:** which of A and B deopts?

**Real output** (`run ex3-smi-boundary.js --trace-deopt`):

```
A result overflows Smi : 1073741824  still TF? true
B inputs not Smi       : 2147483648  still TF? false
[bailout (kind: deopt-eager, reason: not a Smi): ... deoptimizing <JSFunction sum>, bytecode offset 2 ...]
```

**What happened:** the deopt is on **B**, not A. From `SignedSmall` feedback TurboFan speculates
the *inputs* are Smis and emits a `CheckSmi` on each operand; the addition itself runs on
**int32**, which comfortably holds `2**30`. So A (result overflows Smi but fits int32) stays on
the fast path and just boxes the result. B fails the input `CheckSmi` before the add even
happens. Lesson: the guards are on the **representation of the inputs**, decided by feedback —
not on the arithmetic result. (Push a running sum past `2**31` and you would finally see an
int32 overflow deopt instead.)

---

## EX4 — Inlining a small hot callee

Script: `ex4-inlining.js`. Concept: 5.10 inlining.

```js
function square(x) { return x * x; }
function caller(x) { return square(x) + 1; }
// warm both, then optimize caller()
```

**Predict:** when TurboFan optimizes `caller`, does it keep the `square(x)` call, or paste
`square`'s body in?

**Real output** (`run ex4-inlining.js --trace-turbo-inlining`):

```
Considering <SharedFunctionInfo square> for inlining with <FeedbackVector[0]>
Inlining small function(s) at call site #21:JSCall
Inlining <SharedFunctionInfo square> into <SharedFunctionInfo caller>
```

**What happened:** `square` is tiny, monomorphic, and hot, so it clears the inlining heuristics
and its body is spliced into `caller`. After inlining, `x*x + 1` is one straight-line piece of
code with no call overhead — and, more importantly, now visible to *every later pass* (the
multiply and add can be typed and folded together). Inlining is the pass that makes the other
passes powerful.

**Go further:** make `square` big (paste 50 statements) or call `caller` with objects of many
different shapes first, then re-run. Watch the inliner decline. The heuristic weighs callee
size against call-site hotness.

---

## EX5 — Escape analysis deletes an allocation

Script: `ex5-escape.js`. Concept: 5.10 escape analysis.

```js
function dist2(a, b) {
  const p = { x: a, y: b };      // temporary, never leaves the function
  return p.x * p.x + p.y * p.y;  // only its fields are read
}
```

**Predict:** does TurboFan allocate `p` on the heap?

**Real output** (`run ex5-escape.js --trace-turbo-escape`, and code size with the pass toggled):

```
Reducing Allocate#81
Creating VirtualObject id:0 size:20

escape ON  : Instructions (size = 908)
escape OFF : Instructions (size = 1984)   (d8 --no-turbo-escape)
```

**What happened:** the allocation node is replaced by a **virtual object** — `p` never becomes
a real heap object, its fields become plain SSA values (registers). The generated code is less
than half the size with escape analysis on, and it does zero allocation, so it also creates
zero GC pressure. This is why writing small helper objects in hot code is often free: the
optimizer proves they do not escape and dissolves them.

**Go further:** add `globalThis.leak = p;` before the return. Now `p` **escapes**, escape
analysis must bail, and the allocation comes back (code size jumps). Escape analysis is entirely
about proving a value cannot be observed from outside.

---

## EX6 — On-stack replacement: optimize a loop mid-flight

Script: `ex6-osr.js`. Concept: 5.14 OSR.

A function called **once** whose loop runs millions of times will never get a *second* call to
trigger normal tier-up. OSR is how V8 swaps a running function into optimized code without
waiting for it to return.

```js
function compute(n) {
  let acc = 0;
  %PrepareFunctionForOptimization(compute);
  for (let i = 0; i < n; i++) {
    acc += i;
    if (i === 10) %OptimizeOsr();   // ask for OSR at this loop
  }
  return acc;
}
compute(100000);
```

**Predict:** can V8 replace the code of a function that is currently on the stack?

**Real output** (`run ex6-osr.js --trace-osr --trace-opt`):

```
[OSR - setting osr urgency. function: compute, new urgency: 6]
[OSR - compilation started. function: compute, osr offset: 46 ...]
[compiling method <JSFunction compute> (target MAGLEV) OSR ...]
[OSR - entry. function: compute, osr offset: 46]
result = 4999950000
```

**What happened:** V8 compiled a special version of `compute` whose **entry point is the loop
header** (`osr offset: 46`), then, at the next loop back-edge, replaced the live interpreter
frame with an optimized frame and jumped in — the loop finished at Maglev speed inside its
first and only call. OSR frame translation is the deopt machinery run *in reverse*: instead of
optimized → interpreter, it maps interpreter → optimized.

---

## EX7 — Sparkplug is bytecode with the interpreter removed

Script: `ex7-sparkplug.js`. Concept: 5.2 Sparkplug.

Sparkplug builds **no IR** and does **no optimization**. It walks the bytecode once and emits a
little machine code per bytecode — mostly calls to the same builtins Ignition uses. Seeing it
next to the bytecode makes this obvious.

```js
function f(a) { return a + 1; }
%CompileBaseline(f);
```

**Predict:** how many "instructions" of thought does Sparkplug spend per bytecode?

**Real output** — bytecode, then the baseline (`BASELINE`) disassembly with `--code-comments`:

```
### bytecode for f
Ldar a0
AddSmi [1], EmbeddedFeedback[0]
Return

### Sparkplug (BASELINE) code — each bytecode -> emitted code + a builtin call
kind = BASELINE
  [ ... Inlined Trampoline for call to BaselineOutOfLinePrologue
  [ 0b 03   Ldar a0
  [ 4f 01 00  AddSmi [1], EmbeddedFeedback[0]
    [ ... Inlined Trampoline for call to AddSmi_Generic_Baseline
  [ b9   Return
```

**What happened:** the disassembly is *annotated with the bytecodes themselves* — a prologue,
then one chunk of code per bytecode, in order, with `AddSmi` lowering to a call to the
`AddSmi_Generic_Baseline` builtin. No graph, no scheduling, no register allocation. That is the
whole design: Sparkplug removes interpreter dispatch and decode overhead and nothing else, which
is why it compiles ~1000× faster than TurboFan and is worth running before the real optimizers
warm up.

---

## The mental model these seven build

1. **A function is not one thing.** It exists at up to four tiers at once; a "hot function" is a
   history of recompilations (EX1).
2. **Optimized code is a bet.** It is compiled against feedback-derived assumptions and defended
   by guards (EX2, EX3).
3. **A lost bet is cheap and safe.** Deopt rebuilds an interpreter frame and continues; only
   speed was ever at stake (EX2).
4. **Guards are on representations, chosen from feedback** — not on your intuition about values
   (EX3).
5. **Inlining is the master pass**: it exposes everything else (EX4), and lets escape analysis
   dissolve temporary objects into registers (EX5).
6. **Tiering is not one-directional or call-gated**: OSR climbs mid-loop (EX6), deopt drops back
   to Ignition (EX2).
7. **Cheap tiers exist to buy time** for expensive ones: Sparkplug is deliberately dumb (EX7).

New to the tier ladder? Read the [JIT design + per-tier primer](05-jit-and-tiers.md) first.
Then test yourself: the [self-check quiz](05-quiz.html) runs active recall over exactly these
seven scenarios (open the reader with `npm start`).
