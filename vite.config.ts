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
    // dev:ngrok injects the one active tunnel host through Vite's supported env.
    allowedHosts: [],
  },
  plugins: [
    react(),
    pipedProxyPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      // The ngrok tunnel uses HTTP Basic Auth. Manifest requests omit
      // credentials by default, so explicitly opt in or Chrome cannot verify
      // installability behind the protected tunnel.
      useCredentials: true,
      includeAssets: ['favicon.svg', 'media-sw-fetch.js'],
      // Dev: enable SW so /__tube_media works for max-quality MSE locally
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'TubePWA',
        short_name: 'TubePWA',
        description:
          'Install from browser link. YouTube-like player without ads. No APK, no API keys.',
        theme_color: '#0f0f0f',
        background_color: '#0f0f0f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        id: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512.png',
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
