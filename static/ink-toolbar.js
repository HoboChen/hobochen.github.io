/**
 * ink-toolbar.js — Shared ink toolbar module (Phase 6b).
 *
 * Provides `window.InkToolbar.create(opts)` — builds and manages an L1/L2/L3
 * toolbar UI identical to the whiteboard toolbar. Used by whiteboard.js (all
 * features) and pdf-annotator.js (subset + PDF-specific buttons).
 *
 * The toolbar is **pure UI + event source** — it emits callbacks; the host
 * performs side effects (state mutation, canvas operations, persistence).
 */
(function () {
  'use strict';

  // ---- SVG icons (24×24 viewBox) ----

  var ICONS = {
    zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    zoomIn:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    close:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg>',
    hand:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V6a1.5 1.5 0 0 1 3 0V4.5a1.5 1.5 0 0 1 3 0V6a1.5 1.5 0 0 1 3 0V9a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-4-5a1.5 1.5 0 0 1 2.2-2.1L8 13Z"/><path d="M11 6v5m3-5v5m3-2v3"/></svg>',
    cursor:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>',
    select:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15.2C3.7 13.9 3 12.3 3 10.5 3 6.4 7 3 12 3s9 3.4 9 7.5S17 18 12 18c-1.3 0-2.5-.2-3.6-.6"/><circle cx="6.5" cy="16.5" r="2"/><path d="M6.5 18.5c0 2 1.5 3 3.5 3"/></svg>',
    ink:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
    text:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9.5" y1="20" x2="14.5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    undo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    redo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
    pen:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
    quill:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18v-4.5C6 7 14 1.8 20.5 3.5 22.2 10 17 18 10.5 18H6Z"/><path d="M3 21 16 8m-6 6h7.5"/></svg>',
    ballpoint:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 2.5l3 3-12 12H6.5v-3l12-12z"/><path d="M15.5 5.5l3 3"/><path d="M6.5 17.5L2 22"/></svg>',
    highlighter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
    marker:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="M7.5 20.5 19 9l-4-4L3.5 16.5 2 22z"/></svg>',
    eraser:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    clear:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    pencfg:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    penonly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8v5.5L6 12a1.5 1.5 0 0 0-2.1 2.1l4 5a5 5 0 0 0 4 1.9h1.2a6 6 0 0 0 4.6-2.2M8 4.5a1.5 1.5 0 0 1 3 0V9l5.5 1.3a3.2 3.2 0 0 1 2.5 3.1V15"/><path d="m3 3 18 18"/></svg>',
    reset:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>',
    boards:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
    widgets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5C10 .4 7.4 2.8 8.7 5C5.2 5.2 5.7 9.1 8.8 9C8.1 12.2 11.1 13.1 12 10.7C12.9 13.1 15.9 12.2 15.2 9C18.3 9.1 18.8 5.2 15.3 5C16.6 2.8 14 .4 12 3.5Z"/><circle cx="12" cy="7" r="1.5"/><path d="M12 10.7V22M12 20C7 20 4 17.5 4 14C9 14 12 16.5 12 20ZM12 18.5C12 15 15 12.5 20 12.5C20 16 17 18.5 12 18.5Z"/></svg>',
  };

  // ---- Color palettes ----

  var COLORS = [
    { name: 'black',   value: '#1f2328' },
    { name: 'red',     value: '#cf222e' },
    { name: 'coral',   value: '#c4432b' },
    { name: 'orange',  value: '#bc4c00' },
    { name: 'yellow',  value: '#705d00' },
    { name: 'gold',    value: '#9a6700' },
    { name: 'green',   value: '#116329' },
    { name: 'lime',    value: '#1a7f37' },
    { name: 'teal',    value: '#0e7490' },
    { name: 'sky',     value: '#0969da' },
    { name: 'blue',    value: '#0550ae' },
    { name: 'indigo',  value: '#3b2f96' },
    { name: 'purple',  value: '#8250df' },
    { name: 'pink',    value: '#bf3989' },
    { name: 'gray',    value: '#57606a' },
  ];

  var DARK_COLORS = [
    { name: 'black',   value: '#e6edf3' },
    { name: 'red',     value: '#f85149' },
    { name: 'coral',   value: '#f0876e' },
    { name: 'orange',  value: '#d29922' },
    { name: 'yellow',  value: '#e3b341' },
    { name: 'gold',    value: '#f0c040' },
    { name: 'green',   value: '#3fb950' },
    { name: 'lime',    value: '#7ee787' },
    { name: 'teal',    value: '#56d4dd' },
    { name: 'sky',     value: '#79c0ff' },
    { name: 'blue',    value: '#58a6ff' },
    { name: 'indigo',  value: '#8b8bff' },
    { name: 'purple',  value: '#bc8cff' },
    { name: 'pink',    value: '#f778ba' },
    { name: 'gray',    value: '#8b949e' },
  ];

  var SIZE_MIN = 2;
  var SIZE_MAX = 12;
  var SIZE_SNAPS = [2, 3, 4.5, 6.75, 12];
  var SIZE_SNAP_THRESHOLD = 0.5;
  var COLOR_PAGE_SIZE = 16;

  var INK_STYLES = {
    quill:       { label: 'Quill',       pressure: true,  widthMul: 1,   alpha: 1 },
    pen:         { label: 'Pen',         pressure: true,  widthMul: 1,   alpha: 1 },
    ballpoint:   { label: 'Ballpoint',   pressure: true,  widthMul: 0.6, alpha: 1 },
    highlighter: { label: 'Highlight',   pressure: false, widthMul: 3,   alpha: 0.35 },
    marker:      { label: 'Marker',      pressure: false, widthMul: 0.5, alpha: 1 },
  };

  var TEXT_FONTS = [
    { name: 'Sans',  value: 'sans-serif' },
    { name: 'Serif', value: 'serif' },
    { name: 'Mono',  value: 'monospace' },
    { name: 'Hand',  value: 'cursive' },
  ];

  var TEXT_SIZES = [16, 24, 36, 48];

  var INK_STYLE_NAMES = ['quill', 'pen', 'ballpoint', 'highlighter', 'marker'];

  var DEFAULT_INK_PREFS = {
    quill:       { colorIndex: 0, size: 3 },
    pen:         { colorIndex: 0, size: 3 },
    ballpoint:   { colorIndex: 0, size: 2 },
    highlighter: { colorIndex: 4, size: 6.75 },
    marker:      { colorIndex: 0, size: 4.5 },
    eraser:      { size: 4.5 },
  };

  var DEFAULT_TEXT_PREFS = { fontFamily: 'sans-serif', fontSize: 24, colorIndex: 0 };

  // ---- Shared theme colors ----

  var DE = (typeof window !== 'undefined') ? window.DrawingEngine : null;
  var themeColors = typeof module !== 'undefined' && module.exports
    ? require('../../../foundation/color/theme-colors')
    : window.RprintThemeColors;
  if (!themeColors) throw new Error('Ink toolbar requires the shared theme color helpers.');
  var hexToOklch = themeColors.hexToOklch;
  var oklchToHex = themeColors.oklchToHex;
  var autoDarkVariant = themeColors.autoDarkVariant;
  var autoLightVariant = themeColors.autoLightVariant;
  var perceptualDarkVariant = themeColors.perceptualDarkVariant;
  var perceptualLightVariant = themeColors.perceptualLightVariant;
  var autoThemeVariant = themeColors.autoThemeVariant;

  // ---- Theme detection ----

  function isDarkTheme() {
    return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  }

  // ---- Custom colors (per-prefix localStorage) ----

  function loadCustomColors(prefix) {
    var cc = [];
    try {
      var saved = localStorage.getItem(prefix + '-custom-colors');
      if (saved) cc = JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return cc;
  }

  function saveCustomColors(prefix, cc) {
    try { localStorage.setItem(prefix + '-custom-colors', JSON.stringify(cc)); } catch (e) { /* ignore */ }
  }

  // ---- Color translation map ----

  function buildColorTranslateMap(customColors) {
    var m = {};
    for (var i = 0; i < COLORS.length; i++) {
      m[COLORS[i].value] = i;
      m[DARK_COLORS[i].value] = i;
    }
    for (var j = 0; j < customColors.length; j++) {
      var ci = COLORS.length + j;
      m[customColors[j].light] = ci;
      m[customColors[j].dark] = ci;
    }
    return m;
  }

  function getFullPalette(customColors, forceLight) {
    var dark = forceLight ? false : isDarkTheme();
    var base = dark ? DARK_COLORS : COLORS;
    var result = base.slice();
    for (var i = 0; i < customColors.length; i++) {
      var hex = dark ? customColors[i].dark : customColors[i].light;
      result.push({ name: 'Custom ' + (i + 1), value: hex });
    }
    return result;
  }

  // ---- Size helpers ----

  var _sizeExpB = Math.log(SIZE_MAX / SIZE_MIN);
  function valToPos(v) { return Math.log(v / SIZE_MIN) / _sizeExpB; }
  function posToVal(p) { return SIZE_MIN * Math.exp(p * _sizeExpB); }

  function snapSize(val) {
    for (var i = 0; i < SIZE_SNAPS.length; i++) {
      if (Math.abs(val - SIZE_SNAPS[i]) <= SIZE_SNAP_THRESHOLD) return SIZE_SNAPS[i];
    }
    return Math.round(val * 10) / 10;
  }

  // ---- DOM builders ----

  // Shared L1 surface, also used by viewing-only hosts without drawing panels.
  function makeL1Toolbar() {
    var toolbar = document.createElement('div');
    toolbar.className = 'ink-toolbar';
    return toolbar;
  }

  function makeL1Btn(iconSvg, action, title) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ink-l1-btn';
    btn.innerHTML = iconSvg;
    btn.dataset.action = action;
    btn.title = title || '';
    if (title) btn.setAttribute('aria-label', title);
    return btn;
  }

  function makeL1Sep() {
    var sep = document.createElement('div');
    sep.className = 'ink-sep';
    return sep;
  }

  function createChrome(opts) {
    var container = opts.container;
    var toolbar = document.createElement('div');
    toolbar.className = 'ink-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', opts.label || 'Drawing tools');
    container.appendChild(toolbar);
    var panels = new Map();
    var closed = false;

    function position(panel) {
      var bounds = container.getBoundingClientRect();
      var anchor = panel.anchor.getBoundingClientRect();
      var parent = panels.get(panel.level - 1);
      var bottom = (parent ? parent.el : toolbar).getBoundingClientRect().bottom;
      var viewport = window.visualViewport;
      var viewportLeft = viewport ? viewport.offsetLeft : 0;
      var viewportTop = viewport ? viewport.offsetTop : 0;
      var viewportRight = viewportLeft + (viewport ? viewport.width : window.innerWidth);
      var viewportBottom = viewportTop + (viewport ? viewport.height : window.innerHeight);
      var leftEdge = Math.max(bounds.left, viewportLeft) + 4;
      var rightEdge = Math.min(bounds.right, viewportRight) - 4;
      var top = Math.max(viewportTop + 4, bottom + 4);
      panel.el.style.position = 'absolute';
      panel.el.style.maxWidth = Math.max(0, rightEdge - leftEdge) + 'px';
      panel.el.style.maxHeight = Math.max(0, viewportBottom - top - 4) + 'px';
      var padding = parseFloat(getComputedStyle(panel.el).paddingLeft) || 0;
      var left = Math.max(leftEdge, Math.min(anchor.left - padding, rightEdge - panel.el.offsetWidth));
      panel.el.style.left = (left - bounds.left + container.scrollLeft - container.clientLeft) + 'px';
      panel.el.style.top = (top - bounds.top + container.scrollTop - container.clientTop) + 'px';
      panel.el.style.right = 'auto';
    }

    function reposition() {
      panels.forEach(position);
    }

    function observePanels() {
      if (!observer || closed) return;
      observer.disconnect();
      observer.observe(container);
      observer.observe(toolbar);
      panels.forEach(function (panel) { observer.observe(panel.el); });
    }

    function closePanels(level, restoreFocus, force) {
      var entries = Array.from(panels.values()).filter(function (panel) { return panel.level >= (level || 2); });
      if (!force && entries.some(function (panel) { return panel.canClose && !panel.canClose(); })) return false;
      entries.sort(function (a, b) { return b.level - a.level; }).forEach(function (panel) {
        panels.delete(panel.level);
        panel.el.style.display = 'none';
        panel.anchor.setAttribute('aria-expanded', 'false');
        if (panel.onClose) panel.onClose();
      });
      if (entries.length) observePanels();
      if (restoreFocus && entries.length) {
        var anchor = entries[entries.length - 1].anchor;
        if (anchor.isConnected) anchor.focus({ preventScroll: true });
      }
      return true;
    }

    function showPanel(el, anchor, options) {
      options = options || {};
      var level = options.level || 2;
      if (closed || !anchor || !anchor.isConnected) return false;
      if (!closePanels(level)) return false;
      var panel = { el: el, anchor: anchor, level: level, onClose: options.onClose, canClose: options.canClose, contains: options.contains };
      panels.set(level, panel);
      el.style.display = '';
      anchor.setAttribute('aria-expanded', 'true');
      position(panel);
      observePanels();
      return true;
    }

    function outside(event) {
      if (toolbar.contains(event.target)) return;
      for (var panel of panels.values()) {
        if (panel.el.contains(event.target) || (panel.contains && panel.contains(event.target))) return;
      }
      closePanels(2);
    }

    function toolbarClick(event) {
      var control = event.target.closest('button,select');
      if (control && !Array.from(panels.values()).some(function (panel) { return panel.anchor === control; })) closePanels(2);
    }

    function keydown(event) {
      if (event.defaultPrevented || event.key !== 'Escape' || !panels.size) return;
      if (closePanels(Math.max.apply(null, Array.from(panels.keys())), true)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown, true);
    toolbar.addEventListener('click', toolbarClick);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', reposition);
      window.visualViewport.addEventListener('scroll', reposition);
    }
    var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null;
    if (observer) { observer.observe(container); observer.observe(toolbar); }

    return {
      element: toolbar,
      container: container,
      showPanel: showPanel,
      closePanels: closePanels,
      reposition: reposition,
      destroy: function () {
        if (closed) return;
        closed = true;
        closePanels(2, false, true);
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', keydown, true);
        toolbar.removeEventListener('click', toolbarClick);
        window.removeEventListener('resize', reposition);
        window.removeEventListener('scroll', reposition, true);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', reposition);
          window.visualViewport.removeEventListener('scroll', reposition);
        }
        if (observer) observer.disconnect();
        toolbar.remove();
      },
    };
  }

  function makeIconBtn(iconSvg, label, action) {
    var btn = document.createElement('button');
    btn.innerHTML = iconSvg;
    btn.title = label;
    btn.dataset.action = action;
    return btn;
  }

  function makeColorBtn(index, color) {
    var btn = document.createElement('button');
    btn.className = 'ink-color-btn';
    if (index >= COLORS.length) btn.classList.add('ink-custom-color');
    btn.dataset.colorIndex = String(index);
    btn.title = color.name;
    var dot = document.createElement('span');
    dot.className = 'ink-color-dot';
    dot.style.background = color.value;
    btn.appendChild(dot);
    return btn;
  }

  // ---- Shared palette renderer ----

  function renderColorPalette(containerEl, activeIndex, onSelect, customColors, hiddenColorInput, forceLight) {
    if (containerEl._inkPaletteDispose) containerEl._inkPaletteDispose();
    var lifetime = new AbortController();
    function listen(element, type, handler) {
      element.addEventListener(type, handler, { signal: lifetime.signal });
    }
    containerEl.innerHTML = '';
    var palette = getFullPalette(customColors, forceLight);

    var items = [];
    for (var i = 0; i < palette.length; i++) {
      var cb = makeColorBtn(i, palette[i]);
      if (i === activeIndex) cb.classList.add('active');
      items.push(cb);
    }
    var addBtn = document.createElement('button');
    addBtn.className = 'ink-color-btn ink-add-color-btn';
    addBtn.title = 'Add custom color';
    addBtn.innerHTML = '<span class="ink-color-dot ink-add-color-dot">+</span>';
    items.push(addBtn);

    var totalPages = Math.ceil(items.length / COLOR_PAGE_SIZE);
    var activePage = Math.min(Math.floor(activeIndex / COLOR_PAGE_SIZE), totalPages - 1);

    var carousel = document.createElement('div');
    carousel.className = 'ink-color-carousel';
    var track = document.createElement('div');
    track.className = 'ink-color-carousel-track';

    for (var p = 0; p < totalPages; p++) {
      var page = document.createElement('div');
      page.className = 'ink-color-page';
      var start = p * COLOR_PAGE_SIZE;
      var end = Math.min(start + COLOR_PAGE_SIZE, items.length);
      for (var j = start; j < end; j++) page.appendChild(items[j]);
      track.appendChild(page);
    }
    carousel.appendChild(track);
    containerEl.appendChild(carousel);

    var dotsContainer = null;
    function goToPage(pg) {
      pg = Math.max(0, Math.min(pg, totalPages - 1));
      activePage = pg;
      track.style.transform = 'translateX(-' + (pg * 100) + '%)';
      if (dotsContainer) {
        var dots = dotsContainer.children;
        for (var d = 0; d < dots.length; d++) dots[d].classList.toggle('active', d === pg);
      }
    }

    if (totalPages > 1) {
      dotsContainer = document.createElement('div');
      dotsContainer.className = 'ink-color-dots';
      for (var d = 0; d < totalPages; d++) {
        var dot = document.createElement('span');
        dot.className = 'ink-color-dot-indicator';
        if (d === activePage) dot.classList.add('active');
        dot.dataset.page = String(d);
        dotsContainer.appendChild(dot);
      }
      listen(dotsContainer, 'click', function (ev) {
        var t = ev.target;
        if (t.dataset.page !== undefined) goToPage(parseInt(t.dataset.page, 10));
      });
      containerEl.appendChild(dotsContainer);
    }
    goToPage(activePage);

    // Swipe support
    var swipeStartX = 0, swiping = false, swipeDx = 0;
    listen(carousel, 'pointerdown', function (ev) {
      if (totalPages <= 1) return;
      swipeStartX = ev.clientX;
      swiping = true; swipeDx = 0;
      track.style.transition = 'none';
      // Don't capture here — capture on first move so taps still hit buttons
    });
    listen(carousel, 'pointermove', function (ev) {
      if (!swiping) return;
      var dx = ev.clientX - swipeStartX;
      var dy = ev.clientY - (ev._startY || ev.clientY);
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(swipeDx) < 5) { swiping = false; track.style.transition = ''; goToPage(activePage); return; }
      // Capture pointer on first real horizontal move (keeps taps untouched)
      if (!carousel.hasPointerCapture(ev.pointerId)) carousel.setPointerCapture(ev.pointerId);
      swipeDx = dx;
      var pageW = carousel.offsetWidth;
      track.style.transform = 'translateX(' + (-(activePage * pageW) + dx) + 'px)';
    });
    function endSwipe() {
      if (!swiping) return;
      swiping = false; track.style.transition = '';
      var threshold = carousel.offsetWidth * 0.2;
      if (swipeDx < -threshold && activePage < totalPages - 1) goToPage(activePage + 1);
      else if (swipeDx > threshold && activePage > 0) goToPage(activePage - 1);
      else goToPage(activePage);
    }
    listen(carousel, 'pointerup', endSwipe);
    listen(carousel, 'pointercancel', endSwipe);

    // Click delegation
    var longPressTriggered = false;
    containerEl.onclick = function (ev) {
      if (Math.abs(swipeDx) > 5) return;
      if (longPressTriggered) { longPressTriggered = false; return; }
      var btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.classList.contains('ink-add-color-btn')) {
        hiddenColorInput.value = '#000000';
        hiddenColorInput.onchange = function () {
          var picked = hiddenColorInput.value;
          var darkHex, lightHex;
          if (!forceLight && isDarkTheme()) { darkHex = picked; lightHex = autoLightVariant(picked); }
          else { darkHex = autoDarkVariant(picked); lightHex = picked; }
          customColors.push({ light: lightHex, dark: darkHex });
          onSelect(COLORS.length + customColors.length - 1);
        };
        hiddenColorInput.click();
        ev.stopPropagation();
        return;
      }
      var ci = btn.dataset.colorIndex;
      if (ci !== undefined) onSelect(parseInt(ci, 10));
      ev.stopPropagation();
    };

    // Right-click to remove custom colors
    containerEl.oncontextmenu = function (ev) {
      var btn = ev.target.closest('.ink-custom-color');
      if (!btn) return;
      ev.preventDefault();
      removeCustomColor(btn);
    };

    // Long-press to remove custom colors
    var longPressTimer = null;
    listen(containerEl, 'pointerdown', function (ev) {
      var btn = ev.target.closest('.ink-custom-color');
      if (!btn) return;
      longPressTriggered = false;
      longPressTimer = setTimeout(function () {
        if (!containerEl.isConnected) return;
        longPressTriggered = true;
        removeCustomColor(btn);
      }, 500);
    });
    listen(containerEl, 'pointermove', function (ev) {
      if (longPressTimer && Math.abs(ev.clientX - swipeStartX) > 5) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    listen(containerEl, 'pointerup', function () { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
    listen(containerEl, 'pointercancel', function () { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
    containerEl._inkPaletteDispose = function () {
      lifetime.abort();
      clearTimeout(longPressTimer);
      containerEl.onclick = null;
      containerEl.oncontextmenu = null;
      delete containerEl._inkPaletteDispose;
    };

    function removeCustomColor(btn) {
      var ci = parseInt(btn.dataset.colorIndex, 10);
      var customIdx = ci - COLORS.length;
      if (customIdx < 0 || customIdx >= customColors.length) return;
      customColors.splice(customIdx, 1);
      if (activeIndex >= COLORS.length + customColors.length) onSelect(Math.max(0, COLORS.length + customColors.length - 1));
      else onSelect(activeIndex > ci ? activeIndex - 1 : activeIndex);
    }
  }

  // ---- Size slider builder ----

  // Preview canvas dims (logical px). Width matches the L3 panel's swatch grid:
  //   4 swatches * 28px + 3 gaps * 4px = 124px.
  var SIZE_PREVIEW_W = 124;
  var SIZE_PREVIEW_H = 56;
  // Cap visible stroke width so a fat highlighter (size 12 * widthMul 3 = 36px)
  // does not overflow the 56px-tall preview.  The slider value passed to the
  // host is unaffected — this only controls how thick the preview reads.
  var SIZE_PREVIEW_VISUAL_CAP = 30;
  // Eraser preview: matches ERASER_SCALE = 4 used by both whiteboard.js and
  // pdf-annotator.js when committing eraser strokes.
  var SIZE_PREVIEW_ERASER_SCALE = 4;

  function drawPenPreview(ctx, w, h, size, inkStyleName, color) {
    var style = INK_STYLES[inkStyleName] || INK_STYLES.quill;
    var baseSize = size * (style.widthMul || 1);
    if (baseSize > SIZE_PREVIEW_VISUAL_CAP) baseSize = SIZE_PREVIEW_VISUAL_CAP;

    // Tilde curve across the canvas with a small horizontal pad so caps fit.
    var pad = Math.max(8, baseSize * 0.6);
    var x0 = pad, x1 = w - pad;
    var amp = h * 0.18;
    var cy = h * 0.5;
    var n = 24;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      // Pressure ramp: gentle taper at both ends, full mid-stroke.
      var p = 0.55 + 0.45 * Math.sin(Math.PI * t);
      pts.push({
        x: x0 + (x1 - x0) * t,
        y: cy + amp * Math.sin(2 * Math.PI * t),
        pressure: p,
      });
    }

    var stroke = {
      id: 'preview',
      tool: 'pen',
      inkStyle: inkStyleName,
      color: color,
      baseSize: baseSize,
      points: pts,
    };

    try {
      if (DE && DE.drawStroke) {
        DE.drawStroke(ctx, stroke, { smoothing: 0 });
        return;
      }
    } catch (e) { /* fall through to plain path */ }

    // Fallback (no DrawingEngine, or render error): plain stroked path.
    try {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = baseSize;
      ctx.strokeStyle = color;
      if (style.alpha < 1) ctx.globalAlpha = style.alpha;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.stroke();
      ctx.restore();
    } catch (e) { /* jsdom or non-2d context — silently skip */ }
  }

  function drawEraserPreview(ctx, w, h, size) {
    var dark = isDarkTheme();
    var fill = dark ? '#484f58' : '#c8c8c8';
    var stroke = dark ? '#848d97' : '#656d76';
    var diameter = size * SIZE_PREVIEW_ERASER_SCALE;
    // Cap visual diameter so the largest eraser (12 * 4 = 48px) still fits
    // comfortably inside the 56px-tall preview with a small breathing margin.
    var maxD = Math.min(w, h) - 4;
    if (diameter > maxD) diameter = maxD;
    var r = diameter * 0.5;
    try {
      ctx.save();
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (ctx.setLineDash) ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.restore();
    } catch (e) { /* jsdom or non-2d context — silently skip */ }
  }

  function buildSizeSlider(container, currentSize, onChange, opts) {
    opts = opts || {};
    var kind = opts.kind === 'eraser' ? 'eraser' : 'pen';
    var inkStyleName = opts.inkStyle || 'quill';
    var color = opts.color || '#000000';

    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'ink-size-slider-wrap';

    // Preview canvas (DPR-scaled).
    var previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'ink-size-preview-canvas';
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    previewCanvas.width = Math.round(SIZE_PREVIEW_W * dpr);
    previewCanvas.height = Math.round(SIZE_PREVIEW_H * dpr);
    var pctx = null;
    try { pctx = previewCanvas.getContext('2d'); } catch (e) { pctx = null; }
    wrap.appendChild(previewCanvas);

    var track = document.createElement('div');
    track.className = 'ink-size-slider-track';
    var thumb = document.createElement('div');
    thumb.className = 'ink-size-slider-thumb';

    for (var i = 0; i < SIZE_SNAPS.length; i++) {
      var tick = document.createElement('div');
      tick.className = 'ink-size-slider-tick';
      tick.style.left = (valToPos(SIZE_SNAPS[i]) * 100) + '%';
      track.appendChild(tick);
    }
    track.appendChild(thumb);
    wrap.appendChild(track);
    container.appendChild(wrap);

    function redrawPreview(val) {
      if (!pctx) return;
      try {
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } catch (e) { /* ignore */ }
      if (kind === 'eraser') drawEraserPreview(pctx, SIZE_PREVIEW_W, SIZE_PREVIEW_H, val);
      else drawPenPreview(pctx, SIZE_PREVIEW_W, SIZE_PREVIEW_H, val, inkStyleName, color);
    }

    function setVisual(val) {
      var pct = Math.max(0, Math.min(100, valToPos(val) * 100));
      track.style.setProperty('--fill-pct', pct + '%');
      thumb.style.left = pct + '%';
      redrawPreview(val);
    }
    setVisual(currentSize);

    function sizeFromPointer(ex) {
      var rect = track.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (ex - rect.left) / rect.width));
      return snapSize(posToVal(ratio));
    }

    var dragging = false;
    track.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); dragging = true;
      track.setPointerCapture(ev.pointerId);
      var val = sizeFromPointer(ev.clientX);
      setVisual(val); onChange(val);
    });
    track.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var val = sizeFromPointer(ev.clientX);
      setVisual(val); onChange(val);
    });
    track.addEventListener('pointerup', function () { dragging = false; });
    track.addEventListener('pointercancel', function () { dragging = false; });

    return { setVisual: setVisual };
  }

  // ======== InkToolbar.create() ========

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container  — Parent element for toolbar + floating panels
   * @param {object}      opts.features  — Feature flags:
   *   ink, eraser, text, hand, cursor, lasso, penOnly, undo, redo, settings,
   *   popout, boards, resetView, clear, debug, penConfig, smoothing,
  *   touchPan, hoverCursor, widgets
   * @param {object}      opts.host      — Callbacks:
   *   onModeChange(mode, tool), onInkStyleChange(style),
   *   onColorChange(color, index), onSizeChange(size),
   *   onSmoothingChange(val), onUndo(), onRedo(), onResetView(),
  *   onClearAll(), onBoards(), onWidgets(), onPenOnlyChange(on),
   *   onTouchPanChange(on), onHoverCursorChange(on),
   *   onTextPrefsChange(prefs), onPenConfig(), onDebug(),
   *   onThemeChange(theme, bgColor)
   * @param {string}      [opts.lsPrefix='wb'] — localStorage key prefix
   * @returns {object}     Controller
   */
  function create(opts) {
    var disposeControls = [];
    var destroyed = false;
    var lifetime = new AbortController();
    function listen(element, type, handler) {
      element.addEventListener(type, handler, { signal: lifetime.signal });
    }
    var containerEl = opts.container;
    var features = opts.features || {};
    var host = opts.host || {};
    var lsPrefix = opts.lsPrefix || 'wb';
    var forceLightPalette = !!opts.forceLightPalette;

    // ---- Per-instance state ----
    var customColors = loadCustomColors(lsPrefix);
    var colorTranslateMap = buildColorTranslateMap(customColors);

    var inkStylePrefs = {};
    for (var dk in DEFAULT_INK_PREFS) inkStylePrefs[dk] = { colorIndex: DEFAULT_INK_PREFS[dk].colorIndex, size: DEFAULT_INK_PREFS[dk].size };
    try {
      var savedInk = localStorage.getItem(lsPrefix + '-ink-prefs');
      if (savedInk) { var pi = JSON.parse(savedInk); for (var k in pi) { if (inkStylePrefs[k]) inkStylePrefs[k] = pi[k]; } }
    } catch (e) { /* ignore */ }
    // Clamp
    var fullPaletteLen = COLORS.length + customColors.length;
    for (var ik in inkStylePrefs) {
      if (inkStylePrefs[ik].size !== undefined) inkStylePrefs[ik].size = Math.max(SIZE_MIN, Math.min(SIZE_MAX, inkStylePrefs[ik].size));
      if (inkStylePrefs[ik].colorIndex !== undefined) inkStylePrefs[ik].colorIndex = Math.min(inkStylePrefs[ik].colorIndex, fullPaletteLen - 1);
    }

    var textPrefs = { fontFamily: DEFAULT_TEXT_PREFS.fontFamily, fontSize: DEFAULT_TEXT_PREFS.fontSize, colorIndex: DEFAULT_TEXT_PREFS.colorIndex };
    try {
      var savedText = localStorage.getItem(lsPrefix + '-text-prefs');
      if (savedText) { var pt = JSON.parse(savedText); if (pt.fontFamily) textPrefs.fontFamily = pt.fontFamily; if (pt.fontSize) textPrefs.fontSize = pt.fontSize; if (pt.colorIndex !== undefined) textPrefs.colorIndex = pt.colorIndex; }
    } catch (e) { /* ignore */ }
    textPrefs.colorIndex = Math.min(textPrefs.colorIndex, COLORS.length + customColors.length - 1);

    var mode = opts.initialMode === 'eraser' ? 'ink' : (opts.initialMode || 'ink');
    if (mode !== 'hand' && mode !== 'cursor' && mode !== 'select' && mode !== 'ink' && mode !== 'text') mode = 'ink';
    var tool = (opts.initialMode === 'eraser' || opts.initialTool === 'eraser') ? 'eraser' : 'pen';
    var inkStyle = Object.prototype.hasOwnProperty.call(INK_STYLES, opts.initialInkStyle) ? opts.initialInkStyle : 'quill';
    var smoothing = 0.5;

    var penOnlyMode = false;
    try { penOnlyMode = localStorage.getItem(lsPrefix + '-pen-only') === 'true'; } catch (e) { /* ignore */ }

    var touchPanInPenMode = true;
    try { var sp = localStorage.getItem(lsPrefix + '-touch-pan-pen'); if (sp !== null) touchPanInPenMode = sp === 'true'; } catch (e) { /* ignore */ }

    var showHoverCursor = false;
    try { var sh = localStorage.getItem(lsPrefix + '-hover-cursor'); if (sh !== null) showHoverCursor = sh === 'true'; } catch (e) { /* ignore */ }

    var wacomInput = false;
    try { var wi = localStorage.getItem(lsPrefix + '-wacom-input'); if (wi !== null) wacomInput = wi === 'true'; } catch (e) { /* ignore */ }

    var prediction = false;
    try { var pd = localStorage.getItem(lsPrefix + '-prediction'); if (pd !== null) prediction = pd === 'true'; } catch (e) { /* ignore */ }

    function saveInkPrefs() {
      saveCustomColors(lsPrefix, customColors);
      colorTranslateMap = buildColorTranslateMap(customColors);
      try { localStorage.setItem(lsPrefix + '-ink-prefs', JSON.stringify(inkStylePrefs)); } catch (e) { /* ignore */ }
    }

    function saveTextPrefs() {
      try { localStorage.setItem(lsPrefix + '-text-prefs', JSON.stringify(textPrefs)); } catch (e) { /* ignore */ }
    }

    function getActiveColor() {
      var palette = getFullPalette(customColors, forceLightPalette);
      var idx = inkStylePrefs[inkStyle] ? inkStylePrefs[inkStyle].colorIndex : 0;
      return (idx < palette.length) ? palette[idx].value : palette[0].value;
    }

    // Hosts that theme their drawing surface can store a stable light-palette
    // color, independently of the palette currently displayed in the toolbar.
    function getLightColor(index) {
      var palette = getFullPalette(customColors, true);
      return palette[index] ? palette[index].value : palette[0].value;
    }

    function getActiveLightColor() {
      return getLightColor(inkStylePrefs[inkStyle] ? inkStylePrefs[inkStyle].colorIndex : 0);
    }

    function getActiveSize() {
      if (tool === 'eraser') return inkStylePrefs.eraser ? inkStylePrefs.eraser.size : 4.5;
      return inkStylePrefs[inkStyle] ? inkStylePrefs[inkStyle].size : 3;
    }

    // ---- Hidden color input for native picker ----
    var hiddenColorInput = document.createElement('input');
    hiddenColorInput.type = 'color';
    hiddenColorInput.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
    containerEl.appendChild(hiddenColorInput);

    // ---- Build toolbar (L1) ----
    var chrome = createChrome({ container: containerEl });
    var toolbar = chrome.element;

    var l1Ink    = makeL1Btn(ICONS.ink, 'ink', 'Ink (P)');
    var l1Eraser = makeL1Btn(ICONS.eraser, 'eraser', 'Eraser (E)');
    var l1Text   = makeL1Btn(ICONS.text, 'text', 'Text (T)');
    var l1Hand   = makeL1Btn(ICONS.hand, 'hand', 'Hand (H)');
    var l1Cursor = makeL1Btn(ICONS.cursor, 'cursor', 'Cursor (C)');
    var l1Select = makeL1Btn(ICONS.select, 'select', 'Lasso Select (V)');
    var l1PenOnly = makeL1Btn(ICONS.penonly, 'penonly', 'Pen Only (N)');
    if (penOnlyMode) l1PenOnly.classList.add('active');
    var l1Undo   = makeL1Btn(ICONS.undo, 'undo', 'Undo (Ctrl+Z)');
    var l1Redo   = makeL1Btn(ICONS.redo, 'redo', 'Redo (Ctrl+Y)');
    l1Undo.disabled = true; l1Redo.disabled = true;
    var l1Settings = makeL1Btn(ICONS.settings, 'settings', 'Settings');
    var l1Boards  = makeL1Btn(ICONS.boards, 'boards', opts.boardsLabel || 'Whiteboards');
    var l1Widgets = makeL1Btn(ICONS.widgets, 'widgets', 'Widgets');
    if (features.ink !== false) toolbar.appendChild(l1Ink);
    if (features.eraser !== false) toolbar.appendChild(l1Eraser);
    if (features.text) toolbar.appendChild(l1Text);
    if (features.hand !== false) toolbar.appendChild(l1Hand);
    if (features.cursor) toolbar.appendChild(l1Cursor);
    if (features.lasso) toolbar.appendChild(l1Select);
    toolbar.appendChild(makeL1Sep());
    if (features.penOnly) toolbar.appendChild(l1PenOnly);
    if (features.penOnly) toolbar.appendChild(makeL1Sep());
    if (features.undo !== false) toolbar.appendChild(l1Undo);
    if (features.undo !== false) toolbar.appendChild(l1Redo);
    if (features.settings !== false) toolbar.appendChild(l1Settings);
    if (features.widgets) toolbar.appendChild(l1Widgets);
    if (features.boards) toolbar.appendChild(l1Boards);

    containerEl.appendChild(toolbar);

    // ---- Build L2 panels ----

    // L2 Ink — ink style buttons
    var l2Ink = buildL2InkPanel();
    containerEl.appendChild(l2Ink.el);

    // L2 Hand — reset view
    var l2Hand = { el: null };
    if (features.resetView) {
      l2Hand = buildL2HandPanel();
      containerEl.appendChild(l2Hand.el);
    }

    // L2 Settings
    var l2Settings = buildL2SettingsPanel();
    containerEl.appendChild(l2Settings.el);

    // L2 Text
    var l2Text = { el: null, refreshColors: function () {} };
    if (features.text) {
      l2Text = buildL2TextPanel();
      containerEl.appendChild(l2Text.el);
    }

    // ---- Build L3 panel (color + size) ----
    var l3Panel = buildL3PanelEl();
    containerEl.appendChild(l3Panel.el);

    // When the host asked for a forced-light toolbar (e.g. PDF annotator,
    // which sits over a paper-colored PDF viewport), tag every root
    // toolbar element with the marker class consumed by the
    // "Force-light overrides" block at the end of ink-toolbar.css.  All
    // descendants are styled via descendant selectors there, so the L2/L3
    // contents (settings rows, color palette, size slider, etc.) follow
    // automatically without per-element bookkeeping.
    var rootsToForceLight = [toolbar, l2Ink.el, l2Settings.el, l3Panel.el];
    if (l2Hand.el) rootsToForceLight.push(l2Hand.el);
    if (l2Text.el) rootsToForceLight.push(l2Text.el);
    function updateForceLightMarkers() {
      for (var rfli = 0; rfli < rootsToForceLight.length; rfli++) {
        rootsToForceLight[rfli].classList.toggle('ink-force-light', forceLightPalette);
      }
    }
    updateForceLightMarkers();

    var openL2 = null;
    var openL3 = null;

    // ---- L2 builders ----

    function buildL2InkPanel() {
      var el = document.createElement('div');
      el.className = 'ink-l2-bar ink-l2-ink';
      el.style.display = 'none';
      var styleBtns = {};
      for (var si = 0; si < INK_STYLE_NAMES.length; si++) {
        var sn = INK_STYLE_NAMES[si];
        styleBtns[sn] = makeIconBtn(ICONS[sn] || ICONS.pen, INK_STYLES[sn].label, 'ink-' + sn);
        el.appendChild(styleBtns[sn]);
      }
      styleBtns[inkStyle].classList.add('active');

      listen(el, 'click', function (ev) {
        var btn = ev.target.closest('button');
        if (!btn) return;
        var a = btn.dataset.action;
        for (var si = 0; si < INK_STYLE_NAMES.length; si++) {
          if (a === 'ink-' + INK_STYLE_NAMES[si]) { setInkStyleInternal(INK_STYLE_NAMES[si]); setToolPen(); break; }
        }
        for (var si = 0; si < INK_STYLE_NAMES.length; si++) {
          styleBtns[INK_STYLE_NAMES[si]].classList.toggle('active', inkStyle === INK_STYLE_NAMES[si] && tool === 'pen');
        }
        if (openL3 && openL3._anchorAction === a) closeL3();
        else showL3(btn, a);
        ev.stopPropagation();
      });
      return { el: el, styleBtns: styleBtns };
    }

    function buildL2HandPanel() {
      var el = document.createElement('div');
      el.className = 'ink-l2-bar ink-l2-hand';
      el.style.display = 'none';
      var resetBtn = makeIconBtn(ICONS.reset, 'Reset View', 'reset-view');
      el.appendChild(resetBtn);
      listen(el, 'click', function (ev) {
        var btn = ev.target.closest('button');
        if (!btn) return;
        if (btn.dataset.action === 'reset-view' && host.onResetView) host.onResetView();
        ev.stopPropagation();
      });
      return { el: el };
    }

    function buildL2SettingsPanel() {
      var el = document.createElement('div');
      el.className = 'ink-l2-bar ink-l2-settings';
      el.style.display = 'none';

      // Input section
      var inputHeader = document.createElement('div');
      inputHeader.className = 'ink-settings-section';
      inputHeader.textContent = 'Input';
      el.appendChild(inputHeader);

      if (features.touchPan !== false) {
        var touchRow = document.createElement('div');
        touchRow.className = 'ink-settings-row';
        var touchLabel = document.createElement('span');
        touchLabel.className = 'ink-settings-label';
        touchLabel.textContent = 'Touch to Pan & Zoom When Pen Only';
        var touchToggle = document.createElement('label');
        touchToggle.className = 'ink-toggle';
        var touchCheck = document.createElement('input');
        touchCheck.type = 'checkbox'; touchCheck.checked = touchPanInPenMode;
        var touchTrack = document.createElement('span');
        touchTrack.className = 'ink-toggle-track';
        touchToggle.appendChild(touchCheck); touchToggle.appendChild(touchTrack);
        listen(touchCheck, 'change', function () {
          touchPanInPenMode = touchCheck.checked;
          try { localStorage.setItem(lsPrefix + '-touch-pan-pen', touchPanInPenMode ? 'true' : 'false'); } catch (e) { /* ignore */ }
          if (host.onTouchPanChange) host.onTouchPanChange(touchPanInPenMode);
        });
        touchRow.appendChild(touchLabel); touchRow.appendChild(touchToggle);
        el.appendChild(touchRow);
      }

      if (features.hoverCursor !== false) {
        var hoverRow = document.createElement('div');
        hoverRow.className = 'ink-settings-row';
        var hoverLabel = document.createElement('span');
        hoverLabel.className = 'ink-settings-label';
        hoverLabel.textContent = 'Show Cursor Dot on Hover';
        var hoverToggle = document.createElement('label');
        hoverToggle.className = 'ink-toggle';
        var hoverCheck = document.createElement('input');
        hoverCheck.type = 'checkbox'; hoverCheck.checked = showHoverCursor;
        var hoverTrackEl = document.createElement('span');
        hoverTrackEl.className = 'ink-toggle-track';
        hoverToggle.appendChild(hoverCheck); hoverToggle.appendChild(hoverTrackEl);
        listen(hoverCheck, 'change', function () {
          showHoverCursor = hoverCheck.checked;
          try { localStorage.setItem(lsPrefix + '-hover-cursor', showHoverCursor ? 'true' : 'false'); } catch (e) { /* ignore */ }
          if (host.onHoverCursorChange) host.onHoverCursorChange(showHoverCursor);
        });
        hoverRow.appendChild(hoverLabel); hoverRow.appendChild(hoverToggle);
        el.appendChild(hoverRow);
      }

      // Wacom Input toggle — disables position low-pass filter for Wacom EMR
      // devices that deliver high-density, even-rate input.
      {
        var wacomRow = document.createElement('div');
        wacomRow.className = 'ink-settings-row';
        var wacomLabel = document.createElement('span');
        wacomLabel.className = 'ink-settings-label';
        wacomLabel.textContent = 'Wacom Input';
        var wacomToggle = document.createElement('label');
        wacomToggle.className = 'ink-toggle';
        var wacomCheck = document.createElement('input');
        wacomCheck.type = 'checkbox'; wacomCheck.checked = wacomInput;
        var wacomTrackEl = document.createElement('span');
        wacomTrackEl.className = 'ink-toggle-track';
        wacomToggle.appendChild(wacomCheck); wacomToggle.appendChild(wacomTrackEl);
        listen(wacomCheck, 'change', function () {
          wacomInput = wacomCheck.checked;
          try { localStorage.setItem(lsPrefix + '-wacom-input', wacomInput ? 'true' : 'false'); } catch (e) { /* ignore */ }
          if (host.onWacomInputChange) host.onWacomInputChange(wacomInput);
        });
        wacomRow.appendChild(wacomLabel); wacomRow.appendChild(wacomToggle);
        el.appendChild(wacomRow);
      }

      // Prediction toggle — enables/disables getPredictedEvents and linear
      // extrapolation fallback for reduced perceived latency.
      {
        var predRow = document.createElement('div');
        predRow.className = 'ink-settings-row';
        var predLabel = document.createElement('span');
        predLabel.className = 'ink-settings-label';
        predLabel.textContent = 'Ink Prediction';
        var predToggle = document.createElement('label');
        predToggle.className = 'ink-toggle';
        var predCheck = document.createElement('input');
        predCheck.type = 'checkbox'; predCheck.checked = prediction;
        var predTrackEl = document.createElement('span');
        predTrackEl.className = 'ink-toggle-track';
        predToggle.appendChild(predCheck); predToggle.appendChild(predTrackEl);
        listen(predCheck, 'change', function () {
          prediction = predCheck.checked;
          try { localStorage.setItem(lsPrefix + '-prediction', prediction ? 'true' : 'false'); } catch (e) { /* ignore */ }
          if (host.onPredictionChange) host.onPredictionChange(prediction);
        });
        predRow.appendChild(predLabel); predRow.appendChild(predToggle);
        el.appendChild(predRow);
      }

      if (features.smoothing !== false) {
        var smoothRow = document.createElement('div');
        smoothRow.className = 'ink-settings-row';
        var smoothLabel = document.createElement('span');
        smoothLabel.className = 'ink-settings-label';
        smoothLabel.textContent = 'Smoothing';
        var smoothRight = document.createElement('span');
        smoothRight.style.display = 'flex'; smoothRight.style.alignItems = 'center'; smoothRight.style.gap = '4px';
        var smoothSlider = document.createElement('input');
        smoothSlider.type = 'range'; smoothSlider.min = '0'; smoothSlider.max = '100';
        smoothSlider.value = String(Math.round(smoothing * 100));
        smoothSlider.className = 'ink-smooth-slider';
        smoothSlider.title = 'Smoothing: ' + Math.round(smoothing * 100) + '%';
        var smoothValue = document.createElement('span');
        smoothValue.style.fontSize = '11px'; smoothValue.style.opacity = '0.6';
        smoothValue.style.minWidth = '28px'; smoothValue.style.textAlign = 'right';
        smoothValue.textContent = Math.round(smoothing * 100) + '%';
        listen(smoothSlider, 'input', function () {
          smoothing = parseInt(smoothSlider.value, 10) / 100;
          smoothSlider.title = 'Smoothing: ' + smoothSlider.value + '%';
          smoothValue.textContent = smoothSlider.value + '%';
          if (host.onSmoothingChange) host.onSmoothingChange(smoothing);
        });
        smoothRight.appendChild(smoothSlider); smoothRight.appendChild(smoothValue);
        smoothRow.appendChild(smoothLabel); smoothRow.appendChild(smoothRight);
        el.appendChild(smoothRow);
      }

      var div1 = document.createElement('div');
      div1.className = 'ink-settings-divider';
      el.appendChild(div1);

      var actionsHeader = document.createElement('div');
      actionsHeader.className = 'ink-settings-section';
      actionsHeader.textContent = 'Actions';
      el.appendChild(actionsHeader);

      if (features.penConfig) {
        var penCfgBtn = document.createElement('button');
        penCfgBtn.className = 'ink-settings-action';
        penCfgBtn.textContent = '✏️ Pen Buttons';
        penCfgBtn.dataset.action = 'pen-config';
        el.appendChild(penCfgBtn);
      }

      if (features.debug) {
        var debugBtn = document.createElement('button');
        debugBtn.className = 'ink-settings-action';
        debugBtn.textContent = '🐛 Debug';
        debugBtn.dataset.action = 'debug';
        el.appendChild(debugBtn);
      }

      if (features.clear) {
        var clearBtn = document.createElement('button');
        clearBtn.className = 'ink-settings-action ink-danger ink-clear-btn';
        clearBtn.textContent = '🗑️ Clear All';
        clearBtn.dataset.action = 'clear';
        clearBtn.dataset.stage = 'idle';
        el.appendChild(clearBtn);
        wireClearAllConfirmation(clearBtn, host);
      }

      listen(el, 'click', function (ev) {
        var btn = ev.target.closest('button');
        if (!btn) return;
        // Clear has its own two-stage confirmation handler — don't fire on click.
        if (btn.dataset.action === 'clear') { ev.stopPropagation(); return; }
        if (btn.dataset.action === 'pen-config' && host.onPenConfig) host.onPenConfig();
        else if (btn.dataset.action === 'debug' && host.onDebug) host.onDebug();
        ev.stopPropagation();
      });

      return { el: el, smoothSlider: smoothSlider };
    }

      // Two-stage confirmation for the destructive "Clear All" action:
    //   stage=idle    → first click arms it (red flashing, "Hold 3s to confirm").
    //   stage=armed   → press-and-hold within 2s; press starts the hold,
    //                   the 2s timer expiring without a hold reverts to idle.
    //   stage=holding → during the 3s hold; releasing early reverts straight
    //                   to idle (user must click again to re-arm). Hold
    //                   completing fires the action.
    function wireClearAllConfirmation(btn, host) {
      var ARM_LABEL = '⚠️ Hold 3s to confirm';
      var IDLE_LABEL = '🗑️ Clear All';
      var ARMED_TIMEOUT_MS = 2000;
      var HOLD_DURATION_MS = 3000;

      var armedTimer = null;
      var holdTimer = null;
      var holdPointerId = null;
      var suppressNextClick = false;

      function reset() {
        btn.dataset.stage = 'idle';
        btn.classList.remove('ink-armed', 'ink-holding');
        btn.textContent = IDLE_LABEL;
        btn.style.removeProperty('--ink-clear-hold-duration');
        if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        holdPointerId = null;
      }
      disposeControls.push(reset);

      function arm() {
        btn.dataset.stage = 'armed';
        btn.classList.add('ink-armed');
        btn.classList.remove('ink-holding');
        btn.textContent = ARM_LABEL;
        if (armedTimer) clearTimeout(armedTimer);
        armedTimer = setTimeout(reset, ARMED_TIMEOUT_MS);
      }

      listen(btn, 'click', function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        // A click that's the tail end of a pointerdown→pointerup from the
        // hold gesture must not re-arm the button.
        if (suppressNextClick) { suppressNextClick = false; return; }
        if (btn.dataset.stage === 'idle') arm();
        // If already armed, click alone does nothing — must press-and-hold.
      });

      listen(btn, 'pointerdown', function (ev) {
        if (btn.dataset.stage !== 'armed') return;
        ev.preventDefault();
        ev.stopPropagation();
        holdPointerId = ev.pointerId;
        try { btn.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
        btn.dataset.stage = 'holding';
        btn.classList.add('ink-holding');
        btn.style.setProperty('--ink-clear-hold-duration', HOLD_DURATION_MS + 'ms');
        // Once a hold starts, the 2s armed-idle timer no longer applies.
        if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
        holdTimer = setTimeout(function () {
          // Hold completed → fire the action.
          // The synthesized click after pointerup must not re-arm the button.
          suppressNextClick = true;
          reset();
          if (host.onClearAll) host.onClearAll();
        }, HOLD_DURATION_MS);
      });

      function cancelHold(ev) {
        if (btn.dataset.stage !== 'holding') return;
        if (ev && holdPointerId !== null && ev.pointerId !== holdPointerId) return;
        try { if (holdPointerId !== null) btn.releasePointerCapture(holdPointerId); } catch (_) { /* ignore */ }
        // Release mid-hold returns all the way to idle — the user must
        // click again to re-arm. The synthesized click that follows pointerup
        // must NOT re-arm the button, so swallow it.
        suppressNextClick = true;
        reset();
      }

      listen(btn, 'pointerup', cancelHold);
      listen(btn, 'pointercancel', cancelHold);
      listen(btn, 'pointerleave', cancelHold);

      // Expose reset so the panel can disarm on close / blur if needed.
      btn._inkClearReset = reset;
    }

    function buildL2TextPanel() {
      var el = document.createElement('div');
      el.className = 'ink-l2-bar ink-l2-text';
      el.style.display = 'none';

      var fontGroup = document.createElement('div');
      fontGroup.className = 'ink-text-font-group';
      var fontBtns = [];
      for (var f = 0; f < TEXT_FONTS.length; f++) {
        var fb = document.createElement('button');
        fb.textContent = TEXT_FONTS[f].name;
        fb.dataset.fontValue = TEXT_FONTS[f].value;
        fb.style.fontFamily = TEXT_FONTS[f].value;
        if (TEXT_FONTS[f].value === textPrefs.fontFamily) fb.classList.add('active');
        fontGroup.appendChild(fb);
        fontBtns.push(fb);
      }
      el.appendChild(fontGroup);

      var sep1 = document.createElement('div'); sep1.className = 'ink-sep'; el.appendChild(sep1);

      var sizeGroup = document.createElement('div');
      sizeGroup.className = 'ink-text-size-group';
      var sizeBtns = [];
      for (var s = 0; s < TEXT_SIZES.length; s++) {
        var sb = document.createElement('button');
        sb.textContent = String(TEXT_SIZES[s]);
        sb.dataset.sizeValue = String(TEXT_SIZES[s]);
        sb.className = 'ink-text-size-btn';
        if (TEXT_SIZES[s] === textPrefs.fontSize) sb.classList.add('active');
        sizeGroup.appendChild(sb);
        sizeBtns.push(sb);
      }
      el.appendChild(sizeGroup);

      var sep2 = document.createElement('div'); sep2.className = 'ink-sep'; el.appendChild(sep2);

      var colorsDiv = document.createElement('div');
      colorsDiv.className = 'ink-colors';
      el.appendChild(colorsDiv);

      function refreshTextColors() {
        renderColorPalette(colorsDiv, textPrefs.colorIndex, function (idx) {
          textPrefs.colorIndex = idx;
          saveCustomColors(lsPrefix, customColors);
          colorTranslateMap = buildColorTranslateMap(customColors);
          saveTextPrefs();
          refreshTextColors();
          if (host.onTextPrefsChange) host.onTextPrefsChange(textPrefs);
        }, customColors, hiddenColorInput, forceLightPalette);
      }
      refreshTextColors();

      listen(el, 'click', function (ev) {
        var btn = ev.target.closest('button');
        if (!btn) return;
        if (btn.dataset.fontValue) {
          textPrefs.fontFamily = btn.dataset.fontValue;
          saveTextPrefs();
          for (var i = 0; i < fontBtns.length; i++) fontBtns[i].classList.toggle('active', fontBtns[i].dataset.fontValue === textPrefs.fontFamily);
          if (host.onTextPrefsChange) host.onTextPrefsChange(textPrefs);
        }
        if (btn.dataset.sizeValue) {
          textPrefs.fontSize = parseInt(btn.dataset.sizeValue, 10);
          saveTextPrefs();
          for (var i = 0; i < sizeBtns.length; i++) sizeBtns[i].classList.toggle('active', parseInt(sizeBtns[i].dataset.sizeValue, 10) === textPrefs.fontSize);
          if (host.onTextPrefsChange) host.onTextPrefsChange(textPrefs);
        }
        ev.stopPropagation();
      });

      return { el: el, refreshColors: refreshTextColors };
    }

    // ---- L3 panel (color + size picker for pen styles) ----

    function buildL3PanelEl() {
      var el = document.createElement('div');
      el.className = 'ink-l3-panel';
      el.style.display = 'none';
      var colorsDiv = document.createElement('div');
      colorsDiv.className = 'ink-colors';
      var sizesDiv = document.createElement('div');
      sizesDiv.className = 'ink-sizes';
      el.appendChild(colorsDiv);
      el.appendChild(sizesDiv);
      return { el: el, colorsDiv: colorsDiv, sizesDiv: sizesDiv, sizeSlider: null, _anchorAction: null };
    }

    function refreshL3() {
      var isEraser = tool === 'eraser';
      var prefs = isEraser ? inkStylePrefs.eraser : inkStylePrefs[inkStyle];

      l3Panel.colorsDiv.innerHTML = '';
      l3Panel.colorsDiv.style.display = isEraser ? 'none' : '';
      if (!isEraser) {
        renderColorPalette(l3Panel.colorsDiv, prefs.colorIndex, function (idx) {
          inkStylePrefs[inkStyle].colorIndex = idx;
          saveInkPrefs();
          refreshL3();
          if (host.onColorChange) host.onColorChange(getActiveColor(), idx);
        }, customColors, hiddenColorInput, forceLightPalette);
      }

      l3Panel.sizeSlider = buildSizeSlider(l3Panel.sizesDiv, prefs.size, function (val) {
        prefs.size = val;
        saveInkPrefs();
        if (host.onSizeChange) host.onSizeChange(val);
      }, isEraser
        ? { kind: 'eraser' }
        : { kind: 'pen', inkStyle: inkStyle, color: getActiveColor() });
    }

    function showL2(l2, anchorBtn) {
      closeL2();
      closeL3();
      chrome.showPanel(l2.el, anchorBtn, { onClose: function () { openL2 = null; } });
      openL2 = l2;
      if (l2 === l2Ink) {
        var sns = Object.keys(l2Ink.styleBtns);
        for (var si = 0; si < sns.length; si++) l2Ink.styleBtns[sns[si]].classList.toggle('active', inkStyle === sns[si] && tool === 'pen');
      }
    }

    function closeL2() {
      chrome.closePanels(2);
    }

    // Host-owned content shares the toolbar's positioning and dismiss lifecycle.
    function showFloatingPanel(el, anchorBtn, onClose) {
      showL2({ el: el, anchor: anchorBtn, onClose: onClose }, anchorBtn);
    }

    function showL3(anchorBtn, actionId) {
      refreshL3();
      l3Panel._anchorAction = actionId || null;
      chrome.showPanel(l3Panel.el, anchorBtn, {
        level: anchorBtn.closest('.ink-l2-bar') ? 3 : 2,
        onClose: function () { openL3 = null; },
      });
      openL3 = l3Panel;
    }

    function closeL3() {
      if (openL3) chrome.closePanels(openL2 ? 3 : 2);
    }

    // ---- Internal mode management ----

    function setModeInternal(m) {
      mode = m;
      l1Hand.classList.toggle('active', m === 'hand');
      if (features.cursor) l1Cursor.classList.toggle('active', m === 'cursor');
      if (features.lasso) l1Select.classList.toggle('active', m === 'select');
      l1Ink.classList.toggle('active', m === 'ink' && tool !== 'eraser');
      l1Eraser.classList.toggle('active', m === 'ink' && tool === 'eraser');
      if (features.text) l1Text.classList.toggle('active', m === 'text');
    }

    function setToolPen() {
      tool = 'pen';
      l1Ink.classList.toggle('active', mode === 'ink');
      l1Eraser.classList.remove('active');
    }

    function setToolEraser() {
      tool = 'eraser';
      l1Ink.classList.remove('active');
      l1Eraser.classList.toggle('active', mode === 'ink');
    }

    function setInkStyleInternal(style) {
      inkStyle = style;
      saveInkPrefs();
      if (host.onInkStyleChange) host.onInkStyleChange(style);
    }

    // ---- L1 click handling ----

    listen(toolbar, 'click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'hand') {
        setModeInternal('hand'); setToolPen();
        if (host.onModeChange) host.onModeChange('hand', 'pen');
        if (openL2 === l2Hand) closeL2();
        else if (l2Hand.el) showL2(l2Hand, btn);
        else closeL2();
      }
      else if (action === 'cursor') {
        setModeInternal('cursor');
        if (host.onModeChange) host.onModeChange('cursor', tool);
        closeL2();
      }
      else if (action === 'select') {
        setModeInternal('select');
        if (host.onModeChange) host.onModeChange('select', tool);
        closeL2();
      }
      else if (action === 'ink') {
        setModeInternal('ink'); setToolPen();
        if (host.onModeChange) host.onModeChange('ink', 'pen');
        if (openL2 === l2Ink) closeL2();
        else showL2(l2Ink, btn);
      }
      else if (action === 'eraser') {
        setModeInternal('ink'); setToolEraser();
        if (host.onModeChange) host.onModeChange('ink', 'eraser');
        if (openL3 && openL3._anchorAction === 'ink-eraser') closeL3();
        else showL3(btn, 'ink-eraser');
      }
      else if (action === 'text') {
        setModeInternal('text'); setToolPen();
        if (host.onModeChange) host.onModeChange('text', 'pen');
        if (openL2 === l2Text) closeL2();
        else if (l2Text.el) showL2(l2Text, btn);
        else closeL2();
      }
      else if (action === 'penonly') {
        penOnlyMode = !penOnlyMode;
        l1PenOnly.classList.toggle('active', penOnlyMode);
        try { localStorage.setItem(lsPrefix + '-pen-only', penOnlyMode ? 'true' : 'false'); } catch (e) { /* ignore */ }
        if (host.onPenOnlyChange) host.onPenOnlyChange(penOnlyMode);
        closeL2();
      }
      else if (action === 'undo') { if (host.onUndo) host.onUndo(); closeL2(); }
      else if (action === 'redo') { if (host.onRedo) host.onRedo(); closeL2(); }
      else if (action === 'settings') {
        if (openL2 === l2Settings) closeL2();
        else showL2(l2Settings, btn);
      }
      else if (action === 'boards') { closeL2(); if (host.onBoards) host.onBoards(); }
      else if (action === 'widgets') {
        var widgetsPanelOpen = openL2 && openL2.anchor === btn && openL2.el.isConnected;
        closeL2();
        if (!widgetsPanelOpen && host.onWidgets) host.onWidgets();
      }
    });

    // ---- Controller ----

    function updateUndoRedo(canUndo, canRedo) {
      l1Undo.disabled = !canUndo;
      l1Redo.disabled = !canRedo;
    }

    function setMode(m) {
      if (m === 'eraser') { setModeInternal('ink'); setToolEraser(); }
      else { setModeInternal(m); setToolPen(); }
    }

    if (tool === 'eraser') setToolEraser();
    else setToolPen();
    setModeInternal(mode);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      closeL2();
      lifetime.abort();
      disposeControls.forEach(function (dispose) { dispose(); });
      [toolbar, l2Ink.el, l2Hand.el, l2Settings.el, l2Text.el, l3Panel.el].forEach(function (root) {
        if (!root) return;
        [root].concat(Array.from(root.querySelectorAll('*'))).forEach(function (element) {
          if (element._inkPaletteDispose) element._inkPaletteDispose();
        });
      });
      hiddenColorInput.onchange = null;
      if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
      chrome.destroy();
      if (l2Ink.el.parentNode) l2Ink.el.parentNode.removeChild(l2Ink.el);
      if (l2Hand.el && l2Hand.el.parentNode) l2Hand.el.parentNode.removeChild(l2Hand.el);
      if (l2Settings.el.parentNode) l2Settings.el.parentNode.removeChild(l2Settings.el);
      if (l2Text.el && l2Text.el.parentNode) l2Text.el.parentNode.removeChild(l2Text.el);
      if (l3Panel.el.parentNode) l3Panel.el.parentNode.removeChild(l3Panel.el);
      if (hiddenColorInput.parentNode) hiddenColorInput.parentNode.removeChild(hiddenColorInput);
    }

    return {
      element: toolbar,
      chrome: chrome,
      setMode: setMode,
      updateUndoRedo: updateUndoRedo,
      destroy: destroy,
      getActiveColor: getActiveColor,
      getActiveLightColor: getActiveLightColor,
      getTextLightColor: function () { return getLightColor(textPrefs.colorIndex); },
      getActiveSize: getActiveSize,
      getInkStyle: function () { return inkStyle; },
      getSmoothing: function () { return smoothing; },
      getMode: function () { return mode; },
      getTool: function () { return tool; },
      getTextPrefs: function () { return textPrefs; },
      getPenOnlyMode: function () { return penOnlyMode; },
      getTouchPanInPenMode: function () { return touchPanInPenMode; },
      getShowHoverCursor: function () { return showHoverCursor; },
      getWacomInput: function () { return wacomInput; },
      getPrediction: function () { return prediction; },
      getInkStylePrefs: function () { return inkStylePrefs; },
      closeL2: closeL2,
      closeL3: closeL3,
      showFloatingPanel: showFloatingPanel,
      refreshPalettes: function () { if (l2Text && l2Text.refreshColors) l2Text.refreshColors(); refreshL3(); },
      setForceLightPalette: function (force) {
        forceLightPalette = !!force;
        updateForceLightMarkers();
        l2Text.refreshColors();
        refreshL3();
      },
    };
  }

  // ---- Exports ----

  var api = {
    create: create,
    createChrome: createChrome,
    ICONS: ICONS,
    COLORS: COLORS,
    DARK_COLORS: DARK_COLORS,
    INK_STYLES: INK_STYLES,
    INK_STYLE_NAMES: INK_STYLE_NAMES,
    TEXT_FONTS: TEXT_FONTS,
    TEXT_SIZES: TEXT_SIZES,
    SIZE_MIN: SIZE_MIN,
    SIZE_MAX: SIZE_MAX,
    SIZE_SNAPS: SIZE_SNAPS,
    DEFAULT_INK_PREFS: DEFAULT_INK_PREFS,
    DEFAULT_TEXT_PREFS: DEFAULT_TEXT_PREFS,
    // Utilities exposed for hosts that need direct access
    isDarkTheme: isDarkTheme,
    getFullPalette: getFullPalette,
    buildColorTranslateMap: buildColorTranslateMap,
    loadCustomColors: loadCustomColors,
    saveCustomColors: saveCustomColors,
    renderColorPalette: renderColorPalette,
    buildSizeSlider: buildSizeSlider,
    makeL1Toolbar: makeL1Toolbar,
    makeL1Btn: makeL1Btn,
    makeL1Sep: makeL1Sep,
    autoDarkVariant: autoDarkVariant,
    autoLightVariant: autoLightVariant,
    perceptualDarkVariant: perceptualDarkVariant,
    perceptualLightVariant: perceptualLightVariant,
    autoThemeVariant: autoThemeVariant,
    hexToOklch: hexToOklch,
    oklchToHex: oklchToHex,
  };

  if (typeof window !== 'undefined') window.InkToolbar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
