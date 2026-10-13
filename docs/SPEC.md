# runtpt — Specification

## 1. Problem

Operational knowledge lives in two incompatible places. Markdown runbooks in a Git
repository are reviewable, diffable and trustworthy, but nobody can tell whether the
commands inside still work. Jupyter notebooks execute, but `.ipynb` is a JSON blob that
reviews badly, carries stale outputs into commits, and is tied to a Python kernel.

runtpt keeps the markdown as the only source of truth and treats execution as something
that happens *to* it, never *inside* it.

## 2. Product statement

> Open any `.md` file from a GitHub repository, run its code cells against your own
> machine, get a replayable record of the run, and present the same file to a room.

Three usages of one artifact:

| Mode | Audience | Output |
|---|---|---|
| **Run** | the operator doing the work | `.runtpt` side-car |
| **Replay** | whoever reads the incident afterwards | rendered past run |
| **Present** | a room, a conference, a training session | slides |

## 3. Principles

- **The markdown is the source of truth.** runtpt never rewrites a runbook to store
  state. Outputs always land in a separate file.
- **GitHub-first.** Identity, storage, permissions and history come from GitHub. There
  is no runtpt account, no runtpt database of documents.
- **Web-first, not web-only.** The UI is a web app; execution is local. Nothing is sent
  to a runtpt server to be run.
- **Degraded reading is still reading.** A runtpt runbook rendered by GitHub, by `cat`,
  or by any markdown viewer stays perfectly readable. Every runtpt-specific construct is
  a comment or a fence attribute.
- **Streaming by default.** A cell's output appears as it is produced, not when the
  process exits.

## 4. Scope

### In scope (v1)

- GitHub OAuth login, repository and branch browsing, file picking.
- Rendering a `.md` runbook as an executable document.
- Cell kernels: `bash`, `python`, `http`.
- Local agent pairing, cell execution, output streaming.
- `.runtpt` side-car generation, saving to disk and committing to GitHub.
- Replay of an existing `.runtpt` against its runbook.
- Presentation mode from the same markdown.

### Out of scope (v1)

- Multi-user real-time collaboration on the same run.
- Server-side execution, hosted runners, container sandboxes.
- Non-GitHub forges (GitLab, Gitea, Tangled). The storage layer is abstracted so they
  can be added, but none is implemented.
- Rich interactive widgets (ipywidgets-style).
- Editing the runbook inside runtpt beyond small inline fixes.

## 5. Actors

- **Operator** — opens a runbook, runs it, produces a `.runtpt`.
- **Reviewer** — reads a `.runtpt` in a pull request or after an incident.
- **Speaker** — presents a runbook live, running cells in front of an audience.
- **Agent** — the binary on the operator's machine that actually executes things.

## 6. User journeys

### 6.1 First run

1. Operator opens the web app, clicks *Sign in with GitHub*.
2. The app lists their repositories; they pick one, a branch, and a `.md` file.
3. The app detects no agent is connected and shows the pairing instructions
   (one `npx`/brew command plus a short code).
4. The operator starts the agent; it connects to the browser over a local WebSocket and
   announces its working directory and available kernels.
5. The operator runs cells one by one or clicks *Run all*. Output streams in.
6. On completion the app offers to save the `.runtpt`: locally next to the runbook,
   and/or as a commit on a branch.

### 6.2 Incident review

A reviewer opens a pull request containing `incident-4821.md` and
`incident-4821.runtpt`. The runtpt web app opens the pair, shows the runbook with the
recorded outputs inline, each cell annotated with its exit code, duration, timestamp and
the host it ran on. Cells whose source changed since the run are flagged as stale.

### 6.3 Live presentation

A speaker opens a talk written as a runbook, presses `P`. The document becomes a deck:
headings and `---` rules define slides, prose is typeset for projection, and code cells
remain live — pressing Enter on a slide runs the cell and streams its output into the
slide itself. The run is recorded, so the demo can be replayed later even offline.

## 7. Functional requirements

### 7.1 Authentication and storage

- `FR-A1` GitHub OAuth (Device Flow or web flow via a thin token-exchange function),
  scopes `repo` and `read:user`. Token stored in the browser, never on a runtpt server.
- `FR-A2` Browse organisations, repositories, branches, directories; filter to `.md`.
- `FR-A3` Open a runbook by URL: a GitHub blob URL pasted into runtpt resolves directly.
- `FR-A4` Public runbooks open read-only without authentication.
- `FR-A5` Writing back (the `.runtpt`, or an inline fix to the `.md`) goes through a
  commit on a branch, with the commit message pre-filled and editable. Never a direct
  push to the default branch without confirmation.

### 7.2 Document model

- `FR-D1` A runbook is CommonMark plus GFM. Executable cells are fenced code blocks
  whose info string carries runtpt attributes.
- `FR-D2` Each cell has a stable identity: an explicit `id` attribute, or a content hash
  fallback. Identity is what binds an output in the `.runtpt` to a cell.
- `FR-D3` Optional YAML frontmatter declares runbook-level settings: title, default
  shell, environment variables, required inputs, presentation theme.
- `FR-D4` Parameters are declared in frontmatter and prompted for before the first run;
  they are exposed to cells as environment variables and as `{{ placeholders }}`.
- `FR-D7` A cell's kernel is either *pinned* (`bash`, `zsh`, `python`, …) or *inherited*
  (`shell`, resolved against the runbook's `shell:` setting and the session override).
  A pinned cell is never affected by the override, and the UI always displays the kernel
  that will actually run — badging `bash` while executing zsh is the one thing this
  design exists to prevent.
- `FR-D8` An interpreter may be given explicitly, per runbook (`interpreters:`) or per
  cell (`interpreter=`). Sessions are keyed by kernel *and* interpreter, so two paths to
  the same shell are two independent sessions with independent state.
- `FR-D5` A cell may declare `depends` on other cell ids; *Run all* respects the order
  and refuses to run a cell whose dependency failed.
- `FR-D6` `continue-on-error` means the *run* survives the failure, not that the failure
  did not happen: the cell outcome stays `failed`, its dependents still skip, but a
  headless run does not exit non-zero because of it. Same semantics as CI tooling
  elsewhere, so the attribute does not surprise anyone.

### 7.3 Execution

- `FR-E1` The browser never executes a cell itself. It sends a run request to the agent.
- `FR-E2` Output streams as chunks: stdout, stderr, exit code, duration. Interleaving is
  preserved with per-chunk sequence numbers.
- `FR-E3` A running cell can be cancelled; the agent sends SIGINT then SIGTERM.
- `FR-E4` A session holds state across cells of the same kernel: working directory,
  exported variables, and for Python a persistent interpreter.
- `FR-E8` Environment variables reach a cell from three sources, in increasing
  precedence: frontmatter `env`, session variables, resolved parameters. Session
  variables are never persisted — not to the document, not to browser storage — so one
  can safely hold a token; they may be marked secret and are then redacted like a secret
  parameter.
- `FR-E9` A session variable must not outlive the browser session that set it. Because
  the agent's shells are persistent and survive the tab, the agent tracks the variables
  it injected and unsets them when the connection closes, and when one is removed
  mid-session. Variables the operator's own commands exported are left untouched: they
  are the session state FR-E4 promises to keep.
- `FR-E5` Long outputs are truncated in the UI past a configurable threshold, but stored
  in full in the `.runtpt` up to a size cap, then spilled or truncated with a marker.
- `FR-E6` Secrets: values matching declared secret parameters are redacted from the
  `.runtpt` and from the UI, replaced by `«redacted:NAME»`. Redaction happens in the
  agent, before a chunk reaches the wire. A secret shorter than four characters is
  refused rather than redacted, because it would match unrelated output — the UI must
  warn when that happens instead of implying protection it does not provide.
- `FR-E7` Nothing runs without an explicit action. No auto-run on open, ever.

### 7.4 Recording

- `FR-R1` Every run produces or updates a `.runtpt` file. See [FORMAT.md](FORMAT.md).
- `FR-R2` The `.runtpt` records which runbook it belongs to, by path and by commit sha.
- `FR-R3` Replaying a `.runtpt` whose runbook has drifted shows a per-cell staleness
  indicator rather than refusing to open.
- `FR-R4` A `.runtpt` is self-describing enough to be rendered with a degraded view even
  if the runbook is missing.

### 7.5 Presentation

- `FR-P1` Slide boundaries: a `---` thematic break, or a configurable heading level.
- `FR-P2` Speaker notes via `<!-- notes: ... -->`, invisible in run mode, visible in the
  speaker view.
- `FR-P3` Presenter view: current slide, next slide, notes, timer, on a second window.
- `FR-P4` Cells stay executable in presentation mode, with output rendered at projection
  size and a *demo failed, show the recording* fallback that replays a prior `.runtpt`.
- `FR-P5` Export to a self-contained static HTML file, outputs included.

### 7.6 Agent

- `FR-G1` Single command to start, no configuration file required for the default case.
- `FR-G2` Pairing is explicit: a short code typed or auto-filled, bound to one browser
  session, expiring.
- `FR-G3` The agent exposes its hostname, OS, working directory and detected kernels.
- `FR-G4` The agent refuses connections from origins not on its allow-list.
- `FR-G5` The agent can run headless against a `.md` to produce a `.runtpt` in CI, with
  no browser involved. Same engine, same format.

## 8. Non-functional requirements

- `NFR-1` Time to first output of a trivial `bash` cell under 200 ms after click, agent
  already connected.
- `NFR-2` A 10 000-line runbook renders and scrolls without jank.
- `NFR-3` The web app is a static bundle; the only server-side piece is the OAuth token
  exchange.
- `NFR-4` Works offline once loaded, for a local runbook opened from the agent's disk.
- `NFR-5` The agent binary/bundle installs in one command on macOS and Linux.
- `NFR-6` Keyboard-first: everything reachable without the mouse, Jupyter-like bindings.

## 9. Security model

The threat worth taking seriously: a web page gets to run commands on a machine.

- The agent listens on loopback only and requires a pairing secret for every connection.
- Origins are allow-listed; the pairing code is shown by the agent, not guessable.
- The agent is started by the user, in a directory the user chose, and stops when they
  close it. It is not a daemon by default.
- Runbooks are code. The UI makes it obvious what a cell will run, shows the resolved
  command after parameter substitution, and offers a *review before running all* step
  for a runbook opened from a repository the user does not own.
- Tokens stay in the browser. The runtpt origin stores a GitHub token in memory and,
  if the user opts in, in `localStorage`; no runtpt backend ever sees it.
- `.runtpt` files are redacted for declared secrets, but the spec states plainly that an
  output file can leak whatever a command printed — a warning appears before committing.

## 10. Open questions

- Should a `.runtpt` be committed by default, or gitignored by default? Committing makes
  incident review trivial but pollutes diffs; gitignoring loses the point.
- Does the Python kernel talk Jupyter protocol to reuse `ipykernel`, or does it own a
  simpler REPL protocol? The former buys the ecosystem, the latter buys simplicity.
- Is there a conversion path from `.ipynb`, in or out?
- Should the agent support remote targets (ssh, kubectl exec) as first-class cell
  attributes, or is that the runbook author's problem?
