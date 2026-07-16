import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const check = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' })
if (check.error?.code === 'ENOENT') {
  console.error('cloudflared is not installed. Install it first, then retry.')
  console.error('Run: brew install cloudflared')
  process.exit(1)
}

let closing = false
let vite
let tunnel

function stop(exitCode = 0) {
  if (closing) return
  closing = true
  if (tunnel && !tunnel.killed) tunnel.kill('SIGTERM')
  if (vite && !vite.killed) vite.kill('SIGTERM')
  setTimeout(() => process.exit(exitCode), 150)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

// Quick tunnels need no account. Unlike ngrok's free tier there is no
// interstitial page, so the manifest and service worker reach the phone
// intact and Chrome offers the PWA install prompt.
tunnel = spawn(
  'cloudflared',
  ['tunnel', '--url', 'http://127.0.0.1:5173', '--no-autoupdate'],
  { stdio: ['ignore', 'inherit', 'pipe'] },
)
tunnel.on('error', (error) => {
  console.error(`Could not start cloudflared: ${error.message}`)
  stop(1)
})
tunnel.on('exit', (code, signal) => {
  if (closing) return
  if (signal) console.error(`cloudflared stopped with ${signal}`)
  stop(code ?? 1)
})

function discoverTunnel() {
  // The quick-tunnel URL is only announced on cloudflared's stderr.
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for the trycloudflare URL'))
    }, 20_000)
    tunnel.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      buffer += chunk.toString()
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match) {
        clearTimeout(timer)
        resolve(new URL(match[0]))
      }
    })
  })
}

try {
  const publicUrl = await discoverTunnel()
  const qrPath = fileURLToPath(new URL('../phone-install-qr.png', import.meta.url))
  await QRCode.toFile(qrPath, publicUrl.origin, { width: 960, margin: 4 })
  console.info(await QRCode.toString(publicUrl.origin, { type: 'terminal', small: true }))
  console.info(`Phone install URL: ${publicUrl.origin}`)
  console.info('QR code saved to phone-install-qr.png (scan either one).')
  vite = spawn('npm', ['run', 'dev:local'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: publicUrl.hostname,
    },
  })
  vite.on('error', (error) => {
    console.error(`Could not start Vite: ${error.message}`)
    stop(1)
  })
  vite.on('exit', (code, signal) => {
    if (closing) return
    if (signal) console.error(`Vite stopped with ${signal}`)
    stop(code ?? 1)
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  stop(1)
}
