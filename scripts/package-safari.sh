#!/bin/sh
# Builds the Safari extension and wraps it in a macOS app with Apple's packager.
# The packager derives inconsistent bundle ids, so they're pinned afterwards.
# Set BUNDLE_ID to your own reverse-DNS id (the extension gets BUNDLE_ID.Extension).
set -e
APP_ID="${BUNDLE_ID:-com.example.bettergmail}"
npx wxt build -b safari --mv3
xcrun safari-web-extension-packager .output/safari-mv3 \
  --project-location safari --app-name "Expressive Gmail" --bundle-identifier "$APP_ID" \
  --swift --macos-only --copy-resources --no-open --no-prompt --force >/dev/null
PBX="safari/Expressive Gmail/Expressive Gmail.xcodeproj/project.pbxproj"
sed -i '' -E "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*Extension[^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $APP_ID.Extension;/" "$PBX"
sed -i '' -E "/Extension;/!s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $APP_ID;/" "$PBX"
# Automatic signing skips the extension's App ID and profile on macOS unless asked; the App Store wants both.
sed -i '' -E "s/(PRODUCT_BUNDLE_IDENTIFIER = $APP_ID\.Extension;)/\1\\
				PROVISIONING_PROFILE_REQUIRED = YES;/" "$PBX"
grep -rl "extensionBundleIdentifier\|\.Extension\"" "safari/Expressive Gmail/Expressive Gmail" 2>/dev/null | while read -r f; do
  sed -i '' -E "s/\"[A-Za-z0-9.-]+\.Extension\"/\"$APP_ID.Extension\"/" "$f"
done
# What the Mac App Store reads from the app's Info.plist: its category, the export compliance answer
# (only HTTPS through the system, which is exempt), the copyright line and the version from package.json.
VERSION=$(node -p "require('./package.json').version")
sed -i '' -E "s/INFOPLIST_KEY_NSPrincipalClass = NSApplication;/INFOPLIST_KEY_NSPrincipalClass = NSApplication;\\
				INFOPLIST_KEY_LSApplicationCategoryType = \"public.app-category.productivity\";\\
				INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;/" "$PBX"
sed -i '' -E "s/INFOPLIST_KEY_NSHumanReadableCopyright = \"\";/INFOPLIST_KEY_NSHumanReadableCopyright = \"Not affiliated with Google. Gmail is a trademark of Google LLC.\";/; s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/" "$PBX"
# The packager targets the running macOS; the app runs from Monterey like its extension (and the Homebrew cask).
# It never opens files, so it doesn't ask for the sandbox's user-selected files access the template adds.
sed -i '' -E "s/MACOSX_DEPLOYMENT_TARGET = [0-9.]+;/MACOSX_DEPLOYMENT_TARGET = 12.0;/; /ENABLE_USER_SELECTED_FILES = readonly;/d" "$PBX"
# The app's own window (safari-app/): a browser picker, the new Gmail switch and Safari's extension state.
APP="safari/Expressive Gmail/Expressive Gmail"
cp safari-app/ViewController.swift "$APP/ViewController.swift"
cp safari-app/Main.html "$APP/Resources/Base.lproj/Main.html"
cp safari-app/Script.js "$APP/Resources/Script.js"
# The app icon: an Icon Composer document in place of the packager's flat PNGs.
node scripts/add-app-icon.mjs "$APP" "$PBX"
# Motion and shape tokens from the extension's first :root block, then the window's own styles.
{ awk '/^:root \{/{on=1} on{print} on&&/^\}/{exit}' src/app/theme/tokens.css; cat safari-app/Style.css; } > "$APP/Resources/Style.css"
sed -i '' -E 's/width="425" height="325"/width="440" height="460"/g' "$APP/Base.lproj/Main.storyboard"
echo "Safari project ready: safari/Expressive Gmail/Expressive Gmail.xcodeproj"
