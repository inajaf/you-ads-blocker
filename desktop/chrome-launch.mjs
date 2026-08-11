import { execFile } from 'node:child_process'

const DEFAULT_STARTUP_GRACE_MS = 750

export function chromeProcessListCommand(platform = process.platform) {
  if (platform === 'win32') {
    return {
      executable: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$chromeIds = @(Get-Process chrome -ErrorAction SilentlyContinue).Id; Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\'" | Where-Object { $chromeIds -contains $_.ProcessId } | Select-Object -ExpandProperty CommandLine',
      ],
    }
  }

  return {
    executable: '/bin/ps',
    args: ['ax', '-o', 'command='],
  }
}

export function isChromeProfileCommand(command, { chromePath, profileDir }) {
  const normalizedCommand = command.replaceAll('"', '').toLowerCase()
  return (
    normalizedCommand.includes(chromePath.toLowerCase()) &&
    normalizedCommand.includes('--user-data-dir=') &&
    normalizedCommand.includes(profileDir.toLowerCase()) &&
    !normalizedCommand.includes('--type=')
  )
}

export async function isChromeProfileRunning({
  chromePath,
  profileDir,
  platform = process.platform,
  execFileImpl = execFile,
}) {
  const processList = chromeProcessListCommand(platform)
  const stdout = await new Promise((resolve) => {
    execFileImpl(
      processList.executable,
      processList.args,
      { maxBuffer: 4 * 1024 * 1024 },
      (error, output) => resolve(error ? '' : output),
    )
  })
  return stdout
    .split('\n')
    .some((command) => isChromeProfileCommand(command, { chromePath, profileDir }))
}

export async function stopChromeProfile({
  chromePath,
  profileDir,
  platform = process.platform,
  execFileImpl = execFile,
  killImpl = process.kill,
}) {
  const command = chromeProcessListCommand(platform)
  const args = platform === 'win32'
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\'" | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
      ]
    : ['ax', '-o', 'pid=', '-o', 'command=']
  const stdout = await new Promise((resolve) => {
    execFileImpl(command.executable, args, { maxBuffer: 4 * 1024 * 1024 }, (error, output) =>
      resolve(error ? '' : output),
    )
  })
  const processIds = stdout
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+([\s\S]+)$/))
    .filter((match) => match && isChromeProfileCommand(match[2], { chromePath, profileDir }))
    .map((match) => Number(match[1]))

  for (const processId of processIds) {
    try {
      killImpl(processId, 'SIGTERM')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  return processIds.length
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
          fail(new Error(`Chrome exited before opening AdVoid (${reason}).`))
        },
        fail,
      )
    })
  })
}
