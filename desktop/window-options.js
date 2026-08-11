'use strict'

const MACOS_TRAFFIC_LIGHT_POSITION = Object.freeze({ x: 14, y: 14 })

function createDesktopWindowOptions({ platform = process.platform, icon }) {
  const options = {
    width: 1200,
    height: 800,
    title: 'AdVoid',
    backgroundColor: '#0b0b0d',
    icon,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  }

  if (platform === 'darwin') {
    options.titleBarStyle = 'hiddenInset'
    options.trafficLightPosition = { ...MACOS_TRAFFIC_LIGHT_POSITION }
  }

  return options
}

function createTabStripLoadOptions(platform = process.platform) {
  return { query: { platform } }
}

module.exports = {
  MACOS_TRAFFIC_LIGHT_POSITION,
  createDesktopWindowOptions,
  createTabStripLoadOptions,
}
