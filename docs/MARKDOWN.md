# The runtpt markdown dialect

Design constraint: a runbook must render correctly on GitHub. Everything runtpt adds is
either a fenced-code info string attribute or an HTML comment, both of which other
renderers ignore.

## Frontmatter

```yaml
---
title: Rotate the cluster certificates
runtpt:
  shell: bash                    # or a path: /opt/homebrew/bin/bash
  interpreters:
    python: /usr/bin/python3.12
  cwd: .
  env:
    KUBECONFIG: ~/.kube/config
  params:
    - name: CLUSTER
      prompt: Target cluster
      default: staging
    - name: VAULT_TOKEN
      secret: true
  presentation:
    theme: dark
    slides: hr        # hr | h1 | h2
---
```

Everything under `runtpt:` is optional. A runbook with no frontmatter still runs, with
`bash` in the directory the agent was started from.

### Which fences are cells

By default, **every fence whose language is a known kernel is a cell**: `bash`, `sh`,
`zsh`, `shell`, `python`, `http`. A `yaml`, `diff`, `json` or `text` fence stays prose,
because it was never a command. A runbook is written to be executed, and nobody annotates
three hundred fences by hand.

Nothing runs on its own, ever — being a cell means it *can* run when you ask.

For a document that merely *contains* commands — a README, a design note, a tutorial
quoting a dangerous command — opt out and tag the few fences that really are steps:

```yaml
---
runtpt:
  cells: tagged
---
```

In `tagged` mode only a fence carrying `run` (or any other runtpt attribute) becomes a
cell. Per-cell attributes apply in both modes, so you can still pin an `id`, a `timeout`
or a `confirm` where it matters.

## Executable cells

An executable cell is a fenced code block whose info string starts with a known kernel
and contains at least one runtpt attribute, or is explicitly marked `run`.

````markdown
```bash run id=check-nodes timeout=30s
kubectl --context "$CLUSTER" get nodes
```
````

A fence with no attributes is still a cell, as long as its language is a kernel. The
attributes below refine what happens when you run it; `run` only matters in `tagged`
mode, where it is what opts a fence in.

### Attributes

| Attribute | Meaning |
|---|---|
| `run` | marks the block executable when no other attribute is present |
| `id=<slug>` | stable identity used by the `.runtpt`; auto-derived from a content hash otherwise |
| `name="..."` | human label shown in the UI and in the presenter view |
| `timeout=30s` | kill the cell after this duration |
| `depends=a,b` | ids that must have succeeded first |
| `continue-on-error` | a failure does not stop *Run all*, and does not fail the run in headless mode — but dependents still skip |
| `confirm` | require an explicit confirmation click before running |
| `hidden` | not rendered in presentation mode (setup cells) |
| `cwd=./infra` | working directory for this cell only |
| `output=text\|json\|table\|chart` | how to render the result |
| `interactive` | attach a terminal; the cell expects input |
| `interpreter=/path` | run this cell with a specific binary |

### Kernels

- `shell` — **the runbook's shell**, whatever `shell:` says, overridable for a session
  from the web app or with `runtpt run --shell`. Write `shell` when the commands are
  portable and you do not care which shell runs them.
- `bash` / `sh` / `zsh` — a *pinned* shell. A cell that says `bash` always gets bash: the
  session override does not touch it, and the badge never claims one shell while another
  runs. Pin when the cell uses a dialect feature; use `shell` otherwise.

  Either way it is a persistent session, so exported variables and `cd` survive from one
  cell to the next. Sessions are keyed by interpreter as well as by kernel, so two cells
  asking for different `bash` paths get two independent shells.
- `python` — a persistent interpreter. Last-expression value is displayed; rich display
  follows the Jupyter mimebundle convention where practical.
- `http` — a declarative request block:

  ````markdown
  ```http run id=health
  GET https://api.{{ CLUSTER }}.example.com/healthz
  Authorization: Bearer {{ VAULT_TOKEN }}
  ```
  ````

  The response status, headers and body are the output; JSON is pretty-printed and
  foldable.

## Parameters and variables

`{{ NAME }}` is substituted before execution, from frontmatter params and from values
entered at run time. Cells also receive them as environment variables. The UI always
shows the resolved command before running, so substitution is never invisible.

Three sources feed a cell's environment, in increasing precedence:

1. frontmatter `env` — committed with the runbook, the same for everyone;
2. **session variables** — typed in the web app or passed with `runtpt run --env K=V`,
   never written anywhere, gone when the tab closes. This is where a token belongs;
3. resolved parameters — the declared inputs of this particular run.

A session variable can be marked secret, which registers it with the agent's redactor
exactly like a secret parameter: it is replaced by `«redacted:NAME»` before any output
reaches the browser or the `.runtpt`.

Closing the tab really does forget them: the agent unsets the variables it injected when
the connection drops, so a token does not linger in a shell that outlives the browser.
What your own commands exported stays, because that is session state you asked for.

## Checklists

A task list is part of the procedure, not decoration:

```markdown
- [ ] The source cluster is confirmed down
- [ ] The decision to fail over is recorded, with a named owner
```

Ticking one during a run writes a `check` record into the `.runtpt`, with its label and
the time. A replay therefore shows how far the intervention actually got, which is most
of what anyone wants to know afterwards.

## Images

Ordinary markdown images work, and resolve the way a reader would expect:

```markdown
![The failover path](assets/failover.png)
```

A relative path resolves against the **runbook's own directory**, so the same file renders
on GitHub and in runtpt without a second copy. Where the bytes come from depends on where
the runbook came from: a repository blob fetched with your token for a GitHub runbook, or
the agent for a runbook on disk. Either way the path is confined — an image cannot climb
out of the repository or out of the agent's root.

Absolute `http(s)` and `data:` URLs are passed through untouched; runtpt never fetches
them on your behalf.

There is a size ceiling per image. A diagram is fine; a screen recording is not.

## Speaker notes

```markdown
<!-- notes:
Mention that this is the step that broke in April.
-->
```

Invisible everywhere except the presenter view.

## Slides

With `slides: hr`, a `---` thematic break starts a new slide. With `slides: h2`, every
`##` does. Cells keep working; a slide containing a cell gets a run affordance.

## Directives

A small set of HTML comments for things that have no natural markdown form:

```markdown
<!-- runtpt:pause -->          advance step inside a slide
<!-- runtpt:checkpoint name -->  a named point a replay can jump to
```
