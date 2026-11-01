# Pi Local Model Manager

Discover local inference servers and refresh Pi's model catalogue. Preview changes, choose scan ports, then select a model in the same Pi session.

```sh
pi install git:git@github.com:kyuz0/pi-local-model-manager.git
```

The repository is private; Git access is required. In Pi:

```text
/reload
/local-models preview
/local-models refresh
/model
```

The default scan covers localhost ports `8000–8009` and `8080–8089`. Change it with `/local-models ports 8000,8001`; `/local-models status` shows the saved settings. The extension discovers running servers; it does not launch them.

## Model limits

Context and image support come from server metadata. Unknown context prevents a new entry from being created. Unknown image support produces a text-only entry with a warning.

The output allowance defaults to **32,768 tokens**, including reasoning, capped by the context and any advertised server output limit. Set `maxTokens` in `local-pi-models.json` inside Pi's agent directory to override it. Refresh after upgrading; remove an explicit `maxTokens: 4096` setting to use the new default.

Model refresh preserves unrelated providers and custom settings, reports conflicts and writes a private backup. An unreachable server retains its last known entries; a closed port or empty inventory removes extension-managed entries.

## Configuration

```json
{
  "host": "localhost",
  "ports": "8000,8001",
  "maxTokens": 32768
}
```

Host integrations can set `host` to `local-model.internal` and supply the allowed ports. The same package works on the host and inside a container.

Thinking controls follow the detected engine/model family. Exact overrides use `thinkingOverrides` entries with `endpoint`, `model`, `profile` and an optional `thinkingLevelMap`; available profiles are in [thinking.mjs](scripts/thinking.mjs). Preview shows the selection and assumptions. Custom thinking settings survive refresh.

## Initialize before opening Pi

```sh
PI_CODING_AGENT_DIR=/path/to/agent node scripts/initialize-models.mjs
```

The initializer uses the same configuration and needs no selected model or running Pi session. Exit code `3` means no usable model is currently available; a launcher can still open the editor and offer a later refresh. `--preview` makes no changes.

Requires Node.js 22.19+ and Pi's scoped model-registry refresh API. Run the fixture suite with `npm test`.
