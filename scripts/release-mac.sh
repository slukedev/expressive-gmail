#!/usr/bin/env bash
# Builds the Mac app for Homebrew and direct download: the Safari extension inside, the Chrome
# extension in its Resources, signed with Developer ID, notarized and stapled. Writes
# .output/Expressive-Gmail-<version>.zip and fills in packaging/homebrew/Casks/expressive-gmail.rb.
# Usage: TEAM_ID=XXXXXXXXXX BUNDLE_ID=com.yourname.bettergmail [NOTARY_PROFILE=notary] npm run release:mac
# NOTARY_PROFILE is a notarytool keychain profile (xcrun notarytool store-credentials).
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
TEAM_ID="${TEAM_ID:?Set TEAM_ID to your Apple developer team id}"
export BUNDLE_ID="${BUNDLE_ID:?Set BUNDLE_ID to the bundle id in the Homebrew cask}"
NOTARY_PROFILE="${NOTARY_PROFILE:-notary}"
VERSION=$(node -p "require('./package.json').version")
CASK=packaging/homebrew/Casks/expressive-gmail.rb
# Another id would ship as a different app: Safari loses its settings and the cask's zap misses it.
grep -q "Containers/$BUNDLE_ID\"" "$CASK" || { echo "BUNDLE_ID $BUNDLE_ID doesn't match the bundle id in $CASK." >&2; exit 1; }
IDENTITY=$(security find-identity -v -p codesigning | sed -n "s/.*\"\(Developer ID Application: .*($TEAM_ID)\)\"/\1/p" | awk 'NR == 1')
[ -n "$IDENTITY" ] || { echo "No Developer ID Application certificate for team $TEAM_ID in the keychain." >&2; exit 1; }

npx wxt build -b chrome --mv3 >/dev/null
node scripts/check-no-demo.mjs .output/chrome-mv3
sh scripts/package-safari.sh
DD="${TMPDIR:-/tmp}/better-gmail-release"
rm -rf "$DD"
xcodebuild -project "safari/Expressive Gmail/Expressive Gmail.xcodeproj" -scheme "Expressive Gmail" -configuration Release \
  -destination 'platform=macOS' -derivedDataPath "$DD" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$IDENTITY" OTHER_CODE_SIGN_FLAGS=--timestamp \
  ENABLE_HARDENED_RUNTIME=YES CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO PROVISIONING_PROFILE_REQUIRED=NO MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$VERSION" build >/dev/null
APP="$DD/Build/Products/Release/Expressive Gmail.app"
sh scripts/embed-chromium.sh "$APP" "$IDENTITY"
codesign --verify --deep --strict "$APP"

ZIP=".output/Expressive-Gmail-$VERSION.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
# Debug-only entitlements (get-task-allow) are left out above; notarization refuses them.
# Developer ID needs no provisioning profile for the sandbox alone; only the App Store build asks for one.
OUT=$(xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait)
echo "$OUT"
grep -q "status: Accepted" <<<"$OUT" || { echo "Notarization failed. Details: xcrun notarytool log <id> --keychain-profile $NOTARY_PROFILE" >&2; exit 1; }
xcrun stapler staple "$APP"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
# Leave no second copy registered: Safari lists every app bundle that carries the extension.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP" 2>/dev/null || true
rm -rf "$DD"

SHA=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)
sed -i '' -E "s/^  version \".*\"/  version \"$VERSION\"/; s/^  sha256 \".*\"/  sha256 \"$SHA\"/" "$CASK"
echo "Notarized $ZIP"
echo "sha256 $SHA (written to $CASK)"
