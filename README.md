# runtpt

Executable markdown runbooks, GitHub-first.

A runbook is a plain `.md` file living in a GitHub repository. runtpt opens it in the
browser, streams its code cells to a local agent running on your machine, and records
every output in a side-car `.runtpt` file. The same markdown can be projected as a
slide deck without any change.

Status: **specification**. No code yet.

- [Specification](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [`.runtpt` file format](docs/FORMAT.md)
- [Markdown dialect](docs/MARKDOWN.md)
- [Roadmap](docs/ROADMAP.md)

The name `runtpt` is a placeholder derived from the output extension; renaming the
project later only affects the web app, not the file format.
