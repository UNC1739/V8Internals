# Phase 7 — WebAssembly

Sources: `docs/wasm/architecture.md`, `src/wasm/`. A second engine inside the first: own decoder, own tiers, own object model. **No JS deopt, no JS-style speculation** on the default path.

Proofs this pass:

| Dump | Shows |
| --- | --- |
| `notes/_proofs/dumps/07-wasm-objects.txt` | `WasmInstanceObject` + trusted-data split, `WasmMemoryObject`, off-cage `ArrayBuffer`, `JS_TO_WASM` wrapper, `WasmStruct` |
| `notes/_proofs/dumps/07-wasm-tiers.txt` | same function compiled `Liftoff` vs `TurboFan`, and the JS→Wasm wrapper |
| `notes/_proofs/dumps/07-wasm-tierup.txt` | one function crossing Liftoff → TurboFan under a low tiering budget |

Proof source: `notes/_proofs/07-wasm.js` (module bytes hand-assembled so the note stands without `test/mjsunit/wasm/wasm-module-builder.js`).

## 7.1 Decode and validate

`src/wasm/module-decoder.h`, `function-body-decoder.h`. Binary → module structure + per-function bodies. Validation is spec-complete before any compile. Feature flags: `src/wasm/wasm-feature-flags.h`.

The proof module is the raw binary, so the section grammar is visible in `07-wasm.js`: type section `(i32,i32)->i32`, function section, memory section (min 1 page), export section, code section (`local.get 0; local.get 1; i32.add; end`). `--trace-wasm-decoder` narrates the decode.

## 7.2 Liftoff

`src/wasm/baseline/liftoff-compiler.cc`. One-pass baseline, tens of MB/s. Straight from bytecode to machine code, like Sparkplug, not like Maglev. Default first tier.

**Proof** (`07-wasm-tiers.txt`), `--print-wasm-code --liftoff-only`:

```
kind: wasm function
compiler: Liftoff
Body (size = 160 = 152 + 8 padding)
```

## 7.3 TurboFan / Turboshaft for Wasm

Hot functions → **Turboshaft for the whole optimizing pipeline** (F1.2: "WebAssembly uses Turboshaft throughout"). Graph from `src/wasm/turboshaft-graph-interface.cc`. **No deopt, no type-feedback speculation** — Wasm types are static. Failures are traps.

**Proof** — same `add`, `--print-wasm-code --no-liftoff`:

```
kind: wasm function
compiler: TurboFan
Body (size = 288 = 272 + 16 padding)
```

Same function, two tiers, TurboFan emitting the larger body: baseline 160 bytes vs optimizing 288.

Tier-up: `TriggerTierUp` in `module-compiler.cc`, budget `--wasm-tiering-budget` (default ~13M bytes executed). **Proof** (`07-wasm-tierup.txt`) with the budget lowered to 1000:

```
Compiling wasm function 0 with liftoff
Compiling wasm function 0 with turbofan
```

**No OSR** for Wasm: a running Liftoff call finishes in Liftoff even if TF code appears. Jitless: **DrumBrake** interpreter (`src/wasm/interpreter/`).

Flags: `--liftoff-only` (baseline only, testing); `--no-liftoff` (optimizing only); `--wasm-tier-mask-for-testing` (per-index tier); `--wasm-lazy-compilation`.

## 7.4 Wasm object model

JS-exposed: `WebAssembly.Module`, `Instance`, `Memory`, `Table`, `Global`. Internals proven in `07-wasm-objects.txt`:

```
[WasmInstanceObject] in OldSpace
 - map: <Map[24](HOLEY_ELEMENTS)>
 - trusted_data: 0x0253... <Other heap object (WASM_TRUSTED_INSTANCE_DATA_TYPE)>
 - module_object: <Module ...>
 - exports_object: <Object ...>
```

The `WasmInstanceObject` is the JS wrapper **inside the cage**. Its `trusted_data` pointer leaves the cage: the address `0x0253...` is in trusted space, not the compressed heap (cage base `0x3686...`/`0x060e...` in the dumps). That is the whole point — dispatch tables, memory bases, and table bases live in `WasmTrustedInstanceData` where a corrupted in-cage object cannot forge them. Module 6 case studies abuse exactly this class of object.

- Indirect function table — funcref / `call_indirect`
- Memory object — `WasmMemoryObject`, backing store like ArrayBuffer

In-sandbox vs out-of-sandbox split matches JS: metadata that must not be attacker-forged lives trusted.

## 7.5 JS ↔ Wasm boundary

Import/export wrappers: JS→Wasm adapts JS values to Wasm types (ToInt32, etc.); Wasm→JS boxes results. **Proof** — the wrapper shows up in `--print-wasm-code` output alongside the function:

```
kind = JS_TO_WASM_FUNCTION
name = js-to-wasm:ii:i
compiler = turbofan
```

The `ii:i` signature is two i32 args → one i32 result — the boundary is typed and specialized per signature. Cost: type conversion + calling-convention trampoline. Fast API / wasm-gc reduce some of this. `--trace-wasm` / the `v8.wasm` tracing category narrate calls.

## 7.6 Wasm memory

Linear memory = sandboxed backing store + **guard regions** so oob is a signal, not a wild write. **Proof** (`07-wasm-objects.txt`):

```
[WasmMemoryObject]
 - array_buffer: <ArrayBuffer ...>
 - managed_backing_store: <Other heap object (CPP_GCMANAGED_BASE_TYPE)>
 - maximum_pages: -1
...
[JSArrayBuffer]
 - backing_store: 0x61400000000
 - byte_length: 65536
```

`byte_length` 65536 = one 64 KiB page. The `backing_store` at `0x61400000000` is far outside the compressed cage base, i.e. genuinely **off-heap**; the lifetime is owned by a CppGC-managed object (`managed_backing_store`), not the JS GC directly.

Trap handler (`src/trap-handler/`) converts a SIGSEGV/ACCESS_VIOLATION in the guard region into a Wasm trap. 64-bit memory (`memory64`) is a larger index space with a different bounds-check strategy; explicit bounds checks apply when guards cannot cover the range.

## 7.7 Wasm GC / reference types

WasmGC ships by default on this pin (no flag). Struct/array types get their own instance types and carry `WasmTypeInfo` on the Map. **Proof** — a `struct { i32 }` exported to JS (`07-wasm.js` second module, dump tail of `07-wasm-objects.txt`):

```
struct is [object Object] ; s.f0 from JS = undefined
[WasmStruct]
 - map: <Map(WASM_STRUCT_TYPE)>
 - fields (1):
   - i: 42
[Map]
 - type: WASM_STRUCT_TYPE
 - instance size: variable
 - wasm_type_info: <Other heap object (WASM_TYPE_INFO_TYPE)>
 - constructor: <WASM_TYPE_INFO_TYPE>
```

Two things to read off this:

1. The struct holds its field (`i: 42`) but `s.f0` from JS is **`undefined`** — WasmGC structs are **opaque** to JS. There is no property/IC fast path into their fields (`LookupIterator` state `WASM_OBJECT`, `src/objects/lookup.h`). JS can hold the reference but not poke it.
2. The Map's `wasm_type_info` and its `constructor` both point at a `WASM_TYPE_INFO_TYPE` object — `map.h` special-cases Wasm maps (custom descriptor, immediate supertype in the type info) instead of the ordinary descriptor-array machinery.

Ref types (`funcref`, `externref`, `anyref`) are tagged like JS heap objects when they are heap refs; struct/array fields use representation `kWasmValue` on descriptors. This is how WasmGC maps onto V8's object model without giving JS a fast path to poke struct fields.

## How to re-run

```sh
D8=../V8Pwn/build/artifacts/cohort/teaching-debug.sandbox-on
A=$(cd notes/_proofs && pwd)/07-wasm.js
( cd "$D8" && ./d8 --allow-natives-syntax "$A" )                                   # object model + gc
( cd "$D8" && ./d8 --allow-natives-syntax --print-wasm-code --liftoff-only "$A" )  # baseline tier
( cd "$D8" && ./d8 --allow-natives-syntax --print-wasm-code --no-liftoff   "$A" )  # optimizing tier
( cd "$D8" && ./d8 --allow-natives-syntax --wasm-tiering-budget=1000 --trace-wasm-compiler "$A" )  # tier-up
```
