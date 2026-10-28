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
scratch="$(mktemp -d)"
trap 'chmod -R u+w "$scratch" 2>/dev/null; rm -rf "$runtime" "$scratch"' EXIT
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
check "main rejects --plugin without a path with the usage line" "2||$usage_msg" "$(run main --plugin)"
check "main rejects --local together with --plugin with the usage line" "2||$usage_msg" \
    "$(run main --local --plugin x.zip)"
check "main rejects --plugin together with --local with the usage line" "2||$usage_msg" \
    "$(run main --plugin x.zip --local)"
no_zip_msg="koreader: no plugin zip given: pass --plugin PATH"
check "main asks for --plugin when run with no flags and no terminal" "1||$no_zip_msg" "$(run main </dev/null)"

HOME="$scratch/home"
mkdir "$HOME"
path_from() { printf '%s\n' "$1" | prompt_plugin_path; }
check "prompt_plugin_path trims whitespace around the path" "/tmp/p.zip" "$(path_from '  /tmp/p.zip  ')"
check "prompt_plugin_path takes the path of a quoted answer as typed" "/tmp/a b.zip" "$(path_from "'/tmp/a b.zip'")"
check "prompt_plugin_path takes the path of a double-quoted answer as typed" "/tmp/a b.zip" "$(path_from '"/tmp/a b.zip"')"
check "prompt_plugin_path unescapes the backslashes of a completed name" "/tmp/a b.zip" "$(path_from '/tmp/a\ b.zip')"
# shellcheck disable=SC2088 # the tilde is the typed input, expanded by the function under test
check "prompt_plugin_path expands a leading ~/ to the home dir" "$HOME/Downloads/p.zip" "$(path_from '~/Downloads/p.zip')"
check "prompt_plugin_path dies readably on an empty answer" "1||$no_zip_msg" "$(run path_from '   ')"
check "prompt_plugin_path dies readably when input ends" "1||$no_zip_msg" "$(run prompt_plugin_path </dev/null)"

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

stuck="$(make_run_dir)"
mkdir "$stuck/home/held"
touch "$stuck/home/held/file"
chmod a-w "$stuck/home/held"
check "remove_run carries on when part of the run dir can't be removed" "0||" "$(run remove_run "$stuck")"
chmod -R u+w "$stuck"
rm -rf "$stuck"

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

CALLS="$scratch/calls.log"
FAKE_PYTHON_STATUS=0
FAKE_BUILD_STATUS=0
FAKE_INFO='Arch Linux|["name=seccomp,profile=builtin"]'
docker() {
    printf 'docker %s\n' "$*" >>"$CALLS"
    case "$1" in
    version) echo arm64 ;;
    info) echo "$FAKE_INFO" ;;
    build) return "$FAKE_BUILD_STATUS" ;;
    esac
}
python3() {
    case "$*" in
    *koreader_home.py*)
        printf 'python %s\n' "$*" >>"$CALLS"
        return "$FAKE_PYTHON_STATUS"
        ;;
    *) command python3 "$@" ;;
    esac
}
open_when_ready() { :; }
uname() { echo Linux; }
RUNTIME_DIR="$runtime"

# Runs main as a background subshell, so `set -e` still stops it at a failed command as it does for the real script.
launch() {
    : >"$CALLS"
    status=0
    (main "$@") >/dev/null 2>&1 &
    wait $! || status=$?
}
calls_matching() { grep -c "$1" "$CALLS" || true; }
# The value after `flag` on the first call line starting with `prefix`.
arg_after() {
    local line
    line="$(grep "^$1 " "$CALLS" | head -n 1)"
    line="${line#*"$2" }"
    echo "${line%% *}"
}

launch --local
check "main --local runs a launch to the end" "0" "$status"
mounted="$(arg_after 'docker run' -v)"
named="$(arg_after 'docker run' --name)"
check "main --local mounts the run dir's home at /ko-home" "1" \
    "$([[ "$mounted" == "$SCRATCH_ROOT"/run.??????/home:/ko-home ]] && echo 1 || echo 0)"
run_suffix="${mounted#"$SCRATCH_ROOT"/run.}"
check "main --local names the container for the run dir" "omnibus-koreader-${run_suffix%/home:/ko-home}" "$named"
check "main --local links the run dir's home to the dev server" "${mounted%:/ko-home}|http://127.0.0.1:3571|$runtime/koreader" \
    "$(arg_after python --home)|$(arg_after python --api)|$(arg_after python --state-dir)"
check "main --local shares the host's network on a rootful Linux engine" "1" "$(calls_matching '^docker run.* --network host ')"
check "main --local force-removes its container on exit" "docker rm -f $named" "$(tail -n 1 "$CALLS")"
check "main --local removes its run dir on exit" "0" "$(find "$SCRATCH_ROOT" -mindepth 1 | wc -l | tr -d ' ')"

FAKE_INFO='Docker Desktop|["name=seccomp,profile=unconfined"]'
launch --local
check "main --local on Docker Desktop publishes the noVNC port and names the host gateway" "1" \
    "$(calls_matching '^docker run.* -p 127.0.0.1:[0-9]*:6080 --add-host host.docker.internal:host-gateway ')"
FAKE_INFO='Arch Linux|["name=seccomp,profile=builtin"]'

FAKE_BUILD_STATUS=1
launch --local
check "main stops when the image build fails" "1" "$status"
check "main starts no container when the image build fails" "0" "$(calls_matching '^docker run ')"
FAKE_BUILD_STATUS=0

zip="$scratch/plugin.zip"
RUNTIME_DIR="$scratch/no-dev-server"
launch --plugin "$zip"
check "main --plugin runs a launch to the end without a dev server" "0" "$status"
mounted="$(arg_after 'docker run' -v)"
check "main --plugin installs the zip into the run dir's home" "${mounted%:/ko-home}|$zip" \
    "$(arg_after python --home)|$(arg_after python --plugin)"
check "main --plugin validates the zip before it touches docker" "python" \
    "$(sed -n 1p "$CALLS" | cut -d' ' -f1)"
check "main --plugin publishes ports instead of sharing the host's network" "0" \
    "$(calls_matching '^docker run.* --network host ')"
check "main --plugin links no dev server" "0" "$(calls_matching 'python.* --api ')"
check "main --plugin names no host gateway, which only --local needs" "0" "$(calls_matching '^docker run.* --add-host ')"
check "main --plugin removes its run dir on exit" "0" "$(find "$SCRATCH_ROOT" -mindepth 1 | wc -l | tr -d ' ')"

ORIG_PWD="$scratch/where-it-ran"
launch --plugin relative/plugin.zip
check "main --plugin takes a relative path from where the launch was run" "$ORIG_PWD/relative/plugin.zip" "$(arg_after python --plugin)"
launch --plugin /abs/plugin.zip
check "main --plugin leaves an absolute path alone" "/abs/plugin.zip" "$(arg_after python --plugin)"

FAKE_PYTHON_STATUS=1
launch --plugin "$zip"
check "main --plugin stops when the zip is refused" "1" "$status"
check "main --plugin makes no docker call but the cleanup when the zip is refused" "0" \
    "$(grep '^docker' "$CALLS" | grep -vc '^docker rm -f' || true)"
check "main --plugin removes its run dir when the zip is refused" "0" "$(find "$SCRATCH_ROOT" -mindepth 1 | wc -l | tr -d ' ')"
unset -f docker python3 open_when_ready uname

pin_versions="$(sed -E 's/.*koreader_([^_]*-1)_.*/\1/' ui_tests/koreader/koreader.sha256 | sort -u | wc -l)"
check "every arch's KOReader pin names the same version" "1" "$((pin_versions))"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
