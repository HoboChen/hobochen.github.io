(function() {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var LONG_PAGE_THRESHOLD = 100;
  var PRELOAD_VIEWPORTS = 2;
  var TARGET_ALIGNMENT_DELAYS = [100, 300, 700, 1500, 3000];
  var SMOOTH_TARGET_ALIGNMENT_DELAYS = [700, 1500, 3000];
  var SVG_EXCLUDE_SELECTOR = [
    '.math',
    '.katex',
    'pre.mermaid',
    'button',
    'a',
    '[role="button"]',
    '.th-trigger',
    '.code-copy-btn',
    '.katex-context-menu',
    '.embedded-whiteboard',
    '.whiteboard-app',
    '.whiteboard-canvas',
    '.pdf-inline-viewer',
    '.pdf-annotator',
    '.pdfa-tx-region',
    '.notebook-cell',
    '.syllabus-enhance'
  ].join(', ');
  var activeState = null;
  var mountGeneration = 0;
  var renderSerial = 0;
  var libraryStatus = {
    katex: 'loading',
    mermaid: 'loading'
  };

  function reportError(message, error) {
    var detail = error && error.message ? error.message : String(error || '');
    if (window._log && typeof window._log.error === 'function') {
      window._log.error('render-on-demand', message, detail);
    }
    if (window.console && typeof window.console.error === 'function') {
      window.console.error('[render-on-demand] ' + message, error || '');
    }
  }

  function contentScope(root) {
    var scope = root || document;
    if (scope.nodeType === 9) {
      return scope.getElementById('spa-content')
        || scope.querySelector('.article')
        || scope;
    }
    return scope;
  }

  function scopeContains(scope, node) {
    if (!scope || !node) return false;
    if (scope.nodeType === 9) return scope.documentElement.contains(node);
    return scope === node || scope.contains(node);
  }

  function currentTheme() {
    if (typeof document === 'undefined' || !document.documentElement) return 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function candidateState(el) {
    return el.getAttribute('data-rprint-render-state') || '';
  }

  function setCandidateState(el, value) {
    el.setAttribute('data-rprint-render-state', value);
  }

  function markPending(el) {
    setCandidateState(el, 'pending');
    el.classList.add('rprint-render-pending');
  }

  function markRendered(el) {
    setCandidateState(el, 'rendered');
    el.classList.remove('rprint-render-pending');
    el.classList.remove('rprint-render-failed');
    if (el.classList.contains('math')) el.style.opacity = '1';
  }

  function markFailed(el) {
    setCandidateState(el, 'failed');
    el.classList.remove('rprint-render-pending');
    el.classList.add('rprint-render-failed');
    if (el.classList.contains('math')) el.style.opacity = '1';
  }

  function isAuthoredSvg(svg) {
    if (!svg || !svg.closest) return false;
    if (svg.closest('.tikz-block, .svg-theme-preview[data-svg-theme]')) return true;
    return !svg.closest(SVG_EXCLUDE_SELECTOR);
  }

  function prepareCandidate(candidates, el, kind) {
    if (!el || candidates.has(el)) return false;
    if (kind === 'math') {
      if (!el.hasAttribute('data-latex')) el.setAttribute('data-latex', el.textContent || '');
    } else if (kind === 'mermaid') {
      if (!el.hasAttribute('data-mermaid-source')) {
        var code = el.querySelector('code');
        var source = code ? code.textContent : el.textContent;
        el.setAttribute('data-mermaid-source', source || '');
        el.textContent = source || '';
      }
    } else if (kind === 'svg' && !isAuthoredSvg(el)) {
      return false;
    }

    candidates.set(el, kind);
    if (candidateState(el) === 'rendered') return true;
    if (kind === 'math' && el.querySelector('.katex')) {
      markRendered(el);
    } else if (kind === 'mermaid' && el.querySelector('svg')) {
      markRendered(el);
    } else {
      markPending(el);
    }
    return true;
  }

  function collectCandidates(scope) {
    var candidates = new Map();
    scope.querySelectorAll('.math').forEach(function(el) {
      prepareCandidate(candidates, el, 'math');
    });
    scope.querySelectorAll('pre.mermaid').forEach(function(el) {
      prepareCandidate(candidates, el, 'mermaid');
    });
    scope.querySelectorAll('svg').forEach(function(svg) {
      prepareCandidate(candidates, svg, 'svg');
    });
    return candidates;
  }

  function katexTrust(context) {
    return context
      && context.command === '\\href'
      && typeof context.url === 'string'
      && /^#[A-Za-z0-9:._-]+$/.test(context.url);
  }

  function renderMath(state, el) {
    if (libraryStatus.katex === 'failed') {
      markFailed(el);
      return 'failed';
    }
    if (!window.katex || typeof window.katex.render !== 'function') return 'waiting';

    setCandidateState(el, 'rendering');
    try {
      window.katex.render(el.getAttribute('data-latex') || '', el, {
        displayMode: el.classList.contains('display'),
        throwOnError: false,
        trust: katexTrust
      });
      el.querySelectorAll('mtable[columnspacing=""]').forEach(function(table) {
        table.removeAttribute('columnspacing');
      });
      markRendered(el);
      return 'rendered';
    } catch (error) {
      markFailed(el);
      reportError('KaTeX formula render failed', error);
      return 'failed';
    }
  }

  function renderSvg(state, svg) {
    if (typeof window.applySvgThemeToElement !== 'function') {
      markFailed(svg);
      reportError('SVG theme renderer is unavailable');
      return 'failed';
    }
    setCandidateState(svg, 'rendering');
    try {
      window.applySvgThemeToElement(svg);
      markRendered(svg);
      return 'rendered';
    } catch (error) {
      markFailed(svg);
      reportError('SVG theme render failed', error);
      return 'failed';
    }
  }

  function themedMermaidSource(source, theme) {
    var mermaidTheme = theme === 'dark' ? 'dark' : 'default';
    return '%%{init: {"theme": "' + mermaidTheme + '"}}%%\n' + source;
  }

  function renderMermaid(state, el) {
    if (libraryStatus.mermaid === 'failed') {
      markFailed(el);
      return 'failed';
    }
    if (!window.mermaid || typeof window.mermaid.render !== 'function') return 'waiting';

    var hadRenderedOutput = !!el.querySelector('svg');
    var token = (state.mermaidTokens.get(el) || 0) + 1;
    var theme = currentTheme();
    var source = el.getAttribute('data-mermaid-source') || '';
    var id = 'mermaid-lazy-' + (++renderSerial);
    state.mermaidTokens.set(el, token);
    state.activatedMermaids.add(el);
    setCandidateState(el, 'rendering');

    try {
      window.mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
      Promise.resolve(window.mermaid.render(id, themedMermaidSource(source, theme))).then(function(result) {
        if (!state.active
            || activeState !== state
            || state.mermaidTokens.get(el) !== token
            || !scopeContains(state.scope, el)) {
          return;
        }
        if (!result || typeof result.svg !== 'string') {
          if (hadRenderedOutput) {
            markRendered(el);
          } else {
            markFailed(el);
          }
          reportError('Mermaid returned an invalid render result');
          return;
        }
        el.innerHTML = result.svg;
        if (typeof result.bindFunctions === 'function') result.bindFunctions(el);
        markRendered(el);
      }, function(error) {
        if (!state.active
            || activeState !== state
            || state.mermaidTokens.get(el) !== token
            || !scopeContains(state.scope, el)) {
          return;
        }
        if (hadRenderedOutput) {
          markRendered(el);
        } else {
          el.textContent = source;
          markFailed(el);
        }
        reportError('Mermaid diagram render failed', error);
      });
    } catch (error) {
      if (hadRenderedOutput) {
        markRendered(el);
      } else {
        el.textContent = source;
        markFailed(el);
      }
      reportError('Mermaid diagram render failed', error);
      return hadRenderedOutput ? 'rendered' : 'failed';
    }
    return 'started';
  }

  function renderCandidate(state, el) {
    if (!state.active || !scopeContains(state.scope, el)) return 'stale';
    var kind = state.candidates.get(el);
    if (!kind) return 'stale';
    if (candidateState(el) === 'rendered' && kind !== 'mermaid') return 'rendered';
    if (kind === 'math') return renderMath(state, el);
    if (kind === 'mermaid') return renderMermaid(state, el);
    return renderSvg(state, el);
  }

  function stopObserving(state, el) {
    state.readyBand.delete(el);
    if (state.observer) state.observer.unobserve(el);
  }

  function activateCandidate(state, el) {
    var result = renderCandidate(state, el);
    if (result !== 'waiting') stopObserving(state, el);
  }

  function rootMargin() {
    return Math.max(1, Math.round((window.innerHeight || 800) * PRELOAD_VIEWPORTS)) + 'px 0px';
  }

  function installObserver(state) {
    state.rootMargin = rootMargin();
    state.observer = new window.IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!state.active || !state.candidates.has(entry.target)) return;
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          state.readyBand.add(entry.target);
          activateCandidate(state, entry.target);
        } else {
          state.readyBand.delete(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: state.rootMargin,
      threshold: 0
    });

    state.candidates.forEach(function(kind, el) {
      var status = candidateState(el);
      if (status !== 'rendered' && status !== 'failed') state.observer.observe(el);
    });
  }

  function renderAll(state) {
    state.candidates.forEach(function(kind, el) {
      if (candidateState(el) !== 'rendered') activateCandidate(state, el);
    });
  }

  function renderForPrint(state) {
    if (!state || !state.active) return;
    renderAll(state);
  }

  function renderReadyKind(state, kind) {
    if (state.mode === 'eager') {
      state.candidates.forEach(function(candidateKind, el) {
        if (candidateKind === kind && candidateState(el) !== 'rendered') activateCandidate(state, el);
      });
      return;
    }
    Array.from(state.readyBand).forEach(function(el) {
      if (state.candidates.get(el) === kind) activateCandidate(state, el);
    });
  }

  function failPendingKind(state, kind) {
    state.candidates.forEach(function(candidateKind, el) {
      if (candidateKind !== kind) return;
      var status = candidateState(el);
      if (status === 'pending' || status === 'rendering') {
        if (kind === 'mermaid') {
          state.mermaidTokens.set(el, (state.mermaidTokens.get(el) || 0) + 1);
          el.textContent = el.getAttribute('data-mermaid-source') || '';
        }
        markFailed(el);
        stopObserving(state, el);
      }
    });
  }

  function refreshTheme(state) {
    if (!state || !state.active) return;
    if (typeof document === 'undefined' || !document.documentElement) return;
    var theme = currentTheme();
    if (state.lastTheme === theme) return;
    state.lastTheme = theme;

    state.candidates.forEach(function(kind, el) {
      if (!scopeContains(state.scope, el)) return;
      if (kind === 'svg' && candidateState(el) === 'rendered') {
        renderSvg(state, el);
      } else if (kind === 'mermaid'
          && state.activatedMermaids.has(el)
          && (candidateState(el) === 'rendered' || candidateState(el) === 'rendering')) {
        renderMermaid(state, el);
      }
    });
  }

  function installThemeObserver(state) {
    if (typeof window.MutationObserver !== 'function') return;
    state.themeObserver = new window.MutationObserver(function() {
      refreshTheme(state);
    });
    state.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  function candidateElementsInNode(node, selector) {
    var elements = [];
    if (node.matches && node.matches(selector)) elements.push(node);
    if (node.querySelectorAll) {
      node.querySelectorAll(selector).forEach(function(el) { elements.push(el); });
    }
    return elements;
  }

  function registerAddedCandidate(state, el, kind) {
    if (!state.active || !scopeContains(state.scope, el)) return;
    if (!prepareCandidate(state.candidates, el, kind)) return;
    if (candidateState(el) === 'rendered') return;
    if (state.mode === 'lazy' && state.observer) {
      state.observer.observe(el);
    } else {
      activateCandidate(state, el);
    }
  }

  function installContentObserver(state) {
    if (typeof window.MutationObserver !== 'function') return;
    state.contentObserver = new window.MutationObserver(function(mutations) {
      if (!state.active) return;
      mutations.forEach(function(mutation) {
        Array.from(mutation.addedNodes || []).forEach(function(node) {
          if (!node || node.nodeType !== 1) return;
          candidateElementsInNode(node, '.math').forEach(function(el) {
            registerAddedCandidate(state, el, 'math');
          });
          candidateElementsInNode(node, 'pre.mermaid').forEach(function(el) {
            registerAddedCandidate(state, el, 'mermaid');
          });
          candidateElementsInNode(node, 'svg').forEach(function(el) {
            registerAddedCandidate(state, el, 'svg');
          });
        });
      });
    });
    state.contentObserver.observe(state.scope, { childList: true, subtree: true });
  }

  function installResizeHandler(state) {
    state.onResize = function() {
      if (!state.active || state.mode !== 'lazy') return;
      if (state.resizeTimer !== null) window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(function() {
        state.resizeTimer = null;
        if (!state.active) return;
        if (state.observer) state.observer.disconnect();
        state.readyBand.clear();
        installObserver(state);
      }, 150);
    };
    window.addEventListener('resize', state.onResize);
  }

  function installPrintHandlers(state) {
    state.onBeforePrint = function() {
      renderForPrint(state);
    };
    window.addEventListener('beforeprint', state.onBeforePrint);
    if (typeof window.matchMedia !== 'function') return;
    state.printMedia = window.matchMedia('print');
    state.onPrintMediaChange = function(event) {
      if (event.matches) renderForPrint(state);
    };
    if (state.printMedia && typeof state.printMedia.addEventListener === 'function') {
      state.printMedia.addEventListener('change', state.onPrintMediaChange);
    } else if (state.printMedia && typeof state.printMedia.addListener === 'function') {
      state.printMedia.addListener(state.onPrintMediaChange);
    }
  }

  function clearTargetAlignmentWork(state) {
    state.targetAlignmentTimers.forEach(function(timer) {
      window.clearTimeout(timer);
    });
    state.targetAlignmentTimers = [];
    if (state.targetAlignmentCorrectionTimer !== null) {
      window.clearTimeout(state.targetAlignmentCorrectionTimer);
      state.targetAlignmentCorrectionTimer = null;
    }
    if (state.targetAlignmentFrame !== null) {
      window.cancelAnimationFrame(state.targetAlignmentFrame);
      state.targetAlignmentFrame = null;
    }
    if (state.targetAlignmentObserver) {
      state.targetAlignmentObserver.disconnect();
      state.targetAlignmentObserver = null;
    }
  }

  function releaseTargetAlignment(state) {
    if (!state
        || (!state.targetAlignmentActive
          && state.targetAlignmentFrame === null
          && state.targetAlignmentTimers.length === 0
          && state.targetAlignmentCorrectionTimer === null
          && !state.targetAlignmentObserver)) {
      return;
    }
    state.targetAlignmentActive = false;
    clearTargetAlignmentWork(state);
  }

  function targetFromHash(hash) {
    if (!hash || !window.document) return null;
    var id;
    try { id = decodeURIComponent(hash.replace(/^#/, '')); }
    catch (error) { id = hash.replace(/^#/, ''); }
    return id ? window.document.getElementById(id) : null;
  }

  function targetScrollOffset() {
    if (typeof window.getComputedStyle === 'function') {
      var value = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop);
      if (Number.isFinite(value)) return value;
    }
    var banner = document.querySelector('.top-banner');
    return (banner && !document.body.classList.contains('banner-folded') ? banner.offsetHeight : 0) + 16;
  }

  function alignTargetNow(state, behavior) {
    if (!state.active || !state.targetAlignmentActive) return;
    var target = targetFromHash(state.targetAlignmentHash);
    if (!target || !scopeContains(state.scope, target)) {
      releaseTargetAlignment(state);
      return;
    }
    var top = target.getBoundingClientRect().top
      + (window.scrollY || window.pageYOffset || 0)
      - targetScrollOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: behavior || 'auto' });
  }

  function scheduleTargetCorrection(state) {
    if (!state.targetAlignmentActive) return;
    if (state.targetAlignmentCorrectionTimer !== null) {
      window.clearTimeout(state.targetAlignmentCorrectionTimer);
    }
    state.targetAlignmentCorrectionTimer = window.setTimeout(function() {
      state.targetAlignmentCorrectionTimer = null;
      alignTargetNow(state, 'auto');
    }, state.targetAlignmentBehavior === 'smooth' ? 600 : 0);
  }

  function startTargetAlignment(state, hash, behavior) {
    if (!state || !state.active || !hash || !window.document) return false;
    var target = targetFromHash(hash);
    if (!target || !scopeContains(state.scope, target)) return false;

    releaseTargetAlignment(state);
    state.targetAlignmentActive = true;
    state.targetAlignmentHash = hash;
    state.targetAlignmentBehavior = behavior === 'smooth' ? 'smooth' : 'auto';
    alignTargetNow(state, state.targetAlignmentBehavior);

    var delays = state.targetAlignmentBehavior === 'smooth'
      ? SMOOTH_TARGET_ALIGNMENT_DELAYS
      : TARGET_ALIGNMENT_DELAYS;
    delays.forEach(function(delay, index) {
      state.targetAlignmentTimers.push(window.setTimeout(function() {
        alignTargetNow(state, 'auto');
        if (index === delays.length - 1) releaseTargetAlignment(state);
      }, delay));
    });

    if (typeof window.ResizeObserver === 'function') {
      state.targetAlignmentObserver = new window.ResizeObserver(function() {
        scheduleTargetCorrection(state);
      });
      state.targetAlignmentObserver.observe(target);
      var article = document.querySelector('.article');
      if (article && article !== target) state.targetAlignmentObserver.observe(article);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function() {
        if (state.active && state.targetAlignmentActive) scheduleTargetCorrection(state);
      }).catch(function() {});
    }
    return true;
  }

  function releaseTargetAlignmentOnKey(state, event) {
    if (event.key === 'ArrowUp'
        || event.key === 'ArrowDown'
        || event.key === 'PageUp'
        || event.key === 'PageDown'
        || event.key === 'Home'
        || event.key === 'End'
        || event.key === ' '
        || event.key === 'Spacebar') {
      releaseTargetAlignment(state);
    }
  }

  function installTargetAlignment(state) {
    if (document.documentElement.classList.contains('link-preview-embed')) return;
    state.onTargetScrollIntent = function() {
      releaseTargetAlignment(state);
    };
    state.onTargetAlignmentKey = function(event) {
      releaseTargetAlignmentOnKey(state, event);
    };
    state.onHashChange = function() {
      startTargetAlignment(state, window.location.hash, 'auto');
    };
    document.addEventListener('wheel', state.onTargetScrollIntent, { passive: true, capture: true });
    document.addEventListener('touchstart', state.onTargetScrollIntent, { passive: true, capture: true });
    document.addEventListener(
      typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown',
      state.onTargetScrollIntent,
      true
    );
    document.addEventListener('keydown', state.onTargetAlignmentKey, true);
    window.addEventListener('hashchange', state.onHashChange);
    var initialHash = window.location.hash;
    if (initialHash) {
      state.targetAlignmentFrame = window.requestAnimationFrame(function() {
        state.targetAlignmentFrame = null;
        startTargetAlignment(state, initialHash, 'auto');
      });
    }
  }

  function disposeState(state) {
    if (!state || !state.active) return;
    releaseTargetAlignment(state);
    state.active = false;
    if (state.observer) state.observer.disconnect();
    if (state.themeObserver) state.themeObserver.disconnect();
    if (state.contentObserver) state.contentObserver.disconnect();
    if (state.onResize) window.removeEventListener('resize', state.onResize);
    if (state.onBeforePrint) window.removeEventListener('beforeprint', state.onBeforePrint);
    if (state.printMedia && state.onPrintMediaChange) {
      if (typeof state.printMedia.removeEventListener === 'function') {
        state.printMedia.removeEventListener('change', state.onPrintMediaChange);
      } else if (typeof state.printMedia.removeListener === 'function') {
        state.printMedia.removeListener(state.onPrintMediaChange);
      }
    }
    if (state.onTargetScrollIntent) {
      document.removeEventListener('wheel', state.onTargetScrollIntent, true);
      document.removeEventListener('touchstart', state.onTargetScrollIntent, true);
      document.removeEventListener(
        typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown',
        state.onTargetScrollIntent,
        true
      );
    }
    if (state.onTargetAlignmentKey) {
      document.removeEventListener('keydown', state.onTargetAlignmentKey, true);
    }
    if (state.onHashChange) window.removeEventListener('hashchange', state.onHashChange);
    if (state.resizeTimer !== null) window.clearTimeout(state.resizeTimer);
    state.readyBand.clear();
    state.mermaidTokens.clear();
    if (activeState === state) activeState = null;
  }

  function init(root) {
    var scope = contentScope(root);
    if (!scope || !scope.querySelectorAll) return undefined;
    if (activeState && activeState.active && activeState.scope === scope) {
      var mountedState = activeState;
      return function disposeMountedRenderOnDemand() {
        disposeState(mountedState);
      };
    }
    if (activeState) disposeState(activeState);

    var candidates = collectCandidates(scope);
    var canObserve = typeof window.IntersectionObserver === 'function';
    var state = {
      active: true,
      generation: ++mountGeneration,
      scope: scope,
      candidates: candidates,
      mode: candidates.size >= LONG_PAGE_THRESHOLD && canObserve ? 'lazy' : 'eager',
      rootMargin: '',
      observer: null,
      themeObserver: null,
      contentObserver: null,
      readyBand: new Set(),
      activatedMermaids: new Set(),
      mermaidTokens: new Map(),
      resizeTimer: null,
      onResize: null,
      onBeforePrint: null,
      printMedia: null,
      onPrintMediaChange: null,
      targetAlignmentActive: false,
      targetAlignmentHash: '',
      targetAlignmentBehavior: 'auto',
      targetAlignmentTimers: [],
      targetAlignmentCorrectionTimer: null,
      targetAlignmentFrame: null,
      targetAlignmentObserver: null,
      onTargetScrollIntent: null,
      onTargetAlignmentKey: null,
      onHashChange: null,
      lastTheme: currentTheme()
    };
    activeState = state;
    candidates.forEach(function(kind, el) {
      if (kind === 'mermaid' && candidateState(el) === 'rendered') {
        state.activatedMermaids.add(el);
      }
    });

    installThemeObserver(state);
    installContentObserver(state);
    installResizeHandler(state);
    installPrintHandlers(state);
    if (state.mode === 'lazy') {
      installObserver(state);
    } else {
      renderAll(state);
    }
    installTargetAlignment(state);

    return function disposeRenderOnDemand() {
      disposeState(state);
    };
  }

  function libraryReady(name) {
    if (name !== 'katex' && name !== 'mermaid') return;
    libraryStatus[name] = 'ready';
    if (activeState) renderReadyKind(activeState, name === 'katex' ? 'math' : 'mermaid');
  }

  function libraryFailed(name, error) {
    if (name !== 'katex' && name !== 'mermaid') return;
    libraryStatus[name] = 'failed';
    reportError(name + ' library failed to load', error);
    if (activeState) failPendingKind(activeState, name === 'katex' ? 'math' : 'mermaid');
  }

  function getStatus() {
    if (!activeState) return null;
    var counts = {
      total: activeState.candidates.size,
      pending: 0,
      rendering: 0,
      rendered: 0,
      failed: 0
    };
    activeState.candidates.forEach(function(kind, el) {
      var status = candidateState(el) || 'pending';
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    });
    return {
      mode: activeState.mode,
      threshold: LONG_PAGE_THRESHOLD,
      preloadViewports: PRELOAD_VIEWPORTS,
      rootMargin: activeState.rootMargin,
      counts: counts
    };
  }

  window.RenderOnDemand = {
    init: init,
    libraryReady: libraryReady,
    libraryFailed: libraryFailed,
    alignHashTarget: function(hash, behavior) {
      return startTargetAlignment(activeState, hash, behavior);
    },
    refreshTheme: function() { refreshTheme(activeState); },
    getStatus: getStatus
  };

  function initializeDocument() {
    if (!activeState) init(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDocument, { once: true });
  } else {
    initializeDocument();
  }
})();
