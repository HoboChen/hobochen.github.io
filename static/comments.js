/**
 * Review Comments — inline comment system for markdown pages.
 *
 * Comments are stored as <!-- mp:comments [...] --> at the end of each section
 * in the .md file, grouped by the heading they belong to.
 * Adding/editing/deleting requires SPA server mode; displaying works everywhere.
 */
document.addEventListener('DOMContentLoaded', function() {
(function() {
  'use strict';

  // --- State ---
  var commentMode = false;
  var comments = [];       // current page comment array
  var activePopup = null;  // currently open popup element
  var addBtn = null;       // the floating "Add comment" button
  var isSpa = document.body.dataset.spa === 'true';
  var currentNavIdx = -1;  // current comment navigation index

  // --- Helpers ---
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getCurrentPagePath() {
    var p = location.pathname;
    if (p.startsWith('/')) p = p.slice(1);
    if (p === '' || p.endsWith('/')) p += 'index.html';
    if (!/\.\w+$/.test(p)) p += '.html';
    return p;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  }

  // --- Find the section a DOM node belongs to (closest preceding heading id) ---
  function findSectionId(node) {
    var article = document.querySelector('.article');
    if (typeof TextAnchor !== 'undefined') {
      return TextAnchor.findSectionIdFromNode(node, article);
    }
    return '_top';
  }

  // --- Parse comments from HTML comment nodes in DOM ---
  // Collects from ALL <!-- mp:comments [...] --> blocks (one per section)
  function parseCommentsFromDom() {
    var article = document.querySelector('.article');
    if (!article) return [];
    var all = [];
    var walker = document.createTreeWalker(article, NodeFilter.SHOW_COMMENT, null, false);
    while (walker.nextNode()) {
      var text = walker.currentNode.textContent.trim();
      var m = text.match(/^mp:comments\s*(\[[\s\S]*\])$/);
      if (m) {
        try {
          var arr = JSON.parse(m[1]);
          for (var i = 0; i < arr.length; i++) all.push(arr[i]);
        } catch(e) { /* skip malformed block */ }
      }
    }
    return all;
  }

  // --- Anchor matching: delegate to shared TextAnchor module ---
  function findAnchorRange(article, comment) {
    if (typeof TextAnchor !== 'undefined') {
      return TextAnchor.findAnchorRange(article, comment);
    }
    return null;
  }

  // Wrap a Range with a span
  function wrapRange(range, className, commentId) {
    // If range spans multiple nodes, use surroundContents for same-node,
    // otherwise split across nodes
    var span = document.createElement('span');
    span.className = className;
    span.setAttribute('data-comment-id', commentId);
    try {
      range.surroundContents(span);
    } catch(e) {
      // Cross-element range: extract and wrap
      var frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    return span;
  }

  // --- Remove all highlights ---
  function clearHighlights() {
    var article = document.querySelector('.article');
    if (!article) return;
    var spans = article.querySelectorAll('.comment-highlight, .comment-underline');
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      var parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    // Remove orphan banner
    var orphanBanner = article.querySelector('.comment-orphans');
    if (orphanBanner) orphanBanner.remove();
  }

  // --- Apply highlights for all comments ---
  function applyHighlights() {
    var article = document.querySelector('.article');
    if (!article) return;
    clearHighlights();
    var orphaned = [];
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i];
      var range = findAnchorRange(article, c);
      if (!range) { orphaned.push(c); continue; }
      var cls = c.resolved ? 'comment-underline' : 'comment-highlight';
      var span = wrapRange(range, cls, c.id);
      span.addEventListener('click', (function(comment) {
        return function(e) {
          if (!commentMode) return;
          e.preventDefault();
          e.stopPropagation();
          var clickedSpan = e.target.closest('.comment-highlight, .comment-underline');
          selectSpanAsCurrent(clickedSpan);
          showCommentPopup(comment, clickedSpan);
        };
      })(c));
    }
    // Show orphaned comments at top of article
    if (orphaned.length > 0) {
      var banner = document.createElement('div');
      banner.className = 'comment-orphans';
      banner.innerHTML = '<div class="comment-orphans-title">Orphaned Comments (' + orphaned.length + ')</div>';
      for (var oi = 0; oi < orphaned.length; oi++) {
        var oc = orphaned[oi];
        var item = document.createElement('div');
        item.className = 'comment-orphan-item';
        item.setAttribute('data-comment-id', oc.id);
        item.innerHTML =
          '<span class="comment-orphan-anchor">' + escHtml(oc.anchorText) + '</span>' +
          '<span class="comment-orphan-body">' + escHtml(oc.body) + '</span>';
        item.addEventListener('click', (function(comment, el) {
          return function(e) {
            e.stopPropagation();
            showCommentPopup(comment, el);
          };
        })(oc, item));
        banner.appendChild(item);
      }
      article.insertBefore(banner, article.firstChild);
    }
    if (applyHighlights._focusId) {
      var focusSpan = article.querySelector('[data-comment-id="' + applyHighlights._focusId + '"]');
      applyHighlights._focusId = null;
      if (focusSpan) {
        selectSpanAsCurrent(focusSpan);
      } else {
        currentNavIdx = -1;
        clearCurrentHighlight();
        updateNavCounter();
      }
    } else {
      currentNavIdx = -1;
      clearCurrentHighlight();
      updateNavCounter();
    }
  }

  // --- Close any open popup ---
  function closePopup() {
    if (activePopup) {
      // Run any per-popup cleanup (e.g. drop an unsaved new-comment from the
      // array) before detaching. This makes Esc / click-outside behave the
      // same as the explicit cancel button.
      if (typeof activePopup._onClose === 'function') {
        try { activePopup._onClose(); } catch (e) { /* ignore */ }
      }
      activePopup.remove();
      activePopup = null;
    }
  }

  function closeAddBtn() {
    if (addBtn) {
      addBtn.remove();
      addBtn = null;
    }
  }

  // --- Position popup near an element ---
  function positionPopup(popup, anchorEl) {
    document.body.appendChild(popup);
    var rect = anchorEl.getBoundingClientRect();
    var popW = 340;
    var popH = popup.offsetHeight || 200;
    var left = rect.left + window.scrollX + (rect.width / 2) - (popW / 2);
    var top = rect.bottom + window.scrollY + 8;

    // Clamp to viewport
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (top + popH > window.scrollY + window.innerHeight - 16) {
      top = rect.top + window.scrollY - popH - 8;
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  // --- Make popup draggable ---
  // Drag-handle is the popup itself: any blank area drags, but events that
  // originate inside a textarea, button, input or [data-no-drag] are ignored
  // so the user can interact normally with those controls.
  function makeDraggable(popup, handle) {
    var ox, oy, sx, sy;
    handle.addEventListener('mousedown', function(e) {
      if (e.target.closest('button, textarea, input, select, [data-no-drag]')) return;
      e.preventDefault();
      ox = e.clientX; oy = e.clientY;
      sx = popup.offsetLeft; sy = popup.offsetTop;
      function onMove(e2) {
        popup.style.left = (sx + e2.clientX - ox) + 'px';
        popup.style.top = (sy + e2.clientY - oy) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // --- Inline SVG icon set used by the popups (24×24 viewBox, currentColor stroke) ---
  function svgIcon(path, opts) {
    var sz = (opts && opts.size) || 16;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  var icons = {
    x:       svgIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    check:   svgIcon('<polyline points="20 6 9 17 4 12"/>'),
    trash:   svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    edit:    svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
    resolve: svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
    reopen:  svgIcon('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>')
  };

  // --- Show comment popup (view / edit) ---
  function showCommentPopup(comment, anchorEl) {
    closePopup();
    closeAddBtn();

    var popup = document.createElement('div');
    popup.className = 'comment-popup';
    var resolvedTag = comment.resolved ? '<span class="comment-popup-resolved-tag">Resolved</span>' : '';
    var bodyHtml = escHtml(comment.body);
    var metaHtml = formatTime(comment.createdAt);
    if (comment.updatedAt && comment.updatedAt !== comment.createdAt) {
      metaHtml += ' (edited ' + formatTime(comment.updatedAt) + ')';
    }

    popup.innerHTML =
      '<div class="comment-popup-body">' +
        '<div class="comment-popup-text">' + bodyHtml + '</div>' +
        '<div class="comment-popup-meta">' + resolvedTag + '<span class="comment-popup-meta-time">' + metaHtml + '</span></div>' +
      '</div>' +
      (isSpa ?
        '<div class="comment-popup-actions">' +
          '<button class="comment-btn-icon comment-btn-danger" data-action="delete" title="Delete" aria-label="Delete">' + icons.trash + '</button>' +
          '<button class="comment-btn-icon" data-action="' + (comment.resolved ? 'unresolve' : 'resolve') + '" title="' + (comment.resolved ? 'Reopen' : 'Resolve') + '" aria-label="' + (comment.resolved ? 'Reopen' : 'Resolve') + '">' + (comment.resolved ? icons.reopen : icons.resolve) + '</button>' +
          '<button class="comment-btn-icon" data-action="edit" title="Edit" aria-label="Edit">' + icons.edit + '</button>' +
        '</div>' : '');

    if (isSpa) {
      popup.querySelector('[data-action="delete"]').addEventListener('click', function() {
        comments = comments.filter(function(c) { return c.id !== comment.id; });
        saveComments(function() { closePopup(); applyHighlights(); });
      });
      popup.querySelector('[data-action="resolve"], [data-action="unresolve"]').addEventListener('click', function() {
        comment.resolved = !comment.resolved;
        comment.updatedAt = new Date().toISOString();
        applyHighlights._focusId = comment.id;
        saveComments(function() { closePopup(); applyHighlights(); });
      });
      popup.querySelector('[data-action="edit"]').addEventListener('click', function(e) {
        e.stopPropagation();
        showEditPopup(comment, anchorEl);
      });
    }

    positionPopup(popup, anchorEl);
    makeDraggable(popup, popup);
    activePopup = popup;
  }

  // --- Show edit popup (edit existing or new) ---
  function showEditPopup(comment, anchorEl) {
    closePopup();

    var isNew = !comment.id;
    if (isNew) comment.id = genId();

    var popup = document.createElement('div');
    popup.className = 'comment-popup comment-popup-edit';

    function cancel() {
      if (isNew) comments = comments.filter(function(c) { return c.id !== comment.id; });
      closePopup();
    }
    // Run cancel cleanup if the popup is dismissed via Esc / click-outside
    // (closePopup() invokes _onClose before removing the element).
    popup._onClose = cancel;

    popup.innerHTML =
      '<div class="comment-popup-body">' +
        '<textarea rows="1">' + escHtml(comment.body || '') + '</textarea>' +
      '</div>' +
      '<div class="comment-popup-actions">' +
        '<button class="comment-btn-icon" data-action="cancel" title="Cancel (Esc)" aria-label="Cancel">' + icons.x + '</button>' +
        '<button class="comment-btn-icon comment-btn-primary" data-action="save" title="Save (Ctrl+Enter)" aria-label="Save">' + icons.check + '</button>' +
      '</div>';

    var textarea = popup.querySelector('textarea');
    var cancelBtn = popup.querySelector('[data-action="cancel"]');
    var saveBtn = popup.querySelector('[data-action="save"]');

    cancelBtn.addEventListener('click', function() {
      // closePopup() will call popup._onClose (cancel); clear it first so we
      // don't double-run if the user spams the button.
      popup._onClose = null;
      cancel();
    });
    saveBtn.addEventListener('click', function() {
      var text = textarea.value.trim();
      if (!text) return;
      comment.body = text;
      var now = new Date().toISOString();
      if (isNew) {
        comment.createdAt = now;
        comment.updatedAt = now;
        comment.resolved = false;
        comments.push(comment);
      } else {
        comment.updatedAt = now;
      }
      applyHighlights._focusId = comment.id;
      popup._onClose = null; // saved — skip the new-comment cleanup on close
      saveComments(function() { closePopup(); applyHighlights(); });
    });

    // Auto-grow the textarea up to a CSS max-height (then it scrolls inside).
    function autoGrow() {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
    textarea.addEventListener('input', autoGrow);

    // Ctrl+Enter to save, Esc to cancel
    textarea.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelBtn.click();
      }
    });

    positionPopup(popup, anchorEl);
    makeDraggable(popup, popup);
    activePopup = popup;
    setTimeout(function() { autoGrow(); textarea.focus(); }, 50);
  }

  // --- Save comments to server ---
  function saveComments(cb) {
    var pagePath = getCurrentPagePath();
    fetch('/api/save-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pagePath, comments: comments })
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data) {
      // Patch data-sourcepos attributes to account for inserted/removed comment blocks
      if (data && data.oldCommentLines && data.newCommentLines) {
        patchSourcepos(data.oldCommentLines, data.newCommentLines);
      }
      if (cb) cb();
    }).catch(function(err) {
      if (window._log) _log.error('comments', 'Save failed: ' + err.message);
    });
  }

  /**
   * Adjust data-sourcepos attributes on existing DOM elements after a comment
   * save to prevent stale line numbers (comment blocks shift line numbers).
   *
   * @param {number[]} oldLines  Sorted 1-based line numbers of comment blocks in old file
   * @param {number[]} newLines  Sorted 1-based line numbers of comment blocks in new file
   */
  function patchSourcepos(oldLines, newLines) {
    var article = document.querySelector('.article');
    var _TA = typeof TextAnchor !== 'undefined' ? TextAnchor : null;
    if (!article || !_TA) return;
    var els = article.querySelectorAll('[data-sourcepos]');
    for (var i = 0; i < els.length; i++) {
      var sp = _TA.parseSourcepos(els[i].getAttribute('data-sourcepos'));
      if (!sp) continue;
      // Step 1: remove old comment block offsets → "clean" line
      var cleanStart = sp.startLine;
      for (var j = 0; j < oldLines.length; j++) {
        if (oldLines[j] < sp.startLine) cleanStart--;
        else break;
      }
      var cleanEnd = sp.endLine;
      for (var j = 0; j < oldLines.length; j++) {
        if (oldLines[j] < sp.endLine) cleanEnd--;
        else break;
      }
      // Step 2: add new comment block offsets → new file line
      var newStart = cleanStart;
      for (var j = 0; j < newLines.length; j++) {
        if (newLines[j] <= newStart) newStart++;
        else break;
      }
      var newEnd = cleanEnd;
      for (var j = 0; j < newLines.length; j++) {
        if (newLines[j] <= newEnd) newEnd++;
        else break;
      }
      if (newStart !== sp.startLine || newEnd !== sp.endLine) {
        els[i].setAttribute('data-sourcepos',
          newStart + ':' + sp.startCol + '-' + newEnd + ':' + sp.endCol);
      }
    }
  }

  // --- Handle text selection: show "Add comment" button ---
  function onSelectionChange() {
    if (!commentMode || !isSpa) return;
    // Debounce to avoid flicker
    clearTimeout(onSelectionChange._t);
    onSelectionChange._t = setTimeout(checkSelection, 150);
  }

  function checkSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { closeAddBtn(); return; }

    var range = sel.getRangeAt(0);
    var article = document.querySelector('.article');
    if (!article || !article.contains(range.commonAncestorContainer)) { closeAddBtn(); return; }

    var text = sel.toString().trim();
    if (!text || text.length < 2) { closeAddBtn(); return; }

    // Don't show if clicking inside a popup
    if (activePopup && activePopup.contains(range.commonAncestorContainer)) { closeAddBtn(); return; }

    // Show add button near selection
    closeAddBtn();
    addBtn = document.createElement('button');
    addBtn.className = 'comment-add-btn';
    addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></svg> Comment';
    document.body.appendChild(addBtn);

    var rects = range.getClientRects();
    var lastRect = rects[rects.length - 1];
    if (!lastRect) { closeAddBtn(); return; }

    var left = lastRect.right + window.scrollX + 6;
    var top = lastRect.top + window.scrollY - 2;
    if (left + 100 > window.innerWidth) left = lastRect.left + window.scrollX - 110;
    addBtn.style.left = left + 'px';
    addBtn.style.top = top + 'px';

    addBtn.addEventListener('mousedown', function(e) {
      e.preventDefault(); // keep selection alive
    });
    addBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      createCommentFromSelection();
    });
  }

  function createCommentFromSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    var range = sel.getRangeAt(0);
    var article = document.querySelector('.article');
    if (!article) return;

    var anchorText = sel.toString().trim();
    if (!anchorText) return;

    var _TA = typeof TextAnchor !== 'undefined' ? TextAnchor : null;

    // Build full text and find selection position using shared utilities
    var textNodes = _TA ? _TA.collectTextNodes(article) : [];
    var bt = _TA ? _TA.buildFullText(textNodes) : { fullText: '', nodeStarts: [] };
    var fullText = bt.fullText;

    // Find the character index of the selection start in fullText
    var selIdx = -1;
    for (var i = 0; i < bt.nodeStarts.length; i++) {
      if (bt.nodeStarts[i].node === range.startContainer) {
        selIdx = bt.nodeStarts[i].start + range.startOffset;
        break;
      }
    }

    // Find the occurrence of anchorText closest to selIdx
    var idx = -1;
    if (selIdx >= 0) {
      var bestDist = Infinity;
      var searchFrom = 0;
      while (true) {
        var pos = fullText.indexOf(anchorText, searchFrom);
        if (pos === -1) break;
        var dist = Math.abs(pos - selIdx);
        if (dist < bestDist) { bestDist = dist; idx = pos; }
        searchFrom = pos + 1;
      }
    }
    if (idx === -1) idx = fullText.indexOf(anchorText);

    var anchorPrefix = idx > 0 ? fullText.slice(Math.max(0, idx - 30), idx) : '';
    var anchorSuffix = idx >= 0 ? fullText.slice(idx + anchorText.length, idx + anchorText.length + 30) : '';

    // Determine which section this selection belongs to
    var sectionId = findSectionId(range.startContainer);

    // Capture sourcepos from nearest ancestor element (or bracket fallback)
    var sourcepos = null;
    if (_TA) {
      var spInfo = _TA.getSourcepos(range.startContainer, article);
      if (spInfo) {
        sourcepos = spInfo.sourcepos;
      } else {
        var bracket = _TA.findBracketSourcepos(range.startContainer, article);
        if (bracket) sourcepos = bracket.sourcepos;
      }
    }

    // Count which occurrence this is WITHIN the section (1-based).
    var anchorOccurrence = 1;
    if (_TA && idx >= 0) {
      var secRange = _TA.findSectionRange(article, sectionId, bt);
      anchorOccurrence = _TA.countOccurrenceAtIndex(fullText, anchorText, idx, secRange);
    }

    var comment = {
      id: null,  // will be generated in showEditPopup
      sectionId: sectionId,
      anchorText: anchorText,
      anchorPrefix: anchorPrefix,
      anchorSuffix: anchorSuffix,
      anchorOccurrence: anchorOccurrence,
      sourcepos: sourcepos,
      body: '',
      resolved: false,
      createdAt: null,
      updatedAt: null
    };

    // Clear selection and add button
    sel.removeAllRanges();
    closeAddBtn();

    // Get position for popup from original range
    var rect = range.getBoundingClientRect();
    var fakeAnchor = document.createElement('span');
    fakeAnchor.style.cssText = 'position:absolute;left:' + (rect.left + window.scrollX) + 'px;top:' + (rect.bottom + window.scrollY) + 'px;width:1px;height:1px;';
    document.body.appendChild(fakeAnchor);

    showEditPopup(comment, fakeAnchor);
    setTimeout(function() { fakeAnchor.remove(); }, 100);
  }

  // --- Comment navigation helpers ---
  function getHighlightSpans() {
    var article = document.querySelector('.article');
    if (!article) return [];
    return Array.prototype.slice.call(
      article.querySelectorAll('.comment-highlight, .comment-underline')
    );
  }

  function selectSpanAsCurrent(span) {
    var spans = getHighlightSpans();
    var idx = spans.indexOf(span);
    if (idx < 0) return;
    clearCurrentHighlight();
    currentNavIdx = idx;
    span.classList.add('comment-current');
    updateNavCounter();
  }

  function updateNavCounter() {
    var el = document.getElementById('comment-nav-count');
    if (!el) return;
    var spans = getHighlightSpans();
    var total = spans.length;
    if (!commentMode) {
      el.textContent = '';
      return;
    }
    var cur = currentNavIdx >= 0 && currentNavIdx < total ? currentNavIdx + 1 : 0;
    el.textContent = cur + '\u2009/\u2009' + total;
  }

  function clearCurrentHighlight() {
    var prev = document.querySelector('.comment-current');
    if (prev) prev.classList.remove('comment-current');
  }

  function navigateComment(delta) {
    var spans = getHighlightSpans();
    if (spans.length === 0) return;
    clearCurrentHighlight();
    if (currentNavIdx < 0) {
      currentNavIdx = delta > 0 ? 0 : spans.length - 1;
    } else {
      currentNavIdx = (currentNavIdx + delta + spans.length) % spans.length;
    }
    var span = spans[currentNavIdx];
    span.classList.add('comment-current');
    if (span.scrollIntoView) span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateNavCounter();
  }

  function holdBannerLayoutForCommentTransition(wrap) {
    if (!wrap || typeof window._holdBannerLayoutForTransition !== 'function') return;
    window._holdBannerLayoutForTransition(
      wrap,
      ['width', 'margin-left', 'margin-right'],
      250
    );
  }

  // --- Toggle comment mode ---
  function toggleCommentMode() {
    // Only allow on markdown pages
    var pageType = document.body.dataset.pageType;
    if (pageType !== 'markdown') return;
    commentMode = !commentMode;
    var btn = document.getElementById('comment-btn');
    if (btn) btn.classList.toggle('active', commentMode);
    var wrap = document.getElementById('comment-wrap');
    if (commentMode) {
      var banner = document.querySelector('.top-banner');
      if (banner && banner.classList.contains('banner-compact') &&
          typeof window._openBannerRightDropdown === 'function') {
        window._openBannerRightDropdown();
      }
    }
    if (wrap) {
      holdBannerLayoutForCommentTransition(wrap);
      wrap.classList.toggle('active', commentMode);
    }

    if (commentMode) {
      applyHighlights();
      currentNavIdx = -1;
      updateNavCounter();
      document.addEventListener('selectionchange', onSelectionChange);
      startScrollTracking();
    } else {
      closePopup();
      closeAddBtn();
      clearCurrentHighlight();
      clearHighlights();
      currentNavIdx = -1;
      updateNavCounter();
      document.removeEventListener('selectionchange', onSelectionChange);
      stopScrollTracking();
    }
  }

  // --- Scroll tracking: update current index based on visibility ---
  var scrollTrackTimer = null;
  function onScrollTrack() {
    if (scrollTrackTimer) return;
    scrollTrackTimer = setTimeout(function() {
      scrollTrackTimer = null;
      if (!commentMode || activePopup) return;
      var spans = getHighlightSpans();
      if (spans.length === 0) return;
      var viewTop = window.scrollY;
      var viewBottom = viewTop + window.innerHeight;
      var best = -1, bestDist = Infinity;
      for (var i = 0; i < spans.length; i++) {
        var rect = spans[i].getBoundingClientRect();
        var absTop = rect.top + window.scrollY;
        // Prefer spans inside viewport; among those, pick topmost
        if (absTop >= viewTop && absTop <= viewBottom) {
          var dist = absTop - viewTop;
          if (dist < bestDist) { bestDist = dist; best = i; }
        }
      }
      if (best >= 0 && best !== currentNavIdx) {
        clearCurrentHighlight();
        currentNavIdx = best;
        spans[best].classList.add('comment-current');
        updateNavCounter();
      }
    }, 150);
  }
  function startScrollTracking() {
    window.addEventListener('scroll', onScrollTrack, { passive: true });
  }
  function stopScrollTracking() {
    window.removeEventListener('scroll', onScrollTrack);
    if (scrollTrackTimer) { clearTimeout(scrollTrackTimer); scrollTrackTimer = null; }
  }

  // --- Initialize ---
  function initComments(root) {
    var article = document.querySelector('.article');
    if (!article) {
      comments = [];
      updateNavCounter();
      return;
    }

    // Only enable comments on markdown pages
    var btn = document.getElementById('comment-btn');
    var wrap = document.getElementById('comment-wrap');
    var pageType = document.body.dataset.pageType;
    var supported = pageType === 'markdown';
    if (wrap) wrap.style.display = supported ? '' : 'none';
    else if (btn) btn.style.display = supported ? '' : 'none';

    // Parse comments from DOM
    comments = parseCommentsFromDom();

    // Backfill sectionId for comments that don't have one
    var needsBackfill = false;
    for (var i = 0; i < comments.length; i++) {
      if (!comments[i].sectionId) {
        var range = findAnchorRange(article, comments[i]);
        if (range) {
          comments[i].sectionId = findSectionId(range.startContainer);
        } else {
          comments[i].sectionId = '_top';
        }
        needsBackfill = true;
      }
    }
    // If we backfilled any sectionIds and in SPA mode, save to persist them
    if (needsBackfill && isSpa && comments.length > 0) {
      saveComments();
    }

    // If comments exist, apply highlights even without comment mode
    if (comments.length > 0 && commentMode) {
      applyHighlights();
    }
  }

  // --- Bind button ---
  var commentBtn = document.getElementById('comment-btn');
  if (commentBtn) {
    commentBtn.addEventListener('click', function(e) {
      e.preventDefault();
      toggleCommentMode();
    });
  }

  // --- Bind nav buttons ---
  var prevBtn = document.getElementById('comment-nav-prev');
  var nextBtn = document.getElementById('comment-nav-next');
  if (prevBtn) prevBtn.addEventListener('click', function(e) { e.preventDefault(); navigateComment(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function(e) { e.preventDefault(); navigateComment(1); });

  // Click outside popup/highlight to close popup and clear current
  document.addEventListener('click', function(e) {
    if (!commentMode) return;
    var inPopup = activePopup && activePopup.contains(e.target);
    var inHighlight = e.target.closest('.comment-highlight, .comment-underline, .comment-add-btn');
    var inNav = e.target.closest('.comment-wrap');
    if (!inPopup && !inHighlight && !inNav) {
      closePopup();
      clearCurrentHighlight();
      currentNavIdx = -1;
      updateNavCounter();
    }
  });

  // Escape to close popup
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activePopup) {
      closePopup();
    }
  });

  // Initial load
  initComments();

  // Expose for SPA navigation re-init
  window.initComments = function(root) {
    // On SPA navigation, re-init
    closePopup();
    closeAddBtn();
    clearCurrentHighlight();
    clearHighlights();
    currentNavIdx = -1;
    initComments(root);
    if (commentMode) {
      applyHighlights();
      updateNavCounter();
    }
  };

  // Expose comment mode state for other modules (e.g. quick-edit)
  window.isCommentMode = function() { return commentMode; };

  // Double-click in comment mode: create comment from the selected word
  document.addEventListener('dblclick', function(e) {
    if (!commentMode || !isSpa) return;
    if (document.body.dataset.pageType !== 'markdown') return;

    var article = e.target.closest('.article');
    if (!article) return;

    // Don't trigger on interactive elements or existing comment highlights
    if (e.target.closest('a, button, input, textarea, select, .comment-popup')) return;

    // Browser double-click selects a word — use that selection
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    var anchorText = sel.toString().trim();
    if (!anchorText || anchorText.length < 1) return;

    e.preventDefault();
    e.stopPropagation();
    createCommentFromSelection();
  });

  // Expose for testing
  if (typeof window !== 'undefined') {
    window._commentsTest = {
      parseCommentsFromDom: parseCommentsFromDom,
      findAnchorRange: findAnchorRange,
      findSectionId: findSectionId,
      genId: genId,
      escHtml: escHtml,
      formatTime: formatTime,
      getComments: function() { return comments; },
      setComments: function(c) { comments = c; },
      navigateComment: navigateComment,
      updateNavCounter: updateNavCounter,
      applyHighlights: applyHighlights,
      getNavIdx: function() { return currentNavIdx; },
      patchSourcepos: patchSourcepos
    };
  }

})();
});
