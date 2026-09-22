// Pin 15.3.76.13 proofs for Phase 1 (data representation).
// d8 --allow-natives-syntax 01-tagging-maps-elements.js

function banner(s) { print('\n======== ' + s + ' ========'); }

banner('VERSION');
print(version());

banner('1.1 TAGGING — Smi vs HeapNumber vs oddballs');
print('typeof 1 =', typeof 1);
print('typeof 1.5 =', typeof 1.5);
print('--- Smi 1 ---');
%DebugPrint(1);
print('--- HeapNumber 1.5 ---');
%DebugPrint(1.5);
print('--- HeapNumber beyond Smi (2^30) ---');
%DebugPrint(1073741824);
print('--- oddballs ---');
%DebugPrint(null);
%DebugPrint(undefined);
%DebugPrint(true);
%DebugPrint(false);

banner('1.3 MAPS — same construction shares a Map');
let a = {}; a.x = 1;
let b = {}; b.x = 1;
let c = {}; c.y = 1; c.x = 1;
print('HaveSameMap(a,b) =', %HaveSameMap(a, b));
print('HaveSameMap(a,c) =', %HaveSameMap(a, c));
print('--- a {x} ---');
%DebugPrint(a);
print('--- c {y,x} ---');
%DebugPrint(c);

banner('1.5 REPRESENTATION GENERALIZATION');
function Point(x) { this.x = x; }
let p1 = new Point(1);
print('--- Point Smi field ---');
%DebugPrint(p1);
p1.x = 1.5;
print('--- Point after storing double (generalize Smi -> Double/Tagged) ---');
%DebugPrint(p1);
let p2 = new Point(2);
print('--- new Point after generalization (should not share deprecated map) ---');
print('HaveSameMap(p1,p2) =', %HaveSameMap(p1, p2));
%DebugPrint(p2);

banner('1.7 SLACK TRACKING — constructor instance size');
function Slacky() { this.a = 1; }
let first = new Slacky();
print('--- first Slacky ---');
%DebugPrint(first);
for (let i = 0; i < 20; i++) new Slacky();
let later = new Slacky();
print('--- Slacky after 20+ instantiations ---');
%DebugPrint(later);

banner('1.8 DICTIONARY MODE three ways');
function showFast(label, o) {
  print(label, 'HasFastProperties=', %HasFastProperties(o));
}
let d1 = {a:1, b:2, c:3};
delete d1.b;
showFast('delete property', d1);
%DebugPrint(d1);

let d2 = {};
for (let i = 0; i < 200; i++) d2['k'+i] = i;
showFast('many properties', d2);

let d3 = {};
Object.defineProperty(d3, 'x', {value: 1, configurable: false});
// Adding then deleting a configurable prop is the usual delete path;
// non-configurable + __proto__ tricks aside, force via many deletes:
let d4 = {a:1};
delete d4.a;
showFast('delete last own property', d4);

banner('1.9 ELEMENTS KINDS lattice');
function ek(label, arr) {
  print('---', label, '---');
  %DebugPrint(arr);
}
ek('PACKED_SMI', [1, 2, 3]);
ek('PACKED_DOUBLE', [1, 2, 3.5]);
ek('PACKED (tagged)', [1, 2, 'x']);
ek('HOLEY_SMI', [1, , 3]);
ek('HOLEY_DOUBLE', [1.5, , 3.5]);
ek('HOLEY (tagged)', [1, , 'x']);
let sparse = [];
sparse[10000] = 1;
ek('DICTIONARY (sparse)', sparse);
ek('UINT8', new Uint8Array(4));

banner('1.10 HOLES — holey array prototype lookup');
Array.prototype[1] = 'from-proto';
let holey = [0, , 2];
print('holey[1] (proto) =', holey[1]);
print('1 in holey =', 1 in holey);
delete Array.prototype[1];

banner('1.11 STRINGS');
function sp(label, s) {
  print('---', label, '---');
  %DebugPrint(s);
}
sp('seq one-byte', 'hello');
sp('seq two-byte', 'héllo🔥');
let cons = 'aaaa' + 'bbbb' + 'cccc' + 'dddd' + 'eeee' + 'ffff';
cons = cons + cons + cons + cons;
sp('likely ConsString (long concat)', cons);
let sliced = cons.substring(2, cons.length - 2);
sp('likely SlicedString', sliced);
let interned = 'propkey';
let o = {}; o[interned] = 1;
sp('internalized (property key)', interned);

banner('1.13 NUMBERS');
print('Max Smi-ish 2^30-1 DebugPrint:');
%DebugPrint(1073741823);
print('2^30 (must box):');
%DebugPrint(1073741824);
print('-0 HeapNumber:');
%DebugPrint(-0);
print('NaN:');
%DebugPrint(NaN);
print('Infinity:');
%DebugPrint(Infinity);

banner('1.14 TYPED ARRAY / ARRAYBUFFER');
let ab = new ArrayBuffer(16);
let ta = new Uint8Array(ab);
print('--- ArrayBuffer ---');
%DebugPrint(ab);
print('--- Uint8Array ---');
%DebugPrint(ta);
try {
  let rab = new ArrayBuffer(8, {maxByteLength: 16});
  print('--- resizable ArrayBuffer ---');
  %DebugPrint(rab);
} catch (e) {
  print('resizable AB error', e);
}
let sab = new SharedArrayBuffer(8);
print('--- SharedArrayBuffer ---');
%DebugPrint(sab);

banner('1.15 EXOTICS');
let proxy = new Proxy({x:1}, {get(t,k){ return t[k]; }});
print('--- JSProxy ---');
%DebugPrint(proxy);
function boundTarget(a,b) { return a+b; }
let bound = boundTarget.bind(null, 1);
print('--- bound function ---');
%DebugPrint(bound);
function fn(x) { return x+1; }
print('--- JSFunction ---');
%DebugPrint(fn);
(function argsObj() {
  print('--- arguments ---');
  %DebugPrint(arguments);
})(1, 2, 3);
