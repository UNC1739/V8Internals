// EX2 — Cause an eager deopt by breaking the type speculation.
// Run:  d8 --allow-natives-syntax --trace-opt --trace-deopt ex2-deopt-type.js
//
// PREDICT: add() is optimized while it only ever sees Smis. What happens the
// first time it sees a string? What is the deopt "reason"? Which tier next?
function add(a, b) { return a + b; }

%PrepareFunctionForOptimization(add);
add(1, 2); add(3, 4);                 // collect feedback: both operands Smi
%OptimizeFunctionOnNextCall(add);
print('warm  :', add(5, 6), '  tier =', %ActiveTierIsTurbofan(add) ? 'TurboFan' : 'other');
print('break :', add('x', 'y'));      // <-- speculation (SignedSmall add) fails here
print('after :', 'tier =', %ActiveTierIsTurbofan(add) ? 'TurboFan' : (%ActiveTierIsIgnition(add) ? 'Ignition' : 'other'));
