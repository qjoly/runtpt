# Roadmap

Each milestone is meant to be usable on its own, not a layer waiting for the next one.

## M0 — Skeleton

Monorepo, packages, CI, licence. `@runtpt/core` parses a runbook into a document model
with stable cell ids, and round-trips it. Golden-file tests on a handful of real
runbooks.

## M1 — Run locally, no GitHub

`runtpt-agent` runs, pairs with the web app, executes `bash` cells from a local file and
streams output. `.runtpt` written to disk. This is the milestone that proves the
protocol and the format; everything after is surface.

**Demo:** open a local `.md`, run three shell cells, open the `.runtpt` in an editor.

## M2 — GitHub-first

OAuth, repo/branch/file browser, open-by-URL, read-only public runbooks, committing the
`.runtpt` back on a branch. Staleness detection against the recorded blob sha.

**Demo:** a runbook in a repo, run from a laptop, result visible in a pull request.

## M3 — Kernels

Persistent `python` session with rich display, and the `http` kernel. Parameters,
secrets and redaction. `depends`, `timeout`, `confirm`, `continue-on-error`.

## M4 — Replay

Open a `.runtpt` as a first-class document, with or without its runbook. Side-by-side
diff of two runs of the same runbook. Notes added during a run.

## M5 — Presentation

Slide segmentation, presenter view with notes and timer, projection typography, live
cells on slides, replay-as-fallback, static HTML export.

## M6 — Headless

`runtpt run runbook.md --out run.runtpt` in CI, same engine. Non-zero exit on cell
failure. Makes a runbook a testable artefact: the repository can prove its own
documentation still works.

## Later

- Other forges behind the storage abstraction.
- `.ipynb` import/export.
- Remote execution targets as cell attributes (`host=`, `pod=`).
- A WASM kernel for runbooks meant to be run by strangers.
