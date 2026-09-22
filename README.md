# V8Internals

Self-study notes for understanding V8 all the way down. Split out of
[UNC1739/V8Pwn](https://github.com/UNC1739/V8Pwn) so the exploitation course
and the engine-background track can live apart.

Written against cohort pin **V8 15.3.76.13** (Chrome M153), not `main`.

| | |
| --- | --- |
| Curriculum | [`V8-INTERNALS-TODO.md`](V8-INTERNALS-TODO.md) |
| Notes | [`notes/`](notes/) |
| Proof dumps | [`notes/_proofs/`](notes/_proofs/) |

This is **not** an exploitation track. No flag at the end.

## Read in the browser

```sh
npm install
npm start
# http://127.0.0.1:8765/
```

## Still open

9.4 — land a small patch upstream (needs Chromium Gerrit).
