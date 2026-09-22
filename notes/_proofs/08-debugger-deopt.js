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
print('status before debugger', %GetOptimizationStatus(hot));
print(hot(10));
print('status after debugger', %GetOptimizationStatus(hot));
