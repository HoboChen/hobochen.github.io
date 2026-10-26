/**
 * Browser contributions register once; a document host calls mountPage(root)
 * after source capture, on initial load and after each content replacement.
 * disposePage() releases the active page. There is no implicit DOM-ready mount.
 */
(function () {
  'use strict';

  if (!window.ShellLifecycle || typeof window.ShellLifecycle.createRegistry !== 'function') {
    throw new Error('RprintPageModules requires shell-lifecycle.js before module-browser.js');
  }

  var registry = window.ShellLifecycle.createRegistry();
  var contributions = new Map();
  var dirty = false;

  registry.onError(function (id, error) {
    if (window._log && typeof window._log.error === 'function') {
      window._log.error('modules', 'Browser module "' + id + '" failed', String(error));
    } else {
      console.error('[RprintPageModules] module "' + id + '" failed', error);
    }
  });

  function register(contribution) {
    if (!contribution || typeof contribution.id !== 'string' || !contribution.id.trim()
      || typeof contribution.mount !== 'function') {
      throw new Error('RprintPageModules: contribution needs an id and mount(root, context)');
    }
    if (contributions.has(contribution.id)) {
      throw new Error('RprintPageModules: duplicate module "' + contribution.id + '"');
    }
    var after = contribution.after === undefined ? [] : contribution.after;
    if (!Array.isArray(after) || after.some(function (id) {
      return typeof id !== 'string' || !id.trim();
    })) {
      throw new Error('RprintPageModules: invalid ordering for "' + contribution.id + '"');
    }
    contributions.set(contribution.id, {
      id: contribution.id,
      mount: contribution.mount,
      after: after.slice(),
    });
    dirty = true;
    return contribution;
  }

  // `after` orders contributions when present; it does not enable an absent
  // module or make independently useful enhancements depend on each other.
  function orderedIds() {
    var pending = Array.from(contributions.keys()).sort();
    var ordered = [];
    while (pending.length) {
      var index = pending.findIndex(function (id) {
        return contributions.get(id).after.every(function (dependency) {
          return !contributions.has(dependency) || ordered.indexOf(dependency) !== -1;
        });
      });
      if (index === -1) {
        throw new Error('RprintPageModules: ordering cycle involving ' + pending.join(', '));
      }
      ordered.push(pending.splice(index, 1)[0]);
    }
    return ordered;
  }

  function mountPage(root, context) {
    if (dirty) {
      registry.unmountAll();
      var ids = orderedIds();
      registry.names().forEach(registry.unregister);
      ids.forEach(function (id) {
        registry.register({ name: id, mount: contributions.get(id).mount });
      });
      dirty = false;
    }
    return registry.mountAll(root || document, context);
  }

  window.RprintPageModules = Object.freeze({
    register: register,
    mountPage: mountPage,
    disposePage: registry.unmountAll,
    names: orderedIds,
    isMounted: registry.isMounted,
  });
})();
