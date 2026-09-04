/**
 * features/pdf/client/pdf-inline.js — lightweight paged PDF previews for
 * Markdown `pdf-inline-viewer` images (canonical implementation; public
 * `/static/pdf-inline.js`, classic script — see src/features/shell/client-assets.js).
 */
(function () {
  'use strict';

  var PDFJS_VERSION = '5.6.205';
  var PDFJS_BASE = '/static/vendor/pdfjs-' + PDFJS_VERSION;
  var PDFJS_WASM_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/wasm/';
  var PDFJS_CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/cmaps/';
  var PDFJS_STANDARD_FONTS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/standard_fonts/';
  var NATURAL_SCALE = 96 / 72;
  var MAX_CANVAS_PIXELS = 2 ** 25;
  var VIEWPORT_VERTICAL_GAP = 96;

  var pdfjsPromise = null;
  var instances = new Set();

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
    pdfjsPromise = import(PDFJS_BASE + '/pdf.min.mjs').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + '/pdf.worker.min.mjs';
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

    async function renderPage() {
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
      if (state.pdfDocument && typeof state.pdfDocument.destroy === 'function') state.pdfDocument.destroy();
      else if (state.loadingTask && typeof state.loadingTask.destroy === 'function') state.loadingTask.destroy();
      previousButton.removeEventListener('click', state.onPrevious);
      nextButton.removeEventListener('click', state.onNext);
      window.removeEventListener('resize', scheduleRender);
      instances.delete(state);
      container.removeAttribute('data-pdf-inline-init');
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

    getPdfjs().then(function (pdfjs) {
      if (state.destroyed) return;
      state.loadingTask = pdfjs.lib.getDocument({
        url: fallback.href,
        wasmUrl: PDFJS_WASM_URL,
        cMapUrl: PDFJS_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
        disableAutoFetch: true,
        disableStream: true,
        worker: pdfjs.worker,
      });
      return state.loadingTask.promise;
    }).then(function (pdfDocument) {
      if (!pdfDocument || state.destroyed) {
        if (pdfDocument && typeof pdfDocument.destroy === 'function') pdfDocument.destroy();
        return;
      }
      state.pdfDocument = pdfDocument;
      controls.hidden = pdfDocument.numPages <= 1;
      updateControls();
      renderPage();
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
    Array.from(instances).forEach(function (state) {
      if (!state.container.isConnected) state.cleanup();
    });

    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.pdf-inline-viewer:not([data-pdf-inline-init])').forEach(createInstance);
  }

  window.initInlinePdfViewers = initInlinePdfViewers;
  window.__pdfInlineTest = {
    calculateFitScale: calculateFitScale,
    cleanup: function () { Array.from(instances).forEach(function (state) { state.cleanup(); }); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initInlinePdfViewers(document); }, { once: true });
  } else {
    initInlinePdfViewers(document);
  }
}());
