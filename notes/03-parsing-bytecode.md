# Phase 3 — Parsing and bytecode

Dumps: `notes/_proofs/dumps/03-bytecode-*.txt`.

## 3.1 Scanner and parser

`src/parsing/` — scanner, recursive-descent parser (`parser.cc`, `parser-base.h`). AST in `src/ast/ast.h`.

Parser and preparser share `ParserBase<Impl>` via CRTP so spec edge cases do not diverge (`docs/parsing/lazy-parsing-and-preparser.md`).

## 3.2 Preparser / lazy parsing

Most nested functions are **pre-parsed**: syntax check + enough scope info for the outer function, **no AST**. Full parse on first call.

Why: pages ship more JS than they run. Cost of eager parse is CPU + bytecode memory + code cache size.

Inner functions that close over outer locals force those locals into a **Context** (heap), not the stack. The preparser must see those refs. `PreparseData` serializes that so re-preparse of nested functions is not O(n²) on bundler-deep nesting.

Eager heuristics: PIFE `(function(){})()`, `!function(){}()`, compile-hint magic comments.

`--print-ast` exists. `--trace-parse` is not a flag on this pin; parse timing is in runtime-call-stats / tracing `v8.parse`.

## 3.3 Scope analysis

`src/ast/scopes.*`. Stack allocation vs context allocation: a variable is context-allocated iff some nested function (or `eval` / `with`) can see it after the frame is gone.

**Prove-it case:** 

```js
function outer() {
  let x = 1;
  return function inner() { return x; };
}
```

`x` is context-allocated. `inner`'s `JSFunction.context` points at `outer`'s context slot. If `inner` did not exist, `x` would be a stack register in Ignition.

`ScopeInfo` is the serialized scope on the SFI (`docs/runtime/scopes-and-scope-infos.md`).

## 3.4 Bytecode generation

`src/interpreter/bytecode-generator.cc` — AST visitor. `BytecodeRegisterAllocator` + accumulator. Prefer leaving values in the accumulator to shrink encoding (`Star`/`Ldar` only when needed).

## 3.5 Bytecode ISA

`src/interpreter/bytecodes.h`. Register machine + **accumulator**. Operands: registers, immediates, constant-pool indices, feedback slots. Prefixes `Wide` / `ExtraWide` widen operands from u8 → u16 → u32.

**Proof — hand-decode `target(obj, x)`** (`--print-bytecode-filter=target`). Length 19, 3 params (`this`, `obj`, `x`), 1 register, frame size 8:

```
@  0 : 0c                LdaZero
@  1 : 7a 04 00          TestGreaterThan a1, EmbeddedFeedback[0]
@  4 : a8 0d             JumpIfFalse [13]           → @17
@  6 : 33 03 00 00       GetNamedProperty a0, [0:"y"], FBV[0]
@ 10 : d5                Star0
@ 11 : 0b 04             Ldar a1
@ 13 : 42 f9 00          Add r0, EmbeddedFeedback[0]
@ 16 : b9                Return
@ 17 : 0c                LdaZero
@ 18 : b9                Return
```

Without mnemonics: `0c` load-zero into acc; `7a 04 00` compare acc vs `a1`; `a8 0d` relative jump; `33` named load from `a0` using constant-pool 0 (`#y`, trusted space) and FBV slot 0; `d5` acc→r0; `0b 04` `a1`→acc; `42` add; `b9` return.

Constant pool is `TrustedFixedArray` — bytecode constants live **outside the sandbox**.

## 3.6 Bytecode handlers

Each opcode is a CSA-generated handler (`src/interpreter/interpreter-assembler.cc`). Dispatch is **threaded**: handler tail-jumps through a dispatch table in a dedicated register. Not a `switch` loop.

Star-lookahead: if the next opcode is a short `Star`, fold it to skip a dispatch.

## 3.7 Peephole + BytecodeArray layout

`BytecodeArray` (trusted): byte stream, constant pool, handler table (try/catch), source-position table, frame size, parameter count. Peephole during generation (e.g. jump threading, redundant Moves).

Handler table on `for-of` (dump):

```
from 19–68  → handler 74
from 87–106 → handler 108
```

That's iterator-close / `return` on throw.

## 3.8 Desugaring

Three syntactic features, bytecode shape on this pin:

**`o?.x?.y`** (`optionalDemo`, 22 bytes):

```
Ldar a0
JumpIfUndefinedOrNull → LdaUndefined; Return
GetNamedProperty "x"
JumpIfUndefinedOrNull → same
GetNamedProperty "y"
Return
```

No extra JS calls. Nullish is a jump.

**`for (const v of arr)`** (`forOfDemo`, 131 bytes, 15 registers): `GetIterator`, load `.next`, loop `CallProperty0`, `JumpIfJSReceiver`, load `.done`/`.value`, `JumpLoop`, plus a large close-iterator tail (`GetNamedProperty "return"`, `ReThrow`). `for-of` is iterator protocol, not a magic opcode.

**`function* genDemo()`** — see 3.9.

(Destructuring / class fields / spread follow the same pattern: extra registers, `CreateArrayLiteral` / `CreateObjectLiteral`, runtime helpers. Dump them with `--print-bytecode-filter`.)

## 3.9 Generators and async

Dump `genDemo`:

```
SwitchOnGeneratorState r0, { 0:@20, 1:@54, 2:@88 }
CreateJSGeneratorObject
SuspendGenerator … [0]          # first resume lands at @20
ResumeGenerator
GeneratorGetResumeMode
SwitchOnSmi  { throw / return / next }
LdaSmi [1]; GeneratorYieldResult; SuspendGenerator [1]
… yield 2 …
LdaSmi [3]; Return
```

The generator object holds the register file. Each `yield` is `SuspendGenerator` with a resume index; `SwitchOnGeneratorState` at entry jumps to the right resume point. Resume mode distinguishes `.next` / `.throw` / `.return`.

`async` is the same machine plus promise builtins (`await` ≈ suspend + promise reaction). The event loop itself is the embedder (phase 8).
