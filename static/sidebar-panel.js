// ===== Sidebar Panel (shared) =====
// Provides reusable sidebar tree rendering + tab system.
// Used by: main.js (right-panel TOC) and pdf-annotator.js (outline + pages tabs).
(function () {
  /**
   * Attach toggle/active-tracking handlers to an existing server-rendered TOC tree.
   * Expects the standard .toc-section.has-children / .toc-toggle / .toc-children markup.
   *
   * @param {Element} container - Element containing the .toc-list tree (e.g. #spa-toc)
   * @returns {{ destroy: Function }} cleanup handle
   */
  function initTocTree(container) {
    var sections = container.querySelectorAll('.toc-section.has-children');
    var handlers = [];
    sections.forEach(function (section) {
      var toggle = section.querySelector('.toc-toggle');
      if (toggle) {
        var handler = function (e) {
          e.stopPropagation();
          section.classList.toggle('open');
        };
        toggle.addEventListener('click', handler);
        handlers.push({ el: toggle, fn: handler });
      }
    });
    return {
      destroy: function () {
        handlers.forEach(function (h) { h.el.removeEventListener('click', h.fn); });
        handlers.length = 0;
      }
    };
  }

  /**
   * Set up scroll-based active-heading tracking for a TOC tree.
   *
   * @param {Element} container - Element containing the .toc-list tree
   * @param {Object} [opts]
   * @param {number} [opts.offset=80]  - px from top to consider a heading "active"
   * @returns {{ destroy: Function, update: Function }} cleanup handle
   */
  function initScrollTracking(container, opts) {
    var offset = (opts && opts.offset) || 80;
    var tocLinks = container.querySelectorAll('.toc-list a');
    if (!tocLinks.length) return { destroy: function () {}, update: function () {} };

    var headingIds = Array.from(tocLinks).map(function (link) {
      var href = link.getAttribute('href');
      return href ? href.slice(1) : null;
    }).filter(Boolean);

    var sections = container.querySelectorAll('.toc-section.has-children');
    var ranges = container.querySelectorAll('.toc-range');

    function keepActiveLinkVisible(activeLink) {
      var scrollContainer = container.closest('.sidebar');
      if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) return;

      var margin = 12;
      var containerRect = scrollContainer.getBoundingClientRect();
      var linkRect = activeLink.getBoundingClientRect();
      var visibleTop = containerRect.top + margin;
      var visibleBottom = containerRect.bottom - margin;
      if (linkRect.top < visibleTop) {
        scrollContainer.scrollTop += linkRect.top - visibleTop;
      } else if (linkRect.bottom > visibleBottom) {
        scrollContainer.scrollTop += linkRect.bottom - visibleBottom;
      }
    }

    function update() {
      var scrollY = window.scrollY;
      var activeId = headingIds[0];
      for (var i = 0; i < headingIds.length; i++) {
        var el = document.getElementById(headingIds[i]);
        if (el && el.offsetTop - offset <= scrollY) activeId = headingIds[i];
      }
      tocLinks.forEach(function (link) {
        var href = link.getAttribute('href');
        link.classList.toggle('active', href === '#' + activeId);
      });
      ranges.forEach(function (range) {
        range.classList.remove('toc-range-active');
      });
      var activeLink = container.querySelector('.toc-list a.active');
      var activeRange = activeLink ? activeLink.closest('.toc-range') : null;
      while (activeRange) {
        activeRange.classList.add('toc-range-active');
        var parentList = activeRange.parentElement;
        activeRange = parentList ? parentList.closest('.toc-range') : null;
      }
      sections.forEach(function (section) {
        var hasActive = section.querySelector('a.active');
        section.classList.toggle('open', !!hasActive);
      });
      if (activeLink) keepActiveLinkVisible(activeLink);
    }

    window.addEventListener('scroll', update, { passive: true });
    update();

    return {
      destroy: function () {
        window.removeEventListener('scroll', update);
      },
      update: update
    };
  }

  /**
   * Render a hierarchical tree of items using the shared TOC CSS classes.
   * Used for dynamically-generated trees (e.g. PDF outline).
   *
   * @param {Array} items - Array of { title, onClick, children[], data: {} }
   * @param {Element} parentEl - Container element to append the tree to
   */
  function renderTree(items, parentEl) {
    var ul = document.createElement('ul');
    ul.className = 'toc-list';
    _renderItems(items, ul, 0);
    parentEl.appendChild(ul);
  }

  function _renderItems(items, parentUl, depth) {
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var hasChildren = item.children && item.children.length > 0;

      if (depth === 0) {
        // Top-level: render as toc-section (matches site h2 headings)
        var li = document.createElement('li');
        li.className = 'toc-section' + (hasChildren ? ' has-children' : '');

        var heading = document.createElement('div');
        heading.className = 'toc-heading';

        if (hasChildren) {
          var toggle = document.createElement('span');
          toggle.className = 'toc-toggle';
          toggle.textContent = '▶';
          toggle.addEventListener('click', (function (sec) {
            return function (e) {
              e.stopPropagation();
              sec.classList.toggle('open');
            };
          })(li));
          heading.appendChild(toggle);
        }

        var a = document.createElement('a');
        a.textContent = item.title;
        a.href = '#';
        if (item.data) {
          for (var key in item.data) {
            if (item.data.hasOwnProperty(key)) a.dataset[key] = item.data[key];
          }
        }
        if (item.onClick) {
          a.addEventListener('click', (function (fn) {
            return function (e) { e.preventDefault(); fn(); };
          })(item.onClick));
        }
        heading.appendChild(a);
        li.appendChild(heading);

        if (hasChildren) {
          var childUl = document.createElement('ul');
          childUl.className = 'toc-children';
          _renderItems(item.children, childUl, 1);
          li.appendChild(childUl);
        }

        parentUl.appendChild(li);
      } else {
        // Nested: render as flat toc-child (matches site h3/h4 leaves)
        var childLi = document.createElement('li');
        childLi.className = 'toc-child' + (depth >= 2 ? ' toc-deep' : '');
        var childA = document.createElement('a');
        if (depth >= 2) {
          var icon = document.createElement('span');
          icon.className = 'toc-icon';
          icon.textContent = '\u00b7';
          childA.appendChild(icon);
        }
        childA.appendChild(document.createTextNode(item.title));
        childA.href = '#';
        if (item.data) {
          for (var key in item.data) {
            if (item.data.hasOwnProperty(key)) childA.dataset[key] = item.data[key];
          }
        }
        if (item.onClick) {
          childA.addEventListener('click', (function (fn) {
            return function (e) { e.preventDefault(); fn(); };
          })(item.onClick));
        }
        childLi.appendChild(childA);
        parentUl.appendChild(childLi);
        // Flatten children into the same list (no nested toc-children)
        if (hasChildren) {
          _renderItems(item.children, parentUl, depth + 1);
        }
      }
    }
  }

  /**
   * Create a tabbed sidebar panel (e.g. for PDF annotator Outline/Pages).
   *
   * @param {Object} opts
   * @param {Array}  opts.tabs - Array of { key, label }
   * @param {string} [opts.className] - Extra CSS class for the container
   * @returns {{ el: Element, getPane: Function, setActiveTab: Function, activeTab: Function }}
   */
  function createTabbedPanel(opts) {
    var tabs = opts.tabs;
    var el = document.createElement('div');
    el.className = 'sp-tabbed-panel' + (opts.className ? ' ' + opts.className : '');

    // Tab bar
    var tabBar = document.createElement('div');
    tabBar.className = 'sp-tab-bar';
    var tabButtons = {};
    var panes = {};

    tabs.forEach(function (tab, idx) {
      var btn = document.createElement('button');
      btn.className = 'sp-tab' + (idx === 0 ? ' active' : '');
      btn.textContent = tab.label;
      btn.dataset.tab = tab.key;
      tabBar.appendChild(btn);
      tabButtons[tab.key] = btn;

      var pane = document.createElement('div');
      pane.className = 'sp-pane';
      pane.dataset.pane = tab.key;
      if (idx !== 0) pane.style.display = 'none';
      panes[tab.key] = pane;
    });

    el.appendChild(tabBar);

    var contentWrap = document.createElement('div');
    contentWrap.className = 'sp-content';
    tabs.forEach(function (tab) {
      contentWrap.appendChild(panes[tab.key]);
    });
    el.appendChild(contentWrap);

    var currentTab = tabs[0].key;

    // Tab switching
    tabBar.addEventListener('click', function (e) {
      var btn = e.target.closest('.sp-tab');
      if (!btn) return;
      var key = btn.dataset.tab;
      if (key === currentTab) return;
      setActiveTab(key);
    });

    function setActiveTab(key) {
      if (!panes[key]) return;
      Object.keys(tabButtons).forEach(function (k) {
        tabButtons[k].classList.toggle('active', k === key);
      });
      Object.keys(panes).forEach(function (k) {
        panes[k].style.display = k === key ? '' : 'none';
      });
      currentTab = key;
    }

    return {
      el: el,
      getPane: function (key) { return panes[key] || null; },
      setActiveTab: setActiveTab,
      activeTab: function () { return currentTab; }
    };
  }

  /**
   * Highlight the "best match" link in a rendered tree by a numeric data attribute.
   * Finds the link with the largest data-[attr] value that is <= the given value,
   * marks it .active, auto-folds/unfolds sections accordingly, and scrolls it into view.
   *
   * Used by PDF annotator to highlight the outline item matching the current page.
   *
   * @param {Element} container - Element containing the .toc-list tree
   * @param {string}  attr      - data attribute name (e.g. 'page')
   * @param {number}  value     - current value to match against (e.g. current page number)
   */
  function setActiveByData(container, attr, value) {
    var links = container.querySelectorAll('.toc-list a[data-' + attr + ']');
    if (!links.length) return;

    // Find the link whose data-attr is the largest value <= current value
    var bestLink = null;
    var bestVal = -Infinity;
    links.forEach(function (link) {
      var v = parseInt(link.dataset[attr], 10);
      if (!isNaN(v) && v <= value && v > bestVal) {
        bestVal = v;
        bestLink = link;
      }
    });

    // Clear all active
    links.forEach(function (link) { link.classList.remove('active'); });
    var sections = container.querySelectorAll('.toc-section.has-children');
    sections.forEach(function (section) { section.classList.remove('open'); });

    if (bestLink) {
      bestLink.classList.add('active');
      // Open ancestor sections
      var el = bestLink.closest('.toc-section');
      while (el) {
        if (el.classList.contains('has-children')) el.classList.add('open');
        var parentUl = el.parentElement;
        el = parentUl ? parentUl.closest('.toc-section') : null;
      }
      // Scroll into view if sidebar is visible
      if (bestLink.offsetParent !== null) {
        bestLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  window.SidebarPanel = {
    initTocTree: initTocTree,
    initScrollTracking: initScrollTracking,
    renderTree: renderTree,
    createTabbedPanel: createTabbedPanel,
    setActiveByData: setActiveByData
  };
})();
