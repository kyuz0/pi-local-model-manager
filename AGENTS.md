# Agent guide

## Purpose and code map

Discover local inference endpoints and maintain Pi's model catalogue while preserving user settings. Read `README.md` and `docs/configuration.md`. `extensions/local-models.js` exposes Pi commands; `scripts/discover-local-models.mjs` probes servers; `sync-local-models.mjs` merges configuration; `initialize-models.mjs` handles fresh startup. `model-limits.mjs` and `thinking.mjs` define context/output limits and engine-specific thinking controls.

Retain the server's context and image capabilities. Discovery must tolerate offline servers and never erase unrelated user models. Match thinking parameters to actual engine support; do not guess from model names alone. Credentials and generated models.json belong outside this repository.

## Tests and consumers

Use Node >=22.19; run `npm test` from the root. Tests under `tests/` use local HTTP fixtures. Add regression coverage for discovery, merging and startup when changing those paths. Local AI Sandboxes pins this extension in `containers/dev/extensions.lock.json`; publish the extension change first, then update that pin and test a disposable sandbox. Do not change another project's pin merely for documentation edits.

# Development rules

Keep this extension independently installable. Keep credentials, transcripts, generated user configuration and machine-specific paths out of the repository. Preserve user settings and report incomplete operations accurately. Run the fixture suite before publishing changes. Tests that require an account or inference need explicit authorization. Keep documentation concise and focused on installation and behavior.

Write public-facing documentation in plain language. Omit private repository status, development history, working notes, obvious remarks and repetitive disclaimers. Explain installation, useful behavior and necessary configuration.
