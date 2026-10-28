#!/usr/bin/env bash
# Tests for scripts/koreader-dev.sh: require_docker() and require_dev_server(),
# the checks `just koreader` runs before it builds anything (a missing Docker or
# dev server is one readable line), the networking it picks from the engine,
# its usage line, the per-launch run dir (made, swept when its launch died,
# removed on exit), and the KOReader pin file.
#
# No Docker, no server: the real script is sourced (it does not run `main` when
# sourced) and only `docker`, `uname`, `python3` and `probe_health` are stubbed,
# as in scratch-server-make-scratch-dir.test.sh.
#
# Usage: scripts/tests/koreader-dev-preflight.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

# shellcheck source=scripts/koreader-dev.sh disable=SC1091
source scripts/koreader-dev.sh

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

# Runs "$@" in a subshell with stdout/stderr/status captured as one string.
run() {
    local out err status=0
    out="$(mktemp)"
    err="$(mktemp)"
    ("$@") >"$out" 2>"$err" || status=$?
    echo "$status|$(cat "$out")|$(cat "$err")"
    rm -f "$out" "$err"
}

docker_down_msg="koreader: Docker isn't reachable — start Docker (Docker Desktop on macOS) and retry"
no_server_msg='koreader: no dev server for this worktree — run `just dev-up` (or `just serve`) first'

docker() { echo arm64; }
check "require_docker prints the engine's arch" "0|arm64|" "$(run require_docker)"

docker() { return 1; }
check "require_docker fails readably when the daemon is down" "1||$docker_down_msg" "$(run require_docker)"

uname() { echo Linux; }
docker() { echo 'Arch Linux|["name=seccomp,profile=builtin","name=cgroupns"]'; }
check "docker_network_mode shares the host's network on a native rootful Linux engine" \
    "0|host|" "$(run docker_network_mode)"

docker() { echo 'Arch Linux|["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]'; }
check "docker_network_mode publishes ports on a rootless Linux engine" \
    "0|published|" "$(run docker_network_mode)"

docker() { echo 'Docker Desktop|["name=seccomp,profile=unconfined","name=cgroupns"]'; }
check "docker_network_mode publishes ports on Docker Desktop for Linux" \
    "0|published|" "$(run docker_network_mode)"

uname() { echo Darwin; }
docker() { echo 'Docker Desktop|["name=seccomp,profile=unconfined"]'; }
check "docker_network_mode publishes ports on macOS" "0|published|" "$(run docker_network_mode)"
unset -f uname

unset -f docker
without_docker() {
    PATH=/nonexistent
    require_docker
}
check "require_docker fails readably when docker is not installed" "1||$docker_down_msg" "$(run without_docker)"

runtime="$(mktemp -d)"
trap 'rm -rf "$runtime"' EXIT
RUNTIME_DIR="$runtime"

check "require_dev_server fails readably when no port file exists" "1||$no_server_msg" "$(run require_dev_server)"

echo 3571 >"$runtime/port"
probe_health() { echo '{"app":"omnibus","repo_root":"/somewhere/else"}'; }
check "require_dev_server fails readably when the port serves another worktree" \
    "1||$no_server_msg" "$(run require_dev_server)"

probe_health() { :; }
check "require_dev_server fails readably when nothing answers on the port" \
    "1||$no_server_msg" "$(run require_dev_server)"

probe_health() { echo "{\"app\":\"omnibus\",\"repo_root\":\"$MY_REPO_ROOT\"}"; }
check "require_dev_server prints the port when this worktree's server answers" \
    "0|3571|" "$(run require_dev_server)"

usage_msg="koreader: usage: just koreader [--local | --plugin PATH]"
check "main rejects an unknown argument with the usage line" "2||$usage_msg" "$(run main --bogus)"
check "main rejects the removed --home with the usage line" "2||$usage_msg" "$(run main --home x)"

scratch="$(mktemp -d)"
trap 'rm -rf "$runtime" "$scratch"' EXIT
SCRATCH_ROOT="$scratch/root"
DOCKER_LOG="$scratch/docker.log"
: >"$DOCKER_LOG"
docker() {
    printf '%s\n' "$*" >>"$DOCKER_LOG"
    case "$1" in
    version) echo arm64 ;;
    info) echo 'Arch Linux|["name=seccomp,profile=builtin"]' ;;
    esac
}

mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

run_dir="$(make_run_dir)"
check "make_run_dir makes a run.XXXXXX dir under the scratch root" "1" \
    "$([[ "$run_dir" == "$SCRATCH_ROOT"/run.?????? && -d "$run_dir" ]] && echo 1 || echo 0)"
check "make_run_dir records the script's pid" "$$" "$(cat "$run_dir/pid")"
check "make_run_dir makes an empty home" "0" "$(find "$run_dir/home" -mindepth 1 | wc -l | tr -d ' ')"
check "make_run_dir keeps the run dir and its home private" "700 700" "$(mode_of "$run_dir") $(mode_of "$run_dir/home")"

check "container_name is named for the run dir's suffix" "omnibus-koreader-${run_dir##*run.}" "$(container_name "$run_dir")"

remove_run "$run_dir"
check "remove_run removes the run dir" "0" "$([ -e "$run_dir" ] && echo 1 || echo 0)"
check "remove_run force-removes the run's container" "rm -f $(container_name "$run_dir")" "$(cat "$DOCKER_LOG")"

docker() { return 1; }
run_dir="$(make_run_dir)"
remove_run "$run_dir"
check "remove_run still removes the run dir when the container is already gone" "0" "$([ -e "$run_dir" ] && echo 1 || echo 0)"

: >"$DOCKER_LOG"
docker() { printf '%s\n' "$*" >>"$DOCKER_LOG"; }
(exit 0) &
dead_pid=$!
wait "$dead_pid"
dead="$(make_run_dir)"
echo "$dead_pid" >"$dead/pid"
live="$(make_run_dir)"
starting="$SCRATCH_ROOT/run.starting"
mkdir "$starting"
sweep_runs
check "sweep_runs removes a run whose launch is dead" "0" "$([ -e "$dead" ] && echo 1 || echo 0)"
check "sweep_runs force-removes the dead run's container" "rm -f $(container_name "$dead")" "$(cat "$DOCKER_LOG")"
check "sweep_runs keeps a run whose launch is alive" "1" "$([ -d "$live" ] && echo 1 || echo 0)"
check "sweep_runs keeps a dir that has no pid file yet" "1" "$([ -d "$starting" ] && echo 1 || echo 0)"
rm -rf "$SCRATCH_ROOT"

: >"$DOCKER_LOG"
SCRIPT_LOG="$scratch/script.log"
docker() {
    printf '%s\n' "$*" >>"$DOCKER_LOG"
    case "$1" in
    version) echo arm64 ;;
    info) echo 'Arch Linux|["name=seccomp,profile=builtin"]' ;;
    esac
}
python3() {
    case "$*" in
    *koreader_home.py*) printf '%s\n' "$*" >>"$SCRIPT_LOG" ;;
    *) command python3 "$@" ;;
    esac
}
open_when_ready() { :; }
uname() { echo Linux; }
status=0
(main) >/dev/null 2>&1 || status=$?
check "main runs a launch to the end" "0" "$status"
docker_run="$(grep '^run ' "$DOCKER_LOG")"
mounted="${docker_run##*-v }"
mounted="${mounted%% *}"
named="${docker_run##*--name }"
named="${named%% *}"
check "main mounts the run dir's home at /ko-home" "1" \
    "$([[ "$mounted" == "$SCRATCH_ROOT"/run.??????/home:/ko-home ]] && echo 1 || echo 0)"
run_suffix="${mounted#"$SCRATCH_ROOT"/run.}"
check "main names the container for the run dir" "omnibus-koreader-${run_suffix%/home:/ko-home}" "$named"
check "main links the run dir's home" "1" \
    "$([[ "$(cat "$SCRIPT_LOG")" == *"--home ${mounted%:/ko-home} "* ]] && echo 1 || echo 0)"
check "main force-removes its container on exit" "rm -f $named" "$(tail -n 1 "$DOCKER_LOG")"
check "main removes its run dir on exit" "0" "$(find "$SCRATCH_ROOT" -mindepth 1 | wc -l | tr -d ' ')"
unset -f docker python3 open_when_ready uname

pin_versions="$(sed -E 's/.*koreader_([^_]*-1)_.*/\1/' ui_tests/koreader/koreader.sha256 | sort -u | wc -l)"
check "every arch's KOReader pin names the same version" "1" "$((pin_versions))"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
