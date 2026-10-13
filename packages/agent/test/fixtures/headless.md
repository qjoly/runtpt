---
title: Headless fixture
runtpt:
  shell: bash
  params:
    - name: GREETING
      default: hello
    - name: TOKEN
      secret: true
      default: super-secret-value
---

# Headless fixture

```bash run id=greet
echo "{{ GREETING }} from a cell"
```

```bash run id=leaky depends=greet
echo "token is {{ TOKEN }}"
```

```bash run id=boom continue-on-error
exit 4
```

```bash run id=orphan depends=boom
echo "must not run"
```

```bash run id=needs-approval confirm
echo "must not run either"
```

```bash run id=last depends=greet
echo done
```
