#!/bin/sh
# Archives the Safari app for the Mac App Store and uploads it to App Store Connect (or, with
# EXPORT_ONLY=1, writes a signed .pkg to .output/appstore/ for Transporter). Unlike release:mac it
# carries no Chromium extension: the App Store build is the Safari extension and its window.
# Create the app record in App Store Connect first, with the same bundle id.
# Usage: TEAM_ID=XXXXXXXXXX BUNDLE_ID=com.yourname.bettergmail [BUILD_NUMBER=7] [EXPORT_ONLY=1] npm run release:appstore
# Uploading signs in with the Apple ID Xcode has under Settings > Accounts.
set -e
TEAM_ID="${TEAM_ID:?Set TEAM_ID to your Apple developer team id}"
VERSION=$(node -p "require('./package.json').version")
# App Store Connect wants a build number that only goes up; a timestamp always does.
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
OUT=".output/appstore"

sh scripts/package-safari.sh
rm -rf "$OUT"
mkdir -p "$OUT"
ARCHIVE="$OUT/Expressive Gmail.xcarchive"
xcodebuild -project "safari/Expressive Gmail/Expressive Gmail.xcodeproj" -scheme "Expressive Gmail" -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  -allowProvisioningUpdates archive >/dev/null

DESTINATION=upload
[ -n "$EXPORT_ONLY" ] && DESTINATION=export
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT" -allowProvisioningUpdates >/dev/null

if [ -n "$EXPORT_ONLY" ]; then
  echo "Signed package in $OUT. Upload it with Transporter."
else
  echo "Uploaded $VERSION ($BUILD_NUMBER) to App Store Connect. It shows under TestFlight once processed."
fi
