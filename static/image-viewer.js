/* Full-page inspection of wide reading images without changing the source DOM. */
(function () {
  'use strict';

  var SELECTOR = 'img, svg, object[type="image/svg+xml"], embed[type="image/svg+xml"]';
  var EXCLUDED = '.katex, .math, mjx-container, button, [role="button"], .image-viewer-dialog, '
    + '.ink-container, .pdf-viewer, .pdf-annotator, .whiteboard, .syllabus-dag, [data-image-viewer="off"]';
  var activeDispose = null;
  var serial = 0;

  function pixelLength(value) {
    return /^\d+(\.\d+)?(px)?$/.test(value || '') ? parseFloat(value) : 0;
  }

  function dimensions(el) {
    var rect = el.getBoundingClientRect();
    var width = el.naturalWidth || 0;
    var height = el.naturalHeight || 0;
    var svg = el.tagName.toLowerCase() === 'svg' ? el : null;
    if (!svg && /^(object|embed)$/i.test(el.tagName)) {
      try { svg = el.contentDocument && el.contentDocument.querySelector('svg'); } catch (_) { /* cross-origin */ }
    }
    if (svg) {
      var box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      width = pixelLength(svg.getAttribute('width')) || pixelLength(svg.style.width)
        || pixelLength(svg.style.maxWidth) || (box.length === 4 && box[2]) || rect.width;
      height = pixelLength(svg.getAttribute('height')) || pixelLength(svg.style.height)
        || (box.length === 4 && box[2] > 0 && box[3] > 0 ? width * box[3] / box[2] : rect.height);
    }
    return { width: width || rect.width, height: height || rect.height };
  }

  function bounds(el) {
    var article = el.closest('.article');
    var limit = { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    var banner = document.querySelector('.top-banner');
    if (banner) limit.top = Math.max(0, banner.getBoundingClientRect().bottom);
    var width = window.innerWidth;
    for (var parent = el.parentElement; parent; parent = parent.parentElement) {
      var rect = parent.getBoundingClientRect();
      var style = getComputedStyle(parent);
      if (rect.width && style.display !== 'inline') {
        var left = rect.left + (parseFloat(style.paddingLeft) || 0);
        var right = rect.right - (parseFloat(style.paddingRight) || 0);
        width = Math.min(width, right - left);
        limit.left = Math.max(limit.left, left);
        limit.right = Math.min(limit.right, right);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        limit.top = Math.max(limit.top, rect.top);
        limit.bottom = Math.min(limit.bottom, rect.bottom);
      }
      if (parent === article) break;
    }
    limit.width = width;
    return limit;
  }

  // Snapshot computed paints/fonts so SVGs styled by article CSS remain legible
  // outside it. Unique IDs preserve markers/clip paths without colliding with
  // the live Mermaid/TikZ diagram; the original and its event handlers stay put.
  function copyVisual(source) {
    if (source.tagName.toLowerCase() !== 'svg') {
      var img = document.createElement('img');
      img.src = source.currentSrc || source.src || source.getAttribute('data');
      img.alt = source.getAttribute('alt') || '';
      img.draggable = false;
      img.style.filter = getComputedStyle(source).filter;
      return img;
    }
    var clone = source.cloneNode(true);
    var originals = [source].concat(Array.from(source.querySelectorAll('*')));
    var copies = [clone].concat(Array.from(clone.querySelectorAll('*')));
    var ids = new Map();
    var prefix = 'image-viewer-' + (++serial) + '-';
    var properties = ['color', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
      'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size',
      'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-anchor', 'dominant-baseline',
      'white-space', 'background-color', 'visibility', 'display', 'fill-rule', 'clip-rule',
      'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'mask', 'filter',
      'stop-color', 'stop-opacity', 'paint-order', 'text-decoration', 'text-align',
      'transform', 'transform-origin', 'rx', 'ry'];
    originals.forEach(function (el, index) {
      if (el.id) ids.set(el.id, prefix + index);
      if (el.tagName.toLowerCase() === 'style') return;
      var style = getComputedStyle(el);
      properties.forEach(function (name) {
        var value = style.getPropertyValue(name);
        if (value) copies[index].style.setProperty(name, value);
      });
    });
    function references(value) {
      return value.replace(/url\(\s*(['"]?)([^)'"\s]*?)#([^)'"\s]+)\1\s*\)/g, function (match, quote, url, id) {
        if (url && url !== location.href.split('#')[0]) return match;
        return ids.has(id) ? 'url(#' + ids.get(id) + ')' : match;
      });
    }
    copies.forEach(function (el) {
      if (/^(script|style)$/i.test(el.tagName)) { el.remove(); return; }
      Array.from(el.attributes).forEach(function (attr) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        else if (attr.name === 'id') el.id = ids.get(attr.value);
        else if (/^(aria-labelledby|aria-describedby)$/.test(attr.name)) {
          el.setAttribute(attr.name, attr.value.split(/\s+/).map(function (id) { return ids.get(id) || id; }).join(' '));
        } else if (/^(href|xlink:href)$/.test(attr.name) && ids.has(attr.value.slice(1))) {
          el.setAttribute(attr.name, '#' + ids.get(attr.value.slice(1)));
        } else el.setAttribute(attr.name, references(attr.value));
      });
      if (el.tagName.toLowerCase() === 'a') {
        el.removeAttribute('href');
        el.removeAttribute('xlink:href');
      }
      el.removeAttribute('autofocus');
      if (el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    });
    return clone;
  }

  function init(root) {
    if (activeDispose) activeDispose();
    if (document.documentElement.classList.contains('link-preview-embed')) return function () {};
    var scope = root || document;
    var records = new Map();
    var bindings = [];
    var disposed = false;
    var frame = 0;
    var rescan = false;
    var viewer = null;
    var observer;
    var resizeObserver;

    function listen(target, type, handler, options, list) {
      target.addEventListener(type, handler, options);
      (list || bindings).push(function () { target.removeEventListener(type, handler, options); });
    }
    function close() {
      if (!viewer) return;
      var previous = viewer;
      viewer = null;
      previous.bindings.forEach(function (remove) { remove(); });
      previous.dialog.remove();
      document.documentElement.classList.remove('image-viewer-open');
      measure();
      if (previous.focus && previous.focus.isConnected) previous.focus.focus({ preventScroll: true });
    }
    function open(record) {
      close();
      var size = dimensions(record.el);
      if (!(size.width > 0 && size.height > 0)) return;
      var dialog = document.createElement('dialog');
      dialog.className = 'image-viewer-dialog';
      dialog.setAttribute('aria-label', 'Image viewer');
      dialog.setAttribute('aria-modal', 'true');
      var IT = window.InkToolbar;
      var toolbar = IT.makeL1Toolbar();
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Image controls');
      function addControl(icon, name, label, title) {
        var button = IT.makeL1Btn(icon, name, title || label);
        button.type = 'button';
        button.dataset.imageViewerAction = name;
        button.setAttribute('aria-label', label);
        toolbar.appendChild(button);
      }
      addControl(IT.ICONS.zoomOut, 'zoom-out', 'Zoom out', 'Zoom out (Ctrl/Cmd −)');
      var readout = document.createElement('output');
      readout.className = 'image-viewer-zoom';
      readout.setAttribute('aria-label', 'Zoom level');
      toolbar.appendChild(readout);
      addControl(IT.ICONS.zoomIn, 'zoom-in', 'Zoom in', 'Zoom in (Ctrl/Cmd +)');
      toolbar.appendChild(IT.makeL1Sep());
      addControl(IT.ICONS.reset, 'fit', 'Fit to window', 'Fit to window (Ctrl/Cmd 0)');
      addControl('1:1', 'actual', 'Original size');
      addControl(IT.ICONS.close, 'close', 'Close image viewer', 'Close (Esc)');
      dialog.appendChild(toolbar);
      var stage = document.createElement('div');
      stage.className = 'image-viewer-stage';
      stage.innerHTML = '<div class="image-viewer-content"></div>';
      dialog.appendChild(stage);
      var content = dialog.querySelector('.image-viewer-content');
      content.style.width = size.width + 'px';
      content.style.height = size.height + 'px';
      content.appendChild(copyVisual(record.el));
      var state = { dialog: dialog, bindings: [], source: record.el, focus: document.activeElement,
        scale: 1, x: 0, y: 0, fitting: true, pointers: new Map() };
      viewer = state;
      document.body.appendChild(dialog);
      measure();
      document.documentElement.classList.add('image-viewer-open');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');

      function fitScale() { return Math.min(1, Math.max(1, stage.clientWidth - 40) / size.width, Math.max(1, stage.clientHeight - 40) / size.height); }
      function draw() {
        // Keep an edge in reach after panning; Fit always recenters the whole image.
        state.x = Math.max(-size.width * state.scale + 40, Math.min(stage.clientWidth - 40, state.x));
        state.y = Math.max(-size.height * state.scale + 40, Math.min(stage.clientHeight - 40, state.y));
        content.style.transform = 'translate(' + state.x + 'px, ' + state.y + 'px) scale(' + state.scale + ')';
        dialog.querySelector('.image-viewer-zoom').textContent = Math.round(state.scale * 100) + '%';
        dialog.querySelector('[data-image-viewer-action="zoom-out"]').disabled = state.scale <= Math.min(.05, fitScale()) + .00001;
        dialog.querySelector('[data-image-viewer-action="zoom-in"]').disabled = state.scale >= 8;
      }
      function fit() {
        state.scale = fitScale();
        state.x = (stage.clientWidth - size.width * state.scale) / 2;
        state.y = (stage.clientHeight - size.height * state.scale) / 2;
        state.fitting = true;
        draw();
      }
      function zoom(scale, x, y) {
        scale = Math.max(Math.min(.05, fitScale()), Math.min(8, scale));
        x = x === undefined ? stage.clientWidth / 2 : x;
        y = y === undefined ? stage.clientHeight / 2 : y;
        var ratio = scale / state.scale;
        state.x = x - (x - state.x) * ratio;
        state.y = y - (y - state.y) * ratio;
        state.scale = scale;
        state.fitting = false;
        draw();
      }
      function action(name) {
        if (name === 'close') close();
        else if (name === 'fit') fit();
        else if (name === 'actual') zoom(1);
        else if (name === 'zoom-in') zoom(state.scale * 1.25);
        else if (name === 'zoom-out') zoom(state.scale / 1.25);
      }
      listen(dialog, 'click', function (event) {
        var button = event.target.closest('[data-image-viewer-action]');
        if (button) action(button.dataset.imageViewerAction);
      }, false, state.bindings);
      listen(dialog, 'cancel', function (event) { event.preventDefault(); close(); }, false, state.bindings);
      listen(document, 'keydown', function (event) {
        var key = event.key;
        var handled = true;
        if (key === 'Escape') close();
        else if (key === '+' || key === '=' || key === 'Add') zoom(state.scale * 1.25);
        else if (key === '-' || key === '_' || key === 'Subtract') zoom(state.scale / 1.25);
        else if (key === '0' || key === 'Home') fit();
        else if (/^Arrow(Left|Right|Up|Down)$/.test(key)) {
          var step = event.shiftKey ? 120 : 40;
          state.x += key === 'ArrowLeft' ? step : key === 'ArrowRight' ? -step : 0;
          state.y += key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0;
          state.fitting = false;
          draw();
        } else if (key === 'Tab') {
          var buttons = Array.from(dialog.querySelectorAll('button:not(:disabled)'));
          var index = buttons.indexOf(document.activeElement);
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        } else handled = false;
        if (handled) event.preventDefault();
        // Reading shortcuts must not operate on the page behind the modal.
        event.stopImmediatePropagation();
      }, true, state.bindings);
      listen(stage, 'wheel', function (event) {
        event.preventDefault();
        var rect = stage.getBoundingClientRect();
        var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
        zoom(state.scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * .002), event.clientX - rect.left, event.clientY - rect.top);
      }, { passive: false }, state.bindings);
      listen(stage, 'dblclick', function (event) {
        event.preventDefault();
        var rect = stage.getBoundingClientRect();
        if (state.scale >= 1) fit();
        else zoom(Math.min(1, state.scale * 2), event.clientX - rect.left, event.clientY - rect.top);
      }, false, state.bindings);
      listen(stage, 'pointerdown', function (event) {
        if (event.button !== 0) return;
        event.preventDefault();
        state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
        stage.classList.add('is-dragging');
      }, false, state.bindings);
      listen(stage, 'pointermove', function (event) {
        if (!state.pointers.has(event.pointerId)) return;
        var before = Array.from(state.pointers.values());
        var old = state.pointers.get(event.pointerId);
        state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        var after = Array.from(state.pointers.values());
        if (after.length === 2) {
          var rect = stage.getBoundingClientRect();
          var distance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
          var nextDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
          if (distance > 0) zoom(state.scale * nextDistance / distance,
            (before[0].x + before[1].x) / 2 - rect.left, (before[0].y + before[1].y) / 2 - rect.top);
          state.x += (event.clientX - old.x) / 2;
          state.y += (event.clientY - old.y) / 2;
        } else {
          state.x += event.clientX - old.x;
          state.y += event.clientY - old.y;
        }
        state.fitting = false;
        draw();
      }, false, state.bindings);
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
        listen(stage, type, function (event) {
          state.pointers.delete(event.pointerId);
          if (!state.pointers.size) stage.classList.remove('is-dragging');
        }, false, state.bindings);
      });
      listen(window, 'resize', function () { if (state.fitting) fit(); else draw(); }, false, state.bindings);
      listen(window, 'beforeprint', close, false, state.bindings);
      fit();
      dialog.querySelector('[data-image-viewer-action="close"]').focus({ preventScroll: true });
    }

    function removeRecord(record) {
      if (viewer && viewer.source === record.el) close();
      record.bindings.forEach(function (remove) { remove(); });
      if (resizeObserver) resizeObserver.unobserve(record.el);
      record.button.remove();
      records.delete(record.el);
    }
    function scan() {
      records.forEach(function (record) {
        if (!scope.contains(record.el) || !record.el.isConnected) removeRecord(record);
      });
      scope.querySelectorAll(SELECTOR).forEach(function (el) {
        if (records.has(el) || !el.closest('.article') || el.closest(EXCLUDED)
            || el.parentElement.closest('svg') || el.getAttribute('aria-hidden') === 'true') return;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'code-copy-btn image-viewer-trigger';
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
          + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          + '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
        button.setAttribute('aria-label', 'View image fullscreen');
        button.setAttribute('aria-haspopup', 'dialog');
        button.title = 'Fullscreen';
        button.hidden = true;
        var hoverTarget = el.closest('pre.mermaid, .tikz-block, picture') || el;
        var record = { el: el, button: button, hoverTarget: hoverTarget, bindings: [] };
        records.set(el, record);
        document.body.appendChild(button);
        listen(hoverTarget, 'pointerenter', function () { button.classList.add('is-hovered'); }, false, record.bindings);
        listen(hoverTarget, 'pointerleave', function () { button.classList.remove('is-hovered'); }, false, record.bindings);
        listen(button, 'click', function (event) { event.preventDefault(); event.stopPropagation(); open(record); }, false, record.bindings);
        if (resizeObserver) resizeObserver.observe(el);
      });
    }
    function measure() {
      records.forEach(function (record) {
        var rect = record.el.getBoundingClientRect();
        var limit = bounds(record.el);
        var size = dimensions(record.el);
        var wide = Math.max(size.width, rect.width) > limit.width + 2;
        var visible = rect.width > 0 && rect.height > 0 && rect.bottom > limit.top + 32
          && rect.top < limit.bottom - 32 && rect.right > limit.left && rect.left < limit.right
          && getComputedStyle(record.el).visibility !== 'hidden';
        // Mounting or replacing a diagram under a stationary pointer does not
        // send pointerenter to the new record. Reconcile the current hover state.
        record.button.classList.toggle('is-hovered', record.hoverTarget.matches(':hover'));
        record.button.hidden = !wide || !visible || !!viewer;
        record.button.style.left = Math.min(rect.right, limit.right) - 6 - record.button.offsetWidth + 'px';
        record.button.style.top = Math.max(rect.top, limit.top) + 6 + 'px';
      });
    }
    function schedule(needsScan) {
      if (disposed) return;
      rescan = rescan || needsScan === true;
      if (frame) return;
      frame = window.requestAnimationFrame(function () {
        frame = 0;
        if (rescan) { rescan = false; scan(); }
        measure();
      });
    }
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(function () { schedule(); });
      scope.querySelectorAll('.article').forEach(function (article) { resizeObserver.observe(article); });
      if (scope.matches && scope.matches('.article')) resizeObserver.observe(scope);
    }
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(function (mutations) {
        if (mutations.some(function (mutation) {
          return mutation.target.closest && mutation.target.closest('.article');
        })) schedule(true);
      });
      observer.observe(scope, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['src', 'srcset', 'width', 'height', 'viewBox', 'style', 'class'] });
    }
    listen(scope, 'load', function () { schedule(true); }, true);
    listen(window, 'resize', function () { schedule(); });
    listen(window, 'scroll', function () { schedule(); }, { capture: true, passive: true });
    scan();
    measure();
    function dispose() {
      if (disposed) return;
      disposed = true;
      close();
      if (frame) window.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      records.forEach(removeRecord);
      bindings.forEach(function (remove) { remove(); });
      if (activeDispose === dispose) activeDispose = null;
    }
    activeDispose = dispose;
    return dispose;
  }

  window.ImageViewer = { init: init };
  window.RprintPageModules.register({ id: 'reading.image-viewer', mount: init });
})();
