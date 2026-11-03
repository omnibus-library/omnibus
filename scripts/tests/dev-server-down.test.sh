#!/usr/bin/env bash
# Tests that stopping a dev server stops the whole process tree under the PID
# it recorded, not just that PID: cargo runs the server as a child, and a child
# left running keeps serving after dev-down reports it stopped. Both
# dev-server-down.sh and dev-server-up.sh's failure path stop it through
# stop_process_tree in scripts/lib/dev-port.sh.
#
# No cargo, no network: bash trees shaped like `cargo run`'s (a parent, a
# child, and a grandchild under a second child) stand in for the server, each
# in a scratch git repo whose PID file points at it. dev-down only stops a
# cargo or an omnibus, so the stand-in is bash run through a symlink with one
# of those names. With no port file the health check is skipped, which is the
# script's path for a server that doesn't answer.
#
# Usage: scripts/tests/dev-server-down.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

tmp="$(mktemp -d)"
all_pids=""
# The forking case's children; unique to this run so pgrep finds only them.
spawn_pattern="sleep 300\\.$$\$"
cleanup() {
    # shellcheck disable=SC2086
    [ -z "$all_pids" ] || kill -9 $all_pids 2>/dev/null || true
    pkill -9 -f "$spawn_pattern" 2>/dev/null || true
    rm -rf "$tmp"
}
trap cleanup EXIT

mkdir -p "$tmp/bin" "$tmp/upbin" "$tmp/nops" "$tmp/raceps"
ln -s "$(command -v bash)" "$tmp/bin/cargo"
ln -s "$(command -v bash)" "$tmp/bin/omnibus"
ln -s "$(command -v bash)" "$tmp/bin/sccache"

# A ps that can't name a process: BusyBox's rejects `-p` and exits 1.
cat >"$tmp/nops/ps" <<NOPS
#!/usr/bin/env bash
[ "\${1:-}" = -o ] && [ "\${2:-}" = comm= ] && exit 1
exec "$(command -v ps)" "\$@"
NOPS
chmod +x "$tmp/nops/ps"

# A ps that loses the race: the pid dies just before it is named, and ps
# exits 1 for a pid it can't find.
cat >"$tmp/raceps/ps" <<RACE
#!/usr/bin/env bash
if [ "\${1:-}" = -o ] && [ "\${2:-}" = comm= ]; then
    kill -9 "\$4" 2>/dev/null
    exit 1
fi
exec "$(command -v ps)" "\$@"
RACE
chmod +x "$tmp/raceps/ps"

# dev-up runs `cargo run …`, so its stand-in is a script that records its
# tree; the React build it runs first is a pnpm that only makes the --outDir it is given.
cat >"$tmp/upbin/pnpm" <<'PNPM'
#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = --outDir ] && mkdir -p "$2"; shift; done
PNPM
chmod +x "$tmp/upbin/pnpm"
cat >"$tmp/upbin/cargo" <<UP
#!/usr/bin/env bash
echo \$\$ >>"$tmp/up.pids"
sleep 300 & echo \$! >>"$tmp/up.pids"
bash -c 'sleep 300 & echo \$! >>"$tmp/up.pids"; wait' & echo \$! >>"$tmp/up.pids"
wait
UP
chmod +x "$tmp/upbin/cargo"

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
    # init, as cargo's is once `just dev-up` returns.
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
start_tree "$repo" 3 "$tmp/bin/cargo" -c 'sleep 300 & bash -c "sleep 300 & wait" & wait'
# shellcheck disable=SC2086
check "the stand-in tree is running before dev-down" 4 "$(running $tree)"
dev_down "$repo"
# shellcheck disable=SC2086
settle $tree
# shellcheck disable=SC2086
check "every process in the tree has exited" 0 "$(running $tree)"
check "the PID file is removed" absent "$(pid_file_state "$repo")"

# --- the omnibus binary itself is a server too --------------------------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/omnibus" -c 'sleep 300 & bash -c "sleep 300 & wait" & wait'
dev_down "$repo"
# shellcheck disable=SC2086
settle $tree
# shellcheck disable=SC2086
check "an omnibus tree has exited" 0 "$(running $tree)"
check "the omnibus PID file is removed" absent "$(pid_file_state "$repo")"

# --- a child forking while dev-down runs leaves nothing behind ----------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/cargo" -c \
    "bash -c 'for _ in \$(seq 1 200); do sleep 300.$$ & sleep 0.005; done; wait' & wait"
dev_down "$repo"
for _ in $(seq 1 20); do
    # shellcheck disable=SC2046
    [ "$(running $(pgrep -f "$spawn_pattern" || true))" = 0 ] && break
    sleep 0.1
done
# shellcheck disable=SC2046
check "nothing the forking child spawned survives" 0 \
    "$(running $(pgrep -f "$spawn_pattern" || true))"
# shellcheck disable=SC2086
check "the forking tree has exited" 0 "$(running $tree)"

# --- a live PID that ps can't name is left alone ------------------------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/cargo" -c 'sleep 300 & bash -c "sleep 300 & wait" & wait'
status=0
(cd "$repo" && PATH="$tmp/nops:$PATH" scripts/dev-server-down.sh >/dev/null 2>&1) || status=$?
check "dev-down refuses a PID ps can't name" 3 "$status"
# shellcheck disable=SC2086
check "the unnamed tree keeps running" 4 "$(running $tree)"
check "its PID file is kept" present "$(pid_file_state "$repo")"

# --- a PID that dies before ps names it is stale -------------------------
repo="$(new_repo)"
start_tree "$repo" 0 sleep 300
echo 3999 >"$repo/.claude/runtime/port"
touch "$repo/.claude/runtime/env.sh"
status=0
(cd "$repo" && PATH="$tmp/raceps:$PATH" scripts/dev-server-down.sh >/dev/null 2>&1) || status=$?
check "dev-down treats a PID that died before naming as stale" 0 "$status"
check "the raced PID file is removed" absent "$(pid_file_state "$repo")"
check "the raced port and env files are removed" absent \
    "$([ -e "$repo/.claude/runtime/port" ] || [ -e "$repo/.claude/runtime/env.sh" ] && echo present || echo absent)"

# --- SIGKILL takes what ignores SIGTERM ---------------------------------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/cargo" -c \
    'sleep 300 & bash -c "trap \"\" TERM; sleep 300 & wait" & wait'
dev_down "$repo"
# shellcheck disable=SC2086
settle $tree
# shellcheck disable=SC2086
check "a grandchild ignoring SIGTERM is killed too" 0 "$(running $tree)"

# --- the shared sccache server is left alone ----------------------------
repo="$(new_repo)"
start_tree "$repo" 3 "$tmp/bin/cargo" -c \
    "\"$tmp/bin/sccache\" -c 'sleep 300; :' & sleep 300 & wait"
cargo_pid="$(cat "$repo/.claude/runtime/server.pid")"
sccache_pid="$(pgrep -P "$cargo_pid" -f "$tmp/bin/sccache" || true)"
sccache_kid="$(pgrep -P "${sccache_pid:-0}" || true)"
dev_down "$repo"
settle "$cargo_pid"
check "cargo is stopped" 0 "$(running "$cargo_pid")"
check "sccache and its child survive" 2 "$(running "$sccache_pid" "$sccache_kid")"

# --- a reused PID that isn't a server is not touched --------------------------
repo="$(new_repo)"
start_tree "$repo" 0 sleep 300
echo 3999 >"$repo/.claude/runtime/port"
dev_down "$repo"
# shellcheck disable=SC2086
check "a non-server process named by the PID file survives" 1 "$(running $tree)"
check "its stale PID file is removed" absent "$(pid_file_state "$repo")"
check "its stale port file is removed" absent \
    "$([ -e "$repo/.claude/runtime/port" ] && echo present || echo absent)"

# --- dev-up stops the tree when the server never turns healthy ----------
# A 1 s budget can tick over before the first poll, stopping the pid before
# the stand-in has exec'd; 2 s always polls once, a second after the start.
repo="$(new_repo)"
(cd "$repo" && PATH="$tmp/upbin:$PATH" PORT=3950 OMNIBUS_DEV_SEED_USER=a:b \
    OMNIBUS_DEV_BUILD_TIMEOUT_SECS=2 scripts/dev-server-up.sh >/dev/null 2>&1) || true
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
