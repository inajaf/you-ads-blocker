# Noirva Desktop

Noirva Desktop opens YouTube in Chrome App Mode with a dedicated persistent
profile and the unpacked Noirva Shield extension. Chrome App Mode keeps Google
sign-in supported while presenting a standalone window without normal tabs or
an address bar.

## Prerequisites

1. Install the root dependencies and build the extension:

   ```sh
   npm install
   npm run build:extension
   ```

2. Download Chrome for Testing for macOS. By default the launcher expects its
   executable at:

   ```text
   ~/Library/Application Support/Tube Desktop Runtime/<architecture>/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
   ```

   Existing installations keep using this legacy directory so the signed-in
   profile is not lost. You can keep the runtime elsewhere and set
   `NOIRVA_CHROME_PATH` to the executable (`TUBE_CHROME_PATH` remains supported).

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

Set `NOIRVA_PROFILE_DIR` to use a different persistent Chrome profile directory.
The legacy `TUBE_PROFILE_DIR` variable remains supported for compatibility.
The Electron implementation remains available as the development fallback via
`npm run start:electron`. It loads the same guide and keeps its dismissal state
in the persistent Electron profile. Google does not support account sign-in
inside Electron: when you choose **Sign in**, Noirva opens a separate supported
Chrome App window with the private Noirva profile and closes the Electron window.
