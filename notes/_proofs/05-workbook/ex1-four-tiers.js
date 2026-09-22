// EX1 — Drive one function through all four tiers, deterministically.
// Run:  d8 --allow-natives-syntax --trace-opt --trace-baseline ex1-four-tiers.js
//
// PREDICT before running: after each step, which tier is `work` in?
function work(x) { return x * 3 + 1; }

function tier() {
  if (%ActiveTierIsTurbofan(work)) return 'TurboFan';
  if (%ActiveTierIsMaglev(work))   return 'Maglev';
  if (%ActiveTierIsSparkplug(work))return 'Sparkplug';
  if (%ActiveTierIsIgnition(work)) return 'Ignition';
  return '???';
}

%PrepareFunctionForOptimization(work);      // required before the manual-optimize natives
work(1);                                     print('1. after first call        :', tier());
%CompileBaseline(work); work(1);             print('2. after %CompileBaseline  :', tier());
%OptimizeMaglevOnNextCall(work); work(1);    print('3. after Maglev on next    :', tier());
%OptimizeFunctionOnNextCall(work); work(1);  print('4. after TurboFan on next  :', tier());
