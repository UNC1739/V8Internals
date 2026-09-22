# Phase 7 — WebAssembly

Sources: `docs/wasm/architecture.md`, `src/wasm/`. Second engine inside the first: own decoder, own tiers, own object model. **No JS deopt, no JS-style speculation** on the default path.

## 7.1 Decode and validate

`src/wasm/module-decoder.h`, `function-body-decoder.h`. Binary → module structure + per-function bodies. Validation is spec-complete before any compile. Feature flags: `src/wasm/wasm-feature-flags.h`.

## 7.2 Liftoff

`src/wasm/baseline/liftoff-compiler.cc`. One-pass baseline, tens of MB/s. Directly from bytecode to machine code, like Sparkplug, not like Maglev. Default first tier.

## 7.3 TurboFan / Turboshaft for Wasm

Hot functions → **Turboshaft for the whole optimizing pipeline** (F1.2: "WebAssembly uses Turboshaft throughout"). Graph from `src/wasm/turboshaft-graph-interface.cc`. **No deopt, no type feedback speculation** — Wasm types are static. Failures are traps.

Tier-up: `TriggerTierUp` in `module-compiler.cc`. **No OSR** for Wasm: a running Liftoff call finishes in Liftoff even if TF code appears.

Jitless: **DrumBrake** interpreter (`src/wasm/interpreter/`).

Flags: `--liftoff --no-wasm-tier-up` (baseline only); `--no-liftoff` (optimizing only); `--wasm-lazy-compilation`.

## 7.4 Wasm object model

JS-exposed: `WebAssembly.Module`, `Instance`, `Memory`, `Table`, `Global`. Internals:

- `WasmInstanceObject` — JS wrapper inside the cage
- `WasmTrustedInstanceData` — trusted, out of cage (dispatch, memories, tables). Sandbox-critical; Module 6 case studies abuse this class of object.
- Indirect function table — funcref / `call_indirect`
- Memory object — backing store like ArrayBuffer (sandboxed pointer)

In-sandbox vs out-of-sandbox split matches JS: metadata that must not be attacker-forged lives trusted.

## 7.5 JS ↔ Wasm boundary

Import/export wrappers: JS→Wasm adapts JS values to Wasm types (ToInt32, etc.); Wasm→JS boxes results. Cost: type conversion + calling-convention trampoline. Fast API / wasm-gc reduces some of this. Dump not collected this pass; `--trace-wasm` / `v8.wasm` tracing category.

## 7.6 Wasm memory

Linear memory = sandboxed backing store + **guard regions** so oob is a signal, not a wild write. Trap handler (`src/trap-handler/`) converts SIGSEGV/ACCESS_VIOLATION in the guard to a Wasm trap. 64-bit memory (`memory64`) is a larger index space with different bounds-check strategy. Explicit bounds checks when guards cannot cover the range.

## 7.7 Wasm GC / reference types

`WASM_ARRAY_ELEMENTS`, `WasmStruct`, `WasmTypeInfo` on Maps (`map.h` special-cases Wasm maps: custom descriptor, immediate supertype). Ref types (`funcref`, `externref`, `anyref`) are tagged like JS heap objects when they are heap refs, but Wasm structs are **opaque** to JS (`LookupIterator` state `WASM_OBJECT`). Field representation `kWasmValue` on descriptors.

This is how WasmGC maps onto V8's object model without giving JS a fast path to poke struct fields.
