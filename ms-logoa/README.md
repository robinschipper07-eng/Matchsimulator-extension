# Match Simulator Club Logos (public)

Works on Windows, macOS and Linux, in Google Chrome (and other Chromium browsers such as Edge/Brave) and Firefox.
Same code for both; only the manifest differs (`manifest.json` = Chrome, `manifest.firefox.json` = Firefox).

## Build (optional)
- Windows: run `build.ps1` (PowerShell). Others: `./build.sh`.
- Result: `dist/chrome`, `dist/firefox` and a .zip of each.

## Google Chrome / Edge / Brave
1. Open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**.
2. **Load unpacked** and choose this folder (or `dist/chrome`).
3. After changing files, press the reload icon on the extension, then refresh matchsimulator.com.

## Firefox (Windows/macOS/Linux)
1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on...** and choose `manifest.json` inside `dist/firefox` (the Firefox build).
3. Firefox does not grant site access automatically: open `about:addons` > the extension > **Permissions** and turn on
   "Access your data for sites in the matchsimulator.com domain" plus the wikipedia / thesportsdb / fminside sites.
4. A temporary add-on is removed when Firefox closes. For a permanent install, sign it (free, "unlisted") at
   https://addons.mozilla.org/developers/ using `dist/club-logos-firefox.zip`, then install the signed .xpi.
   (Firefox Developer Edition / Nightly can also load unsigned add-ons permanently with `xpinstall.signatures.required` = false.)
