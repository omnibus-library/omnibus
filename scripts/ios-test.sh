#!/usr/bin/env bash
# Run an omnibus-ios test suite (unit | ui | all) against the newest
# available iPhone simulator. Shared by CI (.github/workflows/ios-tests.yml)
# and the local `just ios-test*` recipes so both run the identical invocation.
#
# Usage: ios-test.sh <unit|ui|ui/<TestClass>|all> [extra xcodebuild args...]
#        `ui/<TestClass>` runs one omnibusUITests class (a screenshot tour).
# Env:   OMNIBUS_IOS_RESULTS_DIR  where <suite>.xcresult lands
#                                 (default .claude/runtime/ios-tests)
#        OMNIBUS_IOS_SIM_NAME     name of the dedicated test device, created
#                                 on the newest iPhone runtime when missing
#                                 (default: this worktree's, from
#                                 scripts/lib/ios-sim.sh — omnibus-tests in
#                                 the main checkout and CI)
#        OMNIBUS_IOS_TEST_SIM_UDID
#                                 pin a specific simulator instead. Not
#                                 OMNIBUS_IOS_SIM_UDID on purpose: that pins
#                                 the device `just ios-sim` and the explore
#                                 lane keep signed in, which the UI suite
#                                 would reset.
set -euo pipefail

suite="${1:?usage: ios-test.sh <unit|ui|all> [xcodebuild args...]}"
shift
case "$suite" in
  unit) only=("-only-testing:omnibusTests") ;;
  ui) only=("-only-testing:omnibusUITests") ;;
  ui/?*) only=("-only-testing:omnibusUITests/${suite#ui/}") ;;
  all) only=() ;;
  *)
    echo "ios-test.sh: unknown suite '$suite' (want unit|ui|ui/<TestClass>|all)" >&2
    exit 2
    ;;
esac

# The nix dev shells export LD/CC/CXX for cargo builds; xcodebuild adopts
# $LD as its link driver and raw `ld` rejects the clang-style -Xlinker args,
# so a direnv-loaded shell would fail every link. Neutralize them here —
# xcodebuild picks its own toolchain.
unset LD CC CXX

# Fail with an actionable message rather than a confusing mid-pipeline
# "command not found" from the simulator picker below.
if ! command -v jq >/dev/null 2>&1; then
  echo "ios-test.sh: jq is required (brew install jq, or any nix dev shell)" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/ios-sim.sh
source "$repo_root/scripts/lib/ios-sim.sh"
results_dir="${OMNIBUS_IOS_RESULTS_DIR:-$repo_root/.claude/runtime/ios-tests}"
mkdir -p "$results_dir"
# `ui/<TestClass>` names its bundle `ui-<TestClass>`.
bundle="$results_dir/${suite//\//-}.xcresult"
# xcodebuild refuses to write over an existing result bundle.
rm -rf "$bundle"

sim_name="${OMNIBUS_IOS_SIM_NAME:-$(ios_sim_name "$repo_root")}"
if [ -n "${OMNIBUS_IOS_TEST_SIM_UDID:-}" ]; then
  udid="$OMNIBUS_IOS_TEST_SIM_UDID"
else
  # The suites run on a simulator of their own, never on the iPhone a
  # developer keeps signed in: the UI suite launches every test with
  # --uitest-reset, which wipes the stored server, token and preferences on
  # whatever device it runs against. That used to be harmless because a
  # parallelizable testable ran on a throwaway clone — and the clone's cold
  # boot is exactly what the scheme now avoids (below).
  udid="$(ios_sim_ensure "$sim_name")"
fi

# Boot the destination ourselves and block until SpringBoard is up, so a
# cold simulator's boot lands here rather than inside the suite. XCUITest's
# app-launch timeout is a fixed 60s, and on a GitHub macOS runner a freshly
# booted device took the first launch to 77s even on a green run. `-b` boots
# a shut-down device and is a no-op on one that is already booted.
xcrun simctl bootstatus "$udid" -b

# The UI testable is marked non-parallel in the shared scheme
# (omnibus.xcscheme, `parallelizable = "NO"`), so xcodebuild runs it on this
# pre-booted device instead of cloning it. A clone is a fresh cold boot per
# run, and that is what put the first `XCUIApplication.launch()` past its
# timeout in CI ("Timed out while launching application via Xcode").
exec xcodebuild test \
  -project "$repo_root/omnibus-ios/omnibus.xcodeproj" \
  -scheme omnibus \
  -destination "platform=iOS Simulator,id=$udid" \
  -enableCodeCoverage YES \
  -resultBundlePath "$bundle" \
  ${only[@]+"${only[@]}"} \
  "$@"
