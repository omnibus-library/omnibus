#!/usr/bin/env bash
# `just koreader`: an interactive KOReader in a browser tab, in Docker, syncing
# with this worktree's dev server (docs/koreader.md).
#
# Usage: scripts/koreader-dev.sh [--home DIR]
#
# Checks Docker and the dev server first (it never starts a server), builds the
# lane's image, then runs it with the home mounted at /ko-home so settings,
# books and progress persist. The foreground container is the session: Ctrl-C
# or quitting KOReader ends it.
#
# Sourceable without running `main`, so scripts/tests/koreader-dev-preflight.test.sh
# can exercise the checks.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/lib/dev-port.sh disable=SC1091
source scripts/lib/dev-port.sh

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

free_port() {
    python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}

# Opens the tab once noVNC answers; the URL is printed regardless.
open_when_ready() {
    local port="$1" url deadline
    url="http://127.0.0.1:$port/vnc.html?autoconnect=1&resize=scale"
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
    local home="$RUNTIME_DIR/koreader/home" arch dev_port deb tag name novnc_port origin net usage="usage: just koreader [--home DIR]"
    while [ $# -gt 0 ]; do
        case "$1" in
        --home)
            [ $# -ge 2 ] || die_status=2 die "$usage"
            home="$2"
            shift 2
            ;;
        *) die_status=2 die "$usage" ;;
        esac
    done

    arch="$(require_docker)"
    dev_port="$(require_dev_server)"

    mkdir -p "$home/books"
    home="$(cd "$home" && pwd)"

    deb="$(awk -v arch="$arch" '$2 ~ "_" arch "\\.deb$" {print $2}' ui_tests/koreader/koreader.sha256)"
    [ -n "$deb" ] || die "no KOReader pin for $arch in ui_tests/koreader/koreader.sha256"
    tag="omnibus-koreader:$deb"
    docker build -t "$tag" ui_tests/koreader

    name="omnibus-koreader-$(printf '%s' "$home" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-8)"
    novnc_port="$(free_port)"
    net=(-p "127.0.0.1:$novnc_port:6080")
    origin="http://host.docker.internal:$dev_port"
    if [ "$(uname -s)" = Linux ]; then
        # shortcut: Docker Desktop for Linux and rootless docker take this branch and won't reach the host; detect via `docker info` if anyone uses them.
        net=(--network host -e "NOVNC_LISTEN=127.0.0.1:$novnc_port" -e "VNC_PORT=$(free_port)")
        origin="http://127.0.0.1:$dev_port"
    fi

    python3 scripts/koreader_home.py --home "$home" --api "http://127.0.0.1:$dev_port" \
        --origin "$origin" --state-dir "$RUNTIME_DIR/koreader"

    echo "koreader: KOReader reaches the dev server at $origin"
    open_when_ready "$novnc_port" &
    trap 'kill %1 2>/dev/null || true' EXIT
    docker run --init --rm --name "$name" "${net[@]}" \
        --user "$(id -u):$(id -g)" \
        -e HOME=/tmp \
        -e XDG_DOCUMENTS_DIR=/ko-home/books \
        -v "$home:/ko-home" \
        "$tag" koreader-vnc
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    main "$@"
fi
