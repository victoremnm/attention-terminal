# Architecture Artifacts

This directory contains curated architecture notes generated from local Graphify
output. The raw `graphify-out/` directory is intentionally ignored because it is
generated, comparatively bulky, and should be re-created locally when needed.

## Regenerate

Install Graphify with SQL parser support in an isolated `uv` tool environment:

```bash
uv tool install 'graphifyy[sql]' --reinstall
```

Generate a no-LLM code graph:

```bash
GRAPHIFY_FORCE=1 graphify extract . --code-only --out .
graphify cluster-only . --no-label
```

Useful local inspection commands:

```bash
graphify explain "Home()" --graph graphify-out/graph.json
graphify explain "TickerLanes" --graph graphify-out/graph.json
graphify path "GET()" "TickerLanes" --graph graphify-out/graph.json
```

Before committing curated output, scan for accidental secrets:

```bash
rg -n "CLICKHOUSE|TRIGGER|HUGGINGFACE|HF_TOKEN|hf_|password|secret|token|KEY_|DB_PASSWORD|CLICKHOUSE_PASSWORD|TRIGGER_SECRET_KEY" docs graphify-out .graphifyignore
```
