import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  chromeProcessListCommand,
  isChromeProfileCommand,
  isChromeProfileRunning,
  waitForChromeStartup,
} from '../desktop/chrome-launch.mjs'

class FakeChild extends EventEmitter {}

describe('Chrome launcher lifecycle', () => {
  it('uses a Windows process query and recognizes the dedicated profile', async () => {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    const profileDir = 'C:\\Users\\Example\\AppData\\Local\\Noirva Desktop Chrome'
    const browserCommand = `"${chromePath}" --user-data-dir="${profileDir}" --app=https://www.youtube.com/`

    assert.equal(chromeProcessListCommand('win32').executable, 'powershell.exe')
    assert.equal(isChromeProfileCommand(browserCommand, { chromePath, profileDir }), true)
    assert.equal(
      isChromeProfileCommand(`${browserCommand} --type=renderer`, { chromePath, profileDir }),
      false,
    )
    assert.equal(
      await isChromeProfileRunning({
        chromePath,
        profileDir,
        platform: 'win32',
        execFileImpl: (executable, args, options, callback) => {
          assert.equal(executable, 'powershell.exe')
          callback(null, browserCommand)
        },
      }),
      true,
    )
  })

  it('accepts a process that remains alive through the startup grace period', async () => {
    const child = new FakeChild()
    const startup = waitForChromeStartup(child, { graceMs: 1 })
    child.emit('spawn')
    assert.deepEqual(await startup, { forwarded: false })
  })

  it('accepts a successful request forwarded to an existing profile', async () => {
    const child = new FakeChild()
    const startup = waitForChromeStartup(child, {
      graceMs: 50,
      isProfileRunning: async () => true,
    })
    child.emit('spawn')
    child.emit('exit', 0, null)
    assert.deepEqual(await startup, { forwarded: true })
  })

  it('rejects spawn errors and early process exits', async () => {
    const spawnErrorChild = new FakeChild()
    const spawnError = waitForChromeStartup(spawnErrorChild, { graceMs: 1 })
    spawnErrorChild.emit('error', new Error('EACCES'))
    await assert.rejects(spawnError, /EACCES/)

    const exitedChild = new FakeChild()
    const exited = waitForChromeStartup(exitedChild, { graceMs: 50 })
    exitedChild.emit('spawn')
    exitedChild.emit('exit', 1, null)
    await assert.rejects(exited, /exit code 1/)
  })
})
