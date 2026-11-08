# Third-party notices

Expressive Gmail's own code is under the [MIT License](LICENSE). The extension bundles the following work by others, each under its own license.

## Fonts (shipped in `public/fonts/`)

| Asset | License | Notice |
| --- | --- | --- |
| Google Sans Flex, subset to latin and latin-ext by `scripts/build_fonts.py` (from `@fontsource-variable/google-sans-flex`) | SIL Open Font License 1.1 | Copyright 2015 The Google Sans Flex Authors. Full text in `public/fonts/OFL-google-sans-flex.txt` |
| Material Symbols Rounded, subset to the icons in `src/app/ui/icon-names.json` (from `material-symbols`) | Apache License 2.0 | Copyright Google LLC. Full text in `public/fonts/LICENSE-material-symbols.txt` |

## Libraries bundled into the extension

| Package | License |
| --- | --- |
| [react](https://github.com/facebook/react), react-dom, scheduler | MIT |
| [@base-ui/react](https://github.com/mui/base-ui), @base-ui/utils | MIT |
| [@floating-ui/core, dom, react-dom, utils](https://github.com/floating-ui/floating-ui) | MIT |
| [@tanstack/react-query](https://github.com/TanStack/query), @tanstack/query-core | MIT |
| [zustand](https://github.com/pmndrs/zustand), use-sync-external-store | MIT |
| [reselect](https://github.com/reduxjs/reselect) | MIT |
| [@babel/runtime](https://github.com/babel/babel) | MIT |
| [@material/material-color-utilities](https://github.com/material-foundation/material-color-utilities) | Apache License 2.0 |
| [material-shapes-ts](https://www.npmjs.com/package/material-shapes-ts) by Ruan Spies, a port of the Material shapes from androidx graphics-shapes | Apache License 2.0 |
| [DOMPurify](https://github.com/cure53/DOMPurify) by Cure53 and contributors | MPL 2.0 or Apache License 2.0, used under Apache 2.0 |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) (PDF.js by Mozilla), loaded only to preview PDFs | Apache License 2.0 |

Each package's full license text is in its folder under `node_modules/` after `npm install`.

## Design tokens

Color, shape, type and motion values in `src/app/theme/` are taken from Google's Material 3 token files in androidx Compose Material 3 (Apache License 2.0). They are values copied into CSS, not Google code.

## Test fixtures (not shipped)

Some Gmail response fixtures in `tests/session/fixtures/` come from the test data of [gmail.js](https://github.com/KartikTalwar/gmail.js) (MIT, Copyright 2014 Kartik Talwar) and [InboxSDK](https://github.com/InboxSDK/InboxSDK) (Apache 2.0 or MIT, Copyright 2014 to present Streak, used under MIT). `tests/session/fixtures/LICENSES.txt` says which files come from where and reproduces the notices. The other fixtures are synthetic.

The session backend (`src/session/`) rebuilds Gmail's request and response shapes from what InboxSDK, gmail.js, crouton-labs/capture and sluice recorded; comments in the source name which project each shape comes from. None of them is a dependency.

## Trademarks

Gmail and Google are trademarks of Google LLC. Expressive Gmail is not affiliated with or endorsed by Google, and it uses its own icon.
