# Noirva

Cinema-dark React PWA for browsing videos and opening a protected player from
localhost or a password-protected ngrok URL.

## Playback policy

- **Desktop Chrome/Chromium:** the official YouTube embed is created only after
  the companion **Noirva Shield** extension reports that its DNR ruleset is
  active.
- **Mobile browsers/PWA:** playback uses the in-app stream player because a
  mobile website cannot remove ads from a cross-origin YouTube iframe.
- Videos that require sign-in, payment, DRM, age/region access, or disallow
  embedding are not bypassed.

Noirva Shield is best-effort filtering. YouTube changes its player regularly,
so no extension can promise permanent ad blocking without updates.

## Local development

```bash
npm install
npm run build:extension
npm run dev:local
```

Open `http://127.0.0.1:5173`. In Chrome, open the Extensions page, enable
Developer mode, choose **Load unpacked**, and select `dist-extension/`.

`npm run dev` is an alias for `npm run dev:local`. Port 5173 is strict so the
extension/tunnel always talk to the same address.

## Native wrappers

- `desktop/` runs YouTube in Chrome App Mode with the unpacked Shield extension
  and a persistent Google profile. See [`desktop/README.md`](desktop/README.md).
- `android/` contains a native WebView wrapper backed by the shared ad-block
  core in `adblock/`. See [`android/README.md`](android/README.md).

## Testing install on a phone

```bash
npm run dev:phone
```

Starts Vite plus a Cloudflare quick tunnel (`cloudflared` must be installed,
e.g. `brew install cloudflared`), prints the `https://*.trycloudflare.com`
URL, and regenerates `phone-install-qr.png` for it on every run. Scan the QR
shown in the terminal (or the PNG) with the phone, then install from the
browser.

Use this command — not `dev:ngrok` — for phone installs. ngrok's free tier
serves an interstitial warning page to mobile browsers that replaces the
manifest and service worker responses with HTML, so Chrome never offers the
PWA install prompt. Quick tunnels have no interstitial and no auth wall; the
random tunnel URL only lives while the command runs.

## Protected ngrok development

Install/configure ngrok once:

```bash
ngrok config add-authtoken <your-token>
```

Then start the app and tunnel together:

```bash
NGROK_BASIC_AUTH='viewer:strong-password' npm run dev:ngrok
```

The launcher discovers the generated HTTPS hostname, allows only that exact
host in Vite, and stops Vite/ngrok together on `Ctrl+C`. The visitor username
and password are required because an ngrok authtoken authenticates the agent,
not people opening the public URL.

## Build and checks

```bash
npm test
npm run build
npm run build:extension
```

- Web build output: `dist/`
- Unpacked Chrome extension: `dist-extension/`
- Netlify functions: same-origin catalog/media proxy endpoints

## Security boundaries

The catalog/media proxy accepts only fixed HTTPS Piped/Invidious origins and
anchored media CDN hostnames. Redirects are manually revalidated, HTML/script
responses are rejected, response sizes are capped, and the stream resolver
limits direct InnerTube requests to YouTube's fixed HTTPS endpoints.

History, likes, and watch-later data stay in the current browser profile.

## Stack

React 19 · TypeScript · Vite · vite-plugin-pwa · HLS.js · IndexedDB · Chrome
Manifest V3 extension
