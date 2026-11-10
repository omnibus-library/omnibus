#!/usr/bin/env bash
# The dedicated test simulator each worktree runs its iOS suites and
# screenshot tours on. Sourced by scripts/ios-test.sh and
# scripts/ios-validate.sh, which must agree on the device: two worktrees on
# one simulator share one app container, so the second install replaces the
# first mid-run and the second --uitest-reset signs the first out.
#
# Also the one newest-iPhone picker: scripts/ios-sim.sh and
# scripts/explore/ios.sh source it for ios_sim_newest_iphone_udid.
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

# Echo the newest iOS runtime that has an available iPhone, as one line of
# JSON `{key, devs}` (devs: its iPhones), or nothing when there is none.
#
# The runtime is resolved here rather than left to xcodebuild: its destination
# matcher silently omits simulators whose runtime is older than the project's
# IPHONEOS_DEPLOYMENT_TARGET (they don't even show up as ineligible), so the
# callers fail with a message that points at the real cause instead. Only
# plain `iOS-<major>-<minor>` runtimes count: a device's own runtime (the
# iPhone Duo's `iOS-27-2-iPhone19-4`) holds one model and has no numeric
# version.
ios_sim_newest_iphone_runtime() {
  xcrun simctl list --json devices available | jq -c '
    .devices | to_entries
    | map(select(.key | test("SimRuntime\\.iOS-[0-9]+(-[0-9]+)*$")))
    | map({key,
           ver: (.key | sub(".*iOS-"; "") | gsub("-"; ".")),
           devs: [.value[] | select(.name | startswith("iPhone"))]})
    | map(select(.devs | length > 0))
    | sort_by(.ver | split(".") | map(tonumber))
    | if length == 0 then empty else last | {key, devs} end'
}

# Echo the UDID of an existing iPhone on the newest iOS runtime, or nothing
# when there is none — for callers that drive whichever iPhone is newest.
ios_sim_newest_iphone_udid() {
  ios_sim_newest_iphone_runtime | jq -r '.devs[0].udid'
}

# Echo the UDID of the simulator named $1 on the newest iPhone runtime,
# creating it there on first use and keeping it for the next run.
ios_sim_ensure() {
  local name="$1" runtime devtype udid
  read -r runtime devtype < <(ios_sim_newest_iphone_runtime \
    | jq -r '"\(.key)\t\(.devs[0].deviceTypeIdentifier)"') || true
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

# This worktree's iPhone Duo, beside its plain test iPhone: `<ios_sim_name>-duo`.
ios_sim_duo_name() {
  echo "$(ios_sim_name "$1")-duo"
}

# Echo the UDID of the iPhone Duo named $1, creating it on first use. The Duo
# lives only on its own runtime (`iOS-27-2-iPhone19-4`), which the newest-iPhone
# picker skips, so the runtime is the newest one that supports the device type.
ios_sim_ensure_duo() {
  local name="$1" devtype="com.apple.CoreSimulator.SimDeviceType.iPhone-Duo" runtime udid
  runtime="$(xcrun simctl list --json runtimes available | jq -r --arg t "$devtype" '
    [.runtimes[] | select(any(.supportedDeviceTypes[]?; .identifier == $t))]
    | sort_by(.version | split(".") | map(tonumber)) | last | .identifier // empty')"
  if [ -z "$runtime" ]; then
    echo "ios-sim: no installed runtime runs the iPhone Duo; install it from Xcode > Settings > Components" >&2
    return 1
  fi
  udid="$(xcrun simctl list --json devices available | jq -r \
    --arg rt "$runtime" --arg name "$name" \
    '.devices[$rt][]? | select(.name == $name) | .udid' | head -n 1)"
  if [ -z "$udid" ]; then
    udid="$(xcrun simctl create "$name" "$devtype" "$runtime")"
    echo "ios-sim: created simulator '$name' (iPhone Duo on $runtime)" >&2
  fi
  echo "$udid"
}

# Echo the UDID of every simulator named $1, on any runtime, one per line.
ios_sim_find() {
  xcrun simctl list --json devices | jq -r --arg name "$1" \
    '.devices[][] | select(.name == $name) | .udid'
}

# Echo the UDID of the simulator named $1 to drive, or nothing when none has
# that name: booted before shut down, then the newest runtime (by the version
# ios_sim_ensure_duo sorts on), since one left on an older runtime keeps the name.
ios_sim_find_preferred() {
  local versions
  versions="$(xcrun simctl list --json runtimes | jq -c \
    '[.runtimes[] | {key: .identifier, value: .version}] | from_entries')"
  xcrun simctl list --json devices | jq -r --arg name "$1" --argjson v "${versions:-"{}"}" '
    [.devices | to_entries[] | .key as $rt | .value[] | select(.name == $name)
     | {udid, rank: [.state == "Booted", (($v[$rt] // "0") | split(".") | map(tonumber? // 0))]}]
    | sort_by(.rank) | last | .udid // empty'
}
