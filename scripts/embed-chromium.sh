#!/bin/sh
# Puts the Chrome build inside the Mac app (Contents/Resources/Chromium Extension), where the app's
# "Add to <browser>" button points people, then re-seals the app with the given identity.
# Usage: sh scripts/embed-chromium.sh "<path to .app>" "<signing identity>"
set -e
APP="$1"
IDENTITY="$2"
DEST="$APP/Contents/Resources/Chromium Extension"
rm -rf "$DEST"
ditto .output/chrome-mv3 "$DEST"
# The Safari extension inside keeps its own signature; only the outer app's seal changes.
codesign --force --timestamp --options runtime --preserve-metadata=entitlements,requirements,flags --sign "$IDENTITY" "$APP"
