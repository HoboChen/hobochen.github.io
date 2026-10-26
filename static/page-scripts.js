(function () {
  'use strict';

  function report(label, error) {
    if (window._log && typeof window._log.error === 'function') {
      window._log.error('reading', 'Page script ' + label + ' failed', String(error));
    } else {
      console.error('[PageScripts] ' + label + ' failed', error);
    }
  }

  function createScope(root, label) {
    var controller = new AbortController();
    var cleanups = [];
    var disposed = false;

    function clean(callback) {
      try { callback(); }
      catch (error) { report(label + ' cleanup', error); }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      while (cleanups.length) clean(cleanups.pop());
    }

    return {
      page: Object.freeze({
        root: root,
        signal: controller.signal,
        onDispose: function (callback) {
          if (typeof callback !== 'function') throw new TypeError('page.onDispose needs a function');
          if (disposed) clean(callback);
          else cleanups.push(callback);
        },
      }),
      dispose: dispose,
    };
  }

  function execute(source, scope) {
    if (source.hasAttribute('src')) {
      throw new Error('Page scripts must be inline; src is not supported');
    }

    // Inert source tags never execute during HTML parsing. A temporary classic
    // script runs their body on both initial load and SPA replacement, without
    // eval, a global bridge, or changing the source used by editing/export.
    var script = document.createElement('script');
    var executed = false;
    var failure;
    script.__rprintRun = function (run) {
      executed = true;
      try { run(scope.page); }
      catch (error) { failure = { error: error }; }
    };
    if (source.nonce) script.nonce = source.nonce;
    script.textContent = 'document.currentScript.__rprintRun(function (page) {\n'
      + '"use strict";\n' + source.textContent + '\n});';
    try {
      (document.head || document.documentElement).appendChild(script);
      if (!executed) throw new Error('Page script did not execute; check its syntax and Content Security Policy');
      if (failure) throw failure.error;
    } finally {
      script.remove();
      delete script.__rprintRun;
    }
  }

  function mount(root) {
    root = root || document;
    var sources = Array.from(root.querySelectorAll('script[type="application/rprint-page"]'));
    var scopes = [];
    sources.forEach(function (source, index) {
      var label = source.id ? '"' + source.id + '"' : '#' + (index + 1);
      var scope = createScope(root, label);
      try {
        execute(source, scope);
        scopes.push(scope);
      } catch (error) {
        report(label, error);
        scope.dispose();
      }
    });
    return function () {
      while (scopes.length) scopes.pop().dispose();
    };
  }

  if (!window.RprintPageModules) throw new Error('Page scripts requires module-browser.js');
  window.RprintPageModules.register({ id: 'reading.page-scripts', mount: mount });
})();
