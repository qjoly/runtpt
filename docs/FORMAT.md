# The `.runtpt` file format

`.runtpt` = *run output*. It is the side-car of a runbook: it holds **outputs and
execution metadata only**, never the prose. The markdown stays the single source of
truth; deleting every `.runtpt` loses history, not content.

Convention: `incident-4821.md` → `incident-4821.runtpt`, same directory. Multiple runs
of the same runbook may be kept as `incident-4821.2026-10-13T09-12.runtpt`.

## Encoding

JSON Lines, UTF-8, one record per line. Chosen because a run is written as it happens —
the agent appends, so a crashed run still leaves a usable file — and because line-based
diffs stay readable in a pull request.

## Record types

### `header` — always the first line

```json
{"t":"header","v":1,"runbook":{"path":"runbooks/incident-4821.md","sha":"9f1c…","repo":"qjoly/ops","ref":"main"},"run":{"id":"01JB…","started":"2026-10-13T09:12:04Z","params":{"CLUSTER":"staging"}},"host":{"name":"mocha-jump","os":"linux","arch":"amd64","agent":"runtpt-agent/0.1.0","cwd":"/home/qjoly/ops"}}
```

`runbook.sha` is the blob sha of the markdown at run time. It is what makes staleness
detection exact: if the current blob differs, the UI says so.

### `cell` — one per cell execution, opening record

```json
{"t":"cell","id":"check-nodes","hash":"sha256:ab12…","kernel":"bash","source":"kubectl --context staging get nodes","started":"2026-10-13T09:12:05Z","seq":1}
```

`source` is the **resolved** source, after parameter substitution and after redaction.
Storing it is what lets a `.runtpt` be read without the runbook at hand (FR-R4).

### `out` — a streamed chunk

```json
{"t":"out","id":"check-nodes","seq":2,"stream":"stdout","at":"2026-10-13T09:12:05.214Z","data":"NAME        STATUS   ROLES\n"}
```

`stream` is `stdout`, `stderr`, or `display` for a structured/rich payload:

```json
{"t":"out","id":"plot","seq":9,"stream":"display","mime":"image/png","encoding":"base64","data":"iVBORw0…"}
```

Payloads above a threshold are written as `{"ref":"blob:3"}` and stored in a sibling
`incident-4821.runtpt.d/` directory, so a single large artefact never makes the file
unreadable.

### `result` — closing record of a cell

```json
{"t":"result","id":"check-nodes","seq":12,"status":"ok","exit":0,"duration_ms":842,"ended":"2026-10-13T09:12:06Z"}
```

`status`: `ok` | `failed` | `cancelled` | `timeout` | `skipped`.

### `note` — anything the operator added during the run

```json
{"t":"note","at":"2026-10-13T09:14:00Z","after":"check-nodes","text":"node-3 was already NotReady before we started"}
```

This is the record that makes a `.runtpt` worth reviewing: a run annotated by the person
who did it beats a transcript.

### `footer` — written on clean completion

```json
{"t":"footer","ended":"2026-10-13T09:18:41Z","status":"ok","cells":{"ok":11,"failed":0,"skipped":2}}
```

Its absence means the run was interrupted — a fact worth displaying.

## Reading rules

- Unknown record types and unknown fields are ignored, never fatal. Forward compatible.
- Records for an unknown cell id are rendered at the end, in a *orphan outputs* section.
- A reader must handle a truncated last line.

## Redaction

Values of parameters declared `secret: true`, and anything matching the agent's redaction
patterns, are replaced by `«redacted:NAME»` **before** the record is written. Redaction
happens in the agent, not in the UI, so a file on disk is never more revealing than what
was displayed.

## Git hygiene

`.runtpt` is text, line-oriented, and append-only within a run, which diffs acceptably.
Suggested `.gitattributes`:

```
*.runtpt diff=jsonl -merge
```

Whether to commit them is left to the team; see the open question in SPEC.md.
