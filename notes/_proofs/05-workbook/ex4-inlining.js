// EX4 — Inlining a small hot callee.
// Run:  d8 --allow-natives-syntax --trace-turbo-inlining ex4-inlining.js
//
// PREDICT: caller() calls square() every time. When TurboFan optimizes caller(),
// will it keep the call, or paste square()'s body in? Watch the inlining trace.
function square(x) { return x * x; }
function caller(x) { return square(x) + 1; }

%PrepareFunctionForOptimization(square);
%PrepareFunctionForOptimization(caller);
caller(2); caller(3);
%OptimizeFunctionOnNextCall(caller);
print('result =', caller(4));
