# Deployment

## Image build

Multi-stage `Dockerfile` produces a slim runtime image based on
`node:22-alpine`:

1. `deps` — installs production + dev deps from lockfile
2. `build` — runs `npm run build`, then `npm prune --omit=dev`
3. `runtime` — copies the `build/` output, prod-only `node_modules`,
   and `package.json`. Runs as the unprivileged `node` user. Creates
   `/data` so the FX cache volume mount has a writable target.

Size: ~150–200 MB. Healthcheck hits `/healthz` every 30 s — Docker
marks the container `unhealthy` if LubeLogger is unreachable for two
consecutive checks (~1 minute).

**Local dev build:**
```sh
docker build -t quicklogger:dev .
docker run --rm -p 3000:3000 \
  -e LUBELOGGER_URL=http://host.docker.internal:8080 \
  -e LUBELOGGER_API_KEY=$KEY \
  quicklogger:dev
```

## CI workflow

`.github/workflows/ci.yml` runs on every push and pull request:

1. Lint (`npm run lint` — ESLint flat config)
2. Type-check (`npm run check` — svelte-check)
3. Unit + integration tests (`npm test` — Vitest)
4. Build (`npm run build`)
5. E2E (`npm run test:e2e` — Playwright on mobile-Safari profile) — gated; runs only when `tests/e2e/*.spec.ts` files exist (Task 25 introduces them)

Node 22 with npm cache. ~3-minute pipeline. CI must be green for the
release workflow (Task 29) to publish a multi-arch image.

## Release workflow (multi-arch GHCR)

`.github/workflows/build.yml` runs on:
- pushes to `main` — produces `:main` and `:latest` + `:sha-<short>`
- semver tag pushes (`v0.1.0`) — produces `:0.1.0`, `:0.1`, `:latest`,
  `:sha-<short>`
- manual `workflow_dispatch` trigger

Builds via `docker/build-push-action` with
`platforms: linux/amd64,linux/arm64`. QEMU handles cross-arch
emulation. Cache uses GitHub Actions native cache (`type=gha`).

Image is pushed to `ghcr.io/varunpan/quicklogger`. The package is
public — no auth needed to pull.

To cut a release:
1. Bump version in `package.json` (optional)
2. `git tag v0.1.0 && git push origin v0.1.0`
3. Watch the build job in Actions — once green, the new tag is
   available on GHCR.
4. On the homelab: `docker compose pull && docker compose up -d`
   in `/home/varun/stacks/quicklogger/`.

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

**Local git identity:** the working tree at
`~/Documents/Projects/personal/quicklogger` resolves to varunpan via
the `includeIf` rule in `~/.gitconfig` pointing at
`~/Documents/Projects/personal/.gitconfig`. The remote uses the
`personal` SSH host alias defined in `~/.ssh/config`, which routes
through `~/.ssh/github-personal` for SSH key auth.

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

| Tag | Behaviour | When to use |
|-----|-----------|-------------|
| `:0.1.2` (exact) | Frozen until you edit compose. | Production where you want bit-for-bit reproducibility. |
| `:0.1` (minor) | Auto-picks up patches in 0.1.x on `pull`. Won't jump to 0.2.x. | Most fork users — patches land automatically, breaking changes are gated. |
| `:latest` | Tracks main HEAD. Updates whenever any merge to main happens (after CI). | Solo-dev with full ownership of the repo and CI as the gate. The upstream homelab uses this. |

`docker compose pull && docker compose up -d` is the release ritual
either way — Dockhand's auto-update is off globally, so you opt in
manually.

## Homelab-specific stack

The upstream homelab runs quicklogger as a service inside the
existing `homeservices` stack (alongside `lubelog`), not as its own
top-level stack. This means quicklogger reaches LubeLogger over the
shared `br0` Docker network with no Traefik hop in the middle.

```yaml
# /home/varun/stacks/homeservices/docker-compose.yml — quicklogger entry
quicklogger:
  image: ghcr.io/varunpan/quicklogger:latest
  container_name: quicklogger
  restart: unless-stopped
  environment:
    - LUBELOGGER_URL=http://lubelog:8080            # br0 sibling, no Traefik hop
    - LUBELOGGER_API_KEY=${LUBELOGGER_API_KEY}      # in homeservices/.env
    - ORIGIN=https://quicklog.home.lab
    - PORT=3000
  volumes:
    - /home/varun/quicklogger/data:/data
  read_only: true
  tmpfs:
    - /tmp:rw,size=16m,mode=1777
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  pids_limit: 100
  mem_limit: 256m
  labels:
    - traefik.enable=true
    - traefik.http.services.quicklogger.loadbalancer.server.port=3000
    - traefik.http.routers.quicklogger-internal.rule=Host(`quicklog.home.lab`)
    - traefik.http.routers.quicklogger-internal.entrypoints=websecure
    - traefik.http.routers.quicklogger-internal.tls.certresolver=vault
    - traefik.http.routers.quicklogger-internal.service=quicklogger
  networks:
    br0:
      ipv4_address: 172.18.5.205
```

Routing: Traefik on `*.home.lab` with the `vault` cert resolver
issues a Vault PKI cert (the iPhone trusts the root CA). The compose
pins `:latest` because every commit on the upstream main branch is
gated by CI + PR review and is intended to be production-ready.

## Hardening the runtime

The base image (`node:22-alpine`) already runs as the unprivileged
`node` user (UID 1000). The compose-side directives below take that
further by removing privileges the runtime never needs.

| Directive | What it does | Why it's safe for quicklogger |
|-----------|--------------|--------------------------------|
| `read_only: true` | Mounts the root filesystem read-only. | The app only writes to `/data` (FX cache). Nothing else needs to change at runtime. |
| `tmpfs: [/tmp:rw,size=16m,mode=1777]` | Backs `/tmp` with 16 MB of in-memory storage. | Node's `os.tmpdir()` and any transient socket files have a writable home, but contents are wiped on restart and bounded in size. |
| `cap_drop: [ALL]` | Drops every Linux capability the kernel would normally grant. | An HTTP server needs zero capabilities — no raw sockets, no chown, no mount, no ptrace. |
| `security_opt: [no-new-privileges:true]` | Forbids any process from gaining new privileges (e.g., via setuid binaries). | Defense-in-depth in case a future dependency ships a setuid file. |
| `pids_limit: 100` | Caps the number of processes/threads the container can spawn. | Node + V8's worker pool sits around 10–20. 100 is plenty of headroom and bounds fork-bomb risk. |
| `mem_limit: 256m` | Hard memory ceiling; container is OOM-killed before exhausting the host. | Idle is ~50 MB; FX-chain heavy moments rarely top 100 MB. 256 MB is comfortable. |

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

- `docker exec quicklogger sh` still works (the `node:22-alpine` runtime ships `sh`), but anything you try to write outside `/data` or `/tmp` will fail with EROFS — that's the protection working.
- If a future feature genuinely needs to write somewhere else, add a targeted `tmpfs:` or `volumes:` entry rather than removing `read_only`.

**What this does *not* protect against:**

- Compromise of the LubeLogger upstream (we have full write access via the API key).
- Compromise of the homelab host itself (the container only constrains what it can do; it can't outweigh full host root).
- Logic bugs in quicklogger that submit unwanted data to LubeLogger.

For those threats, the right mitigations live elsewhere: Traefik
middleware (CrowdSec, rate limiting), LubeLogger's own audit log,
and code review.
