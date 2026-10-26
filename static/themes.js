function reloadStandaloneThemeIfNeeded(previousTheme, nextTheme, reloadPage) {
  if (previousTheme === nextTheme || !document.documentElement.classList.contains('pwa-standalone')) return false;
  (reloadPage || function() { window.location.reload(); })();
  return true;
}

// ===== Style Panel (Theme, Font, Width, Layout) =====
function initStylePanel() {
  const themeBtn = document.getElementById('theme-btn');
  const stylePanel = document.getElementById('style-panel');
  const article = document.querySelector('.article');
  const widthRange = document.getElementById('content-width-range');
  const widthValue = document.getElementById('width-value');
  const widthStops = [50, 65, 80, 90, 95, 100];
  const fontSizeRange = document.getElementById('font-size-range');
  const fontSizeValue = document.getElementById('font-size-value');
  const fontSizeStops = [12, 14, 16, 18, 24, 32];
  const lineHeightRange = document.getElementById('line-height-range');
  const lineHeightValue = document.getElementById('line-height-value');
  const lineHeightStops = [1.2, 1.4, 1.6, 1.7, 1.8, 2.2];
  const ignoreCornersSwitch = document.getElementById('ignore-corners-switch');
  const twoColumnsSwitch = document.getElementById('two-columns-switch');
  const nativeJupyterSwitch = document.getElementById('native-jupyter-switch');
  const contentSearchSwitch = document.getElementById('content-search-switch');
  const quickEditSwitch = document.getElementById('quick-edit-switch');
  const linkPreviewSwitch = document.getElementById('link-preview-switch');
  const linkPreviewSamePageOnlySwitch = document.getElementById('link-preview-same-page-only-switch');
  const linkPreviewAutoCloseSwitch = document.getElementById('link-preview-auto-close-switch');
  const linkPreviewOverwriteJumpingSwitch = document.getElementById('link-preview-overwrite-jumping-switch');
  const linkPreviewSettingsChildren = document.getElementById('link-preview-settings-children');
  const debugModeSwitch = document.getElementById('debug-mode-switch');
  const debugChildren = document.getElementById('debug-children');
  const controlRoot = stylePanel || document;
  const debugRoot = debugChildren || document.getElementById('settings-panel') || document;
  const debugLevelButtons = Array.from(debugRoot.querySelectorAll('.debug-level-btn[data-level]'));
  const fontButtons = Array.from(controlRoot.querySelectorAll('.font-btn[data-font]'));
  const fontZhButtons = Array.from(controlRoot.querySelectorAll('.fontzh-btn[data-fontzh]'));
  const fontSizeTicks = Array.from(controlRoot.querySelectorAll('.font-size-tick'));
  const lineHeightTicks = Array.from(controlRoot.querySelectorAll('.line-height-tick'));
  // Initialize before applying preferences: their setters can schedule layout.
  var columnsPreference = '1';
  var refreshTimer = null;
  var resizeBound = false;
  var layoutObserver = null;
  var contentObserver = null;
  var shellObserver = null;
  var observedSizes = new Map();
  var columnsGeneration = 0;
  var anchorViewportWidth = window.innerWidth;
  var anchorViewportHeight = window.innerHeight;
  var singleColumnScrollY = null;

  function forEachTerminalFrame(callback) {
    const panelBody = document.getElementById('terminal-body');
    if (panelBody) {
      const panelFrame = panelBody.querySelector('.terminal-panel-frame');
      if (panelFrame) callback(panelFrame);
    }
    if (document.body.dataset.pageType === 'terminal') {
      const content = document.getElementById('spa-content');
      const terminalFrame = content && content.querySelector('.terminal-frame');
      if (terminalFrame) callback(terminalFrame);
    }
  }

  function activeData(buttons, name, fallback) {
    const active = buttons.find(button => button.classList.contains('active'));
    return active ? active.dataset[name] : fallback;
  }

  // Load saved preferences (fall back to browser color scheme)
  let saved;
  if (window.KbPreferences) {
    saved = window.KbPreferences.get();
  } else {
    try {
      saved = JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
    } catch (e) {
      if (window._log) _log.error('themes', 'Corrupted display prefs in localStorage', String(e));
      saved = {};
    }
  }
  const defaultTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const isMobile = window.matchMedia('(max-width: 650px)').matches;

  function normalizeFontSize(value, source) {
    const legacy = source === 'page'
      ? { normal: 16, large: 24, larger: 30 }
      : { normal: 16, large: 20, larger: 24 };
    const size = Object.prototype.hasOwnProperty.call(legacy, value) ? legacy[value] : Number(value);
    if (fontSizeStops.includes(size)) return size;
    if (size === 20) return 18;
    if (size === 30) return 32;
    return 18;
  }

  function normalizeLineHeight(value) {
    const legacy = { normal: 1.6, relaxed: 1.8, airy: 2.2 };
    const height = Object.prototype.hasOwnProperty.call(legacy, value) ? legacy[value] : Number(value);
    if (lineHeightStops.includes(height)) return height;
    if (height === 1.5) return 1.4;
    if (height === 2) return 2.2;
    return 1.8;
  }

  const fontLatinMap = {
    'system': 'var(--font-sans)',
    'literata': '"Literata", Georgia',
    'ibm-plex': '"IBM Plex Serif", Georgia'
  };
  const fontZhMap = {
    'default': '"Noto Sans SC", "PingFang SC", "Microsoft YaHei"',
    'noto-serif': '"Noto Serif SC"',
    'kaiti': '"LXGW WenKai Screen", "LXGW WenKai", "Kaiti SC", KaiTi, STKaiti'
  };

  applyTheme(saved.theme || defaultTheme);
  applyBgColor(saved.bgColor || 'default');
  applyWidth(saved.contentWidth || (isMobile ? '100' : '90'));
  const defaultEdge = saved.ignoreCorners !== undefined ? saved.ignoreCorners === 'on' : false;
  applyIgnoreCorners(defaultEdge);
  // SPA-only features
  const isSpaMode = document.body.getAttribute('data-spa') === 'true';
  if (isSpaMode) {
    document.querySelectorAll('.spa-only-setting').forEach(el => el.style.display = '');
    applyNativeJupyter(saved.nativeJupyter === 'on');
    applyContentSearch(saved.contentSearch !== 'off');
    applyQuickEdit(saved.quickEdit !== 'off');
  }
  applyLinkPreview(
    saved.linkPreview === 'on',
    saved.linkPreviewSamePageOnly !== 'off',
    saved.linkPreviewAutoClose !== 'off',
    saved.linkPreviewOverwriteJumping === 'on'
  );
  applyFont(saved.fontFamily || 'ibm-plex');
  applyFontSize(saved.fontSize || 'large', saved.fontSizeSource);
  applyFontZh(saved.fontZh || 'noto-serif');
  applyLineHeight(saved.lineHeight || 'relaxed');
  applyDebugMode(saved.debugMode === 'on');
  applyClientLogLevel(saved.clientLogLevel || 'debug');

  // Listen for OS theme changes (only if user hasn't manually chosen)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const prefs = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
    if (!prefs.theme) applyTheme(e.matches ? 'dark' : 'light');
  });

  // Theme toggle (use specific selector to avoid matching <html> element)
  document.querySelectorAll('.style-toggle-btn[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const previousTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const nextTheme = btn.dataset.theme;
      applyTheme(nextTheme);
      applyBgColor(document.documentElement.getAttribute('data-bg') || 'default');
      savePrefs();
      reloadStandaloneThemeIfNeeded(previousTheme, nextTheme);
    });
  });

  function applyTheme(theme) {
    var prev = document.documentElement.getAttribute('data-theme') || 'unknown';
    if (window._log) _log.debug('themes', 'theme changed to ' + theme + ' from ' + prev);
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    document.querySelectorAll('.style-toggle-btn[data-theme]').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === theme);
    });
    // Switch highlight.js theme
    const hljsLink = document.getElementById('hljs-theme');
    if (hljsLink) {
      const hljsTheme = theme === 'dark' ? 'github-dark' : 'github';
      hljsLink.href = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/' + hljsTheme + '.min.css';
    }
    // Notify terminal iframe(s) of theme change
    forEachTerminalFrame(f => {
      if (f.contentWindow) {
        var bg = document.documentElement.getAttribute('data-bg') || 'default';
        f.contentWindow.postMessage({ type: 'theme-change', theme: theme, bgColor: bg }, window.location.origin);
      }
    });
    // Long pages only repaint diagrams that have already been activated.
    if (window.RenderOnDemand && typeof window.RenderOnDemand.refreshTheme === 'function') {
      window.RenderOnDemand.refreshTheme();
    } else if (typeof mermaid !== 'undefined') {
      var mermaidTheme = theme === 'dark' ? 'dark' : 'default';
      var mermaidEls = document.querySelectorAll('pre.mermaid[data-mermaid-source]');
      mermaidEls.forEach(function(el) {
        var source = el.getAttribute('data-mermaid-source');
        // Inject theme directive into the source — most reliable way to override theme
        var themedSource = '%%{init: {"theme": "' + mermaidTheme + '"}}%%\n' + source;
        var id = 'mermaid-re-' + Math.random().toString(36).slice(2, 10);
        mermaid.render(id, themedSource).then(function(result) {
          el.innerHTML = result.svg;
          if (result.bindFunctions) result.bindFunctions(el);
        }).catch(function(e) {
          console.error('[themes] mermaid re-render FAILED:', e);
          if (window._log) _log.error('themes', 'mermaid re-render failed', String(e));
        });
      });
    }
  }

  // Embedded tools use the same theme path as the shell controls, without a
  // standalone-page reload that would interrupt an active editor.
  window._setDisplayTheme = function(theme) {
    if (!['light', 'dark', 'kindle'].includes(theme)) return;
    applyTheme(theme);
    applyBgColor(document.documentElement.getAttribute('data-bg') || 'default');
    if (window.KbPreferences) window.KbPreferences.set({ theme });
    else savePrefs();
  };

  // Background color swatches
  document.querySelectorAll('.bg-swatch[data-bg]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyBgColor(btn.dataset.bg);
      savePrefs();
    });
  });

  function applyBgColor(bg) {
    document.documentElement.setAttribute('data-bg', bg);
    document.querySelectorAll('.bg-swatch[data-bg]').forEach(b => {
      b.classList.toggle('active', b.dataset.bg === bg);
    });
    // Notify terminal iframe(s) of background change
    var theme = document.documentElement.getAttribute('data-theme') || 'dark';
    forEachTerminalFrame(f => {
      if (f.contentWindow) {
        f.contentWindow.postMessage({ type: 'theme-change', theme: theme, bgColor: bg }, window.location.origin);
      }
    });
  }

  // Content width (snap slider)
  if (widthRange) {
    widthRange.addEventListener('input', () => {
      applyWidth(widthStops[widthRange.value]);
      savePrefs();
    });
    // Click on tick labels
    document.querySelectorAll('.width-tick').forEach(tick => {
      tick.addEventListener('click', () => {
        const i = parseInt(tick.dataset.i);
        widthRange.value = i;
        applyWidth(widthStops[i]);
        savePrefs();
      });
    });
  }

  function applyWidth(val) {
    val = Number(val);
    document.documentElement.style.setProperty('--content-max-width', val + '%');
    document.documentElement.dataset.contentWidth = String(val);
    if (widthValue) widthValue.textContent = val + '%';
    if (widthRange) {
      const idx = widthStops.indexOf(val);
      if (idx >= 0) widthRange.value = idx;
    }
    document.querySelectorAll('.width-tick').forEach(tick => {
      tick.classList.toggle('active', widthStops[parseInt(tick.dataset.i)] === val);
    });
    // Drawing/document surfaces own their full-width padding.
    if (ignoreCornersSwitch) {
      if (val === 100 && !isCanvasPage()) {
        ignoreCornersSwitch.disabled = false;
      } else {
        ignoreCornersSwitch.disabled = true;
        applyIgnoreCorners(false);
      }
    }
    // Reflow the book after a content-width change.
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  // Ignore round corners switch
  if (ignoreCornersSwitch) {
    ignoreCornersSwitch.addEventListener('click', () => {
      const on = ignoreCornersSwitch.getAttribute('aria-checked') !== 'true';
      applyIgnoreCorners(on);
      savePrefs();
    });
  }

  function applyIgnoreCorners(on) {
    on = on && !isCanvasPage() && document.documentElement.dataset.contentWidth === '100';
    if (on) {
      document.documentElement.setAttribute('data-ignore-corners', 'on');
    } else {
      document.documentElement.removeAttribute('data-ignore-corners');
    }
    if (ignoreCornersSwitch) ignoreCornersSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  // Expose for fold-banner feature
  window._applyWidth = applyWidth;
  window._applyIgnoreCorners = applyIgnoreCorners;
  window._refreshContentWidth = function() {
    const prefs = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
    applyWidth(document.documentElement.dataset.contentWidth || prefs.contentWidth || (isMobile ? '100' : '90'));
    applyIgnoreCorners(prefs.ignoreCorners === 'on');
  };
  window._saveDisplayPrefs = function(overrides) { savePrefs(overrides); };

  function isCanvasPage() {
    // Library pages keep their page type while hosting the PDF annotator.
    return ['whiteboard', 'pdf', 'library'].includes(document.body.dataset.pageType);
  }

  // Two columns switch
  if (twoColumnsSwitch) {
    twoColumnsSwitch.addEventListener('click', () => {
      const on = twoColumnsSwitch.getAttribute('aria-checked') !== 'true';
      applyColumns(on ? '2' : '1');
      savePrefs();
    });
  }

  // The browser flows the original nodes through fixed-height columns. A turn
  // advances two columns together; no estimated block heights or DOM copies.
  function isArticlePage() {
    var pt = document.body.dataset.pageType;
    return !document.documentElement.classList.contains('link-preview-embed') && (!pt || pt === 'markdown');
  }

  var book = null;
  var bookAnchor = null;
  var bookToolbar = null;

  function ensureBookToolbar() {
    if (bookToolbar || !themeBtn) return bookToolbar;
    // Older published pages can load the current assets before being rebuilt.
    // Upgrade their palette in place while preserving its settings fallback.
    var wrap = document.getElementById('theme-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'theme-wrap';
      wrap.className = 'theme-wrap';
      themeBtn.parentNode.insertBefore(wrap, themeBtn);
      wrap.appendChild(themeBtn);
    }
    var position = document.getElementById('book-position');
    if (!position) {
      position = document.createElement('output');
      position.id = 'book-position';
      position.className = 'book-position';
      position.setAttribute('aria-live', 'polite');
      position.setAttribute('aria-atomic', 'true');
      wrap.appendChild(position);
    }
    function turnButton(id, label, delta) {
      var button = document.getElementById(id);
      if (!button) {
        button = document.createElement('button');
        button.id = id;
        button.className = 'book-nav-btn ' + id;
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.textContent = delta < 0 ? '‹' : '›';
        wrap.appendChild(button);
      }
      button.addEventListener('click', function() { turnBook(delta); });
      return button;
    }
    bookToolbar = { wrap: wrap, position: position,
      prev: turnButton('book-prev', 'Previous spread', -1), next: turnButton('book-next', 'Next spread', 1) };
    return bookToolbar;
  }

  function hideBookToolbar() {
    if (!bookToolbar) return;
    if (bookToolbar.wrap.classList.contains('book-active')) bookToolbar.wrap.classList.remove('book-active');
    bookToolbar.position.hidden = true;
    bookToolbar.prev.hidden = true;
    bookToolbar.next.hidden = true;
    bookToolbar.prev.disabled = true;
    bookToolbar.next.disabled = true;
  }

  function unwrapSpreads(art) {
    if (!art) return;
    var viewport = art.querySelector(':scope > .book-viewport');
    if (viewport) {
      var flow = viewport.querySelector('.spread');
      if (flow) while (flow.firstChild) art.insertBefore(flow.firstChild, viewport);
      viewport.remove();
    }
    // Also accept outgoing wrappers from the former stacked layout.
    Array.from(art.children).forEach(function(child) {
      if (child.classList.contains('spread')) {
        while (child.firstChild) art.insertBefore(child.firstChild, child);
        child.remove();
      } else if (child.classList.contains('book-controls')) child.remove();
    });
    art.querySelectorAll('.book-scroll-block').forEach(function(el) { el.classList.remove('book-scroll-block'); });
  }

  function stopObservingBook() {
    if (layoutObserver) layoutObserver.disconnect();
    if (contentObserver) contentObserver.disconnect();
    observedSizes.clear();
  }

  function scrollOffset() {
    var content = article && article.closest('.content');
    var padding = content ? parseFloat(getComputedStyle(content).paddingTop) || 0 : 16;
    if (article) padding += parseFloat(getComputedStyle(article).paddingTop) || 0;
    var layout = document.querySelector('.main-layout');
    if (layout) return (parseFloat(getComputedStyle(layout).marginTop) || 0) + padding;
    var banner = document.querySelector('.top-banner');
    return (banner && !document.body.classList.contains('banner-folded') ? banner.offsetHeight : 0) + padding;
  }

  function anchorRect(anchor) {
    if (!anchor || !anchor.node || !anchor.node.isConnected) return null;
    if (anchor.node.nodeType === 3 && anchor.node.length) {
      var range = document.createRange();
      var offset = Math.min(anchor.offset || 0, anchor.node.length - 1);
      range.setStart(anchor.node, offset);
      range.setEnd(anchor.node, offset + 1);
      return range.getBoundingClientRect ? range.getBoundingClientRect() : null;
    }
    return anchor.node.getBoundingClientRect ? anchor.node.getBoundingClientRect() : null;
  }

  function captureBookAnchor() {
    if (!book) return null;
    var rect = book.flow.getBoundingClientRect();
    var x = book.viewport.getBoundingClientRect().left + 8;
    var y = Math.max(rect.top + 8, scrollOffset() + 8);
    var caret = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    var range = !caret && document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    var node = caret ? caret.offsetNode : range && range.startContainer;
    if (node && book.flow.contains(node)) return { node: node, offset: caret ? caret.offset : range.startOffset };
    var walker = document.createTreeWalker(book.flow, 4);
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      var textRange = document.createRange();
      textRange.selectNodeContents(node);
      var rects = textRange.getClientRects ? Array.from(textRange.getClientRects()) : [];
      var visible = rects.find(function(r) {
        return r.right > x && r.left < x + book.flow.clientWidth && r.bottom > y && r.top < window.innerHeight;
      });
      if (visible) return { node: node, offset: 0 };
    }
    return null;
  }

  function captureSingleColumnAnchor() {
    if (!article) return null;
    var x = article.getBoundingClientRect().left + 24;
    var y = scrollOffset() + 8;
    var caret = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    var range = !caret && document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    var node = caret ? caret.offsetNode : range && range.startContainer;
    return node && article.contains(node) ? { node: node, offset: caret ? caret.offset : range.startOffset } : bookAnchor;
  }

  function updateBookControls(anchor) {
    if (!book) return;
    var offset = book.page * book.step;
    book.flow.style.transform = 'translateX(' + (-offset) + 'px)';
    book.viewport.scrollLeft = 0;
    var toolbar = ensureBookToolbar();
    if (toolbar) {
      if (!toolbar.wrap.classList.contains('book-active')) toolbar.wrap.classList.add('book-active');
      toolbar.position.hidden = false;
      toolbar.prev.hidden = false;
      toolbar.next.hidden = false;
      toolbar.prev.disabled = book.page === 0;
      toolbar.next.disabled = book.page >= book.pageCount - 1;
      var label = (book.page + 1) + ' / ' + book.pageCount;
      if (toolbar.position.textContent !== label) toolbar.position.textContent = label;
      var ariaLabel = 'Spread ' + (book.page + 1) + ' of ' + book.pageCount;
      if (toolbar.position.getAttribute('aria-label') !== ariaLabel) toolbar.position.setAttribute('aria-label', ariaLabel);
    }
    bookAnchor = anchor || captureBookAnchor();
    document.dispatchEvent(new CustomEvent('twoColumnPageChange'));
  }

  function turnBook(delta) {
    if (!book) return false;
    book.page = Math.max(0, Math.min(book.pageCount - 1, book.page + delta));
    updateBookControls();
    return true;
  }

  function revealBookAnchor(anchor) {
    var rect = anchorRect(anchor);
    if (!book || !rect) return false;
    var flowRect = book.flow.getBoundingClientRect();
    book.page = Math.max(0, Math.min(book.pageCount - 1, Math.floor((rect.left - flowRect.left + 1) / book.step)));
    return true;
  }

  function expandBookDetails(element) {
    var details = element && element.closest('details:not([open])');
    var expanded = false;
    var root = book ? book.flow : article;
    while (details && root && root.contains(details)) {
      details.open = true;
      expanded = true;
      details = details.parentElement && details.parentElement.closest('details:not([open])');
    }
    return expanded;
  }

  function scrollToReadingAnchor(anchor) {
    var rect = anchorRect(anchor);
    if (!rect) return false;
    singleColumnScrollY = Math.max(0, rect.top + (window.scrollY || 0) - scrollOffset());
    window.scrollTo({ top: singleColumnScrollY, behavior: 'instant' });
    return true;
  }

  function goToBookAnchor(anchor) {
    if (!book || !anchor || !anchor.node || !book.flow.contains(anchor.node)) return false;
    var element = anchor.node.nodeType === 1 ? anchor.node : anchor.node.parentElement;
    if (expandBookDetails(element)) layoutBook(bookAnchor);
    revealBookAnchor(anchor);
    // Element navigation keeps the visible text as its reflow anchor.
    updateBookControls(typeof anchor.offset === 'number' ? anchor : null);
    var top = book.viewport.getBoundingClientRect().top + (window.scrollY || 0) - scrollOffset();
    if (Math.abs(top - (window.scrollY || 0)) > 1) window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    return true;
  }

  function goToBookElement(element) {
    return goToBookAnchor({ node: element });
  }

  function observeBook() {
    if (!book) return;
    if (typeof ResizeObserver === 'function') {
      if (!layoutObserver) layoutObserver = new ResizeObserver(function(entries) {
        if (!book) return;
        var changed = entries.some(function(entry) {
          var rect = entry.target.getBoundingClientRect();
          var previous = observedSizes.get(entry.target);
          return previous && ((!entry.target.classList.contains('top-banner') && Math.abs(previous.width - rect.width) > 0.5) ||
            (entry.target !== article && Math.abs(previous.height - rect.height) > 0.5));
        });
        if (changed) scheduleRefresh();
      });
      var targets = [article].concat(Array.from(book.flow.children));
      var content = article.closest('.content');
      if (content) targets.push(content);
      var banner = document.querySelector('.top-banner');
      if (banner) targets.push(banner);
      targets.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        observedSizes.set(el, { width: rect.width, height: rect.height });
        layoutObserver.observe(el);
      });
    }
    if (typeof MutationObserver === 'function') {
      if (!contentObserver) contentObserver = new MutationObserver(function(records) {
        if (book && records.some(function(record) { return record.target !== book.flow || record.type !== 'attributes'; })) scheduleRefresh();
      });
      contentObserver.observe(book.flow, { childList: true, subtree: true, characterData: true, attributes: true });
    }
  }

  function availableBookHeight() {
    var content = article.closest('.content');
    var bottomPadding = parseFloat(getComputedStyle(article).paddingBottom) || 0;
    if (content) {
      var style = getComputedStyle(content);
      // The scrolling document's end space belongs only after the full article,
      // not after every spread. Exclude it before mounting, too, so the height
      // threshold is the same when entering and leaving book mode.
      bottomPadding += (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.marginBottom) || 0) -
        (parseFloat(style.getPropertyValue('--content-end-space')) || 0);
    }
    // Keep the ordinary inset and the platform's bottom safe area.
    return (window.innerHeight || 800) - scrollOffset() - bottomPadding;
  }

  function layoutBook(anchor) {
    if (!book) return;
    stopObservingBook();
    var height = availableBookHeight();
    article.style.setProperty('--book-page-height', height + 'px');
    // Scroll containers and authored fixed-height blocks cannot fragment. Keep
    // their full contents reachable inside one page. Ordinary text fragments.
    book.flow.querySelectorAll('.book-scroll-block').forEach(function(el) { el.classList.remove('book-scroll-block'); });
    Array.from(book.flow.children).forEach(function(el) {
      if (el.getClientRects().length === 1 && el.getBoundingClientRect().height > height + 1) {
        el.classList.add('book-scroll-block');
      }
    });
    var width = book.flow.clientWidth;
    var gap = parseFloat(getComputedStyle(book.flow).columnGap) || 40;
    book.step = width + gap;
    book.pageCount = Math.max(1, Math.ceil((book.flow.scrollWidth + gap - 1) / Math.max(1, book.step)));
    var revealed = revealBookAnchor(anchor);
    if (!revealed) book.page = Math.min(book.page, book.pageCount - 1);
    // Resizes can arrive throughout a sidebar transition. Keep the same text
    // anchor across those layouts; recapturing each spread's first line drifts
    // backward whenever a reflow moves the original anchor within the spread.
    updateBookControls(revealed ? anchor : null);
    observeBook();
  }

  function createBook() {
    var viewport = document.createElement('div');
    viewport.className = 'book-viewport';
    var flow = document.createElement('div');
    flow.className = 'spread';
    while (article.firstChild) flow.appendChild(article.firstChild);
    viewport.appendChild(flow);
    article.appendChild(viewport);
    var url = new URL(location.href);
    url.searchParams.delete('pwa');
    book = { viewport: viewport, flow: flow, page: 0, pageCount: 1, step: 1,
      wheelDelta: 0, wheelDirection: 0, wheelLastAt: 0, wheelTurned: false, path: url.pathname + url.search };
    viewport.addEventListener('wheel', onBookWheel, { passive: false });
    viewport.addEventListener('load', scheduleRefresh, true);
    viewport.addEventListener('toggle', scheduleRefresh, true);
    viewport.addEventListener('focusin', function(event) { goToBookElement(event.target); });
    // Native find/focus may scroll the clipping viewport. Normalize that move
    // to a complete pair rather than leaving half of each page on screen.
    viewport.addEventListener('scroll', function() {
      if (!book || !viewport.scrollLeft) return;
      var shift = viewport.scrollLeft;
      viewport.scrollLeft = 0;
      book.page = Math.max(0, Math.min(book.pageCount - 1, book.page + Math.round(shift / book.step)));
      updateBookControls();
    });
  }

  function onBookWheel(event) {
    if (!book || event.currentTarget !== book.viewport || event.defaultPrevented || event.ctrlKey || event.metaKey ||
        window.matchMedia('(max-width: 1100px)').matches || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    var target = event.target.nodeType === 1 ? event.target : event.target.parentElement;
    if (target && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
    // Let nested content own the complete gesture, including its momentum at
    // the boundary. Standalone pages do not load the application's math wheel
    // adapter, so recognize both horizontal and vertical scrollers here.
    for (var node = target; node && node !== book.flow && node !== book.viewport; node = node.parentElement) {
      var style = getComputedStyle(node);
      if ((/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) ||
          (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1)) return;
    }
    event.preventDefault();
    var now = performance.now();
    var direction = event.deltaY > 0 ? 1 : -1;
    if (now - book.wheelLastAt >= 180 || direction !== book.wheelDirection) {
      book.wheelDelta = 0;
      book.wheelTurned = false;
    }
    book.wheelLastAt = now;
    book.wheelDirection = direction;
    if (book.wheelTurned) return;
    var scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? book.flow.clientHeight : 1;
    book.wheelDelta += Math.abs(event.deltaY) * scale;
    if (book.wheelDelta < 40) return;
    book.wheelTurned = true;
    turnBook(direction);
  }

  function scheduleRefresh() {
    if (columnsPreference !== '2' || !isArticlePage()) return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    var generation = columnsGeneration;
    refreshTimer = setTimeout(function() {
      refreshTimer = null;
      if (generation === columnsGeneration) applyColumns(columnsPreference);
    }, 100);
  }

  function trackSingleColumnReading() {
    if (!book && refreshTimer === null && anchorViewportWidth === window.innerWidth && anchorViewportHeight === window.innerHeight) {
      if (singleColumnScrollY !== null && Math.abs((window.scrollY || 0) - singleColumnScrollY) < 2) return;
      bookAnchor = captureSingleColumnAnchor();
      singleColumnScrollY = window.scrollY || 0;
    }
  }

  function bindResize() {
    if (resizeBound) return;
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    window.addEventListener('scroll', trackSingleColumnReading, { passive: true });
    if (typeof MutationObserver === 'function') {
      shellObserver = new MutationObserver(function(records) {
        if (records.some(function(record) { return record.oldValue !== record.target.getAttribute(record.attributeName); })) scheduleRefresh();
      });
      shellObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
      var layout = document.querySelector('.main-layout');
      if (layout) shellObserver.observe(layout, { attributes: true, attributeFilter: ['class', 'style'], attributeOldValue: true });
      var content = article.closest('.content');
      if (content) shellObserver.observe(content, { attributes: true, attributeFilter: ['class', 'style'], attributeOldValue: true });
      var banner = document.querySelector('.top-banner');
      // Also resume a short-window reader when the banner shrinks.
      if (banner) shellObserver.observe(banner, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    }
    if (document.fonts) {
      document.fonts.addEventListener('loadingdone', scheduleRefresh);
      var generation = columnsGeneration;
      document.fonts.ready.then(function() {
        if (generation === columnsGeneration) scheduleRefresh();
      });
    }
    resizeBound = true;
  }

  function unbindResize() {
    columnsGeneration++;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
    stopObservingBook();
    if (shellObserver) shellObserver.disconnect();
    shellObserver = null;
    window.removeEventListener('resize', scheduleRefresh);
    window.removeEventListener('scroll', trackSingleColumnReading);
    if (document.fonts) document.fonts.removeEventListener('loadingdone', scheduleRefresh);
    resizeBound = false;
  }

  function disposeTwoColumns() {
    unbindResize();
    unwrapSpreads(article);
    book = null;
    bookAnchor = null;
    hideBookToolbar();
    if (article) {
      if (article.classList.contains('two-columns')) article.classList.remove('two-columns');
      article.style.removeProperty('--book-page-height');
    }
    if (document.body.classList.contains('has-two-columns')) document.body.classList.remove('has-two-columns');
  }

  function applyColumns(cols) {
    columnsPreference = cols === '2' ? '2' : '1';
    var eligible = columnsPreference === '2' && isArticlePage() && article;
    var wide = !window.matchMedia('(max-width: 1100px)').matches;
    // A tiny page cannot fit ordinary text fragmentation. Suspend the reader
    // rather than clip text or grow its fixed pages beyond the screen.
    var minimumHeight = article ? Math.max(128, 2 * (parseFloat(getComputedStyle(article).lineHeight) || 0)) : 128;
    if (eligible && wide && availableBookHeight() >= minimumHeight) {
      // Capture before the fixed reader clamps the ordinary document's scroll.
      if (!book && !bookAnchor) bookAnchor = captureSingleColumnAnchor();
      if (!article.classList.contains('two-columns')) article.classList.add('two-columns');
      if (!document.body.classList.contains('has-two-columns')) document.body.classList.add('has-two-columns');
      if (!book || !article.contains(book.viewport)) {
        if (!bookAnchor) bookAnchor = captureSingleColumnAnchor();
        stopObservingBook();
        book = null;
        unwrapSpreads(article);
        createBook();
      }
      layoutBook(bookAnchor);
      if (window.scrollX || window.scrollY) window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      bindResize();
    } else {
      var anchor = bookAnchor;
      // A suspended reader keeps its resize/font bindings. Rebinding on every
      // refresh requeues an already-resolved fonts.ready promise indefinitely.
      if (book || !eligible) disposeTwoColumns();
      if (eligible) {
        bookAnchor = anchor;
        bindResize();
      }
      if (anchor && anchor.node.isConnected) {
        scrollToReadingAnchor(anchor);
      }
    }
    if (twoColumnsSwitch) twoColumnsSwitch.setAttribute('aria-checked', columnsPreference === '2' && isArticlePage() ? 'true' : 'false');
    var columnsShortcut = document.querySelector('[data-shortcut="columns"]');
    if (columnsShortcut) columnsShortcut.style.display = isArticlePage() ? '' : 'none';
    anchorViewportWidth = window.innerWidth;
    anchorViewportHeight = window.innerHeight;
  }

  function refreshTwoColumns() {
    var prefs = window.KbPreferences ? window.KbPreferences.get() : {};
    if (!window.KbPreferences) {
      try { prefs = JSON.parse(localStorage.getItem('kb-display-prefs') || '{}'); }
      catch (error) { if (window._log) _log.warn('themes', 'Cannot read column preference', String(error)); }
    }
    applyColumns(prefs.columns || '1');
  }
  window._refreshTwoColumns = refreshTwoColumns;
  window._disposeTwoColumns = disposeTwoColumns;
  window.TwoColumnReader = {
    next: function() { return turnBook(1); },
    previous: function() { return turnBook(-1); },
    goToElement: goToBookElement,
    goToRange: function(range) {
      return range && goToBookAnchor({ node: range.startContainer, offset: range.startOffset });
    },
    refresh: refreshTwoColumns,
    getState: function() { return { active: !!book, page: book ? book.page + 1 : 1, pageCount: book ? book.pageCount : 1 }; },
    getNavigationRestoreState: function() {
      if (!book && (columnsPreference !== '2' || !isArticlePage() || !bookAnchor)) return null;
      var root = book ? book.flow : article;
      var node = bookAnchor && bookAnchor.node;
      if (node && !root.contains(node)) node = null;
      var element = node && (node.nodeType === 1 ? node : node.parentElement);
      var identified = element && element.closest('[id]');
      if ((!identified || !root.contains(identified)) && article.id) identified = article;
      var anchorOffset;
      if (identified && (identified === article || root.contains(identified)) && node && node.nodeType === 3) {
        var range = document.createRange();
        range.selectNodeContents(identified);
        range.setEnd(node, Math.min(bookAnchor.offset || 0, node.length));
        anchorOffset = range.toString().length;
      }
      var url = new URL(location.href);
      url.searchParams.delete('pwa');
      return { page: book ? book.page + 1 : 1, anchor: identified && (identified === article || root.contains(identified)) ? identified.id : undefined, anchorOffset: anchorOffset,
        path: (book ? book.path : url.pathname + url.search) + url.hash };
    },
    restoreNavigationState: function(state) {
      if (!state || !Number.isFinite(Number(state.page)) ||
          (!book && (columnsPreference !== '2' || !isArticlePage() || !article))) return false;
      var root = book ? book.flow : article;
      var identified = state.anchor && document.getElementById(state.anchor);
      if (identified && (identified === article || root.contains(identified))) {
        if (Number.isInteger(state.anchorOffset) && state.anchorOffset >= 0) {
          var walker = document.createTreeWalker(identified === article ? root : identified, 4);
          var remaining = state.anchorOffset;
          var text;
          while ((text = walker.nextNode())) {
            if (remaining < text.length) {
              if (expandBookDetails(text.parentElement) && book) layoutBook(bookAnchor);
              bookAnchor = { node: text, offset: remaining };
              if (book) {
                revealBookAnchor(bookAnchor);
                updateBookControls(bookAnchor);
              } else scrollToReadingAnchor(bookAnchor);
              return true;
            }
            remaining -= text.length;
          }
        }
        if (!book) {
          expandBookDetails(identified);
          bookAnchor = { node: identified };
          return scrollToReadingAnchor(bookAnchor);
        }
        if (goToBookElement(identified)) return true;
      }
      if (!book) return false;
      book.page = Math.max(0, Math.min(book.pageCount - 1, Math.floor(Number(state.page)) - 1));
      updateBookControls();
      return true;
    }
  };

  document.addEventListener('keydown', function(event) {
    if (!book || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    var target = event.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
    if (event.key === ' ' && target && target.closest && target.closest('button, a, summary')) return;
    if (event.shiftKey && event.key !== ' ') return;
    var delta = event.key === 'PageDown' || event.key === 'ArrowRight' || (event.key === ' ' && !event.shiftKey) ? 1
      : event.key === 'PageUp' || event.key === 'ArrowLeft' || (event.key === ' ' && event.shiftKey) ? -1 : 0;
    if (!delta) return;
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && target && target.closest) {
      var horizontalBlock = target.closest('.book-scroll-block, pre, table');
      if (horizontalBlock && horizontalBlock.scrollWidth > horizontalBlock.clientWidth + 1) {
        event.preventDefault();
        event.stopPropagation();
        horizontalBlock.scrollLeft += event.key === 'ArrowRight' ? 40 : -40;
        return;
      }
    }
    // Let a focused oversized block consume its own vertical paging keys.
    if ((event.key === 'PageDown' || event.key === 'PageUp' || event.key === ' ') && target && target.closest) {
      var scrollBlock = target.closest('.book-scroll-block, pre, table');
      if (scrollBlock && scrollBlock.scrollHeight > scrollBlock.clientHeight + 1) return;
    }
    event.preventDefault();
    event.stopPropagation();
    turnBook(delta);
  }, true);

  function revealHash() {
    if (!book || !location.hash) return;
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (error) { id = location.hash.slice(1); }
    goToBookElement(document.getElementById(id));
  }
  window.addEventListener('hashchange', revealHash);
  var selectingText = false;
  document.addEventListener('pointerdown', function() { selectingText = true; }, true);
  document.addEventListener('pointerup', function() { selectingText = false; }, true);
  document.addEventListener('pointercancel', function() { selectingText = false; }, true);
  document.addEventListener('selectionchange', function() {
    if (!book || selectingText) return;
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.focusNode || !book.flow.contains(selection.focusNode)) return;
    var node = selection.focusNode;
    var element = node.nodeType === 1 ? node : node.parentElement;
    var scroller = element && element.closest('.book-scroll-block, pre, table');
    var anchor = scroller ? { node: scroller } : { node: node, offset: selection.focusOffset };
    var rect = anchorRect(anchor);
    var viewport = book.viewport.getBoundingClientRect();
    if (rect && (rect.right < viewport.left || rect.left > viewport.right)) {
      revealBookAnchor(anchor);
      updateBookControls();
    }
  });
  document.addEventListener('click', function(event) {
    if (!book || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = event.target.closest && event.target.closest('a[href]');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    var url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
    var id;
    try { id = decodeURIComponent(url.hash.slice(1)); } catch (error) { id = url.hash.slice(1); }
    if (goToBookElement(document.getElementById(id))) {
      event.preventDefault();
      history.pushState(null, '', url.href);
    }
  });
  window.addEventListener('pagehide', unbindResize);
  window.addEventListener('pageshow', function(event) { if (event.persisted) refreshTwoColumns(); });

  // Native Jupyter switch (SPA-only)
  if (nativeJupyterSwitch) {
    nativeJupyterSwitch.addEventListener('click', () => {
      const on = nativeJupyterSwitch.getAttribute('aria-checked') !== 'true';
      applyNativeJupyter(on);
      savePrefs();
    });
  }

  function applyNativeJupyter(on) {
    if (nativeJupyterSwitch) nativeJupyterSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
    document.dispatchEvent(new CustomEvent('nativeJupyterToggle', { detail: { enabled: on } }));
  }

  // Content search switch (SPA-only)
  if (contentSearchSwitch) {
    contentSearchSwitch.addEventListener('click', () => {
      const on = contentSearchSwitch.getAttribute('aria-checked') !== 'true';
      applyContentSearch(on);
      savePrefs();
    });
  }

  function applyContentSearch(on) {
    if (contentSearchSwitch) contentSearchSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  // Quick edit switch (SPA-only)
  if (quickEditSwitch) {
    quickEditSwitch.addEventListener('click', () => {
      const on = quickEditSwitch.getAttribute('aria-checked') !== 'true';
      applyQuickEdit(on);
      savePrefs();
    });
  }

  function applyQuickEdit(on) {
    if (quickEditSwitch) quickEditSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
    // Dispatch custom event for main.js to listen
    document.dispatchEvent(new CustomEvent('quickEditToggle', { detail: { enabled: on } }));
  }

  if (linkPreviewSwitch) {
    linkPreviewSwitch.addEventListener('click', () => {
      const enabled = linkPreviewSwitch.getAttribute('aria-checked') !== 'true';
      const samePageOnly = !linkPreviewSamePageOnlySwitch || linkPreviewSamePageOnlySwitch.getAttribute('aria-checked') === 'true';
      const autoClose = !linkPreviewAutoCloseSwitch || linkPreviewAutoCloseSwitch.getAttribute('aria-checked') === 'true';
      const overwriteJumping = !!linkPreviewOverwriteJumpingSwitch && linkPreviewOverwriteJumpingSwitch.getAttribute('aria-checked') === 'true';
      applyLinkPreview(enabled, samePageOnly, autoClose, overwriteJumping);
      savePrefs();
    });
  }

  if (linkPreviewSamePageOnlySwitch) {
    linkPreviewSamePageOnlySwitch.addEventListener('click', () => {
      if (linkPreviewSamePageOnlySwitch.disabled) return;
      const enabled = !linkPreviewSwitch || linkPreviewSwitch.getAttribute('aria-checked') === 'true';
      const samePageOnly = linkPreviewSamePageOnlySwitch.getAttribute('aria-checked') !== 'true';
      const autoClose = !linkPreviewAutoCloseSwitch || linkPreviewAutoCloseSwitch.getAttribute('aria-checked') === 'true';
      const overwriteJumping = !!linkPreviewOverwriteJumpingSwitch && linkPreviewOverwriteJumpingSwitch.getAttribute('aria-checked') === 'true';
      applyLinkPreview(enabled, samePageOnly, autoClose, overwriteJumping);
      savePrefs();
    });
  }

  if (linkPreviewAutoCloseSwitch) {
    linkPreviewAutoCloseSwitch.addEventListener('click', () => {
      if (linkPreviewAutoCloseSwitch.disabled) return;
      const enabled = !linkPreviewSwitch || linkPreviewSwitch.getAttribute('aria-checked') === 'true';
      const samePageOnly = !linkPreviewSamePageOnlySwitch || linkPreviewSamePageOnlySwitch.getAttribute('aria-checked') === 'true';
      const autoClose = linkPreviewAutoCloseSwitch.getAttribute('aria-checked') !== 'true';
      const overwriteJumping = !!linkPreviewOverwriteJumpingSwitch && linkPreviewOverwriteJumpingSwitch.getAttribute('aria-checked') === 'true';
      applyLinkPreview(enabled, samePageOnly, autoClose, overwriteJumping);
      savePrefs();
    });
  }

  if (linkPreviewOverwriteJumpingSwitch) {
    linkPreviewOverwriteJumpingSwitch.addEventListener('click', () => {
      if (linkPreviewOverwriteJumpingSwitch.disabled) return;
      const enabled = !linkPreviewSwitch || linkPreviewSwitch.getAttribute('aria-checked') === 'true';
      const samePageOnly = !linkPreviewSamePageOnlySwitch || linkPreviewSamePageOnlySwitch.getAttribute('aria-checked') === 'true';
      const autoClose = !linkPreviewAutoCloseSwitch || linkPreviewAutoCloseSwitch.getAttribute('aria-checked') === 'true';
      const overwriteJumping = linkPreviewOverwriteJumpingSwitch.getAttribute('aria-checked') !== 'true';
      applyLinkPreview(enabled, samePageOnly, autoClose, overwriteJumping);
      savePrefs();
    });
  }

  function applyLinkPreview(enabled, samePageOnly, autoClose, overwriteJumping) {
    if (linkPreviewSwitch) {
      linkPreviewSwitch.setAttribute('aria-checked', enabled ? 'true' : 'false');
      linkPreviewSwitch.setAttribute('aria-expanded', enabled ? 'true' : 'false');
    }
    if (linkPreviewSamePageOnlySwitch) {
      linkPreviewSamePageOnlySwitch.setAttribute('aria-checked', samePageOnly ? 'true' : 'false');
      linkPreviewSamePageOnlySwitch.disabled = !enabled;
    }
    if (linkPreviewAutoCloseSwitch) {
      linkPreviewAutoCloseSwitch.setAttribute('aria-checked', autoClose ? 'true' : 'false');
      linkPreviewAutoCloseSwitch.disabled = !enabled;
    }
    if (linkPreviewOverwriteJumpingSwitch) {
      linkPreviewOverwriteJumpingSwitch.setAttribute('aria-checked', overwriteJumping ? 'true' : 'false');
      linkPreviewOverwriteJumpingSwitch.disabled = !enabled;
    }
    if (linkPreviewSettingsChildren) linkPreviewSettingsChildren.hidden = !enabled;
    document.dispatchEvent(new CustomEvent('linkPreviewSettingsChange', {
      detail: { enabled: enabled, samePageOnly: samePageOnly, autoClose: autoClose, overwriteJumping: overwriteJumping }
    }));
  }

  // Debug mode switch
  if (debugModeSwitch) {
    debugModeSwitch.addEventListener('click', () => {
      const on = debugModeSwitch.getAttribute('aria-checked') !== 'true';
      applyDebugMode(on);
      savePrefs();
    });
  }

  function applyDebugMode(on) {
    if (debugModeSwitch) {
      debugModeSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
      debugModeSwitch.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    if (debugChildren) debugChildren.hidden = !on;
    if (window._log && window._log._setDebugMode) window._log._setDebugMode(on);
  }

  // Client log level toggle (inside debug children)
  debugLevelButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      applyClientLogLevel(btn.dataset.level);
      savePrefs();
    });
  });

  function applyClientLogLevel(level) {
    debugLevelButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.level === level);
    });
    if (window._log && window._log._setLevel) window._log._setLevel(level);
  }

  // Font family
  fontButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      applyFont(btn.dataset.font);
      savePrefs();
    });
  });

  function applyFont(f) {
    document.documentElement.style.setProperty('--font-latin', fontLatinMap[f] || 'var(--font-sans)');
    fontButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.font === f);
    });
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  // Font size (snap slider)
  if (fontSizeRange) {
    fontSizeRange.addEventListener('input', () => {
      applyFontSize(fontSizeStops[fontSizeRange.value]);
      savePrefs({ fontSizeSource: 'panel' });
    });
    fontSizeTicks.forEach(tick => {
      tick.addEventListener('click', () => {
        const index = parseInt(tick.dataset.i);
        fontSizeRange.value = index;
        applyFontSize(fontSizeStops[index]);
        savePrefs({ fontSizeSource: 'panel' });
      });
    });
  }

  function applyFontSize(value, source) {
    const size = normalizeFontSize(value, source);
    document.documentElement.setAttribute('data-font-size', String(size));
    document.documentElement.style.setProperty('--page-font-size', size + 'px');
    if (fontSizeValue) fontSizeValue.textContent = size + 'px';
    if (fontSizeRange) fontSizeRange.value = fontSizeStops.indexOf(size);
    fontSizeTicks.forEach(tick => {
      tick.classList.toggle('active', fontSizeStops[parseInt(tick.dataset.i)] === size);
    });
    // Notify terminal iframe(s) of font size change
    forEachTerminalFrame(f => {
      if (f.contentWindow) {
        f.contentWindow.postMessage({ type: 'font-size-change', fontSize: size }, window.location.origin);
      }
    });
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  // Chinese font family
  fontZhButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      applyFontZh(btn.dataset.fontzh);
      savePrefs();
    });
  });

  function applyFontZh(f) {
    document.documentElement.style.setProperty('--font-zh', fontZhMap[f] || fontZhMap['default']);
    fontZhButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.fontzh === f);
    });
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  // Line spacing (snap slider)
  if (lineHeightRange) {
    lineHeightRange.addEventListener('input', () => {
      applyLineHeight(lineHeightStops[lineHeightRange.value]);
      savePrefs();
    });
    lineHeightTicks.forEach(tick => {
      tick.addEventListener('click', () => {
        const index = parseInt(tick.dataset.i);
        lineHeightRange.value = index;
        applyLineHeight(lineHeightStops[index]);
        savePrefs();
      });
    });
  }

  function applyLineHeight(value) {
    const height = normalizeLineHeight(value);
    document.documentElement.setAttribute('data-line-height', String(height));
    document.documentElement.style.setProperty('--page-line-height', String(height));
    if (lineHeightValue) lineHeightValue.textContent = height.toFixed(1);
    if (lineHeightRange) lineHeightRange.value = lineHeightStops.indexOf(height);
    lineHeightTicks.forEach(tick => {
      tick.classList.toggle('active', lineHeightStops[parseInt(tick.dataset.i)] === height);
    });
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  function savePrefs(overrides = {}) {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const contentWidth = widthStops[widthRange ? widthRange.value : 2] || 90;
    // Preserve the saved 'columns' pref when on a non-article page (where the
    // toggle is hidden and the class is intentionally not on .article); only
    // overwrite when the toggle is actually meaningful for this page.
    const prev = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
    const isArticle = !document.documentElement.classList.contains('link-preview-embed') &&
      (!document.body.dataset.pageType || document.body.dataset.pageType === 'markdown');
    const columns = isArticle
      ? columnsPreference
      : (prev.columns || '1');
    const ignoreCorners = overrides.ignoreCorners !== undefined ? overrides.ignoreCorners
      : isCanvasPage() ? (prev.ignoreCorners || 'off')
      : (document.documentElement.hasAttribute('data-ignore-corners') ? 'on' : 'off');
    const bgColor = document.documentElement.getAttribute('data-bg') || 'default';
    const fontFamily = activeData(fontButtons, 'font', 'system');
    const fontSize = document.documentElement.getAttribute('data-font-size') || '20';
    const fontZh = activeData(fontZhButtons, 'fontzh', 'default');
    const lineHeight = document.documentElement.getAttribute('data-line-height') || '1.8';
    const nativeJupyter = nativeJupyterSwitch && nativeJupyterSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
    const contentSearch = contentSearchSwitch && contentSearchSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
    const quickEdit = quickEditSwitch && quickEditSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
    const fontSizeSource = overrides.fontSizeSource || prev.fontSizeSource || 'panel';
    // Preserve SPA-only settings if not in SPA mode
    const savedNativeJupyter = document.body.getAttribute('data-spa') === 'true' ? nativeJupyter : (prev.nativeJupyter || 'off');
    const savedContentSearch = document.body.getAttribute('data-spa') === 'true' ? contentSearch : (prev.contentSearch || 'off');
    const savedQuickEdit = document.body.getAttribute('data-spa') === 'true' ? quickEdit : (prev.quickEdit || 'off');
    const linkPreview = linkPreviewSwitch
      ? (linkPreviewSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off')
      : (prev.linkPreview || 'off');
    const linkPreviewSamePageOnly = linkPreviewSamePageOnlySwitch
      ? (linkPreviewSamePageOnlySwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off')
      : (prev.linkPreviewSamePageOnly || 'on');
    const linkPreviewAutoClose = linkPreviewAutoCloseSwitch
      ? (linkPreviewAutoCloseSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off')
      : (prev.linkPreviewAutoClose || 'on');
    const linkPreviewOverwriteJumping = linkPreviewOverwriteJumpingSwitch
      ? (linkPreviewOverwriteJumpingSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off')
      : (prev.linkPreviewOverwriteJumping || 'off');
    const debugModeVal = debugModeSwitch && debugModeSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
    const clientLogLevel = activeData(debugLevelButtons, 'level', 'debug');
    const nextPrefs = { theme, contentWidth, columns, ignoreCorners, bgColor, fontFamily, fontSize, fontZh, lineHeight, fontSizeSource, nativeJupyter: savedNativeJupyter, contentSearch: savedContentSearch, quickEdit: savedQuickEdit, linkPreview, linkPreviewSamePageOnly, linkPreviewAutoClose, linkPreviewOverwriteJumping, debugMode: debugModeVal, clientLogLevel };
    // Merge (not replace) so preferences this panel doesn't know about —
    // e.g. `kbShortcuts` (toggled elsewhere in app.js) or any other future
    // schema key — are preserved rather than silently dropped.
    if (window.KbPreferences) {
      window.KbPreferences.set(nextPrefs);
      return;
    }
    try {
      localStorage.setItem('kb-display-prefs', JSON.stringify(Object.assign({}, prev, nextPrefs)));
    } catch (e) {
      if (window._log) _log.error('themes', 'Failed to save prefs to localStorage', String(e));
    }
  }
  applyColumns(saved.columns || '1');
  revealHash();
}

// Initialize: run immediately if DOM is ready, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStylePanel);
} else {
  initStylePanel();
}

// Toggle panel — theme-btn is an <a href="/static/settings.html">.
// On capable browsers: JS intercepts click, toggles the panel, prevents navigation.
// On Kindle or browsers where JS events fail: the link navigates to the settings page.
(function() {
  var btn = document.getElementById('theme-btn');
  var panel = document.getElementById('style-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', function(e) {
    e.preventDefault();
    panel.classList.toggle('open');
    btn.classList.toggle('open');
  });

  document.addEventListener('click', function(e) {
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.remove('open');
      btn.classList.remove('open');
    }
  });
})();
