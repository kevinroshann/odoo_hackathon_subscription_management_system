#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MAIN_PORT="${MAIN_PORT:-3000}"
AUTH_PORT="${AUTH_PORT:-3001}"

if [[ -n "${NVM_BIN:-}" && -x "$NVM_BIN/node" ]]; then
  PATH="$NVM_BIN:$PATH"
  export PATH
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.5 or newer is required. Run 'nvm use 22' first." >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 5) ? 0 : 1)'; then
  echo "Node.js 22.5 or newer is required; found $(node --version)." >&2
  echo "If you use nvm, run 'nvm use 22' and 'export PATH=\"$NVM_BIN:\$PATH\"' first." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/brightloop-auth/.env" ]]; then
  echo "Missing brightloop-auth/.env. Follow the first-run setup in README.md." >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/brightloop-auth/node_modules" ]]; then
  echo "Auth dependencies are missing. Run 'npm ci' in brightloop-auth/ first." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to verify that both apps started successfully." >&2
  exit 1
fi

check_port_available() {
  local port="$1"
  if ! node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", error => {
      console.error(`Port ${process.argv[1]} is unavailable: ${error.message}`);
      process.exit(1);
    });
    server.listen(Number(process.argv[1]), "0.0.0.0", () => server.close());
  ' "$port"; then
    echo "Choose unused ports, for example: MAIN_PORT=3100 AUTH_PORT=3101 ./run.sh" >&2
    exit 1
  fi
}

check_port_available "$MAIN_PORT"
check_port_available "$AUTH_PORT"

main_pid=
auth_pid=

stop_apps() {
  trap - INT TERM EXIT
  for pid in "$main_pid" "$auth_pid"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$main_pid" "$auth_pid"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local expected_status="$3"
  local pid="$4"
  local status

  for _ in {1..30}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name exited before becoming ready. Check the error above." >&2
      return 1
    fi

    status="$(curl --connect-timeout 1 --max-time 2 --silent --output /dev/null \
      --write-out '%{http_code}' "$url" || true)"
    if [[ "$status" == "$expected_status" ]]; then
      return 0
    fi
    sleep 0.5
  done

  echo "$name did not respond at $url (last HTTP status: ${status:-none})." >&2
  return 1
}

trap stop_apps INT TERM EXIT

# Start the auth/billing app first: it creates the shared schema and seeds the
# Member 2 demo catalogue before the subscription app starts, so both processes
# never try to seed the same database at the same time.
echo "Starting auth portal at http://localhost:$AUTH_PORT"
PORT="$AUTH_PORT" APP_URL="http://localhost:$AUTH_PORT" node "$ROOT_DIR/brightloop-auth/src/server.js" &
auth_pid=$!

wait_for_http "Auth portal" "http://127.0.0.1:$AUTH_PORT/api/auth/me" "401" "$auth_pid"

echo "Starting subscription app at http://localhost:$MAIN_PORT"
PORT="$MAIN_PORT" node "$ROOT_DIR/subscription-app/src/server.js" &
main_pid=$!

wait_for_http "Subscription app" "http://127.0.0.1:$MAIN_PORT/api/stats" "200" "$main_pid"

echo "Both apps are running. Press Ctrl+C to stop them."
wait -n "$main_pid" "$auth_pid"
