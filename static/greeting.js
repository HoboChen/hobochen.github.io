(function () {
  'use strict';

  var greetings = [
    '你好！',
    '¡Hola!',
    'Hello!',
    'नमस्ते!',
    'হ্যালো!',
    'Olá!',
    'Привет!',
    'こんにちは',
    'Xin chào!',
    'Merhaba!',
    'నమస్కారం!',
    'नमस्कार!',
    '안녕하세요!',
    'Bonjour!',
    'வணக்கம்!',
    'ਸਤ ਸ੍ਰੀ ਅਕਾਲ!',
    'Hallo!',
    'سلام!',
    'مرحبا!',
    'Halo!',
    'કેમ છો!',
    'Sannu!',
    'Cześć!',
    'Ciao!',
    'สวัสดี',
    'Habari!',
    'Hej!',
    'Γεια σου!',
    'Aloha!'
  ];
  var cycles = new WeakMap();

  function mountGreeting(root) {
    var el = (root || document).querySelector('.greeting-cycle');
    if (!el) return undefined;
    if (cycles.has(el)) return cycles.get(el);
    var messages = greetings;
    if (el.hasAttribute('data-greetings')) {
      messages = JSON.parse(el.getAttribute('data-greetings'));
      if (!Array.isArray(messages) || messages.length === 0
          || messages.some(function(text) { return typeof text !== 'string' || !text; })) {
        throw new TypeError('site.greeting data-greetings must be a non-empty array of strings');
      }
    }
    el.dataset.cycling = '1';

    var idx = 0;
    var CHAR_MS = 80;
    var HOLD_MS = 2000;
    var DELETE_MS = 40;
    var timer = null;
    var stopped = false;

    function stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      delete el.dataset.cycling;
      cycles.delete(el);
    }

    function alive() {
      if (stopped) return false;
      if (!el.isConnected) { stop(); return false; }
      return true;
    }

    function typeText(text, cb) {
      var chars = Array.from(text);
      var i = 0;
      (function next() {
        if (!alive()) return;
        if (i <= chars.length) {
          el.textContent = chars.slice(0, i).join('');
          i++;
          timer = setTimeout(next, CHAR_MS);
        } else if (cb) cb();
      })();
    }

    function deleteText(cb) {
      var chars = Array.from(el.textContent);
      var i = chars.length;
      (function next() {
        if (!alive()) return;
        if (i >= 0) {
          var t = chars.slice(0, i).join('');
          el.textContent = t || '\u00A0';
          i--;
          timer = setTimeout(next, DELETE_MS);
        } else if (cb) cb();
      })();
    }

    function cycle() {
      if (!alive()) return;
      typeText(messages[idx], function() {
        if (!alive()) return;
        timer = setTimeout(function() {
          if (!alive()) return;
          deleteText(function() {
            idx = (idx + 1) % messages.length;
            if (!alive()) return;
            timer = setTimeout(cycle, 200);
          });
        }, HOLD_MS);
      });
    }

    cycles.set(el, stop);
    cycle();
    return stop;
  }

  if (!window.RprintPageModules) {
    throw new Error('site.greeting requires module-browser.js');
  }
  window.RprintPageModules.register({ id: 'site.greeting', mount: mountGreeting });
})();
