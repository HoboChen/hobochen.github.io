(function () {
  'use strict';

  var pending = new Map();
  function asset(url, style, ready) {
    if (ready && ready()) return Promise.resolve();
    var existing = style && document.querySelector('link[href="' + url + '"]');
    if (existing && existing.sheet) return Promise.resolve();
    if (pending.has(url)) return pending.get(url);
    var promise = new Promise(function (resolve, reject) {
      var node = existing || document.createElement(style ? 'link' : 'script');
      var timer;
      function finish(error) {
        clearTimeout(timer);
        node.removeEventListener('load', loaded);
        node.removeEventListener('error', failed);
        if (error) {
          if (!existing) node.remove();
          reject(error);
        } else resolve();
      }
      function loaded() { finish(); }
      function failed() { finish(new Error('Could not load ' + url)); }
      node.addEventListener('load', loaded);
      node.addEventListener('error', failed);
      timer = setTimeout(failed, 15000);
      if (!existing) {
        if (style) { node.rel = 'stylesheet'; node.href = url; }
        else node.src = url;
        document.head.appendChild(node);
      }
    }).catch(function (error) { pending.delete(url); throw error; });
    pending.set(url, promise);
    return promise;
  }

  async function load() {
    await Promise.all([
      asset('/static/exhibit.css', true),
      asset('/static/library/explorer.css', true),
      asset('/static/ink-toolbar.css', true),
      asset('/static/draftbook/draftbook.css', true),
      asset('/static/ink-toolbar.js', false, function () { return window.InkToolbar && window.InkToolbar.createChrome; }),
      asset('/static/exhibit.js', false, function () { return window.Exhibit; }),
      asset('/static/library/explorer-state.js', false, function () { return window.LibraryExplorerState; }),
    ]);
    await asset('/static/library/explorer.js', false, function () { return window.LibraryExplorer; });
    await asset('/static/draftbook/draftbook.js', false, function () { return window.Draftbook; });
    if (!window.Draftbook) throw new Error('Draftbook editor did not initialize');
    return window.Draftbook;
  }

  function mount(root) {
    if (!document.body.dataset.spa) return undefined;
    var workspace = (root || document).querySelector('#draftbook-workspace');
    if (!workspace) return undefined;
    var alive = true;
    var stop;
    var status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Loading…';
    workspace.replaceChildren(status);
    function open() {
      load().then(function (api) {
        if (alive && workspace.isConnected) stop = api.mount(root || document);
      }).catch(function (error) {
        if (!alive) return;
        status.textContent = error.message;
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry';
        retry.addEventListener('click', function () { retry.remove(); open(); }, { once: true });
        workspace.replaceChildren(status, retry);
        console.error('[draftbook]', error);
      });
    }
    open();
    return function () {
      alive = false;
      if (typeof stop === 'function') stop();
    };
  }
  window.RprintPageModules.register({ id: 'draftbook', mount: mount });
  window.DraftbookLoader = { load: load, mount: mount };
})();
