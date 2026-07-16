import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
// @ts-expect-error ESM proxy helper without types
import { handleProxy } from './server/proxy-core.mjs'
// @ts-expect-error ESM media proxy without types
import { proxyMediaRequest } from './server/media-proxy.mjs'

export function pipedProxyPlugin(): Plugin {
  return {
    name: 'tube-pwa-proxy',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url) return next()

        // Same-origin media stream (Range / CORS for MSE adaptive)
        if (req.url.startsWith('/api/media')) {
          try {
            const url = new URL(req.url, 'http://localhost')
            const target = url.searchParams.get('url') || ''
            await proxyMediaRequest(req, res, target)
          } catch (e) {
            if (!res.headersSent) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: e instanceof Error ? e.message : 'media proxy error',
                }),
              )
            }
          }
          return
        }

        if (!req.url.startsWith('/api/proxy')) return next()
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed', code: 'BAD_METHOD' }))
          return
        }
        try {
          const url = new URL(req.url, 'http://localhost')
          const path = url.searchParams.get('path') || ''
          const base = url.searchParams.get('base') || ''
          const result = (await handleProxy(path, base)) as {
            status: number
            headers: Record<string, string>
            body: string
          }
          res.statusCode = result.status
          for (const [k, v] of Object.entries(result.headers)) {
            res.setHeader(k, v)
          }
          res.end(result.body)
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : 'proxy error',
            }),
          )
        }
      })
    },
  }
}
