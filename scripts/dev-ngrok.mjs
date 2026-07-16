import { spawn, spawnSync } from 'node:child_process'

const config = spawnSync('ngrok', ['config', 'check'], { stdio: 'ignore' })
if (config.error?.code === 'ENOENT') {
  console.error('ngrok is not installed. Install it first, then retry.')
  process.exit(1)
}
if (config.status !== 0) {
  console.error('ngrok is installed but not configured.')
  console.error('Run: ngrok config add-authtoken <your-token>')
  process.exit(1)
}

const basicAuth = process.env.NGROK_BASIC_AUTH
if (!basicAuth || !basicAuth.includes(':')) {
  console.error('Protect the public development tunnel with visitor credentials.')
  console.error("Run: NGROK_BASIC_AUTH='viewer:strong-password' npm run dev:ngrok")
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

tunnel = spawn('ngrok', ['http', '5173', '--basic-auth', basicAuth], {
  stdio: 'inherit',
})
tunnel.on('error', (error) => {
  console.error(`Could not start ngrok: ${error.message}`)
  stop(1)
})
tunnel.on('exit', (code, signal) => {
  if (closing) return
  if (signal) console.error(`ngrok stopped with ${signal}`)
  stop(code ?? 1)
})

async function discoverTunnel() {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline && !closing) {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels')
      if (response.ok) {
        const data = await response.json()
        const publicUrl = data.tunnels?.find((entry) =>
          String(entry.public_url || '').startsWith('https://'),
        )?.public_url
        if (publicUrl) return new URL(publicUrl)
      }
    } catch {
      /* ngrok inspector is still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the ngrok public URL')
}

try {
  const publicUrl = await discoverTunnel()
  console.info(`Protected public URL: ${publicUrl.origin}`)
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
