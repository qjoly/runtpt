# runtpt

Executable markdown runbooks, GitHub-first.

A runbook is a plain `.md` file living in a GitHub repository. runtpt opens it in the
browser, streams its code cells to a local agent running on your machine, and records
every output in a side-car `.runtpt` file. The same markdown can be projected as a
slide deck without any change.

Status: **v1 implemented**. Everything below runs today.

```bash
npm install
npm run dev                  # the web app, with a bundled demo runbook
npx @runtpt/agent serve      # the local agent, in the directory you want to work in
```

The agent prints a pairing link; open it and the browser is wired to your machine.
For CI, skip the browser entirely:

```bash
runtpt run runbooks/incident.md --out incident.runtpt
```

- [Specification](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [`.runtpt` file format](docs/FORMAT.md)
- [Markdown dialect](docs/MARKDOWN.md)
- [Roadmap](docs/ROADMAP.md)

## Packages

| Package | Role |
|---|---|
| `@runtpt/core` | markdown dialect, cell identity, parameters, run plan, slides |
| `@runtpt/format` | `.runtpt` streaming writer, tolerant reader, redaction |
| `@runtpt/protocol` | the browser/agent wire protocol |
| `@runtpt/agent` | the local binary: kernels, paired server, headless runs |
| `@runtpt/web` | the SPA: browse, run, replay, present |

The name `runtpt` is a placeholder derived from the output extension; renaming the
project later only affects the web app, not the file format.
