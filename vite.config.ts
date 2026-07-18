import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { pipedProxyPlugin } from './vite-plugin-proxy.ts'

export default defineConfig({
  build: {
    // hls.js is an intentionally lazy optional player engine (~520 kB raw).
    chunkSizeWarningLimit: 550,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // dev:ngrok/dev:phone inject the one active tunnel host through Vite's supported env.
    allowedHosts: [],
  },
  plugins: [
    react(),
    pipedProxyPlugin(),
    VitePWA({
      // Prompt instead of silently auto-updating: the app shows a "new version
      // available" toast and reloads only when the user taps it. We register the
      // SW ourselves via virtual:pwa-register (src/pwa/updatePrompt.ts), so the
      // plugin must not also inject its own registration script.
      registerType: 'prompt',
      injectRegister: null,
      // The ngrok tunnel uses HTTP Basic Auth. Manifest requests omit
      // credentials by default, so explicitly opt in or Chrome cannot verify
      // installability behind the protected tunnel. (Phone installs go
      // through dev:phone — ngrok's free-tier interstitial blocks them.)
      useCredentials: true,
      includeAssets: ['noirva-logo-v2-48.png', 'media-sw-fetch.js'],
      // Dev: enable SW so /__tube_media works for max-quality MSE locally
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'Noirva',
        short_name: 'Noirva',
        description:
          'Install from a browser link. Focused video playback with best-effort ad filtering and no API keys.',
        theme_color: '#0f0f0f',
        background_color: '#0f0f0f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        id: '/',
        icons: [
          { src: 'noirva-logo-v2-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'noirva-logo-v2-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'noirva-logo-v2-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Optional share: when supported, shared YouTube links open /import
        share_target: {
          action: '/import',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,js}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/__tube_media/],
        // Client-IP media proxy for adaptive 720/1080 MSE
        importScripts: ['/media-sw-fetch.js'],
      },
    }),
  ],
})
