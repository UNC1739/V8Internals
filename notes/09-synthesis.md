# Phase 9 — Synthesis

Capstone writeups from dumps already taken. 9.4 (land a patch) and 9.5 (`git log src/compiler/`) are habits, not notes.

## 9.1 One function, end to end: `add` / `hotLoop`

Source:

```js
function add(a, b) { return a + b; }
function hotLoop(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += i;
  return s;
}
```

| stage | what happened (15.3.76.13 debug d8) |
| --- | --- |
| parse | lazy: `add` is a function declaration, compiled when first called |
| bytecode | `Ldar a0; Add a1, feedback; Return` (same shape as `target`'s add) |
| feedback | first calls: binary-op slot records Smi+Smi |
| Sparkplug | skipped in the `%OptimizeFunctionOnNextCall` path |
| Maglev | `hotLoop` marked MAGLEV, `reason: hot and stable`, **OSR**, concurrent |
| TurboFan | `add` compiled `TURBOFAN_JS` synchronous; `hotLoop` TF OSR concurrent |
| deopt | `add('x', 1)` → `deopt-eager, reason: not a Smi`, bytecode offset 2 |
| back to bytecode | `add` returns `'x1'` from Ignition after frame translation |
| extra | `hotLoop` sum `4999950000` exceeds Smi → Maglev/TF also `not a Smi` deopt |

Dump: `notes/_proofs/dumps/05-tiers.txt`.

Generator `genDemo` is the suspend/resume half of the same story (`03-bytecode-gen.txt`): bytecode stays; a generator object holds the register file across `SuspendGenerator` / `ResumeGenerator`.

## 9.2 One property access, end to end: `obj.x`

| stage | evidence |
| --- | --- |
| parser | identifier `x` → literal in constant pool `#x` / `#y` |
| bytecode | `GetNamedProperty a0, [0:"y"], FBV[0]` (`03-bytecode-target.txt`) |
| IC miss | first execution: LookupIterator + DescriptorArray, offset 3 |
| monomorphic | `LoadProperty MONOMORPHIC` + Smi handler in-object offset 3 (`02-ics.txt`) |
| polymorphic | second Map, same offset, `POLYMORPHIC` |
| megamorphic | 30 maps → `megamorphic_symbol`; stub cache |
| TF | `CheckMaps` then tagged load; deopt if Map changes |
| machine | handler storage offset 3 × `kTaggedSize`(4) = +12 from object start |

Constant pool entry for `"y"` is a **TrustedFixedArray** — the name lives outside the cage.

## 9.3 One allocation, end to end: `new Slacky()` / nursery → old / LOS

| stage | evidence |
| --- | --- |
| `new Slacky()` | Map with instance size **48**, 9 in-object slots (slack) |
| after 20 ctor calls | **same Map address**, instance size **16**, 1 in-object (slack done) |
| young alloc | bump-pointer in new space (not printed; implied) |
| `gc()` | `{i:0}` from a 20k array: **in OldSpace** (promoted) |
| LOS | `FixedArray[262144]` at `0x…1c0011` **stable** across Mark-Compact; JSArray header moved |

Dumps: `01-tagging-maps-elements.txt` (slack), `06-gc.txt` (promote + LOS).

## 9.6 Explainer you wanted

The least-documented corner that actually clicked from dumps: **elements-kind transitions are linearized**, not a full lattice in the transition tree. `PACKED_DOUBLE`'s back pointer is `HOLEY_SMI`, not `PACKED_SMI`. `docs/objects/fields-and-elements.md` says it; `%DebugPrint` on `[1,2,3.5]` proves it. That is why a "packed double" array still carries a holey-smi Map in its history, and why IC/Map code must not assume back-pointer = conceptual parent.
