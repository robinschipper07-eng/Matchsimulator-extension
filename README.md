# Match Simulator Club Logos (private)

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
   "Access your data for sites in the matchsimulator.com domain" plus the wikipedia / wikidata / thesportsdb sites.
4. A temporary add-on is removed when Firefox closes. For a permanent install, sign it (free, "unlisted") at
   https://addons.mozilla.org/developers/ using `dist/club-logos-firefox.zip`, then install the signed .xpi.
   (Firefox Developer Edition / Nightly can also load unsigned add-ons permanently with `xpinstall.signatures.required` = false.)

## Phones and tablets
The extension works with touch: there is no Alt key, so **long-press** (hold about 0.6 seconds) a crest, the manager line,
the stadium, the referee or a captain armband to correct it. A round gear button (bottom left) opens the settings panel
(reset all logos, on/off, export/import).

- **Android, Firefox:** install Firefox (release, Beta or Nightly), open Settings > About > tap the logo 5 times to enable the debug menu,
  then Settings > "Install add-on from file" and choose `club-logos-firefox.zip` renamed to `.xpi` (it must be signed for the release version,
  see the Firefox section above; Nightly/Developer builds accept unsigned add-ons). Then allow the site access in the add-on's permissions.
- **Android, Kiwi Browser (or other Chromium browsers that allow extensions):** open `kiwi://extensions`, enable Developer mode,
  and load `club-logos-chrome.zip` ("+(from .zip/.crx/.user.js)").
- **Chrome for Android and Samsung Internet:** do not support extensions.
- **iPhone / iPad:** Safari needs an app wrapper (Xcode on a Mac: `xcrun safari-web-extension-converter` on the extension folder);
  it cannot be installed from a zip.

## Updating the extension

Replace the files (or load the new zip) and reload the extension. Chrome / Edge / Brave then
reload every open matchsimulator.com tab by themselves, and the extension starts the VAR data
from scratch for the new version, so nothing from an older version stays wrong.
Your own corrections (logos, managers, stadiums, captains) are kept.

There is no automatic download of new versions: a private extension has no update server.
In Firefox the same reload happens, but only if you granted the site permission in about:addons.
