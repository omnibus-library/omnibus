#!/usr/bin/env bash
# Tests that the newest-iPhone picker in scripts/lib/ios-sim.sh picks the
# newest plain iOS runtime when a device-specific one is installed beside it,
# both in ios_sim_ensure and in scripts/ios-sim.sh and scripts/explore/ios.sh,
# which share it. The iPhone Duo's runtime key is `iOS-27-2-iPhone19-4`, whose
# version is not a number; jq failed on it and every iOS test run reported no
# simulator at all.
#
# No simulator: a stub `xcrun` answers `simctl list` from a fixed device list,
# records the `simctl create` it is asked for, and fails the `simctl
# bootstatus` the two scripts call first, after recording which udid it got.
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
  simctl\ bootstatus\ *) echo "\$*" >"$tmp/booted"; exit 3 ;;
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

udid="$(PATH="$tmp/bin:$PATH" ios_sim_newest_iphone_udid)" \
    || fail "ios_sim_newest_iphone_udid failed"
[ "$udid" = NEW ] || fail "expected the iOS 27.2 iPhone, got '$udid'"
echo "PASS: ios_sim_newest_iphone_udid skips a device-specific runtime"

# The two scripts that drive whichever iPhone is newest, run from a scratch
# checkout so nothing they write lands in this one.
repo="$tmp/repo"
mkdir -p "$repo/scripts/lib" "$repo/scripts/explore"
cp "$repo_root/scripts/lib/ios-sim.sh" "$repo/scripts/lib/"
cp "$repo_root/scripts/ios-sim.sh" "$repo/scripts/"
cp "$repo_root/scripts/explore/ios.sh" "$repo/scripts/explore/"
git init -q "$repo"
for script in scripts/ios-sim.sh "scripts/explore/ios.sh up"; do
    rm -f "$tmp/booted"
    # shellcheck disable=SC2086 # the explore driver's subcommand splits off
    PATH="$tmp/bin:$PATH" env -u OMNIBUS_IOS_SIM_UDID \
        bash "$repo"/$script >/dev/null 2>"$tmp/err" && fail "$script ran past the stubbed bootstatus"
    grep -qx "simctl bootstatus NEW -b" "$tmp/booted" 2>/dev/null \
        || fail "$script booted the wrong simulator: $(cat "$tmp/booted" 2>/dev/null) $(cat "$tmp/err")"
    echo "PASS: $script boots the newest plain-runtime iPhone"
done
