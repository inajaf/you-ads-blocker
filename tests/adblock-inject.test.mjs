import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../adblock/inject.js', import.meta.url),
  'utf8',
)

function createContext(initial) {
  const intervals = []
  const sandbox = {
    JSON,
    console,
    XMLHttpRequest: class {
      addEventListener() {}
      send() {}
    },
    setInterval(fn) {
      intervals.push(fn)
      return intervals.length
    },
    setTimeout(fn) {
      intervals.push(fn)
      return intervals.length
    },
    clearInterval() {},
    clearTimeout() {},
    fetch() {
      return Promise.resolve({})
    },
    ...initial,
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return { sandbox, intervals }
}

function hostValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function playerResponse() {
  return {
    videoDetails: { videoId: 'abc' },
    playerAds: [{ someAd: true }],
    adPlacements: [{ adSlot: {} }],
    adSlots: [{ adSlot: {} }],
    adBreakHeartbeatParams: 'xyz',
    streamingData: { formats: [{ itag: 18 }] },
  }
}

describe('adblock json-prune', () => {
  it('prunes an inline var assignment to ytInitialPlayerResponse (direct watch-URL load)', () => {
    const { sandbox } = createContext()
    vm.runInContext(
      `var ytInitialPlayerResponse = ${JSON.stringify(playerResponse())}`,
      sandbox,
    )

    const pr = vm.runInContext('ytInitialPlayerResponse', sandbox)
    assert.equal(pr.playerAds.length, 0)
    assert.equal(pr.adPlacements.length, 0)
    assert.equal(pr.adSlots.length, 0)
    assert.equal('adBreakHeartbeatParams' in pr, false)
    assert.deepEqual(hostValue(pr.streamingData), { formats: [{ itag: 18 }] })
    assert.equal(pr.videoDetails.videoId, 'abc')
  })

  it('prunes a window.ytInitialPlayerResponse assignment and stays clean on reads', () => {
    const { sandbox } = createContext()
    vm.runInContext(
      'window.ytInitialPlayerResponse = { playerAds: [{ ad: 1 }] }',
      sandbox,
    )

    const first = vm.runInContext('window.ytInitialPlayerResponse', sandbox)
    const second = vm.runInContext('window.ytInitialPlayerResponse', sandbox)
    assert.equal(first.playerAds.length, 0)
    assert.equal(second.playerAds.length, 0)
  })

  it('prunes ads from ytInitialData assignments', () => {
    const { sandbox } = createContext()
    vm.runInContext(
      `var ytInitialData = {
        contents: {
          results: [
            { videoRenderer: { videoId: 'x' } },
            { adSlotRenderer: { slot: {} } },
          ],
        },
        playerAds: [],
      }`,
      sandbox,
    )

    const data = vm.runInContext('ytInitialData', sandbox)
    assert.equal(data.contents.results.length, 1)
    assert.equal(data.contents.results[0].videoRenderer.videoId, 'x')
    assert.equal('playerAds' in data, false)
  })

  it('cleans a response set before the accessors were installed', () => {
    const { sandbox } = createContext({
      ytInitialPlayerResponse: { playerAds: [{ ad: 1 }] },
    })

    assert.equal(
      vm.runInContext('ytInitialPlayerResponse', sandbox).playerAds.length,
      0,
    )
  })

  it('keeps the polling fallback harmless once accessors are in place', () => {
    const { sandbox, intervals } = createContext()
    vm.runInContext(
      'ytInitialPlayerResponse = { playerAds: [{ ad: 1 }] }',
      sandbox,
    )
    for (const fn of intervals) fn()

    assert.equal(
      vm.runInContext('ytInitialPlayerResponse', sandbox).playerAds.length,
      0,
    )
  })

  it('still patches JSON.parse for wrapped player payloads', () => {
    const { sandbox } = createContext()
    const parsed = vm.runInContext(
      `JSON.parse('{"playerResponse":{"playerAds":[{}],"streamingData":{"formats":[{"itag":18}]}}}')`,
      sandbox,
    )

    assert.equal(parsed.playerResponse.playerAds.length, 0)
    assert.deepEqual(hostValue(parsed.playerResponse.streamingData), {
      formats: [{ itag: 18 }],
    })
  })
})
