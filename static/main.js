// ===== Client Logger ===== (see shell-bootstrap.js, loaded before this
// file — logger + top-level error handlers now live there)

// Shell composition root: this file owns the two lifecycle registries
// that unify initial-load and SPA-content-swap mounting (contentRegistry
// for the TOC, pageContentRegistry for per-page enhancements — viewport
// rendering, table sort/filter, syllabus DAG, comments, notebook cells,
// the quick-edit toggle's enabled state, and the homepage greeting
// cycle), plus a handful of small, self-contained content interactions
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

  // ===== Shell lifecycle registry =====
  // One "content" registry backs both the initial page load and every
  // subsequent SPA content swap for features whose mount logic is
  // identical in both cases (see shell-router.js, which reuses this
  // exact registry instance via the window._reinitToc bridge below).
  // Features register once; mountAll() always unmounts whatever is
  // currently active first, so remounting never accumulates duplicate
  // listeners/observers/timers.
  const contentRegistry = window.ShellLifecycle ? window.ShellLifecycle.createRegistry() : null;

  // A second registry for per-page content enhancements (viewport rendering,
  // table sort/filter, syllabus DAG, comments, the quick-edit toggle's
  // enabled state, and the homepage greeting cycle) — distinct from
  // `contentRegistry` above because these mount against the swapped
  // article/content root (`spaContent`) rather than the TOC sidebar root.
  // The exact same registry instance drives both the initial page load
  // (mounted once, deferred below, against `document`) and every SPA
  // content swap (mounted against `spaContent` from reinitializeContent),
  // so there is a single place where mount/unmount pairs are defined —
  // no more independently-written "ad hoc reinitialize" call sites.
  const pageContentRegistry = window.ShellLifecycle ? window.ShellLifecycle.createRegistry() : null;
  if (pageContentRegistry) {
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
      name: 'table-enhance',
      mount(root) {
        if (typeof window.initTableEnhance === 'function') return window.initTableEnhance(root);
        return undefined;
      },
    });
    pageContentRegistry.register({
      name: 'syllabus-enhance',
      mount(root) {
        if (typeof window.initSyllabusEnhance === 'function') return window.initSyllabusEnhance(root);
        return undefined;
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
    pageContentRegistry.register({
      name: 'greeting',
      // Owns the homepage typewriter greeting's recursive setTimeout
      // chain: mountAll() always unmounts the previous page's cycle
      // (stopping its timers) before mounting a new one, so navigating
      // away from — or repeatedly back to — a page with `.greeting-cycle`
      // never leaves an orphaned, still-ticking timer chain running.
      mount(root) {
        var el = (root || document).querySelector('.greeting-cycle');
        if (!el) return undefined;
        el.dataset.cycling = '1';
        return startGreetingCycle(el);
      },
    });
  }

  // Mounts every per-page content enhancement against `root`, used
  // identically for both the deferred initial-load mount (below) and
  // every SPA content swap (reinitializeContent). Prefers the shared
  // pageContentRegistry; falls back to the equivalent direct calls (same
  // behavior as before this registry existed) when shell-lifecycle.js
  // hasn't been loaded, so standalone pages/tests that only pull in a
  // subset of scripts keep working.
  function mountPageContentFeatures(root) {
    if (pageContentRegistry) {
      pageContentRegistry.mountAll(root);
      return;
    }
    if (window.RenderOnDemand && typeof window.RenderOnDemand.init === 'function') window.RenderOnDemand.init(root);
    if (typeof window.initTableEnhance === 'function') window.initTableEnhance(root);
    if (typeof window.initSyllabusEnhance === 'function') window.initSyllabusEnhance(root);
    if (typeof window.initComments === 'function') window.initComments(root);
    if (typeof window.initNotebookCells === 'function') window.initNotebookCells();
    var qeSwitch = document.getElementById('quick-edit-switch');
    if (qeSwitch) {
      var isMarkdown = document.body.dataset.pageType === 'markdown';
      qeSwitch.disabled = !isMarkdown;
      var qeSection = qeSwitch.closest('.settings-panel-section');
      if (qeSection) qeSection.classList.toggle('feature-disabled', !isMarkdown);
      if (!isMarkdown) qeSwitch.setAttribute('aria-checked', 'false');
    }
    var greeting = (root || document).querySelector('.greeting-cycle');
    if (greeting && !greeting.dataset.cycling) {
      greeting.dataset.cycling = '1';
      startGreetingCycle(greeting);
    }
  }
  // Exposed so shell-router.js (a separate top-level DOMContentLoaded
  // listener in its own file) can drive the exact same per-page content
  // lifecycle and TOC registry on every SPA content swap, without
  // duplicating either implementation.
  window._mountPageContentFeatures = mountPageContentFeatures;
  window._reinitToc = function (root) {
    if (contentRegistry && root) {
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
  // Falls back to a plain one-shot init when shell-lifecycle.js hasn't
  // been loaded (e.g. a standalone page that only pulls in main.js +
  // sidebar-panel.js). `rightSidebar` is re-queried locally (shared with
  // shell-layout.js by element id, not by closure, since layout runs as
  // its own top-level DOMContentLoaded listener in a separate file).
  var rightSidebar = document.getElementById('right-sidebar');
  if (contentRegistry) {
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
  }
  var spaToc = document.getElementById('spa-toc') || rightSidebar;
  if (contentRegistry && spaToc) {
    contentRegistry.mountAll(spaToc);
  } else if (spaToc && window.SidebarPanel) {
    window._spaTocTree = SidebarPanel.initTocTree(spaToc);
    window._spaTocScroll = SidebarPanel.initScrollTracking(spaToc);
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

  // ===== Dynamic greetings in content (typewriter style) =====
  // Canonical implementation shared by the 'greeting' pageContentRegistry
  // feature above (registered once) for both the initial page and every
  // SPA content swap — no separate copy is defined for SPA re-init.
  function startGreetingCycle(el) {
    var greetings = [
      '你好！',       // 中文 ~9.2亿
      '¡Hola!',     // 西班牙语 ~4.8亿
      'Hello!',     // 英语 ~3.8亿
      'नमस्ते!',      // 印地语 ~3.4亿
      'হ্যালো!',      // 孟加拉语 ~2.3亿
      'Olá!',       // 葡萄牙语 ~2.2亿
      'Привет!',    // 俄语 ~1.5亿
      'こんにちは',    // 日语 ~1.2亿
      'Xin chào!',  // 越南语 ~0.85亿
      'Merhaba!',   // 土耳其语 ~0.82亿
      'నమస్కారం!',   // 泰卢固语 ~0.83亿
      'नमस्कार!',     // 马拉地语 ~0.83亿
      '안녕하세요!',    // 韩语 ~0.82亿
      'Bonjour!',   // 法语 ~0.80亿
      'வணக்கம்!',    // 泰米尔语 ~0.78亿
      'ਸਤ ਸ੍ਰੀ ਅਕਾਲ!', // 旁遮普语 ~0.52亿 (西旁遮普)
      'Hallo!',     // 德语 ~0.73亿
      'سلام!',       // 波斯语 ~0.55亿
      'مرحبا!',      // 阿拉伯语 ~0.64亿 (埃及)
      'Halo!',      // 印尼/马来语 ~0.43亿
      'કેમ છો!',     // 古吉拉特语 ~0.57亿
      'Sannu!',     // 豪萨语 ~0.51亿
      'Cześć!',     // 波兰语 ~0.44亿
      'Ciao!',      // 意大利语 ~0.67亿
      'สวัสดี',       // 泰语
      'Habari!',    // 斯瓦希里语
      'Hej!',       // 瑞典语
      'Γεια σου!',  // 希腊语
      'Aloha!'      // 夏威夷语
    ];

    var idx = 0;
    var CHAR_MS = 80;
    var HOLD_MS = 2000;
    var DELETE_MS = 40;
    var timer = null;
    var stopped = false;

    // Cancels any pending step and prevents further ones from being
    // scheduled. Also self-invoked whenever `el` is no longer attached to
    // the document (e.g. the SPA swapped out this content), so a stale
    // reference to a removed element can never keep ticking forever.
    function stop() {
      stopped = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }

    function alive() {
      if (stopped) return false;
      if (!el.isConnected) { stop(); return false; }
      return true;
    }

    function typeText(text, cb) {
      var chars = Array.from(text);
      var i = 0;
      (function next() {
        if (!alive()) return;
        if (i <= chars.length) {
          el.textContent = chars.slice(0, i).join('');
          i++;
          timer = setTimeout(next, CHAR_MS);
        } else if (cb) cb();
      })();
    }

    function deleteText(cb) {
      var chars = Array.from(el.textContent);
      var i = chars.length;
      (function next() {
        if (!alive()) return;
        if (i >= 0) {
          var t = chars.slice(0, i).join('');
          el.textContent = t || '\u00A0';
          i--;
          timer = setTimeout(next, DELETE_MS);
        } else if (cb) cb();
      })();
    }

    function cycle() {
      if (!alive()) return;
      typeText(greetings[idx], function() {
        if (!alive()) return;
        timer = setTimeout(function() {
          if (!alive()) return;
          deleteText(function() {
            idx = (idx + 1) % greetings.length;
            if (!alive()) return;
            timer = setTimeout(cycle, 200);
          });
        }, HOLD_MS);
      });
    }

    cycle();
    return stop;
  }

  // Mount every per-page content enhancement once for the initial page
  // load — deferred via setTimeout(0) so it runs after every other
  // script's own DOMContentLoaded listener (table-enhance.js,
  // syllabus-enhance.js, comments.js, etc., all loaded ahead of this one
  // and registered before this handler in the same event dispatch), by
  // which point their `window.initXxx` globals exist. Each feature's
  // mount is idempotent against already-initialized elements (dataset
  // guards / self-clearing state), so this never duplicates the modules'
  // own initial self-init — it just gives the registry ownership of their
  // disposers for the *next* SPA navigation, exactly like the SPA path
  // below (reinitializeContent) uses the exact same mountPageContentFeatures().
  setTimeout(function() {
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

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text)
          .then(function() { return true; }, function() { return fallbackCopyText(text); });
      }
      return Promise.resolve(fallbackCopyText(text));
    }

    window.enhanceCodeBlocks = function(root) {
      var scope = root || document;
      var pres = scope.querySelectorAll('pre:not(.mermaid)');
      pres.forEach(function(pre) {
        if (pre.dataset.codeCopy === '1') return;
        var code = pre.querySelector(':scope > code');
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
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var lines = code.querySelectorAll('.code-line');
          var text = lines.length > 0
            ? Array.from(lines).map(function(l) { return l.textContent; }).join('\n')
            : code.textContent;
          var done = function(ok) {
            btn.classList.toggle('copied', !!ok);
            btn.classList.toggle('failed', !ok);
            btn.title = ok ? 'Copied!' : 'Copy failed';
            btn.setAttribute('aria-label', ok ? 'Code copied' : 'Copy failed');
            clearTimeout(btn._resetTimer);
            btn._resetTimer = setTimeout(function() {
              // If the mouse is no longer over the <pre>, snap straight to
              // the hidden state instead of letting the 150ms opacity
              // transition fade us through the "hovered" 0.85 opacity first.
              var preEl = pre;
              var stillHovered = !!(preEl && preEl.matches && preEl.matches(':hover'));
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
          copyText(text).then(done, function() { done(false); });
        });
      });
    };
  }
  window.enhanceCodeBlocks(document);
});
