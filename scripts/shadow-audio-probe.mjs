// Prototype probe for the "audio shadow": mirror YouTube's own audio
// SourceBuffer into a second media element that has NO video track (the only
// media Chromium keeps playing while the screen is locked), then watch what
// happens across a real screen lock.
//
// The whole sequence runs in ONE DevTools session, because
// Page.addScriptToEvaluateOnNewDocument registrations are dropped when the
// session detaches.
//
// Usage:
//   node scripts/shadow-audio-probe.mjs run <watch-url> [seconds]
//   node scripts/shadow-audio-probe.mjs check
// Requires: adb forward tcp:9222 to the app's WebView devtools socket.

const mode = process.argv[2] || 'check'
const watchUrl = process.argv[3] || 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'
const seconds = Number(process.argv[4] || 60)

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((entry) => entry.type === 'page')
if (!target) {
  console.error('no page target; is the app running with web contents debugging on?')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let nextId = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
}

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  const details = response.result?.exceptionDetails
  if (details) {
    return `EXCEPTION: ${(details.exception?.description || details.text || '').split('\n')[0]}`
  }
  return response.result?.result?.value
}

/**
 * Runs before any page script. Wraps MediaSource/SourceBuffer so that every
 * audio segment YouTube appends is copied into a shadow MediaSource attached to
 * an element that never gets a video track.
 */
const SHADOW_SCRIPT = `
window.__shadow = { status: 'installing', appends: 0, removes: 0, queued: 0, sources: 0, errors: [] };
(function() {
  if (!window.MediaSource || !window.SourceBuffer) {
    window.__shadow.status = 'no-mse';
    return;
  }
  var nativeAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  var nativeAppend = SourceBuffer.prototype.appendBuffer;
  var nativeRemove = SourceBuffer.prototype.remove;
  var nativeCreateObjectURL = URL.createObjectURL;
  var urlOf = new WeakMap();

  var element = null;
  var mediaSource = null;
  var sourceBuffer = null;
  var mirroring = null;
  var queue = [];

  URL.createObjectURL = function(value) {
    var url = nativeCreateObjectURL.apply(URL, arguments);
    if (window.MediaSource && value instanceof MediaSource) urlOf.set(value, url);
    return url;
  };

  function mainVideo() {
    var videos = document.querySelectorAll('.html5-video-player video');
    for (var i = 0; i < videos.length; i++) {
      if (!videos[i].paused && !videos[i].ended) return videos[i];
    }
    return videos.length ? videos[0] : null;
  }

  function isLive(ms) {
    var video = mainVideo();
    if (!video || !video.src) return false;
    return video.src === urlOf.get(ms);
  }

  function flush() {
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open' || sourceBuffer.updating) return;
    var op = queue.shift();
    if (!op) return;
    try {
      if (op.type === 'append') sourceBuffer.appendBuffer(op.data);
      else sourceBuffer.remove(op.start, op.end);
    } catch (e) {
      window.__shadow.errors.push(op.type + ': ' + String(e).slice(0, 60));
    }
  }

  function build(mime) {
    window.__shadow.sources++;
    if (window.__shadow.sources > 6) {
      window.__shadow.status = 'giving-up';
      return;
    }
    if (element && element.parentNode) element.parentNode.removeChild(element);
    element = document.createElement('video');
    element.id = 'advoid-shadow';
    element.playsInline = true;
    element.muted = true;
    element.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;z-index:-1;';
    element.addEventListener('error', function() {
      window.__shadow.status = 'element-error:' + (element.error && element.error.code);
    });
    document.documentElement.appendChild(element);

    mediaSource = new MediaSource();
    mediaSource.addEventListener('sourceopen', function() {
      try {
        sourceBuffer = nativeAddSourceBuffer.call(mediaSource, mime);
        sourceBuffer.addEventListener('updateend', flush);
        window.__shadow.status = 'open';
        flush();
      } catch (e) {
        window.__shadow.status = 'add-failed';
        window.__shadow.errors.push('addSourceBuffer: ' + String(e).slice(0, 60));
      }
    });
    mediaSource.addEventListener('sourceclose', function() {
      if (window.__shadow.status === 'open') window.__shadow.status = 'closed';
    });
    element.src = nativeCreateObjectURL.call(URL, mediaSource);
    window.__shadow.status = 'built';
  }

  MediaSource.prototype.addSourceBuffer = function(requested) {
    var mime = String(requested);
    var result = nativeAddSourceBuffer.apply(this, arguments);
    try { result.__advoidMediaSource = this; } catch (e) { /* tag is best effort */ }
    if (mime.indexOf('audio/') !== 0) return result;

    result.appendBuffer = function(data) {
      if (isLive(this.__advoidMediaSource)) {
        if (mirroring !== this) {
          mirroring = this;
          queue = [];
          build(mime);
        }
        if (queue.length < 400 && window.__shadow.status !== 'giving-up') {
          try {
            queue.push({ type: 'append', data: data.slice(0) });
            window.__shadow.queued++;
            flush();
          } catch (e) {
            window.__shadow.errors.push('copy: ' + String(e).slice(0, 60));
          }
        }
        window.__shadow.appends++;
      }
      return nativeAppend.apply(this, arguments);
    };

    result.remove = function(start, end) {
      if (mirroring === this && queue.length < 400) {
        queue.push({ type: 'remove', start: start, end: end });
        window.__shadow.removes++;
        flush();
      }
      return nativeRemove.apply(this, arguments);
    };

    return result;
  };
})();
`

const STATE = `(() => {
  var shadow = document.getElementById('advoid-shadow');
  var video = document.querySelector('.html5-video-player video');
  function buffered(el) {
    if (!el || !el.buffered || !el.buffered.length) return null;
    return [Number(el.buffered.start(0).toFixed(1)), Number(el.buffered.end(el.buffered.length - 1).toFixed(1))];
  }
  return JSON.stringify({
    shadowStatus: window.__shadow ? window.__shadow.status : 'not installed',
    appends: window.__shadow ? window.__shadow.appends : null,
    queued: window.__shadow ? window.__shadow.queued : null,
    sources: window.__shadow ? window.__shadow.sources : null,
    errors: window.__shadow ? window.__shadow.errors.slice(0, 2) : null,
    shadow: shadow ? {
      ready: shadow.readyState,
      ct: Number(shadow.currentTime.toFixed(2)),
      paused: shadow.paused,
      muted: shadow.muted,
      buffered: buffered(shadow),
      error: shadow.error ? shadow.error.code : null
    } : null,
    video: video ? { ct: Number(video.currentTime.toFixed(2)), paused: video.paused, buffered: buffered(video) } : null
  });
})()`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (mode === 'check') {
  console.log(await evaluate(STATE))
} else if (mode === 'run') {
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SHADOW_SCRIPT })
  await send('Page.navigate', { url: watchUrl })
  await sleep(15000)
  // Start playback the way the app does, through the page.
  console.log(
    'play:',
    await evaluate(`(async () => {
      var video = document.querySelector('.html5-video-player video');
      if (!video) return 'no video element';
      await video.play().catch(function(e) { return 'play rejected: ' + e; });
      return 'ok';
    })()`),
  )
  // Wait for the shadow to exist and have buffered data ahead of the play head.
  let ready = false
  for (let i = 0; i < 20 && !ready; i += 1) {
    await sleep(2000)
    const state = JSON.parse(await evaluate(STATE))
    ready = Boolean(state.shadow && state.shadow.ready >= 2 && state.shadow.buffered)
    if (i % 3 === 0) console.log(`waiting ${i}`, JSON.stringify(state))
  }
  // Shadow audible, video silenced: while the screen is on the user hears the
  // video (perfect sync); the shadow only has to be ready to take over.
  console.log(
    'shadow start:',
    await evaluate(`(async () => {
      var shadow = document.getElementById('advoid-shadow');
      var video = document.querySelector('.html5-video-player video');
      if (!shadow || !video) return 'missing shadow or video';
      shadow.currentTime = Math.max(0, video.currentTime - 0.5);
      await shadow.play().catch(function(e) { window.__shadow.errors.push('play: ' + String(e).slice(0, 60)); });
      return JSON.stringify({ paused: shadow.paused, ready: shadow.readyState, ct: Number(shadow.currentTime.toFixed(2)) });
    })()`),
  )
  console.log('armed for lock test; sampling for ' + seconds + 's (lock the screen now)')
  await sleep(6000)
  console.log(
    'unmute shadow + mute video:',
    await evaluate(`(async () => {
      var shadow = document.getElementById('advoid-shadow');
      var video = document.querySelector('.html5-video-player video');
      if (!shadow) return 'no shadow';
      shadow.muted = false;
      shadow.volume = 0.05;
      if (video) video.muted = true;
      await shadow.play().catch(function(e) { window.__shadow.errors.push('unmute: ' + String(e).slice(0, 60)); });
      return JSON.stringify({ muted: shadow.muted, paused: shadow.paused, ct: Number(shadow.currentTime.toFixed(2)) });
    })()`),
  )
  const samples = Math.max(1, Math.round(seconds / 2))
  for (let i = 0; i < samples; i += 1) {
    console.log(`t+${(i * 2).toString()}s`, await evaluate(STATE))
    await sleep(2000)
  }
} else {
  console.error(`unknown mode: ${mode}`)
}

ws.close()
