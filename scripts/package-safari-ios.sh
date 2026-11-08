#!/bin/sh
# Builds the Safari extension and wraps it in an iPhone and iPad app with Apple's packager,
# next to the Mac project (scripts/package-safari.sh). Same bundle ids as the Mac app, so the
# App Store can sell both as one. Set BUNDLE_ID to your own reverse-DNS id.
set -e
APP_ID="${BUNDLE_ID:-com.example.bettergmail}"
npx wxt build -b safari --mv3
xcrun safari-web-extension-packager .output/safari-mv3 \
  --project-location safari-ios --app-name "Expressive Gmail" --bundle-identifier "$APP_ID" \
  --swift --ios-only --copy-resources --no-open --no-prompt --force >/dev/null
PBX="safari-ios/Expressive Gmail/Expressive Gmail.xcodeproj/project.pbxproj"
sed -i '' -E "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*Extension[^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $APP_ID.Extension;/" "$PBX"
sed -i '' -E "/Extension;/!s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $APP_ID;/" "$PBX"
# 16.4 is the first iOS whose Safari lets an extension set request headers (how a phone asks for desktop Gmail).
# iPhone and iPad both; the version comes from package.json.
VERSION=$(node -p "require('./package.json').version")
sed -i '' -E "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/IPHONEOS_DEPLOYMENT_TARGET = 16.4;/; s/TARGETED_DEVICE_FAMILY = [^;]*;/TARGETED_DEVICE_FAMILY = \"1,2\";/; s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/" "$PBX"
sed -i '' -E "s/INFOPLIST_KEY_UILaunchStoryboardName = LaunchScreen;/INFOPLIST_KEY_UILaunchStoryboardName = LaunchScreen;\\
				INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;/" "$PBX"
echo "iOS project ready: safari-ios/Expressive Gmail/Expressive Gmail.xcodeproj"
