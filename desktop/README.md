# AdVoid Desktop

YouTube in a clean standalone window with ad filtering, back-button navigation, and Google sign-in support.

## Download

Grab the latest DMG (macOS) or `Setup *.exe` (Windows) from [Releases](https://github.com/inajaf/you-ads-blocker/releases).
For Windows install steps (SmartScreen bypass), see the [root README](../README.md#desktop-app-windows).

## Install on macOS

### 1. Open an unnotarized build

Public artifacts are not yet signed with a Developer ID certificate or
notarized by Apple. Pick one:

**Right-click → Open (permanent)**
1. Right-click **AdVoid.app** in Finder
2. Select **Open** → click **Open** in the dialog

**Or** remove the quarantine flag in Terminal:

```sh
xattr -dr com.apple.quarantine /path/to/AdVoid.app
```

**Or** go to **System Settings → Privacy & Security**, find the AdVoid message and click **Open Anyway**.

### 2. Move to Applications

Drag **AdVoid.app** into your **Applications** folder.

### 3. Launch

Open AdVoid from Applications (or Spotlight). YouTube loads with ad blocking and desktop navigation enabled.

## First sign-in

Click **Sign in**. AdVoid briefly opens its private supported Chrome window
because Google rejects direct Electron sign-in. Once YouTube authentication is
available, AdVoid imports that local session, closes the temporary window, and
returns you to the same in-app tabs. Cookie values stay on the device and are
never written to logs.

## Features

- **Browser-style tabs** — each tab is its own web view and shares the signed-in session. Open a link in a new tab with **Cmd/Ctrl+click** or **middle-click**; right-click a link for a native menu (**Open in New Tab**, **Copy Link Address**, **Back**/**Forward**/**Reload**). New tab: **Cmd/Ctrl+T**; close tab: **Cmd/Ctrl+W** or the × button. A plain click navigates in the current tab. On first run, dismiss the guide before using the page's right-click menu.
- **Ad blocking per tab** — every tab gets the same best-effort network host blocking and response pruning, including synchronous pruning of initial player data on full-page loads.
- **Automatic updates** — packaged builds silently check GitHub Releases in the background on launch and offer **Restart now** once a new version downloads. Update checks are non-fatal: a missing network or stale feed simply logs a warning.

## Development

Run `npm run start:electron` from this directory. Its prestart hook rebuilds the extension before Electron launches. Tab wiring lives in `main.js` + `tab-model.js`; the strip UI is `tab-strip.html`/`.js`; click conventions are in `desktop-tab-open.js`; the context menu is `tab-context-menu.js`.

The same Electron tab implementation is packaged on both platforms. On macOS,
the strip occupies the native inset title bar, keeps the traffic-light controls
clear, and leaves empty strip space draggable. Build installers with
`npm run dist:mac` or `npm run dist:win`; both commands rebuild the shared
extension first. The cross-platform GitHub Actions workflow builds both formats
for pull requests and manual runs; a manual run also uploads the auto-update
feed (`latest-mac.yml`/`latest.yml`, blockmaps, and the installers) to the
latest GitHub release, while pull-request builds never touch releases.
