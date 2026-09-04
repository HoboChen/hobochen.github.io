// Persist and restore the current reading location independently of whether
// navigation uses SPA fragments or full document loads.
document.addEventListener('DOMContentLoaded', function () {
  if (document.documentElement.classList.contains('link-preview-embed')) return;
  if (!document.body.dataset.spa && document.body.dataset.readingPersistence !== 'true') return;

  var lastLocationKey = 'kb-last-location';
  var lastScrollKey = 'kb-last-scroll-position';
  var resumeLastScrollKey = 'kb-resume-last-scroll';
  var lastSurfaceKey = 'kb-last-surface-state';
  var resumeSurfaceKey = 'kb-resume-surface-state';

  function currentResumePath() {
    var url = new URL(location.href);
    url.searchParams.delete('pwa');
    if ((url.pathname === '/' || url.pathname === '/index.html') && !url.search && !url.hash) return '/';
    return url.pathname + url.search + url.hash;
  }

  function isValidResumeLocation(path) {
    var pathname = path && path.split('#')[0].split('?')[0];
    return !!(path && /^\/[^/\\]/.test(path) && pathname !== '/' && pathname !== '/index.html');
  }

  function hasSameOriginReferrer() {
    try {
      return !!document.referrer && new URL(document.referrer, location.href).origin === location.origin;
    } catch (error) {
      return false;
    }
  }

  function isResumeLaunch() {
    if (/[?&]pwa=1(&|$)/.test(location.search)) return true;
    try {
      var url = new URL(location.href);
      url.searchParams.delete('pwa');
      return url.pathname === '/' && !url.search && !url.hash && !hasSameOriginReferrer();
    } catch (error) {
      return false;
    }
  }

  function readLastLocation() {
    try {
      return localStorage.getItem(lastLocationKey);
    } catch (error) {
      return null;
    }
  }

  function readLastSurfaceState() {
    try {
      var raw = localStorage.getItem(lastSurfaceKey);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function isSpecialSurfaceState(state) {
    return !!(state && (
      state.kind === 'pdf-annotator' ||
      state.kind === 'pdf-library' ||
      state.kind === 'whiteboard'
    ));
  }

  function detectCurrentSurfaceState(path) {
    var pdf = document.querySelector('#pdf-annotator-container');
    if (pdf) {
      var libraryDir = pdf.getAttribute('data-library-dir') || '';
      var pdfPath = pdf.getAttribute('data-pdf-path') || '';
      var pdfUrl = pdf.getAttribute('data-pdf-url') || '';
      if (pdfPath || pdfUrl) {
        var restoreState = null;
        try {
          if (window.__pdfAnnotator && typeof window.__pdfAnnotator.getNavigationRestoreState === 'function') {
            restoreState = window.__pdfAnnotator.getNavigationRestoreState();
          }
        } catch (error) {
          restoreState = null;
        }
        var state = {
          kind: 'pdf-annotator',
          path: path,
          libraryDir: libraryDir,
          pdfPath: pdfPath,
          pdfUrl: pdfUrl,
          pdfSize: pdf.getAttribute('data-pdf-size') || '',
          ts: Date.now()
        };
        if (restoreState && typeof restoreState.cropEnabled === 'boolean') {
          state.cropEnabled = restoreState.cropEnabled;
        }
        if (restoreState && Number.isFinite(Number(restoreState.translationMode))) {
          state.translationMode = Number(restoreState.translationMode);
        }
        return state;
      }
      if (libraryDir) {
        return { kind: 'pdf-library', path: path, libraryDir: libraryDir, ts: Date.now() };
      }
    }
    var whiteboard = document.querySelector('#whiteboard.ink-container') ||
      document.querySelector('.ink-container[data-wb-key]');
    if (whiteboard) {
      var whiteboardKey = whiteboard.getAttribute('data-wb-key') || '';
      if (whiteboardKey) {
        return { kind: 'whiteboard', path: path, wbKey: whiteboardKey, ts: Date.now() };
      }
    }
    return null;
  }

  function saveLastSurfaceState(path) {
    var state = detectCurrentSurfaceState(path);
    if (!state) return null;
    try {
      localStorage.setItem(lastSurfaceKey, JSON.stringify(state));
    } catch (error) {
      // Storage can be unavailable in private browsing.
    }
    return state;
  }

  function markResumeSurfaceForPath(path) {
    var state = readLastSurfaceState();
    if (!isSpecialSurfaceState(state) || state.path !== path) return null;
    try {
      sessionStorage.setItem(resumeSurfaceKey, JSON.stringify(state));
    } catch (error) {
      // Storage can be unavailable in private browsing.
    }
    return state;
  }

  function currentScrollY() {
    return Math.max(0, Math.round(
      window.scrollY || window.pageYOffset ||
      document.documentElement.scrollTop ||
      (document.body && document.body.scrollTop) || 0
    ));
  }

  function saveLastLocation() {
    try {
      var path = currentResumePath();
      localStorage.setItem(lastLocationKey, path);
      localStorage.setItem(lastScrollKey, JSON.stringify({
        path: path,
        y: currentScrollY(),
        ts: Date.now()
      }));
      saveLastSurfaceState(path);
    } catch (error) {
      // Storage can be unavailable in private browsing.
    }
  }

  function markResumeScroll() {
    try {
      sessionStorage.setItem(resumeLastScrollKey, '1');
    } catch (error) {
      // Storage can be unavailable in private browsing.
    }
  }

  function consumeResumeScrollRequest() {
    try {
      if (sessionStorage.getItem(resumeLastScrollKey) === '1') {
        sessionStorage.removeItem(resumeLastScrollKey);
        return true;
      }
    } catch (error) {
      // Storage can be unavailable in private browsing.
    }
    return false;
  }

  function restoreLastScrollPosition() {
    try {
      var raw = localStorage.getItem(lastScrollKey);
      if (!raw) return;
      var saved = JSON.parse(raw);
      var targetY = Math.max(0, Math.round(Number(saved && saved.y) || 0));
      if (!saved || saved.path !== currentResumePath() || targetY <= 0) return;
      var attempts = 0;
      var apply = function () {
        attempts += 1;
        if (typeof document === 'undefined' || !document.documentElement) return;
        var docEl = document.documentElement;
        var body = document.body;
        var scrollHeight = Math.max(docEl.scrollHeight || 0, body ? body.scrollHeight || 0 : 0);
        var viewportHeight = window.innerHeight || docEl.clientHeight || 0;
        var maxY = Math.max(0, scrollHeight - viewportHeight);
        window.scrollTo(0, maxY > 0 ? Math.min(targetY, maxY) : targetY);
        if (attempts < 8 && scrollHeight > viewportHeight && maxY < targetY) {
          setTimeout(apply, 100);
        }
      };
      if (window.requestAnimationFrame) window.requestAnimationFrame(apply);
      else setTimeout(apply, 0);
      if (document.readyState !== 'complete') {
        window.addEventListener('load', apply, { once: true });
      }
    } catch (error) {
      // Ignore corrupt saved scroll state.
    }
  }

  window.ReadingNavigationState = {
    save: saveLastLocation
  };

  var lastLocationAtBoot = readLastLocation();
  var currentPathAtBoot = currentResumePath();
  var hasResumeScrollRequest = consumeResumeScrollRequest();
  var isColdDirectResume = !hasSameOriginReferrer() &&
    isValidResumeLocation(currentPathAtBoot) &&
    lastLocationAtBoot === currentPathAtBoot;
  var shouldRestoreScroll = hasResumeScrollRequest || isColdDirectResume;
  var resumeSurfaceAtBoot = shouldRestoreScroll
    ? markResumeSurfaceForPath(currentPathAtBoot)
    : null;
  var shouldRestoreDocumentScroll = shouldRestoreScroll &&
    !isSpecialSurfaceState(resumeSurfaceAtBoot);
  if (isResumeLaunch()) {
    var lastLocation = lastLocationAtBoot;
    if (isValidResumeLocation(lastLocation) && lastLocation !== currentResumePath()) {
      markResumeScroll();
      markResumeSurfaceForPath(lastLocation);
      location.replace(lastLocation);
      return;
    }
    try {
      var cleaned = new URL(location.href);
      cleaned.searchParams.delete('pwa');
      history.replaceState(null, '', cleaned.pathname + cleaned.search + cleaned.hash);
    } catch (error) {
      // Keep the original URL when History is unavailable.
    }
  }
  if (shouldRestoreDocumentScroll) restoreLastScrollPosition();
  else saveLastLocation();
  window.addEventListener('pagehide', saveLastLocation);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveLastLocation();
  });
  document.addEventListener('rprint:surface-state-changed', saveLastLocation);
});
