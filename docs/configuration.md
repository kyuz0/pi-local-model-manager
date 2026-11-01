# Configuration

Settings live in `local-pi-models.json` inside Pi's agent directory:

```json
{
  "host": "localhost",
  "ports": "8000,8001",
  "maxTokens": 32768
}
```

`maxTokens` includes reasoning and answer tokens. Discovery caps it at the context limit and any output limit advertised by the server. Missing context metadata prevents a new model entry; unknown image support produces a text-only entry and a warning.

Refresh preserves unrelated providers, reports configuration conflicts and creates a private backup. Unreachable servers retain their last known entries. Closed ports and empty inventories remove extension-managed entries.

## Thinking controls

Thinking controls follow the detected engine and model family. For an alias or custom server, add an exact override:

```json
{
  "thinkingOverrides": [
    {"endpoint": "http://localhost:8000", "model": "my-model", "profile": "gufo-qwen"}
  ]
}
```

Profiles: `dwarfstar-qwen`, `gufo-qwen`, `llama-qwen`, `llama-thinking-toggle`, `dwarfstar-deepseek-v4`, `dwarfstar-deepseek41`, `gufo-deepseek-v4`, `openai-effort`, `disabled`. An optional `thinkingLevelMap` supplies custom levels. Preview shows the selected profile; custom settings survive refresh.

## Launcher integration

Container launchers can set `host` to `local-model.internal` and supply the allowed ports. To initialize the catalogue before opening Pi:

```sh
PI_CODING_AGENT_DIR=/path/to/agent node scripts/initialize-models.mjs
```

The initializer reads the same settings. Exit code `3` means no usable model is available; the launcher can open the editor and offer a later refresh. `--preview` shows changes without writing them.
