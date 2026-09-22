function add(a, b) { return a + b; }
%PrepareFunctionForOptimization(add);
add(1, 2);
add(1, 2);
%OptimizeFunctionOnNextCall(add);
add(1, 2);
print('done');
