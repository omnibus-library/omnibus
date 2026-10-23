#!/usr/bin/env bash
# Run a real KOReader against a scratch Omnibus server: browse, search,
# download and open over OPDS (docs/koreader.md).
#
# Usage: scripts/koreader-e2e.sh   (normally `just koreader-e2e`)
#
# What it does:
#   1. `dx bundle` the web app and starts the bundle's standalone server on a
#      scratch DB with a seeded library: the two committed fixture EPUBs
#      (test_data/epubs/generated/alpha.epub, beta.epub), the two the `precise`
#      scenario puts on the shelf (standalone-lagoon.epub, frontmatter-relay.epub)
#      and the first (admin) account, registered here as on CI.
#   2. Seeds the `delivery`, `roundtrip`, `metadata`, `precise` and `highlights` scenarios through the REST API: a shelf
#      holding Alpha that syncs to devices, and a KOReader whose preconfigured plugin
#      it downloads from the real Settings route.
#   3. Builds ui_tests/koreader (pinned KOReader under Xvfb) and runs one
#      container per scenario; its user patch drives KOReader's own OPDS
#      plugin through add-catalog, browse, search, download and open, and the
#      Omnibus plugin through a sync that delivers and one that removes, and
#      through opening a book at the web's position and closing it at its own,
#      through a web edit of a book's title and cover reaching it, through a
#      position inside a paragraph travelling both ways, and through a highlight
#      and its note travelling out and a recolour, a delete and a new highlight
#      travelling back.
#   4. Reports each scenario's result JSON (scripts/koreader_report.py) and
#      exits non-zero on any failure, keeping the scratch dir (results,
#      screenshot, logs) and naming it.
#
# Linux hosts with docker only: `--network host` and the amd64 .deb.
# base_url is set by start_scratch_server (scripts/lib/scratch-server.sh).
# shellcheck disable=SC2154
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/lib/dev-port.sh disable=SC1091
source scripts/lib/dev-port.sh
# shellcheck source=scripts/lib/scratch-server.sh disable=SC1091
source scripts/lib/scratch-server.sh

label=koreader
kept_hint="server.log, results/"
deb="$(awk '{print $2}' ui_tests/koreader/koreader.sha256)"
docker build -t "omnibus-koreader:$deb" ui_tests/koreader
bundle_web_app

# Seed the library before the server boots: an empty index would kick its
# boot scan off on nothing.
make_scratch_dir
mkdir -p "$scratch/library" "$scratch/results"
cp test_data/epubs/generated/{alpha,beta,standalone-lagoon,frontmatter-relay}.epub "$scratch/library/"
start_scratch_server "EBOOK_LIBRARY_PATH=$scratch/library"

user=koreader
password=koreader-e2e-pw-00
curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$user\",\"password\":\"$password\"}" \
    "$base_url/api/auth/register" >/dev/null

deadline=$(($(date +%s) + 60))
until body="$(curl -fsS -u "$user:$password" "$base_url/opds/all" 2>/dev/null)" &&
    printf '%s' "$body" | grep -q ">Alpha<" &&
    printf '%s' "$body" | grep -q ">Beta in the Series<" &&
    printf '%s' "$body" | grep -q ">Lagoon of Ligatures<" &&
    printf '%s' "$body" | grep -q ">Frontmatter Relay<"; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "$label: library never indexed" >&2
        exit 1
    fi
    sleep 1
done

# The `delivery`, `roundtrip`, `metadata`, `precise` and `highlights` scenarios' seed. The REST calls need a session, so sign in with a
# bearer token; the plugin is the zip the Settings download hands a reader.
json_field() { python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
session="$(curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$user\",\"password\":\"$password\",\"client_kind\":\"bearer\"}" \
    "$base_url/api/auth/login" | json_field token)"
api() { curl -fsS -H "Authorization: Bearer $session" -H 'Content-Type: application/json' "$@"; }

book_uuid() {
    api "$base_url/api/ebooks" | python3 -c \
        'import json,sys; print(next(b["unique_identifier"] for b in json.load(sys.stdin)["books"] if b["title"] == sys.argv[1]))' "$1"
}
alpha_uuid="$(book_uuid Alpha)"
lagoon_uuid="$(book_uuid "Lagoon of Ligatures")"
relay_uuid="$(book_uuid "Frontmatter Relay")"
shelf_id="$(api -X POST -d "{\"kind\":\"manual\",\"name\":\"KOReader lane\",\"book_uuids\":[\"$alpha_uuid\"]}" \
    "$base_url/api/shelves" | json_field id)"
api -X PATCH -d '{"sync_to_kobo":true}' "$base_url/api/shelves/$shelf_id" >/dev/null
device_id="$(api -X POST -d '{"name":"lane","kind":"koreader"}' \
    "$base_url/api/account/kobo-devices" | json_field id)"
mkdir -p "$scratch/plugins"
api -o "$scratch/plugin.zip" "$base_url/api/account/kobo-devices/$device_id/koreader-plugin"
python3 -m zipfile -e "$scratch/plugin.zip" "$scratch/plugins"

# Scenario names live here; the fixture titles live beside them in the
# patch's opds scenario. `metadata` retitles Alpha on the shared server, and `precise` and then
# `highlights` come last because they add two books to the shelf the earlier scenarios expect
# to hold Alpha alone.
scenarios=(opds delivery roundtrip metadata precise highlights)
for scenario in "${scenarios[@]}"; do
    set +e
    timeout -k 15 300 docker run --init --rm --network host \
        --user "$(id -u):$(id -g)" \
        -e HOME=/tmp \
        -e KOREADER_E2E_SCENARIO="$scenario" \
        -e KOREADER_E2E_RESULTS=/results \
        -e OMNIBUS_URL="$base_url" \
        -e OMNIBUS_USER="$user" \
        -e OMNIBUS_PASSWORD="$password" \
        -e OMNIBUS_SESSION_TOKEN="$session" \
        -e OMNIBUS_SHELF_ID="$shelf_id" \
        -e OMNIBUS_LAGOON_UUID="$lagoon_uuid" \
        -e OMNIBUS_RELAY_UUID="$relay_uuid" \
        -v "$PWD/ui_tests/koreader/patches:/ko-home/patches:ro" \
        -v "$scratch/plugins/omnibus.koplugin:/ko-home/plugins/omnibus.koplugin:ro" \
        -v "$scratch/results:/results" \
        "omnibus-koreader:$deb" \
        >"$scratch/results/$scenario.koreader.log" 2>&1
    set -e
done

set +e
python3 scripts/koreader_report.py "$scratch/results" "${scenarios[@]}"
status=$?
set -e
exit "$status"
