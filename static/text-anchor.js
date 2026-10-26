/**
 * Text Anchor — shared text-finding utilities for comments and quick-edit.
 *
 * Provides Unicode-aware text normalization, anchor matching with prefix/suffix
 * disambiguation, and markdown source position finding.
 *
 * Loaded before comments.js and quick-edit.js via <script> tag.
 */
(function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Text normalisation
  // ---------------------------------------------------------------------------

  /**
   * Normalize text for comparison: NFC, lowercase, collapse Unicode whitespace.
   * @param {string} text
   * @returns {string}
   */
  function normalizeText(text) {
    if (!text) return '';
    return text.normalize('NFC').toLowerCase()
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
      .replace(/[\u200e\u200f]/g, '')   // direction marks only (keep ZWJ/ZWNJ for emoji)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize text lightly — only NFC + collapse invisible chars.
   * Preserves case, preserves meaningful spacing.  Used when we need
   * positional fidelity (mapping indices back to original).
   * @param {string} text
   * @returns {string}
   */
  function normalizeLight(text) {
    if (!text) return '';
    return text.normalize('NFC')
      .replace(/[\u200e\u200f]/g, '');
  }

  // ---------------------------------------------------------------------------
  // Heading slug  (matches server-side headingSlug in spa/comments.js)
  // ---------------------------------------------------------------------------

  /**
   * Generate a heading slug matching pandoc's identifier algorithm.
   * Handles ASCII, CJK and other Unicode letters/numbers.
   * @param {string} text  Heading text (plain, no markdown formatting)
   * @returns {string}
   */
  function headingSlug(text) {
    return text
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')   // keep letters, numbers, spaces, _, -
      .replace(/\s+/g, '-')                   // spaces → hyphens
      .toLowerCase()
      .replace(/^[^\p{L}]+/u, '')             // strip leading non-letters (pandoc rule)
      .replace(/-+$/g, '');                    // trim trailing hyphens
  }

  // ---------------------------------------------------------------------------
  // Source position (data-sourcepos) helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse a data-sourcepos attribute value into an object.
   * Format: "startLine:startCol-endLine:endCol" (1-based).
   *
   * @param {string} attr  e.g. "17:1-19:42"
   * @returns {{ startLine: number, startCol: number, endLine: number, endCol: number }|null}
   */
  function parseSourcepos(attr) {
    if (!attr) return null;
    var m = attr.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
    if (!m) return null;
    return {
      startLine: parseInt(m[1], 10),
      startCol:  parseInt(m[2], 10),
      endLine:   parseInt(m[3], 10),
      endCol:    parseInt(m[4], 10)
    };
  }

  /**
   * Find the nearest ancestor (or self) with a data-sourcepos attribute.
   *
   * @param {Node} node    Starting node (text node or element)
   * @param {Element} root  Boundary element (e.g. .article) — stop here
   * @returns {{ element: Element, sourcepos: { startLine: number, startCol: number, endLine: number, endCol: number } }|null}
   */
  function getSourcepos(node, root) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== root) {
      var attr = el.getAttribute && el.getAttribute('data-sourcepos');
      if (attr) {
        var sp = parseSourcepos(attr);
        if (sp) return { element: el, sourcepos: sp };
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Compute the tightest source-line bounds around a DOM node.
   *
   * Strategy 1 (ancestor): walk up from node to root. At the first element
   * with data-sourcepos, record it as the outer bound. Then tighten via
   * sibling sourcepos at each level between the node and that ancestor.
   *
   * Strategy 2 (bracket): if no ancestor has data-sourcepos, find the nearest
   * previous and next elements with data-sourcepos in document order to form
   * a [lowerbound, upperbound] line range.
   *
   * @param {Node}    node  Starting node (text node or element)
   * @param {Element} root  Boundary element (e.g. .article)
   * @returns {{ element: Element|null, sourcepos: { startLine: number, startCol: number, endLine: number, endCol: number }, bracket?: boolean }|null}
   */
  function getTightSourcepos(node, root) {
    // First find innermost ancestor sourcepos (same as getSourcepos)
    var inner = getSourcepos(node, root);

    // --- Strategy 2: bracket approach (no ancestor has sourcepos) ---
    if (!inner) {
      var bracket = findBracketSourcepos(node, root);
      if (!bracket) return null;
      return {
        element: null,
        sourcepos: bracket.sourcepos,
        bracket: true
      };
    }

    // --- Strategy 1: ancestor with sibling tightening ---

    var sp = inner.sourcepos;
    var lo = sp.startLine;
    var loCol = sp.startCol;
    var hi = sp.endLine;
    var hiCol = sp.endCol;

    // Tighten via siblings of the element that owns the sourcepos, and
    // also the ancestors between source element and the clicked node.
    // Walk from the innermost sourcepos element down toward the node,
    // but more usefully: at each ancestor between node and the sourcepos
    // element, check siblings for tighter bounds.
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== inner.element && el !== root) {
      // Check previous siblings for a tighter lower bound
      var prev = el.previousElementSibling;
      while (prev) {
        var pAttr = prev.getAttribute && prev.getAttribute('data-sourcepos');
        if (pAttr) {
          var pSp = parseSourcepos(pAttr);
          if (pSp && pSp.endLine >= lo) {
            // Previous sibling ends at pSp.endLine; our text must start after
            lo = pSp.endLine;
            loCol = pSp.endCol + 1;
          }
          break;  // nearest previous sibling with sourcepos is enough
        }
        prev = prev.previousElementSibling;
      }

      // Check next siblings for a tighter upper bound
      var next = el.nextElementSibling;
      while (next) {
        var nAttr = next.getAttribute && next.getAttribute('data-sourcepos');
        if (nAttr) {
          var nSp = parseSourcepos(nAttr);
          if (nSp && nSp.startLine <= hi) {
            hi = nSp.startLine;
            hiCol = nSp.startCol > 1 ? nSp.startCol - 1 : 1;
          }
          break;
        }
        next = next.nextElementSibling;
      }

      el = el.parentElement;
    }

    // Also tighten via children of the sourcepos element that are siblings
    // of the subtree containing the clicked node.
    // (Already covered by the walk above.)

    // Ensure bounds are valid
    if (lo > hi) { lo = sp.startLine; hi = sp.endLine; loCol = sp.startCol; hiCol = sp.endCol; }
    if (lo === hi && loCol > hiCol) { loCol = sp.startCol; hiCol = sp.endCol; }

    return {
      element: inner.element,
      sourcepos: { startLine: lo, startCol: loCol, endLine: hi, endCol: hiCol }
    };
  }

  // ---------------------------------------------------------------------------
  // Bracket sourcepos — find nearest prev/next sourcepos in DOM order
  // ---------------------------------------------------------------------------

  /**
   * Walk backward through the DOM (previous siblings, then parent's previous
   * siblings, recursively) to find the nearest preceding element with a
   * data-sourcepos attribute.
   *
   * @param {Element} el    Starting element
   * @param {Element} root  Boundary element (e.g. .article)
   * @returns {{ element: Element, sourcepos: { startLine: number, startCol: number, endLine: number, endCol: number } }|null}
   */
  function findPrevSourcepos(el, root) {
    var cur = el;
    while (cur && cur !== root) {
      // Check previous siblings (and their deepest last descendants)
      var sib = cur.previousElementSibling;
      while (sib) {
        // Check deepest-last descendant first (document order: last child is latest)
        var deep = sib;
        while (deep.lastElementChild) deep = deep.lastElementChild;
        // Walk up from deepest to sib checking sourcepos
        while (deep && deep !== sib.parentElement) {
          var attr = deep.getAttribute && deep.getAttribute('data-sourcepos');
          if (attr) {
            var sp = parseSourcepos(attr);
            if (sp) return { element: deep, sourcepos: sp };
          }
          deep = deep.parentElement;
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * Walk forward through the DOM (next siblings, then parent's next siblings,
   * recursively) to find the nearest following element with a data-sourcepos
   * attribute.
   *
   * @param {Element} el    Starting element
   * @param {Element} root  Boundary element (e.g. .article)
   * @returns {{ element: Element, sourcepos: { startLine: number, startCol: number, endLine: number, endCol: number } }|null}
   */
  function findNextSourcepos(el, root) {
    var cur = el;
    while (cur && cur !== root) {
      // Check next siblings (and their shallowest first descendants)
      var sib = cur.nextElementSibling;
      while (sib) {
        // Check sib itself first, then first descendants (document order)
        var deep = sib;
        while (deep) {
          var attr = deep.getAttribute && deep.getAttribute('data-sourcepos');
          if (attr) {
            var sp = parseSourcepos(attr);
            if (sp) return { element: deep, sourcepos: sp };
          }
          deep = deep.firstElementChild;
        }
        sib = sib.nextElementSibling;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * Find the two nearest data-sourcepos elements bracketing a DOM node —
   * one before and one after in document order — to form a line range.
   *
   * This is used as a fallback when no ancestor of the clicked element
   * has data-sourcepos (common for table cells, list items, headings in
   * custom containers).
   *
   * @param {Node}    node  Starting node (text node or element)
   * @param {Element} root  Boundary element (e.g. .article)
   * @returns {{ prev: { element: Element, sourcepos: object }|null,
   *             next: { element: Element, sourcepos: object }|null,
   *             sourcepos: { startLine: number, startCol: number, endLine: number, endCol: number } }|null}
   */
  function findBracketSourcepos(node, root) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || el === root) return null;

    var prev = findPrevSourcepos(el, root);
    var next = findNextSourcepos(el, root);

    // If neither direction found anything, no brackets available
    if (!prev && !next) return null;

    // Build the range: prev.endLine..next.startLine
    var lo = prev ? prev.sourcepos.endLine : 1;
    var loCol = prev ? prev.sourcepos.endCol + 1 : 1;
    var hi = next ? next.sourcepos.startLine : 999999;
    var hiCol = next ? (next.sourcepos.startCol > 1 ? next.sourcepos.startCol - 1 : 1) : 999999;

    // Ensure bounds are valid
    if (lo > hi) { lo = 1; hi = 999999; loCol = 1; hiCol = 999999; }
    if (lo === hi && loCol > hiCol) { loCol = 1; hiCol = 999999; }

    return {
      prev: prev,
      next: next,
      sourcepos: { startLine: lo, startCol: loCol, endLine: hi, endCol: hiCol }
    };
  }

  // ---------------------------------------------------------------------------
  // Section ID from DOM node
  // ---------------------------------------------------------------------------

  /**
   * Find the section heading ID for a given DOM node by walking backward
   * through the DOM to find the nearest preceding heading with an id.
   *
   * @param {Node}    node     The target node
   * @param {Element} article  The .article boundary element
   * @returns {string}  Heading id, or '_top' if before any heading
   */
  function findSectionIdFromNode(node, article) {
    if (!article) return '_top';
    // Check if node is inside a heading
    var parent = node;
    while (parent && parent !== article) {
      if (/^H[1-6]$/.test(parent.tagName) && parent.id) return parent.id;
      parent = parent.parentNode;
    }
    // Walk backwards through DOM to find the closest preceding heading.
    // At each level: exhaust previous siblings checking for headings,
    // then move up to the parent and continue checking its siblings.
    var cur = node.nodeType === 3 ? node.parentElement : node;
    while (cur && cur !== article) {
      var sib = cur.previousElementSibling;
      while (sib) {
        // Check if sib itself is a heading
        if (/^H[1-6]$/.test(sib.tagName) && sib.id) return sib.id;
        // Check for headings inside sib (take the last one in document order)
        var deepest = sib.querySelectorAll ? sib.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]') : [];
        if (deepest.length > 0) return deepest[deepest.length - 1].id;
        sib = sib.previousElementSibling;
      }
      // No heading found among siblings — move up to parent
      cur = cur.parentElement;
    }
    return '_top';
  }

  // ---------------------------------------------------------------------------
  // Occurrence counting
  // ---------------------------------------------------------------------------

  /**
   * Count which occurrence (1-based) the match at/nearest targetIdx is,
   * optionally scoped to a section range.  Uses normalised matching.
   *
   * @param {string} fullText     Concatenated text
   * @param {string} searchText   Anchor text to count
   * @param {number} targetIdx    Character index of the target match
   * @param {{ start: number, end: number }|null} sectionRange  Optional section bounds
   * @returns {number} 1-based occurrence number
   */
  function countOccurrenceAtIndex(fullText, searchText, targetIdx, sectionRange) {
    var occ = 1;
    var searchFrom = sectionRange ? sectionRange.start : 0;
    var endBound = sectionRange ? sectionRange.end : fullText.length;
    var searchLower = searchText.toLowerCase();
    var textLower = fullText.toLowerCase();
    while (true) {
      var pos = textLower.indexOf(searchLower, searchFrom);
      if (pos === -1 || pos >= endBound) break;
      if (pos >= targetIdx) break;
      occ++;
      searchFrom = pos + 1;
    }
    return occ;
  }

  // ---------------------------------------------------------------------------
  // Strip markdown formatting → plain text
  // ---------------------------------------------------------------------------

  /**
   * Strip common markdown inline formatting to get plain text for comparison.
   * @param {string} text  One line of markdown
   * @returns {string}
   */
  function stripMarkdown(text) {
    return text
      .replace(/<!--[\s\S]*?-->/g, '')             // HTML comments
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')  // ![alt](url) → alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [text](url) → text
      .replace(/\*\*([^*]+)\*\*/g, '$1')          // **bold**
      .replace(/\*([^*]+)\*/g, '$1')              // *italic*
      .replace(/__([^_]+)__/g, '$1')              // __bold__
      .replace(/_([^_]+)_/g, '$1')                // _italic_
      .replace(/`([^`]+)`/g, '$1')                // `code`
      .replace(/^#+\s*/, '')                       // # heading
      .replace(/^[\-*+]\s+/, '')                   // list markers
      .replace(/^\d+\.\s+/, '');                   // numbered list
  }

  /**
   * Check whether the character at rawLine[idx] is "visible" in the rendered
   * output (i.e. survives stripMarkdown).  Uses a marker-replacement test.
   *
   * @param {string} rawLine  The raw markdown line
   * @param {number} idx      Character index in rawLine
   * @returns {boolean}
   */
  function isVisibleChar(rawLine, idx) {
    var marker = '\ufff9';
    var marked = rawLine.substring(0, idx) + marker + rawLine.substring(idx + 1);
    return stripMarkdown(marked).indexOf(marker) !== -1;
  }

  /**
   * Find the raw-line column (1-based) of the Nth "visible" occurrence of
   * searchText in rawLine.  A visible occurrence is one where the first
   * character survives stripMarkdown.
   *
   * @param {string} rawLine     The raw markdown line
   * @param {string} searchText  Text to find (case-insensitive)
   * @param {number} n           Which visible occurrence (1-based)
   * @returns {number}           1-based column, or 1 if not found
   */
  function findNthVisibleCol(rawLine, searchText, n) {
    var rawLower = rawLine.toLowerCase();
    var searchLower = searchText.toLowerCase();
    var count = 0;
    var idx = 0;
    while ((idx = rawLower.indexOf(searchLower, idx)) !== -1) {
      if (isVisibleChar(rawLine, idx)) {
        count++;
        if (count === n) return idx + 1;
      }
      idx++;
    }
    // Fallback: return Nth raw occurrence if visibility check found nothing
    count = 0;
    idx = 0;
    while ((idx = rawLower.indexOf(searchLower, idx)) !== -1) {
      count++;
      if (count === n) return idx + 1;
      idx++;
    }
    return 1;
  }

  // ---------------------------------------------------------------------------
  // DOM text collection
  // ---------------------------------------------------------------------------

  /**
   * Collect all text nodes under a root element via TreeWalker.
   * @param {Node} root
   * @returns {Text[]}
   */
  function collectTextNodes(root) {
    var nodes = [];
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    while (w.nextNode()) nodes.push(w.currentNode);
    return nodes;
  }

  /**
   * Build a concatenated full-text string and a parallel array that tracks
   * which text node owns each character range.
   *
   * @param {Text[]} textNodes
   * @returns {{ fullText: string, nodeStarts: Array<{node: Text, start: number}> }}
   */
  function buildFullText(textNodes) {
    var fullText = '';
    var nodeStarts = [];
    for (var i = 0; i < textNodes.length; i++) {
      nodeStarts.push({ node: textNodes[i], start: fullText.length });
      fullText += textNodes[i].textContent;
    }
    return { fullText: fullText, nodeStarts: nodeStarts };
  }

  // ---------------------------------------------------------------------------
  // Build normalised-index ↔ raw-index mapping
  // ---------------------------------------------------------------------------

  /**
   * Build bidirectional character-index mapping between a raw string and a
   * normalised version produced by `normalizeText`.
   *
   * For each character in the normalised string we record the index in the
   * raw string it came from (rawOfNorm), and vice-versa (normOfRaw).
   *
   * This lets us search in normalised space and map hits back to raw offsets
   * accurately — even when Unicode spaces, ZWJ chars, etc. change lengths.
   *
   * @param {string} raw   The original concatenated text
   * @returns {{ norm: string, rawOfNorm: Int32Array, normOfRaw: Int32Array }}
   */
  function buildNormMap(raw) {
    // First apply NFC (may change length) and remove invisibles
    var nfc = raw.normalize('NFC')
      .replace(/[\u200e\u200f]/g, '');

    // Build a char-by-char mapping from nfc → lowercase + space-collapsed
    var norm = '';
    var rawOfNorm = [];   // norm-index → nfc-index
    var normOfRaw = new Int32Array(nfc.length).fill(-1);  // nfc-index → norm-index
    var prevWasSpace = true;  // for leading-space trim

    for (var i = 0; i < nfc.length; i++) {
      var ch = nfc[i];
      // Map Unicode whitespace → regular space
      if (/[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/.test(ch) || /\s/.test(ch)) {
        if (!prevWasSpace) {
          normOfRaw[i] = norm.length;
          rawOfNorm.push(i);
          norm += ' ';
          prevWasSpace = true;
        }
        // else: collapsed — skip
        continue;
      }
      prevWasSpace = false;
      var lower = ch.toLowerCase();
      for (var li = 0; li < lower.length; li++) {
        normOfRaw[i] = norm.length;  // first char of lowercase maps here
        rawOfNorm.push(i);
        norm += lower[li];
      }
    }
    // trim trailing space
    if (norm.length > 0 && norm[norm.length - 1] === ' ') {
      norm = norm.slice(0, -1);
      rawOfNorm.pop();
    }

    return {
      norm: norm,
      rawOfNorm: new Int32Array(rawOfNorm),
      normOfRaw: normOfRaw
    };
  }

  // ---------------------------------------------------------------------------
  // Bounded Levenshtein distance (for fuzzy matching)
  // ---------------------------------------------------------------------------

  /**
   * Compute Levenshtein edit distance between two strings, with early
   * termination when the distance exceeds maxDist.
   *
   * @param {string} a
   * @param {string} b
   * @param {number} maxDist  Upper bound — returns maxDist+1 if exceeded
   * @returns {number}
   */
  function levenshteinBounded(a, b, maxDist) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    if (la === 0) return lb;
    if (lb === 0) return la;
    // Single-row DP
    var prev = new Array(lb + 1);
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      var curr = new Array(lb + 1);
      curr[0] = i;
      var rowMin = i;
      for (var j = 1; j <= lb; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > maxDist) return maxDist + 1;
      prev = curr;
    }
    return prev[lb];
  }

  // ---------------------------------------------------------------------------
  // Prefix / suffix scoring
  // ---------------------------------------------------------------------------

  /**
   * Score how well the text around a candidate position matches the expected
   * prefix and suffix.  Higher is better.
   *
   * Prefix is matched from the end (the prefix text should end exactly where
   * the anchor begins).  Suffix is matched from the start.
   *
   * @param {string} fullText   Concatenated text of all text nodes (raw)
   * @param {number} idx        Start index of candidate in fullText
   * @param {number} anchorLen  Length of anchor text
   * @param {string} prefix     Expected prefix (up to 30 chars before anchor)
   * @param {string} suffix     Expected suffix (up to 30 chars after anchor)
   * @returns {number}          Score (0 = no context match)
   */
  function scoreCandidate(fullText, idx, anchorLen, prefix, suffix) {
    var score = 0;

    if (prefix) {
      var before = fullText.slice(Math.max(0, idx - prefix.length), idx);
      // Normalise both for comparison
      var beforeNorm = normalizeText(before);
      var prefixNorm = normalizeText(prefix);
      if (beforeNorm === prefixNorm) {
        score += prefixNorm.length * 2;  // exact match gets bonus
      } else {
        // find longest suffix of prefixNorm that matches suffix of beforeNorm
        for (var pi = 1; pi <= prefixNorm.length; pi++) {
          if (beforeNorm.endsWith(prefixNorm.slice(prefixNorm.length - pi))) {
            score = Math.max(score, pi);
          }
        }
      }
    }

    if (suffix) {
      var after = fullText.slice(idx + anchorLen, idx + anchorLen + suffix.length);
      var afterNorm = normalizeText(after);
      var suffixNorm = normalizeText(suffix);
      if (afterNorm === suffixNorm) {
        score += suffixNorm.length * 2;
      } else {
        // find longest prefix of suffixNorm that matches prefix of afterNorm
        var suffScore = 0;
        for (var si = 1; si <= suffixNorm.length; si++) {
          if (afterNorm.startsWith(suffixNorm.slice(0, si))) {
            suffScore = si;  // keep going to find longest match
          } else {
            break;  // no longer matches
          }
        }
        score += suffScore;
      }
    }

    return score;
  }

  // ---------------------------------------------------------------------------
  // Section scoping in DOM — find text index range for a heading section
  // ---------------------------------------------------------------------------

  /**
   * Find the start and end character indices (in the concatenated fullText)
   * for the section under a heading with the given id.
   *
   * A section starts right after the heading element and ends just before
   * the next heading of the same or higher level (or end of article).
   *
   * When sectionId is not found and sourcepos is provided, falls back to
   * finding the nearest heading by data-sourcepos proximity (heading rename
   * recovery).
   *
   * @param {Element} article  The .article element
   * @param {string}  sectionId  Heading id (or '_top')
   * @param {{ fullText: string, nodeStarts: Array<{node: Text, start: number}> }} bt
   * @param {{ startLine: number }=} sourcepos  Optional sourcepos for recovery
   * @returns {{ start: number, end: number }|null}
   */
  function findSectionRange(article, sectionId, bt, sourcepos) {
    if (!sectionId) return null;

    var headingEl = null;
    var headingLevel = 0;

    if (sectionId === '_top') {
      // Everything before the first heading
      var firstH = article.querySelector('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
      if (!firstH) return { start: 0, end: bt.fullText.length }; // no headings at all
      // Find the text index just before the first heading
      var endIdx = nodeTextIndex(firstH, bt, 'before');
      return { start: 0, end: endIdx >= 0 ? endIdx : bt.fullText.length };
    }

    headingEl = document.getElementById(sectionId);
    if (!headingEl || !article.contains(headingEl) || !/^H[1-6]$/.test(headingEl.tagName)) {
      // Heading not found by id — try sourcepos recovery (heading rename)
      if (sourcepos && sourcepos.startLine) {
        var allH = article.querySelectorAll('h1[data-sourcepos], h2[data-sourcepos], h3[data-sourcepos], h4[data-sourcepos], h5[data-sourcepos], h6[data-sourcepos]');
        var bestH = null;
        var bestDist = Infinity;
        for (var hi = 0; hi < allH.length; hi++) {
          var sp = parseSourcepos(allH[hi].getAttribute('data-sourcepos'));
          if (!sp) continue;
          var dist = Math.abs(sp.startLine - sourcepos.startLine);
          if (dist < bestDist && dist <= 20) {
            bestDist = dist;
            bestH = allH[hi];
          }
        }
        if (bestH) {
          headingEl = bestH;
        } else {
          return null;
        }
      } else {
        return null;
      }
    }
    headingLevel = parseInt(headingEl.tagName[1], 10);

    // Section starts after this heading's text content
    var sectionStart = nodeTextIndex(headingEl, bt, 'after');
    if (sectionStart < 0) return null;

    // Find the next heading of same or higher level
    var sectionEnd = bt.fullText.length;
    var allHeadings = article.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
    var foundCurrent = false;
    for (var i = 0; i < allHeadings.length; i++) {
      if (allHeadings[i] === headingEl) { foundCurrent = true; continue; }
      if (foundCurrent) {
        var lvl = parseInt(allHeadings[i].tagName[1], 10);
        if (lvl <= headingLevel) {
          var idx = nodeTextIndex(allHeadings[i], bt, 'before');
          if (idx >= 0) sectionEnd = idx;
          break;
        }
      }
    }

    return { start: sectionStart, end: sectionEnd };
  }

  /**
   * Find the character index in fullText corresponding to a DOM element.
   * 'before' = index of the first character of the element's text.
   * 'after'  = index just past the last character of the element's text.
   *
   * @param {Element} el
   * @param {{ fullText: string, nodeStarts: Array<{node: Text, start: number}> }} bt
   * @param {'before'|'after'} position
   * @returns {number}  -1 if not found
   */
  function nodeTextIndex(el, bt, position) {
    for (var i = 0; i < bt.nodeStarts.length; i++) {
      var ns = bt.nodeStarts[i];
      if (el.contains(ns.node)) {
        if (position === 'before') return ns.start;
        // For 'after', find the last text node inside this element
        var lastIdx = i;
        for (var j = i + 1; j < bt.nodeStarts.length; j++) {
          if (el.contains(bt.nodeStarts[j].node)) lastIdx = j;
          else break;
        }
        return bt.nodeStarts[lastIdx].start + bt.nodeStarts[lastIdx].node.textContent.length;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // findAnchorRange — locate comment anchor text in the DOM
  // ---------------------------------------------------------------------------

  /**
   * Find the DOM Range corresponding to a comment's anchor text within an
   * article element.  Uses normalised text matching with prefix/suffix
   * context scoring for disambiguation.  When sectionId is provided,
   * candidates are scoped to that section first.
   *
   * @param {Element} article   The .article element
   * @param {{ anchorText: string, anchorPrefix?: string, anchorSuffix?: string, sectionId?: string, sourcepos?: { startLine: number } }} comment
   * @returns {Range|null}
   */
  function findAnchorRange(article, comment) {
    var anchor = comment.anchorText;
    if (!anchor) return null;
    var prefix = comment.anchorPrefix || '';
    var suffix = comment.anchorSuffix || '';
    var sectionId = comment.sectionId || '';

    var textNodes = collectTextNodes(article);
    if (textNodes.length === 0) return null;

    var bt = buildFullText(textNodes);
    var fullText = bt.fullText;
    var nodeStarts = bt.nodeStarts;

    // Determine section range for scoping (with sourcepos fallback for heading renames)
    var sectionRange = sectionId ? findSectionRange(article, sectionId, bt, comment.sourcepos) : null;

    // --- Strategy 1: exact match (fast path) ---
    var candidates = [];
    var searchFrom = 0;
    while (true) {
      var idx = fullText.indexOf(anchor, searchFrom);
      if (idx === -1) break;
      candidates.push({ idx: idx, len: anchor.length, exact: true });
      searchFrom = idx + 1;
    }

    // --- Strategy 2: normalised match (handles NBSP, case, combining chars) ---
    if (candidates.length === 0) {
      var map = buildNormMap(fullText);
      var anchorNorm = normalizeText(anchor);
      if (!anchorNorm) return null;

      searchFrom = 0;
      while (true) {
        var nIdx = map.norm.indexOf(anchorNorm, searchFrom);
        if (nIdx === -1) break;
        // Map back to raw indices
        var rawStart = map.rawOfNorm[nIdx];
        var rawEndNorm = nIdx + anchorNorm.length - 1;
        var rawEnd = rawEndNorm < map.rawOfNorm.length ? map.rawOfNorm[rawEndNorm] + 1 : fullText.length;
        candidates.push({ idx: rawStart, len: rawEnd - rawStart, exact: false });
        searchFrom = nIdx + 1;
      }
    }

    // --- Strategy 3: fuzzy match (handles minor text edits) ---
    if (candidates.length === 0) {
      var map2 = map || buildNormMap(fullText);
      var anchorNorm2 = anchorNorm || normalizeText(anchor);
      if (anchorNorm2 && anchorNorm2.length >= 4) {
        var maxDist = Math.max(1, Math.floor(anchorNorm2.length * 0.2));
        // Determine search range in normalized space
        var fuzzyStart = 0;
        var fuzzyEnd = map2.norm.length;
        if (sectionRange) {
          // Map section range to normalized indices
          for (var fi = 0; fi < map2.rawOfNorm.length; fi++) {
            if (map2.rawOfNorm[fi] >= sectionRange.start) { fuzzyStart = fi; break; }
          }
          for (var fi = map2.rawOfNorm.length - 1; fi >= 0; fi--) {
            if (map2.rawOfNorm[fi] < sectionRange.end) { fuzzyEnd = fi + 1; break; }
          }
        }
        // Slide a window over normalized text
        var bestDist = maxDist + 1;
        var fuzzyHits = []; // [{nIdx, dist}]
        for (var wi = fuzzyStart; wi + anchorNorm2.length <= fuzzyEnd; wi++) {
          var window = map2.norm.slice(wi, wi + anchorNorm2.length);
          var d = levenshteinBounded(anchorNorm2, window, maxDist);
          if (d <= maxDist) {
            if (d < bestDist) {
              bestDist = d;
              fuzzyHits = [{ nIdx: wi, dist: d }];
            } else if (d === bestDist) {
              fuzzyHits.push({ nIdx: wi, dist: d });
            }
          }
        }
        for (var fi = 0; fi < fuzzyHits.length; fi++) {
          var hit = fuzzyHits[fi];
          var rStart = map2.rawOfNorm[hit.nIdx];
          var rEndNorm = hit.nIdx + anchorNorm2.length - 1;
          var rEnd = rEndNorm < map2.rawOfNorm.length ? map2.rawOfNorm[rEndNorm] + 1 : fullText.length;
          candidates.push({ idx: rStart, len: rEnd - rStart, exact: false, fuzzy: true });
        }
      }
    }

    if (candidates.length === 0) return null;

    // --- Sort candidates by position ---
    candidates.sort(function(a, b) { return a.idx - b.idx; });

    // --- Section scoping: prefer candidates within the target section ---
    if (sectionRange && candidates.length > 1) {
      var sectionCandidates = candidates.filter(function(c) {
        return c.idx >= sectionRange.start && c.idx + c.len <= sectionRange.end;
      });
      // Only narrow if we found at least one candidate in the section
      if (sectionCandidates.length > 0) {
        candidates = sectionCandidates;
      }
    }

    // --- Assign section-scoped occurrence index (1-based, after section filtering) ---
    for (var ci = 0; ci < candidates.length; ci++) {
      candidates[ci].occurrence = ci + 1;
    }

    // --- Pick best candidate via prefix/suffix scoring ---
    var bestCandidate = candidates[0];
    if (candidates.length > 1 && (prefix || suffix)) {
      var bestScore = -1;
      for (var ci = 0; ci < candidates.length; ci++) {
        var s = scoreCandidate(fullText, candidates[ci].idx, candidates[ci].len, prefix, suffix);
        if (s > bestScore) {
          bestScore = s;
          bestCandidate = candidates[ci];
        }
      }
    }

    // --- Occurrence-based tie-breaking for repeated lines ---
    var anchorOcc = comment.anchorOccurrence;
    if (anchorOcc && candidates.length > 1) {
      var topScore = scoreCandidate(fullText, bestCandidate.idx, bestCandidate.len, prefix, suffix);
      var tied = [];
      for (var ci = 0; ci < candidates.length; ci++) {
        if (scoreCandidate(fullText, candidates[ci].idx, candidates[ci].len, prefix, suffix) === topScore) {
          tied.push(candidates[ci]);
        }
      }
      if (tied.length > 1) {
        // Pick candidate whose section-scoped occurrence is closest to stored anchorOccurrence
        var bestOccDist = Infinity;
        for (var ci = 0; ci < tied.length; ci++) {
          var d = Math.abs(tied[ci].occurrence - anchorOcc);
          if (d < bestOccDist) { bestOccDist = d; bestCandidate = tied[ci]; }
        }
      }
    }

    // --- Map back to DOM Range ---
    return indexToRange(nodeStarts, bestCandidate.idx, bestCandidate.idx + bestCandidate.len);
  }

  /**
   * Map a (start, end) index pair in the concatenated fullText back to a DOM Range.
   *
   * @param {Array<{node: Text, start: number}>} nodeStarts
   * @param {number} startOffset   Start index in concatenated text
   * @param {number} endOffset     End index in concatenated text
   * @returns {Range|null}
   */
  function indexToRange(nodeStarts, startOffset, endOffset) {
    var startNode = null, startOff = 0, endNode = null, endOff = 0;
    for (var ni = 0; ni < nodeStarts.length; ni++) {
      var ns = nodeStarts[ni];
      var ne = ns.start + ns.node.textContent.length;
      if (!startNode && startOffset >= ns.start && startOffset < ne) {
        startNode = ns.node;
        startOff = startOffset - ns.start;
      }
      if (endOffset > ns.start && endOffset <= ne) {
        endNode = ns.node;
        endOff = endOffset - ns.start;
        break;
      }
    }
    if (!startNode || !endNode) return null;
    var range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    return range;
  }

  // ---------------------------------------------------------------------------
  // findTextPosition — locate text in markdown source lines
  // ---------------------------------------------------------------------------

  /**
   * Build line metadata for markdown source.
   * Generates deduplicated heading slugs matching pandoc's algorithm:
   * duplicate slugs get -1, -2, etc. appended.
   * @param {string[]} lines  Array of raw markdown lines
   * @returns {Array<{line: number, raw: string, plain: string, isHeading: boolean,
   *   headingLevel: number, headingText: string, headingSlug: string}>}
   */
  function buildLineMeta(lines) {
    var slugCounts = {};  // track duplicates like pandoc
    return lines.map(function(line, idx) {
      var isHeading = /^#{1,6}\s/.test(line);
      var headingLevel = isHeading ? line.match(/^(#{1,6})/)[1].length : 0;
      // Support explicit {#custom-id} syntax
      var explicitId = '';
      var headingText = '';
      if (isHeading) {
        var raw = line.replace(/^#{1,6}\s*/, '');
        var idMatch = raw.match(/\s*\{#([^\s}]+)[^}]*\}\s*$/);
        if (idMatch) {
          explicitId = idMatch[1];
          headingText = raw.replace(/\s*\{#[^\s}]+[^}]*\}\s*$/, '').trim();
        } else {
          headingText = raw.trim();
        }
      }
      var slug = '';
      if (explicitId) {
        slug = explicitId;
      } else if (headingText) {
        slug = headingSlug(headingText);
      }
      // Deduplicate: pandoc appends -1, -2, etc. for repeated slugs
      if (slug) {
        if (slugCounts[slug] === undefined) {
          slugCounts[slug] = 0;
        } else {
          slugCounts[slug]++;
          slug = slug + '-' + slugCounts[slug];
        }
      }
      return {
        line: idx + 1,
        raw: line,
        plain: stripMarkdown(line),
        isHeading: isHeading,
        headingLevel: headingLevel,
        headingText: headingText,
        headingSlug: slug
      };
    });
  }

  /**
   * Find a section range (start/end line indices, 0-based) by heading ID or text.
   * @param {Array} lineMeta  From buildLineMeta
   * @param {{ headingId?: string, headingText?: string }} opts
   * @returns {{ headingLine: number, sectionStart: number, sectionEnd: number }|null}
   */
  function findSection(lineMeta, opts) {
    var headingLine = -1;
    // Try by ID first
    if (opts.headingId) {
      var targetSlug = opts.headingId.toLowerCase();
      for (var i = 0; i < lineMeta.length; i++) {
        if (lineMeta[i].isHeading && lineMeta[i].headingSlug === targetSlug) {
          headingLine = i;
          break;
        }
      }
    }
    // Fallback: heading text match
    if (headingLine === -1 && opts.headingText) {
      var headingLower = normalizeText(opts.headingText);
      for (var i = 0; i < lineMeta.length; i++) {
        if (lineMeta[i].isHeading) {
          var mdHeading = normalizeText(lineMeta[i].headingText);
          if (mdHeading === headingLower || mdHeading.indexOf(headingLower) !== -1) {
            headingLine = i;
            break;
          }
        }
      }
    }
    if (headingLine === -1) return null;

    var sectionStart = headingLine + 1;
    var sectionEnd = lineMeta.length;
    var level = lineMeta[headingLine].headingLevel;
    for (var j = headingLine + 1; j < lineMeta.length; j++) {
      if (lineMeta[j].isHeading && lineMeta[j].headingLevel <= level) {
        sectionEnd = j;
        break;
      }
    }
    return { headingLine: headingLine, sectionStart: headingLine, sectionEnd: sectionEnd };
  }

  /**
   * Find the line and column of searchText in markdown source lines.
   *
   * Returns the n-th occurrence (1-based) within a section if section info
   * is provided, otherwise globally.
   *
   * When `opts.range` is provided ({ startLine, endLine } in 1-based lines),
   * the search is constrained to that line range. This is used by the bracket
   * sourcepos strategy to narrow results when no exact data-sourcepos ancestor
   * exists. The range intersects with section scoping when both are present.
   *
   * @param {string[]} lines          Raw markdown lines
   * @param {string}   searchText     Text to find
   * @param {{ occurrence?: number, headingId?: string, headingText?: string,
   *           range?: { startLine: number, endLine: number } }} opts
   * @returns {{ line: number, col: number }|null}   1-based line and column
   */
  function findTextPosition(lines, searchText, opts) {
    opts = opts || {};
    if (!searchText) return null;

    var searchNorm = normalizeText(searchText);
    if (!searchNorm) return null;

    var lineMeta = buildLineMeta(lines);
    var section = findSection(lineMeta, opts);

    // Optional line range constraint (1-based, from bracket sourcepos)
    var rangeStart = opts.range ? Math.max(0, opts.range.startLine - 1) : 0;
    var rangeEnd = opts.range ? Math.min(lines.length, opts.range.endLine) : lines.length;

    var targetOccurrence = opts.occurrence || 1;
    var allMatches = [];

    for (var i = rangeStart; i < rangeEnd; i++) {
      // Search in PLAIN (stripped markdown) text for occurrence counting.
      // This matches what the DOM renders, so occurrence numbers stay aligned
      // between the browser's rendered text and the markdown source.
      var plainNorm = normalizeText(lineMeta[i].plain);

      var idx = 0;
      var lineVisibleOcc = 0;
      while ((idx = plainNorm.indexOf(searchNorm, idx)) !== -1) {
        lineVisibleOcc++;
        // Map this visible occurrence back to a raw-line column
        var origCol = findNthVisibleCol(lines[i], searchText, lineVisibleOcc);
        allMatches.push({
          line: i + 1,
          col: origCol,
          inSection: section ? (i >= section.sectionStart && i < section.sectionEnd) : false
        });
        idx++;
      }
    }

    if (allMatches.length === 0) return null;

    // Sort by line, then column
    allMatches.sort(function(a, b) { return a.line - b.line || a.col - b.col; });

    // Pick N-th occurrence within section if section found
    if (section) {
      var sectionMatches = allMatches.filter(function(m) { return m.inSection; });
      if (sectionMatches.length > 0) {
        var si = Math.min(targetOccurrence, sectionMatches.length) - 1;
        return sectionMatches[si];
      }
    }

    // Otherwise global N-th
    var mi = Math.min(targetOccurrence, allMatches.length) - 1;
    return allMatches[mi];
  }

  /**
   * Map a normalised-text index back to a column in the raw line.
   *
   * We walk the raw line character-by-character, applying the same
   * normalisation transforms, and track which raw index corresponds
   * to the target normalised index.
   *
   * @param {string} rawLine     The original markdown line
   * @param {number} normIdx     Index in the normalised version of rawLine
   * @param {string} searchNorm  (unused but kept for signature compat)
   * @returns {number}           1-based column in the raw line
   */
  function mapNormIdxToRaw(rawLine, normIdx, searchNorm) {
    // Strip zero-width chars that don't survive rendering, then reuse buildNormMap
    var stripped = rawLine.normalize('NFC')
      .replace(/[\u200c\u200d\u200e\u200f\ufeff]/g, '');
    var map = buildNormMap(stripped);
    if (normIdx < map.rawOfNorm.length) {
      return map.rawOfNorm[normIdx] + 1; // 1-based column
    }
    // Fallback: return 1-based position as-is
    return normIdx + 1;
  }

  // ---------------------------------------------------------------------------
  // Expose API
  // ---------------------------------------------------------------------------

  var TextAnchor = {
    normalizeText: normalizeText,
    normalizeLight: normalizeLight,
    headingSlug: headingSlug,
    stripMarkdown: stripMarkdown,
    isVisibleChar: isVisibleChar,
    findNthVisibleCol: findNthVisibleCol,
    collectTextNodes: collectTextNodes,
    buildFullText: buildFullText,
    buildNormMap: buildNormMap,
    scoreCandidate: scoreCandidate,
    findSectionRange: findSectionRange,
    findAnchorRange: findAnchorRange,
    indexToRange: indexToRange,
    buildLineMeta: buildLineMeta,
    findSection: findSection,
    findTextPosition: findTextPosition,
    mapNormIdxToRaw: mapNormIdxToRaw,
    levenshteinBounded: levenshteinBounded,
    parseSourcepos: parseSourcepos,
    getSourcepos: getSourcepos,
    getTightSourcepos: getTightSourcepos,
    findBracketSourcepos: findBracketSourcepos,
    findSectionIdFromNode: findSectionIdFromNode,
    countOccurrenceAtIndex: countOccurrenceAtIndex
  };

  if (typeof window !== 'undefined') {
    window.TextAnchor = TextAnchor;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextAnchor;
  }
})();
