# quicklogger

Mobile-first PWA for logging fuel fill-ups to a self-hosted [LubeLogger](https://lubelogger.com) instance.

> **Status:** v0.1.1 — early. Single-user homelab tool. Public repo so anyone can fork and self-host.

## Why

LubeLogger's web UI is great for review and analytics, but entering a fill-up at the gas pump from a phone is fiddly. quicklogger is a one-form, install-as-PWA front door optimised for the pump:

- Auto-selects the last vehicle, with the photo pulled from LubeLogger
- Volume in gallons or liters, cost in any major currency — converted server-side
- Live MPG-since-last-fill preview as you type
- Offline queue that auto-syncs when signal returns
- iOS Shortcut integration (voice + deep-link)
- Stays on your network — backend talks to LubeLogger over the internal Docker network, not the public internet

## Screenshots

| Log fillup | Vehicles | Settings |
| :---: | :---: | :---: |
| ![Log fillup form](docs/screenshots/form.jpeg) | ![Vehicle picker](docs/screenshots/vehicles.jpeg) | ![Settings](docs/screenshots/settings.jpeg) |

## Self-hosting

### Prerequisites

- Docker (any host with `docker compose`)
- A running LubeLogger instance with an **Editor**-scope API key (LubeLogger → Setup → API Keys)
- A way to expose HTTPS to the phone you'll log from (Traefik, Caddy, Cloudflare Tunnel, Tailscale Funnel, etc.). Plain HTTP works on a LAN, but iOS won't install the PWA.

### Pattern 1 — standalone stack

```sh
git clone https://github.com/varunpan/quicklogger.git
cd quicklogger
cp compose.example.yml docker-compose.yml
# Edit docker-compose.yml — point LUBELOGGER_URL at your instance
echo "LUBELOGGER_API_KEY=<your editor-scope key>" > .env
docker compose up -d
```

quicklogger serves on port 3000. Front it with your reverse proxy.

### Pattern 2 — alongside LubeLogger in the same compose stack (recommended)

If you already run LubeLogger in a `docker compose` stack, drop quicklogger in next to it. Talking to LubeLogger over Docker DNS skips a public network round-trip:

```yaml
services:
  quicklogger:
    image: ghcr.io/varunpan/quicklogger:latest
    container_name: quicklogger
    restart: unless-stopped
    environment:
      - LUBELOGGER_URL=http://lubelog:8080         # the lubelog service's container name
      - LUBELOGGER_API_KEY=${LUBELOGGER_API_KEY}   # in your stack's .env
      - LUBELOGGER_VOLUME_UNIT=gallons_us
      - LUBELOGGER_CURRENCY=USD
      - ORIGIN=https://quicklog.example.com        # your public/internal URL
      - PORT=3000
    volumes:
      - /srv/quicklogger/data:/data                # bind-mount for the FX cache
    networks:
      - <same-network-as-lubelog>
```

Append `LUBELOGGER_API_KEY=<key>` to the stack's `.env`. Then `docker compose up -d quicklogger` — only that service starts, the others are untouched.

### Reverse proxy

The image listens on plain HTTP `:3000`. Front it with HTTPS. Traefik label snippet (internal-only host):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.services.quicklogger.loadbalancer.server.port=3000
  - traefik.http.routers.quicklogger.rule=Host(`quicklog.example.com`)
  - traefik.http.routers.quicklogger.entrypoints=websecure
  - traefik.http.routers.quicklogger.tls=true
```

For Caddy, nginx, or Cloudflare Tunnel: same idea — proxy `https://quicklog.example.com` → `http://quicklogger:3000`.

> **Set `ORIGIN` to your public URL.** SvelteKit uses it for CSRF protection on POSTs; a mismatched `ORIGIN` returns 403 on submit.

### First run

1. Open `https://quicklog.example.com` on your phone.
2. iOS: Share → Add to Home Screen.
3. Tap **☰** → **Vehicles** → confirm your fleet from LubeLogger appears (with photos).
4. Go back to **Log fillup**, enter a small dummy fill, submit. Confirm it lands in LubeLogger.

### Configuration

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LUBELOGGER_URL` | yes | — | URL of your LubeLogger (use container DNS if same network) |
| `LUBELOGGER_API_KEY` | yes | — | Editor-scope API key from LubeLogger |
| `LUBELOGGER_VOLUME_UNIT` | no | `gallons_us` | Currently only `gallons_us` is supported in v0.1 |
| `LUBELOGGER_CURRENCY` | no | `USD` | Target currency for storage |
| `FX_PROVIDERS` | no | `frankfurter,erapi,fawazahmed` | CSV chain order |
| `EXCHANGERATE_API_KEY` | no | — | If set, prepends `exchangerate-api` to the chain |
| `FX_CACHE_PATH` | no | `/data/fx-cache.json` | Persistent FX cache path |
| `PORT` | no | `3000` | App listen port |
| `ORIGIN` | no | — | SvelteKit CSRF origin (set to your public URL) |

## Development

### Dev prerequisites

- Node 22 (pin via [`nvm`](https://github.com/nvm-sh/nvm) or [`asdf`](https://asdf-vm.com/))
- npm 10+
- A reachable LubeLogger for integration testing — any of:
  - The LubeLogger you already self-host
  - A throwaway one: `docker run --rm -p 8080:8080 ghcr.io/hargata/lubelogger:latest`

### Setup

```sh
git clone https://github.com/varunpan/quicklogger.git
cd quicklogger
npm install
cat > .env <<EOF
LUBELOGGER_URL=http://localhost:8080
LUBELOGGER_API_KEY=<your key>
EOF
npm run dev   # http://localhost:5173
```

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build (adapter-node → `build/`) |
| `npm run preview` | Run the production build locally |
| `npm test` | Vitest — unit + route handler tests |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:e2e` | Playwright (mobile-Safari profile) |
| `npm run lint` | ESLint flat config |
| `npm run check` | `svelte-kit sync` + svelte-check |
| `npm run format` | Prettier across the tree |

### Testing layers

- **Vitest (unit + integration)** — `src/**/*.test.ts`. Server modules (env, currency, lubelogger client, FX cache) and SvelteKit route handlers (with MSW mocking the LubeLogger upstream) are covered here.
- **Playwright (E2E)** — `tests/e2e/*.spec.ts`. One mobile-Safari profile to match the target device. The service worker is set to `block` per-spec so Playwright route mocks aren't intercepted.

### Architecture pointers

- [`docs/architecture.md`](docs/architecture.md) — modules, FX chain, state, service worker
- [`docs/api-mapping.md`](docs/api-mapping.md) — endpoint shapes + LubeLogger upstream calls
- [`docs/deployment.md`](docs/deployment.md) — image build, CI, GHCR release
- [`docs/shortcuts.md`](docs/shortcuts.md) — Apple Shortcuts recipes
- [`docs/uat.md`](docs/uat.md) — manual test plan

### Contributing

PRs welcome. The repo is small enough to read in one sitting:

1. Open an issue describing the change before large work — especially anything that touches the server ↔ LubeLogger contract or the mobile form layout.
2. Branch from `main`. Conventional-commit-style messages preferred (`feat:`, `fix:`, `chore:`, `docs:`).
3. Lint + check + test must pass locally and in CI before merge:

   ```sh
   npm run lint && npm run check && npm test && npm run build
   ```

4. Branch protection on `main` requires a green `lint-and-test` check and a PR (no direct pushes).

## License

MIT — see [LICENSE](LICENSE).
