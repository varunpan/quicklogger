# quicklogger

Mobile-first PWA for logging fuel fillups to a self-hosted [LubeLogger](https://lubelogger.com) instance.

> **Status:** v0.1.0 — early. Single-user homelab tool. Public repo so anyone can fork and self-host.

![Form mockup placeholder](docs/screenshots/form.png) <!-- TODO: real screenshot once deployed -->

## Why

LubeLogger's web UI is great for review and analytics, but entering a fillup at the gas pump from a phone is fiddly. quicklogger is a one-form, install-as-PWA front door optimised for the pump:

- Auto-selects the last vehicle
- Volume in gallons or liters, cost in any major currency — converted server-side
- Live MPG-since-last-fill preview as you type
- Offline queue that auto-syncs when signal returns
- iOS Shortcut integration (voice + deep-link)
- Stays on your network — backend talks to LubeLogger over the internal Docker network, not the public internet

## Quickstart (fork-friendly)

```sh
git clone https://github.com/varunpan/quicklogger.git
cd quicklogger
cp compose.example.yml docker-compose.yml
# Edit docker-compose.yml — point LUBELOGGER_URL at your instance
echo "LUBELOGGER_API_KEY=<your editor-scope key>" > .env
docker compose up -d
```

quicklogger now serves on port 3000. Front it with your reverse proxy of choice for HTTPS.

## Configuration

| Var | Required | Default | Purpose |
|---|---|---|---|
| `LUBELOGGER_URL` | yes | — | URL of your LubeLogger (use container DNS if same network) |
| `LUBELOGGER_API_KEY` | yes | — | Editor-scope API key from LubeLogger |
| `LUBELOGGER_VOLUME_UNIT` | no | `gallons_us` | Currently only `gallons_us` is supported in v0.1.0 |
| `LUBELOGGER_CURRENCY` | no | `USD` | Target currency for storage |
| `FX_PROVIDERS` | no | `frankfurter,erapi,fawazahmed` | CSV chain order |
| `EXCHANGERATE_API_KEY` | no | — | If set, prepends `exchangerate-api` to the chain |
| `FX_CACHE_PATH` | no | `/data/fx-cache.json` | Persistent FX cache path |
| `PORT` | no | `3000` | App listen port |
| `ORIGIN` | no | — | SvelteKit CSRF origin (set to your public URL) |

## Documentation

- [Architecture](docs/architecture.md) — modules, FX chain, state, service worker
- [API mapping](docs/api-mapping.md) — endpoint shapes + LubeLogger upstream calls
- [Deployment](docs/deployment.md) — image build, CI, GHCR release, self-hosting
- [Apple Shortcuts](docs/shortcuts.md) — voice + deep-link recipes
- [UAT checklist](docs/uat.md) — manual test plan

## Development

```sh
npm install
npm run dev          # vite dev server on http://localhost:5173
npm test             # Vitest (unit + integration)
npm run test:e2e     # Playwright (build + preview + e2e)
npm run lint
npm run check
```

## License

MIT — see [LICENSE](LICENSE).
