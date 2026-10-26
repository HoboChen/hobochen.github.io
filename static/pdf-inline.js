/**
 * features/pdf/client/pdf-inline.js — lightweight paged PDF previews for
 * Markdown `pdf-inline-viewer` images (canonical implementation; public
 * `/static/pdf-inline.js`, classic script — see src/features/shell/client-assets.js).
 */
(function () {
  'use strict';

  var PDFJS_VERSION = '6.4.299';
  var PDFJS_BASE = '/static/vendor/pdfjs-' + PDFJS_VERSION;
  var PDFJS_ASSET_REVISION = 'rprint-intelligent-dark-v12';
  var PDFJS_ASSET_QUERY = '?v=' + PDFJS_ASSET_REVISION;
  var PDFJS_WASM_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/wasm/';
  var PDFJS_CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/cmaps/';
  var PDFJS_STANDARD_FONTS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/standard_fonts/';
  var NATURAL_SCALE = 96 / 72;
  var MAX_CANVAS_PIXELS = 2 ** 25;
  var VIEWPORT_VERTICAL_GAP = 96;

  var pdfjsPromise = null;
  var instances = new Set();
  var pendingDisposals = [];

  // Keep the classic-script resolver aligned with pdfaResolvePdfSource in viewer core.
  async function resolvePdfSource(originalUrl) {
    const original = { url: originalUrl, validated: false };
    if (typeof window === 'undefined' || !window.location || typeof fetch !== 'function'
        || (typeof navigator !== 'undefined' && navigator.onLine === false)) return original;
    let source;
    let logicalPath;
    try {
      source = new URL(originalUrl, window.location.href);
      if (source.origin !== window.location.origin || !/^https?:$/.test(source.protocol)
          || !/\.pdf$/i.test(source.pathname)) return original;
      logicalPath = decodeURIComponent(source.pathname).replace(/^\//, '');
    } catch (_) { return original; }
    const controller = new AbortController();
    let timer;
    try {
      const lookup = (async () => {
        const response = await fetch('/api/pdf-source?' + new URLSearchParams({ path: logicalPath }), {
          cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        });
        if (!response.ok) return original;
        const result = await response.json();
        if (typeof result?.url !== 'string') return original;
        const resolved = new URL(result.url, window.location.href);
        if (resolved.origin !== source.origin || resolved.username || resolved.password) return original;
        if (resolved.pathname === '/api/pdf-source') {
          if (resolved.searchParams.get('path') !== logicalPath
              || !/^[a-f0-9]{64}$/.test(resolved.searchParams.get('revision') || '')) return original;
        } else if (!/\.pdf$/i.test(resolved.pathname)) return original;
        // Only a pinned revision can carry server-verified page-count evidence.
        return { url: resolved.href, validated: resolved.pathname === '/api/pdf-source' && result.validated === true };
      })();
      return await Promise.race([lookup, new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(original); }, 500);
      })]);
    } catch (_) { return original; }
    finally { clearTimeout(timer); }
  }

  async function resolvePdfUrl(originalUrl) {
    return (await resolvePdfSource(originalUrl)).url;
  }

  // A prepared copy is optional even after selection. Failed loads must discard
  // their own task before this starts a fresh document from the original bytes.
  async function loadPdfSource(originalUrl, source, load) {
    const readUrl = typeof source === 'string' ? source : source.url;
    try { return await load(readUrl, source.validated === true); }
    catch (error) {
      if (['AbortError', 'TimeoutError', 'RenderingCancelledException'].includes(error?.name)) throw error;
      let prepared = false;
      try {
        const url = new URL(readUrl, window.location.href);
        prepared = url.origin === window.location.origin && url.pathname === '/api/pdf-source'
          && /^[a-f0-9]{64}$/.test(url.searchParams.get('revision') || '');
      } catch (_) {}
      if (!prepared) throw error;
      return load(originalUrl, false);
    }
  }

  // A raw library URL may be replaced by the background optimizer between
  // requests. Read that attempt through one streaming response so its opened
  // inode supplies every byte. Pinned revisions and packaged hosts keep ranges.
  function pdfSourceOptions(selectedUrl, validated = false) {
    const options = validated === true ? { rprintSkipLastPageCheck: true } : {};
    if (typeof window === 'undefined' || !window.location
        || window.RPRINT_APP?.bundledContent === true) return options;
    try {
      const source = new URL(selectedUrl, window.location.href);
      if (source.origin !== window.location.origin || !/^https?:$/.test(source.protocol)) return options;
      if (source.pathname === '/api/pdf-source'
          && /^[a-f0-9]{64}$/.test(source.searchParams.get('revision') || '')) return options;
      if (/\.pdf$/i.test(source.pathname)) return { ...options, disableRange: true, disableStream: false };
    } catch (_) {}
    return options;
  }

  function reportCleanupError(error) {
    console.error('pdf-inline: cleanup failed', error);
  }

  function disposeDocument(documentOrTask) {
    // PDF.js 6.x exposes document disposal on its owning loading task.
    documentOrTask = documentOrTask && (documentOrTask.loadingTask || documentOrTask);
    if (!documentOrTask || typeof documentOrTask.destroy !== 'function') return Promise.resolve();
    try {
      return Promise.resolve(documentOrTask.destroy()).catch(reportCleanupError);
    } catch (error) {
      reportCleanupError(error);
      return Promise.resolve();
    }
  }

  function releaseIdleWorker() {
    if (instances.size || !pdfjsPromise) return;
    var resource = pdfjsPromise;
    var disposals = pendingDisposals;
    pdfjsPromise = null;
    pendingDisposals = [];
    Promise.all(disposals).then(function () { return resource; }).then(function (pdfjs) {
      if (pdfjs.worker && typeof pdfjs.worker.destroy === 'function') pdfjs.worker.destroy();
    }).catch(reportCleanupError);
  }

  function calculateFitScale(naturalWidth, naturalHeight, availableWidth, availableHeight) {
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) return 1;
    var widthScale = availableWidth > 0 ? availableWidth / naturalWidth : 1;
    var heightScale = availableHeight > 0 ? availableHeight / naturalHeight : 1;
    return Math.max(0.01, Math.min(1, widthScale, heightScale));
  }

  function getPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    if (typeof window.__pdfInlineLoadPdfjs === 'function') {
      pdfjsPromise = Promise.resolve().then(window.__pdfInlineLoadPdfjs);
      return pdfjsPromise;
    }
    pdfjsPromise = import(PDFJS_BASE + '/pdf.compat.mjs' + PDFJS_ASSET_QUERY).then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + '/pdf.worker.compat.mjs' + PDFJS_ASSET_QUERY;
      return {
        lib: lib,
        worker: new lib.PDFWorker({ name: 'rprint-inline-pdf-worker' }),
      };
    });
    return pdfjsPromise;
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"></path></svg>';
  }

  function viewportAvailableHeight(controls) {
    var bannerValue = getComputedStyle(document.documentElement).getPropertyValue('--banner-height');
    var banner = document.querySelector('.top-banner');
    var bannerHeight = banner ? banner.getBoundingClientRect().height : 0;
    if (!(bannerHeight > 0)) bannerHeight = parseFloat(bannerValue) || 0;
    var controlsHeight = controls ? controls.getBoundingClientRect().height : 0;
    return Math.max(120, window.innerHeight - bannerHeight - controlsHeight - VIEWPORT_VERTICAL_GAP);
  }

  function createInstance(container) {
    var fallback = container.querySelector('.pdf-inline-fallback');
    if (!fallback || !fallback.href) return null;

    var label = (fallback.textContent || '').trim() || 'PDF';
    var frame = document.createElement('span');
    frame.className = 'pdf-inline-frame';
    frame.innerHTML =
      '<span class="pdf-inline-stage" role="img" aria-label="' + escapeAttribute(label) + '">' +
        '<span class="pdf-inline-status">Loading PDF...</span>' +
      '</span>' +
      '<span class="pdf-inline-controls" hidden>' +
        '<button type="button" class="pdf-inline-prev" title="Previous page" aria-label="Previous page">' + icon('m15 18-6-6 6-6') + '</button>' +
        '<span class="pdf-inline-page" aria-live="polite">1 / 1</span>' +
        '<button type="button" class="pdf-inline-next" title="Next page" aria-label="Next page">' + icon('m9 18 6-6-6-6') + '</button>' +
      '</span>';

    var stage = frame.querySelector('.pdf-inline-stage');
    var status = frame.querySelector('.pdf-inline-status');
    var controls = frame.querySelector('.pdf-inline-controls');
    var previousButton = frame.querySelector('.pdf-inline-prev');
    var nextButton = frame.querySelector('.pdf-inline-next');
    var pageLabel = frame.querySelector('.pdf-inline-page');
    container.insertBefore(frame, fallback);

    var state = {
      container: container,
      frame: frame,
      fallback: fallback,
      stage: stage,
      controls: controls,
      previousButton: previousButton,
      nextButton: nextButton,
      pageLabel: pageLabel,
      loadingTask: null,
      pdfDocument: null,
      renderTask: null,
      resizeObserver: null,
      resizeFrame: 0,
      pageNumber: 1,
      renderGeneration: 0,
      destroyed: false,
    };

    function updateControls() {
      var total = state.pdfDocument ? state.pdfDocument.numPages : 1;
      pageLabel.textContent = state.pageNumber + ' / ' + total;
      previousButton.disabled = state.pageNumber <= 1;
      nextButton.disabled = state.pageNumber >= total;
    }

    function scheduleRender() {
      if (state.destroyed || !state.pdfDocument) return;
      if (state.resizeFrame) cancelAnimationFrame(state.resizeFrame);
      state.resizeFrame = requestAnimationFrame(function () {
        state.resizeFrame = 0;
        renderPage();
      });
    }

    async function renderPage(propagateError) {
      if (state.destroyed || !state.pdfDocument) return;
      var generation = ++state.renderGeneration;
      if (state.renderTask && typeof state.renderTask.cancel === 'function') state.renderTask.cancel();
      state.renderTask = null;

      try {
        var page = await state.pdfDocument.getPage(state.pageNumber);
        if (state.destroyed || generation !== state.renderGeneration) return;

        var naturalViewport = page.getViewport({ scale: NATURAL_SCALE });
        var availableWidth = state.container.getBoundingClientRect().width || naturalViewport.width;
        var fitScale = calculateFitScale(
          naturalViewport.width,
          naturalViewport.height,
          availableWidth,
          viewportAvailableHeight(controls)
        );
        var cssViewport = page.getViewport({ scale: NATURAL_SCALE * fitScale });
        var dpr = Math.max(1, window.devicePixelRatio || 1);
        var pixelCount = cssViewport.width * cssViewport.height * dpr * dpr;
        if (pixelCount > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / pixelCount);
        var renderViewport = page.getViewport({ scale: NATURAL_SCALE * fitScale * dpr });

        var canvas = document.createElement('canvas');
        canvas.className = 'pdf-inline-canvas';
        canvas.width = Math.max(1, Math.round(renderViewport.width));
        canvas.height = Math.max(1, Math.round(renderViewport.height));
        canvas.style.width = Math.round(cssViewport.width) + 'px';
        canvas.style.height = Math.round(cssViewport.height) + 'px';
        canvas.setAttribute('aria-label', label + ', page ' + state.pageNumber);

        var context = canvas.getContext('2d', { alpha: false });
        var task = page.render({ canvasContext: context, viewport: renderViewport });
        state.renderTask = task;
        await task.promise;
        if (state.destroyed || generation !== state.renderGeneration) return;

        stage.replaceChildren(canvas);
        fallback.hidden = true;
        controls.hidden = state.pdfDocument.numPages <= 1;
        updateControls();
      } catch (error) {
        if (error && error.name === 'RenderingCancelledException') return;
        if (state.destroyed || generation !== state.renderGeneration) return;
        if (propagateError) throw error;
        status.textContent = 'Unable to preview PDF';
        stage.replaceChildren(status);
        fallback.hidden = false;
        controls.hidden = true;
      } finally {
        if (generation === state.renderGeneration) state.renderTask = null;
      }
    }

    function goTo(delta) {
      if (!state.pdfDocument) return;
      var nextPage = Math.max(1, Math.min(state.pdfDocument.numPages, state.pageNumber + delta));
      if (nextPage === state.pageNumber) return;
      state.pageNumber = nextPage;
      updateControls();
      renderPage();
    }

    function cleanup() {
      if (state.destroyed) return;
      state.destroyed = true;
      state.renderGeneration++;
      if (state.resizeFrame) cancelAnimationFrame(state.resizeFrame);
      if (state.resizeObserver) state.resizeObserver.disconnect();
      if (state.renderTask && typeof state.renderTask.cancel === 'function') state.renderTask.cancel();
      pendingDisposals.push(disposeDocument(state.pdfDocument || state.loadingTask));
      previousButton.removeEventListener('click', state.onPrevious);
      nextButton.removeEventListener('click', state.onNext);
      window.removeEventListener('resize', scheduleRender);
      instances.delete(state);
      container.removeAttribute('data-pdf-inline-init');
      frame.remove();
      fallback.hidden = false;
      releaseIdleWorker();
    }

    state.onPrevious = function () { goTo(-1); };
    state.onNext = function () { goTo(1); };
    state.cleanup = cleanup;
    previousButton.addEventListener('click', state.onPrevious);
    nextButton.addEventListener('click', state.onNext);
    window.addEventListener('resize', scheduleRender);

    if (typeof ResizeObserver === 'function') {
      state.resizeObserver = new ResizeObserver(scheduleRender);
      state.resizeObserver.observe(container);
    }

    container.setAttribute('data-pdf-inline-init', '1');
    instances.add(state);

    Promise.all([getPdfjs(), resolvePdfSource(fallback.href)]).then(function (resources) {
      var pdfjs = resources[0];
      var readUrl = resources[1];
      return loadPdfSource(fallback.href, readUrl, async function (selectedUrl, validated) {
        if (state.destroyed) throw new DOMException('PDF preview was destroyed', 'AbortError');
        var task;
        try {
          task = pdfjs.lib.getDocument({
            url: selectedUrl,
            wasmUrl: PDFJS_WASM_URL,
            cMapUrl: PDFJS_CMAP_URL,
            cMapPacked: true,
            standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
            disableAutoFetch: true,
            disableStream: true,
            ...pdfSourceOptions(selectedUrl, validated),
            worker: pdfjs.worker,
          });
          state.loadingTask = task;
          var pdfDocument = await task.promise;
          if (state.destroyed) throw new DOMException('PDF preview was destroyed', 'AbortError');
          state.pdfDocument = pdfDocument;
          controls.hidden = pdfDocument.numPages <= 1;
          updateControls();
          await renderPage(true);
          return pdfDocument;
        } catch (error) {
          try { if (state.renderTask) state.renderTask.cancel(); } catch (_) {}
          void disposeDocument(task);
          state.pdfDocument = state.loadingTask = null;
          if (state.destroyed) throw new DOMException('PDF preview was destroyed', 'AbortError');
          throw error;
        }
      });
    }).catch(function () {
      if (state.destroyed) return;
      status.textContent = 'Unable to preview PDF';
      fallback.hidden = false;
      controls.hidden = true;
    });

    return state;
  }

  function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function initInlinePdfViewers(root) {
    document.removeEventListener('DOMContentLoaded', initializeStandalone);
    Array.from(instances).forEach(function (state) {
      if (!state.container.isConnected) state.cleanup();
    });

    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches('.pdf-inline-viewer:not([data-pdf-inline-init])')) createInstance(scope);
    scope.querySelectorAll('.pdf-inline-viewer:not([data-pdf-inline-init])').forEach(createInstance);
    var mounted = Array.from(instances).filter(function (state) {
      return state.container === scope || scope.contains(state.container);
    });
    return function disposeInlinePdfViewers() {
      mounted.forEach(function (state) { state.cleanup(); });
    };
  }

  window.initInlinePdfViewers = initInlinePdfViewers;
  window.__pdfInlineTest = {
    calculateFitScale: calculateFitScale,
    cleanup: function () { Array.from(instances).forEach(function (state) { state.cleanup(); }); },
  };

  function initializeStandalone() {
    initInlinePdfViewers(document);
  }

  if (window.RprintPageModules) {
    window.RprintPageModules.register({ id: 'pdf.inline', mount: initInlinePdfViewers });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeStandalone, { once: true });
  } else {
    initInlinePdfViewers(document);
  }
}());
