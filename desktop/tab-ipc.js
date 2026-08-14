'use strict'

// IPC channel names shared between the main process (desktop/main.js), the tab
// strip renderer (desktop/tab-strip-preload.js) and the YouTube page bridge
// (desktop/preload.js). Kept in one module so main and renderers can never drift.

const TAB_STRIP_CHANNELS = {
  newTab: 'advoid:tab-new',
  selectTab: 'advoid:tab-select',
  closeTab: 'advoid:tab-close',
  setState: 'advoid:tabs-updated',
  getState: 'advoid:tabs-get-state',
  signIn: 'advoid:sign-in',
}

const TAB_OPEN_CHANNEL = 'advoid:open-video-tab'

module.exports = {
  TAB_OPEN_CHANNEL,
  TAB_STRIP_CHANNELS,
}
