import { execFile } from 'node:child_process'

const DEFAULT_STARTUP_GRACE_MS = 750

export async function isChromeProfileRunning({ chromePath, profileDir }) {
  const stdout = await new Promise((resolve) => {
    execFile('/bin/ps', ['ax', '-o', 'command='], { maxBuffer: 4 * 1024 * 1024 }, (error, output) => {
      resolve(error ? '' : output)
    })
  })
  const profileArg = `--user-data-dir=${profileDir}`
  return stdout
    .split('\n')
    .some(
      (command) =>
        command.includes(chromePath) &&
        command.includes(profileArg) &&
        !command.includes('--type='),
    )
}

export function waitForChromeStartup(
  child,
  { graceMs = DEFAULT_STARTUP_GRACE_MS, isProfileRunning = async () => false } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null

    const succeed = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    }

    child.once('error', (error) => {
      fail(new Error(`Chrome could not be started: ${error.message}`, { cause: error }))
    })
    child.once('spawn', () => {
      timer = setTimeout(() => succeed({ forwarded: false }), graceMs)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      if (timer) clearTimeout(timer)

      Promise.resolve(code === 0 && isProfileRunning()).then(
        (running) => {
          if (running) {
            succeed({ forwarded: true })
            return
          }
          const reason = signal ? `signal ${signal}` : `exit code ${code}`
          fail(new Error(`Chrome exited before opening Noirva (${reason}).`))
        },
        fail,
      )
    })
  })
}
