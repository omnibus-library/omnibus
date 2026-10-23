#!/usr/bin/env bash
# Kobo lane for the agentic-exploration swarm: one fake Kobo (`mock-kobo serve`)
# per Kobo agent, each syncing as that agent's own explorer account.
#
# Usage:
#   kobo.sh up --agent <k> --accounts <provision.json>   runner only: wire and start the device
#                                                        (a running one is kept, unless the instance changed)
#   kobo.sh act --agent <k> <action>                     drive the device (actions below)
#   kobo.sh state --agent <k>                            the manifest plus "running", as JSON
#   kobo.sh requests --agent <k>                         what the device asked Omnibus for
#   kobo.sh down [--agent <k>]                           runner only: stop one device, or every device
#
# Settings come from the environment, else the repo's .env. Each device lives in
# ${OMNIBUS_EXPLORE_KOBO_DIR:-<repo>/.claude/runtime/explore/kobo}/agent-<k>/
# (a relative KOBO_DIR is taken from the repo root):
#   state.json     mock-kobo's state file; kept across up/down, holds the device token
#   serve.log      mock-kobo's output
#   manifest.json  what `up` printed; removed by `down`
#
# `act` prints the device's control-API reply as received and exits 0 for a 2xx
# reply, 1 for any other status or no reply. The device keeps its library across
# runs; PUT /reset is not an agent action.
#
# OMNIBUS_EXPLORE_MOCK_KOBO names a built mock-kobo and skips the cargo build.
# The device token reaches mock-kobo through its environment only: never argv,
# stdout, the manifest or a journal.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
# shellcheck source=./lib.sh
source "$HERE/lib.sh"
explore::load_dotenv "$ROOT"
KOBO_DIR="${OMNIBUS_EXPLORE_KOBO_DIR:-$ROOT/.claude/runtime/explore/kobo}"
case "$KOBO_DIR" in /*) ;; *) KOBO_DIR="$ROOT/$KOBO_DIR" ;; esac
ACT_TIMEOUT=300
READY_TICKS=150
READY_RE='^MOCK_KOBO_READY port=[0-9]+ hardware_id=[^ ]+ state=.* pid='
STOP_TICKS="${OMNIBUS_EXPLORE_KOBO_STOP_TICKS:-50}"

kobo::usage() {
  cat >&2 <<EOF
usage: kobo.sh up --agent <k> --accounts <provision.json>
       kobo.sh act --agent <k> <action> [args...]
                   actions: sync show download read finish remove-download
       kobo.sh state --agent <k>
       kobo.sh requests --agent <k>
       kobo.sh down [--agent <k>]
EOF
  exit 2
}

# Build one action's JSON body via `json.dumps`, never string interpolation.
kobo::json_books() { python3 -c 'import json,sys; print(json.dumps({"books": sys.argv[1:]}))' "$@"; }
kobo::json_book() { python3 -c 'import json,sys; print(json.dumps({"book": sys.argv[1]}))' "$1"; }
kobo::json_read() {
  python3 -c 'import json,sys
args = sys.argv[1:]
body = {"book": args[0], "percent": int(args[1])}
if len(args) > 2:
    body["location"] = {"source": args[2], "value": args[3]}
print(json.dumps(body))' "$@"
}

# Validate action $1's remaining args ($2…) and set $method, $path and $body
# (empty for no body); exits 2 via kobo::usage on anything malformed.
kobo::act_request() {
  local action="$1"
  shift
  method="" path="" body=""
  case "$action" in
    sync)
      [ "$#" -eq 0 ] || kobo::usage
      method=POST path=/actions/sync
      ;;
    show)
      [ "$#" -eq 0 ] || kobo::usage
      method=GET path=/device
      ;;
    download)
      [ "$#" -ge 1 ] || kobo::usage
      method=POST path=/actions/download
      body="$(kobo::json_books "$@")"
      ;;
    read)
      case "$#" in 2 | 4) ;; *) kobo::usage ;; esac
      [[ "$2" =~ ^[0-9]+$ ]] || kobo::usage
      method=POST path=/actions/read
      body="$(kobo::json_read "$@")"
      ;;
    finish)
      [ "$#" -eq 1 ] || kobo::usage
      method=POST path=/actions/finish
      body="$(kobo::json_book "$1")"
      ;;
    remove-download)
      [ "$#" -eq 1 ] || kobo::usage
      method=POST path=/actions/remove-download
      body="$(kobo::json_book "$1")"
      ;;
    *) kobo::usage ;;
  esac
}

kobo::manifest() { echo "$KOBO_DIR/agent-$1/manifest.json"; }

kobo::state_path() { echo "$KOBO_DIR/agent-$1/state.json"; }

kobo::field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

# Whether `pid` is a live process running `bin` on the state file `state`. A
# recycled pid runs something else, another agent's device has its own state
# file, and a zombie shows as `[name] <defunct>`, so none of them count.
kobo::is_device() {
  local cmd
  [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  cmd="$(ps -p "$1" -o command= 2>/dev/null)" || return 1
  case "$cmd" in *"$2"*"$3"*) return 0 ;; esac
  return 1
}

# The exploration instance's origin as kobo_wire.py normalises it; exits 2 when it is unusable.
kobo::instance_url() {
  python3 -c 'import sys
sys.path.insert(0, sys.argv[1])
import kobo_wire
try:
    print(kobo_wire.instance_url())
except kobo_wire.UsageError as exc:
    print(f"kobo_wire: {exc}", file=sys.stderr)
    sys.exit(2)' "$HERE"
}

# Whether agent $1 has a manifest whose process is still its device.
kobo::running() {
  local manifest
  manifest="$(kobo::manifest "$1")"
  [ -f "$manifest" ] || return 1
  kobo::is_device "$(kobo::field "$manifest" pid)" "$(kobo::field "$manifest" bin)" "$(kobo::state_path "$1")"
}

# TERM, a little grace for the device to close, then KILL. Args: pid, bin, state file.
kobo::stop() {
  kobo::is_device "$1" "$2" "$3" || return 0
  kill "$1" 2>/dev/null || true
  for _ in $(seq 1 "$STOP_TICKS"); do
    kobo::is_device "$1" "$2" "$3" || return 0
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
  local k="$1" accounts="$2" dir state log manifest bin wire token wired url username device_name current
  dir="$KOBO_DIR/agent-$k"
  state="$(kobo::state_path "$k")"
  log="$dir/serve.log"
  manifest="$(kobo::manifest "$k")"
  (umask 077; mkdir -p "$dir")
  chmod 700 "$dir"
  if kobo::running "$k"; then
    current="$(kobo::instance_url)" || return $?
    if [ "$(kobo::field "$manifest" url)" = "$current" ]; then
      cat "$manifest"
      return 0
    fi
    # A device wired to another instance would keep syncing against the old one.
    kobo::stop "$(kobo::field "$manifest" pid)" "$(kobo::field "$manifest" bin)" "$state"
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
  (umask 077; : >"$log")
  chmod 600 "$log"
  [ ! -f "$state" ] || chmod 600 "$state"

  local pid ready="" ready_re
  pid="$( (umask 077; OMNIBUS_MOCK_KOBO_TOKEN="$token" nohup "$bin" serve --url "$url" --state "$state" --port 0 \
    >"$log" 2>&1 </dev/null & echo $!) )"
  ready_re="${READY_RE}${pid}\$"
  for _ in $(seq 1 "$READY_TICKS"); do
    ready="$(grep -m1 -E "$ready_re" "$log" || true)"
    [ -n "$ready" ] && break
    sleep 0.2
    kill -0 "$pid" 2>/dev/null || break
  done
  ready="$(grep -m1 -E "$ready_re" "$log" || true)"
  if [ -z "$ready" ]; then
    kobo::stop "$pid" "$bin" "$state"
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

# Send one request to agent $1's control API and print the reply as received.
# $4, if given, is a JSON body sent with a matching Content-Type.
kobo::call() {
  local k="$1" method="$2" path="$3" body="${4-}" resp status port
  kobo::running "$k" || {
    echo "no Kobo running for agent-$k — kobo.sh up --agent $k first" >&2
    return 1
  }
  port="$(kobo::field "$(kobo::manifest "$k")" port)"
  if [ -n "$body" ]; then
    resp="$(curl -sS --max-time "$ACT_TIMEOUT" -X "$method" -H 'Content-Type: application/json' \
      -d "$body" -w '\n%{http_code}' "http://127.0.0.1:$port$path")" || {
      echo "agent-$k's Kobo gave no reply to $method $path" >&2
      return 1
    }
  else
    resp="$(curl -sS --max-time "$ACT_TIMEOUT" -X "$method" -w '\n%{http_code}' "http://127.0.0.1:$port$path")" || {
      echo "agent-$k's Kobo gave no reply to $method $path" >&2
      return 1
    }
  fi
  status="${resp##*$'\n'}"
  printf '%s\n' "${resp%$'\n'*}"
  case "$status" in 2??) return 0 ;; esac
  return 1
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
    kobo::stop "$(kobo::field "$manifest" pid)" "$(kobo::field "$manifest" bin)" "$(kobo::state_path "$1")"
  fi
  rm -f "$manifest"
  printf '{"actor":"agent-%s","running":false}\n' "$1"
}

# Agent numbers go into paths, so only plain positive integers get through.
kobo::valid_agent() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }

cmd="${1-}"
case "$cmd" in up|act|state|requests|down) ;; *) kobo::usage ;; esac
shift

agent="" accounts="" have_agent=0
rest=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) [ "$#" -ge 2 ] || kobo::usage; agent="$2"; have_agent=1; shift 2 ;;
    --accounts) [ "$#" -ge 2 ] || kobo::usage; accounts="$2"; shift 2 ;;
    --)
      shift
      while [ "$#" -gt 0 ]; do rest+=("$1"); shift; done
      ;;
    -*) kobo::usage ;;
    *) rest+=("$1"); shift ;;
  esac
done
if [ "${#rest[@]}" -gt 0 ]; then
  set -- "${rest[@]}"
else
  set --
fi
# "$@" now holds act's own action and its args, with --agent/--accounts
# consumed wherever they appeared; every other command takes none.

case "$cmd" in
  down) [ "$have_agent" = 0 ] || kobo::valid_agent "$agent" || kobo::usage ;;
  *) kobo::valid_agent "$agent" || kobo::usage ;;
esac
[ "$cmd" != up ] || [ -f "$accounts" ] || kobo::usage
case "$cmd" in
  up | state | requests | down) [ "$#" -eq 0 ] || kobo::usage ;;
esac

method="" path="" body=""
if [ "$cmd" = act ]; then
  [ "$#" -ge 1 ] || kobo::usage
  action="$1"
  shift
  kobo::act_request "$action" "$@"
fi

case "$cmd" in
  up) kobo::up "$agent" "$accounts" ;;
  act) kobo::call "$agent" "$method" "$path" "$body" ;;
  requests) kobo::call "$agent" GET /requests ;;
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
