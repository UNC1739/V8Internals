# Phase 1 — Data representation

Dump: `notes/_proofs/dumps/01-tagging-maps-elements.txt` from teaching-debug d8 15.3.76.13.

Every later phase is downstream of "how is a value stored."

## 1.1 Tagging

Sources: `include/v8-internal.h`, `src/objects/smi.h`, `docs/heap/pointer-tagging.md`.

A JS value is one tagged word.

| kind | low bits | meaning |
| --- | --- | --- |
| Smi | `…0` (`kSmiTag = 0`) | integer payload in the word. Not a heap allocation. |
| strong HeapObject | `…01` (`kHeapObjectTag = 1`) | pointer to a heap object. First word of that object is a Map. |
| weak HeapObject | `…11` (`kWeakHeapObjectTag = 3`) | weak ref; only in heap slots, cleared when loaded into a register. |
| forwarding (GC) | `…00` in the Map word | during GC only. Looks like a Smi; is not one. |

**31-bit vs 32-bit Smi.** This pin is 64-bit **with pointer compression**, so tagged size is 32 bits and Smis are **31-bit** signed (`SmiTagging<4>`: `kSmiValueSize = 31`, `kSmiShiftSize = 0` on the compressed word — payload `<< 1`). Range: `[-2^30, 2^30-1]` = `[-1073741824, 1073741823]`.

Without compression, 64-bit V8 used 32-bit Smis shifted into the upper half (`[32-bit value][32 zero bits]`) so a 32-bit load at `ptr+4` yielded the integer. Compression killed that trick: the compressed word *is* 32 bits, so you only have 31 bits of integer + 1 tag.

**Proof** (`%DebugPrint`):

```
Smi: 0x1 (1)                          # DebugPrint prints the *payload*, not the tagged word
Smi: 0x3fffffff (1073741823)          # 2^30-1 still a Smi
[HeapNumber] … value: 1073741824.0    # 2^30 boxed
[HeapNumber] … value: 1.5
[Oddball] in ReadOnlySpace: #null / #undefined / #true / #false
```

`true` and `false` share a Map (`0x…4ed`). `null` and `undefined` are undetectable oddballs with distinct Maps.

Untag a Smi: arithmetic right-shift 1. Tag: left-shift 1. HeapObject address = tagged − 1.

## 1.2 Pointer compression

Sources: `src/common/ptr-compr.h`, `docs/heap/pointer-compression.md`.

On this pin, heap pointers are stored as 32-bit offsets (`Tagged_t = uint32_t`) from a **cage base**. Compression is truncation; decompression is `cage_base + zero_extend(compressed)`. Cage base is 4 GB aligned, so adding it does not disturb tag bits.

Three cages:

| cage | holds | scheme |
| --- | --- | --- |
| Main | JS heap | `V8HeapCompressionScheme` / `MainCage` |
| Trusted | BytecodeArray, Code metadata (sandbox on) | `TrustedSpaceCompressionScheme` |
| External code | `InstructionStream` (executable bytes) | `ExternalCodeCompressionScheme` — may cross a 4 GB boundary |

Sandbox-on (this d8): the main cage sits inside the ~1 TB sandbox. Isolate-shared cage is required for the sandbox.

**Proof — reconstruct a full address by hand.** HeapNumber 1.5 printed as:

```
0x29f50102b7f1: [HeapNumber] in OldSpace
 - map: 0x29f500000515 <Map[12](HEAP_NUMBER_TYPE)>
```

- LSB of `…b7f1` is `1` → HeapObject tag.
- Read-only maps live near the cage base. 4 GB align: **cage base = `0x29f500000000`**.
- Compressed pointer = low 32 bits = `0x0102b7f1`.
- `0x29f500000000 + 0x0102b7f1 = 0x29f50102b7f1`. Matches.

ArrayBuffer `backing_store: 0x29f800010000` is **not** a compressed heap pointer — it is a sandboxed (40-bit-offset) pointer to off-heap memory. Different encoding; see 1.14 and `notes/08-long-tail.md`.

GDB reconstruction of a compressed slot: `job` on the decompressed tagged value, or `p/x cage_base + *(uint32_t*)slot`. Not run on Darwin lldb this pass.

## 1.3 The Map (HiddenClass)

Sources: `src/objects/map.h` (layout comment is the table of contents), `docs/heap/objects-and-maps.md`.

Every HeapObject starts with a Map pointer. A Map is itself a HeapObject (its map is the MetaMap).

Layout (from `map.h`, this pin):

| field | role |
| --- | --- |
| `instance_size` | bytes, or variable |
| `inobject_properties_start_or_constructor_function_index` | JSObject: first in-object slot in words; primitives: native-context ctor index |
| `used_or_unused_instance_size_in_words` | slack tracking |
| `visitor_id` | GC body descriptor |
| `instance_type` | `JS_OBJECT_TYPE`, `HEAP_NUMBER_TYPE`, … |
| `bit_field` | callable, interceptors, constructor, … |
| `bit_field2` | **elements kind** in bits 2..7 |
| `bit_field3` | enum_length, #descriptors, dictionary_map, **deprecated**, unstable, construction_counter |
| `prototype` | |
| `constructor_or_back_pointer_or_native_context` | transition parent, or ctor |
| `instance_descriptors` | `DescriptorArray` |
| `dependent_code` | deopt dependencies |
| `prototype_validity_cell` | IC invalidation |
| `transitions` **or** `prototype_info` | |

**Proof — annotate `{x:1}`:**

```
[JS_OBJECT_TYPE]
 - map: … <Map[28](HOLEY_ELEMENTS)> [FastProperties]
 - elements: EmptyFixedArray
 - properties: EmptyFixedArray
 - #x: 1 (const data field 3, in-obj, attrs: [WEC])
Map:
 - type: JS_OBJECT_TYPE
 - instance size: 28          # 3 tagged header words + 4 in-object slots
 - inobject properties: 4
 - unused property fields: 3  # only x used
 - elements kind: HOLEY_ELEMENTS
 - back pointer: <previous Map>
 - instance descriptors (own) #1
 - prototype_validity_cell: Cell
```

"data field 3": slots 0–2 are Map / properties / elements (3 × `kTaggedSize` = 12). First in-object property is field index 3. 12 + 4×4 = 28.

Two object literals that add `x` in the same order share that Map (`HaveSameMap(a,b) = true`). Adding `y` then `x` is a different tree: `HaveSameMap(a,c) = false`.

## 1.4 Transition trees

Sources: `src/objects/transitions.h`, `docs/objects/descriptor-and-transition-arrays.md`.

Adding a property in fast mode: look up `(name, attributes)` on the current Map's `TransitionArray`. Hit → take target Map. Miss → allocate a new Map, insert a **weak** transition, move `owns_descriptors` to the leaf.

Order matters: `{a then b}` ≠ `{b then a}`.

Maps along a spine share one `DescriptorArray`. A Map only *sees* a prefix (`NumberOfOwnDescriptors()`). Leaves own the array.

`--log-maps` writes Map births to `v8.log`. `--trace-maps` is gone on this pin; use `--log-maps` / `jtt` in gdb.

**Proof from elements Maps** (same dump). Each fast elements Map stores a single elements-kind transition, and `back pointer` is the previous kind — the tree is linearized:

```
PACKED_SMI  --elem--> HOLEY_SMI --elem--> PACKED_DOUBLE --elem--> HOLEY_DOUBLE
        --elem--> PACKED_ELEMENTS --elem--> HOLEY_ELEMENTS --elem--> DICTIONARY
```

`PACKED_DOUBLE` back pointer is `HOLEY_SMI`, not `PACKED_SMI`. That is the linearization called out in `docs/objects/fields-and-elements.md`.

## 1.5 Descriptor arrays and property details

Sources: `src/objects/property-details.h`, `docs/objects/fields-and-elements.md`.

Each descriptor: `(Name, PropertyDetails Smi, Value/FieldType)`.

`PropertyDetails` packs: Kind (data/accessor), Location (field vs descriptor), Constness, Attributes (W/E/C), Representation (`None/Smi/Double/HeapObject/Tagged`), field offset.

Representations:

- `kSmi` — unboxed in the slot.
- `kDouble` — boxed `HeapNumber`, **mutable in place** on store (HeapNumbers are otherwise immutable). In-object unboxed doubles are gone.
- `kHeapObject` — non-Smi, maybe a specific Map as field type.
- `kTagged` — anything.

**Generalization vs transition.** Transition = add a field. Generalization = same field, wider representation. Smi→Double **deprecates** the Map (needs a box). Smi/Double/HeapObject→Tagged can be in-place.

**Proof.** `new Point(1)` then `p1.x = 1.5`:

```
before: #x: 1 (const data field 3, in-obj)
after:  #x: <HeapNumber 1.5> (data field 3, in-obj)   # dropped const
```

Map address changed `…be9d` → `…becd`. `HaveSameMap(p1, p2)` after constructing `new Point(2)` is **true** — new instances take the generalized Map; the old Map is deprecated and `p1` was migrated.

## 1.6 Map deprecation and migration

Why: you cannot mutate a Map in place if optimized code / ICs / other instances still depend on the old representation. Deprecate the old Map (`is_deprecated` in `bit_field3`), put the new Map on the transition, and **lazily** migrate instances on next access (`MigrateToMap`).

`--trace-migration` logs this. Dependent optimized code is marked for lazy deopt via `dependent_code`.

This is the "hidden class went unstable" story. Exploit-adjacent: a Map you still hold may no longer describe live objects.

## 1.7 In-object vs out-of-object; slack tracking

Constructors over-allocate in-object slots so adding a few fields does not immediately need a `PropertyArray`. After enough instantiations (construction_counter in the Map, typically 7 down to 0), V8 stops slack tracking and **shrinks instance_size**. Unused tail becomes filler, reclaimable if at the end of the object.

**Proof — `function Slacky() { this.a = 1 }`:**

| | first instance | after 20 `new Slacky()` |
| --- | --- | --- |
| instance size | **48** | **16** |
| inobject properties | 9 | 1 |
| unused property fields | 8 | 0 |
| construction counter | 6 | 0 |
| Map pointer | `…bfd9` | **same address** `…bfd9` (in-place shrink) |

Object literals do not get the 9-slot constructor slack: `{x:1}` started at size 28 / 4 in-object.

Out-of-object: extra named properties go in `PropertyArray` (`properties` field). Fast ICs then have one extra load.

## 1.8 Dictionary mode

Fast mode needs a stable descriptor array + transition tree. Too many add/delete, or a delete that would explode the tree, and the object goes **slow**: `NameDictionary` (SwissNameDictionary exists, GN `v8_enable_swiss_name_dictionary`, **off** by default here). ICs cannot encode a field offset. You lose: shared Maps, cheap ICs, enumeration speed.

**Proof — three ways, all `HasFastProperties = false`:**

1. `delete d1.b` on `{a,b,c}` → `[DictionaryProperties]`, `properties: NameDictionary[30]`, Map flagged `dictionary_map`.
2. 200 computed keys `d2['k'+i]` → dictionary.
3. `delete` of the last own property on `{a:1}` → dictionary.

Named-property dictionary ≠ elements dictionary. You can have fast properties + `DICTIONARY_ELEMENTS` (sparse array) or the reverse.

## 1.9 Elements kinds

Sources: `src/objects/elements-kind.h`, `src/objects/elements.cc` (CRTP `ElementsAccessor` — one implementation, N specialized kinds).

Fast lattice (this pin's enum order is Smi, tagged, then double — **not** the transition order):

```
PACKED_SMI → HOLEY_SMI → PACKED_DOUBLE → HOLEY_DOUBLE → PACKED_ELEMENTS → HOLEY_ELEMENTS → DICTIONARY
```

Packed = every index `0..length-1` present. Holey = some `the_hole`. Double kinds use `FixedDoubleArray` (unboxed). Tagged kinds use `FixedArray`.

Also: frozen/sealed/nonextensible, sloppy arguments, string wrappers, typed arrays (`UINT8_ELEMENTS` … `FLOAT16_ELEMENTS`), RAB/GSAB typed arrays, `WASM_ARRAY_ELEMENTS`, `NO_ELEMENTS`.

**Proof table** (JS → kind):

| JS | kind | backing |
| --- | --- | --- |
| `[1,2,3]` | `PACKED_SMI_ELEMENTS` | `FixedArray` (COW) |
| `[1,2,3.5]` | `PACKED_DOUBLE_ELEMENTS` | `FixedDoubleArray` |
| `[1,2,'x']` | `PACKED_ELEMENTS` | `FixedArray` (COW) |
| `[1,,3]` | `HOLEY_SMI_ELEMENTS` | `FixedArray` (COW) |
| `[1.5,,3.5]` | `HOLEY_DOUBLE_ELEMENTS` | `FixedDoubleArray` |
| `[1,,'x']` | `HOLEY_ELEMENTS` | `FixedArray` |
| `a[10000]=1` | `DICTIONARY_ELEMENTS` | `NumberDictionary` |
| `new Uint8Array(4)` | `UINT8ELEMENTS` | typed elements |

`--trace-elements-transitions` for live edges.

## 1.10 Holes

`the_hole` is a dedicated HeapObject (not `undefined`). Reading a holey index walks the prototype chain. That is why holey arrays are slow and why TurboFan's CheckBounds / hole checks matter.

**Proof:**

```
Array.prototype[1] = 'from-proto';
[0, , 2][1]  →  'from-proto'
1 in holey   →  true     # prototype makes it `in`
```

Large-array dump showed unused slots as `<the_hole_value>` (`0x…02fffd`).

## 1.11 Strings

Sources: `src/objects/string.h`, `docs/objects/strings.md`.

| type | dump (this pin) | why it exists |
| --- | --- | --- |
| SeqOneByte / SeqTwoByte | `INTERNALIZED_ONE_BYTE_STRING_TYPE` `#hello`; two-byte `u#h\xe9llo…` | characters in the object |
| ConsString | `CONS_ONE_BYTE_STRING_TYPE` `c"aaaa…"` | concat without copy; flatten later |
| SlicedString | `SLICED_ONE_BYTE_STRING_TYPE` | `substring` without copy; keeps parent alive |
| ThinString | (internalize-in-place when you cannot rewrite the original) | pointer to internalized twin |
| ExternalString | embedder-owned bytes | Chrome/Node strings |

Instance-type bitfield: representation (seq/cons/external/sliced/thin), encoding (one/two byte), internalized, shared.

`#name` in DebugPrint = internalized. `c"…"` = cons. Short concatenations skip ConsString (min size).

## 1.12 String internalization / string table

Property keys, identifiers, and `Symbol` descriptions go through the string table: unique instance per contents, pointer equality instead of memcmp. Shared string table across isolates when the sandbox / shared isolate is on (this pin). Internalizing a ConsString allocates a Seq internalized string and may convert the original to ThinString.

Proof: `'propkey'` used as `o[interned]` printed `#propkey` / `INTERNALIZED_ONE_BYTE_STRING_TYPE`.

## 1.13 Numbers

| value | representation |
| --- | --- |
| integer in Smi range | Smi |
| 2^30, 1.5, `-0`, most floats | `HeapNumber` (12-byte object: Map + double) |
| `NaN`, `Infinity` | HeapNumber in **ReadOnlySpace** (immortal) |
| mutable double field | HeapNumber that stores may mutate in place |

Optimized code keeps unboxed Float64 / Word32 in registers (representation selection, phase 5). The heap view is still Smi or HeapNumber.

## 1.14 TypedArrays and ArrayBuffers

`JSArrayBuffer`: `backing_store`, `byte_length`, flags (`detachable`, `resizable_by_js`). Backing store is **off-heap**. With the sandbox it is a sandboxed pointer, not a raw VA — dump `backing_store: 0x29f800010000` vs heap cage `0x29f5…`.

`JSTypedArray` instance size 60, elements kind `UINT8ELEMENTS`. Resizable AB: same Map, flag `resizable_by_js`. `SharedArrayBuffer` is still `JSArrayBuffer` with a different Map.

Detach: backing store zapped; views throw. RAB/GSAB typed arrays have their own elements kinds (`RAB_GSAB_*`).

## 1.15 Other exotic objects

Dumped on this pin:

- **JSProxy** — handler traps; LookupIterator state `JSPROXY`; ICs go generic.
- **bound function** — exotic `JSFunction` / bound target + bound args.
- **JSFunction** — `shared_info` (SFI), `context`, `dispatch_handle`, `FeedbackCell`. Bytecode lives on the SFI, in **trusted** space (`TrustedFixedArray` constant pool).
- **arguments** — sloppy: `FAST_SLOPPY_ARGUMENTS_ELEMENTS` (mapped to the frame). Strict: unmapped.
- **SFI / ScopeInfo / Context** — see `docs/runtime/function-architecture.md`. SFI is context-independent (bytecode, ScopeInfo, FeedbackMetadata). Context is the closure environment. `JSFunction` is one closure.

## 1.16 Torque

Object layouts and many builtins are `.tq`. Generated C++ asserts that Torque offsets match `offsetof`.

Trace of one field:

1. `src/objects/js-objects.tq`: `extern class JSObject extends JSReceiver { elements: FixedArrayBase; }`
2. Build emits `out/teaching-debug.sandbox-on/gen/torque-generated/src/objects/js-objects-tq.cc`:

```cpp
static constexpr int kElementsOffset = sizeof(JSReceiver);
static_assert(kElementsOffset == offsetof(JSObject, elements_),
              "Value of JSObject::kElementsOffset defined in Torque …");
```

3. `kPropertiesOrHashOffset = sizeof(HeapObject)` on `JSReceiver` — that is the second tagged word.

Also generated: CSA accessors (`js-objects-tq-csa.cc`) used by builtins.

Read a few more: `src/objects/map.tq`, `src/objects/string.tq`, `src/builtins/*.tq`.
