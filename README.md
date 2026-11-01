# Pi Local Model Manager

Discover local inference servers and select their models in Pi.

```sh
pi install git:github.com/kyuz0/pi-local-model-manager
```

In Pi:

```text
/reload
/local-models preview
/local-models refresh
/model
```

By default, discovery scans localhost ports `8000–8009` and `8080–8089`. Choose your ports with `/local-models ports 8000,8001`. Use `/local-models status` to see the configuration.

The extension reads the server's context limit and image capabilities, configures thinking controls for supported engines, and updates Pi's model list. Output defaults to **32,768 tokens**, including reasoning, subject to the server's limits. Existing user settings are preserved.

[Configuration and launcher integration](docs/configuration.md)

Requires Node.js 22.19+ and Pi. Run `npm test` for discovery, configuration and initialization tests.
