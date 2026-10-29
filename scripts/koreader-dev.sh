#!/usr/bin/env bash
# `just koreader`: an interactive KOReader in a browser tab, in Docker, syncing
# with any Omnibus instance (docs/koreader.md).
#
# Usage: scripts/koreader-dev.sh [--local | --plugin PATH]
#
# --plugin installs a plugin zip downloaded from an instance's Settings (asked for
# when no flag is given); the zip alone carries the server and device token, so
# no credentials or dev server are involved. --local follows this worktree's dev
# server instead: it checks Docker and the server first (it never starts one) and
# seeds the OPDS catalog and Progress sync.
#
# Builds the lane's image, then runs it with a fresh home mounted at /ko-home. The
# home lives in a run dir under $SCRATCH_ROOT, removed on exit; a launch that was
# killed leaves its run dir for the next launch to sweep. The foreground
# container is the session: Ctrl-C or quitting KOReader ends it.
#
# Sourceable without running `main`, so scripts/tests/koreader-dev-preflight.test.sh
# can exercise the checks.
set -euo pipefail
# So a failed command inside `$(...)` stops the script, as it does outside one.
shopt -s inherit_errexit

# A relative --plugin path is taken from where the user ran `just koreader`.
ORIG_PWD="$PWD"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=scripts/lib/dev-port.sh disable=SC1091
source scripts/lib/dev-port.sh

# Inside the worktree, not $TMPDIR: a dev shell gives each launch its own $TMPDIR, so a
# sweep there would never find a dead run. Absolute, because Docker needs an absolute mount.
SCRATCH_ROOT="$PWD/$RUNTIME_DIR/koreader/runs"
# The launch's run dir, set by main for the EXIT trap, which runs after main's locals are gone.
RUN_DIR=""

die() {
    echo "koreader: $*" >&2
    exit "${die_status:-1}"
}

# Prints the engine's architecture (amd64 or arm64).
require_docker() {
    local arch
    if ! command -v docker >/dev/null 2>&1 ||
        ! arch="$(docker version --format '{{.Server.Arch}}' 2>/dev/null)" || [ -z "$arch" ]; then
        die "Docker isn't reachable — start Docker (Docker Desktop on macOS) and retry"
    fi
    echo "$arch"
}

# Prints the port of this worktree's running dev server.
require_dev_server() {
    local port
    port="$(cat "$RUNTIME_DIR/port" 2>/dev/null || true)"
    if [ -z "$port" ] || ! is_my_omnibus_response "$(probe_health "$port")"; then
        die 'no dev server for this worktree — run `just dev-up` (or `just serve`) first'
    fi
    echo "$port"
}

# Prints `host` where the container can share the host's network (a native, rootful Linux
# engine), else `published`: Docker Desktop and rootless Docker run the engine in a VM or its
# own network namespace, where `--network host` never reaches the developer's host.
docker_network_mode() {
    local info
    if [ "$(uname -s)" != Linux ]; then
        echo published
        return
    fi
    info="$(docker info --format '{{.OperatingSystem}}|{{json .SecurityOptions}}' 2>/dev/null || true)"
    case "$info" in
    *"Docker Desktop"* | *rootless*) echo published ;;
    *) echo host ;;
    esac
}

# Prints a new run dir holding this launch's pid and an empty home.
make_run_dir() {
    local run
    mkdir -p "$SCRATCH_ROOT"
    run="$(mktemp -d "$SCRATCH_ROOT/run.XXXXXX")"
    echo "$$" >"$run/pid"
    mkdir -m 0700 "$run/home"
    echo "$run"
}

# The container a run dir's launch names; the suffix is the run dir's own.
container_name() {
    echo "omnibus-koreader-${1##*run.}"
}

remove_run() {
    docker rm -f "$(container_name "$1")" >/dev/null 2>&1 || true
    rm -rf "$1" 2>/dev/null || true
}

# Removes the run dirs of launches that are gone; one with no pid yet is a launch still starting.
sweep_runs() {
    local run pid
    for run in "$SCRATCH_ROOT"/run.*; do
        pid="$(cat "$run/pid" 2>/dev/null || true)"
        [ -n "$pid" ] || continue
        kill -0 "$pid" 2>/dev/null || remove_run "$run"
    done
}

# Prints the plugin zip path typed at the prompt, as a shell would read it: one pair of quotes
# or the backslash escapes are removed, and `~/` is expanded, which `read -e` leaves alone.
prompt_plugin_path() {
    local path
    # Completion works from here, and main resolves a relative answer against the same dir.
    cd "$ORIG_PWD"
    read -e -r -p 'Plugin zip: ' path || true
    case "$path" in
    \'*\' | \"*\") path="${path:1:${#path}-2}" ;;
    *) path="${path//\\/}" ;;
    esac
    case "$path" in
    [~]/*) path="$HOME/${path#[~]/}" ;;
    esac
    [ -n "$path" ] || die "no plugin zip given: pass --plugin PATH"
    echo "$path"
}

# The EXIT trap: stops the browser opener and removes the run.
cleanup() {
    kill %1 2>/dev/null || true
    remove_run "$RUN_DIR"
}

free_port() {
    python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}

# Opens the tab once noVNC answers; the URL is printed regardless.
open_when_ready() {
    local port="$1" url deadline
    url="http://127.0.0.1:$port/vnc.html?autoconnect=1&resize=scale&password=$VNC_PASSWORD"
    echo "koreader: $url"
    deadline=$(($(date +%s) + 60))
    until curl -fsS -o /dev/null "http://127.0.0.1:$port/vnc.html" 2>/dev/null; do
        [ "$(date +%s)" -lt "$deadline" ] || return 0
        sleep 1
    done
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 || true
    fi
}

main() {
    local mode="" plugin="" arch dev_port="" deb tag novnc_port net origin="" usage="usage: just koreader [--local | --plugin PATH]"
    while [ $# -gt 0 ]; do
        case "$1" in
        --local)
            [ -z "$mode" ] || die_status=2 die "$usage"
            mode=local
            shift
            ;;
        --plugin)
            [ -z "$mode" ] && [ $# -ge 2 ] || die_status=2 die "$usage"
            mode=plugin
            plugin="$2"
            shift 2
            ;;
        *) die_status=2 die "$usage" ;;
        esac
    done
    if [ -z "$mode" ]; then
        # Without a terminal there is nobody to answer, and an open pipe would hang the read.
        [ -t 0 ] || die "no plugin zip given: pass --plugin PATH"
        mode=plugin
        plugin="$(prompt_plugin_path)"
    fi
    case "$plugin" in
    /* | "") ;;
    *) plugin="$ORIG_PWD/$plugin" ;;
    esac

    # Docker first: with the daemon down a sweep can't remove a dead run's container.
    arch="$(require_docker)"
    if [ "$mode" = local ]; then
        dev_port="$(require_dev_server)"
    fi
    sweep_runs
    RUN_DIR="$(make_run_dir)"
    trap cleanup EXIT
    mkdir -p "$RUN_DIR/home/books"

    # The default bridge reaches any public https host and needs no host network.
    novnc_port="$(free_port)"
    net=(-p "127.0.0.1:$novnc_port:6080")
    if [ "$mode" = plugin ]; then
        python3 scripts/koreader_home.py --home "$RUN_DIR/home" --plugin "$plugin"
    else
        # A Linux engine defines no `host.docker.internal` itself, so name the host gateway.
        net+=(--add-host host.docker.internal:host-gateway)
        origin="http://host.docker.internal:$dev_port"
        if [ "$(docker_network_mode)" = host ]; then
            net=(--network host -e "NOVNC_LISTEN=127.0.0.1:$novnc_port" -e "VNC_PORT=$(free_port)")
            origin="http://127.0.0.1:$dev_port"
        fi
        python3 scripts/koreader_home.py --home "$RUN_DIR/home" --api "http://127.0.0.1:$dev_port" \
            --origin "$origin" --state-dir "$RUNTIME_DIR/koreader"
        echo "koreader: KOReader reaches the dev server at $origin"
    fi
    deb="$(awk -v arch="$arch" '$2 ~ "_" arch "\\.deb$" {print $2}' ui_tests/koreader/koreader.sha256)"
    [ -n "$deb" ] || die "no KOReader pin for $arch in ui_tests/koreader/koreader.sha256"
    tag="omnibus-koreader:$deb"
    docker build -t "$tag" ui_tests/koreader

    # Docker takes the variable from the environment, so the password is never on a command line.
    VNC_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(6))')"
    export VNC_PASSWORD
    open_when_ready "$novnc_port" &
    docker run --init --rm --name "$(container_name "$RUN_DIR")" "${net[@]}" \
        --user "$(id -u):$(id -g)" \
        -e HOME=/tmp \
        -e XDG_DOCUMENTS_DIR=/ko-home/books \
        -e VNC_PASSWORD \
        -v "$RUN_DIR/home:/ko-home" \
        "$tag" koreader-vnc
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    main "$@"
fi
