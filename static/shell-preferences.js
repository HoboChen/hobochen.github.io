/**
 * features/shell/core/preferences.js — canonical `kb-display-prefs` display
 * preferences store.
 *
 * All display/appearance/editor preferences (theme, font, width, native
 * Jupyter mode, quick-edit toggle, link-preview settings, debug/log level,
 * terminal color scheme, etc.) are persisted as one JSON object under the
 * single `localStorage['kb-display-prefs']` key. This module is the single
 * owner of that key's read/merge/write semantics so every consumer (the
 * settings/theme panel, terminal, quick-edit, link-preview, and the client
 * logger) agrees on the same schema and never clobbers keys it doesn't know
 * about.
 *
 * The stored schema is unchanged from the historic ad-hoc
 * `JSON.parse(localStorage.getItem('kb-display-prefs') || '{}')` /
 * `localStorage.setItem('kb-display-prefs', JSON.stringify(...))` calls
 * this module replaces — `get()` returns the same shape those call sites
 * used to parse directly, and `set()` shallow-merges (rather than
 * overwriting) so unrelated keys are preserved.
 *
 * Exports `window.KbPreferences` (in a browser) / `module.exports` (in
 * Node) with `KEY`, `get`, `set`, `replace`, `parse`, `onError`.
 */
(function () {
  'use strict';

  var KEY = 'kb-display-prefs';
  var errorHandler = null;

  function reportError(source, err) {
    if (typeof errorHandler === 'function') {
      errorHandler(source, err);
      return;
    }
    var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    if (root && root._log && typeof root._log.error === 'function') {
      root._log.error('preferences', source + ': ' + String(err));
    }
  }

  /**
   * Safely parse a raw JSON string (e.g. a `storage` event's `newValue`)
   * into a prefs object. Never throws — returns `{}` for missing/invalid
   * input.
   */
  function parse(raw) {
    try {
      var value = JSON.parse(raw || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (err) {
      reportError('parse', err);
      return {};
    }
  }

  /**
   * Read the full current preferences object. Never throws.
   */
  function get() {
    try {
      return parse(localStorage.getItem(KEY));
    } catch (err) {
      // localStorage itself can throw (privacy mode, quota, etc.)
      reportError('get', err);
      return {};
    }
  }

  /**
   * Shallow-merge `patch` into the currently stored preferences and persist
   * the result. Returns the merged object (or the previous value, unchanged,
   * if the write failed).
   */
  function set(patch) {
    var current = get();
    var merged = Object.assign({}, current, patch || {});
    try {
      localStorage.setItem(KEY, JSON.stringify(merged));
      return merged;
    } catch (err) {
      reportError('set', err);
      return current;
    }
  }

  /**
   * Replace the entire stored object verbatim (no merge). Prefer `set()`
   * for incremental updates; `replace()` exists for callers (like the
   * settings panel's "save everything the panel currently knows about")
   * that intentionally reconstruct the full object themselves.
   */
  function replace(fullObject) {
    try {
      localStorage.setItem(KEY, JSON.stringify(fullObject || {}));
      return fullObject || {};
    } catch (err) {
      reportError('replace', err);
      return get();
    }
  }

  function onError(handler) {
    errorHandler = typeof handler === 'function' ? handler : null;
  }

  var api = {
    KEY: KEY,
    get: get,
    set: set,
    replace: replace,
    parse: parse,
    onError: onError,
  };

  if (typeof window !== 'undefined') window.KbPreferences = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
