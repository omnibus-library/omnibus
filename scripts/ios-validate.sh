#!/usr/bin/env bash
# Screenshot tours of the native iOS app against a scratch server. Each
# worktree gets its own simulator (scripts/lib/ios-sim.sh) and serves from its
# own port window (scripts/lib/dev-port.sh), so two features can be checked at
# once. Backs the ios-validate skill (.claude/skills/ios-validate/SKILL.md).
#
# Usage:
#   ios-validate.sh server up [--fresh]  start the scratch server, or reuse the
#                                        running one; --fresh restarts it on an
#                                        empty database
#   ios-validate.sh server down          stop it
#   ios-validate.sh server status        its address and pid, if running
#   ios-validate.sh sim up               create (first use) and boot this
#                                        worktree's simulator; prints its UDID
#   ios-validate.sh sim delete           shut it down and delete it
#   ios-validate.sh tour <TestClass>     run one omnibusUITests class on this
#                                        worktree's simulator, from a clean
#                                        install, with the server passed in
#   ios-validate.sh cleanup              server down + sim delete; run before
#                                        `wt remove`, or from a user-level
#                                        pre-remove hook (see the skill)
#
# Env: OMNIBUS_IOS_SERVER_BIN  a prebuilt omnibus server binary to run instead
#                              of building this worktree's — fine when the
#                              change is iOS-only
#
# State lives in .claude/runtime/ios-validate/: the server's database, covers,
# log and pid, the env.sh a tour reads, and the tour's shots/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
STATE="$ROOT/.claude/runtime/ios-validate"
SERVER="$STATE/server"
PIDFILE="$SERVER/pid"
# The binary the pid was launched from, so a reused pid is never mistaken for it.
BINFILE="$SERVER/bin"
ENVFILE="$STATE/env.sh"

TOUR_USER="tour"
TOUR_PASSWORD="omnibus-tour-2026"
# The app target's PRODUCT_BUNDLE_IDENTIFIER, uninstalled before each tour.
BUNDLE_ID="com.omnibus.mobile"

# shellcheck source=lib/ios-sim.sh
source "$ROOT/scripts/lib/ios-sim.sh"

die() {
  echo "ios-validate: $*" >&2
  exit 1
}

server_pid() {
  [ -f "$PIDFILE" ] && [ -f "$BINFILE" ] || return 1
  local pid command
  pid="$(cat "$PIDFILE")"
  command="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case "$command" in
    "$(cat "$BINFILE")"*) echo "$pid" ;;
    *) return 1 ;;
  esac
}

stop_pid() {
  kill "$1" 2>/dev/null || return 0
  for _ in $(seq 1 20); do
    kill -0 "$1" 2>/dev/null || break
    sleep 0.5
  done
  echo "ios-validate: stopped the scratch server ($1)" >&2
}

server_up() {
  if [ "${1:-}" != "--fresh" ] && server_pid >/dev/null && [ -f "$ENVFILE" ]; then
    server_status
    return 0
  fi
  # A live pid without env.sh is a start that never finished; it goes too, or
  # it keeps a port in this window that nothing will ever stop.
  server_down
  rm -f "$ENVFILE"
  if [ "${1:-}" = "--fresh" ]; then
    rm -rf "$SERVER"
  fi
  # Absolute, because the start runs from the repo root and launches from $SERVER.
  if [ -n "${OMNIBUS_IOS_SERVER_BIN:-}" ]; then
    [ -e "$OMNIBUS_IOS_SERVER_BIN" ] || die "no server binary at $OMNIBUS_IOS_SERVER_BIN"
    OMNIBUS_IOS_SERVER_BIN="$(cd "$(dirname "$OMNIBUS_IOS_SERVER_BIN")" && pwd)/$(basename "$OMNIBUS_IOS_SERVER_BIN")"
    export OMNIBUS_IOS_SERVER_BIN
  fi
  [ -d "$ROOT/test_data/epubs/public_domain" ] ||
    die "the fixture library is missing — run \`just fixtures\` first"
  # Inside the dev shell with PORT and CARGO_TARGET_DIR cleared, so its hook
  # derives this worktree's own port window and target dir. A session started
  # in the main checkout exports both, and inheriting them would put every
  # worktree's build in one target dir and its server in one window.
  cd "$ROOT"
  env -u PORT -u CARGO_TARGET_DIR \
    "$ROOT/scripts/with-dev-env.sh" default "$HERE/ios-validate.sh" __start
}

# Runs inside the dev shell: build (unless given a binary), pick a port in
# this worktree's window, start the server, wait for its library to index.
server_start() {
  cd "$ROOT"
  # shellcheck source=lib/dev-port.sh
  source "$ROOT/scripts/lib/dev-port.sh"
  local bin="${OMNIBUS_IOS_SERVER_BIN:-}"
  if [ -z "$bin" ]; then
    echo "ios-validate: building the server into ${CARGO_TARGET_DIR}…" >&2
    cargo build -q -p omnibus
    bin="$CARGO_TARGET_DIR/debug/omnibus"
  fi
  [ -x "$bin" ] || die "no server binary at $bin"
  # The fullstack server refuses to boot without a public/ beside it, even
  # with no web bundle to serve.
  mkdir -p "$(dirname "$bin")/public"

  local choice port
  choice="$(choose_port --free-only)" || die "no free port in $START_PORT..$END_PORT"
  port="${choice%%:*}"

  mkdir -p "$SERVER"/{data,covers,thumbs}
  echo "$bin" >"$BINFILE"
  # A clean environment rather than the dev shell's, so nothing from a
  # developer's .env (their own library path, API keys, log dir) reaches it.
  (
    cd "$SERVER"
    nohup env -i HOME="$HOME" PATH="$PATH" \
      PORT="$port" IP=127.0.0.1 \
      DATABASE_URL="sqlite://$SERVER/omnibus.db?mode=rwc" \
      EBOOK_LIBRARY_PATH="$ROOT/test_data/epubs" \
      AUDIOBOOK_LIBRARY_PATH="$ROOT/test_data/audiobooks" \
      OMNIBUS_DEV_SEED_USER="$TOUR_USER:$TOUR_PASSWORD" \
      OMNIBUS_PUBLIC_ORIGIN="http://127.0.0.1:$port" \
      OMNIBUS_DATA_DIR="$SERVER/data" \
      OMNIBUS_COVERS_DIR="$SERVER/covers" \
      OMNIBUS_THUMBS_DIR="$SERVER/thumbs" \
      OMNIBUS_DEV_DISABLE_RATE_LIMITS=1 \
      OMNIBUS_SECURE_COOKIES=0 \
      "$bin" >"$SERVER/server.log" 2>&1 &
    echo $! >"$PIDFILE"
  )
  # Until env.sh is written, a failed or interrupted start stops the server it
  # launched — by pid, since another `server up` may have rewritten the pidfile.
  LAUNCHED="$(cat "$PIDFILE")"
  trap 'abandon_start "$LAUNCHED"' EXIT

  local base="http://127.0.0.1:$port" token="" waited=0
  until curl -sf --max-time 2 "$base/api/_health" >/dev/null; do
    kill -0 "$LAUNCHED" 2>/dev/null || { tail -20 "$SERVER/server.log" >&2; die "the server exited"; }
    [ "$waited" -lt 180 ] || die "no answer on $base after 180s — see $SERVER/server.log"
    sleep 1
    waited=$((waited + 1))
  done
  # The first scan runs after boot; a tour against an empty library proves nothing.
  until [ -n "$token" ] && [ "$(curl -sf "$base/api/ebooks?limit=1" -H "authorization: Bearer $token" |
    jq '.books | length')" -gt 0 ] 2>/dev/null; do
    token="$(curl -sf -X POST "$base/api/auth/login" -H 'content-type: application/json' \
      -d "{\"username\":\"$TOUR_USER\",\"password\":\"$TOUR_PASSWORD\",\"client_kind\":\"bearer\"}" |
      jq -r '.token // empty')" || true
    kill -0 "$LAUNCHED" 2>/dev/null || die "the server exited — see $SERVER/server.log"
    [ "$waited" -lt 300 ] || die "the library never indexed — see $SERVER/server.log"
    sleep 2
    waited=$((waited + 2))
  done

  # %q, so a checkout path with spaces survives the round trip through `source`.
  {
    printf 'export OMNIBUS_TOUR_SERVER=%q\n' "127.0.0.1:$port"
    printf 'export OMNIBUS_TOUR_USER=%q\n' "$TOUR_USER"
    printf 'export OMNIBUS_TOUR_PASSWORD=%q\n' "$TOUR_PASSWORD"
    printf 'export OMNIBUS_TOUR_TOKEN=%q\n' "$token"
    printf 'export OMNIBUS_TOUR_SHOTS=%q\n' "$STATE/shots"
  } >"$ENVFILE"
  trap - EXIT
  server_status
}

# A record whose pid is no longer our binary is dropped, never signalled.
server_down() {
  local pid
  if pid="$(server_pid)"; then
    stop_pid "$pid"
  fi
  rm -f "$PIDFILE"
}

abandon_start() {
  stop_pid "$1"
  if [ "$(cat "$PIDFILE" 2>/dev/null)" = "$1" ]; then
    rm -f "$PIDFILE"
  fi
}

server_status() {
  local pid
  if pid="$(server_pid)" && [ -f "$ENVFILE" ]; then
    # shellcheck disable=SC1090
    source "$ENVFILE"
    echo "scratch server: http://$OMNIBUS_TOUR_SERVER (pid $pid), sign in as $OMNIBUS_TOUR_USER / $OMNIBUS_TOUR_PASSWORD"
    echo "seed over REST with: source $ENVFILE; curl -H \"authorization: Bearer \$OMNIBUS_TOUR_TOKEN\" http://\$OMNIBUS_TOUR_SERVER/api/…"
  else
    echo "scratch server: not running"
  fi
}

sim_up() {
  local udid
  udid="$(ios_sim_ensure "$(ios_sim_name "$ROOT")")"
  xcrun simctl bootstatus "$udid" -b >/dev/null
  echo "$udid"
}

sim_delete() {
  command -v xcrun >/dev/null 2>&1 || return 0
  local name udid
  name="$(ios_sim_name "$ROOT")"
  for udid in $(ios_sim_find "$name"); do
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$udid"
    echo "ios-validate: deleted simulator '$name' ($udid)" >&2
  done
}

tour() {
  local class="${1:?usage: ios-validate.sh tour <TestClass>}" udid
  { [ -f "$ENVFILE" ] && server_pid >/dev/null; } || die "no scratch server — run \`ios-validate.sh server up\` first"
  # shellcheck disable=SC1090
  source "$ENVFILE"
  udid="$(sim_up)"
  # A clean container, so nothing a previous tour cached or chose carries over.
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  rm -rf "$OMNIBUS_TOUR_SHOTS"
  mkdir -p "$OMNIBUS_TOUR_SHOTS"
  # xcodebuild hands TEST_RUNNER_-prefixed variables to the test process, minus the prefix.
  local status=0
  TEST_RUNNER_OMNIBUS_TOUR_SERVER="$OMNIBUS_TOUR_SERVER" \
    TEST_RUNNER_OMNIBUS_TOUR_USER="$OMNIBUS_TOUR_USER" \
    TEST_RUNNER_OMNIBUS_TOUR_PASSWORD="$OMNIBUS_TOUR_PASSWORD" \
    TEST_RUNNER_OMNIBUS_TOUR_SHOTS="$OMNIBUS_TOUR_SHOTS" \
    OMNIBUS_IOS_TEST_SIM_UDID="$udid" \
    OMNIBUS_IOS_RESULTS_DIR="$STATE/results" \
    "$ROOT/scripts/ios-test.sh" "ui/$class" >"$STATE/tour.log" 2>&1 || status=$?
  grep -E "error:|TEST (SUCCEEDED|FAILED)" "$STATE/tour.log" >&2 || true
  echo "shots in $OMNIBUS_TOUR_SHOTS:" >&2
  ls -1 "$OMNIBUS_TOUR_SHOTS" >&2 || true
  echo "full log: $STATE/tour.log; assertion messages: $STATE/results/ui-$class.xcresult" >&2
  return "$status"
}

cleanup() {
  server_down || true
  sim_delete || true
}

case "${1:-}" in
  server)
    case "${2:-}" in
      up) server_up "${3:-}" ;;
      down) server_down ;;
      status) server_status ;;
      *) die "usage: ios-validate.sh server up [--fresh]|down|status" ;;
    esac
    ;;
  sim)
    case "${2:-}" in
      up) sim_up ;;
      delete) sim_delete ;;
      *) die "usage: ios-validate.sh sim up|delete" ;;
    esac
    ;;
  tour) tour "${2:-}" ;;
  cleanup) cleanup ;;
  __start) server_start ;;
  *) die "usage: ios-validate.sh server|sim|tour|cleanup … (see the header)" ;;
esac
