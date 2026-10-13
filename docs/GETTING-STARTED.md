# Getting started

## Install the agent

### With mise

[mise](https://mise.jdx.dev) installs the standalone binary — no Node required on the
machine that runs the cells. It picks the right archive for your platform out of the
GitHub release.

```bash
mise use -g github:qjoly/runtpt@0.2.5
runtpt --version
```

**The repository is private**, so mise needs a token with read access to it:

```bash
export GITHUB_TOKEN=$(gh auth token)       # or GITHUB_API_TOKEN
mise use -g github:qjoly/runtpt@0.2.5
```

**Pin the version, do not ask for `@latest`.** mise refuses releases younger than 24
hours as a supply-chain precaution (`minimum_release_age`, default `24h`), and reports it
as `no versions found ... matching date filter` — which reads like the release is missing.
Exact versions and versions recorded in `mise.lock` are exempt from that filter.

To install a fresh release without pinning, lower the bar for that one command:

```bash
mise use -g --minimum-release-age=0 github:qjoly/runtpt
```

Released binaries exist for macOS and Linux, on arm64 and x86_64, linked against glibc.
There is no musl build yet, so Alpine needs the source route below.

### From source

```bash
git clone https://github.com/qjoly/runtpt
cd runtpt
mise install        # pins Node, or use your own Node 20+
mise run build
```

Without mise, `npm ci && npm run build --workspaces --if-present` does the same thing.
The Python and HTTP kernels are optional; the agent reports which ones it found.

## Run a runbook from the browser

Two processes. The web app, anywhere:

```bash
npm run dev
```

And the agent, **in the directory holding the runbooks you want to run**:

```bash
runtpt serve                              # installed binary
mise run agent                            # from a source checkout
```

It prints something like:

```
  runtpt agent ready

  root      /home/you/ops
  listening ws://127.0.0.1:7801  (loopback only)
  pairing   W9RH-5DPZ

  open      http://localhost:5173/#agent=ws%3A%2F%2F127.0.0.1%3A7801&pairing=W9RH-5DPZ

  Ctrl-C to stop. Cells run as you, in the directory above.
```

Open that link. The browser is now paired with your machine. Pick a runbook through
*Open → Agent disk*, or sign in to GitHub and browse a repository.

Nothing runs on its own. Click *Run* on a cell, or *Run all*.

### What the agent will and will not do

- It listens on loopback only, and refuses any connection without the pairing code.
- It refuses browser origins outside its allow-list.
- Every path it reads or writes is confined to the directory it was started in.
- It is not a daemon. It stops when you close it.
- Cells run as you, with your environment. A runbook is code — read it before running it.

## Run a runbook in CI

No browser, same engine, same semantics:

```bash
runtpt run runbooks/incident.md \
  --out incident.runtpt \
  --param CLUSTER=staging \
  --env REGISTRY=registry.internal:5000
```

| Flag | Meaning |
|---|---|
| `--out <file>` | output file (defaults to the runbook's name with `.runtpt`) |
| `--param K=V` | a declared parameter, repeatable |
| `--env K=V` | an environment variable, repeatable |
| `--shell <name\|path>` | the shell for `shell` cells, e.g. `zsh` or `/bin/dash` |
| `--cwd <dir>` | working directory for the kernels |
| `--timeout <dur>` | default per-cell timeout, e.g. `5m` |
| `--yes` | also run cells marked `confirm` |
| `--json` | machine-readable events on stdout |

A runbook where nothing can run is an error, not an empty success: `runtpt run` says how
many fences looked runnable, why they were left out, and exits 2. Reporting
`0 ok, 0 failed` and exiting 0 would read like the procedure went fine.

The exit code is 0 only if every cell that was supposed to pass did. A cell marked
`continue-on-error` can fail without failing the run, but its dependents are still
skipped and the failure is still recorded.

## Parameters, variables and secrets

Parameters belong to the runbook: they are declared in frontmatter, prompted for before
the first run, and substituted into `{{ PLACEHOLDERS }}`.

Session variables do not belong to the runbook. You type them into the app (or pass
`--env`), they are merged into every cell's environment, and they are never written
anywhere. Precedence, lowest to highest:

```
frontmatter env  <  session variables  <  resolved parameters
```

Anything marked secret — a parameter or a variable — is replaced by `«redacted:NAME»`
before it reaches the browser or the recording. Redaction happens in the agent, so a
recording on disk is never more revealing than what you saw. A secret shorter than four
characters is refused rather than redacted, and the app says so: it would match too much
unrelated output to be useful.

## Choosing a shell

A cell can either inherit or pin:

````markdown
```shell run
# whatever `shell:` says, or whatever you picked in the app
```

```bash run
# always bash, whatever anyone picked
```
````

Pin when the cell uses a dialect feature. Inherit otherwise. The badge on each cell
always names the interpreter that will actually run, and a cell that already ran under a
different shell is marked rather than quietly re-labelled.

For a specific binary:

```yaml
---
runtpt:
  shell: /opt/homebrew/bin/bash
  interpreters:
    python: /usr/bin/python3.12
---
```

Sessions are keyed by interpreter, so two paths to bash are two independent shells with
independent state.

## Saving a run

When a run ends, runtpt offers to:

- **download** the `.runtpt`;
- **save it next to the runbook** through the agent;
- **commit it to GitHub**, on a branch, with a message you can edit.

The markdown is never modified. Outputs only ever live in the side-car.

Whether to commit recordings is a team decision. They diff acceptably — one JSON object
per line, appended as the run happens — but they do add noise. A suggested
`.gitattributes` is in [FORMAT.md](FORMAT.md).

## Troubleshooting

**The app says "no agent".** The agent prints a link containing the pairing code; the
code is single-use per browser session. Open the printed link rather than typing the URL
by hand, or paste the code into *Pair an agent*.

**A cell hangs.** Cancel it. The agent sends SIGINT, then SIGTERM, then SIGKILL to the
process group. The shell survives; the command does not.

**A cell that calls `exit` loses the shell state.** Unavoidable: the cell *is* the shell.
The exit code is reported correctly and a fresh shell starts for the next cell, but
anything exported before it is gone.

**`sh` behaves differently on Linux.** It usually is dash there and bash-in-sh-mode on
macOS. Pin `bash` if you rely on a bashism.
