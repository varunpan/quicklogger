#!/usr/bin/env bash
#
# Bring up the local production-mirror server the way phone-UAT is tested:
# `node --env-file=.env build` (NOT `vite preview` — broken on this system).
#
# The reason this script exists: on this Mac, vite/adapter-node's precompress
# step is flaky. `npm run build` reports success but leaves build/client/**
# missing some of its .gz/.br companion files. adapter-node then throws an
# uncaught ENOENT the moment a real browser asks for a missing companion, and
# the server crashes — AFTER curl smoke probes pass, so it looks healthy right
# up until the phone hits it. "Build twice and hope" is non-deterministic.
# This script rebuilds until companion parity actually holds, then verifies the
# gzip path before handing off.

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5173}"
MAX_BUILDS=4

# --- guard: .env is required (node --env-file, and ORIGIN drives CSRF on submit)
if [ ! -f .env ]; then
  echo "✗ .env not found at repo root — node --env-file=.env needs it, and ORIGIN" >&2
  echo "  in .env is what makes CSRF pass on submit. Create it before running." >&2
  exit 1
fi

# --- kill any prior server on the port
PID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "→ killing stale server on :$PORT (pid $PID)"
  kill -9 $PID 2>/dev/null || true
fi

# --- companion parity check: every .js/.css must have BOTH .gz and .br
companions_complete() {
  local js gz_js br_js css gz_css br_css
  js=$(find build/client -name '*.js'    2>/dev/null | wc -l | tr -d ' ')
  gz_js=$(find build/client -name '*.js.gz'  2>/dev/null | wc -l | tr -d ' ')
  br_js=$(find build/client -name '*.js.br'  2>/dev/null | wc -l | tr -d ' ')
  css=$(find build/client -name '*.css'   2>/dev/null | wc -l | tr -d ' ')
  gz_css=$(find build/client -name '*.css.gz' 2>/dev/null | wc -l | tr -d ' ')
  br_css=$(find build/client -name '*.css.br' 2>/dev/null | wc -l | tr -d ' ')
  echo "  companions: js=$js gz=$gz_js br=$br_js | css=$css gz=$gz_css br=$br_css"
  [ "$js" -gt 0 ] \
    && [ "$js" -eq "$gz_js" ] && [ "$js" -eq "$br_js" ] \
    && [ "$css" -eq "$gz_css" ] && [ "$css" -eq "$br_css" ]
}

# --- build until companions are complete
built=0
for i in $(seq 1 "$MAX_BUILDS"); do
  echo "→ build attempt $i/$MAX_BUILDS"
  rm -rf .svelte-kit build node_modules/.vite
  npm run build >/dev/null 2>&1
  if companions_complete; then
    echo "  ✓ companions complete"
    built=1
    break
  fi
  echo "  ✗ incomplete precompress (the flake) — rebuilding"
done
if [ "$built" -ne 1 ]; then
  echo "✗ companions still incomplete after $MAX_BUILDS builds — aborting" >&2
  exit 1
fi

# --- start the production-mirror server
PORT="$PORT" node --env-file=.env build &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

LAN_IP=$(ipconfig getifaddr en1 2>/dev/null || ipconfig getifaddr en0)
echo "→ server pid $SERVER_PID, waiting for listen on :$PORT"
sleep 2

# --- smoke: base routes
fail=0
for route in / /maintenance /history /settings /api/vehicles; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://$LAN_IP:$PORT$route" || echo 000)
  printf "  GET %-16s → %s\n" "$route" "$code"
  [ "$code" = "200" ] || fail=1
done

# --- smoke: exercise the .gz path that crashes (bare curl smoke does NOT catch this)
JS_PATH=$(curl -s "http://$LAN_IP:$PORT/" | grep -oE '_app/immutable/[^"]+\.js' | head -1 || true)
if [ -n "$JS_PATH" ]; then
  enc=$(curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "http://$LAN_IP:$PORT/$JS_PATH" \
        | grep -i '^content-encoding:' || true)
  echo "  JS chunk gzip: ${enc:-MISSING}"
  echo "$enc" | grep -qi gzip || fail=1
else
  echo "  ✗ could not find a JS chunk in / — server not serving HTML?"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "✗ smoke failed — killing server" >&2
  exit 1
fi

# --- hold the server in the foreground (Ctrl-C stops it)
trap - EXIT
echo "✅ up at http://$LAN_IP:$PORT  (Ctrl-C to stop)"
wait $SERVER_PID
