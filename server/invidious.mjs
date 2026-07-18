import { mapInvidiousVideo } from './stream-map.mjs'

export const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.flokinet.to',
  'https://vid.puffyan.us',
  'https://invidious.protokolla.fi',
  'https://iv.ggtyler.dev',
  'https://invidious.materialio.us',
  'https://invidious.slipfox.xyz',
  'https://inv.tux.pizza',
]

/**
 * Try public Invidious instances for /api/v1/videos/:id
 */
export async function fetchInvidiousStreams(videoId) {
  if (!/^[\w-]{11}$/.test(videoId)) return null

  for (let index = 0; index < INVIDIOUS_INSTANCES.length; index += 2) {
    const group = INVIDIOUS_INSTANCES.slice(index, index + 2)
    const controllers = group.map(() => new AbortController())
    const tasks = group.map(async (base, taskIndex) => {
      const controller = controllers[taskIndex]
      const timer = setTimeout(() => controller.abort(), 10000)
      try {
        const res = await fetch(
          `${base.replace(/\/$/, '')}/api/v1/videos/${videoId}`,
          {
            signal: controller.signal,
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Noirva-Proxy/1.2',
            },
          },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const mapped = mapInvidiousVideo(data, videoId)
        if (!mapped) throw new Error('empty')
        mapped._source = `invidious:${base}`
        return mapped
      } finally {
        clearTimeout(timer)
      }
    })

    try {
      const winner = await Promise.any(tasks)
      controllers.forEach((controller) => controller.abort())
      return winner
    } catch {
      controllers.forEach((controller) => controller.abort())
    }
  }
  return null
}
