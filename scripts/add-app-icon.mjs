// Swaps the packager's flat app icon for safari-app/AppIcon.icon, the Icon Composer document
// (Liquid Glass layers, with its own dark, clear and tinted looks): node scripts/add-app-icon.mjs <app folder> <project.pbxproj>
// Run by scripts/package-safari.sh after it copies the app's sources in.
import fs from 'node:fs';
import path from 'node:path';

const [app, pbx] = process.argv.slice(2);
fs.cpSync('safari-app/AppIcon.icon', path.join(app, 'AppIcon.icon'), { recursive: true });
// Two icons named AppIcon would clash; the .icon one wins.
fs.rmSync(path.join(app, 'Assets.xcassets/AppIcon.appiconset'), { recursive: true, force: true });

const FILE = 'B0B0A1C0000000000000A001';
const BUILD = 'B0B0A1C0000000000000A002';
let text = fs.readFileSync(pbx, 'utf8');
if (!text.includes(FILE)) {
  // Next to the asset catalog, everywhere it's listed: build file, file reference, the app's group and its Resources phase.
  const after = (pattern, line) => {
    const m = text.match(pattern);
    if (!m) throw new Error(`add-app-icon: no ${pattern} in ${pbx}`);
    text = text.replace(m[0], `${m[0]}\n${m[0].match(/^\s*/)[0]}${line}`);
  };
  after(/^\s*\w+ \/\* Assets\.xcassets in Resources \*\/ = \{isa = PBXBuildFile;.*$/m, `${BUILD} /* AppIcon.icon in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE} /* AppIcon.icon */; };`);
  after(/^\s*\w+ \/\* Assets\.xcassets \*\/ = \{isa = PBXFileReference;.*$/m, `${FILE} /* AppIcon.icon */ = {isa = PBXFileReference; lastKnownFileType = folder.iconcomposer.icon; path = AppIcon.icon; sourceTree = "<group>"; };`);
  after(/^\s*\w+ \/\* Assets\.xcassets \*\/,$/m, `${FILE} /* AppIcon.icon */,`);
  after(/^\s*\w+ \/\* Assets\.xcassets in Resources \*\/,$/m, `${BUILD} /* AppIcon.icon in Resources */,`);
  fs.writeFileSync(pbx, text);
}
