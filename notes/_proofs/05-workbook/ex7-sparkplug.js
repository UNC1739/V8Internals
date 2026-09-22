// EX7 — Sparkplug is a near 1:1 walk over bytecode (no IR).
// Run A (bytecode): d8 --allow-natives-syntax --print-bytecode --print-bytecode-filter=f ex7-sparkplug.js
// Run B (baseline): d8 --allow-natives-syntax --no-concurrent-recompilation --code-comments \
//                      --print-code --print-bytecode-filter=f ex7-sparkplug.js
//
// PREDICT: how does Sparkplug's output relate to the 3 bytecodes below? Does it
// build a graph and optimize, or just emit code per bytecode?
function f(a) { return a + 1; }
%CompileBaseline(f);
f(1);
