# Installing Dayfold on a Mac

Dayfold is a free macOS app for planning your day. It works on **Apple Silicon and Intel Macs running
macOS 12 (Monterey) or newer**, and everything it stores stays on your Mac.

> **Why is there an extra step?** Apple only waives its security warning for apps from developers who
> pay for an Apple Developer account and submit each app for "notarization". Dayfold is a free,
> open-source project without one, so macOS shows a warning the first time you open it. The app is
> not damaged and nothing is wrong with it: you just have to tell your Mac that you trust it. You do
> this **once per install**. The code is public, so you can read it or build it yourself (see
> [Build it yourself](#build-it-yourself)).

## 1. Download

1. Go to the [latest release](https://github.com/crstnmac/Dayfold/releases/latest).
2. Download **`Dayfold-<version>-universal.dmg`**. The same file works on every supported Mac.

Optional: check the download was not corrupted. Download `SHA256SUMS.txt` into the same folder, then
run this in Terminal:

```bash
cd ~/Downloads && shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

You should see `Dayfold-<version>-universal.dmg: OK`.

## 2. Install

1. Double-click the `.dmg` to open it.
2. Drag **Dayfold** onto the **Applications** folder.
3. Eject the disk image (right-click it in Finder, then Eject).

## 3. Open it for the first time

Open **Dayfold** from Applications (or Spotlight). macOS will refuse the first time, with a message
like _"Dayfold cannot be opened because Apple cannot check it for malicious software"_. Pick the
method for your macOS version.

### macOS 15 Sequoia and newer (and the most reliable way on any version)

1. Try to open Dayfold once. When the warning appears, click **Done** (not "Move to Bin").
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the **Security** section. You will see _"Dayfold" was blocked to protect your Mac_.
4. Click **Open Anyway**, then enter your password or use Touch ID.
5. Click **Open** in the final prompt.

The **Open Anyway** button only stays for about an hour after your attempt. If you do not see it,
try opening Dayfold again first.

### macOS 14 Sonoma and older

1. In Finder, open **Applications**.
2. **Right-click** (or Control-click) **Dayfold** and choose **Open**.
3. Click **Open** in the dialog. The extra **Open** button only appears when you right-click.

### Using Terminal (works everywhere)

If you are comfortable with Terminal, this removes the "downloaded from the internet" flag so macOS
stops blocking the app:

```bash
xattr -dr com.apple.quarantine /Applications/Dayfold.app
open /Applications/Dayfold.app
```

From now on Dayfold opens normally, like any other app.

### Troubleshooting the first launch

| You see                                         | What to do                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| _"Dayfold is damaged and can't be opened"_      | Use the **Terminal** method above. It clears the flag that triggers this message.                                                          |
| No **Open Anyway** button in Privacy & Security | Try to open the app again, then go back to Privacy & Security. The button appears after a blocked attempt and expires after about an hour. |
| The app bounces in the Dock and quits           | Make sure it is in **Applications** (not running from the disk image), and that your Mac is on macOS 12 or newer.                          |
| You are on a work or school Mac                 | An administrator may have disabled "Open Anyway". Ask them to allow the app, or use a personal Mac.                                        |

## 4. Optional: turn on Activity tracking

Dayfold's **Activity** tab shows where your time goes. It is **off by default**, and you decide
whether to switch it on.

1. Open the **Activity** tab and turn **Tracking** on.
2. To also record window titles and the sites you visit (not only app names), allow Dayfold under
   **System Settings → Privacy & Security → Accessibility**: switch **Dayfold** on, or click **+** and
   choose `/Applications/Dayfold.app`.

Dayfold never reads field contents or page text, skips private-browsing windows and banking and
password sites, and excludes password managers by default. Without the Accessibility permission only
app names are tracked. The change takes effect without restarting.

## Updating

Dayfold does not update itself yet.

1. Download the new `.dmg` from the [releases page](https://github.com/crstnmac/Dayfold/releases).
2. Quit Dayfold, then drag the new app into **Applications** and choose **Replace**.
3. Allow it again on first launch (step 3 above).
4. If tracking stops showing window titles or sites, macOS has tied its Accessibility approval to the
   old copy. In **Accessibility**, select **Dayfold**, click **−**, then add it again with **+**.

Your tasks, projects and history are kept when you update.

## Where your data lives

Everything is stored locally in `~/Library/Application Support/dash`. That folder holds the database
and the daily backups (the last 14). Nothing is uploaded anywhere. In the app, **Settings** lets you
back up, restore, export to JSON or Markdown, or delete all data.

## Uninstall

1. Quit Dayfold and drag **Dayfold** from Applications to the Bin.
2. Optional, to remove your data too: delete `~/Library/Application Support/dash`.
3. Optional: remove Dayfold from **System Settings → Privacy & Security → Accessibility**.

## Build it yourself

If you would rather not trust a download, build the app from the source. You need macOS, Xcode
Command Line Tools (`xcode-select --install`) and Node.js 22.

```bash
git clone https://github.com/crstnmac/Dayfold.git
cd Dayfold
npm ci
npm run build:mac:unsigned
```

The app and `.dmg` appear in `dist/`. An app you build on your own Mac is not quarantined, so it
opens without the warning.

## For maintainers: publishing a release

The [Release workflow](../.github/workflows/release.yml) builds the universal `.dmg` and `.zip`,
signs them ad hoc (so the app launches on Apple Silicon), and attaches them to a GitHub Release.

```bash
# 1. bump "version" in package.json, commit it, then:
git tag v1.0.1
git push origin main v1.0.1
```

The tag must match `package.json`. To only build and download the files without publishing, run the
workflow by hand from the **Actions** tab and take the **Dayfold-macOS** artifact.

If you ever get an Apple Developer ID, signing and notarizing is described in [RELEASE.md](RELEASE.md).
That removes the first-launch warning for everyone.
