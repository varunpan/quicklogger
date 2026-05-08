# Deployment

## Image build

(populated in Task 26)

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

(populated in Task 29)

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

(populated in Task 27)

## Homelab-specific stack

(populated in Task 34)
