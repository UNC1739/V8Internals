// EX6 — On-stack replacement: promote a loop WHILE it is running.
// Run:  d8 --allow-natives-syntax --trace-osr --trace-opt ex6-osr.js
//
// PREDICT: compute() is called ONCE, but its loop runs millions of times.
// Normal tier-up waits for the next *call* — which never comes. How does V8
// optimize a function that is still on the stack in its first (and only) call?
function compute(n) {
  let acc = 0;
  %PrepareFunctionForOptimization(compute);
  for (let i = 0; i < n; i++) {
    acc += i;
    if (i === 10) %OptimizeOsr();   // ask for OSR at this loop, mid-flight
  }
  return acc;
}
print('tier before call:', %ActiveTierIsIgnition(compute) ? 'Ignition' : 'other');
print('result =', compute(100000));
print('tier after  call:', %ActiveTierIsTurbofan(compute) ? 'TurboFan' :
                           (%ActiveTierIsMaglev(compute) ? 'Maglev' : 'other'));
