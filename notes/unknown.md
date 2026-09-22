# Things I don't understand yet (H.3)

Correct behavior: this list grows.

- Exact Maglev vs TF OSR deopt on `hotLoop` (`not a Smi` while summing to `4999950000`) — which phi was still tagged Smi after the add overflowed.
- Whether `construction_counter` 6 on first Slacky means "7−1 already used" or "6 remaining."
- Trusted vs main cage base on this Darwin build: HeapNumber was `0x29f5…` but CodeRange in v8.log was `0x150000000`. How far is the sandbox reservation.
- `FeedbackVector` dump said `length: 2` with one LoadProperty slot — what is slot #1.
- DrumBrake vs jitless vs `--wasm-lazy-compilation` interaction on this pin.
- Whether SwissNameDictionary can be flipped on without a GN rebuild.
- Lazy deopt patching of return addresses vs JSDispatchTable updates — which one fires first when a Map is deprecated under Maglev.
- Precise vs conservative stack scanning for the sampling profiler on arm64 Darwin.
- How `EmbeddedFeedback[0]` in bytecode differs from `FBV[n]` (two feedback encodings in one dump).
