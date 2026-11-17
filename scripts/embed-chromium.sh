#!/usr/bin/env bash
# Puts the Chrome build inside the Mac app (Contents/Resources/Chromium Extension), where the app's
# "Add to <browser>" button points people, then re-seals the app with the given identity.
# Usage: sh scripts/embed-chromium.sh "<path to .app>" "<signing identity>"
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
APP="${1:?Usage: embed-chromium.sh <app> <signing identity>}"
IDENTITY="${2:?Usage: embed-chromium.sh <app> <signing identity>}"
DEST="$APP/Contents/Resources/Chromium Extension"
rm -rf "$DEST"
ditto .output/chrome-mv3 "$DEST"
# The Safari extension inside keeps its own signature; only the outer app's seal changes.
codesign --force --timestamp --options runtime --preserve-metadata=entitlements,requirements,flags --sign "$IDENTITY" "$APP"
