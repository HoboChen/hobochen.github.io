(function() {
  if (typeof window === 'undefined') return;

  var originalAttrs = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var originalStyles = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var originalStyleText = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var PAINT_ATTRS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'];
  var MIN_FILL_STROKE_LIGHTNESS_DELTA = 0.12;
  var NEUTRAL_CHROMA_THRESHOLD = 0.025;
  var NEUTRAL_SHADOW_SOURCE_LIGHTNESS = 0.35;
  var NEUTRAL_MID_SOURCE_LIGHTNESS = 0.60;
  var DARK_INK_LIGHTNESS = 0.94;
  var DARK_NEUTRAL_SHADOW_LIGHTNESS = 0.78;
  var DARK_NEUTRAL_MID_LIGHTNESS = 0.62;
  var DARK_SURFACE_LIGHTNESS = 0.24;
  var DARK_CHROMATIC_BASE_LIGHTNESS = 0.40;
  var DARK_CHROMATIC_LIGHTNESS_SCALE = 0.40;
  var DARK_CHROMATIC_MIN_LIGHTNESS = 0.40;
  var DARK_CHROMATIC_MAX_LIGHTNESS = 0.80;
  var NAMED_COLORS = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
    cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', yellow: '#ffff00',
    gray: '#808080', grey: '#808080', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
    darkgray: '#a9a9a9', darkgrey: '#a9a9a9', orange: '#ffa500', purple: '#800080',
    brown: '#a52a2a', lime: '#00ff00', olive: '#808000', pink: '#ffc0cb', teal: '#008080',
    violet: '#ee82ee'
  };

  function clampByte(n) {
    return Math.max(0, Math.min(255, Math.round(n)));
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function darkNeutralLightness(sourceLightness) {
    var source = clamp(sourceLightness, 0, 1);
    if (source <= NEUTRAL_SHADOW_SOURCE_LIGHTNESS) {
      return lerp(DARK_INK_LIGHTNESS, DARK_NEUTRAL_SHADOW_LIGHTNESS, source / NEUTRAL_SHADOW_SOURCE_LIGHTNESS);
    }
    if (source <= NEUTRAL_MID_SOURCE_LIGHTNESS) {
      return lerp(DARK_NEUTRAL_SHADOW_LIGHTNESS, DARK_NEUTRAL_MID_LIGHTNESS, (source - NEUTRAL_SHADOW_SOURCE_LIGHTNESS) / (NEUTRAL_MID_SOURCE_LIGHTNESS - NEUTRAL_SHADOW_SOURCE_LIGHTNESS));
    }
    return lerp(DARK_NEUTRAL_MID_LIGHTNESS, DARK_SURFACE_LIGHTNESS, (source - NEUTRAL_MID_SOURCE_LIGHTNESS) / (1 - NEUTRAL_MID_SOURCE_LIGHTNESS));
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function(n) {
      return clampByte(n).toString(16).padStart(2, '0');
    }).join('');
  }

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function parseColorComponent(part) {
    var value = String(part || '').trim();
    if (!value) return NaN;
    if (value.slice(-1) === '%') return parseFloat(value) * 2.55;
    return parseFloat(value);
  }

  function parseAlpha(part) {
    if (part === undefined || part === null || String(part).trim() === '') return 1;
    var value = String(part).trim();
    if (value.slice(-1) === '%') return Math.max(0, Math.min(1, parseFloat(value) / 100));
    return Math.max(0, Math.min(1, parseFloat(value)));
  }

  function parsePaint(value) {
    if (!value) return null;
    var paint = String(value).trim();
    var lower = paint.toLowerCase();
    if (!lower || lower === 'none' || lower === 'transparent' || lower === 'currentcolor' || lower === 'inherit' || lower === 'initial' || lower.indexOf('url(') === 0) return null;
    var hex = lower.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
      var raw = hex[1];
      if (raw.length === 3 || raw.length === 4) raw = raw.split('').map(function(ch) { return ch + ch; }).join('');
      var alpha = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
      return { hex: '#' + raw.slice(0, 6), alpha: alpha };
    }
    var rgb = lower.match(/^rgba?\((.*)\)$/);
    if (rgb) {
      var body = rgb[1].trim();
      var alphaPart;
      if (body.indexOf('/') !== -1) {
        var slashParts = body.split('/');
        body = slashParts[0].trim();
        alphaPart = slashParts[1];
      }
      var parts = body.indexOf(',') !== -1 ? body.split(',') : body.split(/\s+/);
      if (parts.length >= 3) {
        if (alphaPart === undefined && parts.length > 3) alphaPart = parts[3];
        return {
          hex: rgbToHex(parseColorComponent(parts[0]), parseColorComponent(parts[1]), parseColorComponent(parts[2])),
          alpha: parseAlpha(alphaPart)
        };
      }
    }
    if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, lower)) {
      return { hex: NAMED_COLORS[lower], alpha: 1 };
    }
    return null;
  }

  function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linearToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

  function hexToOklch(hex) {
    var rgb = hexToRgb(hex);
    var r = srgbToLinear(rgb[0] / 255), g = srgbToLinear(rgb[1] / 255), b = srgbToLinear(rgb[2] / 255);
    var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    var L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    var a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    var bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    var C = Math.sqrt(a * a + bb * bb);
    var H = Math.atan2(bb, a) * (180 / Math.PI);
    if (H < 0) H += 360;
    return [L, C, H];
  }

  function oklchToHex(L, C, H) {
    var hRad = H * (Math.PI / 180), a = C * Math.cos(hRad), b = C * Math.sin(hRad);
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var lr = +4.0767416621 * (l_ * l_ * l_) - 3.3077115913 * (m_ * m_ * m_) + 0.2309699292 * (s_ * s_ * s_);
    var lg = -1.2684380046 * (l_ * l_ * l_) + 2.6097574011 * (m_ * m_ * m_) - 0.3413193965 * (s_ * s_ * s_);
    var lb = -0.0041960863 * (l_ * l_ * l_) - 0.7034186147 * (m_ * m_ * m_) + 1.7076147010 * (s_ * s_ * s_);
    return rgbToHex(linearToSrgb(lr) * 255, linearToSrgb(lg) * 255, linearToSrgb(lb) * 255);
  }

  function fallbackThemeVariant(hex, targetTheme) {
    if (targetTheme !== 'dark') return hex;
    var lch = hexToOklch(hex);
    if (lch[1] < NEUTRAL_CHROMA_THRESHOLD) {
      return oklchToHex(darkNeutralLightness(lch[0]), Math.min(0.015, lch[1]), lch[2]);
    }
    return oklchToHex(clamp(DARK_CHROMATIC_BASE_LIGHTNESS + lch[0] * DARK_CHROMATIC_LIGHTNESS_SCALE, DARK_CHROMATIC_MIN_LIGHTNESS, DARK_CHROMATIC_MAX_LIGHTNESS), Math.min(0.28, lch[1] * 1.12), lch[2]);
  }

  function themeVariant(hex, targetTheme) {
    if (window.InkToolbar && typeof window.InkToolbar.autoThemeVariant === 'function') {
      try { return window.InkToolbar.autoThemeVariant(hex, targetTheme); } catch (_) { /* fallback below */ }
    }
    return fallbackThemeVariant(hex, targetTheme);
  }

  function formatPaint(parsed, targetHex) {
    if (!parsed || parsed.alpha === undefined || parsed.alpha >= 1) return targetHex;
    var rgb = hexToRgb(targetHex);
    return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + Math.round(parsed.alpha * 1000) / 1000 + ')';
  }

  function translatePaint(value, targetTheme) {
    var parsed = parsePaint(value);
    if (!parsed) return value;
    return formatPaint(parsed, themeVariant(parsed.hex, targetTheme));
  }

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