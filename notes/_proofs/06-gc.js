// Phase 6 GC proofs.
// d8 --allow-natives-syntax --expose-gc --trace-gc 06-gc.js

print('=== allocate young, force scavenge ===');
let keep = [];
for (let i = 0; i < 20000; i++) keep.push({i: i});
gc();
print('kept', keep.length, 'objects');
print('--- DebugPrint a survivor ---');
%DebugPrint(keep[0]);

print('=== large object (LOS) ===');
let big = new Array(1024 * 256); // packed smi, large
for (let i = 0; i < 10; i++) big[i] = i;
print('--- large array ---');
%DebugPrint(big);
gc();
print('--- large array after gc (address should be stable if LOS) ---');
%DebugPrint(big);
