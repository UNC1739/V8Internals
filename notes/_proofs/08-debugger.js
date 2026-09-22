// 8.4 — debugger; inside a function that just got TurboFan'd.
function hot(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += i;
  debugger;
  return s;
}
%PrepareFunctionForOptimization(hot);
hot(10);
hot(10);
%OptimizeFunctionOnNextCall(hot);
print('about to run optimized + debugger');
print(hot(10));
print('status after', %GetOptimizationStatus(hot));
