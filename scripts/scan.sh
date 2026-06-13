#!/usr/bin/env bash
#
# Container vulnerability scan for the quicklogger image, using Trivy run via the
# official aquasec/trivy container — no local Trivy install required, just Docker.
#
# Severity policy mirrors the CI release gate (.github/workflows/build.yml): fail
# only on CRITICAL/HIGH that have a fix available (--ignore-unfixed). Unfixed CVEs
# are printed for visibility but never block, because a rebuild can't clear them
# until upstream ships a patch.
#
# Usage:
#   scripts/scan.sh                # build the image from the local tree, then scan
#   scripts/scan.sh <image-ref>    # scan an existing image instead of building,
#                                  #   e.g. ghcr.io/varunpan/quicklogger:latest
#
# Exit codes: 0 = clean (no fixable CRITICAL/HIGH)
#             1 = fixable CRITICAL/HIGH found, or a build/scan error
#
# Used by humans, and by the release-cut (preview) and release-ship (final gate)
# skills. See docs/deployment.md § "Vulnerability scanning".
set -euo pipefail

# Pin Trivy for reproducibility. Bump in lockstep with the trivy-action version in
# .github/workflows/build.yml so local and CI scans agree.
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.71.0}"
SEVERITY="CRITICAL,HIGH"

# Run from the repo root so the Docker build context is correct regardless of cwd.
cd "$(dirname "$0")/.."

if [ "${1:-}" != "" ]; then
  IMAGE="$1"
  echo "▸ Scanning existing image: $IMAGE"
else
  IMAGE="quicklogger:scan"
  echo "▸ Building $IMAGE from the local tree…"
  docker build -t "$IMAGE" .
fi

# Trivy (in its container) reads the local image through the Docker socket. A named
# cache volume persists the vulnerability DB so reruns don't re-download it.
trivy() {
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v quicklogger-trivy-cache:/root/.cache/ \
    "$TRIVY_IMAGE" "$@"
}

echo
echo "▸ Full report (all severities, for visibility)"
trivy image --scanners vuln --severity CRITICAL,HIGH,MEDIUM,LOW "$IMAGE" || true

echo
echo "▸ Gate: fixable ${SEVERITY} only (--ignore-unfixed)"
if trivy image --scanners vuln --ignore-unfixed --severity "$SEVERITY" \
     --exit-code 1 "$IMAGE"; then
  echo "✅ No fixable ${SEVERITY} vulnerabilities — safe to ship."
else
  echo "❌ Fixable ${SEVERITY} vulnerabilities found (listed above)."
  echo "   Address them before shipping — usually a base-image bump (Dependabot"
  echo "   opens these) or 'apk upgrade' rebuilding against the latest Alpine."
  exit 1
fi
