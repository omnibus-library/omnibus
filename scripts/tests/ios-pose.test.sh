#!/usr/bin/env bash
# Tests scripts/ios-pose.sh and ios_sim_ensure_duo (scripts/lib/ios-sim.sh)
# without a simulator: the iPhone Duo is made on its own runtime, even beside a
# runtime with no version, a hinge angle out of range never reaches the
# simulator, a rotation goes through the Duo's HID event on a foldable and
# through devicectl on a plain iPhone, a helper that fails to build or sign
# stops the command before it touches the simulator but never masks a bad
# argument, the timeout is checked only by commands that wait, a screenshot
# with no display to read says so, a worktree without a Duo is told how to make
# one, and a booted Duo wins over a stale one of the same name, even one on a
# newer runtime, and the newest runtime's when both are booted, and an
# unavailable one never counts.
#
# Stub `xcrun`, `xcode-select` and `codesign` answer from fixed JSON and log
# every command; the helper binary is a pre-made file in a scratch cache, and
# the stub compiler fails, so nothing is compiled and no Xcode is needed. Real
# hardware is covered by the ios-validate skill's tours.
#
# Usage: scripts/tests/ios-pose.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

mkdir -p "$tmp/bin"
cat >"$tmp/runtimes.json" <<'JSON'
{"runtimes": [
  {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-2", "version": "27.2",
   "supportedDeviceTypes": [{"identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro"}]},
  {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4", "version": "27.2",
   "supportedDeviceTypes": [{"identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo"}]},
  {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-Beta-iPhone19-4",
   "supportedDeviceTypes": [{"identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo"}]}
]}
JSON
cat >"$tmp/devices.json" <<'JSON'
{"devices": {
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2": [
    {"name": "iPhone 18 Pro", "udid": "PLAIN", "state": "Booted"}],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4": [
    {"name": "iPhone Duo", "udid": "DUO", "state": "Booted"}]
}}
JSON
echo portrait >"$tmp/orientation"
# Only DUO has a hinge; `orient` moves DUO, `devicectl … set` moves PLAIN, as on
# real simulators, so a rotation sent the wrong way never reports success. The
# compiler fails unless clang-ok exists, then writes its -o file.
cat >"$tmp/bin/xcrun" <<STUB
#!/usr/bin/env bash
echo "\$*" >>"$tmp/log"
case "\$*" in
  "simctl list --json runtimes available") jq '.runtimes |= map(select(.isAvailable != false))' "$tmp/runtimes.json" ;;
  "simctl list --json runtimes"*) cat "$tmp/runtimes.json" ;;
  "simctl list --json devices available") jq '.devices |= map_values(map(select(.isAvailable != false)))' "$tmp/devices.json" ;;
  "simctl list --json devices"*) cat "$tmp/devices.json" ;;
  "-sdk iphonesimulator clang "*)
    [ -f "$tmp/clang-ok" ] || { echo "clang: error: stubbed out" >&2; exit 1; }
    while [ \$# -gt 0 ]; do [ "\$1" = -o ] && : >"\$2"; shift; done ;;
  simctl\ create\ *) echo "CREATED" ;;
  "simctl spawn DUO "*" angle") echo 0.0 ;;
  "simctl spawn PLAIN "*" angle") exit 2 ;;
  "simctl spawn DUO "*" orient landscape-left") echo landscapeLeft >"$tmp/orientation" ;;
  "simctl spawn DUO "*" orient pud") echo portraitUpsideDown >"$tmp/orientation" ;;
  "devicectl device orientation set "*" -d PLAIN -q -t "*) echo "\$5" >"$tmp/orientation" ;;
  "devicectl device orientation set "*) ;;
  "devicectl device orientation get "*)
    echo "{\"result\": {\"deviceOrientationNonFlat\": \"\$(cat "$tmp/orientation")\"}}" ;;
  "devicectl device info displays "*) echo '{"result": {}}' ;;
  *) echo "unexpected xcrun \$*" >&2; exit 1 ;;
esac
STUB
chmod +x "$tmp/bin/xcrun"
printf '#!/usr/bin/env bash\necho /Applications/Xcode.app/Contents/Developer\n' >"$tmp/bin/xcode-select"
chmod +x "$tmp/bin/xcode-select"
printf '#!/usr/bin/env bash\necho "codesign $*" >>"%s/log"\nexit 1\n' "$tmp" >"$tmp/bin/codesign"
chmod +x "$tmp/bin/codesign"

# A checkout named like a worktree, so the default Duo name is predictable.
repo="$tmp/wt-x"
mkdir -p "$repo/scripts/lib"
cp "$repo_root/scripts/ios-pose.sh" "$repo/scripts/"
cp "$repo_root/scripts/lib/ios-sim.sh" "$repo/scripts/lib/"
cp "$repo_root/scripts/lib/ios-pose-helper.m" "$repo/scripts/lib/"
git init -q "$repo"

# The helper ios-pose.sh would build, already in its cache under the same key.
key="$( (cat "$repo/scripts/lib/ios-pose-helper.m"; PATH="$tmp/bin:$PATH" xcode-select -p) | shasum | cut -c1-12)"
mkdir -p "$tmp/cache/omnibus-ios-pose"
touch "$tmp/cache/omnibus-ios-pose/ios-pose-helper-$key"
chmod +x "$tmp/cache/omnibus-ios-pose/ios-pose-helper-$key"

pose() {
    : >"$tmp/log"
    PATH="$tmp/bin:$PATH" XDG_CACHE_HOME="${POSE_CACHE:-$tmp/cache}" OMNIBUS_IOS_POSE_TIMEOUT="${POSE_TIMEOUT:-1}" \
        env -u OMNIBUS_IOS_POSE_UDID bash "$repo/scripts/ios-pose.sh" "$@" 2>"$tmp/err"
}

# shellcheck source=../lib/ios-sim.sh
source "$repo/scripts/lib/ios-sim.sh"
: >"$tmp/log"
udid="$(PATH="$tmp/bin:$PATH" ios_sim_ensure_duo omnibus-tests-x-duo 2>/dev/null)" \
    || fail "ios_sim_ensure_duo failed"
[ "$udid" = CREATED ] || fail "expected a new Duo, got '$udid'"
grep -qx "simctl create omnibus-tests-x-duo com.apple.CoreSimulator.SimDeviceType.iPhone-Duo com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4" "$tmp/log" \
    || fail "Duo created wrong: $(grep create "$tmp/log")"
echo "PASS: ios_sim_ensure_duo creates the Duo on its own runtime, past one with no version"

pose -d DUO hinge 200 && fail "hinge 200 succeeded"
grep -q "from 0 to 180" "$tmp/err" || fail "hinge 200 said: $(cat "$tmp/err")"
grep -q "spawn.* hinge" "$tmp/log" && fail "hinge 200 reached the simulator"
echo "PASS: an out-of-range hinge angle never reaches the simulator"

pose -d DUO rotate landscape-left || fail "Duo rotate failed: $(cat "$tmp/err")"
grep -q "devicectl device orientation set" "$tmp/log" && fail "Duo rotate used devicectl"
pose -d DUO rotate portrait-upside-down || fail "Duo upside-down failed: $(cat "$tmp/err")"
grep -q "orient pud$" "$tmp/log" || fail "upside-down was not sent as pud: $(cat "$tmp/log")"
echo "PASS: a Duo rotates through Device Hub's orientation event"

pose -d PLAIN rotate landscape-right || fail "plain rotate failed: $(cat "$tmp/err")"
grep -q "orient " "$tmp/log" && fail "plain rotate sent the Duo event"
echo "PASS: a plain iPhone rotates through devicectl"

pose -d PLAIN rotate sideways && fail "rotate sideways succeeded"
grep -q "orientation must be" "$tmp/err" || fail "rotate sideways said: $(cat "$tmp/err")"
echo "PASS: an unknown orientation is refused"

# An empty cache and a compiler that fails: nothing may reach the simulator.
mkdir -p "$tmp/empty"
for args in "-d DUO show" "-d DUO rotate landscape-left" "-d PLAIN rotate landscape-left" "-d DUO open"; do
    # shellcheck disable=SC2086 # the words are the command line
    POSE_CACHE="$tmp/empty" pose $args >/dev/null && fail "$args succeeded without a helper"
    grep -q "could not build the helper" "$tmp/err" || fail "$args without a helper said: $(cat "$tmp/err")"
    grep -qE "devicectl device orientation set|simctl spawn" "$tmp/log" && fail "$args reached the simulator: $(cat "$tmp/log")"
done
[ -z "$(ls -A "$tmp/empty/omnibus-ios-pose")" ] || fail "a failed build left files: $(ls -A "$tmp/empty/omnibus-ios-pose")"
echo "PASS: a helper that will not build stops the command before the simulator"

touch "$tmp/clang-ok"
POSE_CACHE="$tmp/empty" pose -d PLAIN rotate landscape-left && fail "rotate succeeded with an unsigned helper"
grep -q "could not sign the helper" "$tmp/err" || fail "unsigned helper said: $(cat "$tmp/err")"
grep -q "devicectl device orientation set" "$tmp/log" && fail "rotate turned the simulator with an unsigned helper"
[ -z "$(ls -A "$tmp/empty/omnibus-ios-pose")" ] || fail "a failed signing left files: $(ls -A "$tmp/empty/omnibus-ios-pose")"
rm "$tmp/clang-ok"
echo "PASS: a helper that will not sign stops the command before the simulator"

POSE_CACHE="$tmp/empty" pose -d PLAIN rotate sideways && fail "rotate sideways succeeded"
grep -q "orientation must be" "$tmp/err" || fail "rotate sideways on an empty cache said: $(cat "$tmp/err")"
POSE_CACHE="$tmp/empty" pose -d DUO hinge 200 && fail "hinge 200 succeeded"
grep -q "from 0 to 180" "$tmp/err" || fail "hinge 200 on an empty cache said: $(cat "$tmp/err")"
grep -q "clang" "$tmp/log" && fail "a bad argument built the helper"
echo "PASS: a bad argument is refused before the helper is built"

for bad in 0 0700 +5 601 8s; do
    POSE_TIMEOUT="$bad" pose -d PLAIN rotate landscape-left && fail "timeout $bad was accepted"
    grep -q "from 1 to 600" "$tmp/err" || fail "timeout $bad said: $(cat "$tmp/err")"
done
POSE_TIMEOUT=600 pose -d PLAIN rotate portrait || fail "timeout 600 was refused: $(cat "$tmp/err")"
POSE_TIMEOUT=bad pose -d DUO screenshot "$tmp/shot.png" && fail "screenshot succeeded with no display"
grep -q "reports no integrated display" "$tmp/err" || fail "screenshot checked the timeout: $(cat "$tmp/err")"
echo "PASS: the timeout must be 1–600 and only commands that wait check it"

pose show && fail "show ran without a device"
grep -q "sim up --duo" "$tmp/err" || fail "no-device error said: $(cat "$tmp/err")"
echo "PASS: a worktree without a Duo is told how to make one"

pose -d DUO screenshot "$tmp/shot.png" && fail "screenshot succeeded with no display"
grep -q "reports no integrated display" "$tmp/err" || fail "displayless screenshot said: $(cat "$tmp/err")"
echo "PASS: a screenshot with no display to read says so"

cat >"$tmp/devices.json" <<'JSON'
{"devices": {
  "com.apple.CoreSimulator.SimRuntime.iOS-27-1-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "STALE", "state": "Shutdown"}],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "DUO", "state": "Booted"}]
}}
JSON
pose rotate landscape-left || fail "rotate on the worktree's Duo failed: $(cat "$tmp/err")"
grep -q "spawn STALE" "$tmp/log" && fail "picked the shut-down Duo"
echo "PASS: a booted Duo wins over a stale one of the same name"

cat >"$tmp/runtimes.json" <<'JSON'
{"runtimes": [
  {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4", "version": "27.2"},
  {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-1-iPhone19-4", "version": "27.1"}
]}
JSON
cat >"$tmp/devices.json" <<'JSON'
{"devices": {
  "com.apple.CoreSimulator.SimRuntime.iOS-27-1-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "OLDER", "state": "Booted"}],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "DUO", "state": "Booted"}]
}}
JSON
pose rotate landscape-left || fail "rotate with two booted Duos failed: $(cat "$tmp/err")"
grep -q "spawn OLDER" "$tmp/log" && fail "picked the older runtime's Duo"
echo "PASS: of two booted Duos, the newest runtime's wins"

cat >"$tmp/devices.json" <<'JSON'
{"devices": {
  "com.apple.CoreSimulator.SimRuntime.iOS-27-1-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "DUO", "state": "Booted"}],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "NEWER", "state": "Shutdown"}]
}}
JSON
pose rotate landscape-left || fail "rotate with a shut-down newer Duo failed: $(cat "$tmp/err")"
grep -q "spawn DUO" "$tmp/log" || fail "did not pick the booted Duo: $(cat "$tmp/log")"
echo "PASS: a booted Duo on an older runtime wins over a shut-down newer one"

cat >"$tmp/runtimes.json" <<'JSON'
{"runtimes": [
  {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4", "version": "27.2", "isAvailable": false},
  {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-1-iPhone19-4", "version": "27.1"}
]}
JSON
cat >"$tmp/devices.json" <<'JSON'
{"devices": {
  "com.apple.CoreSimulator.SimRuntime.iOS-27-1-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "DUO", "state": "Booted"}],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4": [
    {"name": "omnibus-tests-wt-x-duo", "udid": "GONE", "state": "Booted", "isAvailable": false}]
}}
JSON
pose rotate landscape-left || fail "rotate beside an unavailable Duo failed: $(cat "$tmp/err")"
grep -q "spawn GONE" "$tmp/log" && fail "picked the unavailable Duo"
echo "PASS: a Duo on an unavailable runtime never counts"
