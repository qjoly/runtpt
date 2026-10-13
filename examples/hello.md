---
title: Check a cluster is healthy
runtpt:
  shell: bash
  params:
    - name: CLUSTER
      prompt: Target cluster
      default: staging
  presentation:
    slides: h2
---

# Check a cluster is healthy

A three-minute sanity pass, run before every release.

## Nodes

Every node should be `Ready`. One `NotReady` is tolerable if it is a known spare.

```bash run id=check-nodes timeout=30s
kubectl --context "$CLUSTER" get nodes
```

<!-- notes:
If this hangs, it is almost always the VPN, not the cluster.
-->

## Workloads

```shell run id=check-pods depends=check-nodes
kubectl --context "$CLUSTER" get pods -A --field-selector=status.phase!=Running
```

An empty result is the expected one.

## API reachability

```http run id=health
GET https://api.{{ CLUSTER }}.example.com/healthz
```
