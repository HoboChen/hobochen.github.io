(function() {
  if (typeof window === 'undefined') return;

  var originalAttrs = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var originalStyles = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var originalStyleText = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var PAINT_ATTRS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'];
  var MIN_FILL_STROKE_LIGHTNESS_DELTA = 0.12;
  var themeColors = window.RprintThemeColors;
  if (!themeColors) throw new Error('SVG theming requires the shared theme color helpers.');
  var parsePaint = themeColors.parsePaint;
  var formatPaint = themeColors.formatPaint;
  var hexToOklch = themeColors.hexToOklch;
  var oklchToHex = themeColors.oklchToHex;

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function themeVariant(hex, targetTheme) { return themeColors.autoThemeVariant(hex, targetTheme); }
  function translatePaint(value, targetTheme) { return themeColors.themePaint(value, targetTheme); }

  function contrastingStrokeHex(fillHex, strokeHex) {
    var fillLch = hexToOklch(fillHex);
    var strokeLch = hexToOklch(strokeHex);
    if (Math.abs(fillLch[0] - strokeLch[0]) >= MIN_FILL_STROKE_LIGHTNESS_DELTA) return strokeHex;
    var makeLighter = fillLch[0] < 0.62;
    var nextL = fillLch[0] + (makeLighter ? MIN_FILL_STROKE_LIGHTNESS_DELTA : -MIN_FILL_STROKE_LIGHTNESS_DELTA);
    if (nextL < 0.35 || nextL > 0.90) nextL = fillLch[0] + (makeLighter ? -MIN_FILL_STROKE_LIGHTNESS_DELTA : MIN_FILL_STROKE_LIGHTNESS_DELTA);
    nextL = clamp(nextL, 0.35, 0.90);
    return oklchToHex(nextL, Math.min(0.22, strokeLch[1]), strokeLch[2]);
  }

  function contrastAdjustedStroke(fillValue, strokeValue) {
    var fill = parsePaint(fillValue);
    var stroke = parsePaint(strokeValue);
    if (!fill || !stroke) return null;
    var adjusted = contrastingStrokeHex(fill.hex, stroke.hex);
    return adjusted === stroke.hex ? null : formatPaint(stroke, adjusted);
  }

  function applyFillStrokeContrast(el, targetTheme) {
    if (targetTheme !== 'dark' || !el) return;
    if (el.style) {
      var styleFill = el.style.getPropertyValue('fill');
      var styleStroke = el.style.getPropertyValue('stroke');
      var adjustedStyleStroke = contrastAdjustedStroke(styleFill, styleStroke);
      if (adjustedStyleStroke) {
        el.style.setProperty('stroke', adjustedStyleStroke);
        return;
      }
    }
    if (!el.hasAttribute || !el.hasAttribute('fill') || !el.hasAttribute('stroke')) return;
    var adjustedStroke = contrastAdjustedStroke(el.getAttribute('fill'), el.getAttribute('stroke'));
    if (adjustedStroke) el.setAttribute('stroke', adjustedStroke);
  }

  function rewriteCssPaint(cssText, targetTheme) {
    return String(cssText || '').replace(/(\b(?:fill|stroke|color|stop-color|flood-color|lighting-color)\s*:\s*)([^;{}]+)(?=[;}]|$)/gi, function(match, prefix, value) {
      var next = translatePaint(value, targetTheme);
      return next === value ? match : prefix + next;
    });
  }

  function getOriginalAttr(el, attr) {
    if (!originalAttrs) return el.getAttribute(attr);
    var attrs = originalAttrs.get(el);
    if (!attrs) {
      attrs = {};
      originalAttrs.set(el, attrs);
    }
    if (!Object.prototype.hasOwnProperty.call(attrs, attr)) attrs[attr] = el.getAttribute(attr);
    return attrs[attr];
  }

  function getOriginalStyle(el) {
    if (!originalStyles) return el.getAttribute('style') || '';
    if (!originalStyles.has(el)) originalStyles.set(el, el.getAttribute('style') || '');
    return originalStyles.get(el);
  }

  function applyAttr(el, attr, targetTheme) {
    if (!el || !el.hasAttribute || !el.hasAttribute(attr)) return;
    var original = getOriginalAttr(el, attr);
    el.setAttribute(attr, targetTheme === 'dark' ? translatePaint(original, targetTheme) : original);
  }

  function applyInlineStyle(el, targetTheme) {
    if (!el || !el.hasAttribute || !el.hasAttribute('style')) return;
    var original = getOriginalStyle(el);
    if (targetTheme !== 'dark' && original === '') el.removeAttribute('style');
    else el.setAttribute('style', targetTheme === 'dark' ? rewriteCssPaint(original, targetTheme) : original);
  }

  function applyStyleElement(styleEl, targetTheme) {
    if (!styleEl) return;
    var original = styleEl.textContent || '';
    if (originalStyleText) {
      if (!originalStyleText.has(styleEl)) originalStyleText.set(styleEl, original);
      original = originalStyleText.get(styleEl);
    }
    styleEl.textContent = targetTheme === 'dark' ? rewriteCssPaint(original, targetTheme) : original;
  }

  function applyThemeToSvg(svg, targetTheme) {
    if (!svg) return;
    applyInlineStyle(svg, targetTheme);
    if (targetTheme === 'dark') {
      var originalSvgStyle = getOriginalStyle(svg);
      var hasOriginalColor = /(?:^|;)\s*color\s*:/i.test(originalSvgStyle) || svg.hasAttribute('color');
      var hasOriginalFill = /(?:^|;)\s*fill\s*:/i.test(originalSvgStyle) || svg.hasAttribute('fill');
      if (!hasOriginalColor) svg.style.color = themeVariant('#000000', targetTheme);
      if (!hasOriginalFill) svg.style.fill = themeVariant('#000000', targetTheme);
    }
    for (var i = 0; i < PAINT_ATTRS.length; i++) applyAttr(svg, PAINT_ATTRS[i], targetTheme);
    svg.querySelectorAll('style').forEach(function(styleEl) { applyStyleElement(styleEl, targetTheme); });
    svg.querySelectorAll('[fill], [stroke], [color], [stop-color], [flood-color], [lighting-color], [style]').forEach(function(el) {
      applyInlineStyle(el, targetTheme);
      for (var j = 0; j < PAINT_ATTRS.length; j++) applyAttr(el, PAINT_ATTRS[j], targetTheme);
      applyFillStrokeContrast(el, targetTheme);
    });
  }

  function targetThemeForSvg(svg, requestedTheme) {
    if (requestedTheme === 'dark' || requestedTheme === 'light') return requestedTheme;
    var preview = svg && svg.closest
      ? svg.closest('.svg-theme-preview[data-svg-theme]')
      : null;
    if (preview) return preview.getAttribute('data-svg-theme') === 'dark' ? 'dark' : 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applySvgThemeToElement(svg, requestedTheme) {
    if (!svg) return;
    applyThemeToSvg(svg, targetThemeForSvg(svg, requestedTheme));
  }

  function applySvgTheme(root, selector) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var targetTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll(selector || '.tikz-block svg').forEach(function(svg) { applyThemeToSvg(svg, targetTheme); });
  }

  function applySvgThemePreviews(root) {
    var scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('.svg-theme-preview[data-svg-theme] svg').forEach(function(svg) {
      var preview = svg.closest('.svg-theme-preview[data-svg-theme]');
      var targetTheme = preview && preview.getAttribute('data-svg-theme') === 'dark'
        ? 'dark'
        : 'light';
      applyThemeToSvg(svg, targetTheme);
    });
  }

  window.applySvgTheme = applySvgTheme;
  window.applySvgThemePreviews = applySvgThemePreviews;
  window.applySvgThemeToElement = applySvgThemeToElement;
  window.applyTikzSvgTheme = function(root) {
    applySvgTheme(root, '.tikz-block svg');
    applySvgThemePreviews(root);
  };
})();