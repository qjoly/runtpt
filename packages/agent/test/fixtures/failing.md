# Failing fixture

```bash run id=bad
exit 2
```

```bash run id=after depends=bad
echo "unreachable"
```
