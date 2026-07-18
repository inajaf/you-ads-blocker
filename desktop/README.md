# Noirva Desktop

Noirva Desktop opens YouTube in Chrome App Mode with a dedicated persistent
profile and the unpacked Noirva Shield extension. Chrome App Mode keeps Google
sign-in supported while presenting a standalone window without normal tabs or
an address bar.

Before either the sign-in or normal launch, Noirva brands only its private
Chrome for Testing runtime with the Noirva display name and app icon. The
system Chrome installation is never modified. On Windows the original private
`chrome.exe` is retained beside it as `chrome.exe.noirva-original.exe`. If an
old Chrome icon is already running in the macOS Dock or Windows taskbar, close
that window once and start Noirva again so the OS can load the refreshed icon.

## Prerequisites

1. Install the root dependencies and build the extension:

   ```sh
   npm install
   npm run build:extension
   ```

2. Download Chrome for Testing for your platform. Extract the archive so the
   launcher can find the executable at the matching default path:

   ```text
   macOS:   ~/Library/Application Support/Noirva Desktop Runtime/chrome-mac-<architecture>/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
   Windows: %LOCALAPPDATA%\Noirva Desktop Runtime\chrome-win64\chrome.exe
   ```

   On 32-bit Windows, use the `chrome-win32` archive and directory. Existing
   installations keep using the legacy `Tube Desktop Runtime` directory so the
   signed-in profile is not lost. You can keep the runtime elsewhere and set
   `NOIRVA_CHROME_PATH` to the executable (`TUBE_CHROME_PATH` remains supported).
   Custom external Chrome paths are launched but deliberately left unmodified.

## First sign-in

```sh
cd desktop
npm install
npm run login
```

Sign in in the clean Chrome window, then close it. Noirva starts automatically
with the same profile and the Shield extension enabled.

## Normal launch

```sh
cd desktop
npm start
```

## First-use guide

On the first app launch, Noirva opens a four-step guide over YouTube that explains:

1. how to browse, search, and play videos in the dedicated window;
2. that Noirva Shield runs automatically;
3. how to use Noirva's Back button when Chrome's toolbar is hidden; and
4. where the dedicated profile keeps the Google sign-in.

Finish or skip the guide to dismiss it. Use the question-mark button beside
Noirva's Back button in the YouTube header whenever you want to reopen it.

The adjacent maintenance button opens two separate, confirmed actions:

- **Clear history** removes visited-page history from Noirva's private profile.
- **Clear cache** removes temporary browser files.

Neither action removes cookies, passwords, local storage, or the saved YouTube
sign-in. In the dedicated app window Chrome's tabs, address bar, browser menu,
and YouTube's lookalike hamburger control are hidden; Noirva's Back button and
the compact YouTube navigation remain available.

Set `NOIRVA_PROFILE_DIR` to use a different persistent Chrome profile directory.
The legacy `TUBE_PROFILE_DIR` variable remains supported for compatibility.
The Electron implementation remains available as the development fallback via
`npm run start:electron`. It loads the same guide and keeps its dismissal state
in the persistent Electron profile. Google does not support account sign-in
inside Electron: when you choose **Sign in**, Noirva opens a separate supported
Chrome App window with the private Noirva profile and closes the Electron window.
