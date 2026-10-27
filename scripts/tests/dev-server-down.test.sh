#!/usr/bin/env bash
# Tests that stopping a dev server stops the whole process tree under the PID
# it recorded, not just that PID: dx runs the server as a child, and a child
# left running keeps serving after dev-down reports it stopped. Both
# dev-server-down.sh and dev-server-up.sh's failure path stop it through
# stop_process_tree in scripts/lib/dev-port.sh.
#
# No dx, no network: bash trees shaped like dx's (a parent, a child, and a
# grandchild under a second child) stand in for the server, each in a scratch
# git repo whose PID file points at it. dev-down only stops a dx, so the
# stand-in is bash run through a symlink named dx. With no port file the
# health check is skipped, which is the script's path for a server that
# doesn't answer.
#
# Usage: scripts/tests/dev-server-down.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

tmp="$(mktemp -d)"
all_pids=""
cleanup() {
    # shellcheck disable=SC2086
    [ -z "$all_pids" ] || kill -9 $all_pids 2>/dev/null || true
    rm -rf "$tmp"
}
trap cleanup EXIT

mkdir -p "$tmp/bin" "$tmp/upbin"
ln -s "$(command -v bash)" "$tmp/bin/dx"
ln -s "$(command -v bash)" "$tmp/bin/sccache"

# dev-up runs `dx serve …`, so its stand-in is a script that records its tree.
cat >"$tmp/upbin/dx" <<UP
#!/usr/bin/env bash
echo \$\$ >>"$tmp/up.pids"
sleep 300 & echo \$! >>"$tmp/up.pids"
bash -c 'sleep 300 & echo \$! >>"$tmp/up.pids"; wait' & echo \$! >>"$tmp/up.pids"
wait
UP
chmod +x "$tmp/upbin/dx"

# A scratch worktree; its scripts/ is this checkout's, so the real scripts run.
new_repo() {
    local dir
    dir="$(mktemp -d "$tmp/repo.XXXXXX")"
    git -C "$dir" init --quiet
    ln -s "$repo_root/scripts" "$dir/scripts"
    mkdir -p "$dir/.claude/runtime"
    echo "$dir"
}

descendants() {
    local kid
    for kid in $(pgrep -P "$1" 2>/dev/null || true); do
        echo "$kid"
        descendants "$kid"
    done
}

# Start `$3…` detached with its PID in repo $1's PID file, wait for $2
# descendants, and set `tree` to the whole tree.
tree=""
start_tree() {
    local repo="$1" kids="$2" pid
    shift 2
    # Started from a subshell that exits at once, so the tree's parent is
    # init, as dx's is once `just dev-up` returns.
    ("$@" >/dev/null 2>&1 & echo $! >"$repo/.claude/runtime/server.pid")
    pid="$(cat "$repo/.claude/runtime/server.pid")"
    for _ in $(seq 1 50); do
        [ "$(descendants "$pid" | wc -l)" -ge "$kids" ] && break
        sleep 0.1
    done
    tree="$pid $(descendants "$pid" | tr '\n' ' ')"
    all_pids="$all_pids $tree"
}

pass=0
fail=0

check() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$actual" = "$expected" ]; then
        echo "PASS: $desc"
        pass=$((pass + 1))
    else
        echo "FAIL: $desc (expected $expected, got $actual)" >&2
        fail=$((fail + 1))
    fi
}

# A zombie still answers `kill -0`; under a reaper that lags, an exited
# process lingers as one.
running() {
    local p n=0
    for p in "$@"; do
        kill -0 "$p" 2>/dev/null || continue
        case "$(ps -o stat= -p "$p" 2>/dev/null | tr -d '[:space:]')" in
        Z*) ;;
        *) n=$((n + 1)) ;;
        esac
    done
    echo "$n"
}

# init reaps each process as it exits, which can lag the signal a little.
settle() {
    for _ in $(seq 1 20); do
        [ "$(running "$@")" = 0 ] && break
        sleep 0.1
    done
}

pid_file_state() {
    [ -e "$1/.claude/runtime/server.pid" ] && echo present || echo absent
}

dev_down() {
    (cd "$1" && scripts/dev-server-down.sh >/dev/null 2>&1)
}

# --- SIGTERM stops the tree ---------------------------------------------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/dx" -c 'sleep 300 & bash -c "sleep 300 & wait" & wait'
# shellcheck disable=SC2086
check "the stand-in tree is running before dev-down" 4 "$(running $tree)"
dev_down "$repo"
# shellcheck disable=SC2086
settle $tree
# shellcheck disable=SC2086
check "every process in the tree has exited" 0 "$(running $tree)"
check "the PID file is removed" absent "$(pid_file_state "$repo")"

# --- SIGKILL takes what ignores SIGTERM ---------------------------------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/dx" -c \
    'sleep 300 & bash -c "trap \"\" TERM; sleep 300 & wait" & wait'
dev_down "$repo"
# shellcheck disable=SC2086
settle $tree
# shellcheck disable=SC2086
check "a grandchild ignoring SIGTERM is killed too" 0 "$(running $tree)"

# --- the shared sccache server is left alone ----------------------------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/dx" -c \
    "\"$tmp/bin/sccache\" -c 'sleep 300; :' & sleep 300 & wait"
dx_pid="$(cat "$repo/.claude/runtime/server.pid")"
sccache_pid="$(pgrep -P "$dx_pid" -f "$tmp/bin/sccache" || true)"
sccache_kid="$(pgrep -P "${sccache_pid:-0}" || true)"
dev_down "$repo"
settle "$dx_pid"
check "dx is stopped" 0 "$(running "$dx_pid")"
check "sccache and its child survive" 2 "$(running "$sccache_pid" "$sccache_kid")"

# --- a reused PID that isn't dx is not touched --------------------------
repo="$(new_repo)"
start_tree "$repo" 0 sleep 300
echo 3999 >"$repo/.claude/runtime/port"
dev_down "$repo"
# shellcheck disable=SC2086
check "a non-dx process named by the PID file survives" 1 "$(running $tree)"
check "its stale PID file is removed" absent "$(pid_file_state "$repo")"
check "its stale port file is removed" absent \
    "$([ -e "$repo/.claude/runtime/port" ] && echo present || echo absent)"

# --- dev-up stops the tree when the server never turns healthy ----------
repo="$(new_repo)"
(cd "$repo" && PATH="$tmp/upbin:$PATH" PORT=3950 OMNIBUS_DEV_SEED_USER=a:b \
    OMNIBUS_DEV_BUILD_TIMEOUT_SECS=1 scripts/dev-server-up.sh >/dev/null 2>&1) || true
up_pids="$(tr '\n' ' ' <"$tmp/up.pids" 2>/dev/null || true)"
all_pids="$all_pids $up_pids"
# shellcheck disable=SC2086
check "dev-up's stand-in recorded its tree" 4 "$(echo $up_pids | wc -w | tr -d ' ')"
# shellcheck disable=SC2086
settle $up_pids
# shellcheck disable=SC2086
check "dev-up's failure path stops the whole tree" 0 "$(running $up_pids)"
check "dev-up's PID file is removed" absent "$(pid_file_state "$repo")"

echo "dev-server-down: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
