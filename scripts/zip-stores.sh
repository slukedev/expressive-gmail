#!/usr/bin/env bash
# Builds the Chrome Web Store and Firefox Add-ons uploads into .output/: the Chrome zip, the Firefox zip
# and the source zip AMO asks for. Old zips go first, so only this version's are left to upload.
# Usage: npm run zip
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
rm -f .output/expressive-gmail-*.zip .output/expressive-gmail-*.xpi
npx wxt zip --mv3
npx wxt zip -b firefox --mv3
node scripts/check-no-demo.mjs .output/chrome-mv3 .output/firefox-mv3
ls -1 .output/expressive-gmail-*.zip
