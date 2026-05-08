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
5. Pin a release: `image: ghcr.io/varunpan/quicklogger:0.1.0`
   (avoid `:latest` for stability).
6. `docker compose up -d` — quicklogger now serves on port 3000.
   Put your reverse proxy in front of it for HTTPS.

If you run LubeLogger on the same Docker network, prefer container
DNS (e.g. `http://lubelogger:8080`) so traffic stays internal.

Mount `./data:/data` to persist the FX rate cache across container
restarts.

## Homelab-specific stack

(populated in Task 34)
