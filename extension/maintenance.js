/** Shared, dependency-free maintenance commands for the Noirva app profile. */
(function installNoirvaMaintenance(globalScope) {
  const MAINTENANCE_MESSAGE = 'NOIRVA_CLEAR_BROWSING_DATA'
  const ACTIONS = Object.freeze({
    HISTORY: 'history',
    CACHE: 'cache',
  })

  const DATA_TYPES = Object.freeze({
    [ACTIONS.HISTORY]: Object.freeze({ history: true }),
    [ACTIONS.CACHE]: Object.freeze({ cache: true }),
  })

  function isSupportedAction(action) {
    return Object.hasOwn(DATA_TYPES, action)
  }

  function createMaintenanceService({ browsingData } = {}) {
    if (!browsingData || typeof browsingData.remove !== 'function') {
      throw new TypeError('Chrome browsingData API is required')
    }

    async function clear(action) {
      if (!isSupportedAction(action)) {
        return { ok: false, error: 'Unsupported maintenance action.' }
      }

      // Intentionally preserve cookies, passwords and site storage so clearing
      // Noirva's history or cache never signs the user out of YouTube.
      await browsingData.remove({ since: 0 }, DATA_TYPES[action])
      return { ok: true, action }
    }

    return Object.freeze({ clear })
  }

  globalScope.NoirvaMaintenance = Object.freeze({
    ACTIONS,
    MAINTENANCE_MESSAGE,
    createMaintenanceService,
    isSupportedAction,
  })
})(globalThis)
