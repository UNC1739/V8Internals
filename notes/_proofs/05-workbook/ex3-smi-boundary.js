// EX3 — Representation selection: which boundary actually deopts?
// Run:  d8 --allow-natives-syntax --trace-deopt ex3-smi-boundary.js
//
// A Smi on 64-bit V8 (pointer compression) is a SIGNED 31-bit integer:
//   max Smi = 2**30 - 1 = 1073741823.
// sum() is optimized after only ever seeing Smi operands, so TurboFan speculates
// "both inputs are Smi" and emits a CheckSmi guard on each operand.
//
// PREDICT for each call: does it deopt? why or why not?
//   A) sum(2**30 - 1, 1): inputs are Smis; the RESULT (2**30) overflows Smi.
//   B) sum(2**30, 2**30): the INPUTS (2**30) are already HeapNumbers, not Smis.
function sum(a, b) { return a + b; }

%PrepareFunctionForOptimization(sum);
sum(1, 2); sum(3, 4);
%OptimizeFunctionOnNextCall(sum);

// A: result overflows Smi but both inputs are still Smi -> int32 add is fine.
print('A result overflows Smi :', sum(1073741823, 1), ' still TF?', %ActiveTierIsTurbofan(sum));
// B: inputs are not Smi -> the CheckSmi guard fails -> eager deopt.
print('B inputs not Smi       :', sum(1073741824, 1073741824), ' still TF?', %ActiveTierIsTurbofan(sum));
