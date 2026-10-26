/**
 * features/shell/core/lifecycle.js — canonical browser feature lifecycle
 * contract and registry.
 *
 * A "feature" is a plain object `{ name, mount(root, context) }` where
 * `mount` performs whatever DOM wiring (listeners, observers, timers) the
 * feature needs against `root`, and may return an `unmount()` function that
 * reverses it. Registering a feature does not run it — `mountAll()` runs
 * every registered feature's `mount` against the given root, and
 * `unmountAll()` (called automatically at the start of every `mountAll()`,
 * and available standalone) invokes each active feature's `unmount` in
 * registration order and clears mounted state.
 *
 * The same registry instance is meant to be reused across both the initial
 * page load and every subsequent SPA content replacement: calling
 * `mountAll(newRoot, context)` again first unmounts whatever the previous
 * `mountAll()` call mounted, then mounts fresh against `newRoot` — so
 * features never accumulate duplicate listeners/observers/timers across
 * navigations.
 *
 * Exports `window.ShellLifecycle` (in a browser) / `module.exports` (in
 * Node) with `createRegistry`.
 *
 * `src/client/shell/main.js` is now a thin adapter that delegates the browser
 * shell composition to `src/features/shell/client/app.js`, which uses this
 * registry (via the public `/static/shell-lifecycle.js` global) for both
 * its one-time "chrome" features and its per-navigation "content" features.
 */
(function () {
  'use strict';

  /**
   * Create a new, independent feature registry.
   */
  function createRegistry() {
    var features = new Map(); // name -> feature descriptor
    var active = new Map(); // name -> unmount fn (or null/undefined)
    var order = []; // registration order, for deterministic mount/unmount

    function register(feature) {
      if (!feature || typeof feature.mount !== 'function') {
        throw new Error('ShellLifecycle: feature must have a mount(root, context) function');
      }
      if (!feature.name || typeof feature.name !== 'string') {
        throw new Error('ShellLifecycle: feature must have a string name');
      }
      if (!features.has(feature.name)) order.push(feature.name);
      features.set(feature.name, feature);
      return feature;
    }

    function unregister(name) {
      if (active.has(name)) {
        var unmount = active.get(name);
        active.delete(name);
        if (typeof unmount === 'function') unmount();
      }
      features.delete(name);
      var idx = order.indexOf(name);
      if (idx !== -1) order.splice(idx, 1);
    }

    /**
     * Unmount every currently-active feature, in reverse registration
     * order (so later-mounted features — which may depend on earlier
     * ones — are torn down first). Safe to call repeatedly; a feature
     * whose mount() didn't return an unmount function is simply skipped.
     */
    function unmountAll() {
      for (var i = order.length - 1; i >= 0; i--) {
        var name = order[i];
        if (!active.has(name)) continue;
        var unmount = active.get(name);
        active.delete(name);
        if (typeof unmount === 'function') {
          try {
            unmount();
          } catch (err) {
            reportError(name, err);
          }
        }
      }
      active.clear();
    }

    var errorHandler = null;
    function reportError(name, err) {
      if (typeof errorHandler === 'function') {
        errorHandler(name, err);
      } else if (typeof console !== 'undefined' && console.error) {
        console.error('[ShellLifecycle] feature "' + name + '" failed', err);
      }
    }

    /**
     * Unmount whatever is currently active, then mount every registered
     * feature (in registration order) against `root`/`context`. Returns
     * the list of feature names that mounted successfully.
     */
    function mountAll(root, context) {
      unmountAll();
      var mounted = [];
      for (var i = 0; i < order.length; i++) {
        var name = order[i];
        var feature = features.get(name);
        if (!feature) continue;
        try {
          var unmount = feature.mount(root, context);
          active.set(name, typeof unmount === 'function' ? unmount : null);
          mounted.push(name);
        } catch (err) {
          reportError(name, err);
        }
      }
      return mounted;
    }

    function isMounted(name) {
      return active.has(name);
    }

    function names() {
      return order.slice();
    }

    function onError(handler) {
      errorHandler = typeof handler === 'function' ? handler : null;
    }

    return {
      register: register,
      unregister: unregister,
      mountAll: mountAll,
      unmountAll: unmountAll,
      isMounted: isMounted,
      names: names,
      onError: onError,
    };
  }

  var api = { createRegistry: createRegistry };

  if (typeof window !== 'undefined') window.ShellLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
