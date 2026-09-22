# Phase 2 — Property access and inline caches

Dump: `notes/_proofs/dumps/02-ics.txt`.

This is the bridge from Maps to speed. Fast path = "same Map as last time → load at offset N." Slow path = `LookupIterator`.

## 2.1 LookupIterator

`src/objects/lookup.h`, `docs/objects/lookup-iterator.md`.

Stateful walk implementing ES property lookup. `Next()` moves holder / state. States: `NOT_FOUND`, `DATA`, `ACCESSOR`, `INTERCEPTOR`, `JSPROXY`, `ACCESS_CHECK`, `TYPED_ARRAY_INDEX_NOT_FOUND`, `WASM_OBJECT`, …

Config bits: own vs prototype chain, interceptors on/off.

Fast objects: binary/linear search of the DescriptorArray. Dictionary: hash probe. Elements: `ElementsAccessor`, not descriptors. Writes go through `PrepareForDataProperty` / `PrepareTransitionToDataProperty` (representation generalization, new-field transitions).

ICs exist so this iterator almost never runs on hot code.

## 2.2 Prototype chains and validity cells

Each Map has `prototype` and a `prototype_validity_cell`. ICs that load from the prototype (or depend on "this Map still has this prototype chain") check that cell.

Mutating a prototype (add/delete/change) **clears** validity cells → ICs miss → often megamorphic if it keeps happening. This is global-ish: many functions' ICs share the cell for that prototype Map.

**Proof:** `protoLoad` on instances of `C` with `C.prototype.z = 1`. After `proto.z = 99` the load returns 99 (value change, same shape). After `proto.w = 1` the prototype Map transitions — cell invalidation. Dump: `before proto mutate 1` / `after proto mutate 99`.

Prototype Maps are often **detached** from the main transition tree (`docs/objects/descriptor-and-transition-arrays.md`) so user objects do not pollute Object.prototype's tree.

## 2.3 Feedback vectors

`src/objects/feedback-vector.h`, `.tq`. SFI holds `FeedbackMetadata` (slot kinds + count). The `JSFunction`'s `FeedbackCell` lazily points at a `FeedbackVector`. Slots are per bytecode site.

Dump on `loadx`:

```
- feedback vector: … [FeedbackVector]
- length: 2
- invocation count: 12
- slot #0 LoadProperty MONOMORPHIC
   [weak] <Map[16]>: LoadHandler(Smi)(kind = kField, is in object = 1,
        is double = 0, storage offset in words = 3, descriptor index = 0)
```

After a second Map at the same site: `POLYMORPHIC` with two Map+handler pairs. After many Maps: `MEGAMORPHIC` with `megamorphic_symbol`.

Lazy allocation: cold functions keep an empty cell; the vector appears when the function heats. `FeedbackCell.interrupt_budget_` is also the tiering counter (phase 5).

## 2.4 IC states

`InlineCacheState` in `src/common/globals.h`. Runtime: `src/ic/ic.cc`. AccessorAssembler: `src/ic/accessor-assembler.cc`.

| state | meaning |
| --- | --- |
| UNINITIALIZED | never executed |
| MONOMORPHIC | one receiver Map — the fast case |
| POLYMORPHIC | small set (typically ≤4) of Map+handler |
| MEGAMORPHIC | too many Maps; stub cache / generic |
| RECOMPUTE_HANDLER | prototype/map deprecation |
| MEGADOM | many DOM accessor types |
| HOMOMORPHIC | many Maps, same handler |
| GENERIC | generic handler, stop recording |
| NO_FEEDBACK | debugger / always-slow |

**Proof** on one load site `return o.x`:

1. 20× `{x}` → `LoadProperty MONOMORPHIC`, Smi handler, in-object offset 3.
2. 20× `{x,y}` → `POLYMORPHIC`, two weak Maps, same offset 3 (x still first in-object).
3. 30 distinct shapes `o['p'+k]=k` → `LoadProperty MEGAMORPHIC`.

`--log-ic` writes transitions to `v8.log` for `tools/ic-processor`. `--trace-ic` is not a flag on this pin.

## 2.5 Megamorphic stub cache

`src/ic/stub-cache.h`. Fixed-size two-level hash table keyed by **(Map, Name)** → handler. Keeps megamorphic sites from bloating every FeedbackVector. Miss → runtime LookupIterator, then fill the cache.

## 2.6 Handlers

Not always a generated stub.

**Smi handler** (dump above): bit-packed kind, in-object vs backing store, double, storage offset in words, descriptor index. AccessorAssembler decodes this in assembly.

**DataHandler** heap object (`src/objects/data-handler.tq`): `smi_handler` + `validity_cell` + optional data (holder for prototype loads, InterceptorInfo, …).

Code handlers exist for the heavy cases.

## 2.7 Accessors and interceptors

`AccessorPair` (JS getter/setter on the Map as a descriptor), `AccessorInfo` (C++/embedder accessor — dump shows `length`/`name`/`prototype` on JSFunction as `AccessorInfo`), API interceptors (`InterceptorInfo`). Any of these force a slow path or a specialized handler; they are why host objects go megamorphic / MEGADOM.

## 2.8 Global object / property cells

Globals are not ordinary in-object fields. Each binding is a `PropertyCell` (name + value + cell type: mutable / constant / undefined / …). ICs cache the **cell**, not a field offset. Store that changes cell type invalidates.

**Proof — `var GLOBAL_X`:**

```
slot #0 LoadGlobalNotInsideTypeof MONOMORPHIC
  [weak] <PropertyCell name=#GLOBAL_X value=1>
```

After `GLOBAL_X = 2`, `readGlobal()` returns 2. The cell was mutated in place (still mutable).
