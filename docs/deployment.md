# Deployment

## Image build

Multi-stage `Dockerfile` produces a slim runtime image based on
`node:24-alpine`:

1. `deps` — installs production + dev deps from lockfile
2. `build` — runs `npm run build`, then `npm prune --omit=dev`
3. `runtime` — runs `apk upgrade --no-cache` to patch OS packages
   (libssl3/libcrypto3, etc.) and removes the base image's bundled
   npm/npx (unused at runtime), then copies the `build/` output,
   prod-only `node_modules`, and `package.json`. Runs as the
   unprivileged `node` user. Creates `/data` so the FX cache volume
   mount has a writable target.

Size: ~150–200 MB. Healthcheck hits `/healthz` every 30 s — with
Docker's default of 3 retries, the container is marked `unhealthy`
after three consecutive failures (~90 s+).

The image sets `BODY_SIZE_LIMIT=Infinity` to disable adapter-node's
transport-layer body cap. `0` is **not** "unlimited" there — it's a
literal 0-byte limit that rejects every request with a body — so
`Infinity` is the only way to turn the cap off. Per-route limits still
apply: the OCR upload (the only route that buffers a large body)
enforces its own `OCR_MAX_IMAGE_MB` cap (default 5 MiB) and returns a
clean 413.

**Local dev build:**

```sh
docker build -t quicklogger:dev .
docker run --rm -p 3000:3000 \
  -e LUBELOGGER_URL=http://host.docker.internal:8080 \
  -e LUBELOGGER_API_KEY=$KEY \
  quicklogger:dev
```

## Dev prod-mirror compose (`compose.dev.yml`)

`compose.dev.yml` builds and runs the **real production image** locally so you
test the exact artifact that ships — not a `node build` host preview. It differs
from `compose.example.yml` (the self-host path) in one key way:

|         | `compose.example.yml`                               | `compose.dev.yml`                             |
| ------- | --------------------------------------------------- | --------------------------------------------- |
| Image   | `image: ghcr.io/varunpan/quicklogger:latest` (pull) | `build: .` (build from source)                |
| For     | self-hosters running a release                      | contributors / dev UAT                        |
| Traefik | none                                                | env-driven labels + network, inert by default |

### Layer 1 — localhost (default)

```sh
cp .env.example .env       # set LUBELOGGER_URL + LUBELOGGER_API_KEY
docker compose -f compose.dev.yml up --build
```

Serves `http://localhost:3000`. Because `localhost` is a secure context, the
service worker registers, so PWA/offline is testable in a desktop browser with
no extra infra. The container listens on `:3000` internally (prod-identical) and
publishes to host `${HOST_PORT:-3000}`.

> **`ORIGIN` precedence.** Compose auto-merges the project `.env`, so an `ORIGIN`
> set there (e.g. for phone testing, below) **shadows** the `http://localhost:3000`
> default. For desktop localhost testing, leave `ORIGIN` unset in `.env` (or set
> it to `http://localhost:3000`) — otherwise a browser hitting `localhost:3000`
> gets a 403 on submit from the CSRF origin check.

### Layer 2 — on-device phone testing over HTTPS

A phone on a LAN IP is **not** a secure context, so the service worker won't
register there without HTTPS. To test on a real phone, front the container with
your reverse proxy. The Traefik labels and proxy-network attachment are
parameterized by env vars (inert by default), so you opt in entirely through
your (gitignored) `.env` — nothing reverse-proxy-specific is committed:

```sh
# in .env — use a DEV-ONLY hostname, distinct from your production deployment
ORIGIN=https://quickloggerdev.example.com
TRAEFIK_ENABLE=true
TRAEFIK_HOST=quickloggerdev.example.com
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=your-resolver
TRAEFIK_NETWORK=your-proxy-network
TRAEFIK_NETWORK_EXTERNAL=true
```

```sh
docker compose -f compose.dev.yml up --build
```

> **The phone must trust the cert.** If your reverse proxy serves an internal
> hostname with a private CA, the phone won't register the service worker until
> that CA's root cert is installed and trusted on the device. A publicly-trusted
> cert (e.g. a real Let's Encrypt domain) needs no phone-side step.

### Env knobs

| Var                        | Default                    | Effect                                           |
| -------------------------- | -------------------------- | ------------------------------------------------ |
| `HOST_PORT`                | `3000`                     | Host port published → container `:3000`          |
| `ORIGIN`                   | `http://localhost:3000`    | CSRF origin; must match the URL the browser hits |
| `TRAEFIK_ENABLE`           | `false`                    | `true` to expose via Traefik (layer 2)           |
| `TRAEFIK_HOST`             | `quickloggerdev.localhost` | Router host rule                                 |
| `TRAEFIK_ENTRYPOINT`       | `websecure`                | Traefik HTTPS entrypoint                         |
| `TRAEFIK_CERTRESOLVER`     | _(empty)_                  | Traefik cert resolver name                       |
| `TRAEFIK_NETWORK`          | `quicklogger_dev_net`      | Proxy network name                               |
| `TRAEFIK_NETWORK_EXTERNAL` | `false`                    | `true` to join an existing external network      |

App env: the core vars (`LUBELOGGER_*`, `FX_PROVIDERS`, `LOG_LEVEL`,
`OCR_PROVIDER_CHAIN`, and the `OLLAMA_VISION_*` / `OLLAMA_CLOUD_*` slots) read
from `.env` like the other compose files; see `.env.example`. Two deliberate
deviations: `OLLAMA_VISION_URL` is hardcoded to
`http://host.docker.internal:11434` (a host-path `localhost` value would
resolve to the container itself — see the in-file comment), and the on-disk
paths (`FX_CACHE_PATH`, `LOG_FILE_PATH`, `OCR_BUDGET_PATH`, `OCR_AUDIT_PATH`,
`OCR_AUDIT_KEY_PATH`) are pinned under `/data`. Vars the file doesn't forward
(`OPENROUTER_*`, `OPENAI_COMPATIBLE_*`, the `OCR_*` budget / rate-limit /
range / image-size knobs, `LOG_PRETTY`, `LOG_FILE_MAX_*`) fall back to their
app defaults. Logs land
in `./data/logs/quicklogger.log` via the `./data:/data` bind mount, so the
host-side log read works the same as the `node build` UAT path.

## CI workflow

`.github/workflows/ci.yml` runs on every push and pull request.
Concurrent runs on the same ref cancel the superseded one
(`concurrency` with `cancel-in-progress`):

1. Audit dependencies (`npm audit --audit-level=high` — runs first, over the full dependency tree; fails on high/critical)
2. Lint (`npm run lint` — ESLint flat config)
3. Format check (`npm run format:check` — Prettier, config in `.prettierrc`)
4. Type-check (`npm run check` — svelte-check)
5. Unit + integration tests (`npm test` — Vitest)
6. Build (`npm run build`)
7. E2E (`npm run test:e2e` — Playwright on mobile-Safari profile) — gated; runs only when `tests/e2e/*.spec.ts` files exist

Node 24 with npm cache. ~3-minute pipeline. There's no mechanical
trigger linking the two workflows — `build.yml` fires on a tag push
regardless of CI — so "CI green before release" is enforced procedurally
by the `release-ship` flow, which runs the full sweep before pushing the
tag.

## Release workflow (multi-arch GHCR)

`.github/workflows/build.yml` runs on:

- semver tag pushes (`v0.1.0`) — produces `:0.1.0`, `:0.1`, `:latest`,
  `:sha-<short>`
- manual `workflow_dispatch` trigger

(Bare commits to `main` do **not** build — only a tag push does. The
canonical path is `release-ship`'s tag push.)

Builds via `docker/build-push-action` with
`platforms: linux/amd64,linux/arm64`. QEMU handles cross-arch
emulation. Cache uses GitHub Actions native cache (`type=gha`). The
image is scanned for vulnerabilities **before** the push — see
§ _Vulnerability scanning_ below.

Image is pushed to `ghcr.io/varunpan/quicklogger`. The package is
public — no auth needed to pull.

To cut a release:

1. Bump version in `package.json` (optional)
2. `git tag v0.1.0 && git push origin v0.1.0`
3. Watch the build job in Actions — once green, the new tag is
   available on GHCR.
4. On your host: `docker compose pull && docker compose up -d`
   in your stack directory.

## Vulnerability scanning

The published image is scanned for known CVEs (OS packages + bundled npm
deps) with [Trivy](https://trivy.dev) before it ever reaches GHCR, and
dependencies are kept current with Dependabot. Motivation and history:
issue #31.

**Severity policy.** The build fails only on **CRITICAL/HIGH CVEs that
have a fix available** (`--ignore-unfixed`). Unfixed findings (no
upstream patch yet) are reported but don't block — blocking on them
would wedge releases on something a rebuild can't clear. Medium/low are
reported, never gated.

**Where scanning happens:**

| Stage                                    | Mechanism                                                                                                                  | Blocking?                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Release build (`build.yml`, on tag push) | `aquasecurity/trivy-action` scans the amd64 image _before_ the multi-arch push; SARIF goes to **Security → Code scanning** | **Yes** — fixable CRITICAL/HIGH fail the build, so a vulnerable image is never published |
| `release-cut` (start of a cycle)         | `scripts/scan.sh ghcr.io/varunpan/quicklogger:latest` previews what the currently-deployed image carries                   | No — informational, so fixes can be planned for the cycle                                |
| `release-ship` (final sweep)             | `scripts/scan.sh` builds and scans the about-to-ship image                                                                 | **Yes** — stops the ship if fixable CRITICAL/HIGH remain, before the tag triggers CI     |
| Anytime, locally                         | `bash scripts/scan.sh` (build + scan) or `scripts/scan.sh <image-ref>`                                                     | Exits non-zero on fixable CRITICAL/HIGH                                                  |

`scripts/scan.sh` and the CI gate apply the same policy and run Trivy via
the `aquasec/trivy` container, so no local Trivy install is needed — just
Docker. Keep the Trivy version in `scripts/scan.sh` in lockstep with the
`trivy-action` version in `build.yml`.

**Why most findings are OS-level.** The base image (`node:24-alpine`)
trails Alpine's package index, so OpenSSL (`libssl3`/`libcrypto3`) and
friends can ship with already-fixed CVEs. The runtime stage runs
`apk upgrade --no-cache` at build time to pull these up to the latest
Alpine patch, and Dependabot's `docker` ecosystem opens a PR when a newer
base is available. It also removes the base image's bundled **npm/npx** —
the production container only runs `node build` and never invokes npm, so
dropping it clears CVEs carried in npm's _own_ bundled dependencies (a
`picomatch` ReDoS surfaced this way in #31's scan) and trims attack
surface. The app itself bundles nearly all its npm deps into the build
artifact and ships a **single** runtime `dependency` — `rotating-file-stream`
(log rotation) — so the remaining npm attack surface inside the image is
minimal.

**Source-tree dependencies (`npm audit`).** Image scanning only sees what
ships _in the image_ — it's blind to `devDependencies` that get compiled
into the `build/` bundle (Svelte's SSR runtime, `@sveltejs/kit`,
`devalue`). To cover that layer, `ci.yml` runs `npm audit` over the
**full** dependency tree on every PR and fails on **high/critical**
advisories. It deliberately does _not_ use `--omit=dev` — that would
re-open the blind spot, since those compiled-in packages are
devDependencies. A high-severity `devalue` DoS is fixed by pinning it to
the patched `5.8.1` via an npm `override` in `package.json` (it's a
transitive SvelteKit dep). The four moderate `svelte` SSR-XSS advisories are
cleared by upgrading to `5.56.3` (#37); see that fix's note in the CHANGELOG for
why the bump needed a CropOverlay rework first. The **`cookie`** advisory (low)
has since been cleared by a targeted npm `override` pinning `cookie` to `^0.7.0`
under `@sveltejs/kit` — `npm audit` no longer reports it. The `brace-expansion`
DoS advisory, previously deferred here while it sat below the high gate, was
escalated to **high** and fixed upstream in `5.0.8`; it was cleared for v0.3.2
alongside a `postcss` path-traversal high and a moderate `@sveltejs/kit`
prototype-pollution pair. All three landed inside the existing caret ranges, so
the fix was a `package-lock.json`-only bump with no `package.json` change. A
**second** `brace-expansion` DoS
([GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895)) later
bypassed that mitigation via unbounded intermediate arrays and was cleared for
v0.3.3 by `5.0.9`. The same release cleared five **`undici`** advisories — worst
a cross-user information disclosure and parse-time crash via degenerate private
cache directives
([GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272)).
`undici` reaches the tree only through `jsdom`, and is held on the patched line
by an npm `override` pinning it to `^7.29.0` under `jsdom` — raised from
`^7.28.0` so a future resolution can't settle back onto a vulnerable 7.28.x.
Both are dev-tooling paths; neither ships in the runtime image.

`npm audit` currently reports **0 vulnerabilities**, and no advisory is
knowingly deferred. Dependabot will open PRs as further upstream fixes land.

**Dependabot** (`.github/dependabot.yml`) opens weekly PRs for three
ecosystems: `npm` (deps), `docker` (base image), and `github-actions`
(workflow action pins). `github-actions` PRs **auto-merge** once `lint-and-test`
passes (`.github/workflows/dependabot-auto-merge.yml`) — those updates never
ship in the runtime image, so they're CI-gated only and don't need a release.
`npm` and `docker` PRs are merged **manually**: npm `devDependencies` mix pure
tooling with compiled-in `svelte` / `@sveltejs/kit` / `@tailwindcss` that ship
in the bundle, and `docker` is the runtime base image — both warrant a human and
ride a tagged release. GitHub's Dependabot _security_ updates and secret
scanning + push protection are enabled at the repo level (Settings → Code
security and analysis).

## GitHub repository setup

The repository is `varunpan/quicklogger`, public, MIT-licensed.

**Branch protection on `main`:**

- PR required (no direct pushes)
- Linear history (squash or rebase only, no merge commits)
- `lint-and-test` CI status check must pass
- CODEOWNERS auto-requests `@varunpan` as reviewer on every PR
- `required_approving_review_count: 0` for solo work (self-approval is
  not possible on GitHub; flip to 1 after onboarding a collaborator)
- Admins can override in emergencies (`enforce_admins: false`)
- Force-pushes and deletions disabled

**CODEOWNERS** lives at `.github/CODEOWNERS`. As collaborators join,
add path-specific entries above the catch-all `*  @varunpan` line.

## Self-hosting (fork-friendly)

To run quicklogger against your own LubeLogger:

1. `cp compose.example.yml docker-compose.yml`
2. Edit `LUBELOGGER_URL` to point at your LubeLogger container/host.
3. Create an Editor-scope API key in LubeLogger (Settings → API keys).
4. Put it in `.env` as `LUBELOGGER_API_KEY=...` (the compose file
   reads `${LUBELOGGER_API_KEY}` from the environment / `.env`).
5. Pick a pin strategy — see "Image pin strategies" below.
6. `docker compose up -d` — quicklogger now serves on port 3000.
   Put your reverse proxy in front of it for HTTPS.

If you run LubeLogger on the same Docker network, prefer container
DNS (e.g. `http://lubelogger:8080`) so traffic stays internal.

Mount `./data:/data` to persist the FX rate cache across container
restarts.

## Image pin strategies

The build workflow tags every release multiple ways on GHCR. Pick
the one that matches your tolerance for surprise:

| Tag              | Behaviour                                                                                                                                              | When to use                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `:0.1.2` (exact) | Frozen until you edit compose.                                                                                                                         | Production where you want bit-for-bit reproducibility.                       |
| `:0.1` (minor)   | Auto-picks up patches in 0.1.x on `pull`. Won't jump to 0.2.x.                                                                                         | Most fork users — patches land automatically, breaking changes are gated.    |
| `:latest`        | Points at the most recent tagged release — re-stamped on every tag build, not on bare merges to main (see "Release workflow": only a tag push builds). | Owners who always want the newest release and accept auto-updates on `pull`. |

`docker compose pull && docker compose up -d` is the release ritual
either way — updates are opt-in, so you pull when you're ready.

## Same-stack deployment (recommended)

If you already run LubeLogger via `docker compose`, prefer adding
quicklogger as a service inside the **same** stack rather than a new
top-level one. Reaching LubeLogger over the shared Docker network
skips a public network round-trip and means LubeLogger doesn't need
to be browser-accessible just for the backend's API calls.

```yaml
# Inside your existing LubeLogger compose stack
quicklogger:
  image: ghcr.io/varunpan/quicklogger:0.1.2
  container_name: quicklogger
  restart: unless-stopped
  environment:
    - LUBELOGGER_URL=http://<lubelog-service-name>:8080 # the LubeLogger service's name on this network
    - LUBELOGGER_API_KEY=${LUBELOGGER_API_KEY} # in the stack's .env
    - ORIGIN=https://quicklog.example.com # the URL you'll serve from
    - PORT=3000
  volumes:
    - /srv/quicklogger/data:/data # bind-mount for the FX cache
  read_only: true
  tmpfs:
    - /tmp:rw,size=16m,mode=1777
  cap_drop: [ALL]
  security_opt: ['no-new-privileges:true']
  pids_limit: 100
  mem_limit: 256m
  labels:
    # If you front quicklogger with Traefik, see "Reverse proxy" in the README
    # for the label snippet. Adapt to Caddy/nginx/Cloudflare Tunnel as needed.
  networks:
    - <same-network-as-lubelog>
```

`docker compose up -d quicklogger` brings up just the new service —
existing services stay untouched.

## Hardening the runtime

The base image (`node:24-alpine`) already runs as the unprivileged
`node` user (UID 1000). The compose-side directives below take that
further by removing privileges the runtime never needs.

| Directive                                | What it does                                                                 | Why it's safe for quicklogger                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `read_only: true`                        | Mounts the root filesystem read-only.                                        | The app only writes to `/data` (FX cache). Nothing else needs to change at runtime.                                              |
| `tmpfs: [/tmp:rw,size=16m,mode=1777]`    | Backs `/tmp` with 16 MB of in-memory storage.                                | Node's `os.tmpdir()` and any transient socket files have a writable home, but contents are wiped on restart and bounded in size. |
| `cap_drop: [ALL]`                        | Drops every Linux capability the kernel would normally grant.                | An HTTP server needs zero capabilities — no raw sockets, no chown, no mount, no ptrace.                                          |
| `security_opt: [no-new-privileges:true]` | Forbids any process from gaining new privileges (e.g., via setuid binaries). | Defense-in-depth in case a future dependency ships a setuid file.                                                                |
| `pids_limit: 100`                        | Caps the number of processes/threads the container can spawn.                | Node + V8's worker pool sits around 10–20. 100 is plenty of headroom and bounds fork-bomb risk.                                  |
| `mem_limit: 256m`                        | Hard memory ceiling; container is OOM-killed before exhausting the host.     | Idle is ~50 MB; FX-chain heavy moments rarely top 100 MB. 256 MB is comfortable.                                                 |

**Verify the directives took effect after `docker compose up -d`:**

```sh
docker inspect quicklogger -f '
ReadOnly={{.HostConfig.ReadonlyRootfs}}
CapDrop={{.HostConfig.CapDrop}}
NoNewPriv={{.HostConfig.SecurityOpt}}
PidsLimit={{.HostConfig.PidsLimit}}
Memory={{.HostConfig.Memory}}
'
```

Expected: `ReadOnly=true`, `CapDrop=[ALL]`, `NoNewPriv=[no-new-privileges:true]`, `PidsLimit=100`, `Memory=268435456` (256 MB in bytes).

**Trade-offs:**

- `docker exec quicklogger sh` still works (the `node:24-alpine` runtime ships `sh`), but anything you try to write outside `/data` or `/tmp` will fail with EROFS — that's the protection working.
- If a future feature genuinely needs to write somewhere else, add a targeted `tmpfs:` or `volumes:` entry rather than removing `read_only`.

**What this does _not_ protect against:**

- Compromise of the LubeLogger upstream (we have full write access via the API key).
- Compromise of the host itself (the container only constrains what it can do; it can't outweigh full host root).
- Logic bugs in quicklogger that submit unwanted data to LubeLogger.

For those threats, the right mitigations live elsewhere: Traefik
middleware (CrowdSec, rate limiting), LubeLogger's own audit log,
and code review.
