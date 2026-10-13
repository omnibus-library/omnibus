#!/usr/bin/env bash
# Kobo lane for the agentic-exploration swarm: one fake Kobo (`mock-kobo serve`)
# per Kobo agent, each syncing as that agent's own explorer account.
#
# Usage:
#   kobo.sh up --agent <k> --accounts <provision.json>   runner only: wire and start the device
#   kobo.sh state --agent <k>                            the manifest plus "running", as JSON
#   kobo.sh down [--agent <k>]                           runner only: stop one device, or every device
#
# Each device lives in ${OMNIBUS_EXPLORE_KOBO_DIR:-<repo>/.claude/runtime/explore/kobo}/agent-<k>/:
#   state.json     mock-kobo's state file; kept across up/down, holds the device token
#   serve.log      mock-kobo's output
#   manifest.json  what `up` printed; removed by `down`
#
# OMNIBUS_EXPLORE_MOCK_KOBO names a built mock-kobo and skips the cargo build.
# The device token reaches mock-kobo through its environment only: never argv,
# stdout, the manifest or a journal.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
KOBO_DIR="${OMNIBUS_EXPLORE_KOBO_DIR:-$ROOT/.claude/runtime/explore/kobo}"
READY_TICKS=150
READY_RE='^MOCK_KOBO_READY port=[0-9]+ hardware_id=[^ ]+ state=.* pid=[0-9]+$'
STOP_TICKS=50

kobo::usage() {
  cat >&2 <<'EOF'
usage: kobo.sh up --agent <k> --accounts <provision.json>
       kobo.sh state --agent <k>
       kobo.sh down [--agent <k>]
EOF
  exit 2
}

kobo::manifest() { echo "$KOBO_DIR/agent-$1/manifest.json"; }

kobo::field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

# Whether `pid` is a live process running `bin`. A recycled pid runs something
# else, and a zombie shows as `[name] <defunct>`, so neither counts.
kobo::is_device() {
  local cmd
  [ -n "$1" ] && [ -n "$2" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  cmd="$(ps -p "$1" -o command= 2>/dev/null)" || return 1
  case "$cmd" in *"$2"*) return 0 ;; esac
  return 1
}

# Whether agent $1 has a manifest whose process is still its device.
kobo::running() {
  local manifest
  manifest="$(kobo::manifest "$1")"
  [ -f "$manifest" ] || return 1
  kobo::is_device "$(kobo::field "$manifest" pid)" "$(kobo::field "$manifest" bin)"
}

# TERM, a little grace for the device to close, then KILL.
kobo::stop() {
  kobo::is_device "$1" "$2" || return 0
  kill "$1" 2>/dev/null || true
  for _ in $(seq 1 "$STOP_TICKS"); do
    kobo::is_device "$1" "$2" || return 0
    sleep 0.2
  done
  kill -KILL "$1" 2>/dev/null || true
}

# The binary to start: OMNIBUS_EXPLORE_MOCK_KOBO, else the one cargo builds.
# The dev shell's hook prints non-JSON lines into the stream, so skip them.
kobo::mock_kobo_bin() {
  if [ -n "${OMNIBUS_EXPLORE_MOCK_KOBO:-}" ]; then
    echo "$OMNIBUS_EXPLORE_MOCK_KOBO"
    return 0
  fi
  local out bin
  out="$("$ROOT/scripts/with-dev-env.sh" default cargo build -q -p omnibus-mock-kobo --message-format=json)" || {
    echo "building mock-kobo failed — build it yourself and set OMNIBUS_EXPLORE_MOCK_KOBO" >&2
    return 1
  }
  bin="$(printf '%s\n' "$out" | python3 -c 'import json,sys
found = ""
for line in sys.stdin:
    try:
        msg = json.loads(line)
    except ValueError:
        continue
    if isinstance(msg, dict) and msg.get("reason") == "compiler-artifact" \
            and msg.get("target", {}).get("name") == "mock-kobo" and msg.get("executable"):
        found = msg["executable"]
print(found)')"
  [ -n "$bin" ] || {
    echo "cargo built no mock-kobo executable — set OMNIBUS_EXPLORE_MOCK_KOBO" >&2
    return 1
  }
  echo "$bin"
}

kobo::up() {
  local k="$1" accounts="$2" dir state log manifest bin wire token wired url username device_name
  dir="$KOBO_DIR/agent-$k"
  state="$dir/state.json"
  log="$dir/serve.log"
  manifest="$(kobo::manifest "$k")"
  (umask 077; mkdir -p "$dir")
  chmod 700 "$dir"
  if kobo::running "$k"; then
    cat "$manifest"
    return 0
  fi
  rm -f "$manifest"
  bin="$(kobo::mock_kobo_bin)" || return 1

  wire="$(python3 "$HERE/kobo_wire.py" --accounts "$accounts" --agent "$k" --state "$state")" || return $?
  token="$(printf '%s' "$wire" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
  {
    read -r wired; read -r url; read -r username; read -r device_name
  } <<<"$(printf '%s' "$wire" | python3 -c 'import json,sys
w = json.load(sys.stdin)
for key in ("wired", "url", "username", "device_name"):
    print(w[key])')"

  [ "$wired" = reused ] || rm -f "$state"
  (umask 077; : >>"$log")
  chmod 600 "$log"
  [ ! -f "$state" ] || chmod 600 "$state"

  local pid ready=""
  pid="$( (umask 077; OMNIBUS_MOCK_KOBO_TOKEN="$token" nohup "$bin" serve --url "$url" --state "$state" --port 0 \
    >"$log" 2>&1 </dev/null & echo $!) )"
  for _ in $(seq 1 "$READY_TICKS"); do
    ready="$(grep -m1 -E "$READY_RE" "$log" || true)"
    [ -n "$ready" ] && break
    sleep 0.2
    kill -0 "$pid" 2>/dev/null || break
  done
  ready="$(grep -m1 -E "$READY_RE" "$log" || true)"
  if [ -z "$ready" ]; then
    kobo::stop "$pid" "$bin"
    echo "the Kobo for agent-$k never became ready — end of $log:" >&2
    tail -n 20 "$log" >&2
    return 1
  fi

  python3 -c 'import json,re,sys
m = re.match(r"MOCK_KOBO_READY port=(\d+) hardware_id=(\S+) state=.* pid=(\d+)$", sys.argv[1])
actor, username, device_name, wired, url, bin, state, log, path = sys.argv[2:]
manifest = {"actor": actor, "username": username, "device_name": device_name, "wired": wired,
            "url": url, "port": int(m.group(1)), "pid": int(m.group(3)), "hardware_id": m.group(2),
            "bin": bin, "state": state, "log": log}
open(path, "w").write(json.dumps(manifest) + "\n")' \
    "$ready" "agent-$k" "$username" "$device_name" "$wired" "$url" "$bin" "$state" "$log" "$manifest"
  cat "$manifest"
}

kobo::state() {
  if kobo::running "$1"; then
    python3 -c 'import json,sys
m = json.load(open(sys.argv[1])); m["running"] = True; print(json.dumps(m))' "$(kobo::manifest "$1")"
  else
    printf '{"actor":"agent-%s","running":false}\n' "$1"
  fi
}

kobo::down() {
  local manifest
  manifest="$(kobo::manifest "$1")"
  if kobo::running "$1"; then
    kobo::stop "$(kobo::field "$manifest" pid)" "$(kobo::field "$manifest" bin)"
  fi
  rm -f "$manifest"
  printf '{"actor":"agent-%s","running":false}\n' "$1"
}

# Agent numbers go into paths, so only plain positive integers get through.
kobo::valid_agent() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }

cmd="${1-}"
case "$cmd" in up|state|down) ;; *) kobo::usage ;; esac
shift

agent="" accounts="" have_agent=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) [ "$#" -ge 2 ] || kobo::usage; agent="$2"; have_agent=1; shift 2 ;;
    --accounts) [ "$#" -ge 2 ] || kobo::usage; accounts="$2"; shift 2 ;;
    *) kobo::usage ;;
  esac
done

case "$cmd" in
  up|state) kobo::valid_agent "$agent" || kobo::usage ;;
  down) [ "$have_agent" = 0 ] || kobo::valid_agent "$agent" || kobo::usage ;;
esac
[ "$cmd" != up ] || [ -f "$accounts" ] || kobo::usage

case "$cmd" in
  up) kobo::up "$agent" "$accounts" ;;
  state) kobo::state "$agent" ;;
  down)
    if [ "$have_agent" = 1 ]; then
      kobo::down "$agent"
    else
      for dir in "$KOBO_DIR"/agent-*; do
        [ -d "$dir" ] || continue
        k="${dir##*/agent-}"
        ! kobo::valid_agent "$k" || kobo::down "$k"
      done
    fi
    ;;
esac
