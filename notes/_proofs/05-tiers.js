// Phase 5 tiering proofs.
// d8 --allow-natives-syntax --trace-opt --trace-deopt 05-tiers.js

function add(a, b) { return a + b; }

%PrepareFunctionForOptimization(add);
print('add 1+2', add(1, 2));
print('add 1+2', add(1, 2));
%OptimizeFunctionOnNextCall(add);
print('add after opt', add(1, 2));

print('--- deopt: string ---');
print('add after string', add('x', 1));

function hotLoop(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += i;
  return s;
}
print('hotLoop', hotLoop(100000));
print('hotLoop again', hotLoop(100000));
