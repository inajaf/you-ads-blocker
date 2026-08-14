'use strict'

// Preload for the AdVoid tab strip (desktop/tab-strip.html). Exposes a minimal,
// allowlisted API to the strip renderer; all real work stays in the main
// process via ipcRenderer.

const { contextBridge, ipcRenderer } = require('electron')
const { TAB_STRIP_CHANNELS } = require('./tab-ipc')

contextBridge.exposeInMainWorld('advoidTabs', {
  getState() {
    return ipcRenderer.invoke(TAB_STRIP_CHANNELS.getState)
  },
  onState(callback) {
    if (typeof callback !== 'function') return
    const listener = (event, state) => callback(state)
    ipcRenderer.on(TAB_STRIP_CHANNELS.setState, listener)
  },
  selectTab(id) {
    ipcRenderer.send(TAB_STRIP_CHANNELS.selectTab, id)
  },
  closeTab(id) {
    ipcRenderer.send(TAB_STRIP_CHANNELS.closeTab, id)
  },
  newTab() {
    ipcRenderer.send(TAB_STRIP_CHANNELS.newTab)
  },
  signIn() {
    ipcRenderer.send(TAB_STRIP_CHANNELS.signIn)
  },
})
