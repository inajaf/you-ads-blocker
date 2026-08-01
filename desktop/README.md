# AdVoid Desktop

YouTube in a clean standalone window with ad filtering, back-button navigation, and Google sign-in support.

## Download

Grab the latest DMG (macOS) or `Setup *.exe` (Windows) from [Releases](https://github.com/inajaf/you-ads-blocker/releases).
For Windows install steps (SmartScreen bypass), see the [root README](../README.md#desktop-app-windows).

## Install on macOS

### 1. Bypass Gatekeeper

The app is unsigned (no Apple Developer ID). Pick one:

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

Click **Sign in** — a clean Chrome window opens. Sign into your Google account, then close it. AdVoid remembers your session.

## Features

- **Browser-style tabs** — each tab is its own web view with independent ad blocking. Open a link in a new tab with **Cmd/Ctrl+click** or **middle-click**; right-click a link for a native menu (**Open in New Tab**, **Copy Link Address**, **Back**/**Forward**/**Reload**). New tab: **Cmd/Ctrl+T**; close tab: **Cmd/Ctrl+W** or the × button. A plain click navigates in the current tab.
- **Ad blocking per tab** — network-level host blocking plus JSON pruning on every page load, so pre-roll ads don't show.
- **Dock/taskbar icon** — the app shows its icon in the macOS Dock (dev/test uses a padded rounded variant) and the Windows taskbar (via the packaged `.ico`).

## Development

Run from the repo root: `npm run dev` (Electron + Vite). Tab wiring lives in `main.js` + `tab-model.js`; the strip UI is `tab-strip.html`/`.js`; click conventions are in `desktop-tab-open.js`; the context menu is `tab-context-menu.js`.
