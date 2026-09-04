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
  if (saved.columns) applyColumns(saved.columns);
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
  applyFontZh(saved.fontZh || 'kaiti');
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
    document.querySelectorAll('.terminal-panel-frame, .terminal-frame').forEach(f => {
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
    document.querySelectorAll('.terminal-panel-frame, .terminal-frame').forEach(f => {
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
    if (widthValue) widthValue.textContent = val + '%';
    if (widthRange) {
      const idx = widthStops.indexOf(val);
      if (idx >= 0) widthRange.value = idx;
    }
    document.querySelectorAll('.width-tick').forEach(tick => {
      tick.classList.toggle('active', widthStops[parseInt(tick.dataset.i)] === val);
    });
    // Edge to Edge only available at 100%
    if (ignoreCornersSwitch) {
      if (val === 100) {
        ignoreCornersSwitch.disabled = false;
      } else {
        ignoreCornersSwitch.disabled = true;
        applyIgnoreCorners(false);
      }
    }
    // Width changes resize the spread cap; re-chunk if 2-col is on.
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
  window._saveDisplayPrefs = function() { savePrefs(); };

  // Two columns switch
  if (twoColumnsSwitch) {
    twoColumnsSwitch.addEventListener('click', () => {
      const on = twoColumnsSwitch.getAttribute('aria-checked') !== 'true';
      applyColumns(on ? '2' : '1');
      savePrefs();
    });
  }

  // ---------------------------------------------------------------------------
  // Two-column mode (stacked viewport-tall spreads)
  //
  // Reading flow: top-to-bottom in the left column of a spread, then
  // top-to-bottom in the right column, then scroll vertically to the next
  // spread. The chunker greedily groups direct children of `.article` into
  // `<div class="spread">` wrappers up to ~2 × (viewportHeight − banner),
  // preferring h1/h2/h3 boundaries as break points so a section title is not
  // separated from its first paragraph. Single oversized blocks get the
  // `.spread-overflow` escape hatch (allowed to break across columns and
  // scroll horizontally inside their column).
  //
  // Scoped to article (markdown) pages only; toggle is a no-op on notebook,
  // pdf, whiteboard, library, terminal, and index pages. The saved preference
  // is preserved across page types so it auto-applies again when the user
  // returns to a markdown page (see SPA route handler in main.js).
  // ---------------------------------------------------------------------------

  function isArticlePage() {
    // Absent data-page-type (static-built pages) is treated as markdown.
    var pt = document.body.dataset.pageType;
    return !document.documentElement.classList.contains('link-preview-embed') && (!pt || pt === 'markdown');
  }

  function unwrapSpreads(art) {
    if (!art) return;
    var spreads = Array.from(art.children).filter(function (c) {
      return c.classList && c.classList.contains('spread');
    });
    for (var i = 0; i < spreads.length; i++) {
      var sp = spreads[i];
      while (sp.firstChild) art.insertBefore(sp.firstChild, sp);
      sp.remove();
    }
  }

  function chunkArticleIntoSpreads(art) {
    // Always start from a clean slate so re-chunks (resize / pref change /
    // SPA route swap) are idempotent.
    unwrapSpreads(art);

    var children = Array.from(art.children);
    if (children.length === 0) return;

    var bannerEl = document.querySelector('.top-banner');
    var mainLayoutEl = document.querySelector('.main-layout');
    // main-layout's margin-top is the resolved top offset in every state:
    // normal → banner height (incl. safe-area on PWA), folded → 0 or safe-area.
    var bannerH = mainLayoutEl
                ? (parseFloat(getComputedStyle(mainLayoutEl).marginTop) || 0)
                : bannerEl ? bannerEl.offsetHeight : 56;
    // Leave a small bottom inset (32px) so the next spread peeks into view
    // and the snap-stop feels natural.
    var spreadMax = Math.max(300, (window.innerHeight || 800) - bannerH - 32);
    document.documentElement.style.setProperty('--spread-max-height', spreadMax + 'px');
    // Each spread holds two columns; the visible spread frame eats ~34px
    // (16+16 padding + 1+1 border) so the actual content area per column is
    // smaller than the outer cap. Target ~2× that content area.
    var spreadFrameInset = 34;
    var usable = Math.max(200, spreadMax - spreadFrameInset);
    var targetContent = 2 * usable;

    // Measure each child's natural single-column height. offsetHeight is 0
    // in jsdom (no layout); chunker still produces a valid wrapper structure
    // even when measurements are unavailable.
    var heights = children.map(function (ch) { return ch.offsetHeight || 0; });

    var groups = [];
    var current = [];
    var currentSum = 0;

    function flush(group, overflow) {
      if (group.length) groups.push({ children: group, overflow: !!overflow });
    }

    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var h = heights[i];

      // Single oversize block: flush whatever's pending, then put it alone
      // in an overflow spread.
      if (h > usable) {
        flush(current, false);
        current = [];
        currentSum = 0;
        flush([child], true);
        continue;
      }

      // Would adding this child overflow the target? Try to break here, but
      // prefer to break before a recent heading so we don't separate a
      // section title from its first paragraph.
      if (currentSum + h > targetContent && current.length > 0) {
        var breakAt = current.length;
        var lookback = Math.max(0, current.length - 3);
        for (var j = current.length - 1; j >= lookback; j--) {
          var tag = current[j].tagName;
          if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
            breakAt = j;
            break;
          }
        }
        if (breakAt > 0 && breakAt < current.length) {
          // Carry the heading-and-after into the next group.
          var carry = current.slice(breakAt);
          flush(current.slice(0, breakAt), false);
          current = carry;
          currentSum = 0;
          for (var k = 0; k < carry.length; k++) {
            currentSum += carry[k].offsetHeight || 0;
          }
        } else {
          flush(current, false);
          current = [];
          currentSum = 0;
        }
      }

      current.push(child);
      currentSum += h;
    }
    flush(current, false);

    // Replace article children with spread wrappers, preserving order.
    while (art.firstChild) art.removeChild(art.firstChild);
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var spread = document.createElement('div');
      spread.className = 'spread' + (group.overflow ? ' spread-overflow' : '');
      for (var c = 0; c < group.children.length; c++) {
        spread.appendChild(group.children[c]);
      }
      art.appendChild(spread);
    }
  }

  // Debounced resize / re-layout handlers, registered only while 2-col is on.
  var refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      if (article && article.classList.contains('two-columns')) {
        chunkArticleIntoSpreads(article);
      }
    }, 150);
  }

  var resizeBound = false;
  function bindResize() {
    if (resizeBound) return;
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    // Re-chunk once when fonts finish loading (KaTeX custom fonts load
    // after the initial chunk, changing formula heights).  Use a one-shot
    // listener so repeated loadingdone events cannot cascade into a
    // layout-thrashing loop on mobile.
    if (document.fonts && document.fonts.status === 'loading') {
      document.fonts.ready.then(function () {
        scheduleRefresh();
      });
    }
    resizeBound = true;
  }
  function unbindResize() {
    if (!resizeBound) return;
    window.removeEventListener('resize', scheduleRefresh);
    resizeBound = false;
  }

  function applyColumns(cols) {
    var wantOn = cols === '2' && isArticlePage();

    if (article) {
      // Always unwrap before deciding so re-applying on a non-article page
      // (e.g. SPA route from markdown → notebook with 2-col still saved)
      // cleanly tears down any prior chunking.
      unwrapSpreads(article);
      article.classList.remove('two-columns');
      document.body.classList.remove('has-two-columns');

      if (wantOn) {
        chunkArticleIntoSpreads(article);
        article.classList.add('two-columns');
        document.body.classList.add('has-two-columns');
        bindResize();
      } else {
        unbindResize();
      }
    }

    if (twoColumnsSwitch) {
      twoColumnsSwitch.setAttribute('aria-checked', wantOn ? 'true' : 'false');
    }
  }

  // Re-evaluate based on the saved pref + current page type. Called by main.js
  // after an SPA route swap (so 2-col is re-applied or torn down to match the
  // new page) and exposed for any other code that mutates `.article` content.
  function refreshTwoColumns() {
    var savedCols = '1';
    try {
      var prev = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
      savedCols = prev.columns || '1';
    } catch (e) { /* ignore */ }
    applyColumns(savedCols);
  }
  window._refreshTwoColumns = refreshTwoColumns;

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
    if (debugModeSwitch) debugModeSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
    if (debugChildren) debugChildren.classList.toggle('open', on);
    if (window._log && window._log._setDebugMode) window._log._setDebugMode(on);
  }

  // Client log level toggle (inside debug children)
  document.querySelectorAll('.debug-level-btn[data-level]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyClientLogLevel(btn.dataset.level);
      savePrefs();
    });
  });

  function applyClientLogLevel(level) {
    document.querySelectorAll('.debug-level-btn[data-level]').forEach(b => {
      b.classList.toggle('active', b.dataset.level === level);
    });
    if (window._log && window._log._setLevel) window._log._setLevel(level);
  }

  // Font family
  document.querySelectorAll('.font-btn[data-font]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyFont(btn.dataset.font);
      savePrefs();
    });
  });

  function applyFont(f) {
    document.documentElement.style.setProperty('--font-latin', fontLatinMap[f] || 'var(--font-sans)');
    document.querySelectorAll('.font-btn[data-font]').forEach(b => {
      b.classList.toggle('active', b.dataset.font === f);
    });
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  // Font size (snap slider)
  if (fontSizeRange) {
    fontSizeRange.addEventListener('input', () => {
      applyFontSize(fontSizeStops[fontSizeRange.value]);
      if (window.KbPreferences) window.KbPreferences.set({ fontSizeSource: 'panel' });
      else {
        const prefs = JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
        prefs.fontSizeSource = 'panel';
        localStorage.setItem('kb-display-prefs', JSON.stringify(prefs));
      }
      savePrefs();
    });
    document.querySelectorAll('.font-size-tick').forEach(tick => {
      tick.addEventListener('click', () => {
        const index = parseInt(tick.dataset.i);
        fontSizeRange.value = index;
        applyFontSize(fontSizeStops[index]);
        if (window.KbPreferences) window.KbPreferences.set({ fontSizeSource: 'panel' });
        else {
          const prefs = JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
          prefs.fontSizeSource = 'panel';
          localStorage.setItem('kb-display-prefs', JSON.stringify(prefs));
        }
        savePrefs();
      });
    });
  }

  function applyFontSize(value, source) {
    const size = normalizeFontSize(value, source);
    document.documentElement.setAttribute('data-font-size', String(size));
    document.documentElement.style.setProperty('--page-font-size', size + 'px');
    if (fontSizeValue) fontSizeValue.textContent = size + 'px';
    if (fontSizeRange) fontSizeRange.value = fontSizeStops.indexOf(size);
    document.querySelectorAll('.font-size-tick').forEach(tick => {
      tick.classList.toggle('active', fontSizeStops[parseInt(tick.dataset.i)] === size);
    });
    // Notify terminal iframe(s) of font size change
    document.querySelectorAll('.terminal-panel-frame, .terminal-frame').forEach(f => {
      if (f.contentWindow) {
        f.contentWindow.postMessage({ type: 'font-size-change', fontSize: size }, window.location.origin);
      }
    });
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  // Chinese font family
  document.querySelectorAll('.fontzh-btn[data-fontzh]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyFontZh(btn.dataset.fontzh);
      savePrefs();
    });
  });

  function applyFontZh(f) {
    document.documentElement.style.setProperty('--font-zh', fontZhMap[f] || fontZhMap['default']);
    document.querySelectorAll('.fontzh-btn[data-fontzh]').forEach(b => {
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
    document.querySelectorAll('.line-height-tick').forEach(tick => {
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
    document.querySelectorAll('.line-height-tick').forEach(tick => {
      tick.classList.toggle('active', lineHeightStops[parseInt(tick.dataset.i)] === height);
    });
    if (typeof scheduleRefresh === 'function') scheduleRefresh();
  }

  function savePrefs() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const contentWidth = widthStops[widthRange ? widthRange.value : 2] || 90;
    // Preserve the saved 'columns' pref when on a non-article page (where the
    // toggle is hidden and the class is intentionally not on .article); only
    // overwrite when the toggle is actually meaningful for this page.
    const prev = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
    const isArticle = !document.documentElement.classList.contains('link-preview-embed') &&
      (!document.body.dataset.pageType || document.body.dataset.pageType === 'markdown');
    const columns = isArticle
      ? (article && article.classList.contains('two-columns') ? '2' : '1')
      : (prev.columns || '1');
    const ignoreCorners = document.documentElement.hasAttribute('data-ignore-corners') ? 'on' : 'off';
    const bgColor = document.documentElement.getAttribute('data-bg') || 'default';
    const fontFamily = document.querySelectorAll('.font-btn.active')[0]?.dataset.font || 'system';
    const fontSize = document.documentElement.getAttribute('data-font-size') || '20';
    const fontZh = document.querySelectorAll('.fontzh-btn.active')[0]?.dataset.fontzh || 'default';
    const lineHeight = document.documentElement.getAttribute('data-line-height') || '1.8';
    const nativeJupyter = nativeJupyterSwitch && nativeJupyterSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
    const contentSearch = contentSearchSwitch && contentSearchSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
    const quickEdit = quickEditSwitch && quickEditSwitch.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
    const fontSizeSource = prev.fontSizeSource || 'panel';
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
    const clientLogLevel = document.querySelectorAll('.debug-level-btn.active')[0]?.dataset.level || 'debug';
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
