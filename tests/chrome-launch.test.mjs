import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  chromeProcessListCommand,
  isChromeProfileBusy,
  isChromeProfileCommand,
  isChromeProfileProcessCommand,
  isChromeProfileRunning,
  stopChromeProfile,
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
      isChromeProfileProcessCommand(`${browserCommand} --type=renderer`, {
        chromePath,
        profileDir,
      }),
      true,
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

  it('waits for macOS helper processes to release the private profile', async () => {
    const chromePath =
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    const profileDir = '/tmp/advoid-profile'
    const helperCommand =
      '/Applications/Google Chrome for Testing.app/Contents/Frameworks/' +
      `Google Chrome for Testing Helper.app/Contents/MacOS/Google Chrome for Testing Helper --type=renderer --user-data-dir=${profileDir}`

    assert.equal(
      isChromeProfileProcessCommand(helperCommand, { chromePath, profileDir }),
      true,
    )
    assert.equal(
      await isChromeProfileBusy({
        chromePath,
        profileDir,
        platform: 'darwin',
        execFileImpl(executable, args, options, callback) {
          callback(null, helperCommand)
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

  it('stops only the main process for the dedicated Chrome profile', async () => {
    const chromePath = '/Applications/Chrome.app/Contents/MacOS/Chrome'
    const profileDir = '/tmp/advoid-profile'
    const killed = []
    const count = await stopChromeProfile({
      chromePath,
      profileDir,
      platform: 'darwin',
      execFileImpl(executable, args, options, callback) {
        callback(
          null,
          `101 ${chromePath} --user-data-dir=${profileDir}\n` +
            `102 ${chromePath} --user-data-dir=${profileDir} --type=renderer\n` +
            '103 /Applications/Other.app/Contents/MacOS/Other\n',
        )
      },
      killImpl(processId, signal) {
        killed.push([processId, signal])
      },
    })
    assert.equal(count, 1)
    assert.deepEqual(killed, [[101, 'SIGTERM']])
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
