(function() {
  'use strict';

  var root = document.documentElement;
  var ownerClass = 'right-sidebar-scrollbar-active';
  var idleDelay = 1500;
  var owner = null;
  var ownerTimer = null;
  var touch = null;

  function releaseOwner() {
    root.classList.remove(ownerClass);
    if (ownerTimer) clearTimeout(ownerTimer);
    owner = null;
    ownerTimer = null;
  }

  function activateOwner(sidebar) {
    owner = sidebar;
    root.classList.add(ownerClass);
    if (ownerTimer) clearTimeout(ownerTimer);
    ownerTimer = setTimeout(releaseOwner, idleDelay);
  }

  function findRightSidebar(target) {
    var element = target && target.nodeType === 1 ? target : target && target.parentElement;
    return element && element.closest ? element.closest('#right-sidebar') : null;
  }

  function canScroll(sidebar, deltaY) {
    if (!deltaY || sidebar.scrollHeight <= sidebar.clientHeight) return false;
    if (deltaY < 0) return sidebar.scrollTop > 0;
    return sidebar.scrollTop + sidebar.clientHeight < sidebar.scrollHeight;
  }

  function isScrollbarPointer(sidebar, event) {
    if (event.button !== 0 || sidebar.scrollHeight <= sidebar.clientHeight) return false;
    var rect = sidebar.getBoundingClientRect();
    var gutterWidth = Math.max(sidebar.offsetWidth - sidebar.clientWidth, 8);
    return event.clientX >= rect.right - gutterWidth && event.clientX <= rect.right;
  }

  function keyboardScrollDelta(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return 0;
    switch (event.key) {
      case 'ArrowUp':
      case 'PageUp':
      case 'Home':
        return -1;
      case 'ArrowDown':
      case 'PageDown':
      case 'End':
        return 1;
      case ' ':
      case 'Spacebar':
        return event.shiftKey ? -1 : 1;
      default:
        return 0;
    }
  }

  root.classList.add('scrollbar-edge-managed');

  document.addEventListener('pointerdown', function(e) {
    var sidebar = findRightSidebar(e.target);
    if (sidebar && e.pointerType === 'touch' && sidebar.scrollHeight > sidebar.clientHeight) {
      touch = {
        sidebar: sidebar,
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY
      };
      return;
    }
    if (sidebar && isScrollbarPointer(sidebar, e)) activateOwner(sidebar);
  }, { capture: true, passive: true });

  document.addEventListener('pointermove', function(e) {
    if (!touch || e.pointerId !== touch.pointerId) return;
    var deltaX = e.clientX - touch.clientX;
    var deltaY = touch.clientY - e.clientY;
    if (Math.abs(deltaY) < 6 || Math.abs(deltaY) <= Math.abs(deltaX)) return;
    if (canScroll(touch.sidebar, deltaY)) activateOwner(touch.sidebar);
  }, { capture: true, passive: true });

  function clearTouch(e) {
    if (touch && e.pointerId === touch.pointerId) touch = null;
  }

  document.addEventListener('pointerup', clearTouch, { capture: true, passive: true });
  document.addEventListener('pointercancel', clearTouch, { capture: true, passive: true });

  document.addEventListener('wheel', function(e) {
    var sidebar = findRightSidebar(e.target);
    if (sidebar) {
      if (canScroll(sidebar, e.deltaY)) activateOwner(sidebar);
      return;
    }
    releaseOwner();
  }, { capture: true, passive: true });

  document.addEventListener('focusin', function(e) {
    var sidebar = findRightSidebar(e.target);
    if (sidebar && sidebar.scrollHeight > sidebar.clientHeight) activateOwner(sidebar);
  }, true);

  document.addEventListener('focusout', function(e) {
    if (!owner || (e.relatedTarget && owner.contains(e.relatedTarget))) return;
    releaseOwner();
  }, true);

  document.addEventListener('keydown', function(e) {
    var sidebar = findRightSidebar(e.target);
    var deltaY = sidebar && keyboardScrollDelta(e);
    if (sidebar && deltaY && canScroll(sidebar, deltaY)) activateOwner(sidebar);
  }, true);

  document.addEventListener('scroll', function(e) {
    if (e.target && e.target.id === 'right-sidebar') {
      if (e.target === owner) activateOwner(e.target);
      return;
    }
    if (e.target === document || e.target === document.documentElement ||
        e.target === document.body) {
      releaseOwner();
    }
  }, { capture: true, passive: true });
})();