#!/usr/bin/env bash
# Ensure N exploration accounts exist on the instance and emit their credentials
# as JSON on stdout. Idempotent: creates what is missing, rotates the password
# of what already exists, and sets every account's permissions to its role.
#
# Usage: provision.sh <agent-count> [--no-admin] [--reader <k>]
#
#   (default)     every account is an admin
#   --no-admin    every account is a non-admin, still able to upload and edit
#   --reader <k>  explorer-k alone is a reader: no admin, and no upload, so the
#                 catalog's upload-refusal criterion is decidable
#
# Permissions are set on every call rather than only at creation: stable
# usernames mean last run's reader is this run's admin, and an account that
# kept whatever it was first created with made `--reader` a manual Settings
# edit before every run.
#
# Why usernames are stable but passwords are not:
#   Provenance ownership (docs/qa/agentic_exploration/start.md) says an agent
#   owns the books it added *in any run*, and that lookup is keyed on the actor.
#   So `explorer-1` must be the same account forever, or every book uploaded by
#   a previous run becomes unownable — nobody could ever merge or delete it.
#   Passwords are the opposite: nothing needs them after a run ends, so they are
#   minted fresh here and pushed via the admin reset endpoint. That keeps the
#   persisted-secret surface down to exactly one credential, the admin's.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
source ./lib.sh

usage="usage: provision.sh <agent-count> [--no-admin] [--reader <k>]"
count="${1:?$usage}"
shift
[[ "$count" =~ ^[0-9]+$ ]] || { echo "agent-count must be a number" >&2; exit 2; }
[ "$count" -ge 1 ] || { echo "agent-count must be at least 1" >&2; exit 2; }

is_admin=true
reader=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-admin) is_admin=false ;;
    --reader) reader="${2:?--reader needs an account number}"; shift ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
  shift
done
if [ -n "$reader" ] && ! { [[ "$reader" =~ ^[0-9]+$ ]] && [ "$reader" -ge 1 ] && [ "$reader" -le "$count" ]; }; then
  echo "--reader must name an account in 1..$count (got: $reader)" >&2
  exit 2
fi

explore::load_env
explore::login_admin

existing="$(explore::curl -b "$EXPLORE_JAR" "$EXPLORE_URL/api/users")"

out="[]"
for i in $(seq 1 "$count"); do
  user="explorer-$i"
  pass="$(explore::gen_password)"
  if [ "$i" = "$reader" ]; then
    role=reader perms='{"is_admin":false,"can_upload":false,"can_edit":true,"can_download":true}'
  elif $is_admin; then
    role=admin perms='{"is_admin":true,"can_upload":true,"can_edit":true,"can_download":true}'
  else
    role=non-admin perms='{"is_admin":false,"can_upload":true,"can_edit":true,"can_download":true}'
  fi
  id=$(printf '%s' "$existing" | python3 -c '
import json,sys
want = sys.argv[1]
for u in json.load(sys.stdin):
    if u["username"].lower() == want.lower():
        print(u["id"]); break
' "$user")

  if [ -n "$id" ]; then
    code=$(explore::curl -b "$EXPLORE_JAR" -o /dev/null -w '%{http_code}' \
      -X POST "$EXPLORE_URL/api/users/$id/password" \
      -H 'Content-Type: application/json' \
      -d "{\"password\":$(explore::json_str "$pass")}")
    [ "$code" = "204" ] || { echo "password rotate for $user failed (HTTP $code)" >&2; exit 1; }
    code=$(explore::curl -b "$EXPLORE_JAR" -o /dev/null -w '%{http_code}' \
      -X PATCH "$EXPLORE_URL/api/users/$id/permissions" \
      -H 'Content-Type: application/json' -d "$perms")
    [ "$code" = "204" ] || { echo "setting $user's permissions to $role failed (HTTP $code)" >&2; exit 1; }
    action=reused
  else
    body=$(printf '{"username":%s,"password":%s,"permissions":%s}' \
      "$(explore::json_str "$user")" "$(explore::json_str "$pass")" "$perms")
    resp=$(explore::curl -b "$EXPLORE_JAR" -w '\n%{http_code}' \
      -X POST "$EXPLORE_URL/api/users" -H 'Content-Type: application/json' -d "$body")
    code="${resp##*$'\n'}"
    [ "$code" = "201" ] || { echo "create $user failed (HTTP $code): ${resp%$'\n'*}" >&2; exit 1; }
    action=created
  fi

  # Prove the credential actually works before handing it to an agent — a
  # provisioning step that reports success and yields an unusable login is
  # worse than one that fails.
  code=$(explore::curl -o /dev/null -w '%{http_code}' -X POST "$EXPLORE_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"username":%s,"password":%s}' "$(explore::json_str "$user")" "$(explore::json_str "$pass")")")
  [ "$code" = "200" ] || { echo "verify login for $user failed (HTTP $code)" >&2; exit 1; }

  out=$(printf '%s' "$out" | python3 -c '
import json,sys
acc = json.load(sys.stdin)
acc.append({"actor": sys.argv[1], "username": sys.argv[2], "password": sys.argv[3],
            "action": sys.argv[4], "role": sys.argv[5]})
print(json.dumps(acc))
' "agent-$i" "$user" "$pass" "$action" "$role")
  echo "  $action + verified: $user ($role)" >&2
done

printf '%s\n' "$out"
