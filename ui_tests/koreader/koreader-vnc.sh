#!/usr/bin/env bash
# The interactive entry (`just koreader`, docs/koreader.md): KOReader on a
# 600x800 virtual screen, shown in a browser through x11vnc and noVNC. The
# lane's CMD never runs this.
#
# Needs VNC_PASSWORD: VNC is never served without one. Both servers listen on
# loopback (the container's, or the host's under --network host, where any local
# process can reach them, hence the password).
#
# One SIGINT/SIGTERM stops KOReader through its own exit path, which writes its
# settings: xvfb-run ignores signals while it waits, so the outer layer relays
# them to the inner one, which signals KOReader's process group.
set -euo pipefail

PID_FILE=/tmp/koreader-vnc.pid

if [ -z "${DISPLAY:-}" ]; then
    xvfb-run -a -s "-screen 0 600x800x24" "$0" &
    xvfb=$!
    trap 'kill -TERM "$(cat "$PID_FILE" 2>/dev/null || echo "$xvfb")" 2>/dev/null || true' INT TERM
    status=0
    until wait "$xvfb"; status=$?; ! kill -0 "$xvfb" 2>/dev/null; do :; done
    exit "$status"
fi

: "${VNC_PASSWORD:?VNC_PASSWORD must be set}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_LISTEN="${NOVNC_LISTEN:-0.0.0.0:6080}"
echo $$ >"$PID_FILE"

# The password goes through a file x11vnc deletes after reading, not through argv.
(umask 077 && printf '%s' "$VNC_PASSWORD" >/tmp/vnc.pw)
unset VNC_PASSWORD

# True when `pid` itself holds the listening socket on `port`: a connect alone
# would succeed against whatever else already holds the port.
listens() {
    local inode fd
    for inode in $(awk -v p=":$(printf '%04X' "$2")" '$4 == "0A" && $2 ~ p "$" {print $10}' /proc/net/tcp /proc/net/tcp6 2>/dev/null); do
        for fd in /proc/"$1"/fd/*; do
            [ "$(readlink "$fd" 2>/dev/null)" = "socket:[$inode]" ] && return 0
        done
    done
    return 1
}

# Fails the container with the server's own log if it can't take its port.
require_listening() {
    local name="$1" pid="$2" port="$3" _
    for _ in $(seq 25); do
        kill -0 "$pid" 2>/dev/null || break
        listens "$pid" "$port" && return 0
        sleep 0.2
    done
    echo "koreader-vnc: $name did not start on port $port:" >&2
    tail -n 5 "/tmp/$name.log" >&2
    exit 1
}

x11vnc -localhost -passwdfile rm:/tmp/vnc.pw -forever -shared -quiet -rfbport "$VNC_PORT" >/tmp/x11vnc.log 2>&1 &
require_listening x11vnc $! "$VNC_PORT"
websockify --web /usr/share/novnc "$NOVNC_LISTEN" "127.0.0.1:$VNC_PORT" >/tmp/websockify.log 2>&1 &
require_listening websockify $! "${NOVNC_LISTEN##*:}"

# Job control gives KOReader's wrapper and luajit one process group to signal;
# the file browser opens on the books dir, not the data dir.
set -m
koreader /ko-home/books &
kpid=$!
stopped=0
trap 'stopped=1; kill -TERM -- -"$kpid" 2>/dev/null || true' INT TERM
status=0
wait "$kpid" || status=$?
while kill -0 -- -"$kpid" 2>/dev/null; do sleep 0.2; done # luajit outlives the wrapper while it flushes
[ "$stopped" = 0 ] || exit 0
exit "$status"
