#!/usr/bin/env bash
# Tests that ios_sim_ensure (scripts/lib/ios-sim.sh) picks the newest plain
# iOS runtime when a device-specific one is installed beside it. The iPhone
# Duo's runtime key is `iOS-27-2-iPhone19-4`, whose version is not a number;
# jq failed on it and every iOS test run reported no simulator at all.
#
# No simulator: a stub `xcrun` answers `simctl list` from a fixed device list
# and records the `simctl create` it is asked for.
#
# Usage: scripts/tests/ios-sim-ensure.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin"
cat >"$tmp/devices.json" <<'JSON'
{"devices": {
  "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
    {"name": "iPhone 17 Pro", "udid": "OLD", "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"}],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2": [
    {"name": "iPhone 18 Pro", "udid": "NEW", "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro"}],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4": [
    {"name": "iPhone Duo", "udid": "DUO", "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo"}]
}}
JSON
cat >"$tmp/bin/xcrun" <<STUB
#!/usr/bin/env bash
case "\$*" in
  "simctl list --json devices available") cat "$tmp/devices.json" ;;
  simctl\ create\ *) echo "\$*" >"$tmp/created"; echo "CREATED" ;;
  *) echo "unexpected xcrun \$*" >&2; exit 1 ;;
esac
STUB
chmod +x "$tmp/bin/xcrun"

# shellcheck source=../lib/ios-sim.sh
source "$repo_root/scripts/lib/ios-sim.sh"
fail() {
    echo "FAIL: $*" >&2
    exit 1
}
udid="$(PATH="$tmp/bin:$PATH" ios_sim_ensure omnibus-tests-x 2>"$tmp/err")" \
    || fail "ios_sim_ensure failed: $(cat "$tmp/err")"
[ "$udid" = CREATED ] || fail "expected a new simulator, got '$udid'"
grep -q "iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-2$" "$tmp/created" \
    || fail "created on the wrong runtime: $(cat "$tmp/created")"
echo "PASS: ios_sim_ensure skips a device-specific runtime"
