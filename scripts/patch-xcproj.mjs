// Applies package-safari.sh's project edits to the project.xcproj format that Xcode 27's
// safari-web-extension-packager writes in place of project.pbxproj.
// Usage: node scripts/patch-xcproj.mjs <project.xcproj> <bundle id> <version>
import fs from 'node:fs';
import path from 'node:path';

const [file, appId, version] = process.argv.slice(2);
const root = path.dirname(path.dirname(file));
// This format turns no sandbox settings into entitlements, and Safari only loads sandboxed
// extensions, so they're written out: the sandbox, and outgoing network for the app's window.
const entitlements = (keys) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${keys.map((k) => `\t<key>${k}</key>\n\t<true/>\n`).join('')}</dict>\n</plist>\n`;
// JSON with trailing commas.
const project = JSON.parse(fs.readFileSync(file, 'utf8').replace(/,(\s*[\]}])/g, '$1'));

project['build-settings'].MACOSX_DEPLOYMENT_TARGET = '12.0';
for (const target of project.targets) {
  const s = target['build-settings'];
  const extension = target['product-type'] === 'app-extension';
  s.PRODUCT_BUNDLE_IDENTIFIER = extension ? `${appId}.Extension` : appId;
  s.MARKETING_VERSION = version;
  s.INFOPLIST_KEY_NSHumanReadableCopyright = 'Not affiliated with Google. Gmail is a trademark of Google LLC.';
  if ('MACOSX_DEPLOYMENT_TARGET' in s) s.MACOSX_DEPLOYMENT_TARGET = '12.0';
  delete s.ENABLE_USER_SELECTED_FILES;
  const keys = ['com.apple.security.app-sandbox'];
  if (s.ENABLE_OUTGOING_NETWORK_CONNECTIONS === 'YES') keys.push('com.apple.security.network.client');
  const plist = `${target.name}/${target.name}.entitlements`;
  fs.writeFileSync(path.join(root, plist), entitlements(keys));
  s.CODE_SIGN_ENTITLEMENTS = plist;
  if (extension) {
    s.PROVISIONING_PROFILE_REQUIRED = 'YES';
  } else {
    s.INFOPLIST_KEY_LSApplicationCategoryType = 'public.app-category.productivity';
    s.INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = 'NO';
  }
}

// The Icon Composer document next to the asset catalog (add-app-icon.mjs copies the folder in).
const app = project.files.find((f) => f.kind === 'group' && f.path === 'Expressive Gmail');
if (!app.children.some((f) => f.path === 'AppIcon.icon')) {
  const at = app.children.findIndex((f) => f.path === 'Assets.xcassets');
  app.children.splice(at + 1, 0, { path: 'AppIcon.icon', 'target-membership': ['Expressive Gmail/resources'] });
}

fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
