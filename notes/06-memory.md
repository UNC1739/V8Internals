# Phase 6 — Memory management

Dump: `notes/_proofs/dumps/06-gc.txt`. Sources: `src/heap/heap.h`, `docs/heap/*`, `src/heap/WRITE_BARRIER.md`.

## 6.1 Heap layout / spaces

| space | who lives there | dump evidence |
| --- | --- | --- |
| New (young / nursery) | fresh objects | (short-lived; scavenged) |
| Old | survivors | `{i:0}` after `gc()`: `in OldSpace` |
| Large object (LOS) | bigger than a page | `FixedArray[262144]` at `0x…1c0011` |
| Read-only | immortal | `#null`, `NaN`, RO Maps |
| Code / InstructionStream | executable | CodeRange `0x150000000` in v8.log |
| Trusted | bytecode, Code metadata | `TrustedFixedArray` constant pools |
| Shared | shared-isolate strings etc. | |

Pages ~256–512 KB. Bump-pointer within a page.

**Proof — place objects:**

- Survivor of `gc()`: `JS_OBJECT_TYPE` **in OldSpace**.
- LOS: elements pointer `0x1dd0011c0011` **unchanged** after Mark-Compact; the JSArray *header* moved (`0x…180011` → `0x…02a991 in OldSpace`) but the huge `FixedArray` did not. LOS is non-moving.

## 6.2 Allocation

Bump pointer in the linear allocation area (LAB). Allocation folding: consecutive young allocs share a bump. Allocation sites + pretenuring: some literals skip new-space if they always die old.

Initializing stores into the *most recent young object* skip the write barrier (WRITE_BARRIER.md).

## 6.3 Scavenger

Default young GC. Cheney semispace: from/to, copy live, promote second-generation survivors. Parallel. `--trace-gc` lines say `Scavenge` when it runs. This dump's `gc()` from JS requested **old-space** collection (`Mark-Compact … GC in old space requested`) so we saw major GC, not a scavenge — `gc()` without args is a full collection. Lab `labs/02-gc/` forces a Scavenge via allocation pressure + `--trace-gc`.

`--minor-ms`: alternative young collector, non-moving, page promotion. **Off** by default.

## 6.4 Mark-Compact

Old gen: mark (incremental + concurrent) → sweep (concurrent) → compact selected pages. `src/heap/mark-compact.cc`. Dump:

```
Mark-Compact 0.9 (2.2) -> 0.6 (2.2) MB, … testing; GC in old space requested
Mark-Compact 1.6 (3.5) -> 1.6 (3.5) MB
```

Second collection did not shrink — the LOS array is live.

## 6.5 Incremental / concurrent marking

Tri-color: white (unseen), grey (marked, not scanned), black (scanned). Invariant: no black→white pointer. Mutator stores would break it without a **marking barrier**. Hardest GC part: concurrent marker vs mutator vs evacuation.

## 6.6 Write barriers

Always: **generational** (old→new remembered set `OLD_TO_NEW`). During marking: **marking barrier** (no black→white). During compact: **evacuation / old-to-old**.

Elided when:

- value is Smi or read-only
- initializing store into the current young LAB object (host cannot be black; not old→new)

Fast path: page flag `POINTERS_FROM_HERE_ARE_INTERESTING`. Deferred: `POINTERS_TO_HERE_ARE_INTERESTING`. Slow: RecordWrite builtin. C++: malloc into the slot set.

Sandbox: extra **indirect pointer barrier** for trusted-space stores.

Maglev node `StoreTaggedFieldWithWriteBarrier`; Sparkplug `MacroAssembler::RecordWrite`; TF `kArchAtomicStoreWithWriteBarrier`.

## 6.7 Safepoints

To stop threads: stack must be parseable. JS frames have safepoint tables (precise). C++ uses handles, not raw tagged pointers on the stack (precise via the handle scope). Conservative scanning exists in some embedder / stack-scanning experiments — know it has been changing; this pin's JS stacks are precise. `--trace-gc` pauses are safepoint time.

## 6.8 Weakness

WeakMap/WeakSet = ephemeron tables (`EphemeronHashTable` visitor id). Marking: if key is live, mark value; iterate until fixpoint (ephemeron termination). `WeakRef` / `FinalizationRegistry` / `WeakCell`. Weak slots in transition arrays let unused Maps die.

## 6.9 Handles and roots

Roots: handles, stack (safepoints), globals, isolate tables (string table, dispatch table, EPT/TPT), RO space, eternal handles. `HandleScope` is a bump list of slots. `Global` handles for embedder. Traced handles for Oilpan/cppgc integration.

## 6.10 Oilpan / cppgc

Blink's C++ GC. Unified heap marking: V8 and Oilpan mark together so a C++ DOM wrapper ↔ JS wrapper cycle is seen. Cross-heap refs use cppgc pointer table (sandbox: `CppHeapPointer`). Dump: `cpp_heap_wrappable: 0` on ArrayBuffer.

## 6.11 Heap profiling

`gc({type:'major-snapshot', filename})` with `--expose-gc` writes a Chromium `.heapsnapshot` (`src/extensions/gc-extension.cc`). Sampling profiler: `src/profiler/sampling-heap-profiler.cc`.

**Proof:** 200 `new LeakyCtor` held in `leaked[]`. Snapshot `node_count=27115`. Strings: `LeakyCtor` (**202** name nodes ≈ 200 instances + ctor/map), `LEAK_MARKER_`, `system / SharedFunctionInfo / LeakyCtor`. Retainer is the script-global `leaked` array. Summary: `notes/_proofs/dumps/06-heap-snapshot-summary.txt`.

## 6.12 GC stress

`--stress-gc`, `--gc-interval=N`, `--verify-heap`. teaching-debug already has slow dchecks. `--verify-heap` walks every object after GC; huge tax; catch corrupt Maps/elements early.
