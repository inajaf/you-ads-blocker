# TubePWA

Cinema-dark React PWA for browsing videos and opening a protected player from
localhost or a password-protected ngrok URL.

## Playback policy

- **Desktop Chrome/Chromium:** the official YouTube embed is created only after
  the companion **YT Ads Shield** extension reports that its DNR ruleset is
  active.
- **Mobile browsers/PWA:** playback uses the in-app stream player because a
  mobile website cannot remove ads from a cross-origin YouTube iframe.
- Videos that require sign-in, payment, DRM, age/region access, or disallow
  embedding are not bypassed.

YT Ads Shield is best-effort filtering. YouTube changes its player regularly,
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
responses are rejected, response sizes are capped, and direct InnerTube client
impersonation is not used by the active resolver.

History, likes, and watch-later data stay in the current browser profile.

## Stack

React 19 · TypeScript · Vite · vite-plugin-pwa · HLS.js · IndexedDB · Chrome
Manifest V3 extension
