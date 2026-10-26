(function() {
  'use strict';

  var SHOW_DELAY = 300;
  var HIDE_DELAY = 200;
  var VIEWPORT_MARGIN = 16;
  var LINK_GAP = 8;
  var isEmbeddedPreview = document.documentElement.classList.contains('link-preview-embed');
  var embeddedAlignmentTimers = [];
  var embeddedAlignmentObserver = null;
  var embeddedAlignmentHash = '';
  var embeddedAlignmentActive = false;

  function alignEmbeddedTarget(requestedHash) {
    if (!embeddedAlignmentActive) return;
    var hash = typeof requestedHash === 'string' ? requestedHash : location.hash;
    if (!hash) return;
    var id;
    try { id = decodeURIComponent(hash.replace(/^#/, '')); }
    catch (e) { id = hash.replace(/^#/, ''); }
    var target = id && document.getElementById(id);
    if (target && typeof target.scrollIntoView === 'function') {
      var root = document.documentElement;
      var previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      root.style.scrollBehavior = previousScrollBehavior;
    }
  }

  function disableEmbeddedLinks() {
    document.querySelectorAll('.article a[href]').forEach(function(anchor) {
      anchor.setAttribute('aria-disabled', 'true');
      anchor.setAttribute('tabindex', '-1');
    });
  }

  function clearEmbeddedAlignment() {
    embeddedAlignmentTimers.forEach(function(timer) { clearTimeout(timer); });
    embeddedAlignmentTimers = [];
    if (embeddedAlignmentObserver) {
      embeddedAlignmentObserver.disconnect();
      embeddedAlignmentObserver = null;
    }
  }

  function releaseEmbeddedAlignment() {
    if (!embeddedAlignmentActive) return;
    embeddedAlignmentActive = false;
    clearEmbeddedAlignment();
  }

  function releaseEmbeddedAlignmentOnKey(event) {
    if (event.key === 'ArrowUp'
        || event.key === 'ArrowDown'
        || event.key === 'PageUp'
        || event.key === 'PageDown'
        || event.key === 'Home'
        || event.key === 'End'
        || event.key === ' '
        || event.key === 'Spacebar') {
      releaseEmbeddedAlignment();
    }
  }

  function scheduleEmbeddedAlignment(requestedHash) {
    var explicitlyRequested = typeof requestedHash === 'string';
    var nextHash = explicitlyRequested ? requestedHash : location.hash;
    if (!nextHash) {
      embeddedAlignmentHash = '';
      embeddedAlignmentActive = false;
      clearEmbeddedAlignment();
      return;
    }
    if (!explicitlyRequested && nextHash === embeddedAlignmentHash && !embeddedAlignmentActive) return;
    embeddedAlignmentHash = nextHash;
    embeddedAlignmentActive = true;
    clearEmbeddedAlignment();
    alignEmbeddedTarget(embeddedAlignmentHash);

    [100, 300, 700, 1500, 3000].forEach(function(delay) {
      embeddedAlignmentTimers.push(setTimeout(function() {
        alignEmbeddedTarget(embeddedAlignmentHash);
      }, delay));
    });

    if (typeof ResizeObserver === 'undefined') return;
    var targetId;
    try { targetId = decodeURIComponent(embeddedAlignmentHash.replace(/^#/, '')); }
    catch (e) { targetId = embeddedAlignmentHash.replace(/^#/, ''); }
    var target = targetId && document.getElementById(targetId);
    var article = document.querySelector('.article');
    if (!target && !article) return;
    embeddedAlignmentObserver = new ResizeObserver(function() {
      alignEmbeddedTarget(embeddedAlignmentHash);
    });
    if (target) embeddedAlignmentObserver.observe(target);
    if (article && article !== target) embeddedAlignmentObserver.observe(article);
  }

  if (isEmbeddedPreview) {
    window.alignLinkPreviewTarget = scheduleEmbeddedAlignment;
    document.addEventListener('wheel', releaseEmbeddedAlignment, { passive: true, capture: true });
    document.addEventListener('touchstart', releaseEmbeddedAlignment, { passive: true, capture: true });
    document.addEventListener(
      typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown',
      releaseEmbeddedAlignment,
      true
    );
    document.addEventListener('keydown', releaseEmbeddedAlignmentOnKey, true);
    disableEmbeddedLinks();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        disableEmbeddedLinks();
        scheduleEmbeddedAlignment();
      }, { once: true });
    } else {
      scheduleEmbeddedAlignment();
    }
    window.addEventListener('load', function() { scheduleEmbeddedAlignment(); }, { once: true });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function() { scheduleEmbeddedAlignment(); }).catch(function() {});
    }
    window.LinkPreview = { reset: function() {} };
    return;
  }

  var enabled = false;
  var samePageOnly = true;
  var autoClose = true;
  var overwriteJumping = false;
  var openedByClick = false;
  var activeLink = null;
  var popover = null;
  var iframe = null;
  var titleElement = null;
  var statusElement = null;
  var closeButton = null;
  var restoreFocusElement = null;
  var showTimer = null;
  var hideTimer = null;
  var positionFrame = null;
  var resizeObserver = null;

  function readSettings() {
    try {
      var prefs = window.KbPreferences ? window.KbPreferences.get() : JSON.parse(localStorage.getItem('kb-display-prefs') || '{}');
      enabled = prefs.linkPreview === 'on';
      samePageOnly = prefs.linkPreviewSamePageOnly !== 'off';
      autoClose = prefs.linkPreviewAutoClose !== 'off';
      overwriteJumping = prefs.linkPreviewOverwriteJumping === 'on';
    } catch (e) {
      enabled = false;
      samePageOnly = true;
      autoClose = true;
      overwriteJumping = false;
    }
  }

  function supportsHover() {
    try { return window.matchMedia('(hover: hover)').matches; }
    catch (e) { return false; }
  }

  function isEligibleLink(anchor) {
    if (!anchor || !anchor.closest('.article') || !anchor.href) return false;
    if (anchor.hasAttribute('download') || anchor.target === '_blank') return false;

    var rawHref = (anchor.getAttribute('href') || '').trim();
    if (!rawHref || rawHref === '#') return false;

    var url;
    try { url = new URL(anchor.href, location.href); }
    catch (e) { return false; }
    var standaloneFile = document.body &&
      document.body.classList.contains('one-document') &&
      url.protocol === 'file:' &&
      location.protocol === 'file:' &&
      url.pathname === location.pathname &&
      url.search === location.search &&
      !!url.hash;
    if (!standaloneFile && (url.origin !== location.origin || !/^https?:$/.test(url.protocol))) return false;
    if (/^\/(?:api|static|auth|jupyter)(?:\/|$)/.test(url.pathname) || url.pathname === '/sw.js') return false;
    if (samePageOnly) {
      var currentUrl = new URL(location.href);
      if (!url.hash || url.pathname !== currentUrl.pathname || url.search !== currentUrl.search) return false;
    }

    var fileName = url.pathname.split('/').pop() || '';
    var extension = (fileName.match(/\.([^.]+)$/) || [])[1];
    return !extension || extension.toLowerCase() === 'html';
  }

  function previewUrlFor(anchor) {
    var url = new URL(anchor.href, location.href);
    url.searchParams.set('rprint-preview', '1');
    return url.href;
  }

  function documentUrl(url) {
    try {
      var parsed = new URL(url, location.href);
      parsed.hash = '';
      return parsed.href;
    } catch (e) {
      return '';
    }
  }

  function alignFrameTarget(targetUrl) {
    if (!iframe || !iframe.contentWindow || typeof iframe.contentWindow.alignLinkPreviewTarget !== 'function') return;
    var hash = '';
    try { hash = new URL(targetUrl, location.href).hash; }
    catch (e) { /* leave empty */ }
    iframe.contentWindow.alignLinkPreviewTarget(hash);
  }

  function clearShowTimer() {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function clearHideTimer() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function createPopover() {
    if (popover) return;

    popover = document.createElement('section');
    popover.className = 'link-preview-popover';
    popover.hidden = true;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Link preview');
    popover.setAttribute('aria-hidden', 'true');

    var header = document.createElement('header');
    header.className = 'link-preview-header';
    titleElement = document.createElement('span');
    titleElement.className = 'link-preview-title';
    header.appendChild(titleElement);

    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'link-preview-close';
    closeButton.setAttribute('aria-label', 'Close link preview');
    closeButton.innerHTML = '<span aria-hidden="true">&times;</span>';
    closeButton.addEventListener('click', closePreview);
    header.appendChild(closeButton);
    popover.appendChild(header);

    var frameWrap = document.createElement('div');
    frameWrap.className = 'link-preview-frame-wrap';
    iframe = document.createElement('iframe');
    iframe.className = 'link-preview-frame';
    iframe.title = 'Link preview content';
    iframe.setAttribute('loading', 'eager');
    frameWrap.appendChild(iframe);

    statusElement = document.createElement('div');
    statusElement.className = 'link-preview-status';
    statusElement.textContent = 'Loading...';
    frameWrap.appendChild(statusElement);
    popover.appendChild(frameWrap);

    iframe.addEventListener('load', function() {
      try {
        var frameDocument = iframe.contentDocument;
        var article = frameDocument && frameDocument.querySelector('.article');
        if (!article) {
          delete iframe.dataset.loadedUrl;
          statusElement.hidden = false;
          statusElement.textContent = 'Preview unavailable';
          statusElement.classList.add('error');
          return;
        }
        iframe.dataset.loadedUrl = iframe.src;
        statusElement.hidden = true;
        var heading = frameDocument && frameDocument.querySelector('.article h1');
        if (heading) titleElement.textContent = heading.textContent.trim();
        if (iframe.contentWindow && typeof iframe.contentWindow.alignLinkPreviewTarget === 'function') {
          iframe.contentWindow.alignLinkPreviewTarget();
        }
      } catch (e) {
        delete iframe.dataset.loadedUrl;
        statusElement.hidden = false;
        statusElement.textContent = 'Preview unavailable';
        statusElement.classList.add('error');
      }
    });
    iframe.addEventListener('error', function() {
      statusElement.hidden = false;
      statusElement.textContent = 'Preview unavailable';
      statusElement.classList.add('error');
    });

    popover.addEventListener('mouseenter', clearHideTimer);
    popover.addEventListener('mouseleave', function() {
      if (autoClose && !openedByClick) scheduleClose();
    });
    document.body.appendChild(popover);
  }

  function visibleTopBoundary() {
    var boundary = VIEWPORT_MARGIN;
    var banner = document.querySelector('.top-banner');
    if (banner && !document.body.classList.contains('banner-folded')) {
      var bannerRect = banner.getBoundingClientRect();
      if (bannerRect.bottom > 0) boundary = Math.max(boundary, bannerRect.bottom + LINK_GAP);
    }
    return boundary;
  }

  function positionPopover() {
    positionFrame = null;
    if (!popover || popover.hidden || !activeLink || !activeLink.isConnected) {
      if (activeLink && !activeLink.isConnected) closePreview();
      return;
    }

    var article = activeLink.closest('.article');
    if (!article) { closePreview(); return; }
    var articleRect = article.getBoundingClientRect();
    var linkRect = activeLink.getBoundingClientRect();
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    var width = Math.min(articleRect.width * 0.8, Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2));
    popover.style.width = Math.round(width) + 'px';

    var popoverRect = popover.getBoundingClientRect();
    var height = popoverRect.height || Math.min(viewportHeight * 0.6, 640);
    var left = articleRect.left + (articleRect.width - width) / 2;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - width - VIEWPORT_MARGIN));

    var topBoundary = visibleTopBoundary();
    var top;
    var placement;
    if (linkRect.top - LINK_GAP - height >= topBoundary) {
      top = linkRect.top - LINK_GAP - height;
      placement = 'top';
    } else {
      top = linkRect.bottom + LINK_GAP;
      placement = 'bottom';
    }
    var maxTop = Math.max(topBoundary, viewportHeight - height - VIEWPORT_MARGIN);
    top = Math.max(topBoundary, Math.min(top, maxTop));

    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(top) + 'px';
    popover.dataset.placement = placement;
  }

  function schedulePosition() {
    if (positionFrame !== null) return;
    positionFrame = requestAnimationFrame(positionPopover);
  }

  function observeArticle() {
    if (resizeObserver) resizeObserver.disconnect();
    if (typeof ResizeObserver === 'undefined' || !activeLink) return;
    var article = activeLink.closest('.article');
    if (!article) return;
    resizeObserver = new ResizeObserver(schedulePosition);
    resizeObserver.observe(article);
  }

  function openPreview(anchor, trigger) {
    showTimer = null;
    if (!enabled || (trigger !== 'click' && !supportsHover()) || !isEligibleLink(anchor) || !anchor.isConnected) return;
    createPopover();
    clearHideTimer();
    activeLink = anchor;
    openedByClick = trigger === 'click';
    if (openedByClick) restoreFocusElement = anchor;

    var targetUrl = previewUrlFor(anchor);
    var loadedUrl = iframe.dataset.loadedUrl || '';
    var sameDocument = !!loadedUrl && documentUrl(loadedUrl) === documentUrl(targetUrl);
    var linkLabel = anchor.textContent.trim();
    titleElement.textContent = linkLabel || new URL(targetUrl).pathname;
    statusElement.textContent = 'Loading...';
    statusElement.classList.remove('error');
    statusElement.hidden = sameDocument;

    popover.hidden = false;
    popover.setAttribute('aria-hidden', 'false');
    if (sameDocument) {
      iframe.dataset.loadedUrl = targetUrl;
      if (iframe.src !== targetUrl) iframe.src = targetUrl;
      alignFrameTarget(targetUrl);
      requestAnimationFrame(function() { alignFrameTarget(targetUrl); });
    } else {
      iframe.src = targetUrl;
    }
    positionPopover();
    observeArticle();
    if (openedByClick && closeButton) {
      requestAnimationFrame(function() {
        if (!openedByClick || !popover || popover.hidden) return;
        try { closeButton.focus({ preventScroll: true }); }
        catch (e) { closeButton.focus(); }
      });
    }
  }

  function scheduleOpen(anchor) {
    clearShowTimer();
    clearHideTimer();
    showTimer = setTimeout(function() { openPreview(anchor, 'hover'); }, SHOW_DELAY);
  }

  function closePreview() {
    clearShowTimer();
    clearHideTimer();
    if (positionFrame !== null) {
      cancelAnimationFrame(positionFrame);
      positionFrame = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    var focusTarget = openedByClick && restoreFocusElement && restoreFocusElement.isConnected
      ? restoreFocusElement
      : null;
    activeLink = null;
    openedByClick = false;
    restoreFocusElement = null;
    if (popover) {
      popover.hidden = true;
      popover.setAttribute('aria-hidden', 'true');
    }
    if (focusTarget) {
      try { focusTarget.focus({ preventScroll: true }); }
      catch (e) { focusTarget.focus(); }
    }
  }

  function scheduleClose() {
    clearHideTimer();
    hideTimer = setTimeout(closePreview, HIDE_DELAY);
  }

  document.addEventListener('mouseover', function(event) {
    var anchor = event.target.closest && event.target.closest('.article a[href]');
    if (!anchor || !isEligibleLink(anchor)) return;
    if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    if (!enabled || !supportsHover()) return;
    scheduleOpen(anchor);
  });

  document.addEventListener('mouseout', function(event) {
    var anchor = event.target.closest && event.target.closest('.article a[href]');
    if (!anchor || !isEligibleLink(anchor)) return;
    if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    clearShowTimer();
    if (autoClose && !openedByClick && activeLink === anchor) scheduleClose();
  });

  document.addEventListener('click', function(event) {
    if (!enabled || !overwriteJumping || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = event.target.closest && event.target.closest('.article a[href]');
    if (!anchor || !isEligibleLink(anchor)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    clearShowTimer();
    clearHideTimer();
    openPreview(anchor, 'click');
  });

  var outsidePressEvent = typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown';
  document.addEventListener(outsidePressEvent, function(event) {
    if ((!openedByClick && autoClose) || !popover || popover.hidden) return;
    if (popover.contains(event.target) || (activeLink && activeLink.contains(event.target))) return;
    closePreview();
  }, true);

  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && popover && !popover.hidden) closePreview();
  });

  document.addEventListener('linkPreviewSettingsChange', function(event) {
    enabled = !!(event.detail && event.detail.enabled);
    if (event.detail && typeof event.detail.samePageOnly === 'boolean') samePageOnly = event.detail.samePageOnly;
    autoClose = !event.detail || event.detail.autoClose !== false;
    overwriteJumping = !!(event.detail && event.detail.overwriteJumping);
    if (!enabled) closePreview();
    else if (activeLink && !isEligibleLink(activeLink)) closePreview();
    else if (!overwriteJumping && openedByClick) closePreview();
    else if (!autoClose) clearHideTimer();
  });

  window.addEventListener('resize', schedulePosition, { passive: true });
  window.addEventListener('scroll', schedulePosition, { passive: true, capture: true });

  readSettings();
  window.LinkPreview = {
    reset: closePreview,
    isEligibleLink: isEligibleLink
  };
})();