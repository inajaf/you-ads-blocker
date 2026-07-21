# Noirva

YouTube in a clean standalone window. Ad blocking, back-button navigation, Google sign-in.

## Desktop app (macOS)

Download the latest `Noirva-*-arm64.dmg` from [Releases](https://github.com/inajaf/you-ads-blocker/releases).

> **Cutting a release?** The landing page (`src/landing/platforms.ts`) links
> directly to `releases/latest/download/<filename>` for each asset (currently
> `app-release.apk` and `Noirva-1.0.0-arm64.dmg`). Keep these exact filenames
> stable across versions — don't embed the new version number in an asset
> name — or the landing page's download links will 404. See
> `docs/decisions.md` (2026-07-21).

### Bypass Gatekeeper

The app isn't signed with an Apple Developer ID, so macOS blocks it. Pick one:

**Right-click → Open (easiest)**
1. Right-click **Noirva.app** in Finder → **Open**
2. Click **Open** in the dialog

**Or** run in Terminal:

```sh
xattr -dr com.apple.quarantine /path/to/Noirva.app
```

**Or** go to **System Settings → Privacy & Security** → click **Open Anyway**.

Drag into **Applications** and launch. YouTube loads with ad blocking and desktop navigation.

## Desktop app (Windows)

Download the latest `Noirva Setup *.exe` from [Releases](https://github.com/inajaf/you-ads-blocker/releases) and run the installer.

### Bypass SmartScreen

The app isn't signed with a code-signing certificate, so Windows SmartScreen may warn that it's unrecognized. Click **More info** → **Run anyway** to continue.

---

## Web app (for developers)

```bash
npm install
npm run build:extension
npm run dev
```

Open `http://127.0.0.1:5173/app`. Load `dist-extension/` in Chrome Extensions for Shield support.

### Build

```bash
npm test
npm run build
npm run build:extension
```

### Phone testing

```bash
npm run dev:phone    # starts Vite + Cloudflare tunnel, prints QR code
```

---

## Stack

React 19 · TypeScript · Vite · HLS.js · Chrome Extension (MV3) · Electron
