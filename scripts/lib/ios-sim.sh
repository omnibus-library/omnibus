#!/usr/bin/env bash
# The dedicated test simulator each worktree runs its iOS suites and
# screenshot tours on. Sourced by scripts/ios-test.sh and
# scripts/ios-validate.sh, which must agree on the device: two worktrees on
# one simulator share one app container, so the second install replaces the
# first mid-run and the second --uitest-reset signs the first out.
#
# Needs jq and system Xcode's simctl.

# `omnibus-tests` in the main checkout — and in CI, whose checkout directory
# is also named `omnibus` — and `omnibus-tests-<worktree dir>` everywhere
# else: the same main-checkout rule the flake's per-worktree PORT uses.
ios_sim_name() {
  local base
  base="$(basename "$1")"
  if [ "$base" = "omnibus" ]; then
    echo "omnibus-tests"
  else
    echo "omnibus-tests-$base"
  fi
}

# Echo the UDID of the simulator named $1 on the newest iPhone runtime,
# creating it there on first use and keeping it for the next run.
#
# The runtime is resolved here rather than left to xcodebuild: its destination
# matcher silently omits simulators whose runtime is older than the project's
# IPHONEOS_DEPLOYMENT_TARGET (they don't even show up as ineligible), so this
# fails with a message that points at the real cause instead.
ios_sim_ensure() {
  local name="$1" runtime devtype udid
  read -r runtime devtype < <(xcrun simctl list --json devices available | jq -r '
    .devices | to_entries
    | map(select(.key | test("SimRuntime\\.iOS")))
    | map({key,
           ver: (.key | sub(".*iOS-"; "") | gsub("-"; ".")),
           devs: [.value[] | select(.name | startswith("iPhone"))]})
    | map(select(.devs | length > 0))
    | sort_by(.ver | split(".") | map(tonumber))
    | if length == 0 then empty
      else last | "\(.key)\t\(.devs[0].deviceTypeIdentifier)" end') || true
  if [ -z "${runtime:-}" ]; then
    echo "ios-sim: no available iPhone simulator; if 'xcrun simctl list devices' shows iPhones, their iOS runtime is older than the project's IPHONEOS_DEPLOYMENT_TARGET" >&2
    return 1
  fi
  udid="$(xcrun simctl list --json devices available | jq -r \
    --arg rt "$runtime" --arg name "$name" \
    '.devices[$rt][]? | select(.name == $name) | .udid' | head -n 1)"
  if [ -z "$udid" ]; then
    udid="$(xcrun simctl create "$name" "$devtype" "$runtime")"
    echo "ios-sim: created simulator '$name' ($devtype on $runtime)" >&2
  fi
  echo "$udid"
}

# Echo the UDID of every simulator named $1, on any runtime, one per line.
ios_sim_find() {
  xcrun simctl list --json devices | jq -r --arg name "$1" \
    '.devices[][] | select(.name == $name) | .udid'
}
