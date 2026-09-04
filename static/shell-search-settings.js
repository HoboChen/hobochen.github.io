// Site search overlay/panel and the display-preferences Settings
// Panel (theme/font/width controls live in theme-panel.js; this file
// owns the panel shell, kb-shortcuts toggle, and the content-search /
// native-jupyter / quick-edit feature switches). Runs as its own
// top-level DOMContentLoaded listener; collapses sidebars through the
// window._setSidebar bridge exposed by shell-layout.js. The SPA health
// indicator (shell-router.js) independently disables/enables these
// same switches by id when the server connection drops/recovers.
document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('link-preview-embed')) return;

  // ===== Keyboard shortcut global enable/disable =====
  var kbPrefs = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
  var kbEnabled = kbPrefs.kbShortcuts !== 'off';


  // ===== Search =====
  (function() {
    var searchBtn = document.getElementById('search-btn');
    var searchWrap = document.getElementById('search-wrap');
    var inputWrap = document.getElementById('search-input-wrap');
    var input = document.getElementById('search-input');
    var resultsContainer = document.getElementById('search-results');
    if (!searchBtn || !searchWrap || !input || !resultsContainer) return;

    var searchIndex = null;
    var searchIndexPending = null;
    var searchIndexRequestId = 0;
    var searchRenderId = 0;
    var activeIdx = -1;

    function loadIndex(force) {
      if (!force && searchIndex) return Promise.resolve(searchIndex);
      if (!force && searchIndexPending) return searchIndexPending;
      var requestId = ++searchIndexRequestId;
      var indexUrl = document.body.getAttribute('data-spa') === 'true'
        ? '/api/search-index'
        : '/static/search-index.json';
      var request = fetch(indexUrl)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var index = Array.isArray(data) ? data : [];
          if (requestId === searchIndexRequestId) {
            searchIndex = index;
            searchIndexPending = null;
          }
          return index;
        })
        .catch(function() {
          if (requestId === searchIndexRequestId) {
            searchIndex = [];
            searchIndexPending = null;
          }
          return [];
        });
      searchIndexPending = request;
      return request;
    }

    var bannerWasFolded = false;
    var bannerLayoutTransitionProperties = [
      'width',
      'margin-left',
      'margin-right',
      'padding-left',
      'padding-right'
    ];

    function holdBannerLayoutForSearchTransition() {
      if (typeof window._holdBannerLayoutForTransition !== 'function') return;
      window._holdBannerLayoutForTransition(
        searchWrap,
        bannerLayoutTransitionProperties,
        250
      );
    }

    function calcSearchWidth() {
      var bannerEl = document.querySelector('.top-banner');

      // In compact mode the search lives in .banner-right-dropdown and is
      // sized purely by CSS flex (.search-wrap.open { flex: 1; min-width: 0 }).
      // No JS measurement needed — siblings stay on-screen automatically.
      if (bannerEl && bannerEl.classList.contains('banner-compact')) {
        searchWrap.style.removeProperty('--search-max-w');
        return;
      }

      var maxW = Math.max(150, Math.round(window.innerWidth * 0.3));

      // Check if the search box would overlap banner content and hide if needed
      var centerInner = document.querySelector('.banner-center-inner');
      var mainNav = centerInner && centerInner.querySelector('.main-nav');
      var siteTitle = centerInner && centerInner.querySelector('.site-title');
      if (mainNav) mainNav.style.display = '';
      if (siteTitle) siteTitle.style.display = '';

      // Where banner-right's left edge will be when search is open
      // Currently it's at bannerRight.left, but when open the search-wrap
      // grows from searchBtn width (36px) to maxW, pushing banner-right left
      var bannerRightEl = document.querySelector('.banner-right');
      var curLeft = bannerRightEl ? bannerRightEl.getBoundingClientRect().left : window.innerWidth;
      var searchBtnW = searchBtn ? searchBtn.offsetWidth : 36;
      var searchLeft = curLeft - (maxW - searchBtnW);

      function lastContentRight() {
        var edge = 0;
        if (!centerInner) return edge;
        var ch = centerInner.children;
        for (var i = 0; i < ch.length; i++) {
          if (ch[i].style.display === 'none') continue;
          var s = getComputedStyle(ch[i]);
          if (s.position === 'absolute') continue;
          var el = ch[i];
          var r;
          if (el.classList.contains('main-nav')) {
            var items = el.querySelectorAll('.nav-item');
            r = 0;
            for (var ni = items.length - 1; ni >= 0; ni--) {
              if (items[ni].style.display === 'none') continue;
              r = items[ni].getBoundingClientRect().right;
              break;
            }
          } else {
            r = el.getBoundingClientRect().right;
          }
          if (r > edge) edge = r;
        }
        return edge;
      }

      var gap = 16;
      var navSharesTitleRow = !bannerEl ||
        !bannerEl.classList.contains('banner-two-lines');
      // Hide nav items one by one from the right until no overlap with the
      // (about-to-grow) search box on the right.
      if (mainNav && navSharesTitleRow) {
        var items = mainNav.querySelectorAll('.nav-item');
        for (var ni = items.length - 1; ni >= 0; ni--) {
          if (lastContentRight() + gap <= searchLeft) break;
          items[ni].style.display = 'none';
        }
      }
      // If still overlapping after hiding all nav items, hide title
      if (lastContentRight() + gap > searchLeft && siteTitle) {
        siteTitle.style.display = 'none';
      }

      // Symmetrically: if remaining nav items now butt against the left
      // toggle (because the title was hidden / nav shifted left), hide
      // them from the left until clear.
      var bannerLeftEl = document.querySelector('.banner-left');
      if (bannerLeftEl && mainNav && navSharesTitleRow) {
        function firstNavLeft() {
          var its = mainNav.querySelectorAll('.nav-item');
          for (var i = 0; i < its.length; i++) {
            if (its[i].style.display === 'none') continue;
            return its[i].getBoundingClientRect().left;
          }
          return Infinity;
        }
        var leftEdge = bannerLeftEl.getBoundingClientRect().right;
        var its = mainNav.querySelectorAll('.nav-item');
        for (var li = 0; li < its.length; li++) {
          if (firstNavLeft() >= leftEdge + gap) break;
          if (its[li].style.display !== 'none') its[li].style.display = 'none';
        }
      }

      searchWrap.style.setProperty('--search-max-w', maxW + 'px');
    }

    function restoreBannerContent() {
      var mainNav = document.querySelector('.banner-center-inner .main-nav');
      var siteTitle = document.querySelector('.banner-center-inner .site-title');
      if (mainNav) {
        mainNav.style.display = '';
        mainNav.querySelectorAll('.nav-item').forEach(function(item) { item.style.display = ''; });
      }
      if (siteTitle) siteTitle.style.display = '';
    }

    function openSearch() {
      // Temporarily show banner (search box is inside it), without changing storage
      bannerWasFolded = document.body.classList.contains('banner-folded');
      if (bannerWasFolded) {
        document.body.classList.remove('banner-folded');
      }
      // In compact mode, open the dropdown so search-wrap is visible
      var bannerEl = document.querySelector('.top-banner');
      if (bannerEl && bannerEl.classList.contains('banner-compact') && typeof window._openBannerRightDropdown === 'function') {
        window._openBannerRightDropdown();
      }
      calcSearchWidth();
      if (!searchWrap.classList.contains('open')) {
        holdBannerLayoutForSearchTransition();
      }
      searchWrap.classList.add('open');
      input.value = '';
      resultsContainer.innerHTML = '';
      resultsContainer.classList.remove('has-results');
      activeIdx = -1;
      searchRenderId++;
      var refreshLiveIndex = document.body.getAttribute('data-spa') === 'true';
      if (refreshLiveIndex) searchIndex = null;
      // Mobile: focus immediately to trigger keyboard (must be in user gesture context)
      // Desktop: delay focus until expand animation completes (100ms transition)
      if (window.innerWidth <= 1100) {
        input.focus();
      } else {
        setTimeout(function() { input.focus(); }, 100);
      }
      loadIndex(refreshLiveIndex);
    }
    window._openSearch = openSearch;

    function closeSearch() {
      searchRenderId++;
      if (searchWrap.classList.contains('open')) {
        holdBannerLayoutForSearchTransition();
      }
      searchWrap.classList.remove('open');
      resultsContainer.innerHTML = '';
      resultsContainer.classList.remove('has-results', 'hiding');
      activeIdx = -1;
      input.blur();
      restoreBannerContent();
      if (bannerWasFolded) {
        document.body.classList.add('banner-folded');
        bannerWasFolded = false;
      }
    }
    window._closeSearch = closeSearch;

    // SPA-only: two-phase close (fade dropdown, then collapse input)
    window._closeSearchAnimated = function() {
      searchRenderId++;
      var hasResults = resultsContainer.classList.contains('has-results');
      if (hasResults) {
        resultsContainer.classList.add('hiding');
      }
      activeIdx = -1;
      input.blur();
      var delay = hasResults ? 100 : 0;
      setTimeout(function() {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.remove('has-results', 'hiding');
        if (searchWrap.classList.contains('open')) {
          holdBannerLayoutForSearchTransition();
        }
        searchWrap.classList.remove('open');
        restoreBannerContent();
        if (bannerWasFolded) {
          document.body.classList.add('banner-folded');
          bannerWasFolded = false;
        }
      }, delay);
    };

    function highlightMatch(text, query) {
      if (!query) return escapeSearchHtml(text);
      // HTML-escape text to prevent raw < > & from breaking innerHTML
      var safe = escapeSearchHtml(text);
      var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('(' + escaped + ')', 'gi');
      return safe.replace(re, '<mark>$1</mark>');
    }

    function escapeSearchHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Check if content search is enabled (SPA-only lab feature)
    function isContentSearchEnabled() {
      if (document.body.getAttribute('data-spa') !== 'true') return false;
      try {
        var prefs = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
        return prefs.contentSearch !== 'off';
      } catch (e) { return true; }
    }

    var contentSearchPending = null;

    function performContentSearch(query, callback) {
      if (contentSearchPending) {
        contentSearchPending.abort();
      }
      var controller = new AbortController();
      contentSearchPending = controller;

      fetch('/api/content-search?q=' + encodeURIComponent(query), { signal: controller.signal })
        .then(function(r) { return r.json(); })
        .then(function(results) {
          contentSearchPending = null;
          callback(results);
        })
        .catch(function() {
          contentSearchPending = null;
          callback([]);
        });
    }

    function renderResults(query, renderId) {
      if (renderId !== searchRenderId) return;
      if (!query.trim()) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.remove('has-results');
        activeIdx = -1;
        return;
      }
      if (!searchIndex) {
        loadIndex().then(function() { renderResults(query, renderId); });
        return;
      }

      var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      var scored = [];

      for (var i = 0; i < searchIndex.length; i++) {
        var item = searchIndex[i];
        var titleLower = String(item.title).toLowerCase();
        var keywords = Array.isArray(item.keywords) ? item.keywords.join(' ') : (item.keywords || '');
        var pathLower = ((item.category || '') + ' ' + keywords).toLowerCase();
        var allMatch = true;
        var score = 0;

        for (var t = 0; t < terms.length; t++) {
          var term = terms[t];
          var inTitle = titleLower.indexOf(term) !== -1;
          var inPath = pathLower.indexOf(term) !== -1;
          if (!inTitle && !inPath) { allMatch = false; break; }
          if (inTitle) {
            score += 10;
            if (titleLower.indexOf(term) === 0) score += 5;
          }
          if (inPath) score += 3;
        }

        if (allMatch) {
          scored.push({ item: item, score: score });
        }
      }

      scored.sort(function(a, b) { return b.score - a.score; });
      var results = scored.slice(0, 20);

      // If content search is enabled, merge in content results
      if (isContentSearchEnabled() && query.trim().length >= 1) {
        renderResultsWithContent(query, results, renderId);
        return;
      }

      renderResultsHtml(query, results, [], renderId);
    }

    function renderResultsWithContent(query, titleResults, renderId) {
      performContentSearch(query, function(contentResults) {
        renderResultsHtml(query, titleResults, contentResults, renderId);
      });
    }

    function renderResultsHtml(query, titleResults, contentResults, renderId) {
      if (renderId !== searchRenderId) return;
      // Merge and dedupe results, content results that match title are already ranked
      var seenUrls = {};
      var merged = [];

      // Title results first (higher priority)
      for (var i = 0; i < titleResults.length; i++) {
        var r = titleResults[i].item;
        if (!seenUrls[r.url]) {
          seenUrls[r.url] = true;
          merged.push({ item: r, source: 'title' });
        }
      }

      // Content results with snippets
      for (var j = 0; j < contentResults.length; j++) {
        var cr = contentResults[j];
        if (!seenUrls[cr.url]) {
          seenUrls[cr.url] = true;
          merged.push({ item: cr, source: 'content' });
        }
      }

      if (merged.length === 0) {
        resultsContainer.innerHTML = '<div class="search-empty">No results found</div>';
        resultsContainer.classList.add('has-results');
        activeIdx = -1;
        return;
      }

      var html = '';
      var displayLimit = 20;
      for (var k = 0; k < Math.min(merged.length, displayLimit); k++) {
        var m = merged[k];
        var r = m.item;
        var resultUrl = '/' + String(r.url || '').replace(/^\/+/, '');
        html += '<a class="search-result-item" href="' + escapeSearchHtml(resultUrl) + '" data-idx="' + k + '">';
        html += '<div class="search-result-title">' + highlightMatch(String(r.title), query) + '</div>';
        if (r.category) {
          html += '<div class="search-result-path">' + highlightMatch(r.category, '') + '</div>';
        }
        if (m.source === 'content' && r.snippet) {
          html += '<div class="search-result-snippet">' + highlightMatch(r.snippet, query) + '</div>';
        }
        html += '</a>';
      }
      resultsContainer.innerHTML = html;
      resultsContainer.classList.add('has-results');
      activeIdx = -1;
    }

    function setActive(idx) {
      var items = resultsContainer.querySelectorAll('.search-result-item');
      if (items.length === 0) return;
      items.forEach(function(el) { el.classList.remove('active'); });
      if (idx < 0) idx = items.length - 1;
      if (idx >= items.length) idx = 0;
      activeIdx = idx;
      items[activeIdx].classList.add('active');
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    }

    searchBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openSearch();
    });

    // Track IME composition state (for CJK input)
    var isComposing = false;
    input.addEventListener('compositionstart', function() {
      isComposing = true;
    });
    input.addEventListener('compositionend', function() {
      isComposing = false;
      // Trigger search after composition ends
      renderResults(input.value, ++searchRenderId);
    });

    input.addEventListener('input', function() {
      // Skip search during IME composition
      if (isComposing) return;
      renderResults(input.value, ++searchRenderId);
    });

    input.addEventListener('keydown', function(e) {
      var items = resultsContainer.querySelectorAll('.search-result-item');
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(activeIdx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(activeIdx - 1);
      } else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) {
        e.preventDefault();
        var href = items[activeIdx].href;
        // Don't restore hidden state — we're navigating with banner visible
        closeSearch();
        // For same-page hash links, scroll manually accounting for banner
        var url = new URL(href, window.location.origin);
        if (url.pathname === window.location.pathname && url.hash) {
          var el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          if (el) {
            window._kbScrolling = true;
            clearTimeout(window._kbScrollTimer);
            if (!window.RenderOnDemand
                || typeof window.RenderOnDemand.alignHashTarget !== 'function'
                || !window.RenderOnDemand.alignHashTarget(url.hash, 'smooth')) {
              var banner = document.querySelector('.top-banner');
              var bannerH = (banner && !document.body.classList.contains('banner-folded')) ? banner.offsetHeight : 0;
              window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - bannerH - 16, behavior: 'smooth' });
            }
            return;
          }
        }
        window.location.href = href;
      }
    });

    // Close when clicking outside
    document.addEventListener('click', function(e) {
      if (searchWrap.classList.contains('open') && !searchWrap.contains(e.target)) {
        closeSearch();
      }
    });

    // Global keyboard shortcut: Ctrl+K or Cmd+K
    document.addEventListener('keydown', function(e) {
      if (!kbEnabled) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (searchWrap.classList.contains('open')) {
          closeSearch();
        } else {
          openSearch();
        }
      }
    });
  })();

  // ===== Settings Panel =====
  (function() {
    var settingsBtn = document.getElementById('settings-btn');
    var settingsPanel = document.getElementById('settings-panel');
    if (!settingsBtn || !settingsPanel) return;

    // Sidebar collapse is owned by shell-layout.js; re-query the elements
    // here (this file runs as its own top-level DOMContentLoaded listener)
    // and collapse them through the window._setSidebar bridge so there is
    // exactly one implementation of the collapse/expand behavior.
    var leftSidebar = document.getElementById('left-sidebar');
    var rightSidebar = document.getElementById('right-sidebar');
    var leftToggle = document.getElementById('left-toggle');
    var rightToggle = document.getElementById('right-toggle');
    function setSidebar(sidebar, toggle, side, collapsed) {
      if (typeof window._setSidebar === 'function') window._setSidebar(sidebar, toggle, side, collapsed);
    }

    function openSettings() { settingsPanel.classList.add('open'); settingsBtn.classList.add('open'); }
    function closeSettings() { settingsPanel.classList.remove('open'); settingsBtn.classList.remove('open'); }
    function toggleSettings() { settingsPanel.classList.contains('open') ? closeSettings() : openSettings(); }

    settingsBtn.addEventListener('click', function(e) { e.preventDefault(); toggleSettings(); });
    document.addEventListener('click', function(e) {
      if (settingsPanel.classList.contains('open') && !settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
        closeSettings();
      }
    });

    // ===== Offline resource packs (packaged apps only) =====
    var resourceCapabilities = window.RPRINT_APP && window.RPRINT_APP.capabilities;
    var resourceSection = document.getElementById('resource-pack-setting');
    var resourceInput = document.getElementById('resource-pack-input');
    var resourceImportBtn = document.getElementById('resource-pack-import-btn');
    var resourceRollbackBtn = document.getElementById('resource-pack-rollback-btn');
    var resourceStatus = document.getElementById('resource-pack-status');
    if (resourceCapabilities && resourceCapabilities.resourcePackImport === true
        && resourceSection && resourceInput && resourceImportBtn
        && resourceRollbackBtn && resourceStatus) {
      resourceSection.hidden = false;
      var rollbackConfirmTimer = null;

      function setResourceStatus(message, error) {
        resourceStatus.textContent = message || '';
        resourceStatus.classList.toggle('is-error', !!error);
      }

      function setResourceBusy(busy) {
        resourceImportBtn.disabled = busy;
        resourceRollbackBtn.disabled = busy;
      }

      function formatResourceSummary(summary) {
        if (!summary) return '';
        var kinds = summary.byKind || {};
        var parts = [];
        if (kinds.pdf) parts.push(kinds.pdf + ' PDF');
        if (kinds.whiteboard) parts.push(kinds.whiteboard + ' WB');
        if (kinds['pdf-annotation']) {
          parts.push(kinds['pdf-annotation'] + ' PDF annotation');
        }
        var message = parts.length
          ? 'Imported ' + parts.join(', ')
          : 'Resource pack imported';
        if (summary.skipped) message += '; skipped ' + summary.skipped;
        return message + '.';
      }

      function purgeResourcePdfCaches(urls) {
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
        (Array.isArray(urls) ? urls : []).forEach(function(url) {
          navigator.serviceWorker.controller.postMessage({
            type: 'pdf-cache-reset',
            url: new URL(url, window.location.origin).href,
          });
        });
      }

      function refreshResourceStatus() {
        fetch('/api/resource-pack/status', { cache: 'no-store' })
          .then(function(response) {
            if (!response.ok) throw new Error('status unavailable');
            return response.json();
          })
          .then(function(data) {
            resourceRollbackBtn.hidden = !data.rollbackAvailable;
            if (data.lastImport && data.lastImport.summary) {
              setResourceStatus(formatResourceSummary(data.lastImport.summary), false);
            }
            var latestMutation = data.lastRollback || data.lastImport;
            var appliedGeneration = localStorage.getItem(
              'rprint-resource-pack-generation'
            );
            if (navigator.serviceWorker
                && navigator.serviceWorker.controller
                && latestMutation
                && latestMutation.id
                && appliedGeneration !== latestMutation.id) {
              purgeResourcePdfCaches(latestMutation.pdfUrls);
              localStorage.setItem(
                'rprint-resource-pack-generation',
                latestMutation.id
              );
              setTimeout(function() { window.location.reload(); }, 100);
            }
          })
          .catch(function() {
            setResourceStatus('Resource import is unavailable.', true);
            setResourceBusy(true);
          });
      }

      function finishResourceMutation(data) {
        purgeResourcePdfCaches(data && data.pdfUrls);
        if (data && data.generationId) {
          localStorage.setItem(
            'rprint-resource-pack-generation',
            data.generationId
          );
        }
        setTimeout(function() { window.location.reload(); }, 100);
      }

      function handleResourceImportResult(data) {
        setResourceStatus(formatResourceSummary(data.summary), false);
        if (data.changed === false) {
          setResourceBusy(false);
          resourceRollbackBtn.hidden = !data.rollbackAvailable;
          return;
        }
        finishResourceMutation(data);
      }

      resourceImportBtn.addEventListener('click', function() {
        if (window.rprintNative
            && typeof window.rprintNative.importResourcePack === 'function') {
          setResourceBusy(true);
          setResourceStatus('Selecting and importing resources...', false);
          window.rprintNative.importResourcePack()
            .then(function(response) {
              if (response && response.canceled === true) {
                setResourceBusy(false);
                setResourceStatus('', false);
                return;
              }
              var data = response && response.result;
              if (!data || data.ok !== true) {
                throw new Error('Resource import failed.');
              }
              handleResourceImportResult(data);
            })
            .catch(function(error) {
              setResourceBusy(false);
              setResourceStatus(
                error && error.message ? error.message : 'Resource import failed.',
                true
              );
            });
          return;
        }
        resourceInput.value = '';
        resourceInput.click();
      });

      resourceInput.addEventListener('change', function() {
        var file = resourceInput.files && resourceInput.files[0];
        if (!file) return;
        if (!/\.rpack$/i.test(file.name || '')) {
          setResourceStatus('Choose an .rpack file.', true);
          return;
        }
        setResourceBusy(true);
        setResourceStatus('Uploading 0%...', false);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/resource-pack/import');
        xhr.setRequestHeader(
          'Content-Type',
          'application/vnd.rprint.resource-pack'
        );
        xhr.upload.addEventListener('progress', function(event) {
          if (event.lengthComputable) {
            var percent = Math.min(
              100,
              Math.round((event.loaded / event.total) * 100)
            );
            setResourceStatus(
              percent < 100
                ? 'Uploading ' + percent + '%...'
                : 'Validating and installing...',
              false
            );
          }
        });
        xhr.addEventListener('load', function() {
          var data;
          try { data = JSON.parse(xhr.responseText || '{}'); } catch { data = {}; }
          if (xhr.status < 200 || xhr.status >= 300 || !data.ok) {
            setResourceBusy(false);
            setResourceStatus(data.error || 'Resource import failed.', true);
            return;
          }
          handleResourceImportResult(data);
        });
        xhr.addEventListener('error', function() {
          setResourceBusy(false);
          setResourceStatus('Resource import failed. Try again.', true);
        });
        xhr.addEventListener('abort', function() {
          setResourceBusy(false);
          setResourceStatus('Resource import was cancelled.', true);
        });
        xhr.send(file);
      });

      resourceRollbackBtn.addEventListener('click', function() {
        if (!resourceRollbackBtn.classList.contains('confirm')) {
          resourceRollbackBtn.classList.add('confirm');
          resourceRollbackBtn.textContent = 'Click again to restore';
          clearTimeout(rollbackConfirmTimer);
          rollbackConfirmTimer = setTimeout(function() {
            resourceRollbackBtn.classList.remove('confirm');
            resourceRollbackBtn.textContent = 'Undo last import';
          }, 5000);
          return;
        }
        clearTimeout(rollbackConfirmTimer);
        resourceRollbackBtn.classList.remove('confirm');
        resourceRollbackBtn.textContent = 'Undo last import';
        setResourceBusy(true);
        setResourceStatus('Restoring the previous resources...', false);
        fetch('/api/resource-pack/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then(function(response) {
          return response.json().then(function(data) {
            if (!response.ok || !data.ok) {
              throw new Error(data.error || 'Rollback failed');
            }
            return data;
          });
        }).then(finishResourceMutation).catch(function(error) {
          setResourceBusy(false);
          setResourceStatus(error.message || 'Rollback failed.', true);
        });
      });

      refreshResourceStatus();
    }

    // ===== Keyboard shortcut enable/disable switch =====
    var kbSwitch = document.getElementById('kb-enabled-switch');
    if (kbSwitch) {
      kbSwitch.setAttribute('aria-checked', String(kbEnabled));
      kbSwitch.addEventListener('click', function() {
        kbEnabled = !kbEnabled;
        kbSwitch.setAttribute('aria-checked', String(kbEnabled));
        if (window.KbPreferences) {
          window.KbPreferences.set({ kbShortcuts: kbEnabled ? 'on' : 'off' });
        } else {
          var p = JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
          p.kbShortcuts = kbEnabled ? 'on' : 'off';
          localStorage.setItem('kb-display-prefs', JSON.stringify(p));
        }
      });
    }

    // ===== Vim-style keyboard shortcuts =====
    var SCROLL_PX = 200;

    function getHeadings() {
      return Array.from(document.querySelectorAll('.article h1[id], .article h2[id], .article h3[id], .article h4[id], .article h5[id], .article h6[id]'));
    }

    function flashHeading(el) {
      el.classList.remove('kb-flash');
      void el.offsetWidth;
      el.classList.add('kb-flash');
    }

    function jumpSection(dir) {
      var headings = getHeadings();
      if (!headings.length) return;
      var banner = document.querySelector('.top-banner');
      var bannerVisible = banner && !document.body.classList.contains('banner-folded');
      var offset = (bannerVisible ? banner.offsetHeight : 0) + 16;
      var target = null;
      if (dir > 0) {
        for (var i = 0; i < headings.length; i++) {
          if (headings[i].getBoundingClientRect().top > offset + 10) {
            target = headings[i]; break;
          }
        }
      } else {
        for (var i = headings.length - 1; i >= 0; i--) {
          if (headings[i].getBoundingClientRect().top < offset - 10) {
            target = headings[i]; break;
          }
        }
      }
      if (target) {
        window._kbScrolling = true;
        clearTimeout(window._kbScrollTimer);
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
        flashHeading(target);
      }
    }

    document.addEventListener('keydown', function(e) {
      // Skip if user is typing in an input/textarea/contenteditable
      // Exception: ` and Escape can still toggle/close terminal even from within it
      var hasTerminal = typeof window._toggleTerminal === 'function';
      var tag = e.target.tagName;
      var inTerminal = hasTerminal && !!e.target.closest('.terminal-panel, #terminal-fullscreen');
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
        if (!inTerminal) return;
        // Inside terminal: only allow ` and Escape through
        if (e.key !== '`' && e.key !== 'Escape') return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // ? and Esc and ` always work; others require kbEnabled
      if (e.key === '?') { e.preventDefault(); toggleSettings(); return; }
      if (e.key === '`' && hasTerminal) {
        e.preventDefault();
        window._toggleTerminal();
        return;
      }
      if (e.key === 'Escape') {
        var closed = false;
        // Close terminal panel first if open
        if (document.body.classList.contains('terminal-open') && typeof window._toggleTerminal === 'function') {
          window._toggleTerminal(); closed = true;
        }
        if (settingsPanel.classList.contains('open')) { closeSettings(); closed = true; }
        var tp = document.getElementById('style-panel');
        if (tp && tp.classList.contains('open')) { tp.classList.remove('open'); closed = true; }
        if (!closed) {
          if (leftSidebar && !leftSidebar.classList.contains('collapsed') && window.innerWidth <= 1100) {
            setSidebar(leftSidebar, leftToggle, 'left', true);
          }
          if (rightSidebar && !rightSidebar.classList.contains('collapsed') && window.innerWidth <= 1100) {
            setSidebar(rightSidebar, rightToggle, 'right', true);
          }
        }
        return;
      }
      // Two-column spread navigation: PageUp/PageDown jump between spreads
      if (document.body.classList.contains('has-two-columns') &&
          (e.key === 'PageDown' || e.key === 'PageUp')) {
        var spreads = document.querySelectorAll('.article.two-columns .spread');
        if (spreads.length > 0) {
          var bannerEl = document.querySelector('.top-banner');
          var scrollPad = bannerEl ? bannerEl.offsetHeight + 16 : 16;
          if (e.key === 'PageDown') {
            // Find first spread whose top is below the current snap line
            for (var si = 0; si < spreads.length; si++) {
              if (spreads[si].getBoundingClientRect().top > scrollPad + 5) {
                e.preventDefault();
                spreads[si].scrollIntoView({ behavior: 'smooth' });
                return;
              }
            }
          } else {
            // Find last spread whose top is above the current snap line
            for (var si = spreads.length - 1; si >= 0; si--) {
              if (spreads[si].getBoundingClientRect().top < scrollPad - 5) {
                e.preventDefault();
                spreads[si].scrollIntoView({ behavior: 'smooth' });
                return;
              }
            }
          }
        }
        // No spread found in that direction — let browser handle naturally
        return;
      }

      if (!kbEnabled) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          window.scrollBy({ top: SCROLL_PX, behavior: e.repeat ? 'instant' : 'smooth' });
          break;
        case 'k':
          e.preventDefault();
          window.scrollBy({ top: -SCROLL_PX, behavior: e.repeat ? 'instant' : 'smooth' });
          break;
        case 'u':
          e.preventDefault();
          jumpSection(1);
          break;
        case 'i':
          e.preventDefault();
          jumpSection(-1);
          break;
        case 's':
          e.preventDefault();
          if (leftToggle && leftSidebar) leftToggle.click();
          break;
        case 't':
          e.preventDefault();
          if (rightToggle && rightSidebar && !rightToggle.disabled) rightToggle.click();
          break;
        case 'a':
          e.preventDefault();
          var cmtBtn = document.getElementById('comment-btn');
          if (cmtBtn && cmtBtn.style.display !== 'none') cmtBtn.click();
          break;
        case 'f':
          e.preventDefault();
          if (document.body.classList.contains('banner-folded')) {
            if (typeof window._unfoldBanner === 'function') window._unfoldBanner();
          } else {
            if (typeof window._foldBanner === 'function') window._foldBanner();
          }
          break;
      }
    });
  })();

});
