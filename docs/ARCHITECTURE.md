# Architecture

```
┌──────────────────────────────┐       ┌───────────────────────────┐
│  Browser (static SPA)        │       │  GitHub                   │
│                              │──────▶│  REST + raw content       │
│  · GitHub OAuth token        │       └───────────────────────────┘
│  · markdown parse & render   │
│  · run / replay / present    │              ▲
│  · .runtpt reader & writer   │              │ token exchange only
└──────────────┬───────────────┘       ┌──────┴────────────────────┐
               │ WebSocket (loopback)  │  Edge function            │
               │ paired, authenticated │  OAuth code → token       │
               ▼                       └───────────────────────────┘
┌──────────────────────────────┐
│  runtpt-agent (user machine) │
│  · kernel sessions           │
│  · streaming, cancellation   │
│  · redaction                 │
│  · local FS read/write       │
│  · headless CI mode          │
└──────────────────────────────┘
```

The browser holds the document and the UI. The agent holds the processes and the disk.
No runtpt server holds anything: the only server-side code is a stateless function that
trades an OAuth code for a token, because GitHub will not do that from a public client.

## Packages

| Package | Role |
|---|---|
| `@runtpt/core` | markdown → document model, cell identity, parameter resolution. No I/O. |
| `@runtpt/format` | `.runtpt` reader/writer, streaming encoder, redaction. Shared by web and agent. |
| `@runtpt/protocol` | the browser↔agent wire protocol, types + validation. |
| `@runtpt/agent` | the local binary: kernels, sessions, pairing, headless mode. |
| `@runtpt/web` | the SPA: browse, run, replay, present. |

`core` and `format` run in both environments; keeping them pure is what makes the
headless CI mode share the exact semantics of the browser run.

## Stack

TypeScript everywhere.

- Web: Vite + React, `unified`/`remark` for parsing, CodeMirror 6 for cell source,
  `xterm.js` for interactive cells.
- Agent: Node (LTS), distributed as `npx @runtpt/agent` and as a single-file build
  (`node --experimental-sea-config` or `bun build --compile`) for people who do not want
  Node around. Python kernel is a subprocess, not an in-process dependency.
- Tests: Vitest; the agent gets a conformance suite replaying fixture runbooks and
  diffing the produced `.runtpt` against a golden file.

## Browser ↔ agent protocol

JSON messages over a loopback WebSocket, `ws://127.0.0.1:7777`.

```
→ hello        { pairing, origin, client }
← welcome      { host, cwd, kernels, version }
→ open         { path }            open a local runbook
← document     { content }
→ run          { runId, cellId, kernel, source, env, cwd, timeout }
← chunk        { runId, cellId, seq, stream, data }
← result       { runId, cellId, status, exit, durationMs }
→ cancel       { runId, cellId }
→ record       { runId, record }   append a record to the .runtpt
→ save         { path, content }
```

The browser is the orchestrator: it decides what runs next and when a run ends. The
agent is deliberately dumb about document semantics — except in headless mode, where it
drives `@runtpt/core` itself.

## Sessions

One session per `(runbook, kernel)`. A bash session is a long-lived shell with a sentinel
protocol to delimit command boundaries and recover exit codes without losing interleaved
stderr. A python session is a long-lived interpreter. Sessions die with the agent, with
an explicit *restart kernel*, or after an idle timeout.

## Why not WASM in the browser

Considered and rejected for v1. Pyodide gives a zero-install Python, but the runbooks
this project targets are operational: `kubectl`, `ssh`, `terraform`, a VPN-only
endpoint. None of that exists in a browser sandbox. The agent is the feature, not the
tax. WASM remains possible later as a third kernel for self-contained teaching
notebooks.

## Why not a hosted runner

It would require runtpt to hold credentials to the user's infrastructure. That is a very
different product with a very different risk profile.
