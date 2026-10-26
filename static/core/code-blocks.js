/**
 * code-blocks.js — canonical owner of code-block *source*, independent of
 * whatever presentation transform (highlight.js syntax spans, the
 * line-number `.code-line` wrapper) has since been applied to the element.
 *
 * Background: `src/client/shell/page.html`'s highlighter used to rewrap a
 * `<code>` element's highlighted HTML into one `<span class="code-line">`
 * per line and `.join('')` the result — which drops the newline text nodes
 * between lines. Any consumer that later read `code.textContent` (the
 * syllabus YAML parser, in particular) got every line concatenated onto one
 * line. That is invisible for ordinary code (still displays correctly; only
 * copy-to-clipboard or a text parser notices), but for a parser that treats
 * the block's serialized source as the literal document, it silently
 * corrupts the content — and, since SPA navigation now consistently
 * highlights *before* mounting page-scoped features, hits every internal
 * navigation into a syllabus page rather than only occasionally.
 *
 * This module captures each `<code>` element's original source text before
 * any transform runs, and is the single place that later hands that source
 * back out — to the syllabus parser, to the copy-to-clipboard button, and to
 * any other consumer that needs the block's real content rather than its
 * decorated DOM. It also owns the two DOM transforms themselves (per-token
 * language resolution + idempotent line wrapping) and a small scoped
 * highlight helper, so `page.html`, `shell-router.js`'s SPA mount,
 * `translate-overlay-fit.js`'s PDF-translation code boxes and the OCR pane
 * controller all share one implementation instead of three independent
 * copies with independently-discovered bugs.
 *
 * Dual CommonJS/browser module (see src/features/reading/core/syllabus-spec.js
 * for the same pattern) so it can be `require()`d by Node-side tests and
 * loaded as a classic `<script>` by every runtime that serves
 * CLIENT_ASSET_SOURCES (src/features/shell/client-assets.js).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodeBlocks = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Original source text, keyed by <code> element, captured before the first
  // highlight/line-wrap transform touches it. A WeakMap so detached elements
  // (an outgoing SPA page's content) are never kept alive by this cache.
  var sourceByElement = typeof WeakMap === 'function' ? new WeakMap() : null;

  /**
   * Compute `code`'s raw source text as it currently stands in the DOM,
   * ignoring any previously captured snapshot:
   *   1. if the element was already line-wrapped by some other path (e.g. a
   *      page whose cached HTML predates this module, or a `.code-line`-
   *      wrapped fixture built directly by a test), reconstruct it by
   *      joining each line's own textContent with '\n' rather than reading
   *      the parent's concatenated textContent (which has no separators
   *      between lines and would silently drop every newline);
   *   2. otherwise, the element's plain (untouched) textContent.
   */
  function computeCurrentSource(code) {
    var lines = code.querySelectorAll ? code.querySelectorAll('.code-line') : null;
    if (lines && lines.length) {
      var parts = [];
      for (var i = 0; i < lines.length; i++) parts.push(lines[i].textContent);
      return parts.join('\n');
    }
    return code.textContent || '';
  }

  /**
   * Record `code`'s current source as its canonical snapshot, the first
   * time this is called for that element. Safe (and a no-op) to call again
   * later, including after highlighting/wrapping — it never overwrites an
   * already-captured source with a possibly-decorated one. Uses the same
   * `.code-line`-aware reconstruction as `readSource`'s fallback so a block
   * that arrives *already* line-wrapped (e.g. legacy cached HTML predating
   * this module) is captured correctly instead of having its newlines
   * permanently collapsed into the cached snapshot.
   */
  function captureSource(code) {
    if (!code || !sourceByElement || sourceByElement.has(code)) return;
    sourceByElement.set(code, computeCurrentSource(code));
  }

  /**
   * Read `code`'s best-known original source text: the captured snapshot if
   * `captureSource` ran for this element, otherwise the same `.code-line`-
   * aware reconstruction `captureSource` itself would have used.
   */
  function readSource(code) {
    if (!code) return '';
    if (sourceByElement && sourceByElement.has(code)) return sourceByElement.get(code);
    return computeCurrentSource(code);
  }

  function languageAlias(token, aliases) {
    return Object.prototype.hasOwnProperty.call(aliases, token) ? (aliases[token] || token) : token;
  }

  /**
   * Resolve a highlight.js language name out of a `<pre>`'s className.
   * Pandoc source blocks normally carry one language token, but this treats
   * the className as a whitespace-separated token list (rather than one
   * opaque string) so a block with extra classes still resolves correctly:
   * `aliasMap` maps a token to its actual module/language name (e.g. the
   * page's `_HLJS_ALIAS`), and `isKnownLanguage` (typically
   * `hljs.getLanguage`) picks the first token that resolves to a real
   * language, falling back to the first token verbatim.
   */
  function resolveLanguage(rawClassName, aliasMap, isKnownLanguage) {
    var tokens = (rawClassName || '').trim().length ? rawClassName.trim().split(/\s+/) : [];
    aliasMap = aliasMap || {};
    var first = null;
    for (var i = 0; i < tokens.length; i++) {
      var candidate = languageAlias(tokens[i], aliasMap);
      if (first === null) first = candidate;
      if (typeof isKnownLanguage !== 'function' || isKnownLanguage(candidate)) return candidate;
    }
    return first || '';
  }

  /**
   * Decide which (if any) on-demand language module a `<pre>`'s className
   * needs fetched before it can be highlighted, tokenizing the className the
   * same way `resolveLanguage` does rather than treating it as one opaque
   * string. This matters for real Pandoc fenced-code-block output, which
   * emits multiple classes (`class="sourceCode julia numberLines"`), not
   * just the bare language name `page.html`'s loader used to assume.
   *
   * Returns null when nothing needs fetching: either no token names a
   * language at all, or `isKnownLanguage` already recognizes one of the
   * tokens (core-bundled or a previously-loaded on-demand module) — in
   * which case `resolveLanguage` will pick it correctly once actually
   * highlighting. Otherwise returns the first token (alias-mapped) that
   * `isAllowed` recognizes as a fetchable on-demand language, so the caller
   * can fetch that module and only then re-resolve/highlight.
   */
  function resolvePrefetchLanguage(rawClassName, aliasMap, isKnownLanguage, isAllowed) {
    var tokens = (rawClassName || '').trim().length ? rawClassName.trim().split(/\s+/) : [];
    aliasMap = aliasMap || {};
    var candidateToFetch = null;
    for (var i = 0; i < tokens.length; i++) {
      var candidate = languageAlias(tokens[i], aliasMap);
      if (typeof isKnownLanguage === 'function' && isKnownLanguage(candidate)) return null;
      if (candidateToFetch === null && typeof isAllowed === 'function' && isAllowed(candidate)) {
        candidateToFetch = candidate;
      }
    }
    return candidateToFetch;
  }

  /**
   * Wrap `code`'s current (highlighted) innerHTML into one
   * `<span class="code-line">` per line, carrying any still-open
   * highlight.js `<span>` across the line break so each line's markup stays
   * balanced. Idempotent: a no-op if `code` is already wrapped. This changes
   * only display structure — `readSource`/`captureSource` are what keep the
   * real source text available afterwards, so this never needs to preserve
   * newlines itself.
   */
  function wrapLines(code) {
    if (!code || code.querySelector('.code-line')) return;
    captureSource(code);
    var html = code.innerHTML;
    if (html.charAt(html.length - 1) === '\n') html = html.slice(0, -1);
    var lines = html.split('\n');
    var openTags = [];
    code.innerHTML = lines.map(function (line) {
      var prefix = openTags.join('');
      var re = /<\/?span[^>]*>/gi;
      var m;
      while ((m = re.exec(line)) !== null) {
        if (m[0][1] === '/') openTags.pop();
        else openTags.push(m[0]);
      }
      var suffix = '';
      for (var i = 0; i < openTags.length; i++) suffix += '</span>';
      return '<span class="code-line">' + prefix + (line || ' ') + suffix + '</span>';
    }).join('');
  }

  /**
   * Highlight and line-wrap every `pre:not(.mermaid) > code` under `scopeRoot`
   * (defaults to `document`), using `hljsRef` (defaults to `window.hljs`).
   * Always captures each element's source first. Highlights element-by-element
   * via `hljs.highlightElement`, *not* `hljs.highlightAll()` — highlightAll()
   * ignores its caller's root and rescans the whole document, so a scoped SPA
   * remount would otherwise keep re-touching content outside (and possibly
   * unrelated leftover content from) the root it was actually asked to mount.
   *
   * Only successful highlighting marks a block done. Missing libraries or
   * allowlisted grammars remain retriable, including unlabelled blocks that
   * highlight.js auto-detects. Presentation wrappers are never passed back
   * to the highlighter as source.
   */
  function highlightScope(scopeRoot, options) {
    options = options || {};
    var docRoot = scopeRoot || (typeof document !== 'undefined' ? document : null);
    if (!docRoot || typeof docRoot.querySelectorAll !== 'function') return;
    var hljsRef = options.hljs || (typeof hljs !== 'undefined' ? hljs : (typeof window !== 'undefined' ? window.hljs : undefined));
    var aliasMap = options.aliasMap || {};
    var codes = docRoot.querySelectorAll('pre:not(.mermaid) > code');
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      captureSource(code);
      if (code.dataset.codeBlocksHighlighted === '1') continue;
      var parent = code.parentElement;
      var raw = parent ? parent.className.trim() : '';
      var hljsAvailable = !!(hljsRef && typeof hljsRef.highlightElement === 'function');
      if (!hljsAvailable) continue;
      var isKnown = typeof hljsRef.getLanguage === 'function'
        ? function (lang) { return !!hljsRef.getLanguage(lang); }
        : null;
      if (resolvePrefetchLanguage(raw, aliasMap, isKnown, options.isAllowedLanguage)) {
        if (options.lineNumbers !== false) wrapLines(code);
        continue;
      }
      if (code.querySelector('.code-line')) {
        code.textContent = readSource(code);
        delete code.dataset.highlighted;
      }
      if (raw) {
        var name = resolveLanguage(raw, aliasMap, isKnown);
        var resolved = (name && isKnown && isKnown(name)) ? name : 'plaintext';
        code.classList.add('language-' + resolved);
      }
      try {
        hljsRef.highlightElement(code);
      } catch (e) {
        code.textContent = readSource(code);
        delete code.dataset.highlighted;
        if (typeof options.onError === 'function') {
          options.onError(e);
        } else if (typeof console !== 'undefined' && console.error) {
          console.error('code-blocks: highlight.js failed on a code block; leaving its source visible.', e);
        }
        continue;
      }
      code.dataset.codeBlocksHighlighted = '1';
      if (options.lineNumbers !== false) wrapLines(code);
    }
  }

  return Object.freeze({
    captureSource: captureSource,
    readSource: readSource,
    resolveLanguage: resolveLanguage,
    resolvePrefetchLanguage: resolvePrefetchLanguage,
    wrapLines: wrapLines,
    highlightScope: highlightScope
  });
});
