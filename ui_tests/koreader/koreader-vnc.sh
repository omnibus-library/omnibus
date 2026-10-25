#!/usr/bin/env bash
# The interactive entry (`just koreader`, docs/koreader.md): KOReader on a
# 600x800 virtual screen, shown in a browser through x11vnc and noVNC. The
# lane's CMD never runs this.
#
# VNC has no password and listens on loopback inside the container; only the
# noVNC port is published, and scripts/koreader-dev.sh binds that to the
# host's loopback.
set -euo pipefail

if [ -z "${DISPLAY:-}" ]; then
    exec xvfb-run -a -s "-screen 0 600x800x24" "$0"
fi

VNC_PORT="${VNC_PORT:-5900}"
NOVNC_LISTEN="${NOVNC_LISTEN:-0.0.0.0:6080}"

x11vnc -localhost -nopw -forever -shared -quiet -rfbport "$VNC_PORT" >/tmp/x11vnc.log 2>&1 &
websockify --web /usr/share/novnc "$NOVNC_LISTEN" "127.0.0.1:$VNC_PORT" >/tmp/websockify.log 2>&1 &

# The file browser opens on the books dir, not the data dir; quitting KOReader
# ends xvfb-run, and with it the container.
exec koreader /ko-home/books
