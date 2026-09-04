// Client-side logging (per-session id, level filtering, batched upload)
// plus top-level window error/unhandledrejection capture. Runs
// immediately at parse time (not gated by DOMContentLoaded) so it can
// observe errors thrown while the rest of the page is still loading.
// Every other shell/feature module reads/writes through window._log.
// ===== Client Logger =====
(function () {
  var isSpa = false;
  var queue = [];
  var flushTimer = null;

  // Generate 8-char base64url 'who' identifier for this client session
  var who = (function () {
    var bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, 8);
  })();

  // Level numeric mapping: error=0, info=1, debug=2
  var LEVELS = { error: 0, info: 1, debug: 2 };

  // Read saved prefs for initial state
  var savedPrefs;
  if (typeof window !== 'undefined' && window.KbPreferences) {
    savedPrefs = window.KbPreferences.get();
  } else {
    try { savedPrefs = JSON.parse(localStorage.getItem('kb-display-prefs') || '{}'); } catch (e) { savedPrefs = {}; }
  }
  var debugMode = savedPrefs.debugMode === 'on';
  // When debug mode is on, both console and upload honor this level
  var activeLevel = LEVELS[savedPrefs.clientLogLevel] !== undefined ? LEVELS[savedPrefs.clientLogLevel] : LEVELS.debug;

  function detectSpa() {
    if (document.body) isSpa = !!document.body.dataset.spa;
  }

  function flush() {
    if (queue.length === 0) return;
    var batch = queue.splice(0);
    try {
      var payload = JSON.stringify(batch);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/log', payload);
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/log');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      }
    } catch (e) { /* ignore */ }
  }

  function enqueue(level, source, message, data) {
    queue.push({ ts: new Date().toISOString(), level: level, source: source, message: String(message), data: data, who: who });
    if (!flushTimer) {
      flushTimer = setTimeout(function () { flushTimer = null; flush(); }, 2000);
    }
  }

  // Determine whether to log to console / upload based on mode and level
  function shouldConsole(levelNum) {
    if (debugMode) return levelNum <= activeLevel;
    // Default: console only for error
    return levelNum <= LEVELS.error;
  }
  function shouldUpload(levelNum) {
    detectSpa();
    if (!isSpa) return false;
    if (debugMode) return levelNum <= activeLevel;
    // Default: upload info and above
    return levelNum <= LEVELS.info;
  }

  window._log = {
    _who: who,
    error: function (source, message, data) {
      if (shouldConsole(LEVELS.error)) { data !== undefined ? console.error('[error] [' + source + '] [' + who + ']', message, data) : console.error('[error] [' + source + '] [' + who + ']', message); }
      if (shouldUpload(LEVELS.error)) enqueue('error', source, message, data);
    },
    info: function (source, message, data) {
      if (shouldConsole(LEVELS.info)) { data !== undefined ? console.log('[info] [' + source + '] [' + who + ']', message, data) : console.log('[info] [' + source + '] [' + who + ']', message); }
      if (shouldUpload(LEVELS.info)) enqueue('info', source, message, data);
    },
    debug: function (source, message, data) {
      if (shouldConsole(LEVELS.debug)) { data !== undefined ? console.log('[debug] [' + source + '] [' + who + ']', message, data) : console.log('[debug] [' + source + '] [' + who + ']', message); }
      if (shouldUpload(LEVELS.debug)) enqueue('debug', source, message, data);
    },
    _setDebugMode: function (on) {
      debugMode = on;
    },
    _setLevel: function (level) {
      activeLevel = LEVELS[level] !== undefined ? LEVELS[level] : LEVELS.debug;
    }
  };

  if (typeof addEventListener !== 'undefined') {
    addEventListener('beforeunload', flush);
    addEventListener('error', function (e) {
      window._log.error('window', e.message || 'Unknown error', { file: e.filename, line: e.lineno, col: e.colno });
    });
    addEventListener('unhandledrejection', function (e) {
      var msg = e.reason instanceof Error ? e.reason.message : String(e.reason || 'Unknown rejection');
      window._log.error('window', 'Unhandled rejection: ' + msg);
    });
  }
})();
