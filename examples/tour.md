---
title: A tour of runtpt
runtpt:
  shell: bash
  params:
    - name: TARGET
      prompt: What to look at
      default: this machine
  presentation:
    slides: h2
---

# A tour of runtpt

Every code block below is a real cell. Nothing runs until you ask it to, and
nothing needs a cluster or a token — only the last cell reaches the network.

## Cells keep their state

The first cell exports a variable and moves somewhere. The second one proves
both survived, because a runbook is one shell session, not a series of
disconnected commands.

```shell run id=setup
export TOUR_TARGET="{{ TARGET }}"
cd /tmp
echo "working in $(pwd)"
```

```shell run id=state depends=setup
echo "still in $(pwd), still looking at $TOUR_TARGET"
```

<!-- notes:
This is the thing people do not expect: it behaves like one terminal, not like
a list of snippets.
-->

## A cell says what it will run

`{{ TARGET }}` above was substituted before execution. The cell shows you the
resolved command, so a parameter can never change what runs behind your back.

```shell run id=facts depends=setup
printf '%-10s %s\n' host "$(hostname)" kernel "$(uname -s)" shell "$(ps -o comm= -p $$)"
```

## Failures are recorded, not hidden

This one fails on purpose. Its dependents are skipped rather than run against a
broken state, and the `.runtpt` keeps the exit code.

```shell run id=breaks continue-on-error
echo "about to fail" >&2
exit 3
```

```shell run id=skipped depends=breaks
echo "you should never see this"
```

## Other kernels

```python run id=python
import sys
f"python {sys.version_info.major}.{sys.version_info.minor} is here too"
```

```http run id=http
GET https://api.github.com/zen
```

## Present the same file

Press `P`. This document becomes a deck, headings become slides, and the cells
above stay live — you can run them in front of a room and the output lands on
the slide.
