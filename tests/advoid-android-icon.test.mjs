import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../android/AdVoid/app/src/main/', import.meta.url))
const read = (path) => readFileSync(`${ROOT}/${path}`)
const text = (path) => read(path).toString('utf8')

function pngInfo(path) {
  const bytes = read(path)
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG')
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  }
}

describe('Android round AdVoid branding', () => {
  it('declares adaptive and round launcher icons', () => {
    const manifest = text('AndroidManifest.xml')
    assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/)
    assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/)

    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const adaptive = text(`res/mipmap-anydpi-v26/${name}`)
      assert.match(adaptive, /<adaptive-icon/)
      assert.match(adaptive, /@drawable\/advoid_adaptive_icon/)
      assert.match(adaptive, /@android:color\/transparent/)
    }

    assert.deepEqual(pngInfo('res/drawable-nodpi/advoid_adaptive_icon.png'), {
      width: 512, height: 512, colorType: 2,
    })
  })

  it('ships transparent circular legacy icons at every Android density', () => {
    const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
    for (const [density, size] of Object.entries(sizes)) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        const info = pngInfo(`res/mipmap-${density}/${name}`)
        assert.deepEqual(info, { width: size, height: size, colorType: 6 })
      }
    }
  })

  it('uses the round emblem for the Android 12 splash and video loader', () => {
    const splash = text('res/values-v31/styles.xml')
    assert.match(splash, /windowSplashScreenBackground.*@color\/advoid_icon_background/)
    assert.match(splash, /windowSplashScreenAnimatedIcon.*@drawable\/advoid_round_icon/)
    assert.deepEqual(pngInfo('res/drawable-nodpi/advoid_round_icon.png'), {
      width: 512, height: 512, colorType: 6,
    })
    assert.deepEqual(pngInfo('res/drawable-nodpi/advoid_loading_logo.png'), {
      width: 256, height: 256, colorType: 6,
    })
  })
})
