/**
 * Embedded whiteboard client (public URL: /static/embedded-whiteboard.js).
 */
(function () {
  'use strict';

  var DE = window.DrawingEngine;
  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 4;
  var DEFAULT_HEIGHT = 400;

  var embeddedInitialized = new WeakSet();

  function initEmbeddedWhiteboard(root) {
    root = root || document;
    var divs = root.querySelectorAll('.embedded-whiteboard');
    for (var i = 0; i < divs.length; i++) {
      var div = divs[i];
      if (embeddedInitialized.has(div)) continue;
      embeddedInitialized.add(div);
      createEmbeddedWhiteboard(div);
    }
  }

  function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function createEmbeddedWhiteboard(container) {
    var boardKey = container.dataset.key;
    if (!boardKey) return;
    var boardDir = container.dataset.wbDir || '';

    var height = parseInt(container.getAttribute('height'), 10) || DEFAULT_HEIGHT;
    var width = parseInt(container.getAttribute('width'), 10) || 0; // 0 = auto (fill parent)
    var initialCam = {
      x: parseFloat(container.dataset.x) || 0,
      y: parseFloat(container.dataset.y) || 0,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parseFloat(container.dataset.zoom) || 1))
    };

    var cam = { x: initialCam.x, y: initialCam.y, zoom: initialCam.zoom };

    function saveCam() { /* no-op: camera position is authored, not persisted */ }

    var strokes = [];
    var dpr = window.devicePixelRatio || 1;
    var isEditing = false;
    var wbInstance = null; // full whiteboard instance when editing

    // ---- DOM setup ----
    container.style.height = height + 'px';
    if (width) container.style.width = width + 'px';
    container.classList.add('ewb-view-mode');

    var canvasWrap = document.createElement('div');
    canvasWrap.className = 'ewb-canvas-wrap';
    container.appendChild(canvasWrap);

    var canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvasWrap.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    // ---- Edit button (server-backed runtimes only) ----
    var editBtn = null;
    var hasRuntime = document.body && (
      document.body.dataset.runtime === 'true' ||
      document.body.dataset.spa === 'true'
    );
    if (hasRuntime) {
      editBtn = document.createElement('button');
      editBtn.className = 'ewb-edit-btn';
      editBtn.setAttribute('aria-label', 'Edit whiteboard');
      editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/><path d="M9.5 3.5l3 3"/></svg>';
      editBtn.addEventListener('click', function () {
        if (isEditing) return;
        switchToEditMode();
      });
      container.appendChild(editBtn);
    }

    // ---- Loading / empty state ----
    var loadingEl = document.createElement('div');
    loadingEl.className = 'ewb-loading';
    loadingEl.textContent = 'Loading\u2026';
    canvasWrap.appendChild(loadingEl);

    // ---- Resize canvas ----
    function resizeCanvas() {
      // Auto-fit: when an explicit width is authored but the container is
      // narrower (parent max-width, viewport, etc.), reduce zoom so the
      // full authored area stays visible.  Never exceed the authored zoom.
      if (width > 0) {
        var cw = container.getBoundingClientRect().width;
        if (cw > 0 && cw < width) {
          var ratio = cw / width;
          cam.zoom = Math.max(MIN_ZOOM, initialCam.zoom * ratio);
          container.style.height = Math.round(height * ratio) + 'px';
        } else if (cw >= width) {
          cam.zoom = initialCam.zoom;
          container.style.height = height + 'px';
        }
      }

      var rect = canvasWrap.getBoundingClientRect();
      var w = Math.round(rect.width);
      var h = Math.round(rect.height);
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      renderStrokes();
    }

    var ro = new ResizeObserver(function () {
      if (!isEditing) resizeCanvas();
    });
    ro.observe(canvasWrap);

    // ---- Camera transform ----
    function applyCameraTransform() {
      ctx.setTransform(
        dpr * cam.zoom, 0, 0, dpr * cam.zoom,
        -cam.x * dpr * cam.zoom, -cam.y * dpr * cam.zoom
      );
    }

    function zoomAtScreen(sx, sy, newZoom) {
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      var wx = sx / cam.zoom + cam.x;
      var wy = sy / cam.zoom + cam.y;
      cam.zoom = newZoom;
      cam.x = wx - sx / cam.zoom;
      cam.y = wy - sy / cam.zoom;
      renderStrokes();
      saveCam();
    }

    // ---- Render strokes (read-only) ----
    function renderStrokes() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (strokes.length === 0) return;
      applyCameraTransform();
      for (var i = 0; i < strokes.length; i++) {
        var s = strokes[i];
        if (s.tool === 'widget') {
          if (window.WhiteboardWidgets && window.WhiteboardWidgets.render) {
            window.WhiteboardWidgets.render(ctx, s, {
              zoom: cam.zoom,
              dark: document.documentElement.getAttribute('data-theme') === 'dark',
              requestRender: renderStrokes,
              requestSchedule: function () {},
              getCache: function () { return null; },
            });
          } else {
            ctx.save();
            ctx.fillStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#161b22' : '#ffffff';
            ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#30363d' : '#d0d7de';
            ctx.lineWidth = 1 / cam.zoom;
            ctx.fillRect(s.x || 0, s.y || 0, s.width || 220, s.height || 120);
            ctx.strokeRect(s.x || 0, s.y || 0, s.width || 220, s.height || 120);
            ctx.restore();
          }
        } else if (s.tool === 'text') {
          DE.drawTextStroke(ctx, s, {});
        } else {
          DE.drawStroke(ctx, s, {});
        }
      }
    }

    // ---- Pan/zoom handlers ----
    var isPanning = false;
    var panStart = null;
    var panCamStart = null;
    var activePointers = {};
    var pinchStartDist = 0;
    var pinchStartZoom = 1;
    var pinchStartCam = null;
    var pinchStartCenter = null;

    function getScreenPos(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerDown(e) {
      if (isEditing) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      var sp = getScreenPos(e);
      activePointers[e.pointerId] = { x: sp.x, y: sp.y };

      var pointerIds = Object.keys(activePointers);
      if (pointerIds.length === 2) {
        var p1 = activePointers[pointerIds[0]];
        var p2 = activePointers[pointerIds[1]];
        var dx = p2.x - p1.x, dy = p2.y - p1.y;
        pinchStartDist = Math.sqrt(dx * dx + dy * dy);
        pinchStartZoom = cam.zoom;
        pinchStartCam = { x: cam.x, y: cam.y };
        pinchStartCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        isPanning = false;
      } else if (pointerIds.length === 1) {
        isPanning = true;
        panStart = { x: sp.x, y: sp.y };
        panCamStart = { x: cam.x, y: cam.y };
        canvasWrap.style.cursor = 'grabbing';
      }
    }

    function onPointerMove(e) {
      if (isEditing) return;
      var sp = getScreenPos(e);
      if (activePointers[e.pointerId]) {
        activePointers[e.pointerId] = { x: sp.x, y: sp.y };
      }

      var pointerIds = Object.keys(activePointers);
      if (pointerIds.length === 2) {
        var p1 = activePointers[pointerIds[0]];
        var p2 = activePointers[pointerIds[1]];
        var dx = p2.x - p1.x, dy = p2.y - p1.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        if (pinchStartDist > 0) {
          var scale = dist / pinchStartDist;
          var newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoom * scale));
          var wx = pinchStartCenter.x / pinchStartZoom + pinchStartCam.x;
          var wy = pinchStartCenter.y / pinchStartZoom + pinchStartCam.y;
          cam.zoom = newZoom;
          cam.x = wx - center.x / cam.zoom;
          cam.y = wy - center.y / cam.zoom;
          renderStrokes();
        }
        return;
      }

      if (!isPanning || !panStart) return;
      var ddx = sp.x - panStart.x;
      var ddy = sp.y - panStart.y;
      cam.x = panCamStart.x - ddx / cam.zoom;
      cam.y = panCamStart.y - ddy / cam.zoom;
      renderStrokes();
    }

    function onPointerUp(e) {
      if (isEditing) return;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      delete activePointers[e.pointerId];
      var pointerIds = Object.keys(activePointers);
      if (pointerIds.length < 2) pinchStartDist = 0;
      if (pointerIds.length === 0) {
        isPanning = false;
        canvasWrap.style.cursor = 'grab';
        saveCam();
      } else if (pointerIds.length === 1) {
        var remaining = activePointers[pointerIds[0]];
        isPanning = true;
        panStart = { x: remaining.x, y: remaining.y };
        panCamStart = { x: cam.x, y: cam.y };
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    canvasWrap.addEventListener('wheel', function (e) {
      if (isEditing) return;
      e.preventDefault();
      var sp = getScreenPos(e);
      var factor = e.deltaY < 0 ? 1.1 : 0.9;
      zoomAtScreen(sp.x, sp.y, cam.zoom * factor);
    }, { passive: false });

    canvasWrap.style.cursor = 'grab';
    canvas.style.touchAction = 'none';

    // ---- Load board data ----
    function loadBoardData() {
      // Check for inline data first (static build)
      var inlineData = container.dataset.wbData;
      if (inlineData !== undefined) {
        // Static build: empty string means no .wb file (render empty canvas),
        // non-empty string is base64-encoded WBRD data.
        if (inlineData) {
          try {
            var buf = Uint8Array.from(atob(inlineData), function (c) { return c.charCodeAt(0); }).buffer;
            var decoded = DE.decodeCanvas(buf);
            strokes = decoded.strokes || [];
          } catch (err) {
            loadingEl.textContent = 'Error loading data';
            loadingEl.classList.add('ewb-error');
            return;
          }
        }
        loadingEl.style.display = 'none';
        resizeCanvas();
        return;
      }

      // Fetch from server (SPA mode)
      var boardUrl = '/api/whiteboard?key=' + encodeURIComponent(boardKey);
      if (boardDir) boardUrl += '&dir=' + encodeURIComponent(boardDir);
      fetch(boardUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.arrayBuffer();
        })
        .then(function (buf) {
          var decoded = DE.decodeCanvas(buf);
          strokes = decoded.strokes || [];
          loadingEl.style.display = 'none';
          resizeCanvas();
        })
        .catch(function () {
          loadingEl.textContent = 'No content';
          loadingEl.classList.add('ewb-empty');
        });
    }

    loadBoardData();

    // ---- Edit mode ----
    var inkContainer = null;
    var doneBtn = null;

    function switchToEditMode() {
      isEditing = true;
      container.classList.remove('ewb-view-mode');
      container.classList.add('ewb-edit-mode');

      // Grow height to compensate for the toolbar so the canvas area
      // stays the same size.  Measure after the ink-container is in the
      // DOM so the toolbar has been rendered.
      var preEditHeight = container.getBoundingClientRect().height || height;

      // Hide read-only canvas and edit button
      canvasWrap.style.display = 'none';
      if (editBtn) editBtn.style.display = 'none';

      // Create .ink-container for full whiteboard
      inkContainer = document.createElement('div');
      inkContainer.className = 'ink-container';
      inkContainer.setAttribute('data-wb-key', boardKey);
      if (boardDir) inkContainer.setAttribute('data-wb-dir', boardDir);
      inkContainer.setAttribute('data-initial-cam', JSON.stringify({ x: cam.x, y: cam.y, zoom: cam.zoom }));
      container.appendChild(inkContainer);

      // Create Done button
      doneBtn = document.createElement('button');
      doneBtn.className = 'ewb-done-btn';
      doneBtn.textContent = 'Done';
      doneBtn.addEventListener('click', function () {
        switchToViewMode();
      });
      container.appendChild(doneBtn);

      // Initialize full whiteboard on the new .ink-container
      if (typeof window.initWhiteboard === 'function') {
        window.initWhiteboard();
      }

      // Measure toolbar height and grow container to compensate
      var toolbar = inkContainer.querySelector('.ink-toolbar');
      if (toolbar) {
        var toolbarH = toolbar.getBoundingClientRect().height;
        container.style.height = Math.round(preEditHeight + toolbarH) + 'px';
      }
    }

    function switchToViewMode() {
      isEditing = false;
      container.classList.remove('ewb-edit-mode');
      container.classList.add('ewb-view-mode');
      // Restore original height
      container.style.height = height + 'px';

      // Capture camera from the editing session before destroying
      var editCam = null;
      if (inkContainer && inkContainer._wb && inkContainer._wb._test && inkContainer._wb._test.cam) {
        var c = inkContainer._wb._test.cam;
        editCam = { x: c.x, y: c.y, zoom: c.zoom };
      }

      // Destroy full whiteboard
      if (inkContainer && inkContainer._wb && typeof inkContainer._wb.destroy === 'function') {
        inkContainer._wb.destroy();
      }
      if (inkContainer && inkContainer.parentNode) {
        inkContainer.parentNode.removeChild(inkContainer);
      }
      inkContainer = null;

      if (doneBtn && doneBtn.parentNode) {
        doneBtn.parentNode.removeChild(doneBtn);
      }
      doneBtn = null;

      // Apply the editing camera so the view stays at the same position
      if (editCam) {
        cam.x = editCam.x;
        cam.y = editCam.y;
        cam.zoom = editCam.zoom;
        saveCam();
      }

      // Show read-only canvas and edit button
      canvasWrap.style.display = '';
      if (editBtn) editBtn.style.display = '';

      // Reload latest data to reflect any edits
      loadBoardData();
    }

    // ---- Cleanup on SPA navigation ----
    container._ewbDestroy = function () {
      ro.disconnect();
      if (isEditing) {
        if (inkContainer && inkContainer._wb && typeof inkContainer._wb.destroy === 'function') {
          inkContainer._wb.destroy();
        }
      }
      embeddedInitialized.delete(container);
    };
  }

  window.initEmbeddedWhiteboard = initEmbeddedWhiteboard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initEmbeddedWhiteboard();
    });
  } else {
    initEmbeddedWhiteboard();
  }
})();
