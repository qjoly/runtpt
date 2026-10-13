# The runtpt markdown dialect

Design constraint: a runbook must render correctly on GitHub. Everything runtpt adds is
either a fenced-code info string attribute or an HTML comment, both of which other
renderers ignore.

## Frontmatter

```yaml
---
title: Rotate the cluster certificates
runtpt:
  shell: bash
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

## Executable cells

An executable cell is a fenced code block whose info string starts with a known kernel
and contains at least one runtpt attribute, or is explicitly marked `run`.

````markdown
```bash run id=check-nodes timeout=30s
kubectl --context "$CLUSTER" get nodes
```
````

A fence with no attributes is **not** executable — it is a plain illustrative snippet.
This keeps existing documentation inert until someone opts a block in.

### Attributes

| Attribute | Meaning |
|---|---|
| `run` | marks the block executable when no other attribute is present |
| `id=<slug>` | stable identity used by the `.runtpt`; auto-derived from a content hash otherwise |
| `name="..."` | human label shown in the UI and in the presenter view |
| `timeout=30s` | kill the cell after this duration |
| `depends=a,b` | ids that must have succeeded first |
| `continue-on-error` | a failure does not stop *Run all* |
| `confirm` | require an explicit confirmation click before running |
| `hidden` | not rendered in presentation mode (setup cells) |
| `cwd=./infra` | working directory for this cell only |
| `output=text\|json\|table\|chart` | how to render the result |
| `interactive` | attach a terminal; the cell expects input |

### Kernels

- `bash` / `sh` / `zsh` — a persistent shell session per runbook. Exported variables and
  `cd` persist across cells.
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

## Parameters

`{{ NAME }}` is substituted before execution, from frontmatter params and from values
entered at run time. Cells also receive them as environment variables. The UI always
shows the resolved command before running, so substitution is never invisible.

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
