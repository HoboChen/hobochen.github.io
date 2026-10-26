// SPA router: same-origin link interception, fetch + content swap,
// history/popstate, scroll/resume-surface persistence, SSE live
// reload, native-Jupyter-mode dynamic asset loading, the SPA health
// indicator, and PWA service-worker registration + resume handling.
// Runs as its own top-level DOMContentLoaded listener. Every SPA
// content swap re-mounts per-page content features and the TOC
// through the exact same registries shell/app.js builds at initial
// load, via the window._mountPageContentFeatures / window._reinitToc
// bridges (see shell/app.js) — the initial load and every SPA
// navigation always go through one shared lifecycle registry.
document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('link-preview-embed')) return;

  // ===== SPA Router (only active when data-spa="true" on body) =====
  (function() {
    if (!document.body.dataset.spa) return;

    // Shared with shell-layout.js by element id (not by closure) since
    // this router runs as its own top-level DOMContentLoaded listener in
    // a separate file; setSidebar()/initSidebarFold() are still invoked
    // through the window._setSidebar / window._initSidebarFold bridge so
    // there is exactly one implementation of each.
    var leftSidebar = document.getElementById('left-sidebar');
    var rightSidebar = document.getElementById('right-sidebar');
    var leftToggle = document.getElementById('left-toggle');
    var rightToggle = document.getElementById('right-toggle');
    var sidebarPrefs = JSON.parse(localStorage.getItem('kb-sidebar-prefs') || '{}');
    var navigationGeneration = 0;
    var navigationSaveGeneration = 0;
    var routerDocument = document;
    var assetOrigin = location.origin;
    var renderedPageLocation = location.pathname + location.search;

    function hashTarget(hash) {
      var id = hash.replace(/^#/, '');
      try { id = decodeURIComponent(id); } catch (_) { /* literal percent signs are valid IDs */ }
      return document.getElementById(id);
    }

    // Native Jupyter mode preference
    function isNativeJupyterEnabled() {
      var prefs = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
      return prefs.nativeJupyter === 'on';
    }

    function versionedStaticAsset(name) {
      var meta = document.querySelector('meta[name="build-commit"]');
      var version = meta && meta.getAttribute('content');
      return '/static/' + name + (version ? '?v=' + encodeURIComponent(version) : '');
    }

    // Load jupyter embed script (returns promise)
    var jupyterEmbedLoadPromise = null;
    function ensureJupyterEmbedLoaded() {
      if (window.initJupyterEmbed) return Promise.resolve();
      if (jupyterEmbedLoadPromise) return jupyterEmbedLoadPromise;

      var src = versionedStaticAsset('notebook-spa-jupyter-embed.js');
      var loading = loadPageAsset({ type: 'script', src: src }).then(function () {
        if (window.document !== routerDocument) return;
        if (typeof window.initJupyterEmbed !== 'function') {
          throw new Error('Jupyter embed script loaded without its public API');
        }
      });
      jupyterEmbedLoadPromise = loading;
      loading.catch(function() {
        if (jupyterEmbedLoadPromise === loading) jupyterEmbedLoadPromise = null;
        pageAssetLoads.delete(assetKey('script', src));
        routerDocument.querySelectorAll('script[src]').forEach(function (script) {
          if (assetKey('script', script.src) === assetKey('script', src)) script.remove();
        });
      });
      return loading;
    }

    var _lastJupyterMode = null;
    var jupyterEmbedRetryNeeded = false;
    document.addEventListener('rprint:jupyter-embed-retry-needed', function() {
      jupyterEmbedRetryNeeded = true;
    });

    function startJupyterEmbed() {
      var generation = navigationGeneration;
      var frame = document.querySelector('.jupyter-frame');
      return ensureJupyterEmbedLoaded()
        .then(function() {
          if (window.document !== routerDocument || generation !== navigationGeneration || !frame || !frame.isConnected
            || document.body.getAttribute('data-native-jupyter') !== 'on') return;
          jupyterEmbedRetryNeeded = false;
          _log.info('spa', 'initJupyterEmbed exists: ' + !!window.initJupyterEmbed);
          window.initJupyterEmbed();
        })
        .catch(function(err) {
          if (window.document !== routerDocument || generation !== navigationGeneration) return;
          jupyterEmbedRetryNeeded = true;
          _log.error('spa', err && err.message ? err.message : String(err));
        });
    }

    function applyNativeJupyterMode(enabled) {
      if (enabled === _lastJupyterMode && !(enabled && jupyterEmbedRetryNeeded)) return;
      _lastJupyterMode = enabled;
      if (!enabled) jupyterEmbedRetryNeeded = false;
      _log.debug('spa', 'applyNativeJupyterMode: ' + enabled);
      document.body.setAttribute('data-native-jupyter', enabled ? 'on' : 'off');

      // Check if current page has notebook containers
      var jupyterContainer = document.querySelector('.notebook-jupyter-container');
      var pyodideContainer = document.querySelector('.notebook-pyodide-container');
      var hasNotebook = jupyterContainer || pyodideContainer;
      _log.debug('spa', 'hasNotebook: ' + hasNotebook + ' jupyter: ' + !!jupyterContainer + ' pyodide: ' + !!pyodideContainer);

      if (!hasNotebook) return;

      if (enabled) {
        // Switch to native Jupyter - load script and init
        _log.info('spa', 'Loading jupyter embed...');
        startJupyterEmbed();
      } else {
        // Switch to Pyodide mode - load script and init
        var generation = navigationGeneration;
        ensureNotebookJsLoaded().then(function() {
          if (window.document !== routerDocument || generation !== navigationGeneration
            || document.body.getAttribute('data-native-jupyter') !== 'off') return;
          if (window.initNotebookCells) window.initNotebookCells();
        }).catch(function (error) {
          if (window.document === routerDocument && generation === navigationGeneration) _log.error('notebook', error.message);
        });
      }
    }

    var pageAssetLoads = new Map();

    function assetKey(type, src, moduleScript) {
      var url = new URL(src, routerDocument.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Unsupported page asset URL: ' + src);
      }
      // Build fingerprints do not hot-replace executable modules within an
      // already-open application. Other URL parameters remain significant.
      if (url.origin === assetOrigin && url.pathname.indexOf('/static/') === 0) {
        url.searchParams.delete('v');
      }
      return type + (type === 'script' ? (moduleScript ? ':module' : ':classic') : '') + ':' + url.href;
    }

    document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach(function (element) {
      var type = element.tagName === 'SCRIPT' ? 'script' : 'style';
      pageAssetLoads.set(assetKey(type, element.src || element.href, element.type === 'module'), Promise.resolve());
    });

    function pageAssetEntries(data) {
      if (data.assetEntries !== undefined) {
        if (!Array.isArray(data.assetEntries)) throw new Error('Page assetEntries must be an array');
        return data.assetEntries;
      }
      // Legacy fragments contain markup, not a second feature catalogue.
      // Inline scripts were never executed by this compatibility path.
      var template = document.createElement('template');
      template.innerHTML = data.extraScripts || '';
      return Array.from(template.content.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
        .filter(function (element) {
          return element.tagName !== 'SCRIPT' || !element.type
            || /^(module|text\/javascript|application\/javascript)$/i.test(element.type);
        })
        .map(function (element) {
          return {
            type: element.tagName === 'SCRIPT' ? 'script' : 'style',
            src: element.getAttribute('src') || element.getAttribute('href'),
            module: element.type === 'module',
            legacyUntyped: element.tagName === 'SCRIPT' && !element.hasAttribute('type'),
            integrity: element.integrity,
            crossOrigin: element.crossOrigin,
            nonce: element.nonce,
          };
        });
    }

    function loadPageAsset(entry) {
      if (!entry || typeof entry.src !== 'string' || !entry.src) {
        throw new Error('Page asset needs a src URL');
      }
      if (entry.type === 'resource') return Promise.resolve();
      if (entry.type !== 'script' && entry.type !== 'style') {
        throw new Error('Unsupported page asset type: ' + entry.type);
      }
      if (entry.module !== undefined && typeof entry.module !== 'boolean') {
        throw new Error('Page asset module flag must be boolean: ' + entry.src);
      }
      var key = assetKey(entry.type, entry.src, entry.module === true);
      if (pageAssetLoads.has(key)) return pageAssetLoads.get(key);
      if (entry.legacyUntyped && entry.type === 'script') {
        var moduleKey = assetKey('script', entry.src, true);
        if (pageAssetLoads.has(moduleKey)) return pageAssetLoads.get(moduleKey);
      }
      var element = document.createElement(entry.type === 'script' ? 'script' : 'link');
      if (entry.type === 'script') {
        element.src = entry.src;
        element.async = false;
        if (entry.module) element.type = 'module';
      } else {
        element.rel = 'stylesheet';
        element.href = entry.src;
      }
      if (entry.integrity) element.integrity = entry.integrity;
      if (entry.crossOrigin) element.crossOrigin = entry.crossOrigin;
      if (entry.nonce) element.nonce = entry.nonce;
      var loading = new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { finish(new Error('Timed out loading page asset: ' + entry.src)); }, 20000);
        function finish(error) {
          clearTimeout(timer);
          element.onload = null;
          element.onerror = null;
          if (error) {
            element.remove();
            reject(error);
          } else {
            resolve();
          }
        }
        element.onload = function () { finish(); };
        element.onerror = function () { finish(new Error('Failed to load page asset: ' + entry.src)); };
        (entry.type === 'script' ? document.body : document.head).appendChild(element);
      });
      pageAssetLoads.set(key, loading);
      loading.catch(function () {
        if (pageAssetLoads.get(key) === loading) pageAssetLoads.delete(key);
      });
      return loading;
    }

    function loadPageAssets(data, isCurrent) {
      return Promise.resolve().then(function () {
        return pageAssetEntries(data).reduce(function (previous, entry) {
          return previous.then(function () {
            if (isCurrent()) return loadPageAsset(entry);
          });
        }, Promise.resolve());
      });
    }

    // Load notebook.js for Pyodide mode (returns promise)
    var CODEMIRROR_VERSION = '5.65.18';
    var notebookJsLoadPromise = null;
    function ensureNotebookJsLoaded() {
      if (window.initNotebookCells) return Promise.resolve();
      if (notebookJsLoadPromise) return notebookJsLoadPromise;

      var entries = [{ type: 'style', src: '/static/notebook.css' }];
      var cmBase = 'https://cdn.jsdelivr.net/npm/codemirror@' + CODEMIRROR_VERSION;
      if (typeof CodeMirror === 'undefined') {
        entries.push(
          { type: 'style', src: cmBase + '/lib/codemirror.min.css' },
          { type: 'script', src: cmBase + '/lib/codemirror.min.js' },
          { type: 'script', src: cmBase + '/mode/python/python.min.js' }
        );
      }
      entries.push({ type: 'script', src: '/static/notebook.js' });
      notebookJsLoadPromise = entries.reduce(function (previous, entry) {
        return previous.then(function () {
          if (window.document === routerDocument) return loadPageAsset(entry);
        });
      }, Promise.resolve());
      notebookJsLoadPromise.catch(function () {
        notebookJsLoadPromise = null;
      });
      return notebookJsLoadPromise;
    }

    // Initialize on page load
    applyNativeJupyterMode(isNativeJupyterEnabled());

    // Listen for toggle events from settings panel
    document.addEventListener('nativeJupyterToggle', function(e) {
      applyNativeJupyterMode(e.detail.enabled);
    });

    var spaContent = document.getElementById('spa-content');
    var spaToc = document.getElementById('spa-toc');
    var spaSidebar = document.getElementById('spa-sidebar');
    if (!spaContent || !spaToc || !spaSidebar) return;

    var siteTitle = document.querySelector('.site-title');
    var siteTitleText = siteTitle ? siteTitle.textContent.replace(/\[.*\]/, '').trim() : '';

    // Loading progress bar
    var progressBar = document.createElement('div');
    progressBar.className = 'spa-progress';
    document.body.appendChild(progressBar);

    var navigating = false;
    var navigationRequest = null;
    var cancelFade = null;

    // Determine if a URL should be SPA-navigated
    function shouldIntercept(anchor) {
      if (!anchor || !anchor.href) return false;
      // External links
      if (anchor.origin !== location.origin) return false;
      // Download links
      var href = anchor.getAttribute('href') || '';
      if (href === '#') return false;
      if (/\.(pdf|ipynb|png|jpg|jpeg|gif|svg|zip|tar|gz)$/i.test(anchor.pathname)) return false;
      if (href.startsWith('/static/')) return false;
      if (href.startsWith('/api/')) return false;
      if (anchor.hasAttribute('download')) return false;
      if (anchor.target === '_blank') return false;
      return true;
    }

    // Delegated link click handler
    document.addEventListener('click', function(e) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;

      var anchor = e.target.closest('a');
      if (!shouldIntercept(anchor)) return;

      e.preventDefault();
      var url = anchor.href;
      var searchResult = anchor.classList.contains('search-result-item');
      var searchQuery = searchResult ? anchor.getAttribute('data-search-query') : null;
      if (searchResult && typeof window._closeSearch === 'function') window._closeSearch();
      // Same-page hash link: scroll instead
      var parsed = new URL(url);
      if (parsed.pathname + parsed.search === renderedPageLocation && parsed.hash) {
        var target = hashTarget(parsed.hash);
        if (target) {
          if (window.TwoColumnReader && window.TwoColumnReader.goToElement(target)) {
            history.pushState(null, '', url);
            return;
          }
          if (!window.RenderOnDemand
              || typeof window.RenderOnDemand.alignHashTarget !== 'function'
              || !window.RenderOnDemand.alignHashTarget(parsed.hash, 'smooth')) {
            var banner = document.querySelector('.top-banner');
            var bannerH = (banner && !document.body.classList.contains('banner-folded')) ? banner.offsetHeight : 0;
            window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - bannerH - 16, behavior: 'smooth' });
          }
          history.pushState(null, '', url);
        }
        return;
      }
      var fromSidebar = anchor.closest('#left-sidebar') ? 'left' : anchor.closest('#right-sidebar') ? 'right' : null;
      spaNavigate(parsed.pathname + parsed.search + parsed.hash, {
        fromSidebar: fromSidebar, searchResult: searchResult, searchQuery: searchQuery
      });
    });

    // Browser back/forward
    window.addEventListener('popstate', function() {
      // Same-page hash change: scroll directly instead of refetching
      if (location.pathname + location.search === renderedPageLocation && location.hash) {
        var hashEl = hashTarget(location.hash);
        if (hashEl) {
          if (window.TwoColumnReader && window.TwoColumnReader.goToElement(hashEl)) return;
          if (!window.RenderOnDemand
              || typeof window.RenderOnDemand.alignHashTarget !== 'function'
              || !window.RenderOnDemand.alignHashTarget(location.hash, 'smooth')) {
            var banner = document.querySelector('.top-banner');
            var bannerH = (banner && !document.body.classList.contains('banner-folded')) ? banner.offsetHeight : 0;
            window.scrollTo({ top: hashEl.getBoundingClientRect().top + window.scrollY - bannerH - 16, behavior: 'smooth' });
          }
          return;
        }
      }
      spaNavigate(location.pathname + location.search + location.hash, { pushState: false });
    });

    function spaNavigate(url, opts) {
      var saveGeneration = ++navigationSaveGeneration;
      var generation = ++navigationGeneration;
      if (navigationRequest) navigationRequest.abort();
      if (cancelFade) cancelFade();
      if (!opts?.draftbookSaved && window.Draftbook?.prepareNavigation) {
        navigating = false;
        progressBar.classList.remove('active');
        return window.Draftbook.prepareNavigation().then(function (ready) {
          if (saveGeneration !== navigationSaveGeneration || window.document !== routerDocument) return;
          if (ready) return spaNavigate(url, Object.assign({}, opts, { draftbookSaved: true }));
          if (opts?.pushState === false) history.replaceState(null, '', renderedPageLocation);
        }).catch(function (error) { console.error('[draftbook] Navigation save failed', error); });
      }
      opts = opts || {};
      navigationRequest = new AbortController();
      var request = navigationRequest;
      function isCurrent() {
        return window.document === routerDocument && generation === navigationGeneration && !request.signal.aborted;
      }
      navigating = true;

      // Save scroll position before fetch if preserveScroll requested
      var savedScrollY = opts.preserveScroll ? window.scrollY : null;
      var savedBookState = opts.preserveScroll && window.TwoColumnReader
        ? window.TwoColumnReader.getNavigationRestoreState() : null;

      // Show progress
      progressBar.classList.add('active');

      // Compute the API path from URL
      var pathForApi = url.split('#')[0].split('?')[0];
      // Remove leading slash
      if (pathForApi.startsWith('/')) pathForApi = pathForApi.slice(1);
      // For directory URLs, append index.html
      if (pathForApi === '' || pathForApi.endsWith('/')) pathForApi += 'index.html';
      // Append .html if no extension
      if (!/\.\w+$/.test(pathForApi)) pathForApi += '.html';

      fetch('/api/page?path=' + encodeURIComponent(pathForApi), { signal: request.signal })
        .then(function(r) {
          if (!isCurrent()) return null;
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          if (!isCurrent()) return;
          // Fade out — wait for transition to actually complete before swapping DOM
          spaContent.classList.add('spa-loading');
          spaToc.classList.add('spa-loading');
          spaSidebar.classList.add('spa-loading');

          var fadeComplete = false;
          function onFadeTransitionEnd(e) {
            if (e.target === spaContent && e.propertyName === 'opacity') onFadeOutDone();
          }
          function onFadeOutDone() {
            if (fadeComplete || !isCurrent()) return;
            fadeComplete = true;
            clearTimeout(fadeTimer);
            spaContent.removeEventListener('transitionend', onFadeTransitionEnd);
            cancelFade = null;
            if (window.LinkPreview && typeof window.LinkPreview.reset === 'function') {
              window.LinkPreview.reset();
            }
            if (typeof window._disposeTwoColumns === 'function') window._disposeTwoColumns();
            window._unmountPageContentFeatures();
            // Swap content
            spaContent.innerHTML = data.content;
            var renderedUrl = new URL(url, location.href);
            renderedPageLocation = renderedUrl.pathname + renderedUrl.search;
            spaToc.innerHTML = data.toc;
            spaSidebar.innerHTML = data.sidebar;

            // Update page type (gates quick-edit / comments / two-columns)
            document.body.dataset.pageType = data.pageType || 'markdown';
            if (typeof window._refreshContentWidth === 'function') window._refreshContentWidth();

            // Update document title
            document.title = data.title + ' - ' + siteTitleText;

            // Update banner style/label (apply to title, not whole banner)
            var titleEl = document.querySelector('.site-title');
            if (titleEl) {
              if (data.bannerStyle) {
                titleEl.setAttribute('data-level', data.bannerStyle);
              } else {
                titleEl.removeAttribute('data-level');
              }
            }
            var labelSpan = document.querySelector('.banner-label');
            if (data.bannerLabel) {
              if (!labelSpan) {
                labelSpan = document.createElement('span');
                labelSpan.className = 'banner-label';
                var st = document.querySelector('.site-title');
                if (st) st.appendChild(labelSpan);
              }
              // Use a temporary container to safely parse the server-rendered label HTML
              var tmp = document.createElement('div');
              tmp.innerHTML = data.bannerLabel;
              var newLabel = tmp.firstElementChild;
              if (newLabel) {
                labelSpan.replaceWith(newLabel);
              } else {
                labelSpan.textContent = tmp.textContent;
              }
            } else if (labelSpan) {
              labelSpan.remove();
            }

            // Update the URL before page modules initialize so direct resource
            // targets such as ?pdf= and ?board= are visible during init.
            if (opts.pushState !== false) {
              history.pushState(null, '', url);
            }

            function finishPage() {
              if (!isCurrent()) return;

            reinitializeContent({ generation: generation, signal: request.signal, isCurrent: isCurrent });
            if (typeof window._refreshTwoColumns === 'function') window._refreshTwoColumns();

            // Scroll to top (or to hash), unless preserving scroll (e.g. live reload)
            var revealedSearch = opts.searchResult && typeof window._revealSearchResult === 'function'
              && window._revealSearchResult(renderedUrl.hash, opts.searchQuery);
            var restoredBook = savedBookState && window.TwoColumnReader
              && window.TwoColumnReader.restoreNavigationState(savedBookState);
            if (!revealedSearch && !restoredBook && savedScrollY !== null) {
              window.scrollTo(0, savedScrollY);
            } else if (!revealedSearch && !restoredBook) {
              var hash = url.split('#')[1];
              if (hash) {
                var hashEl = hashTarget(hash);
                if (hashEl && !(window.TwoColumnReader && window.TwoColumnReader.goToElement(hashEl))) {
                  var banner = document.querySelector('.top-banner');
                  var bannerH = (banner && !document.body.classList.contains('banner-folded')) ? banner.offsetHeight : 0;
                  window.scrollTo(0, hashEl.getBoundingClientRect().top + window.scrollY - bannerH - 16);
                }
              } else {
                window.scrollTo(0, 0);
              }
            }

            // Reinitialize left sidebar fold/unfold
            if (typeof window._initSidebarFold === 'function') window._initSidebarFold();

            // Fade in
            spaContent.classList.remove('spa-loading');
            spaToc.classList.remove('spa-loading');
            spaSidebar.classList.remove('spa-loading');

            // Close search if open (animated: fade dropdown, then collapse)
            if (typeof window._closeSearchAnimated === 'function') {
              window._closeSearchAnimated();
            }

            // Close floating sidebars on mobile, but keep the source sidebar open
            if (window.innerWidth <= 1100) {
              if (opts.fromSidebar !== 'left' && leftSidebar && !leftSidebar.classList.contains('collapsed')) {
                window._setSidebar(leftSidebar, leftToggle, 'left', true);
              }
              if (opts.fromSidebar !== 'right' && rightSidebar && !rightSidebar.classList.contains('collapsed')) {
                window._setSidebar(rightSidebar, rightToggle, 'right', true);
              }
            }

            navigating = false;
            progressBar.classList.remove('active');
            if (window.ReadingNavigationState) {
              window.ReadingNavigationState.save();
            }
            _log.debug('spa', 'navigate: ' + url);
            }

            loadPageAssets(data, isCurrent).then(finishPage, function (error) {
              if (!isCurrent()) return;
              _log.error('assets', error.message);
              var failure = document.createElement('p');
              failure.className = 'spa-asset-error';
              failure.setAttribute('role', 'alert');
              failure.textContent = 'Some page enhancements could not load. ' + error.message;
              spaContent.prepend(failure);
              finishPage();
            });
          }

          // Use transitionend to ensure fade-out completes before DOM swap;
          // fallback to setTimeout in case transition doesn't fire (e.g. reduced motion)
          var fadeTimer = setTimeout(onFadeOutDone, 200);
          spaContent.addEventListener('transitionend', onFadeTransitionEnd);
          cancelFade = function () {
            fadeComplete = true;
            clearTimeout(fadeTimer);
            spaContent.removeEventListener('transitionend', onFadeTransitionEnd);
            cancelFade = null;
          };
        })
        .catch(function() {
          if (!isCurrent()) return;
          // Fallback: normal navigation
          navigating = false;
          progressBar.classList.remove('active');
          window.location.href = url;
        });
    }

    function reinitializeContent(context) {
      // Code-block highlighting (including any on-demand extra-language
      // fetch) and the copy-to-clipboard button now mount through the same
      // pageContentRegistry 'code-blocks' feature as the initial page load
      // (see app.js), driven below by window._mountPageContentFeatures() —
      // not duplicated here.

      // Re-bind formula horizontal scroll
      spaContent.querySelectorAll('.math.display, .katex-display').forEach(function(el) {
        el.addEventListener('wheel', function(e) {
          if (el.scrollWidth <= el.clientWidth) return;
          e.preventDefault();
          el.scrollLeft += e.deltaY || e.deltaX;
        }, { passive: false });
      });

      // Re-bind KaTeX context menu on new math elements
      spaContent.querySelectorAll('.math').forEach(function(el) {
        el.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          var menu = document.querySelector('.katex-context-menu');
          if (!menu) return;
          menu._activeMath = el;
          menu.style.left = e.clientX + 'px';
          menu.style.top = e.clientY + 'px';
          menu.classList.add('visible');
          requestAnimationFrame(function() {
            var rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = (e.clientX - rect.width) + 'px';
            if (rect.bottom > window.innerHeight) menu.style.top = (e.clientY - rect.height) + 'px';
          });
        });
      });

      // Re-init TOC
      reinitToc();

      if (typeof window.initFeatureGrid === 'function') window.initFeatureGrid(spaContent);

      // Re-init per-page content enhancements (viewport rendering, table
      // sort/filter, syllabus DAG, comments, the quick-edit toggle's enabled
      // state, and the homepage greeting cycle) through the exact same
      // mountPageContentFeatures() helper used for the deferred
      // initial-load mount (see near the top of this file), so each
      // feature's mount/unmount pair is defined in exactly one place
      // instead of being duplicated as ad hoc reinitialize calls here.
      window._mountPageContentFeatures(spaContent, context);

      // Update TOC sidebar visibility
      var isIndex = document.body.dataset.pageType === 'index';
      var newTocEmpty = isIndex || !spaToc.querySelector('.toc-list');
      if (rightToggle) {
        rightToggle.disabled = !!newTocEmpty;
        rightToggle.classList.toggle('disabled', !!newTocEmpty);
      }
      var floatToc = document.getElementById('float-toc-btn');
      if (floatToc) {
        floatToc.style.display = newTocEmpty ? 'none' : '';
      }
      if (newTocEmpty && rightSidebar && !rightSidebar.classList.contains('collapsed')) {
        window._setSidebar(rightSidebar, rightToggle, 'right', true);
      }
      // Re-expand right sidebar if page has TOC and user preference / screen allows it
      if (!newTocEmpty && rightSidebar && rightSidebar.classList.contains('collapsed')) {
        var w = window.innerWidth;
        var wantOpen = sidebarPrefs.right !== undefined ? sidebarPrefs.right : (w >= 1100);
        if (w >= 1100 && wantOpen) {
          window._setSidebar(rightSidebar, rightToggle, 'right', false);
        }
      }
    }

    function reinitToc() {
      // Reuses the exact same content-registry 'toc' feature (registered
      // once at initial DOMContentLoaded, above) — mountAll() unmounts
      // the previous tree/scroll-tracking instances before mounting fresh
      // ones against the newly swapped-in #spa-toc, so navigating never
      // leaves stale scroll listeners behind.
      if (window._reinitToc && window._reinitToc(spaToc)) {
        // handled by the shared contentRegistry via window._reinitToc
      } else if (window.SidebarPanel) {
        if (window._spaTocTree) { window._spaTocTree.destroy(); window._spaTocTree = null; }
        if (window._spaTocScroll) { window._spaTocScroll.destroy(); window._spaTocScroll = null; }
        window._spaTocTree = SidebarPanel.initTocTree(spaToc);
        window._spaTocScroll = SidebarPanel.initScrollTracking(spaToc);
      }

      // Adjust right sidebar width for new TOC
      if (window._adjustRightSidebarWidth) {
        window._adjustRightSidebarWidth();
      }
    }

    // SSE live reload (watch mode)
    // Close SSE when tab is hidden to free HTTP/1.1 connection slots (browsers
    // limit to 6 per origin). Reopen on visibility + do a freshness check so
    // background edits are picked up when the user switches back.
    if (document.body.dataset.spaWatch) {
      var es = null;
      var _sseLastRevision = 0;
      var _liveReloadPending = false;
      var _fullReloadPending = false;
      var _liveReloadTimer = null;

      function _sseCurrentPagePath() {
        var p = location.pathname;
        if (p.startsWith('/')) p = p.slice(1);
        if (p === '' || p.endsWith('/')) p += 'index.html';
        if (!/\.\w+$/.test(p)) p += '.html';
        return p;
      }

      function _sseRememberRevision(data) {
        if (data && typeof data.revision === 'number' && data.revision > _sseLastRevision) {
          _sseLastRevision = data.revision;
        }
      }

      function _isNativeJupyterSelfSave(data) {
        if (!data || data.source !== 'jupyter-save' || !data.jupyterSave) return false;
        if (document.body.getAttribute('data-native-jupyter') !== 'on') return false;
        if (document.body.dataset.pageType !== 'notebook') return false;
        var currentPage = _sseCurrentPagePath();
        if (!data.jupyterSave.pages || data.jupyterSave.pages.indexOf(currentPage) === -1) return false;
        var frame = document.querySelector('.jupyter-frame[data-notebook-path]');
        if (!frame) return false;
        var notebookPath = frame.getAttribute('data-notebook-path');
        return !data.jupyterSave.notebooks || data.jupyterSave.notebooks.indexOf(notebookPath) !== -1;
      }

      function _runLiveReload() {
        _liveReloadTimer = null;
        if ((!_liveReloadPending && !_fullReloadPending) || document.hidden) return;
        if (navigating) {
          _liveReloadTimer = setTimeout(_runLiveReload, 100);
          return;
        }
        _liveReloadPending = false;
        if (_fullReloadPending) {
          _fullReloadPending = false;
          location.reload();
          return;
        }
        spaNavigate(location.pathname + location.search, { pushState: false, preserveScroll: true });
      }

      function _scheduleLiveReload() {
        _liveReloadPending = true;
        if (!_liveReloadTimer) _liveReloadTimer = setTimeout(_runLiveReload, 0);
      }

      function _sseConnect() {
        if (es) { es.close(); es = null; }
        var eventUrl = _sseLastRevision > 0 ? '/api/events?since=' + encodeURIComponent(_sseLastRevision) : '/api/events';
        es = new EventSource(eventUrl);
        es.addEventListener('draftbook-updated', function(e) {
          try { window.dispatchEvent(new CustomEvent('draftbook-updated', { detail: JSON.parse(e.data) })); }
          catch (error) { console.error('[draftbook] Invalid update event', error); }
        });
        es.addEventListener('reload', function(e) {
          try {
            var data = JSON.parse(e.data);
            _sseRememberRevision(data);
            if (data.pages && data.pages.indexOf(_sseCurrentPagePath()) !== -1) {
              if (_isNativeJupyterSelfSave(data)) return;
              if (document.hidden) { _liveReloadPending = true; return; }
              _scheduleLiveReload();
            }
          } catch(err) {}
        });
        es.addEventListener('full-reload', function(e) {
          try { _sseRememberRevision(JSON.parse(e.data || '{}')); } catch(err) {}
          _fullReloadPending = true;
          if (!document.hidden) _scheduleLiveReload();
        });
      }

      if (!document.hidden) _sseConnect();

      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          // Release the persistent SSE connection to free a connection slot
          if (es) { es.close(); es = null; }
        } else {
          _sseConnect();
          if (_fullReloadPending || _liveReloadPending) {
            _scheduleLiveReload();
          }
        }
      });

      addEventListener('beforeunload', function() {
        if (es) es.close();
        clearTimeout(_liveReloadTimer);
      });
    }

    // SPA health check: ping /api/health every 1s
    // The heart tracks the connection; module warnings belong in the popup.
    // 💓 (1F493) connected, 💔 (1F494) disconnected, 💛 (1F49B) checking
    var healthDot = document.getElementById('spa-health-dot');
    if (healthDot) {
      var PING_INTERVAL = 1000;
      var UNHEALTHY_THRESHOLD = 5000;
      var healthTimeout = null;
      var healthExpiryTimeout = null;
      var healthRequestTimeout = null;
      var healthGeneration = 0;
      var healthProbeId = 0;
      var healthAbortController = null;
      var lastSuccessTime = Date.now();
      var currentState = null;
      var lastPingMs = null;
      var lastHealthData = null;

      // Popup elements
      var healthPopup = document.getElementById('spa-health-popup');
      var healthWrap = document.getElementById('spa-health-wrap');
      var shpHeart = document.getElementById('shp-heart');
      var shpPing = document.getElementById('shp-ping');
      var shpUptime = document.getElementById('shp-uptime');
      var shpMemory = document.getElementById('shp-memory');
      var shpCpuTime = document.getElementById('shp-cpu-time');
      var shpLoad = document.getElementById('shp-load');
      var shpModWatch = document.getElementById('shp-mod-watch');
      var shpModJupyter = document.getElementById('shp-mod-jupyter');
      var shpModTerminal = document.getElementById('shp-mod-terminal');
      var shpModProxy = document.getElementById('shp-mod-proxy');
      var shpModuleDiagnostics = document.getElementById('shp-module-diagnostics');

      function updateModuleDiagnostics(data) {
        if (!shpModuleDiagnostics) return;
        function records(value) {
          return Array.isArray(value) ? value : Object.keys(value || {}).map(function(id) {
            return Object.assign({ id: id }, value[id]);
          });
        }
        var seen = new Set();
        var messages = data.ok === false ? ['⚠ server: not ready'] : [];
        records(data.modules).concat(records(data.diagnostics)).forEach(function(record) {
          if (!record || !['failed', 'blocked', 'unavailable'].includes(record.state)) return;
          var code = record.error && record.error.code || record.code;
          if (record.state === 'unavailable' && code === 'MODULE_MODE_UNAVAILABLE') return;
          var id = typeof record.id === 'string' ? record.id : 'module';
          if (seen.has(id)) return;
          seen.add(id);
          var detail = record.error && record.error.message || record.message || record.reason;
          var reason = typeof detail === 'string' ? detail.trim().split(/\r?\n|[.!?;]\s+/)[0]
            .replace(/^(?:The module|Rendering enhancement)\s+(?:is\s+)?/i, '').trim() : '';
          if (!reason) reason = typeof code === 'string' && code
            ? code.replace(/^(?:MODULE_|ERR_)/, '').toLowerCase().replace(/_/g, ' ') : record.state;
          var line = '⚠ ' + id.replace(/^(?:computation|publishing)\./, '') + ': ' + reason;
          var characters = Array.from(line.replace(/\s+/g, ' '));
          messages.push(characters.length > 96 ? characters.slice(0, 95).join('') + '…' : characters.join(''));
        });
        var text = messages.join('\n');
        if (shpModuleDiagnostics.textContent !== text) shpModuleDiagnostics.textContent = text;
      }

      function formatUptime(sec) {
        var d = Math.floor(sec / 86400);
        var h = Math.floor((sec % 86400) / 3600);
        var m = Math.floor((sec % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm ' + Math.floor(sec % 60) + 's';
      }

      function formatCpuTime(sec) {
        if (!Number.isFinite(sec) || sec < 0) return '—';
        if (sec < 1) return Math.round(sec * 1000) + ' ms';
        if (sec < 60) return sec.toFixed(1) + ' s';
        var totalMinutes = Math.floor(sec / 60);
        var seconds = Math.floor(sec % 60);
        if (totalMinutes < 60) return totalMinutes + 'm ' + seconds + 's';
        var hours = Math.floor(totalMinutes / 60);
        return hours + 'h ' + (totalMinutes % 60) + 'm';
      }

      // Settings-footer build metadata is rendered/formatted by
      // shell-search-settings.js (loads first — see its window._applyBuildInfo
      // doc comment). Reusing that bridge here means a successful health tick
      // refreshes branch/commit/commitTime/dirty/generatedAt with the exact
      // same localized-time-with-ISO-title formatting, and a transient health
      // failure (this function is only ever called from the fetch success
      // path below) never blanks a previously-good baked or fetched value.
      function updateGitVersion(git) {
        if (typeof window._applyBuildInfo === 'function') window._applyBuildInfo(git);
      }

      function updatePopupContent() {
        if (!healthPopup) return;
        var heartEmoji = currentState === 'healthy' ? '\u{1F493}' :
                         currentState === 'unhealthy' ? '\u{1F494}' : '\u{1F49B}';
        if (shpHeart) shpHeart.textContent = heartEmoji;
        if (currentState !== 'healthy' || !lastHealthData) {
          if (shpPing) shpPing.textContent = currentState === 'unhealthy' ? 'timeout' : '—';
          if (shpUptime) shpUptime.textContent = '—';
          if (shpMemory) shpMemory.textContent = '—';
          if (shpCpuTime) shpCpuTime.textContent = '—';
          if (shpLoad) shpLoad.textContent = '—';
          [shpModWatch, shpModJupyter, shpModTerminal, shpModProxy].forEach(function(el) {
            if (el) el.classList.remove('on');
          });
          updateModuleDiagnostics({});
          return;
        }
        var d = lastHealthData;
        if (shpPing) shpPing.textContent = lastPingMs != null ? lastPingMs + ' ms' : '—';
        if (shpUptime) shpUptime.textContent = formatUptime(d.uptime);
        if (shpMemory) shpMemory.textContent = d.memoryMB + ' MB';
        if (shpCpuTime) shpCpuTime.textContent = formatCpuTime(d.cpuTimeSeconds);
        if (shpLoad) {
          var la = d.loadAvg;
          shpLoad.textContent = la[0].toFixed(1) + ' / ' + la[1].toFixed(1) + ' / ' + la[2].toFixed(1);
        }
        // Module dots
        var f = d.features || {};
        if (shpModWatch) shpModWatch.classList.toggle('on', !!f.watch);
        if (shpModJupyter) shpModJupyter.classList.toggle('on', !!f.jupyter);
        if (shpModTerminal) shpModTerminal.classList.toggle('on', !!f.terminal);
        if (shpModProxy) shpModProxy.classList.toggle('on', !!f.proxyCdn);
        updateModuleDiagnostics(d);
      }

      // Popup open/close
      var popupOpen = false;
      var hoverTimer = null;
      var isTouch = window.matchMedia('(hover: none)').matches;

      function openPopup() {
        if (!healthPopup || popupOpen) return;
        popupOpen = true;
        updatePopupContent();
        healthPopup.classList.add('open');
      }
      function closePopup() {
        if (!healthPopup || !popupOpen) return;
        popupOpen = false;
        healthPopup.classList.remove('open');
      }

      if (healthPopup && healthWrap) {
        if (isTouch) {
          // Touch: tap to toggle
          healthDot.addEventListener('click', function(e) {
            e.stopPropagation();
            popupOpen ? closePopup() : openPopup();
          });
        } else {
          // Desktop: hover with delay
          healthWrap.addEventListener('mouseenter', function() {
            clearTimeout(hoverTimer);
            openPopup();
          });
          healthWrap.addEventListener('mouseleave', function() {
            hoverTimer = setTimeout(closePopup, 200);
          });
          // Also allow click toggle for accessibility
          healthDot.addEventListener('click', function(e) {
            e.stopPropagation();
            popupOpen ? closePopup() : openPopup();
          });
        }
        // Click outside closes popup (both desktop and touch)
        document.addEventListener('click', function(e) {
          if (popupOpen && !healthPopup.contains(e.target) && e.target !== healthDot) {
            closePopup();
          }
        });
      }

      var setState = function(state) {
        if (state === currentState) return;
        currentState = state;
        if (state === 'healthy') {
          healthDot.textContent = '\u{1F493}';
          healthDot.title = 'SPA server: connected';
        } else if (state === 'unhealthy') {
          healthDot.textContent = '\u{1F494}';
          healthDot.title = 'SPA server: disconnected';
        } else {
          healthDot.textContent = '\u{1F49B}';
          healthDot.title = 'SPA server: checking...';
        }
        if (popupOpen) updatePopupContent();
      };
      setState('unknown');

      // Track server features
      var serverFeatures = { jupyter: false, watch: false };

      // Detect what the page was rendered with based on HTML content
      // If there's a notebook-jupyter-container, page was rendered with jupyter
      // If there's only nb-container, page was rendered without jupyter
      function pageWasRenderedWithJupyter() {
        return !!document.querySelector('.notebook-jupyter-container');
      }

      function updateFeatureUI(healthy) {
        var jupyterSwitch = document.getElementById('native-jupyter-switch');
        var searchSwitch = document.getElementById('content-search-switch');
        var quickEditSwitch = document.getElementById('quick-edit-switch');

        // When server is unhealthy, disable all SPA switches
        if (!healthy) {
          [jupyterSwitch, searchSwitch, quickEditSwitch].forEach(function(sw) {
            if (sw) {
              sw.disabled = true;
              sw.setAttribute('aria-checked', 'false');
              var section = sw.closest('.settings-panel-section');
              if (section) section.classList.add('feature-disabled');
            }
          });
          document.body.setAttribute('data-native-jupyter', 'off');
          // Keep applyNativeJupyterMode's own "already applied" tracking in
          // sync with the forced-off attribute above. Without this, a later
          // recovery's applyNativeJupyterMode(true) call would be skipped
          // by its `enabled === _lastJupyterMode` no-op guard (still stale
          // at `true` from before the outage), silently ignoring the first
          // re-enable after the server comes back.
          _lastJupyterMode = false;
          return;
        }

        // Check if jupyter feature changed vs what page was rendered with
        // If page was rendered without jupyter but server now has it (or vice versa),
        // reload to get correct HTML (only for notebook pages)
        var isNotebookPage = document.querySelector('.nb-container') ||
                            document.querySelector('.notebook-jupyter-container');
        if (isNotebookPage) {
          var pageHasJupyter = pageWasRenderedWithJupyter();
          if (serverFeatures.jupyter && !pageHasJupyter) {
            _log.info('spa', 'Server has jupyter but page was rendered without it, reloading...');
            location.reload();
            return;
          }
        }

        // Content search works in every SPA mode.
        if (searchSwitch) {
          searchSwitch.disabled = serverFeatures.search === false;
          var searchSection = searchSwitch.closest('.settings-panel-section');
          if (searchSection) searchSection.classList.toggle('feature-disabled', searchSwitch.disabled);
        }

        // Quick Edit requires the watch/source-save routes.
        if (quickEditSwitch) {
          quickEditSwitch.disabled = !serverFeatures.watch;
          var quickEditSection = quickEditSwitch.closest('.settings-panel-section');
          if (quickEditSection) {
            quickEditSection.classList.toggle('feature-disabled', !serverFeatures.watch);
          }
          if (!serverFeatures.watch) {
            quickEditSwitch.setAttribute('aria-checked', 'false');
          }
        }

        // Native jupyter depends on server capability
        if (jupyterSwitch) {
          if (serverFeatures.jupyter) {
            jupyterSwitch.disabled = false;
            jupyterSwitch.closest('.settings-panel-section').classList.remove('feature-disabled');
            // Recovery: capability is available again. The unhealthy branch
            // above force-synced _lastJupyterMode to false, so this call is
            // never skipped by applyNativeJupyterMode's no-op guard — the
            // user's saved native-Jupyter preference is reapplied instead
            // of silently staying off after an outage.
            var nativeJupyterEnabled = isNativeJupyterEnabled();
            jupyterSwitch.setAttribute('aria-checked', nativeJupyterEnabled ? 'true' : 'false');
            applyNativeJupyterMode(nativeJupyterEnabled);
          } else {
            jupyterSwitch.disabled = true;
            jupyterSwitch.setAttribute('aria-checked', 'false');
            jupyterSwitch.closest('.settings-panel-section').classList.add('feature-disabled');
            document.body.setAttribute('data-native-jupyter', 'off');
            _lastJupyterMode = false;
          }
        }
      }

      function stopHealthChecks() {
        clearTimeout(healthTimeout);
        healthTimeout = null;
        clearTimeout(healthExpiryTimeout);
        healthExpiryTimeout = null;
        clearTimeout(healthRequestTimeout);
        healthRequestTimeout = null;
        healthGeneration++;
        if (healthAbortController) {
          try { healthAbortController.abort(); } catch (_) { /* noop */ }
          healthAbortController = null;
        }
      }

      function expireHealth(generation) {
        clearTimeout(healthExpiryTimeout);
        healthExpiryTimeout = setTimeout(function() {
          healthExpiryTimeout = null;
          if (document.hidden || generation !== healthGeneration) return;
          setState('unhealthy');
          updateFeatureUI(false);
        }, UNHEALTHY_THRESHOLD);
      }

      function resumeHealthChecks() {
        stopHealthChecks();
        if (document.hidden) return;
        lastSuccessTime = Date.now();
        setState('unknown');
        expireHealth(healthGeneration);
        checkHealth(healthGeneration);
      }

      var checkHealth = function(generation) {
        if (generation == null) generation = healthGeneration;
        if (document.hidden || generation !== healthGeneration) return;
        var fetchStart = Date.now();
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        healthAbortController = controller;
        var options = { method: 'GET', cache: 'no-store' };
        if (controller) options.signal = controller.signal;
        var expired = false;
        var requestTimeout;
        // Bound both the request and its body. A stalled fetch must not keep
        // the last healthy state or prevent the next poll, even without abort.
        var deadline = new Promise(function(_resolve, reject) {
          requestTimeout = setTimeout(function() {
            expired = true;
            reject(new Error('health timeout'));
            if (controller) controller.abort();
          }, UNHEALTHY_THRESHOLD);
          healthRequestTimeout = requestTimeout;
        });
        // A previous worker can still control this page until its other tabs
        // close. Its cache fallback ignores no-store, so use a fresh URL too.
        var request = fetch('/api/health?probe=' + fetchStart + '-' + (++healthProbeId), options)
          .then(function(r) {
            if (expired || document.hidden || generation !== healthGeneration) return null;
            if (r.ok) {
              lastSuccessTime = Date.now();
              lastPingMs = Date.now() - fetchStart;
              expireHealth(generation);
              setState('healthy');
              return r.json();
            } else {
              throw new Error('not ok');
            }
          });
        Promise.race([request, deadline])
          .then(function(data) {
            if (document.hidden || generation !== healthGeneration) return;
            if (data) {
              lastHealthData = data;
              if (data.ok === false) {
                updateFeatureUI(false);
                if (popupOpen) updatePopupContent();
                return;
              }
              updateGitVersion(data.buildInfo);
              if (data.features) {
                serverFeatures = data.features;
                updateFeatureUI(true);
              }
              if (popupOpen) updatePopupContent();
            }
          })
          .catch(function(err) {
            if (document.hidden || generation !== healthGeneration ||
                (err && err.name === 'AbortError')) return;
            var elapsed = Date.now() - lastSuccessTime;
            if (elapsed >= UNHEALTHY_THRESHOLD) {
              setState('unhealthy');
              updateFeatureUI(false);
            } else {
              setState('unknown');
            }
          })
          .finally(function() {
            clearTimeout(requestTimeout);
            if (healthRequestTimeout === requestTimeout) healthRequestTimeout = null;
            if (healthAbortController === controller) healthAbortController = null;
            if (document.hidden || generation !== healthGeneration) return;
            healthTimeout = setTimeout(function() {
              checkHealth(generation);
            }, PING_INTERVAL);
          });
      };
      resumeHealthChecks();
      // Stop checking when page is hidden, resume when visible
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          stopHealthChecks();
        } else {
          resumeHealthChecks();
        }
      });
      window.addEventListener('rprintAppDidResume', resumeHealthChecks);
    }
  })();

  // ===== Quick Edit — extracted to quick-edit.js =====

  // ===== PWA Service Worker =====
  const appCapabilities = window.RPRINT_APP && window.RPRINT_APP.capabilities;
  const serviceWorkerEnabled = !appCapabilities || appCapabilities.serviceWorker !== false;
  if (serviceWorkerEnabled && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(function(reg) {
      // Notify user when a new version is available
      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Keep the update waiting until pages controlled by the previous
            // worker close. Activating immediately can mix an old shell loader
            // with a newly split client chunk graph.
            _log.info('sw', 'Update ready; it will activate after open pages close');
          }
        });
      });
    }).catch(function(err) {
      _log.error('sw', 'SW registration failed: ' + err);
    });
  }
});
