# Releasing Dayfold (macOS)

Status: the packaging config is in place and unsigned builds were verified (the packaged app launches,
renders, and finds its helper). **Signing and notarization have not been tested**, because no Developer ID
was available when this was written. Expect to debug the first notarized run.

## One-time setup (Apple Developer account, paid)

1. Enroll in the Apple Developer Program.
2. In Xcode or developer.apple.com create a **Developer ID Application** certificate and install it in your login keychain.
3. Create an **app-specific password** at appleid.apple.com (or an App Store Connect API key).
4. Note your 10-character **Team ID** (developer.apple.com, Membership).

## Build, sign, notarize

```bash
npm ci
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
# Certificate: use the keychain identity automatically, or export a .p12 and set:
# export CSC_LINK=/path/to/DeveloperID.p12 ; export CSC_KEY_PASSWORD=...
# API-key alternative to the three APPLE_* vars: APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER
npm run build:mac
```

`build:mac` builds the universal Swift helper, the app, then universal `.dmg` and `.zip` in `dist/`.
Without a certificate it produces an unsigned build; without the Apple variables it skips notarization.

## Verify

```bash
codesign --verify --deep --strict --verbose=2 dist/mac-universal/Dayfold.app
codesign -dv --entitlements - dist/mac-universal/Dayfold.app/Contents/Resources/bin/ax-tracker   # expect flags=...runtime
spctl --assess --type execute --verbose dist/mac-universal/Dayfold.app   # expect: accepted, source=Notarized Developer ID
xcrun stapler validate dist/Dayfold-*.dmg
```

electron-builder signs `Resources/bin/ax-tracker` with the hardened runtime and `build/entitlements.mac.plist`
(verified with an ad-hoc signature). Test the notarized app on a second Mac: open the DMG, drag to Applications.

## Notes

- Accessibility: the helper needs the Accessibility permission. It is granted to Dayfold (System Settings, Privacy and
  Security, Accessibility). A new signing identity resets that grant.
- Entitlements are the Electron minimum (JIT, unsigned executable memory, dyld env). No Apple Events, camera or mic.
- Icon: `build/icon.icns` is the electron-vite template icon (Electron atom). Replace `build/icon.png`, `build/icon.icns`
  before a public release.
- No auto-update: `publish` is disabled. Add `electron-updater` and a real feed before promising updates.
- Electron 39: `npm audit` flags Electron advisories (webview, popups, protocol handlers) that are only fixed in
  newer majors. Dayfold does not use `<webview>` or popups; plan an upgrade to a supported Electron major.
- Without a Developer ID, the [Release workflow](../.github/workflows/release.yml) publishes an ad-hoc signed, **not
  notarized** DMG, and users approve it once on first launch (see [INSTALL.md](INSTALL.md)). With a Developer ID,
  distribute the notarized DMG instead and the warning goes away.
