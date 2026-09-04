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

      var script = document.createElement('script');
      var loading = new Promise(function(resolve, reject) {
        script.src = versionedStaticAsset('notebook-spa-jupyter-embed.js');
        script.onload = function() {
          if (typeof window.initJupyterEmbed === 'function') resolve();
          else reject(new Error('Jupyter embed script loaded without its public API'));
        };
        script.onerror = function() {
          reject(new Error('Failed to load the Jupyter embed script'));
        };
        document.body.appendChild(script);
      });
      jupyterEmbedLoadPromise = loading;
      loading.catch(function() {
        if (jupyterEmbedLoadPromise === loading) jupyterEmbedLoadPromise = null;
        if (script.parentNode) script.parentNode.removeChild(script);
      });
      return loading;
    }

    var _lastJupyterMode = null;
    var jupyterEmbedRetryNeeded = false;
    document.addEventListener('rprint:jupyter-embed-retry-needed', function() {
      jupyterEmbedRetryNeeded = true;
    });

    function startJupyterEmbed() {
      return ensureJupyterEmbedLoaded()
        .then(function() {
          jupyterEmbedRetryNeeded = false;
          _log.info('spa', 'initJupyterEmbed exists: ' + !!window.initJupyterEmbed);
          window.initJupyterEmbed();
        })
        .catch(function(err) {
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
        ensureNotebookJsLoaded().then(function() {
          if (window.initNotebookCells) window.initNotebookCells();
        });
      }
    }

    // Load a script if not already present; call cb when ready.
    // expectedGlobal: optional window property name to verify the script executed.
    // Retries up to 2 times with cache-busting on failure.
    function ensureScriptLoaded(src, cb, expectedGlobal) {
      // If script tag exists AND the expected global is defined, we're good
      if (document.querySelector('script[src="' + src + '"]')) {
        if (!expectedGlobal || typeof window[expectedGlobal] !== 'undefined') { cb(); return; }
        // Script tag exists but global missing — remove stale tag and re-load
        var stale = document.querySelector('script[src="' + src + '"]');
        if (stale) stale.parentNode.removeChild(stale);
      }
      var retries = 0;
      var maxRetries = 2;
      function attempt() {
        var s = document.createElement('script');
        s.src = retries > 0 ? src + '?retry=' + retries : src;
        s.onload = function() {
          if (expectedGlobal && typeof window[expectedGlobal] === 'undefined' && retries < maxRetries) {
            retries++;
            s.parentNode.removeChild(s);
            attempt();
          } else {
            cb();
          }
        };
        s.onerror = function() {
          if (retries < maxRetries) {
            retries++;
            s.parentNode.removeChild(s);
            attempt();
          } else {
            if (typeof _log !== 'undefined') _log.error('script', 'Failed to load ' + src + ' after ' + (retries + 1) + ' attempts');
            cb(); // Call cb anyway to avoid hanging the chain
          }
        };
        document.body.appendChild(s);
      }
      attempt();
    }

    // Load notebook.js for Pyodide mode (returns promise)
    var CODEMIRROR_VERSION = '5.65.18';
    var notebookJsLoadPromise = null;
    function ensureNotebookJsLoaded() {
      if (window.initNotebookCells) return Promise.resolve();
      if (notebookJsLoadPromise) return notebookJsLoadPromise;

      notebookJsLoadPromise = new Promise(function(resolve) {
        // Also need notebook.css
        if (!document.querySelector('link[href="/static/notebook.css"]')) {
          var css = document.createElement('link');
          css.rel = 'stylesheet';
          css.href = '/static/notebook.css';
          document.head.appendChild(css);
        }
        // Load CodeMirror if not already present (needed for syntax highlighting)
        var cmBase = 'https://cdn.jsdelivr.net/npm/codemirror@' + CODEMIRROR_VERSION;
        function loadNotebookScript() {
          var s = document.createElement('script');
          s.src = '/static/notebook.js';
          s.onload = resolve;
          document.body.appendChild(s);
        }
        if (typeof CodeMirror === 'undefined') {
          if (!document.querySelector('link[href$="codemirror.min.css"]')) {
            var cmCss = document.createElement('link');
            cmCss.rel = 'stylesheet';
            cmCss.href = cmBase + '/lib/codemirror.min.css';
            document.head.appendChild(cmCss);
          }
          var cmScript = document.createElement('script');
          cmScript.src = cmBase + '/lib/codemirror.min.js';
          cmScript.onload = function() {
            var pyMode = document.createElement('script');
            pyMode.src = cmBase + '/mode/python/python.min.js';
            pyMode.onload = loadNotebookScript;
            document.body.appendChild(pyMode);
          };
          document.body.appendChild(cmScript);
        } else {
          loadNotebookScript();
        }
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
      // Same-page hash link: scroll instead
      var parsed = new URL(url);
      if (parsed.pathname === location.pathname && parsed.hash) {
        var target = document.getElementById(decodeURIComponent(parsed.hash.slice(1)));
        if (target) {
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
      spaNavigate(parsed.pathname + parsed.search + parsed.hash, { fromSidebar: fromSidebar });
    });

    // Browser back/forward
    window.addEventListener('popstate', function() {
      // Same-page hash change: scroll directly instead of refetching
      if (location.hash) {
        var hashEl = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (hashEl) {
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
      opts = opts || {};
      if (navigating) return;
      navigating = true;

      // Save scroll position before fetch if preserveScroll requested
      var savedScrollY = opts.preserveScroll ? window.scrollY : null;

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

      fetch('/api/page?path=' + encodeURIComponent(pathForApi))
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          // Fade out — wait for transition to actually complete before swapping DOM
          spaContent.classList.add('spa-loading');
          spaToc.classList.add('spa-loading');
          spaSidebar.classList.add('spa-loading');

          function onFadeOutDone() {
            if (window.LinkPreview && typeof window.LinkPreview.reset === 'function') {
              window.LinkPreview.reset();
            }
            var outgoingPdf = spaContent.querySelector('#pdf-annotator-container');
            if (outgoingPdf && typeof outgoingPdf._pdfaDestroy === 'function') {
              outgoingPdf._pdfaDestroy();
            }
            // Swap content
            spaContent.innerHTML = data.content;
            spaToc.innerHTML = data.toc;
            spaSidebar.innerHTML = data.sidebar;

            // Update page type (gates quick-edit / comments / two-columns)
            document.body.dataset.pageType = data.pageType || 'markdown';

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

            // Handle extra scripts (notebook, PDF, whiteboard, etc.)
            handleExtraScripts(data.extraScripts);

            // Scroll to top (or to hash), unless preserving scroll (e.g. live reload)
            if (savedScrollY !== null) {
              window.scrollTo(0, savedScrollY);
            } else {
              var hash = url.split('#')[1];
              if (hash) {
                var hashEl = document.getElementById(decodeURIComponent(hash));
                if (hashEl) {
                  var banner = document.querySelector('.top-banner');
                  var bannerH = (banner && !document.body.classList.contains('banner-folded')) ? banner.offsetHeight : 0;
                  window.scrollTo(0, hashEl.getBoundingClientRect().top + window.scrollY - bannerH - 16);
                }
              } else {
                window.scrollTo(0, 0);
              }
            }

            // Reinitialize content (KaTeX, hljs, mermaid, etc.)
            reinitializeContent();

            // Re-evaluate two-column mode AFTER content rendering so element
            // heights (especially KaTeX formulas) are final, not pre-render.
            // If fonts load later, the loadingdone listener in themes.js
            // will trigger a re-chunk automatically.
            if (typeof window._refreshTwoColumns === 'function') {
              window._refreshTwoColumns();
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

          // Use transitionend to ensure fade-out completes before DOM swap;
          // fallback to setTimeout in case transition doesn't fire (e.g. reduced motion)
          var fadeTimer = setTimeout(onFadeOutDone, 200);
          spaContent.addEventListener('transitionend', function handler(e) {
            if (e.propertyName !== 'opacity') return;
            spaContent.removeEventListener('transitionend', handler);
            clearTimeout(fadeTimer);
            onFadeOutDone();
          });
        })
        .catch(function() {
          // Fallback: normal navigation
          navigating = false;
          progressBar.classList.remove('active');
          window.location.href = url;
        });
    }

    function handleExtraScripts(extraScripts) {
      if (!extraScripts) return;
      // Notebook.js (Pyodide-only mode, no Jupyter server)
      if (extraScripts.indexOf('notebook.js') !== -1 && extraScripts.indexOf('notebook-spa-jupyter-embed.js') === -1) {
        ensureNotebookJsLoaded().then(function() {
          if (window.initNotebookCells) window.initNotebookCells();
        });
      }
      // Dual mode (Jupyter server available) — load both scripts, init based on setting
      if (extraScripts.indexOf('notebook-spa-jupyter-embed.js') !== -1) {
        var useNativeJupyter = isNativeJupyterEnabled();

        if (useNativeJupyter) startJupyterEmbed();

        // Also load pyodide script for dual mode
        ensureNotebookJsLoaded().then(function() {
          if (!useNativeJupyter && window.initNotebookCells) {
            window.initNotebookCells();
          }
        });
      }
      // Whiteboard
      if (extraScripts.indexOf('whiteboard.js') !== -1) {
        if (!document.querySelector('link[href="/static/ink-toolbar.css"]')) {
          var itLink = document.createElement('link');
          itLink.rel = 'stylesheet';
          itLink.href = '/static/ink-toolbar.css';
          document.head.appendChild(itLink);
        }
        if (!document.querySelector('link[href="/static/exhibit.css"]')) {
          var ibLink = document.createElement('link');
          ibLink.rel = 'stylesheet';
          ibLink.href = '/static/exhibit.css';
          document.head.appendChild(ibLink);
        }
        if (!document.querySelector('link[href="/static/whiteboard.css"]')) {
          var wbLink = document.createElement('link');
          wbLink.rel = 'stylesheet';
          wbLink.href = '/static/whiteboard.css';
          document.head.appendChild(wbLink);
        }
        if (!document.querySelector('link[href="/static/whiteboard-widgets.css"]')) {
          var wwLink = document.createElement('link');
          wwLink.rel = 'stylesheet';
          wwLink.href = '/static/whiteboard-widgets.css';
          document.head.appendChild(wwLink);
        }
        // Load dependency chain: core/ink-stroke-format.js -> drawing-engine-render.js -> drawing-engine.js -> the four core/whiteboard-*.js protocol chunks -> whiteboard-protocol.js -> ink-toolbar.js -> exhibit.js -> whiteboard-widgets-core.js -> whiteboard-widgets.js -> whiteboard.js
        ensureScriptLoaded('/static/core/ink-stroke-format.js', function() {
        ensureScriptLoaded('/static/drawing-engine-render.js', function() {
        ensureScriptLoaded('/static/drawing-engine.js', function() {
          ensureScriptLoaded('/static/core/whiteboard-operation-payload.js', function() {
          ensureScriptLoaded('/static/core/whiteboard-canvas-format.js', function() {
          ensureScriptLoaded('/static/core/whiteboard-client-to-server-framing.js', function() {
          ensureScriptLoaded('/static/core/whiteboard-server-to-client-framing.js', function() {
          ensureScriptLoaded('/static/whiteboard-protocol.js', function() {
          ensureScriptLoaded('/static/ink-toolbar.js', function() {
            ensureScriptLoaded('/static/exhibit.js', function() {
              ensureScriptLoaded('/static/whiteboard-widgets-core.js', function() {
              ensureScriptLoaded('/static/whiteboard-widgets.js', function() {
              ensureScriptLoaded('/static/whiteboard/pending-store.js', function() {
              ensureScriptLoaded('/static/whiteboard/board-manager.js', function() {
              ensureScriptLoaded('/static/whiteboard/selection.js', function() {
              ensureScriptLoaded('/static/whiteboard/text.js', function() {
              ensureScriptLoaded('/static/whiteboard/pending-queue.js', function() {
              ensureScriptLoaded('/static/whiteboard/optimistic-state.js', function() {
              ensureScriptLoaded('/static/whiteboard/sync.js', function() {
              ensureScriptLoaded('/static/whiteboard/scene-renderer.js', function() {
              ensureScriptLoaded('/static/whiteboard/widgets.js', function() {
              ensureScriptLoaded('/static/whiteboard/input.js', function() {
              ensureScriptLoaded('/static/whiteboard.js', function() {
                if (typeof window.initWhiteboard === 'function') window.initWhiteboard();
              }, 'initWhiteboard');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, '__wbClient');
              }, 'WhiteboardWidgets');
              }, 'WhiteboardWidgetsCore');
            }, 'Exhibit');
          }, 'InkToolbar');
          }, 'WhiteboardProtocol');
          }, '__wbProtocol');
          }, '__wbProtocol');
          }, '__wbProtocol');
          }, '__wbProtocol');
        }, 'DrawingEngine');
        }, 'DrawingEngine');
        }, 'InkStrokeFormat');
      }
      // PDF Annotator
      if (extraScripts.indexOf('pdf-annotator.js') !== -1) {
        if (!document.querySelector('link[href="/static/ink-toolbar.css"]')) {
          var pitLink = document.createElement('link');
          pitLink.rel = 'stylesheet';
          pitLink.href = '/static/ink-toolbar.css';
          document.head.appendChild(pitLink);
        }
        if (!document.querySelector('link[href="/static/exhibit.css"]')) {
          var pibLink = document.createElement('link');
          pibLink.rel = 'stylesheet';
          pibLink.href = '/static/exhibit.css';
          document.head.appendChild(pibLink);
        }
        if (!document.querySelector('link[href="/static/pdf-annotator.css"]')) {
          var paLink = document.createElement('link');
          paLink.rel = 'stylesheet';
          paLink.href = '/static/pdf-annotator.css';
          document.head.appendChild(paLink);
        }
        ensureScriptLoaded('/static/core/ink-stroke-format.js', function() {
        ensureScriptLoaded('/static/drawing-engine-render.js', function() {
        ensureScriptLoaded('/static/drawing-engine.js', function() {
          ensureScriptLoaded('/static/ink-toolbar.js', function() {
            ensureScriptLoaded('/static/exhibit.js', function() {
              ensureScriptLoaded('/static/core/pdf-page-map-format.js', function() {
              if (!document.querySelector('script[src="/static/pdf-annotator.js"]')) {
                var s = document.createElement('script');
                s.type = 'module';
                s.src = '/static/pdf-annotator.js';
                document.body.appendChild(s);
              }
              }, 'PdfPageMapFormat');
            }, 'Exhibit');
          }, 'InkToolbar');
        }, 'DrawingEngine');
        }, 'DrawingEngine');
        }, 'InkStrokeFormat');
      }
      // Embedded Whiteboard
      if (extraScripts.indexOf('embedded-whiteboard.js') !== -1) {
        if (!document.querySelector('link[href="/static/embedded-whiteboard.css"]')) {
          var ewbLink = document.createElement('link');
          ewbLink.rel = 'stylesheet';
          ewbLink.href = '/static/embedded-whiteboard.css';
          document.head.appendChild(ewbLink);
        }
        ensureScriptLoaded('/static/core/ink-stroke-format.js', function() {
        ensureScriptLoaded('/static/drawing-engine-render.js', function() {
        ensureScriptLoaded('/static/drawing-engine.js', function() {
          ensureScriptLoaded('/static/embedded-whiteboard.js', function() {
            if (typeof window.initEmbeddedWhiteboard === 'function') window.initEmbeddedWhiteboard(spaContent);
          }, 'initEmbeddedWhiteboard');
        }, 'DrawingEngine');
        }, 'DrawingEngine');
        }, 'InkStrokeFormat');
      }
      // Inline PDF viewer
      if (extraScripts.indexOf('pdf-inline.js') !== -1) {
        if (!document.querySelector('link[href="/static/pdf-inline.css"]')) {
          var pdfInlineLink = document.createElement('link');
          pdfInlineLink.rel = 'stylesheet';
          pdfInlineLink.href = '/static/pdf-inline.css';
          document.head.appendChild(pdfInlineLink);
        }
        ensureScriptLoaded('/static/pdf-inline.js', function() {
          if (typeof window.initInlinePdfViewers === 'function') window.initInlinePdfViewers(spaContent);
        }, 'initInlinePdfViewers');
      }
    }

    function reinitializeContent() {
      // Re-highlight code blocks (also loads any missing extra-language
      // modules on demand, then runs the line-number wrap). Shared with the
      // initial page load via window._hljsInit defined in page.html.
      if (typeof window._hljsInit === 'function') {
        window._hljsInit(spaContent);
      }

      // Add copy-to-clipboard buttons to code blocks
      if (typeof window.enhanceCodeBlocks === 'function') {
        window.enhanceCodeBlocks(spaContent);
      }

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

      // Whiteboard/PDF/feature-grid content stays outside the shared
      // per-page registry below (owned by their own domains — out of
      // scope for this lifecycle unification).
      if (typeof window.initFeatureGrid === 'function') window.initFeatureGrid(spaContent);
      if (typeof window.initWhiteboard === 'function') window.initWhiteboard();
      if (typeof window.initEmbeddedWhiteboard === 'function') window.initEmbeddedWhiteboard(spaContent);
      if (typeof window.initInlinePdfViewers === 'function') window.initInlinePdfViewers(spaContent);
      if (typeof window.initPdfAnnotator === 'function') window.initPdfAnnotator();

      // Re-init per-page content enhancements (viewport rendering, table
      // sort/filter, syllabus DAG, comments, the quick-edit toggle's enabled
      // state, and the homepage greeting cycle) through the exact same
      // mountPageContentFeatures() helper used for the deferred
      // initial-load mount (see near the top of this file), so each
      // feature's mount/unmount pair is defined in exactly one place
      // instead of being duplicated as ad hoc reinitialize calls here.
      if (typeof window._mountPageContentFeatures === 'function') window._mountPageContentFeatures(spaContent);

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

    // Override search result navigation to use SPA
    var origResultsContainer = document.getElementById('search-results');
    if (origResultsContainer) {
      origResultsContainer.addEventListener('click', function(e) {
        var link = e.target.closest('.search-result-item');
        if (link && shouldIntercept(link)) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window._closeSearch === 'function') {
            window._closeSearch();
          }
          spaNavigate(link.pathname + link.search + link.hash);
        }
      }, true); // capture phase to run before existing handler
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
        if (!_liveReloadPending || document.hidden) return;
        if (navigating) {
          _liveReloadTimer = setTimeout(_runLiveReload, 100);
          return;
        }
        _liveReloadPending = false;
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
          if (document.hidden) { _fullReloadPending = true; return; }
          location.reload();
        });
      }

      if (!document.hidden) _sseConnect();

      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          // Release the persistent SSE connection to free a connection slot
          if (es) { es.close(); es = null; }
        } else {
          _sseConnect();
          if (_fullReloadPending) {
            _fullReloadPending = false;
            location.reload();
          } else if (_liveReloadPending) {
            _scheduleLiveReload();
          }
        }
      });

      addEventListener('beforeunload', function() { if (es) es.close(); });
    }

    // SPA health check: ping /api/health every 1s
    // 💓 (1F493) healthy, 💔 (1F494) unhealthy, 💛 (1F49B) unknown
    var healthDot = document.getElementById('spa-health-dot');
    if (healthDot) {
      var PING_INTERVAL = 1000;
      var UNHEALTHY_THRESHOLD = 5000;
      var healthTimeout = null;
      var healthGeneration = 0;
      var healthAbortController = null;
      var lastSuccessTime = Date.now();
      var currentState = 'unknown';
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
      var settingsGitVersion = document.getElementById('settings-git-version');

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

      function updateGitVersion(git) {
        if (!settingsGitVersion || !git || typeof git.commit !== 'string' || !git.commit) return;
        settingsGitVersion.textContent = git.commit;
        settingsGitVersion.classList.toggle('is-dirty', git.dirty === true);
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
          searchSwitch.disabled = false;
          var searchSection = searchSwitch.closest('.settings-panel-section');
          if (searchSection) searchSection.classList.remove('feature-disabled');
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
        healthGeneration++;
        if (healthAbortController) {
          try { healthAbortController.abort(); } catch (_) { /* noop */ }
          healthAbortController = null;
        }
      }

      function resumeHealthChecks() {
        stopHealthChecks();
        if (document.hidden) return;
        lastSuccessTime = Date.now();
        setState('unknown');
        checkHealth(healthGeneration);
      }

      var checkHealth = function(generation) {
        if (generation == null) generation = healthGeneration;
        if (document.hidden || generation !== healthGeneration) return;
        var fetchStart = Date.now();
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        healthAbortController = controller;
        var options = { method: 'GET', cache: 'no-cache' };
        if (controller) options.signal = controller.signal;
        fetch('/api/health', options)
          .then(function(r) {
            if (document.hidden || generation !== healthGeneration) return null;
            if (r.ok) {
              lastSuccessTime = Date.now();
              lastPingMs = Date.now() - fetchStart;
              setState('healthy');
              return r.json();
            } else {
              throw new Error('not ok');
            }
          })
          .then(function(data) {
            if (document.hidden || generation !== healthGeneration) return;
            if (data) {
              lastHealthData = data;
              updateGitVersion(data.git);
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
