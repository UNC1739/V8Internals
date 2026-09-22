// Phase 2 IC proofs.
// d8 --allow-natives-syntax --trace-ic 02-ics.js
// Also run without --trace-ic for DebugPrint of functions.

function loadx(o) { return o.x; }

print('=== monomorphic ===');
let m = {x: 1};
for (let i = 0; i < 20; i++) loadx(m);
%DebugPrint(loadx);

print('=== polymorphic (2 maps) ===');
let n = {x: 1, y: 2};
for (let i = 0; i < 20; i++) loadx(n);
%DebugPrint(loadx);

print('=== drive toward megamorphic ===');
function mega(o) { return o.x; }
for (let k = 0; k < 30; k++) {
  let o = {x: k};
  o['p'+k] = k;
  mega(o);
}
%DebugPrint(mega);

print('=== prototype mutation invalidates ===');
function protoLoad(o) { return o.z; }
let proto = {z: 1};
function C() {}
C.prototype = proto;
let inst = new C();
for (let i = 0; i < 50; i++) protoLoad(inst);
print('before proto mutate', protoLoad(inst));
proto.z = 99;
print('after proto mutate', protoLoad(inst));
proto.w = 1;  // shape change on prototype
print('after proto add', protoLoad(inst));

print('=== global property cell ===');
var GLOBAL_X = 1;
function readGlobal() { return GLOBAL_X; }
for (let i = 0; i < 20; i++) readGlobal();
%DebugPrint(readGlobal);
GLOBAL_X = 2;
print('global after store', readGlobal());
