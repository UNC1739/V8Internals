// EX5 — Escape analysis removes an allocation that never escapes.
// Run A: d8 --allow-natives-syntax --trace-turbo-escape ex5-escape.js
// Run B: compare code size with the pass off:
//   d8 --allow-natives-syntax --no-turbo-escape --print-opt-code --print-opt-code-filter=dist2 ex5-escape.js
//   d8 --allow-natives-syntax               --print-opt-code --print-opt-code-filter=dist2 ex5-escape.js
//
// PREDICT: dist2() builds a temporary {x,y} point that never leaves the function.
// Does TurboFan actually allocate it on the heap?
function dist2(a, b) {
  const p = { x: a, y: b };     // temporary, never escapes
  return p.x * p.x + p.y * p.y; // only its fields are read
}
%PrepareFunctionForOptimization(dist2);
dist2(3, 4); dist2(5, 6);
%OptimizeFunctionOnNextCall(dist2);
print('dist2(3,4) =', dist2(3, 4));
