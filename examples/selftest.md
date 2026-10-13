---
title: runtpt self-test
runtpt:
  shell: bash
  params:
    - name: GREETING
      default: hello
---

# runtpt self-test

A runbook the CI runs headlessly on every push. If this file stops passing,
either the agent or the format broke.

## Shell state persists across cells

```bash run id=set-state
export RUNTPT_SELFTEST="{{ GREETING }}"
cd /tmp
```

```bash run id=read-state depends=set-state
test "$RUNTPT_SELFTEST" = "hello" || { echo "state did not persist"; exit 1; }
test "$(pwd)" = "/tmp" || { echo "cwd did not persist"; exit 1; }
echo "state ok"
```

## Exit codes are reported

```bash run id=expected-failure continue-on-error
exit 3
```

## Dependencies on a failed cell skip rather than run

```bash run id=never-runs depends=expected-failure
echo "this must not appear in the recording"
```

## Output is captured on both streams

```bash run id=streams depends=read-state
echo "to stdout"
echo "to stderr" >&2
```

## The `shell` alias resolves to the configured shell

```shell run id=alias-state
RUNTPT_ALIAS=ok
export RUNTPT_ALIAS
echo "alias runs under $0"
```

```shell run id=alias-check depends=alias-state
test "$RUNTPT_ALIAS" = "ok" || { echo "the alias session did not persist"; exit 1; }
echo "alias ok"
```
