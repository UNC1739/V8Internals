# 4.3 — Torque builtin

Tutorial: `docs/builtins/torque-tutorial.md`. Live add of `Math.is42` on this pin, then reverted.

## What Torque is

`.tq` → Torque compiler → CSA (`TF_BUILTIN(..., CodeStubAssembler)`) → TurboFan backend → snapshot.

`javascript builtin` = JS calling convention (receiver + args). Must be marked `transitioning` if it calls a transitioning helper (`ToNumber_Inline`). Plain `builtin` = stub linkage for sharing among builtins.

Generated C++: `out/.../gen/torque-generated/` (same path as the JSObject `kElementsOffset` assert in 1.16).

## Existing example: `Math.abs`

`src/builtins/math.tq`:

```
transitioning javascript builtin MathAbs(
    js-implicit context: NativeContext)(x: JSAny): Number {
  try {
    ReduceToSmiOrFloat64(x) otherwise SmiResult, Float64Result;
  } label SmiResult(s: Smi) { … TrySmiAbs … }
  label Float64Result(f: float64) { … }
}
```

Install (`src/init/bootstrapper.cc`):

```
SimpleInstallFunction(isolate_, math, "abs", Builtin::kMathAbs, 1, kAdapt);
```

`Math.abs(-42)` → `42` on this pin's artifact d8.

## Added `Math.is42` (reverted after proof)

`src/builtins/math.tq` inside `namespace math`:

```
transitioning javascript builtin MathIs42(
    js-implicit context: NativeContext, receiver: JSAny)(x: JSAny): Boolean {
  const number: Number = ToNumber_Inline(x);
  typeswitch (number) {
    case (smi: Smi): {
      return smi == 42 ? True : False;
    }
    case (heapNumber: HeapNumber): {
      return Convert<float64>(heapNumber) == 42 ? True : False;
    }
  }
}
```

First Torque compile failed: not marked `transitioning` while calling `ToNumber_Inline`.

Install next to `abs`:

```
SimpleInstallFunction(isolate_, math, "is42", Builtin::kMathIs42, 1, kAdapt);
```

`Builtin::kMathIs42` is generated (`TFJ(MathIs42, JSParameterCount(1), kReceiver, kX)` in `builtin-definitions.h`). No hand-written enum.

Rebuild: `ninja -C out/teaching-debug.sandbox-on d8` — Torque + ~1000 CXX + `mksnapshot` + LINK. Not the 5s `.cc` loop.

Call:

```
Math.is42(42)     → true
Math.is42(41)     → false
Math.is42("42")   → true   // ToNumber
Math.is42(42.0)   → true   // HeapNumber path
typeof Math.is42  → function
```

Dump: `notes/_proofs/dumps/04-math-is42.txt`.

Sources reverted so the cohort pin tree stays clean.
