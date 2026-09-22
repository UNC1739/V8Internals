// Phase 3 bytecode proofs.
// d8 --allow-natives-syntax --print-bytecode --print-bytecode-filter=target 03-bytecode.js

function target(obj, x) {
  if (x > 0) {
    return obj.y + x;
  }
  return 0;
}

function forOfDemo(arr) {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}

function destructureDemo(o) {
  const {a, b} = o;
  return a + b;
}

function optionalDemo(o) {
  return o?.x?.y;
}

function spreadDemo(a, b) {
  return [...a, ...b];
}

function* genDemo() {
  yield 1;
  yield 2;
  return 3;
}

async function asyncDemo() {
  return await Promise.resolve(1);
}

target({y: 1}, 2);
forOfDemo([1, 2, 3]);
destructureDemo({a: 1, b: 2});
optionalDemo({x: {y: 3}});
spreadDemo([1], [2]);
genDemo().next();
asyncDemo();
print('ran');
