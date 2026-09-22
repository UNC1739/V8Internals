# Standing habits (H.1–H.4)

## H.1 Subscribe

- Blog: https://v8.dev/blog (RSS: https://v8.dev/blog.atom)
- List: https://groups.google.com/g/v8-dev
- Design docs as they appear: in-tree `docs/` and CLs tagged `docs-` / linked from commit messages.

Skim, don't archive. The pipeline posts (Maglev, Turboshaft, sandbox) are the ones that invalidate notes.

## H.2 New component → CL first

When something lands (Turbolev, a new IC state, a sandbox table):

1. Find the CL (`git log -S'name' -- src/` or crrev).
2. Read the **description and tests** before the code.
3. Tests tell you the intended contract; the code tells you the accidents.

Example already in notes: Maglev→Turboshaft rename to Turbolev, tests moved to `test/mjsunit/turbolev/`.

## H.3 Unknown list

`notes/unknown.md` — keep growing.

## H.4 Re-pin

Cohort pin is immutable until Phase 9.1 of the *course* TODO (`build/PIN.md`). Internals notes must be re-diffed against that pin, not `main`. Especially `src/compiler/pipeline.cc` phase list and `flag-definitions.h` (`--turbolev` still false here).

Procedure: bump pin → re-run `notes/_proofs/*.js` → fix dumps that changed.
