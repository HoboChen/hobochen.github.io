// ===== Client Logger ===== (see shell-bootstrap.js, loaded before this
// file — logger + top-level error handlers now live there)

// Shell composition root: this file owns the two lifecycle registries
// that unify initial-load and SPA-content-swap mounting (contentRegistry
// for the TOC, pageContentRegistry for registered browser contributions,
// viewport rendering, comments, notebook cells, and the quick-edit
// toggle's enabled state), plus a handful of small content interactions
// (formula horizontal-scroll + right-click context menu and code-block
// copy-to-clipboard) that
// don't fit any of the split-out shell modules below and are small
// enough to leave here.
//
// The layout (sidebar/banner/nav), search + settings panel, and SPA
// router (+ resume/live-reload/PWA) responsibilities live in their own
// files — shell-layout.js, shell-search-settings.js, and
// shell-router.js respectively — each running as its own top-level
// DOMContentLoaded listener, bridged back to this file's registries via
// window._mountPageContentFeatures / window._reinitToc, and to each
// other via window._setSidebar / window._initSidebarFold / etc. This
// file, shell-bootstrap.js, shell-layout.js, shell-search-settings.js,
// and shell-router.js are always loaded together (see page.html) and
// together form the composed shell; window.* globals are the explicit,
// intentional public seams between them (and toward whiteboard/PDF/OCR
// and other feature-domain modules, which are out of scope here).

document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('link-preview-embed')) return;

  if (!window.ShellLifecycle || typeof window.ShellLifecycle.createRegistry !== 'function') {
    throw new Error('Shell app requires shell-lifecycle.js');
  }
  if (!window.RprintPageModules || typeof window.RprintPageModules.mountPage !== 'function') {
    throw new Error('Shell app requires module-browser.js');
  }

  // ===== Shell lifecycle registry =====
  // One "content" registry backs both the initial page load and every
  // subsequent SPA content swap for features whose mount logic is
  // identical in both cases (see shell-router.js, which reuses this
  // exact registry instance via the window._reinitToc bridge below).
  // Features register once; mountAll() always unmounts whatever is
  // currently active first, so remounting never accumulates duplicate
  // listeners/observers/timers.
  const contentRegistry = window.ShellLifecycle.createRegistry();

  // A second registry for per-page content enhancements — distinct from
  // `contentRegistry` above because these mount against the swapped
  // article/content root (`spaContent`) rather than the TOC sidebar root.
  // The exact same registry instance drives both the initial page load
  // (mounted once, deferred below, against `document`) and every SPA
  // content swap (mounted against `spaContent` from reinitializeContent),
  // so there is a single place where mount/unmount pairs are defined —
  // no more independently-written "ad hoc reinitialize" call sites.
  const pageContentRegistry = window.ShellLifecycle.createRegistry();
  pageContentRegistry.register({
    // Highlighting + the copy-to-clipboard button, unified through this
    // one registry entry (see window._hljsInit / window.enhanceCodeBlocks
    // below in this file, and the shared reading-domain owner at
    // src/features/reading/client/code-blocks.js) instead of
    // shell-router.js separately re-driving them on every SPA swap. Both
    // are idempotent against already-processed elements, so mounting here
    // for both the initial page and every SPA content swap never
    // re-highlights or re-adds a duplicate copy button. Both also return
    // a disposer: `_hljsInit`'s retires a still-pending on-demand
    // language-module wait against this exact root immediately on
    // unmount (instead of only once its shared fetch eventually settles),
    // and `enhanceCodeBlocks`'s clears any outstanding copy-button
    // "reset to idle" timers this root's buttons started, so neither
    // leaves a stale callback pointed at content this feature was asked
    // to tear down.
    name: 'code-blocks',
    mount(root) {
      var disposeHljs = typeof window._hljsInit === 'function' ? window._hljsInit(root) : null;
      var disposeCopyButtons = typeof window.enhanceCodeBlocks === 'function' ? window.enhanceCodeBlocks(root) : null;
      return function unmount() {
        if (typeof disposeHljs === 'function') disposeHljs();
        if (typeof disposeCopyButtons === 'function') disposeCopyButtons();
      };
    },
  });
  pageContentRegistry.register({
    name: 'render-on-demand',
    mount(root) {
      if (window.RenderOnDemand && typeof window.RenderOnDemand.init === 'function') {
        return window.RenderOnDemand.init(root);
      }
      return undefined;
    },
  });
  pageContentRegistry.register({
    name: 'modules',
    mount(root, context) {
      window.RprintPageModules.mountPage(root, context);
      return window.RprintPageModules.disposePage;
    },
  });
  pageContentRegistry.register({
    name: 'comments',
    mount(root) {
      if (typeof window.initComments === 'function') return window.initComments(root);
      return undefined;
    },
  });
  pageContentRegistry.register({
    name: 'notebook',
    // notebook.js scans the whole document itself (containers can live
    // outside `root`), so `root` is intentionally ignored here.
    mount() {
      if (typeof window.initNotebookCells === 'function') return window.initNotebookCells();
      return undefined;
    },
  });
  pageContentRegistry.register({
    name: 'jupyter-embed',
    // notebook-spa-jupyter-embed.js scans the whole document itself, so
    // `root` is intentionally ignored here too. Always returns
    // a stable wrapper (not conditioned on whether the embed script has
    // loaded yet) so mountAll()'s automatic unmountAll() at
    // the start of the *next* navigation reliably tears down whatever
    // instance is current at that time — including one started
    // asynchronously by shell-router.js's handleExtraScripts() after
    // the embed script finished loading mid-navigation. init() itself
    // is single-flight/idempotent, so calling it here alongside that
    // router-driven load path never double-initializes.
    mount() {
      if (typeof window.initJupyterEmbed === 'function'
          && document.body.getAttribute('data-native-jupyter') === 'on'
          && document.querySelector('.jupyter-frame')) {
        window.initJupyterEmbed();
      }
      return function unmountJupyterEmbedFeature() {
        if (typeof window.unmountJupyterEmbed === 'function') {
          window.unmountJupyterEmbed();
        }
      };
    },
  });
  pageContentRegistry.register({
    name: 'quick-edit-toggle-state',
    mount() {
      var qeSwitch = document.getElementById('quick-edit-switch');
      if (!qeSwitch) return undefined;
      var isMarkdown = document.body.dataset.pageType === 'markdown';
      qeSwitch.disabled = !isMarkdown;
      var qeSection = qeSwitch.closest('.settings-panel-section');
      if (qeSection) qeSection.classList.toggle('feature-disabled', !isMarkdown);
      if (!isMarkdown) qeSwitch.setAttribute('aria-checked', 'false');
      return undefined;
    },
  });

  // Mounts every per-page content enhancement against `root`, used
  // identically for both the deferred initial-load mount (below) and
  // every SPA content swap (reinitializeContent). Document hosts without
  // this shell use RprintPageModules.mountPage/disposePage directly.
  var pageRoot = document;
  var pageContext;
  var pageHidden = false;
  var initialPageMount;
  function mountPageContentFeatures(root, context) {
    clearTimeout(initialPageMount);
    pageRoot = root || document;
    pageContext = context;
    if (pageHidden) return [];
    return pageContentRegistry.mountAll(pageRoot, pageContext);
  }
  // Static/offline links leave the whole document. Retire the same scope as
  // SPA replacement, then mount a fresh one if the browser restores its cache.
  window.addEventListener('pagehide', function () {
    pageHidden = true;
    clearTimeout(initialPageMount);
    pageContentRegistry.unmountAll();
  });
  window.addEventListener('pageshow', function () {
    if (!pageHidden) return;
    pageHidden = false;
    mountPageContentFeatures(pageRoot, pageContext);
  });
  // Exposed so shell-router.js (a separate top-level DOMContentLoaded
  // listener in its own file) can drive the exact same per-page content
  // lifecycle and TOC registry on every SPA content swap, without
  // duplicating either implementation.
  window._mountPageContentFeatures = mountPageContentFeatures;
  window._unmountPageContentFeatures = function () {
    pageContentRegistry.unmountAll();
  };
  window._reinitToc = function (root) {
    if (root) {
      contentRegistry.mountAll(root);
      return true;
    }
    return false;
  };

  // ===== TOC foldable + active tracking =====
  // Registered as a content-registry feature so this initial mount and
  // every SPA content swap's reinitToc() (see shell-router.js, which
  // calls window._reinitToc) invoke the exact same mount/unmount pair —
  // never two independently written copies of the same init logic.
  // `rightSidebar` is re-queried locally (shared with
  // shell-layout.js by element id, not by closure, since layout runs as
  // its own top-level DOMContentLoaded listener in a separate file).
  var rightSidebar = document.getElementById('right-sidebar');
  contentRegistry.register({
    name: 'toc',
    mount(root) {
      if (!root || !window.SidebarPanel) return undefined;
      window._spaTocTree = SidebarPanel.initTocTree(root);
      window._spaTocScroll = SidebarPanel.initScrollTracking(root);
      return function unmount() {
        if (window._spaTocTree) { window._spaTocTree.destroy(); window._spaTocTree = null; }
        if (window._spaTocScroll) { window._spaTocScroll.destroy(); window._spaTocScroll = null; }
      };
    },
  });
  var spaToc = document.getElementById('spa-toc') || rightSidebar;
  if (spaToc) {
    contentRegistry.mountAll(spaToc);
  }

  // ===== Prioritize horizontal scroll on overflowing formulas =====
  document.querySelectorAll('.math.display, .katex-display').forEach(el => {
    el.addEventListener('wheel', function(e) {
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY || e.deltaX;
    }, { passive: false });
  });

  // ===== KaTeX formula right-click context menu =====
  (function() {
    var menu = document.createElement('div');
    menu.className = 'katex-context-menu';
    menu.innerHTML =
      '<button data-action="copy-latex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy LaTeX</button>' +
      '<button data-action="copy-text"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h12"/></svg>Copy as Text</button>';
    document.body.appendChild(menu);
    var activeMath = null;

    function hideMenu() {
      menu.classList.remove('visible');
      activeMath = null;
    }

    function showToast(msg) {
      var t = document.createElement('div');
      t.className = 'katex-toast';
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(function() { t.classList.add('visible'); });
      setTimeout(function() {
        t.classList.remove('visible');
        setTimeout(function() { t.remove(); }, 200);
      }, 1500);
    }

    document.querySelectorAll('.math').forEach(function(el) {
      el.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        activeMath = el;
        var x = e.clientX, y = e.clientY;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.add('visible');
        // Reposition if overflowing viewport
        requestAnimationFrame(function() {
          var rect = menu.getBoundingClientRect();
          if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
          if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
        });
      });
    });

    menu.addEventListener('click', function(e) {
      var btn = e.target.closest('button');
      var math = activeMath || menu._activeMath;
      if (!btn || !math) return;
      var action = btn.getAttribute('data-action');
      if (action === 'copy-latex') {
        var latex = math.getAttribute('data-latex') || '';
        navigator.clipboard.writeText(latex).then(function() { showToast('LaTeX copied'); }, function() { showToast('Copy failed'); });
      } else if (action === 'copy-text') {
        var text = math.innerText || math.textContent || '';
        navigator.clipboard.writeText(text).then(function() { showToast('Text copied'); }, function() { showToast('Copy failed'); });
      }
      hideMenu();
    });

    document.addEventListener('click', function(e) {
      if (!menu.contains(e.target)) hideMenu();
    });
    document.addEventListener('scroll', hideMenu, true);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') hideMenu();
    });
  })();

  // Mount every per-page content enhancement once for the initial page
  // load after the remaining DOMContentLoaded handlers. Registered modules
  // do not self-initialize; this is their only initial mount.
  initialPageMount = setTimeout(function() {
    mountPageContentFeatures(document);
  }, 0);

  // ===== Copy-to-clipboard button on code blocks =====
  if (typeof window.enhanceCodeBlocks !== 'function') {
    function fallbackCopyText(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); }
      catch (err) { ok = false; }
      ta.remove();
      return !!ok;
    }

    // Resets a copy button to its idle, never-clicked visual state — used
    // both to arm a brand-new button and to restore a torn-down one so a
    // later re-mount of the same (reused) root never finds it stuck mid
    // "Copied!"/"Copy failed" from a click that happened just before
    // teardown.
    function resetButtonState(btn) {
      btn.classList.remove('copied', 'failed');
      btn.title = 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.style.transition = '';
    }

    // Wires (or re-wires) a copy button's click handler. Idempotent against
    // a button that already has a live handler from a previous, still-active
    // mount — removes it first so re-arming a previously-disposed button
    // (dataset.codeCopy already '1' from an earlier mount of a reused root)
    // never ends up with two handlers writing to the clipboard per click.
    // Capture a generation as well as disposal: re-arming the same button
    // must not revive an earlier mount's pending clipboard continuation.
    function armCopyButton(btn, pre, code) {
      if (btn._codeCopyClickHandler) {
        btn.removeEventListener('click', btn._codeCopyClickHandler);
      }
      btn._codeCopyDisposed = false;
      var generation = (btn._codeCopyGeneration || 0) + 1;
      btn._codeCopyGeneration = generation;
      function isCurrent() {
        return !btn._codeCopyDisposed && btn._codeCopyGeneration === generation;
      }
      function handleClick(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!isCurrent()) return;
        var text = window.CodeBlocks ? window.CodeBlocks.readSource(code) : code.textContent;
        var done = function(ok) {
          if (!isCurrent()) return;
          btn.classList.toggle('copied', !!ok);
          btn.classList.toggle('failed', !ok);
          btn.title = ok ? 'Copied!' : 'Copy failed';
          btn.setAttribute('aria-label', ok ? 'Code copied' : 'Copy failed');
          clearTimeout(btn._resetTimer);
          btn._resetTimer = setTimeout(function() {
            if (!isCurrent()) return;
            // If the mouse is no longer over the <pre>, snap straight to
            // the hidden state instead of letting the 150ms opacity
            // transition fade us through the "hovered" 0.85 opacity first.
            var stillHovered = !!(pre && pre.matches && pre.matches(':hover'));
            if (!stillHovered) {
              btn.style.transition = 'none';
            }
            btn.classList.remove('copied');
            btn.classList.remove('failed');
            btn.title = 'Copy';
            btn.setAttribute('aria-label', 'Copy code');
            if (!stillHovered) {
              // Force a reflow so the transition: none takes effect for
              // this style mutation, then restore transitions next frame.
              void btn.offsetWidth;
              btn.style.transition = '';
            }
          }, ok ? 500 : 1500);
        };
        var copyPromise = (navigator.clipboard && navigator.clipboard.writeText)
          ? navigator.clipboard.writeText(text).then(function() { return true; }, function() {
            // A rejected clipboard write falls back to the hidden-textarea
            // execCommand path — real DOM work against `document.body`
            // that must not run once this button's root has been disposed.
            if (!isCurrent()) return false;
            return fallbackCopyText(text);
          })
          : Promise.resolve(fallbackCopyText(text));
        copyPromise.then(done, function() { done(false); });
      }
      btn.addEventListener('click', handleClick);
      btn._codeCopyClickHandler = handleClick;
    }

    /**
     * Mounts a copy-to-clipboard button on every not-yet-enhanced code
     * block under `root`, idempotent against blocks a previous call already
     * touched (`pre.dataset.codeCopy`) — re-arming (rather than
     * duplicating) a button left behind by a prior mount of the same
     * (reused) root, including one a previous unmount() had disposed.
     * Returns a disposer that, for every button under `root` — new or
     * already-enhanced — removes its click handler, cancels its pending
     * "reset to idle" timer, resets it to its idle visual state, and marks
     * it disposed so any clipboard-write promise or fallback-copy work
     * already in flight for it becomes a no-op once it settles, instead of
     * mutating a button (and scheduling a fresh timer for it) this feature
     * was asked to tear down.
     */
    window.enhanceCodeBlocks = function(root) {
      var scope = root || document;
      var bindings = [];
      var pres = scope.querySelectorAll('pre:not(.mermaid)');
      pres.forEach(function(pre) {
        var code = pre.querySelector(':scope > code');
        if (pre.dataset.codeCopy === '1') {
          var existingBtn = pre.querySelector(':scope > .code-copy-btn');
          if (existingBtn) {
            if (existingBtn._codeCopyDisposed) armCopyButton(existingBtn, pre, code);
            bindings.push({ button: existingBtn, generation: existingBtn._codeCopyGeneration });
          }
          return;
        }
        if (!code) return;
        pre.dataset.codeCopy = '1';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy-btn';
        btn.setAttribute('aria-label', 'Copy code');
        btn.title = 'Copy';
        btn.innerHTML =
          '<svg class="code-copy-icon-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<svg class="code-copy-icon-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
        pre.appendChild(btn);
        armCopyButton(btn, pre, code);
        bindings.push({ button: btn, generation: btn._codeCopyGeneration });
      });
      return function unmount() {
        bindings.forEach(function(binding) {
          var btn = binding.button;
          if (btn._codeCopyDisposed || btn._codeCopyGeneration !== binding.generation) return;
          clearTimeout(btn._resetTimer);
          btn._codeCopyDisposed = true;
          if (btn._codeCopyClickHandler) {
            btn.removeEventListener('click', btn._codeCopyClickHandler);
            btn._codeCopyClickHandler = null;
          }
          resetButtonState(btn);
        });
      };
    };
  }
});
