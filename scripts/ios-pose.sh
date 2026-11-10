#!/usr/bin/env bash
# Fold, open and rotate a booted iOS simulator from a script, and shoot the
# screen that hosts its UI. The iPhone Duo's pose otherwise changes only by hand
# in Device Hub; this posts the same events from inside the simulator
# (scripts/lib/ios-pose-helper.m), so agents never need a person to unfold it.
#
# Usage: ios-pose.sh [-d <udid>] <command>
#   open | close | half       hinge to 180° (flat), 0° (closed), 90°  — Duo only
#   hinge <degrees>           any angle from 0 to 180                 — Duo only
#   rotate <orientation>      portrait, landscape-left, landscape-right or
#                             portrait-upside-down; waits until the device
#                             reports it
#   show                      hinge angle, orientation and active display
#   screenshot <file.png>     the display hosting the UI (the Duo's inner one
#                             when open, its cover when closed)
#
# Device: -d, else $OMNIBUS_IOS_POSE_UDID, else this worktree's Duo from
# `scripts/ios-validate.sh sim up --duo`. Every change is confirmed: the hinge
# by CoreMotion's reading, a rotation by devicectl's, so a zero exit means the
# simulator is in that pose. Needs jq and system Xcode (xcrun, devicectl).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
HELPER_SRC="$HERE/lib/ios-pose-helper.m"
HELPER_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/omnibus-ios-pose"
# Seconds a change may take to show up before it counts as failed.
TIMEOUT="${OMNIBUS_IOS_POSE_TIMEOUT:-8}"

# shellcheck source=lib/ios-sim.sh
source "$HERE/lib/ios-sim.sh"

die() {
  echo "ios-pose: $*" >&2
  exit 1
}

UDID="${OMNIBUS_IOS_POSE_UDID:-}"
if [ "${1:-}" = "-d" ]; then
  UDID="${2:?ios-pose: -d needs a simulator udid}"
  shift 2
fi

resolve_udid() {
  if [ -z "$UDID" ]; then
    UDID="$(ios_sim_find_preferred "$(ios_sim_duo_name "$ROOT")")"
    [ -n "$UDID" ] || die "no simulator given and this worktree has no Duo — run \`scripts/ios-validate.sh sim up --duo\` or pass -d <udid>"
  fi
  xcrun simctl list --json devices | jq -e --arg u "$UDID" \
    '[.devices[][] | select(.udid == $u and .state == "Booted")] | length > 0' >/dev/null ||
    die "simulator $UDID is not booted (xcrun simctl boot $UDID)"
}

# Built once per helper source and Xcode, outside the nix shell's compiler.
# Never call it in a command substitution: its die must exit the script.
HELPER_BIN=""
ensure_helper() {
  [ -z "$HELPER_BIN" ] || return 0
  local key bin tmp
  key="$( (cat "$HELPER_SRC"; xcode-select -p) | shasum | cut -c1-12)"
  bin="$HELPER_CACHE/ios-pose-helper-$key"
  if [ ! -x "$bin" ]; then
    # Built under a private name and renamed in, so a concurrent build in another
    # worktree never leaves a half-written binary at $bin.
    mkdir -p "$HELPER_CACHE"
    tmp="$(mktemp "$HELPER_CACHE/.build.XXXXXX")"
    if ! env -u LD -u CC -u CXX -u SDKROOT xcrun -sdk iphonesimulator clang -arch arm64 \
      -mios-simulator-version-min=17.0 -O2 -fobjc-arc -o "$tmp" "$HELPER_SRC" \
      -framework IOKit -framework Foundation -framework CoreMotion >&2; then
      rm -f "$tmp"
      die "could not build the helper"
    fi
    if ! chmod 755 "$tmp" || ! codesign -f -s - "$tmp" >/dev/null 2>&1; then
      rm -f "$tmp"
      die "could not sign the helper"
    fi
    mv -f "$tmp" "$bin"
  fi
  HELPER_BIN="$bin"
}

run_helper() {
  ensure_helper
  xcrun simctl spawn "$UDID" "$HELPER_BIN" "$@"
}

set_hinge() {
  local degrees="$1"
  if ! [[ "$degrees" =~ ^[0-9]+([.][0-9]+)?$ ]] || ! awk -v d="$degrees" 'BEGIN { exit !(d <= 180) }'; then
    die "hinge angle must be a number from 0 to 180: $degrees"
  fi
  run_helper hinge "$degrees" "$TIMEOUT"
  wait_display "$degrees"
}

# The UI moves between displays 1–3 s after the hinge reports its angle.
# Closed (0°) must land on the cover (primary) and flat (180°) on the inner
# display, held for a second; any other angle has no known display, so it must
# hold still past that lag (7 half-second samples) before it counts.
wait_display() {
  local want=any last="" now stable=0 hold=2 deadline=$((SECONDS + TIMEOUT))
  awk -v d="$1" 'BEGIN { exit !(d == 0) }' && want=true
  awk -v d="$1" 'BEGIN { exit !(d == 180) }' && want=false
  if [ "$want" = any ]; then
    hold=7
    deadline=$((deadline + 8))
  fi
  while [ "$SECONDS" -le "$deadline" ]; do
    # A failed read is retried, not fatal: devicectl drops the odd call.
    now="$(xcrun devicectl device info displays -d "$UDID" -q -j - 2>/dev/null | jq -r '
      [.result.displays[]? | select(.type.integrated != null and .active == true)] | first
      | if . == null then "none" else "\(.name):\(.primary)" end')" || now=none
    if [ "$now" = "$last" ] && [ "$now" != none ] &&
      { [ "$want" = any ] || [ "${now##*:}" = "$want" ]; }; then
      stable=$((stable + 1))
      [ "$stable" -ge "$hold" ] && return 0
    else
      stable=0
    fi
    last="$now"
    sleep 0.5
  done
  die "the hinge moved to $1° but the UI never settled on a display (last saw ${last:-nothing})"
}

# devicectl's name for an orientation (landscapeLeft), from ours (landscape-left).
devicectl_orientation() {
  case "$1" in
    portrait) echo portrait ;;
    landscape-left) echo landscapeLeft ;;
    landscape-right) echo landscapeRight ;;
    portrait-upside-down) echo portraitUpsideDown ;;
    *) return 1 ;;
  esac
}

orientation() {
  xcrun devicectl device orientation get -d "$UDID" -q -j - 2>/dev/null |
    jq -r '.result.deviceOrientationNonFlat // .result.deviceOrientation // "unknown"'
}

wait_orientation() {
  local want="$1" deadline=$((SECONDS + TIMEOUT))
  while [ "$SECONDS" -le "$deadline" ]; do
    [ "$(orientation)" = "$want" ] && return 0
    sleep 0.5
  done
  return 1
}

# A foldable follows only Device Hub's orientation event and ignores devicectl;
# other iPhones are the other way round. Having a hinge is what tells them apart.
rotate() {
  local want event="$1"
  want="$(devicectl_orientation "$1")" ||
    die "orientation must be portrait, landscape-left, landscape-right or portrait-upside-down: $1"
  ensure_helper # here, where a build failure is heard, not under the probe's 2>/dev/null
  if run_helper angle >/dev/null 2>&1; then
    [ "$event" = portrait-upside-down ] && event=pud
    run_helper orient "$event"
  else
    xcrun devicectl device orientation set "$want" -d "$UDID" -q >/dev/null 2>&1 || true
  fi
  wait_orientation "$want" || die "the simulator did not turn to $1 (it reports $(orientation))"
}

# The integrated display whose `active` flag is set: a folded Duo keeps its
# inner backlight on for a moment, so the backlight is not the signal.
active_display() {
  xcrun devicectl device info displays -d "$UDID" -q -j - 2>/dev/null | jq -r '
    [.result.displays[]? | select(.type.integrated != null)] as $d
    | (($d | map(select(.active == true)) | first) // ($d | first) // {}) | .name // empty'
}

show() {
  local angle
  ensure_helper # in this shell: the substitution below would swallow a build failure
  angle="$(run_helper angle 2>/dev/null)" || angle="none"
  echo "hinge=$angle orientation=$(orientation) display=$(active_display)"
}

screenshot() {
  local file="${1:?usage: ios-pose.sh screenshot <file.png>}" display out
  display="$(active_display)" || display=""
  [ -n "$display" ] || die "the simulator reports no integrated display"
  out="$(xcrun simctl io "$UDID" screenshot --display="$display" "$file" 2>&1)" || die "screenshot failed: $out"
  echo "$file ($display)"
}

command="${1:-}"
[ -n "$command" ] || die "usage: ios-pose.sh [-d <udid>] open|close|half|hinge <deg>|rotate <orientation>|show|screenshot <file> (see the header)"
resolve_udid
case "$command" in
  open) set_hinge 180 ;;
  close) set_hinge 0 ;;
  half) set_hinge 90 ;;
  hinge) set_hinge "${2:?usage: ios-pose.sh hinge <degrees>}" ;;
  rotate) rotate "${2:?usage: ios-pose.sh rotate <orientation>}" ;;
  show) show ;;
  screenshot) screenshot "${2:-}" ;;
  *) die "unknown command '$command' (see the header)" ;;
esac
