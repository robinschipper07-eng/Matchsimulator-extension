#!/usr/bin/env bash
# Builds dist/chrome and dist/firefox (+ .zip files) from this folder.
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/chrome dist/firefox
cp background.js content.js dist/chrome/ && cp manifest.json dist/chrome/manifest.json
cp background.js content.js dist/firefox/ && cp manifest.firefox.json dist/firefox/manifest.json
(cd dist/chrome && zip -qr ../club-logos-chrome.zip .)
(cd dist/firefox && zip -qr ../club-logos-firefox.zip .)
echo "Built dist/chrome and dist/firefox"
