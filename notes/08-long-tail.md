# Phase 8 — The long tail

## 8.1 Irregexp

`src/regexp/`, `docs/regexp/architecture.md`. Own parser → node graph → native **or** bytecode.

Default: compile to native, tier up from interpreter (`--regexp-tier-up` true). To see bytecode: `--regexp-interpret-all --trace-regexp-bytecodes`.

**Proof** (`/a(b+)c/` vs `'abbbc'`):

```
Start bytecode interpreter. Pattern /a(b+)c/ Subject 'abbbc'
pc = 00  PushBacktrack
pc = 08  SkipUntilChar … character: a
pc = 1c  Load2CurrentChars
pc = 68  CheckNotCharacter b  (loop AdvanceCpAndGoto)
pc = 84  CheckNotCharacter c
pc = 9c  Succeed
match abbbc,bbb
```

Fail path on `'axc'`: `SkipUntilChar` misses, `Backtrack`, `Fail`.

Also: Boyer-Moore skip tables, quick-check (load 2 chars, mask), peephole (`--trace-regexp-peephole-optimization`).

## 8.2 Promises and microtasks

`src/execution/microtask-queue.*`. `await` desugars to generator-like suspend + `Promise.then` (bytecode: promise builtins, not a VM event loop). **The event loop is the embedder** (Chrome: Blink; Node: libuv; d8: a tiny loop in `d8.cc`). V8 only drains the microtask queue when the embedder says so (`PerformMicrotaskCheckpoint` / policy AUTO vs EXPLICIT vs DISABLED).

## 8.3 Promise fast path / hooks

Reactions to an already-resolved promise skip extra ticks when possible (promise hook / debug instrumentation disable this). `--harmony-promise-*` leftover flags are mostly gone; look at `builtins/promise-*.tq`. PromiseHooks: embedder tracing (async stacks).

## 8.4 Debugger and inspector

`src/debug/`, `src/inspector/`, CDP. d8: `--enable-inspector` plus `d8.debugger.enable()` (`SetDebugDelegate`). Breakpoints in bytecode: patch bytecode. Breakpoints in **optimized** code: **lazy deopt** so PC maps 1:1 onto bytecode.

**Proof:** `d8.debugger.enable()` then TurboFan `hot()` containing `debugger;`:

```
[marking dependent code … <Code TURBOFAN_JS> … for deoptimization, reason: JS debugger attached]
[bailout (kind: deopt-lazy …) deoptimizing … bytecode offset 29]
status after 65   # kIsFunction | kInterpreted
```

Dump: `notes/_proofs/dumps/08-debugger-deopt.txt`. Wasm does the same flush (TF → Liftoff) when DevTools opens.

## 8.5 Profiler

`src/profiler/cpu-profiler.cc`, `src/libsampler/`. Sampling: OS timer + stack walk (same walker as 4.6). Ticks map to JS frames via deopt/source-position tables; Sparkplug uses the bytecode↔PC map. `--prof` + `tools/linux-tick-processor` / mac equivalent.

## 8.6 Tracing and logging

`--log-all`, `--prof`, `--log-ic`, `--log-maps` → `v8.log`. Tools: `tools/ic-processor`, map processor, `system-analyzer`, tickprocessor, Turbolizer. Perfetto: `src/tracing/`, Chrome `chrome://tracing` category `v8`. `--runtime-call-stats`.

## 8.7 Intl / ICU

`src/objects/js-*-format.tq`, ICU data `icudtl.dat` next to d8 (artifact dir). Optional at build (`v8_enable_i18n_support`). `docs/i18n.md`.

## 8.8 Sandbox as architecture (not as an attack)

`docs/sandbox/architecture.md`, `src/sandbox/`. Attacker model: arbitrary concurrent writes **inside** the cage; goal: no corrupt **outside**.

Indirections and why they exist:

| mechanism | why |
| --- | --- |
| 4 GB compressed heap inside ~1 TB sandbox | a 32-bit heap offset cannot leave the cage |
| Sandboxed pointer (40-bit offset) | ArrayBuffer backing stores still cannot be a raw VA |
| **EPT** (external pointer table) | embedder / external resources; type tag in the unused pointer bits |
| **TPT** (trusted pointer table) | BytecodeArray / Code / SFI trusted data |
| **CPT** (code pointer table) | executable entrypoints |
| **JSDispatchTable** / leaptiering | `JSFunction` must not hold a raw code pointer; tier-up is an atomic table store (`jdh` in gdbinit) |
| Trusted space | bytecode and JIT metadata not in the writable cage |
| Protected pointers | trusted→trusted compressed, attacker cannot touch |

Course labs 05/06 exercise confinement vs EPT/TPT handle swaps. This note is the *design* view: each table exists because a raw pointer field inside the cage is an OOB write away from process R/W.

## 8.9 Threading

Isolate = unit of JS heap isolation. One Isolates' mutator thread. Background: optimizing compilers, GC, Wasm compile — `libplatform` task runners. Worker = another Isolate (or shared-heap configuration). SharedArrayBuffer + `Atomics` + shared heap work for `SharedArray` / wasm threads. Platform interface: Chrome and Node provide different thread pools.

## 8.10 Embedder integration

| | Chrome | Node | d8 |
| --- | --- | --- | --- |
| microtasks | AUTO, tied to Blink checkpoint | often explicit around syscalls | tiny loop |
| snapshot | custom context snapshot (DOM + V8) | NODE_SNAPSHOT, builtins | `snapshot_blob.bin` |
| external memory | ArrayBuffer allocator + Oilpan | `ArrayBuffer::Allocator`, `napi` | default |
| workers | renderer / worklet isolates | `worker_threads` | `--isolate` hacks |

`docs/node-integration.md`, `docs/embed.md`.
