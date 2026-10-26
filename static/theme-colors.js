(function () {
  'use strict';

  // Authors opt a stylesheet into conversion and keep their light-theme
  // colors in its source. CSSOM parsing preserves selectors, grouping rules,
  // shorthand semantics and !important without rewriting arbitrary CSS text.
  var COLORS = window.RprintThemeColors;
  if (!COLORS) throw new Error('Content theme colors requires core/theme-colors.js');

  var PROPERTIES = [
    'color', 'background-color',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'column-rule-color', 'caret-color',
  ];

  function collectRules(rules, records) {
    Array.from(rules).forEach(function (rule) {
      if (rule.style) {
        var paints = [];
        PROPERTIES.forEach(function (property) {
          var value = rule.style.getPropertyValue(property);
          if (!COLORS.parsePaint(value)) return;
          paints.push({
            property: property,
            value: value,
            priority: rule.style.getPropertyPriority(property),
          });
        });
        if (paints.length) {
          records.push({ style: rule.style, original: rule.style.cssText, paints: paints });
        }
      }
      if (rule.cssRules) collectRules(rule.cssRules, records);
    });
  }

  function mount(root) {
    var styles = Array.from((root || document).querySelectorAll('style[data-theme-colors]'));
    var records = [];
    styles.forEach(function (style) {
      try {
        if (!style.sheet) throw new Error('stylesheet is unavailable');
        var local = [];
        collectRules(style.sheet.cssRules, local);
        records.push.apply(records, local);
      } catch (error) {
        if (window._log && typeof window._log.warn === 'function') {
          window._log.warn('reading', 'Cannot adapt authored stylesheet colors', String(error));
        } else {
          console.warn('[ContentThemeColors] Cannot adapt authored stylesheet colors', error);
        }
      }
    });
    if (!records.length) return undefined;

    var disposed = false;
    function restore() {
      records.forEach(function (record) { record.style.cssText = record.original; });
    }
    function apply() {
      if (disposed) return;
      var theme = document.documentElement.getAttribute('data-theme') || 'light';
      restore();
      if (theme !== 'dark' && theme !== 'kindle') return;
      records.forEach(function (record) {
        var foreground = record.paints.find(function (paint) { return paint.property === 'color'; });
        var background = record.paints.find(function (paint) { return paint.property === 'background-color'; });
        var pair = foreground && background
          ? COLORS.themePaintPair(foreground.value, background.value, theme)
          : null;
        record.paints.forEach(function (paint) {
          var value = pair && paint.property === 'color' ? pair.foreground
            : pair && paint.property === 'background-color' ? pair.background
              : COLORS.themePaint(paint.value, theme);
          record.style.setProperty(paint.property, value, paint.priority);
        });
      });
    }

    apply();
    var observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return function () {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      restore();
    };
  }

  window.ContentThemeColors = Object.freeze({ mount: mount });
  if (!window.RprintPageModules) throw new Error('Content theme colors requires module-browser.js');
  window.RprintPageModules.register({ id: 'reading.theme-colors', mount: mount });
})();
