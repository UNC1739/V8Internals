// Phase 7 — WebAssembly proofs.
// Run under several flag sets; see notes/07-wasm.md "How to re-run".
//   d8 --allow-natives-syntax 07-wasm.js
//   d8 --allow-natives-syntax --print-wasm-code --liftoff-only 07-wasm.js
//   d8 --allow-natives-syntax --print-wasm-code --no-liftoff   07-wasm.js
//   d8 --allow-natives-syntax --trace-wasm-compiler --wasm-tier-mask-for-testing=1 07-wasm.js
//
// Hand-assembled module: exports add(i32,i32)->i32 and a 1-page memory.
// Bytes are the raw .wasm binary so the note stands without wasm-module-builder.js.
const bytes = new Uint8Array([
  0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00,            // magic + version
  0x01,0x07,0x01, 0x60,0x02,0x7f,0x7f,0x01,0x7f,       // type: (i32,i32)->i32
  0x03,0x02,0x01,0x00,                                 // func 0 : type 0
  0x05,0x03,0x01,0x00,0x01,                            // memory: min 1 page
  0x07,0x0d,0x02,                                      // exports: 2
    0x03,0x61,0x64,0x64,0x00,0x00,                     //   "add" -> func 0
    0x03,0x6d,0x65,0x6d,0x02,0x00,                     //   "mem" -> memory 0
  0x0a,0x09,0x01, 0x07,0x00, 0x20,0x00,0x20,0x01,0x6a,0x0b, // code: local.get 0/1; i32.add; end
]);

const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod);
const add = inst.exports.add;
const mem = inst.exports.mem;

// Drive the exported function so dynamic tiering has something to measure.
let acc = 0;
for (let i = 0; i < 200000; i++) acc = add(acc, 1);
print('add result', acc);
print('mem byteLength', mem.buffer.byteLength);

// 7.4 / 7.6 object model — inspect from JS and via natives.
print('--- object model ---');
print('instance is', Object.prototype.toString.call(inst));
print('memory is', Object.prototype.toString.call(mem));
%DebugPrint(inst);
%DebugPrint(mem);
%DebugPrint(mem.buffer);
%DebugPrint(add);
print('done');

// 7.7 WasmGC — struct { i32 } exported to JS as an opaque object.
// Run: d8 --allow-natives-syntax 07-wasm.js  (WasmGC is on by default on this pin)
print('--- wasm-gc ---');
const gcBytes = new Uint8Array([
  0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00,
  0x01,0x0a,0x02, 0x5f,0x01,0x7f,0x01, 0x60,0x00,0x01,0x63,0x00, // struct{i32 mut}; func ()->(ref null 0)
  0x03,0x02,0x01,0x01,                                           // func0 : type1
  0x07,0x08,0x01, 0x04,0x6d,0x61,0x6b,0x65,0x00,0x00,            // export "make" func0
  0x0a,0x09,0x01, 0x07,0x00, 0x41,0x2a, 0xfb,0x00,0x00, 0x0b,    // i32.const 42; struct.new 0; end
]);
const gcInst = new WebAssembly.Instance(new WebAssembly.Module(gcBytes));
const s = gcInst.exports.make();
print('struct is', Object.prototype.toString.call(s), '; s.f0 from JS =', s.f0); // undefined: opaque
%DebugPrint(s);
print('done-gc');
