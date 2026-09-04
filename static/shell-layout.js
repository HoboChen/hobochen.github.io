// Layout shell: left/right sidebar toggle + fold/unfold, the site
// banner's fold/unfold and responsive collapse cascade, nav dropdown,
// auto-generated short nav names, and the smart-banner-layout overflow
// logic. Runs as its own top-level DOMContentLoaded listener; exposes
// window._setSidebar / window._initSidebarFold (plus the pre-existing
// window._foldBanner / window._unfoldBanner / window._checkBannerLayout
// / window._adjustRightSidebarWidth / window._setBannerTransitioning /
// window._openBannerRightDropdown) so shell-search-settings.js and
// shell-router.js can drive the exact same layout implementation
// instead of duplicating it.
document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('link-preview-embed')) return;

  // ===== Sidebar toggle =====
  const leftSidebar = document.getElementById('left-sidebar');
  const rightSidebar = document.getElementById('right-sidebar');
  const leftToggle = document.getElementById('left-toggle');
  const rightToggle = document.getElementById('right-toggle');

  const mainLayout = document.querySelector('.main-layout');
  const topBanner = document.querySelector('.top-banner');

  if (leftToggle && leftSidebar) {
    leftToggle.addEventListener('click', () => {
      leftSidebar.classList.toggle('collapsed');
      const collapsed = leftSidebar.classList.contains('collapsed');
      leftToggle.classList.toggle('active', !collapsed);
      if (mainLayout) mainLayout.classList.toggle('left-collapsed', collapsed);
      saveSidebarPrefs({ left: !collapsed });
    });
  }

  // Detect empty TOC or index page type (no TOC panel for auto-generated index)
  const isIndexPage = document.body.dataset.pageType === 'index';
  const tocEmpty = isIndexPage || (rightSidebar && !rightSidebar.querySelector('.toc-list'));

  if (rightToggle && rightSidebar) {
    if (tocEmpty) {
      rightToggle.disabled = true;
      rightToggle.classList.add('disabled');
    }
    rightToggle.addEventListener('click', () => {
      if (rightToggle.disabled) return;
      rightSidebar.classList.toggle('collapsed');
      const collapsed = rightSidebar.classList.contains('collapsed');
      rightToggle.classList.toggle('active', !collapsed);
      if (floatTocBtn) floatTocBtn.classList.toggle('active', !collapsed);
      if (mainLayout) mainLayout.classList.toggle('right-collapsed', collapsed);
      saveSidebarPrefs({ right: !collapsed });
    });
  }

  // ===== Sidebar preference persistence =====
  const sidebarPrefs = JSON.parse(localStorage.getItem('kb-sidebar-prefs') || '{}');

  function saveSidebarPrefs(update) {
    Object.assign(sidebarPrefs, update);
    localStorage.setItem('kb-sidebar-prefs', JSON.stringify(sidebarPrefs));
  }

  // ===== Fold banner toggle =====
  const foldBannerBtn = document.getElementById('fold-banner-btn');
  const unfoldBannerBtn = document.getElementById('unfold-banner-btn');
  const floatTocBtn = document.getElementById('float-toc-btn');

  // Store pre-fold display settings to restore on unfold
  let preFoldWidth = null;
  let preFoldEdge = null;
  let preFoldLeftOpen = false;

  function foldBanner() {
    // Save current width/edge settings before overriding
    try {
      const prefs = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
      preFoldWidth = prefs.contentWidth || 90;
      preFoldEdge = prefs.ignoreCorners === 'on';
    } catch (e) { preFoldWidth = 90; preFoldEdge = false; }
    // Save left sidebar state and collapse if open
    preFoldLeftOpen = leftSidebar && !leftSidebar.classList.contains('collapsed');
    if (preFoldLeftOpen) {
      leftSidebar.classList.add('collapsed');
      if (leftToggle) leftToggle.classList.remove('active');
      if (mainLayout) mainLayout.classList.add('left-collapsed');
    }
    // Apply 100% width + edge-to-edge
    if (window._applyWidth) window._applyWidth(100);
    if (window._applyIgnoreCorners) window._applyIgnoreCorners(true);
    if (window._saveDisplayPrefs) window._saveDisplayPrefs();
    // Add subtle padding if edge-to-edge was not already on
    if (!preFoldEdge) document.body.classList.add('banner-fold-edge');
    // Disable banner clicks during the fold animation
    var foldBan = document.querySelector('.top-banner');
    if (foldBan) {
      foldBan.style.willChange = 'transform';
      foldBan.classList.add('banner-no-click');
      var onFoldEnd = function(e) {
        if (e.propertyName === 'transform') {
          foldBan.removeEventListener('transitionend', onFoldEnd);
          foldBan.classList.remove('banner-no-click');
          foldBan.style.willChange = '';
        }
      };
      foldBan.addEventListener('transitionend', onFoldEnd);
    }
    document.body.classList.add('banner-folded');
    localStorage.setItem('kb-banner-folded', '1');
    localStorage.setItem('kb-banner-fold-prev', JSON.stringify({ width: preFoldWidth, edge: preFoldEdge, leftOpen: preFoldLeftOpen }));
    // Re-chunk 2-column spreads with updated available height
    if (typeof window._refreshTwoColumns === 'function') window._refreshTwoColumns();
  }

  function unfoldBanner() {
    // Restore previous width/edge settings
    let prev = { width: 90, edge: false, leftOpen: false };
    try {
      const stored = localStorage.getItem('kb-banner-fold-prev');
      if (stored) prev = JSON.parse(stored);
    } catch (e) {}
    if (window._applyWidth) window._applyWidth(prev.width);
    if (window._applyIgnoreCorners) window._applyIgnoreCorners(prev.edge);
    if (window._saveDisplayPrefs) window._saveDisplayPrefs();
    // Restore left sidebar if it was open before folding (before measuring)
    if (prev.leftOpen && leftSidebar) {
      leftSidebar.classList.remove('collapsed');
      if (leftToggle) leftToggle.classList.add('active');
      if (mainLayout) mainLayout.classList.remove('left-collapsed');
    }
    // Pre-calculate the correct banner line count at the destination
    // (un-scaled) width BEFORE the animation starts.  This avoids the
    // 3→2→1 line stepping caused by ResizeObserver + getBoundingClientRect
    // measuring the transform-scaled banner mid-transition.
    var ban = document.querySelector('.top-banner');
    if (ban) {
      // 1. Disable CSS transition so changes are instant (no painted frame)
      ban.style.transition = 'none';
      // 2. Remove folded class → scaleX instantly 1 (no animation)
      document.body.classList.remove('banner-folded');
      document.body.classList.remove('banner-fold-edge');
      // 3. Force reflow so the browser applies scaleX(1)
      ban.offsetHeight; // eslint-disable-line no-unused-expressions
      // 4. Measure at full scale → correct line count + height
      if (window._checkBannerLayout) window._checkBannerLayout();
      // 5. Re-add folded class → scaleX back to 0 (still no animation)
      document.body.classList.add('banner-folded');
      // 6. Force reflow so the browser applies scaleX(0)
      ban.offsetHeight; // eslint-disable-line no-unused-expressions
      // 7. Re-enable CSS transition
      ban.style.transition = '';
      // 8. Suppress checkBannerLayout during the animation + disable clicks
      if (window._setBannerTransitioning) window._setBannerTransitioning(true);
      ban.classList.add('banner-no-click');
      ban.style.willChange = 'transform';
      // 9. Now start the real animation: remove folded → smooth scaleX(0→1)
      document.body.classList.remove('banner-folded');
      document.body.classList.remove('banner-fold-edge');
      // 10. On transitionend, clear the suppression flag + re-enable clicks
      var onEnd = function(e) {
        if (e.propertyName === 'transform') {
          ban.removeEventListener('transitionend', onEnd);
          if (window._setBannerTransitioning) window._setBannerTransitioning(false);
          ban.classList.remove('banner-no-click');
          ban.style.willChange = '';
        }
      };
      ban.addEventListener('transitionend', onEnd);
    } else {
      document.body.classList.remove('banner-folded');
      document.body.classList.remove('banner-fold-edge');
    }
    localStorage.removeItem('kb-banner-folded');
    localStorage.removeItem('kb-banner-fold-prev');
    // Re-chunk 2-column spreads with updated available height
    if (typeof window._refreshTwoColumns === 'function') window._refreshTwoColumns();
  }

  window._foldBanner = foldBanner;
  window._unfoldBanner = unfoldBanner;

  // Prevent fold/unfold/TOC buttons from stealing focus (e.g. from terminal)
  [foldBannerBtn, unfoldBannerBtn, floatTocBtn].forEach(function(btn) {
    if (btn) btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
  });

  if (foldBannerBtn) {
    foldBannerBtn.addEventListener('click', foldBanner);
  }
  if (unfoldBannerBtn) {
    unfoldBannerBtn.addEventListener('click', unfoldBanner);
  }
  if (floatTocBtn && rightSidebar) {
    if (tocEmpty) {
      floatTocBtn.style.display = 'none';
    }
    floatTocBtn.addEventListener('click', () => {
      if (floatTocBtn.disabled) return;
      rightSidebar.classList.toggle('collapsed');
      const collapsed = rightSidebar.classList.contains('collapsed');
      floatTocBtn.classList.toggle('active', !collapsed);
      if (rightToggle) rightToggle.classList.toggle('active', !collapsed);
      if (mainLayout) mainLayout.classList.toggle('right-collapsed', collapsed);
      saveSidebarPrefs({ right: !collapsed });
    });
  }

  // Restore fold state
  if (localStorage.getItem('kb-banner-folded') === '1') {
    document.body.classList.add('banner-folded');
    try {
      const prev = JSON.parse(localStorage.getItem('kb-banner-fold-prev') || '{}');
      if (!prev.edge) document.body.classList.add('banner-fold-edge');
    } catch (e) {}
  }

  // ===== Smart defaults based on screen width =====
  function applyResponsiveDefaults() {
    const w = window.innerWidth;
    const rightForceCollapsed = tocEmpty;
    if (w >= 1400) {
      setSidebar(leftSidebar, leftToggle, 'left', sidebarPrefs.left !== undefined ? !sidebarPrefs.left : false);
      setSidebar(rightSidebar, rightToggle, 'right', rightForceCollapsed || (sidebarPrefs.right !== undefined ? !sidebarPrefs.right : false));
    } else if (w >= 1100) {
      setSidebar(leftSidebar, leftToggle, 'left', sidebarPrefs.left !== undefined ? !sidebarPrefs.left : true);
      setSidebar(rightSidebar, rightToggle, 'right', rightForceCollapsed || (sidebarPrefs.right !== undefined ? !sidebarPrefs.right : false));
    } else {
      setSidebar(leftSidebar, leftToggle, 'left', true);
      setSidebar(rightSidebar, rightToggle, 'right', true);
    }
  }

  function setSidebar(sidebar, toggle, side, collapsed) {
    if (!sidebar || !toggle) return;
    sidebar.classList.toggle('collapsed', collapsed);
    toggle.classList.toggle('active', !collapsed);
    if (mainLayout) mainLayout.classList.toggle(side + '-collapsed', collapsed);
    if (side === 'right' && floatTocBtn) floatTocBtn.classList.toggle('active', !collapsed);
  }
  window._setSidebar = setSidebar;

  // Apply initial sidebar state with no transitions
  applyResponsiveDefaults();

  // Enable transitions after initial state is painted
  const article = document.querySelector('.article');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (leftSidebar) leftSidebar.classList.add('animated');
      if (rightSidebar) rightSidebar.classList.add('animated');
      if (article) article.classList.add('animated');
    });
  });

  // Snap .article width to a DPR-aligned pixel grid so canvas-based
  // children (pdf.js, whiteboard) don't get gaps in spread layouts.
  //
  // pdf.js uses approximateFraction(devicePixelRatio) to compute a
  // rounding denominator (sfx[1]) for CSS page widths — pages are
  // snapped to multiples of sfx[1] pixels.  In spread mode, two pages
  // must fill the host width: 2 × round(down, hostWidth/2, sfx[1]).
  // This only equals hostWidth when hostWidth is divisible by 2×sfx[1].
  //
  // Example: DPR 20/11 → sfx[1]=4 → snapUnit=8.
  //   host=1340: 1340%8=4 → each page=668, total=1336, 4px gap
  //   host=1656: 1656%8=0 → each page=828, total=1656, perfect
  //
  // We replicate approximateFraction here to compute the snap unit,
  // then floor .article's border-box width to the nearest multiple.
  // Since .article padding is always a multiple of the snap unit
  // (0 or 32px), border-box alignment → content-box alignment.
  //
  // Triggers that change .article width:
  //   - window resize           → .article resizes → RO fires
  //   - --content-max-width %   → CSS var on documentElement.style
  //   - sidebar toggle          → class change on .main-layout
  //   - banner fold/unfold      → class change on body
  //
  // We observe .article directly via ResizeObserver to snap widths.
  // However, the inline max-width can prevent CSS changes from taking
  // effect (inline > stylesheet), so the RO wouldn't fire.
  // A MutationObserver on the relevant elements clears the stale inline
  // style when CSS variables or layout classes change, allowing the RO
  // to re-snap.
  if (article && typeof ResizeObserver !== 'undefined') {
    // Replicate pdf.js approximateFraction to derive the snap unit.
    // Returns [numerator, denominator] that approximate x = n/d with d ≤ 8.
    function approxFrac(x) {
      if (Math.floor(x) === x) return [x, 1];
      var xinv = 1 / x;
      if (xinv > 8) return [1, 8];
      if (Math.floor(xinv) === xinv) return [1, xinv];
      var x_ = x > 1 ? xinv : x;
      var a = 0, b = 1, c = 1, d = 1;
      while (true) {
        var p = a + c, q = b + d;
        if (q > 8) break;
        if (x_ <= p / q) { c = p; d = q; } else { a = p; b = q; }
      }
      return (x_ - a / b < c / d - x_)
        ? (x_ === x ? [a, b] : [b, a])
        : (x_ === x ? [c, d] : [d, c]);
    }
    var dpr = window.devicePixelRatio || 1;
    var sfx1 = approxFrac(dpr)[1]; // CSS pixel rounding denominator
    var snapUnit = 2 * sfx1;       // spread mode: 2 pages per row

    var _snapRaf = 0;
    var _snapSetting = false;
    new ResizeObserver(function() {
      if (_snapSetting) return;
      if (_snapRaf) return;
      _snapRaf = requestAnimationFrame(function() {
        _snapRaf = 0;
        _snapSetting = true;
        article.style.maxWidth = '';
        var w = article.getBoundingClientRect().width;
        var snapped = Math.floor(w / snapUnit) * snapUnit;
        if (snapped !== w) article.style.maxWidth = snapped + 'px';
        _snapSetting = false;
      });
    }).observe(article);

    // Clear stale inline max-width when CSS variables or layout classes
    // change — the inline style would otherwise prevent the article from
    // resizing, so the ResizeObserver above would never fire.
    //
    // IMPORTANT: only react to --content-max-width changes on
    // documentElement, not every style mutation — checkBannerLayout sets
    // other CSS vars (--corner-*-width) on the same element during
    // resize, which would clear the snap and cause oscillation.
    if (typeof MutationObserver !== 'undefined') {
      var _lastCMW = document.documentElement.style.getPropertyValue('--content-max-width');
      var snapMo = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.target === document.documentElement && m.attributeName === 'style') {
            var cmw = document.documentElement.style.getPropertyValue('--content-max-width');
            if (cmw === _lastCMW) continue; // irrelevant style change
            _lastCMW = cmw;
          }
          if (article.style.maxWidth) { article.style.maxWidth = ''; break; }
        }
      });
      // --content-max-width is set on documentElement.style by themes.js
      snapMo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
      // banner-folded class toggle on body
      snapMo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      // sidebar collapsed class toggles on .main-layout
      if (mainLayout) snapMo.observe(mainLayout, { attributes: true, attributeFilter: ['class'] });
    }

    // Clear stale inline max-width on viewport resize so the
    // ResizeObserver can re-measure.  Without this, the article stays
    // frozen at its old snapped value when the viewport grows within
    // the same breakpoint tier (no sidebar class change → MO doesn't
    // fire → RO doesn't fire because article size is capped).
    window.addEventListener('resize', function() {
      if (article.style.maxWidth) article.style.maxWidth = '';
    });
  }

  // ===== Smart left sidebar fold/unfold =====
  var _sidebarFoldHandlers = [];

  function initSidebarFold() {
    // Clean up previous handlers
    _sidebarFoldHandlers.forEach(function(h) { h.el.removeEventListener('click', h.fn); });
    _sidebarFoldHandlers = [];

    var sidebar = document.getElementById('spa-sidebar') || (leftSidebar && leftSidebar.querySelector('.sidebar-content'));
    if (!sidebar) return;

    // 1. Attach click-to-toggle handlers on toggle buttons
    var groups = sidebar.querySelectorAll('.sidebar-group');
    var hasChildrenItems = sidebar.querySelectorAll('.sidebar-list li.has-children');
    var toggles = sidebar.querySelectorAll('.sidebar-toggle');
    toggles.forEach(function(toggle) {
      var handler = function(e) {
        e.preventDefault();
        e.stopPropagation();
        var target = toggle.closest('li');
        if (target) target.classList.toggle('open');
      };
      toggle.addEventListener('click', handler);
      _sidebarFoldHandlers.push({ el: toggle, fn: handler });
    });

    // 3. Ensure ancestor path of active item is expanded
    var activeItem = sidebar.querySelector('li.active');
    if (activeItem) {
      var el = activeItem.parentElement;
      while (el && el !== sidebar) {
        if (el.classList.contains('sidebar-group')) {
          el.classList.add('open');
        }
        if (el.parentElement && el.parentElement.classList.contains('has-children')) {
          el.parentElement.classList.add('open');
        }
        el = el.parentElement;
      }
      // Also expand the active item itself if it has children
      if (activeItem.classList.contains('has-children')) {
        activeItem.classList.add('open');
      }
    }

    // 4. Smart expansion: fill available height without scrolling
    smartExpandSidebar(sidebar, groups, hasChildrenItems);
  }
  window._initSidebarFold = initSidebarFold;

  function smartExpandSidebar(sidebar, groups, hasChildrenItems) {
    var container = leftSidebar || sidebar.closest('.left-sidebar');
    if (!container) return;

    var availableHeight = container.clientHeight * 2 / 3;
    if (availableHeight <= 0) return;

    // Temporarily disable transitions for measurement
    sidebar.style.transition = 'none';
    sidebar.querySelectorAll('.sidebar-group > ul, .sidebar-subpages').forEach(function(el) {
      el.style.transition = 'none';
    });

    // Build candidate list: groups not already open, sorted by priority
    var candidates = [];
    groups.forEach(function(group, idx) {
      if (group.classList.contains('open')) return;
      var priority = parseInt(group.dataset.priority, 10);
      if (isNaN(priority)) priority = idx;
      candidates.push({ el: group, priority: priority, type: 'group' });
    });
    candidates.sort(function(a, b) { return a.priority - b.priority; });

    // Also collect subpage candidates within already-open groups
    var subCandidates = [];
    hasChildrenItems.forEach(function(item) {
      if (item.classList.contains('open')) return;
      // Only consider items inside already-open groups or root-level items
      var parentGroup = item.closest('.sidebar-group');
      if (parentGroup && !parentGroup.classList.contains('open')) return;
      var p = parseInt(item.dataset.priority, 10);
      if (isNaN(p)) p = 999;
      subCandidates.push({ el: item, priority: p, type: 'subpage' });
    });
    subCandidates.sort(function(a, b) { return a.priority - b.priority; });

    // Progressive expansion: try opening each candidate, check if it fits
    function tryExpand(list) {
      for (var i = 0; i < list.length; i++) {
        var candidate = list[i];
        candidate.el.classList.add('open');
        // Force layout recalc
        var scrollH = sidebar.scrollHeight;
        if (scrollH > availableHeight) {
          candidate.el.classList.remove('open');
          break;
        }
      }
    }

    tryExpand(candidates);

    // After expanding groups, try subpage trees within newly opened groups
    var newSubCandidates = [];
    hasChildrenItems.forEach(function(item) {
      if (item.classList.contains('open')) return;
      var parentGroup = item.closest('.sidebar-group');
      if (parentGroup && !parentGroup.classList.contains('open')) return;
      var p = parseInt(item.dataset.priority, 10);
      if (isNaN(p)) p = 999;
      newSubCandidates.push({ el: item, priority: p, type: 'subpage' });
    });
    newSubCandidates.sort(function(a, b) { return a.priority - b.priority; });
    tryExpand(newSubCandidates);

    // Re-enable transitions
    // Use rAF to ensure the no-transition state is painted first
    requestAnimationFrame(function() {
      sidebar.style.transition = '';
      sidebar.querySelectorAll('.sidebar-group > ul, .sidebar-subpages').forEach(function(el) {
        el.style.transition = '';
      });
    });
  }

  // Run on initial page load
  initSidebarFold();

  // ===== Auto-size right sidebar based on TOC content =====
  function adjustRightSidebarWidth() {
    var defaultWidth = 260; // matches --sidebar-width (left panel)
    var maxWidth = 400;

    // Reset to default first (match left sidebar width)
    document.documentElement.style.setProperty('--right-sidebar-width', defaultWidth + 'px');

    var tocList = document.querySelector('.right-sidebar .toc-list');
    if (!tocList) return;

    // Check if any TOC link actually wraps at the default width.
    // Use rAF so layout settles after the reset above.
    requestAnimationFrame(function() {
      var links = tocList.querySelectorAll('.toc-heading a, .toc-section.open .toc-children a');
      var hasWrap = false;
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        // A link wraps if its scrollHeight exceeds ~1.5× a single line
        var lineH = parseFloat(getComputedStyle(link).lineHeight) || 20;
        if (link.scrollHeight > lineH * 1.5) {
          hasWrap = true;
          break;
        }
      }
      if (!hasWrap) return; // fits fine at default width

      // Measure natural (nowrap) width to find the needed size
      var clone = tocList.cloneNode(true);
      clone.style.cssText = 'position:absolute;visibility:hidden;width:auto;white-space:nowrap;';
      document.body.appendChild(clone);
      var naturalWidth = clone.scrollWidth + 32; // 16px padding each side
      document.body.removeChild(clone);

      if (naturalWidth > defaultWidth) {
        var targetWidth = Math.min(naturalWidth, maxWidth);
        document.documentElement.style.setProperty('--right-sidebar-width', targetWidth + 'px');
      }
    });
  }

  window._adjustRightSidebarWidth = adjustRightSidebarWidth;
  adjustRightSidebarWidth();

  // ===== Close sidebars on content click (floating) =====
  const content = document.getElementById('content');
  if (content) {
    content.addEventListener('click', () => {
      if (window.innerWidth <= 1100) {
        if (leftSidebar && !leftSidebar.classList.contains('collapsed')) {
          setSidebar(leftSidebar, leftToggle, 'left', true);
        }
        if (rightSidebar && !rightSidebar.classList.contains('collapsed')) {
          setSidebar(rightSidebar, rightToggle, 'right', true);
        }
      }
    });
  }

  // ===== Nav dropdown: click-to-toggle for touch devices =====
  (function() {
    var navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(function(item) {
      var link = item.querySelector('.nav-link');
      var dropdown = item.querySelector('.nav-dropdown');
      if (!link || !dropdown) return;
      link.addEventListener('click', function(e) {
        // On touch devices (no hover), toggle dropdown instead of navigating
        if (!window.matchMedia('(hover: hover)').matches) {
          e.preventDefault();
          var wasOpen = item.classList.contains('open');
          // Close all other open dropdowns
          navItems.forEach(function(other) { other.classList.remove('open'); });
          if (!wasOpen) item.classList.add('open');
        }
      });
    });
    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.nav-item')) {
        navItems.forEach(function(item) { item.classList.remove('open'); });
      }
    });
    // Close dropdowns when clicking a link inside a dropdown (mobile)
    document.querySelectorAll('.nav-dropdown a').forEach(function(a) {
      a.addEventListener('click', function() {
        navItems.forEach(function(item) { item.classList.remove('open'); });
      });
    });
  })();

  // ===== Auto-generate short names for nav links missing data-short =====
  (function() {
    var navLinks = document.querySelectorAll('.nav-link');
    var used = {};
    navLinks.forEach(function(link) {
      var short = link.getAttribute('data-short');
      if (short && short !== link.textContent) { used[short] = true; }
    });
    navLinks.forEach(function(link) {
      if (!link.getAttribute('data-short') || link.getAttribute('data-short') === link.textContent) {
        var name = link.textContent.trim();
        var abbr = name.split(/[\s\-]+/).map(function(w){ return w[0]; }).join('').toUpperCase();
        // Disambiguate by appending name characters; fall back to a numeric
        // suffix if the source name is exhausted (avoids an infinite loop
        // when two links share the same auto-abbreviation).
        var suffixI = 0;
        while (used[abbr]) {
          var ch = name.charAt(abbr.length);
          if (ch) {
            abbr += ch;
          } else {
            suffixI += 1;
            abbr = abbr.replace(/\d+$/, '') + suffixI;
          }
        }
        used[abbr] = true;
        link.setAttribute('data-short', abbr);
      }
    });
    var title = document.querySelector('.site-title');
    if (title && (!title.getAttribute('data-short') || title.getAttribute('data-short') === title.textContent.trim())) {
      var name = title.textContent.trim();
      var abbr = name.split(/[\s\-]+/).map(function(w){ return w[0]; }).join('').toUpperCase();
      title.setAttribute('data-short', abbr);
    }
  })();


  // ===== Smart banner layout =====
  (function() {
    var navList = document.querySelector('.nav-list');
    var mainNav = document.querySelector('.main-nav');
    var banner = document.querySelector('.top-banner');
    var centerInner = document.querySelector('.banner-center-inner');
    var bannerLeft = document.querySelector('.banner-left');
    var bannerRight = document.querySelector('.banner-right');
    if (!navList || !mainNav || !banner || !centerInner || !bannerRight) return;

    // Publish actual corner widths as CSS vars so layout rules don't need to
    // hard-code 44px / 52px guesses.
    function updateCornerVars() {
      var lw = bannerLeft ? Math.ceil(bannerLeft.getBoundingClientRect().width) : 0;
      var rw = bannerRight ? Math.ceil(bannerRight.getBoundingClientRect().width) : 0;
      document.documentElement.style.setProperty('--banner-left-w', lw + 'px');
      document.documentElement.style.setProperty('--banner-right-w', rw + 'px');
    }

    function navOverflows() {
      return navList.scrollWidth > mainNav.clientWidth;
    }

    function getNotchBounds() {
      var root = document.documentElement;
      if (!root.classList.contains('electron-notch-fullscreen')) return null;
      var styles = window.getComputedStyle(root);
      var left = parseFloat(styles.getPropertyValue('--electron-notch-left'));
      var right = parseFloat(styles.getPropertyValue('--electron-notch-right'));
      var viewportWidth = window.innerWidth || root.clientWidth || 0;
      if (!isFinite(left) || !isFinite(right) || left <= 0 || right <= left ||
          (viewportWidth > 0 && right >= viewportWidth)) return null;
      return { left: left, right: right };
    }

    function bannerOverflows() {
      // Measure natural content width without constraints. Temporarily disable
      // the .main-nav `flex: 1` so it expands to its real content width
      // instead of collapsing under `width: max-content` on the parent.
      var oldW = centerInner.style.width;
      var oldMW = centerInner.style.maxWidth;
      var oldFlex = mainNav.style.flex;
      centerInner.style.width = 'max-content';
      centerInner.style.maxWidth = 'none';
      mainNav.style.flex = '0 0 auto';
      var contentLeft = Infinity;
      var contentRight = -Infinity;
      var sawVisibleContent = false;
      var measuredVisibleContent = false;
      var centerChildren = centerInner.children;
      function includeVisibleRect(el) {
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.position === 'absolute') return;
        sawVisibleContent = true;
        var childRect = el.getBoundingClientRect();
        if (childRect.width <= 0) return;
        measuredVisibleContent = true;
        contentLeft = Math.min(contentLeft, childRect.left);
        contentRight = Math.max(contentRight, childRect.right);
      }
      for (var ci = 0; ci < centerChildren.length; ci++) {
        var child = centerChildren[ci];
        if (child === mainNav) {
          var navStyle = window.getComputedStyle(mainNav);
          if (navStyle.display === 'none' || navStyle.position === 'absolute') continue;
          var navItems = mainNav.querySelectorAll('.nav-item');
          for (var ni = 0; ni < navItems.length; ni++) includeVisibleRect(navItems[ni]);
        } else {
          includeVisibleRect(child);
        }
      }
      // jsdom has no layout engine, so keep geometry-mocked unit tests useful
      // when visible children report zero-sized rectangles.
      if (sawVisibleContent && !measuredVisibleContent) {
        var fallbackRect = centerInner.getBoundingClientRect();
        if (fallbackRect.width > 0 || fallbackRect.right > fallbackRect.left) {
          measuredVisibleContent = true;
          contentLeft = fallbackRect.left;
          contentRight = fallbackRect.right;
        }
      }
      centerInner.style.width = oldW;
      centerInner.style.maxWidth = oldMW;
      mainNav.style.flex = oldFlex;
      var rightRect = bannerRight.getBoundingClientRect();
      var notch = getNotchBounds();
      if (notch) {
        if (measuredVisibleContent && contentRight > notch.left - 12) return true;
        if (rightRect.width > 0 && rightRect.left < notch.right + 12) return true;
      }
      // The title row always shares space with the visible corner controls,
      // including compact mode (dots + fold + TOC).
      if (!notch && measuredVisibleContent) {
        if ((rightRect.width > 0 || rightRect.left > 0) &&
            contentRight > rightRect.left - 8) return true;
        if (rightRect.width <= 0 && rightRect.left <= 0) {
          var vpRight = window.innerWidth || document.documentElement.clientWidth || 0;
          if (vpRight > 0 && contentRight > vpRight - 8) return true;
        }
      }
      // Left-collision applies in every mode — the toggle stays in the
      // top-left corner across all line counts. Strict `<` (no slack):
      // the CSS already reserves space via
      //   margin-left: max(calc(var(--banner-left-w) + 16px), …)
      // so flush layouts (contentLeft == leftRect.right) are healthy
      // and must not trip the check. See regression test
      // 'left-collision uses strict overlap, not 8px slack'.
      if (bannerLeft && measuredVisibleContent) {
        var leftRect = bannerLeft.getBoundingClientRect();
        if (leftRect.width > 0 && contentLeft < leftRect.right) return true;
      }
      return false;
    }

    // Banner layout cascade — 12 states ordered from "most expanded" to
    // "most compact". Three orthogonal axes:
    //   mode        ∈ {1-line, 2-line, compact}
    //   titleShort  ∈ {false, true}  (full vs. data-short site title)
    //   navShort    ∈ {false, true}  (full vs. data-short nav links)
    //
    // Sub-order within each line tier: full → short title → short nav →
    // short both. (Title is shortened before nav so a long site name on a
    // narrow viewport doesn't force the nav to abbreviate first.)
    //
    // checkBannerLayout() always evaluates this same ordered sequence from
    // the beginning, so the selected state is independent of resize direction.
    var BANNER_STATES = [
      { lines: 1, titleShort: false, navShort: false },
      { lines: 1, titleShort: true,  navShort: false },
      { lines: 1, titleShort: false, navShort: true  },
      { lines: 1, titleShort: true,  navShort: true  },
      { lines: 2, titleShort: false, navShort: false },
      { lines: 2, titleShort: true,  navShort: false },
      { lines: 2, titleShort: false, navShort: true  },
      { lines: 2, titleShort: true,  navShort: true  },
      // Compact mode: 2-line height (86px), non-corner controls available
      // through the dropdown. Keep full-title candidates so compact remains
      // reachable when a site title has no distinct short form.
      { lines: 2, titleShort: false, navShort: false, compact: true },
      { lines: 2, titleShort: true,  navShort: false, compact: true },
      { lines: 2, titleShort: false, navShort: true,  compact: true },
      { lines: 2, titleShort: true,  navShort: true,  compact: true }
    ];
    var BANNER_HEIGHTS = { 1: 56, 2: 86 };

    // --- Compact-mode dropdown for .banner-right ---
    // When the cascade reaches compact mode, most .banner-right children are
    // hidden (CSS display:none).  The dots toggle moves them into a separate
    // .banner-right-dropdown container so they appear in a second row without
    // displacing the toggle/fold/TOC buttons from row 1.
    var bannerRightToggle = document.querySelector('.banner-right-toggle');
    var dropdownEl = document.querySelector('.banner-right-dropdown');
    var bannerRightDropdown = null; // open state
    // Remember insertion point so items return to the right place
    var _brFirstToggle = bannerRight.querySelector('.banner-toggle');

    function closePanels() {
      var sp = document.getElementById('settings-panel');
      var sb = document.getElementById('settings-btn');
      if (sp) sp.classList.remove('open');
      if (sb) sb.classList.remove('open');
      var tp = document.getElementById('style-panel');
      var tb = document.getElementById('theme-btn');
      if (tp) tp.classList.remove('open');
      if (tb) tb.classList.remove('open');
    }

    function openBannerRightDropdown() {
      if (bannerRightDropdown || !dropdownEl) return;
      closePanels();
      // Move non-toggle, non-dots children from .banner-right → .banner-right-dropdown
      var items = bannerRight.querySelectorAll(':scope > *:not(.banner-toggle):not(.banner-right-toggle)');
      for (var i = 0; i < items.length; i++) dropdownEl.appendChild(items[i]);
      banner.classList.add('banner-right-open');
      if (bannerRightToggle) bannerRightToggle.classList.add('active');
      bannerRightDropdown = true;
    }

    function closeBannerRightDropdown() {
      if (!bannerRightDropdown || !dropdownEl) return;
      closePanels();
      // Move items back from .banner-right-dropdown → .banner-right (before fold/TOC)
      while (dropdownEl.firstChild) {
        bannerRight.insertBefore(dropdownEl.firstChild, _brFirstToggle);
      }
      banner.classList.remove('banner-right-open');
      if (bannerRightToggle) bannerRightToggle.classList.remove('active');
      bannerRightDropdown = null;
    }

    function toggleBannerRightDropdown() {
      bannerRightDropdown ? closeBannerRightDropdown() : openBannerRightDropdown();
    }

    // Expose for search to open dropdown in compact mode
    window._openBannerRightDropdown = openBannerRightDropdown;

    // Persistent outside-click listener: always active, checks open state.
    // Avoids the setTimeout race where a one-shot closer registered via
    // setTimeout(0) fires on the same click that opened the dropdown.
    document.addEventListener('click', function(e) {
      if (!bannerRightDropdown) return;
      if (bannerRight && bannerRight.contains(e.target)) return;
      if (dropdownEl && dropdownEl.contains(e.target)) return;
      if (bannerRightToggle && bannerRightToggle.contains(e.target)) return;
      closeBannerRightDropdown();
    }, true);

    if (bannerRightToggle) {
      bannerRightToggle.addEventListener('click', toggleBannerRightDropdown);
      bannerRightToggle.addEventListener('mousedown', function(e) { e.preventDefault(); });
    }
    // Close dropdown on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && bannerRightDropdown) closeBannerRightDropdown();
    });

    function applyBannerState(s) {
      banner.classList.toggle('banner-two-lines', s.lines === 2 && !s.compact);
      banner.classList.toggle('banner-compact', !!s.compact);
      banner.classList.toggle('title-short', !!s.titleShort);
      navList.classList.toggle('nav-abbreviated', !!s.navShort);
      // Close dropdown when leaving compact mode
      if (!s.compact && bannerRightDropdown) closeBannerRightDropdown();
      document.documentElement.style.setProperty(
        '--banner-height',
        'calc(' + BANNER_HEIGHTS[s.lines] + 'px + var(--safe-area-top, 0px))'
      );
    }

    // A state "fits" depends on the line tier:
    //   1-line: nav shares the row with the title via `flex: 1`, so
    //     `navList.scrollWidth > mainNav.clientWidth` is almost always
    //     true (mainNav is squeezed by flex); it does NOT indicate real
    //     overflow. bannerOverflows() — which measures with
    //     `width: max-content` and `flex: 0 0 auto` — is the only
    //     reliable signal here.
    //   2-line/compact: nav has a dedicated full-width row with
    //     `flex-wrap: nowrap`, so navOverflows() is a real clip signal
    //     in addition to bannerOverflows() guarding the title row.
    function stateFits(s) {
      if (s.lines === 1) return !bannerOverflows();
      return !bannerOverflows() && !navOverflows();
    }

    // If the site title has no [data-short] attribute (or it's empty/equal
    // to the visible text), the titleShort=true states are visually
    // identical to titleShort=false ones — picking one over the other would
    // make the cascade non-deterministic when re-entered from the opposite
    // direction. Skip them so each width maps to a single canonical state.
    function siteTitleHasShort() {
      var t = centerInner && centerInner.querySelector('.site-title');
      if (!t) return false;
      var s = t.getAttribute('data-short');
      if (!s) return false;
      s = s.trim();
      return s.length > 0 && s !== t.textContent.trim();
    }

    // Suppression state prevents responsive checks from measuring transient
    // animation frames. Resize/window signals received while held are folded
    // into one final requestAnimationFrame check.
    var bannerTransitioning = false;
    var bannerLayoutHoldCount = 0;
    var bannerLayoutDirty = false;

    function bannerLayoutSuspended() {
      return bannerTransitioning || bannerLayoutHoldCount > 0;
    }

    function holdBannerLayout() {
      bannerLayoutHoldCount++;
      var released = false;
      return function() {
        if (released) return;
        released = true;
        bannerLayoutHoldCount = Math.max(0, bannerLayoutHoldCount - 1);
        bannerLayoutDirty = true;
        if (!bannerLayoutSuspended()) schedule();
      };
    }

    function holdBannerLayoutForTransition(container, propertyNames, timeoutMs) {
      if (!container || !container.addEventListener) return function() {};
      var releaseHold = holdBannerLayout();
      var active = new Map();
      var sawTransition = false;
      var finished = false;
      var noTransitionRaf = null;
      var settleRaf = null;
      var allowed = propertyNames || [];

      function matches(e) {
        return container.contains(e.target) && allowed.indexOf(e.propertyName) !== -1;
      }

      function removeListeners() {
        container.removeEventListener('transitionrun', onRun, true);
        container.removeEventListener('transitionend', onDone, true);
        container.removeEventListener('transitioncancel', onDone, true);
      }

      function finish() {
        if (finished) return;
        finished = true;
        removeListeners();
        clearTimeout(timer);
        if (noTransitionRaf !== null) cancelAnimationFrame(noTransitionRaf);
        if (settleRaf !== null) cancelAnimationFrame(settleRaf);
        releaseHold();
      }

      function onRun(e) {
        if (!matches(e)) return;
        sawTransition = true;
        if (settleRaf !== null) {
          cancelAnimationFrame(settleRaf);
          settleRaf = null;
        }
        var properties = active.get(e.target);
        if (!properties) {
          properties = {};
          active.set(e.target, properties);
        }
        properties[e.propertyName] = true;
      }

      function onDone(e) {
        if (!matches(e)) return;
        var properties = active.get(e.target);
        if (properties) {
          delete properties[e.propertyName];
          if (Object.keys(properties).length === 0) active.delete(e.target);
        }
        if (sawTransition && active.size === 0 && settleRaf === null) {
          settleRaf = requestAnimationFrame(function() {
            settleRaf = null;
            if (active.size === 0) finish();
          });
        }
      }

      container.addEventListener('transitionrun', onRun, true);
      container.addEventListener('transitionend', onDone, true);
      container.addEventListener('transitioncancel', onDone, true);
      var timer = setTimeout(finish, timeoutMs || 250);
      noTransitionRaf = requestAnimationFrame(function() {
        noTransitionRaf = requestAnimationFrame(function() {
          noTransitionRaf = null;
          if (!sawTransition) finish();
        });
      });
      return finish;
    }

    function checkBannerLayout() {
      if (bannerLayoutSuspended()) {
        bannerLayoutDirty = true;
        return;
      }
      // If the compact-mode buttons dropdown is open, close it silently
      // before measuring.  The dropdown moves children OUT of .banner-right
      // into a separate row, so measuring with it open hides the true
      // .banner-right footprint and makes the cascade pick the wrong tier.
      // After the cascade we reopen the dropdown only if the chosen state
      // is still compact — if the viewport is now wide enough for 1- or
      // 2-line, the dropdown disappears with the compact tier (correct).
      var wasCompact = banner.classList.contains('banner-compact');
      var dropdownWasOpen = !!bannerRightDropdown;
      var searchIsOpen = document.getElementById('search-wrap');
      var commentIsOpen = document.getElementById('comment-wrap');
      var activeControlNeedsDropdown = !wasCompact && (
        (searchIsOpen && searchIsOpen.classList.contains('open')) ||
        (commentIsOpen && commentIsOpen.classList.contains('active'))
      );
      if (dropdownWasOpen) closeBannerRightDropdown();
      updateCornerVars();
      var hasShortTitle = siteTitleHasShort();
      var eligibleStates = BANNER_STATES.filter(function(s) {
        return !s.titleShort || hasShortTitle;
      });
      for (var i = 0; i < eligibleStates.length; i++) {
        var s = eligibleStates[i];
        if (s.titleShort && !hasShortTitle) continue;
        applyBannerState(s);
        if (i === eligibleStates.length - 1) break;
        if (stateFits(s)) break;
      }
      if ((dropdownWasOpen || activeControlNeedsDropdown) &&
          banner.classList.contains('banner-compact')) {
        openBannerRightDropdown();
      }
      bannerLayoutDirty = false;
    }

    // requestAnimationFrame-throttle so a continuous drag-resize (or a burst
    // of ResizeObserver callbacks) only re-runs the algorithm once per frame.
    var rafId = null;
    function schedule() {
      if (bannerLayoutSuspended()) {
        bannerLayoutDirty = true;
        return;
      }
      if (rafId !== null) return;
      rafId = requestAnimationFrame(function() {
        rafId = null;
        if (bannerLayoutSuspended()) {
          bannerLayoutDirty = true;
          return;
        }
        checkBannerLayout();
      });
    }

    checkBannerLayout();
    window._checkBannerLayout = checkBannerLayout;
    window._setBannerTransitioning = function(v) {
      bannerTransitioning = !!v;
      if (!bannerLayoutSuspended() && bannerLayoutDirty) schedule();
    };
    window._holdBannerLayoutForTransition = holdBannerLayoutForTransition;
    document.documentElement.addEventListener('rprint-electron-notch-change', schedule);

    window.addEventListener('resize', schedule);

    // Re-apply sidebar defaults when the viewport crosses a breakpoint.
    // Only fires when the tier actually changes — not on every resize
    // frame — to avoid constant classList.toggle invalidation that
    // thrashes style recalc and causes 100% CPU during drag-resize.
    var _lastBP = window.innerWidth >= 1400 ? 2 : window.innerWidth >= 1100 ? 1 : 0;
    window.addEventListener('resize', function() {
      var bp = window.innerWidth >= 1400 ? 2 : window.innerWidth >= 1100 ? 1 : 0;
      if (bp !== _lastBP) {
        _lastBP = bp;
        applyResponsiveDefaults();
      }
    });

    // ResizeObserver catches sidebar open/close, font-load reflow, and dynamic
    // center/left content changes. Animated right-side controls use an explicit
    // layout transaction and final check instead of observing every width frame.
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(schedule);
      ro.observe(banner);
      ro.observe(centerInner);
      if (bannerLeft) ro.observe(bannerLeft);
    }
  })();

});
