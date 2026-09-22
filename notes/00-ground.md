# Phase 0 — Ground yourself

Pin: V8 **15.3.76.13**. d8: `build/artifacts/cohort/teaching-debug.sandbox-on/d8`.

## 0.1 Build `d8` (debug)

Already built. Times from `build/PIN.md` (Apple M5 Pro, 18-way ninja, 2026-09-22):

| profile | sandbox | seconds | d8 size |
| --- | --- | ---: | ---: |
| teaching-release-dchecks | on | 523 | 83.4 MiB |
| teaching-release-dchecks | off | 540 | 82.7 MiB |
| teaching-debug | on | 647 | 116.7 MiB |

GN mixins: `build/args/{teaching-debug,teaching-release-dchecks,sandbox-on,sandbox-off}.gn`.

```
./build/gn-gen.sh cohort teaching-debug on
./build/build-d8.sh cohort teaching-debug on
```

Proof: `./d8 --version` → `V8 version 15.3.76.13`.

teaching-debug has `v8_enable_object_print`, `v8_enable_disassembler`, `symbol_level=2`. Use it for `%DebugPrint`. Use release+dchecks for GC stress / Wasm.

## 0.2 Incremental rebuild

Full debug is ~11 minutes. Touch one `.cc`, rebuild `d8`.

**Proof (2026-09-22, Apple M5 Pro):** `touch src/d8/d8-console.cc` then
`third_party/ninja/ninja -C out/teaching-debug.sandbox-on d8`:

```
[1/2] CXX obj/d8/d8-console.o
[2/2] LINK ./d8
real 5.21s
```

Use the **tree** ninja (`third_party/ninja/ninja`), not `depot_tools/ninja` — the wrapper wants `python3_bin_reldir.txt` from a `gclient` bootstrap this checkout does not have.

5 seconds is well under "a couple of minutes." Experimentation loop is viable.

## 0.3 GDB / lldb

`tools/gdbinit` (gdb) and `tools/lldb_commands.py` (this Darwin) define the same printers:

| cmd | calls |
| --- | --- |
| `job` | `_v8_internal_Print_Object` — same as `%DebugPrint` |
| `jco` | `_v8_internal_Print_Code` |
| `jst` | `_v8_internal_Print_StackTrace` — same as `%DebugTrace` |
| `jdh` | JSDispatchTable entry |
| `jtt` | transition tree |

**Proof:** `%DebugPrint(1)` → `Smi: 0x1 (1)` (1.1 dump). `%DebugTrace()` after TurboFan: mixed stack in `04-mixed-stack.txt` (4.6). Load lldb helpers: `command script import tools/lldb_commands.py`.

## 0.4 `src/flags/flag-definitions.h`

Read it once. It is the feature index. Starred against this pin (`./d8 --help`):

**See the machine**

| flag | why |
| --- | --- |
| `--allow-natives-syntax` | `%DebugPrint`, `%HaveSameMap`, `%OptimizeFunctionOnNextCall` |
| `--print-bytecode` / `--print-bytecode-filter` | Ignition ISA |
| `--trace-opt` / `--trace-deopt` | tier-up + bailout reasons |
| `--trace-turbo` / `--trace-maglev` | IR JSON for Turbolizer |
| `--print-opt-code` | machine code |
| `--trace-gc` / `--trace-gc-verbose` | scavenger vs mark-compact |
| `--log-ic` / `--log-maps` | IC state machine, Map births (v8.log) |
| `--trace-elements-transitions` | elements lattice |
| `--trace-migration` | Map deprecation / MigrateToMap |
| `--runtime-call-stats` | C++ runtime tax |
| `--trace-regexp-bytecodes` | Irregexp interpreter (`--regexp-interpret-all` to stay there) |
| `--expose-gc` | `gc()` from JS |
| `--max-opt` | 0 Ignition, 1 Sparkplug, 2 Maglev, 3 TurboFan |

**Change the machine**

| flag | default (this pin) |
| --- | --- |
| `--maglev` | true |
| `--sparkplug` | true (when compiled in) |
| `--turbofan` | true |
| `--turboshaft` | true (JS backend) |
| `--turbolev` | **false** — Maglev frontend *instead of* SoN TF frontend. Not a 5th tier. |
| `--invocation-count-for-maglev` | 400 (1000 Android) |
| `--invocation-count-for-turbofan` | 3000 |
| `--invocation-count-for-osr` | 500 |
| `--minor-ms` | false (scavenger is default young GC) |
| `--regexp-tier-up` | true |
| `--short-builtin-calls` | arch/memory dependent |

## 0.5 `src/` directory map

| dir | what lives here |
| --- | --- |
| `api/` | embedder API (`v8::Isolate`, `v8::Context`, `Local`) |
| `ast/` | AST nodes, `Scope`, `Variable` |
| `base/` | OS, vectors, atomics — not JS |
| `baseline/` | Sparkplug |
| `bigint/` | BigInt arithmetic |
| `builtins/` | Torque / CSA / C++ / per-arch ASM builtins |
| `codegen/` | assemblers, reloc info, `compiler.cc` (compilation entry) |
| `common/` | `globals.h`, pointer compression, tagging constants |
| `compiler/` | TurboFan SoN frontend + `turboshaft/` CFG backend |
| `compiler-dispatcher/` | lazy + optimizing compile job queues |
| `d8/` | the shell |
| `date/` | Date parser |
| `debug/` | JS debugger, live edit, debug-evaluate |
| `deoptimizer/` | frame translation, eager/lazy deopt |
| `diagnostics/` | `%DebugPrint`, disassembler |
| `dumpling/` | object dumping helper |
| `execution/` | Isolate, frames, microtasks, stack guard |
| `extensions/` | d8 extras (`gc`, externalize-string) |
| `flags/` | `flag-definitions.h` |
| `fuzzilli/` | Fuzzilli coverage hooks |
| `handles/` | HandleScope, Global, traced handles |
| `heap/` | spaces, scavenger, mark-compact, write barrier |
| `ic/` | ICs, stub cache, handler encoding |
| `init/` | bootstrapper, isolate group |
| `inspector/` | CDP |
| `interpreter/` | Ignition: bytecodes, generator, handlers |
| `json/` | JSON.parse / stringify |
| `libplatform/` | task runners, worker threads |
| `libsampler/` | sampling profiler ticks |
| `logging/` | `--log-*`, runtime-call-stats |
| `maglev/` | Maglev IR + arch backends |
| `numbers/` | conversions, Math.random |
| `objects/` | every heap type (`.h` / `.tq`) |
| `parsing/` | scanner, parser, preparser |
| `profiler/` | CPU + heap snapshots |
| `regexp/` | Irregexp |
| `roots/` | root list, static roots |
| `runtime/` | `Runtime_Foo` C++ from JS |
| `sandbox/` | cage, EPT, TPT, CPT, JSDispatchTable |
| `snapshot/` | serializer, mksnapshot, code cache |
| `strings/` | hasher, builder, unicode |
| `tasks/` | cancelable tasks |
| `torque/` | Torque compiler |
| `tracing/` | Perfetto |
| `trap-handler/` | Wasm out-of-bounds signal handler |
| `utils/` | misc |
| `wasm/` | Wasm engine, Liftoff, objects |
| `zone/` | bump allocator for compilers |

In-tree internals docs: `docs/README.md` (generated from source analysis) plus `docs/index.md` (v8.dev-facing).

## 0.6 Design docs that exist

Under `docs/` on this pin (use these, then source):

- Heap: `heap/pointer-tagging.md`, `pointer-compression.md`, `objects-and-maps.md`, `garbage-collection.md`, `WRITE_BARRIER.md` (in `src/heap/`)
- Objects: `objects/fields-and-elements.md`, `descriptor-and-transition-arrays.md`, `strings.md`, `lookup-iterator.md`
- Runtime: `runtime/hidden-classes-and-ics.md`, `tiering.md`, `deoptimization.md`, `function-architecture.md`, `scopes-and-scope-infos.md`
- Compilers: `interpreter/interpreter-ignition.md`, `compiler/sparkplug/`, `compiler/maglev/`, `compiler/turbofan/`, `compiler/turboshaft/`, `compiler/why-cfg.md`
- Other: `sandbox/architecture.md`, `wasm/architecture.md`, `builtins/architecture.md`, `snapshot/architecture.md`, `regexp/architecture.md`, `parsing/lazy-parsing-and-preparser.md`

v8.dev: Maglev post, Sparkplug post, "Land ahoy: leaving the Sea of Nodes", sandbox docs, Ignition/TurboFan launch. Course facts: `research/FACTS.md`.

## 0.7 Tests are the docs

| suite | where | use for |
| --- | --- | --- |
| mjsunit | `test/mjsunit/` | JS-level: elements, ICs, Maglev, sandbox |
| unittests | `test/unittests/` | gtest, C++ components |
| cctest | `test/cctest/` | older C++ tests |
| inspector | `test/inspector/` | CDP |
| wasm | `test/wasm-*` | Wasm spec + V8 |

Confused by a component → `test/mjsunit/<name>` first, then the `.h`.
