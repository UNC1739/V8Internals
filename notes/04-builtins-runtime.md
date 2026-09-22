# Phase 4 — Builtins and the runtime

Sources: `docs/builtins/architecture.md`, `docs/codegen/code-stub-assembler.md`, `docs/runtime/function-architecture.md`, `docs/snapshot/architecture.md`, `src/execution/frames.h`.

## 4.1 Four kinds of builtins

| kind | where | why it exists |
| --- | --- | --- |
| **Torque** `.tq` | `src/builtins/*.tq` | default for new builtins; typed; compiles to CSA or Turboshaft |
| **CSA** | `src/builtins/*-gen.cc` | portable TurboFan graphs without JS parse |
| **C++** | `src/builtins/builtins-*.cc`, `src/runtime/` | easy, slow (JS↔C++); complex internals |
| **ASM** | `src/builtins/<arch>/` | trampolines, frame setup — TurboFan assumes a fixed frame, so stack-shape work is assembler |

Builtins are snapshotted and shared across isolates. May be remapped into the CodeRange (`--short-builtin-calls`) so PC-relative calls reach.

## 4.2 CodeStubAssembler

`src/codegen/code-stub-assembler.h`. C++ API that emits TurboFan nodes (`Parameter`, `Load`, `Branch`, `CallRuntime`). Same backend as optimized JS. Bytecode handlers and IC fast paths are CSA.

## 4.3 Torque as the layer on CSA

Live `Math.is42` on this pin (then reverted): `notes/04-torque-builtin.md`, dump `notes/_proofs/dumps/04-math-is42.txt`. Tutorial: `docs/builtins/torque-tutorial.md`.

Layout side already proven (1.16): `elements` in `js-objects.tq` → generated `kElementsOffset` assert.

## 4.4 The runtime

`src/runtime/` — `Runtime_Foo` functions compiled code calls when CSA/Torque cannot or should not stay in generated code (allocation failure slow path, IC miss, weird ES spec). Cost: leave the JS frame, `BuiltinExit` frame, C++.

`--runtime-call-stats` / `docs/rcs.md`. Not dumped this pass; run a workload with the flag and read the table (count × time). High `IC_Miss` / `Allocate*` / `StackGuard` is the usual story.

## 4.5 Calling conventions

JS convention ≠ C. Receiver + args on the stack, argc, dispatch through **JSDispatchTable** (handle on `JSFunction`, dump `dispatch_handle: 0x135200`). `CallInterfaceDescriptor` describes register/stack placement per builtin. Entry trampoline: `InterpreterEntryTrampoline` (dump: `builtin: InterpreterEntryTrampoline` until Sparkplug/Maglev/TF replace the table entry).

## 4.6 Frames

`src/execution/frames.h` inheritance (this pin):

```
CommonFrame
  JavaScriptFrame
    UnoptimizedJSFrame → InterpretedFrame, BaselineFrame (Sparkplug)
    OptimizedJSFrame   → MaglevFrame, TurbofanJSFrame
  BuiltinFrame
  TypedFrame → Entry, Exit, BuiltinExit, Stub, Internal, Construct,
               Wasm*, Irregexp, Api*Exit
```

Walker: `StackFrameIterator`. gdb `jst` / lldb `jst` (`tools/lldb_commands.py`) call `_v8_internal_Print_StackTrace`. Same printer as `%DebugTrace`.

**Proof (mixed interpreted → optimized):** `notes/_proofs/dumps/04-mixed-stack.txt`. After `%OptimizeFunctionOnNextCall(hot)`:

```
2: inner  […] [bytecode=… offset=0]     # still interpreted
3: hot    […] [pc=0x1400001b8]
   // optimized frame
4: anonymous […] [bytecode=…]
5: InternalFrame
6: EntryFrame
```

`%GetOptimizationStatus(hot) = 41` = `kIsFunction|kOptimized|kTurboFanned`. Inner stays bytecode because `%DebugTrace` is a runtime call (ExitFrame+StubFrame on top).

## 4.7 Isolates, Contexts, handles

- `v8::Isolate` — VM instance. `IsolateGroup` shares the cage when sandbox/shared-cage is on.
- `v8::Context` / native context — JS global environment. Many Contexts per Isolate.
- Context (internal) — lexical environment chain for closures.
- `HandleScope` + `Local<T>` — stack-rooted pointers the GC can update. `Global`/`Persistent` — heap-rooted, embedder-owned.

**Embedder ran:** copied `notes/embedder/hello.cc` over `samples/hello-world.cc`, `ninja v8_hello_world` (5s), printed **`42`**, restored the sample. Isolate + HandleScope + Context + `FunctionTemplate` `nativeAdd` + `Script::Compile`/`Run`. Official sample restored and re-linked (`Hello, World!` / `3 + 4 = 7`).

## 4.8 Snapshot

`mksnapshot` serializes an initialized heap (`docs/snapshot/architecture.md`). Format is a deserializer **bytecode** stream (`src/snapshot/serializer-deserializer.h`: `kNewObject`, `kBackref`, `kReadOnlyHeapRef`, `kSynchronize`, …), not a memcpy of the heap. Kinds: read-only (oddballs, RO maps), startup, context, shared-heap. Version- and flag-locked.

This pin: `V8_USE_EXTERNAL_STARTUP_DATA`. d8 **requires** `snapshot_blob.bin` next to the binary. Hide it → fatal in `Isolate::Initialize` (`src/api/api.cc`). There is no remaining gn `v8_use_snapshot=false`; `snapshot-empty.cc` + `setup-isolate-full.cc` are the mksnapshot path.

**With snapshot (d8):** `--profile-deserialization` checksum 2.2 ms + RO 2.76 MB / 1.0 ms + isolate 84 KB / 0.28 ms + context 49 KB / 0.30 ms ≈ **3.7 ms** deserialize. Process wall **50 ms** steady (`d8 -e 'print(1)'` ×5). Blob **2.9 MiB**.

**Without snapshot (mksnapshot, same flags as ninja, temp outputs):** wall **1.63 s**, user **9.11 s**. Compiles every builtin then writes the blob + 30 MiB `embedded.S`. ~30× wall / ~180× CPU vs deserialize. Dump: `notes/_proofs/dumps/04-snapshot.txt`.

## 4.9 Code cache

`src/snapshot/code-serializer.cc`. Embedder (Chrome) caches **bytecode** (and sometimes untrusted code) for scripts keyed by source hash + flags. Warm load skips parse. Optimized code caching is narrower (Wasm has its own — phase 7). Cache is not a substitute for the startup snapshot.
