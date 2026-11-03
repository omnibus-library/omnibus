#!/usr/bin/env bash
# Smoke-test a built Docker image: the React client at `/`, and, with
# --upgrade-from, that a reader signed in on the older image is still signed in
# after the swap.
#
# Usage: scripts/docker-smoke.sh <image> [--upgrade-from <older image>]
#   e.g. scripts/docker-smoke.sh omnibus:dev --upgrade-from sesloan/omnibus:latest
#
# Both images run on the same /config and /cache volumes, as an operator's
# upgrade does. Checks, against the image under test:
#   - `/` and a deep link answer the React shell; its entry script is served,
#     brotli-encoded to a client that accepts it
#   - an opt-in-era `/react/…` link redirects to the same path at the root
#   - an unknown `/api/*` path answers a JSON 404
#   - (--upgrade-from) the older image's session cookie still reads /api/auth/me
# Exits non-zero on the first failed check. Containers and volumes are always removed.
set -euo pipefail

image="${1:?usage: $0 <image> [--upgrade-from <older image>]}"
shift
from=""
if [ "${1:-}" = "--upgrade-from" ]; then
    from="${2:?--upgrade-from needs an image}"
fi

run_id="omnibus-smoke-$$"
work="$(mktemp -d)"
container=""
cleanup() {
    [ -n "$container" ] && docker rm -f "$container" >/dev/null 2>&1 || true
    docker volume rm -f "$run_id-config" "$run_id-cache" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $*" >&2
    if [ -n "$container" ]; then
        echo "--- end of the container's log:" >&2
        docker logs --tail 40 "$container" >&2 || true
    fi
    exit 1
}
pass() { echo "PASS: $*"; }

# Start `$1` on the shared volumes and wait for its health probe. Sets base.
start() {
    container="$(docker run -d --name "$run_id-$(date +%s%N)" \
        -v "$run_id-config:/config" -v "$run_id-cache:/cache" \
        -p 127.0.0.1::3000 "$1")"
    local port
    port="$(docker port "$container" 3000/tcp | head -n 1 | sed 's/.*://')"
    # `localhost`, not 127.0.0.1: curl keeps the `__Host-` session cookie (Secure)
    # only for a secure origin, and localhost counts as one.
    base="http://localhost:$port"
    for _ in $(seq 1 120); do
        curl -fsS "$base/api/_health" >/dev/null 2>&1 && return 0
        [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ] ||
            fail "$1 exited before it became healthy"
        sleep 1
    done
    fail "$1 never answered /api/_health"
}

stop() {
    docker stop "$container" >/dev/null
    docker rm "$container" >/dev/null
    container=""
}

# POST JSON with the session jar and the Origin the CSRF check wants.
post_json() {
    curl -sS -o "$work/body" -w '%{http_code}' -b "$work/jar" -c "$work/jar" \
        -H "Origin: $base" -H 'Content-Type: application/json' -d "$2" "$base$1"
}

sign_in() {
    local creds='{"username":"smoke-admin","password":"smoke-test-password-1"}'
    local status
    status="$(post_json /api/auth/register "$creds")"
    case "$status" in 200 | 201 | 409) ;; *) fail "register answered $status: $(cat "$work/body")" ;; esac
    status="$(post_json /api/auth/login "$creds")"
    [ "$status" = 200 ] || fail "login answered $status: $(cat "$work/body")"
}

me_status() {
    curl -sS -o /dev/null -w '%{http_code}' -b "$work/jar" "$base/api/auth/me"
}

if [ -n "$from" ]; then
    echo "== $from: sign in"
    start "$from"
    sign_in
    [ "$(me_status)" = 200 ] || fail "$from doesn't see its own session"
    pass "signed in on $from"
    stop
fi

echo "== $image"
start "$image"
if [ -n "$from" ]; then
    [ "$(me_status)" = 200 ] || fail "the session from $from was lost in the upgrade"
    pass "the session signed in on $from is still signed in"
else
    sign_in
fi

for path in / /books/00000000-0000-0000-0000-000000000000; do
    status="$(curl -sS -o "$work/shell" -w '%{http_code}' -b "$work/jar" "$base$path")"
    [ "$status" = 200 ] || fail "GET $path answered $status"
    grep -q '<div id="root">' "$work/shell" || fail "GET $path isn't the React shell"
done
pass "/ and a deep link answer the React shell"

entry="$(grep -o 'src="/assets/[^"]*\.js"' "$work/shell" | head -n 1 | sed 's/^src="//; s/"$//')"
[ -n "$entry" ] || fail "the shell names no /assets/*.js entry script"
headers="$(curl -sS -o /dev/null -D - -H 'Accept-Encoding: br' "$base$entry")"
echo "$headers" | grep -qi '^HTTP/[0-9.]* 200' || fail "GET $entry: $(echo "$headers" | head -n 1)"
echo "$headers" | grep -qi '^content-type: text/javascript' || fail "$entry isn't served as JavaScript"
echo "$headers" | grep -qi '^content-encoding: br' || fail "$entry isn't served brotli-encoded"
pass "the entry script $entry is served, brotli-encoded"

location="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "$base/react/stats?range=year")"
[ "$location" = "308 $base/stats?range=year" ] || fail "/react/stats answered '$location'"
pass "an opt-in-era /react/ link redirects to the root"

status="$(curl -sS -o "$work/body" -w '%{http_code} %{content_type}' -b "$work/jar" "$base/api/no-such-route")"
[ "$status" = "404 application/json" ] || fail "an unknown /api path answered '$status'"
pass "an unknown /api path answers a JSON 404"

echo "all checks passed"
