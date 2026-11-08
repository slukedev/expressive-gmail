#!/bin/sh
# Builds the Safari app signed with your Apple Development certificate,
# installs it to ~/Applications and launches it once so Safari registers the
# extension. Then enable it in Safari > Settings > Extensions.
# Usage: TEAM_ID=XXXXXXXXXX [BUNDLE_ID=com.yourname.bettergmail] npm run safari:install
set -e
TEAM_ID="${TEAM_ID:?Set TEAM_ID to your Apple developer team id}"
npx wxt build -b chrome --mv3 >/dev/null
sh scripts/package-safari.sh
DD="${TMPDIR:-/tmp}/better-gmail-safari-build"
xcodebuild -project "safari/Expressive Gmail/Expressive Gmail.xcodeproj" -scheme "Expressive Gmail" -configuration Release \
  -destination 'platform=macOS' -derivedDataPath "$DD" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build >/dev/null
BUILT="$DD/Build/Products/Release/Expressive Gmail.app"
IDENTITY=$(codesign -dvv "$BUILT" 2>&1 | sed -n 's/^Authority=//p' | head -1)
sh scripts/embed-chromium.sh "$BUILT" "$IDENTITY"
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Expressive Gmail.app"
cp -R "$DD/Build/Products/Release/Expressive Gmail.app" "$HOME/Applications/"
# Leave no second copy behind: Safari lists every app bundle that carries the extension.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$DD/Build/Products/Release/Expressive Gmail.app" 2>/dev/null || true
rm -rf "$DD"
open "$HOME/Applications/Expressive Gmail.app"
echo "Installed ~/Applications/Expressive Gmail.app. Turn it on in Safari > Settings > Extensions."
