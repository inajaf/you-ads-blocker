(function () {
  var DESKTOP_APP_STATUS_MESSAGE = 'GET_DESKTOP_APP_WINDOW_STATUS'
  var BACK_BUTTON_ID = 'tube-account-back'
  var BACK_TARGET = 'https://www.youtube.com/?tube_app=1'

  var retryCount = 0
  var MAX_RETRIES = 5

  function checkDesktopAppMode() {
    if (retryCount >= MAX_RETRIES) return

    chrome.runtime.sendMessage(
      { type: DESKTOP_APP_STATUS_MESSAGE },
      function (response) {
        if (chrome.runtime.lastError) {
          retryCount++
          setTimeout(checkDesktopAppMode, 500)
          return
        }
        if (response && response.active) {
          injectBackButton()
        } else {
          retryCount++
          setTimeout(checkDesktopAppMode, 500)
        }
      },
    )
  }

  function createSvgIcon(d) {
    var svgNS = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(svgNS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    var path = document.createElementNS(svgNS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
    return svg
  }

  function injectBackButton() {
    if (document.getElementById(BACK_BUTTON_ID)) return

    var style = document.createElement('style')
    style.textContent =
      '#' +
      BACK_BUTTON_ID +
      '{position:fixed!important;z-index:100000!important;top:10px!important;left:10px!important;display:inline-grid!important;width:44px!important;min-width:44px!important;height:44px!important;margin:0!important;padding:0!important;place-items:center!important;border:1px solid rgba(255,255,255,0.16)!important;border-radius:999px!important;background:rgba(15,15,15,0.88)!important;color:#fff!important;cursor:pointer!important;touch-action:manipulation!important;box-shadow:0 8px 24px rgba(0,0,0,0.28)!important;-webkit-backdrop-filter:blur(10px)!important;backdrop-filter:blur(10px)!important;transition:background-color 180ms ease,transform 120ms ease!important}' +
      '#' +
      BACK_BUTTON_ID +
      ':hover{background:rgba(255,255,255,0.16)!important}' +
      '#' +
      BACK_BUTTON_ID +
      ':active{transform:scale(0.94)!important}' +
      '#' +
      BACK_BUTTON_ID +
      ' svg{width:26px!important;height:26px!important;fill:none!important;stroke:currentColor!important;stroke-width:2!important;stroke-linecap:round!important;stroke-linejoin:round!important}' +
      '@media (prefers-reduced-motion:reduce){#' +
      BACK_BUTTON_ID +
      '{transition:none!important}}'
    document.head.append(style)

    var button = document.createElement('button')
    button.id = BACK_BUTTON_ID
    button.type = 'button'
    button.setAttribute('aria-label', 'Back to YouTube')
    button.title = 'Back to YouTube (\u2318[ or Alt+Left)'
    button.append(createSvgIcon('M15 18l-6-6 6-6'))
    button.addEventListener('click', function () {
      location.assign(BACK_TARGET)
    })
    document.body.append(button)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkDesktopAppMode, { once: true })
  } else {
    checkDesktopAppMode()
  }
})()
