// 4.6 / 0.3 — mixed stack via %DebugTrace (same printer as gdb jst).
function inner() {
  %DebugTrace();
  return 1;
}
function hot(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += inner();
  return s;
}
%PrepareFunctionForOptimization(hot);
hot(2);
%OptimizeFunctionOnNextCall(hot);
print('--- after opt ---');
print(hot(2));
print('status', %GetOptimizationStatus(hot));
