/** Pure color conversion shared by authored content, SVG, and ink hosts. */
(function () {
  'use strict';

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
  var CSS_NUMBER = '[-+]?(?:\\d*\\.\\d+|\\d+)(?:e[-+]?\\d+)?';
  var OKLCH_COMPONENT = new RegExp('^(' + CSS_NUMBER + ')(%)?$');
  var OKLCH_HUE = new RegExp('^(' + CSS_NUMBER + ')(deg|grad|rad|turn)?$');
  var NAMED_COLORS = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
    cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', yellow: '#ffff00',
    gray: '#808080', grey: '#808080', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
    darkgray: '#a9a9a9', darkgrey: '#a9a9a9', orange: '#ffa500', purple: '#800080',
    brown: '#a52a2a', lime: '#00ff00', olive: '#808000', pink: '#ffc0cb', teal: '#008080',
    violet: '#ee82ee'
  };

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function lerp(start, end, amount) { return start + (end - start) * amount; }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (n) {
      return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    }).join('');
  }
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function parseColorComponent(part) {
    var value = String(part || '').trim();
    if (!/^[-+]?(?:\d*\.)?\d+%?$/.test(value)) return NaN;
    return value.slice(-1) === '%' ? parseFloat(value) * 2.55 : parseFloat(value);
  }
  function parseAlpha(part) {
    if (part === undefined || part === null) return 1;
    var value = String(part).trim();
    if (!/^[-+]?(?:\d*\.)?\d+%?$/.test(value)) return NaN;
    return clamp(parseFloat(value) / (value.slice(-1) === '%' ? 100 : 1), 0, 1);
  }

  function parseOklchComponent(value, percentageScale) {
    if (value === 'none') return 0;
    var match = value.match(OKLCH_COMPONENT);
    return match ? Number(match[1]) * (match[2] ? percentageScale / 100 : 1) : NaN;
  }
  function parseOklchHue(value) {
    if (value === 'none') return 0;
    var match = value.match(OKLCH_HUE);
    if (!match) return NaN;
    var scales = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
    var degrees = Number(match[1]) * (match[2] ? scales[match[2]] : 1);
    return ((degrees % 360) + 360) % 360;
  }
  function parseOklch(body) {
    var slashParts = body.trim().split('/');
    if (slashParts.length > 2) return null;
    var parts = slashParts[0].trim().split(/\s+/);
    if (parts.length !== 3) return null;
    var lightness = parseOklchComponent(parts[0], 1);
    var chroma = parseOklchComponent(parts[1], 0.4);
    var hue = parseOklchHue(parts[2]);
    var alpha = slashParts.length === 2 ? parseOklchComponent(slashParts[1].trim(), 1) : 1;
    if (![lightness, chroma, hue, alpha].every(Number.isFinite)) return null;
    lightness = clamp(lightness, 0, 1);
    var hex = lightness === 0 ? '#000000' : lightness === 1 ? '#ffffff' : oklchToHex(lightness, Math.max(0, chroma), hue);
    if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
    return { hex: hex, alpha: clamp(alpha, 0, 1) };
  }

  /** Return a simple sRGB paint and alpha; leave CSS expressions to the caller. */
  function parsePaint(value) {
    if (!value) return null;
    var lower = String(value).trim().toLowerCase();
    var hex = lower.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
      var raw = hex[1];
      if (raw.length === 3 || raw.length === 4) raw = raw.split('').map(function (ch) { return ch + ch; }).join('');
      return { hex: '#' + raw.slice(0, 6), alpha: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1 };
    }
    var rgb = lower.match(/^rgba?\((.*)\)$/);
    if (rgb) {
      var body = rgb[1].trim();
      var alphaPart;
      var slashParts = body.split('/');
      if (slashParts.length > 2) return null;
      if (slashParts.length === 2) { body = slashParts[0].trim(); alphaPart = slashParts[1]; }
      var parts = body.indexOf(',') !== -1 ? body.split(',') : body.split(/\s+/);
      if (parts.length === 4 && alphaPart === undefined) alphaPart = parts.pop();
      if (parts.length !== 3) return null;
      var components = parts.map(parseColorComponent);
      var alpha = parseAlpha(alphaPart);
      if (!components.every(Number.isFinite) || !Number.isFinite(alpha)) return null;
      return { hex: rgbToHex(components[0], components[1], components[2]), alpha: alpha };
    }
    var oklch = lower.match(/^oklch\(([\s\S]*)\)$/);
    if (oklch) return parseOklch(oklch[1]);
    return Object.prototype.hasOwnProperty.call(NAMED_COLORS, lower)
      ? { hex: NAMED_COLORS[lower], alpha: 1 }
      : null;
  }

  function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linearToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function linearRgbToOklab(r, g, b) {
    var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return [
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    ];
  }
  function oklabToLinearRgb(L, a, b) {
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    return [
      +4.0767416621 * (l_ * l_ * l_) - 3.3077115913 * (m_ * m_ * m_) + 0.2309699292 * (s_ * s_ * s_),
      -1.2684380046 * (l_ * l_ * l_) + 2.6097574011 * (m_ * m_ * m_) - 0.3413193965 * (s_ * s_ * s_),
      -0.0041960863 * (l_ * l_ * l_) - 0.7034186147 * (m_ * m_ * m_) + 1.7076147010 * (s_ * s_ * s_)
    ];
  }
  function hexToOklch(hex) {
    var rgb = hexToRgb(hex);
    var lab = linearRgbToOklab(srgbToLinear(rgb[0] / 255), srgbToLinear(rgb[1] / 255), srgbToLinear(rgb[2] / 255));
    var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    var H = Math.atan2(lab[2], lab[1]) * (180 / Math.PI);
    return [lab[0], C, H < 0 ? H + 360 : H];
  }
  function oklchToHex(L, C, H) {
    var hRad = H * (Math.PI / 180);
    var rgb = oklabToLinearRgb(L, C * Math.cos(hRad), C * Math.sin(hRad));
    return rgbToHex(linearToSrgb(rgb[0]) * 255, linearToSrgb(rgb[1]) * 255, linearToSrgb(rgb[2]) * 255);
  }

  function darkNeutralLightness(sourceLightness) {
    var source = clamp(sourceLightness, 0, 1);
    if (source <= NEUTRAL_SHADOW_SOURCE_LIGHTNESS) return lerp(DARK_INK_LIGHTNESS, DARK_NEUTRAL_SHADOW_LIGHTNESS, source / NEUTRAL_SHADOW_SOURCE_LIGHTNESS);
    if (source <= NEUTRAL_MID_SOURCE_LIGHTNESS) return lerp(DARK_NEUTRAL_SHADOW_LIGHTNESS, DARK_NEUTRAL_MID_LIGHTNESS, (source - NEUTRAL_SHADOW_SOURCE_LIGHTNESS) / (NEUTRAL_MID_SOURCE_LIGHTNESS - NEUTRAL_SHADOW_SOURCE_LIGHTNESS));
    return lerp(DARK_NEUTRAL_MID_LIGHTNESS, DARK_SURFACE_LIGHTNESS, (source - NEUTRAL_MID_SOURCE_LIGHTNESS) / (1 - NEUTRAL_MID_SOURCE_LIGHTNESS));
  }
  function lightNeutralLightness(darkLightness) {
    var dark = clamp(darkLightness, DARK_SURFACE_LIGHTNESS, DARK_INK_LIGHTNESS);
    if (dark >= DARK_NEUTRAL_SHADOW_LIGHTNESS) return lerp(0, NEUTRAL_SHADOW_SOURCE_LIGHTNESS, (DARK_INK_LIGHTNESS - dark) / (DARK_INK_LIGHTNESS - DARK_NEUTRAL_SHADOW_LIGHTNESS));
    if (dark >= DARK_NEUTRAL_MID_LIGHTNESS) return lerp(NEUTRAL_SHADOW_SOURCE_LIGHTNESS, NEUTRAL_MID_SOURCE_LIGHTNESS, (DARK_NEUTRAL_SHADOW_LIGHTNESS - dark) / (DARK_NEUTRAL_SHADOW_LIGHTNESS - DARK_NEUTRAL_MID_LIGHTNESS));
    return lerp(NEUTRAL_MID_SOURCE_LIGHTNESS, 1, (DARK_NEUTRAL_MID_LIGHTNESS - dark) / (DARK_NEUTRAL_MID_LIGHTNESS - DARK_SURFACE_LIGHTNESS));
  }
  function autoDarkVariant(lightHex) {
    var lch = hexToOklch(lightHex);
    if (lch[1] < NEUTRAL_CHROMA_THRESHOLD) return oklchToHex(darkNeutralLightness(lch[0]), Math.min(0.015, lch[1]), lch[2]);
    return oklchToHex(clamp(DARK_CHROMATIC_BASE_LIGHTNESS + lch[0] * DARK_CHROMATIC_LIGHTNESS_SCALE, DARK_CHROMATIC_MIN_LIGHTNESS, DARK_CHROMATIC_MAX_LIGHTNESS), Math.min(0.28, lch[1] * 1.12), lch[2]);
  }
  function autoLightVariant(darkHex) {
    var lch = hexToOklch(darkHex);
    if (lch[1] < NEUTRAL_CHROMA_THRESHOLD) return oklchToHex(lightNeutralLightness(lch[0]), Math.min(0.015, lch[1]), lch[2]);
    return oklchToHex(clamp((lch[0] - DARK_CHROMATIC_BASE_LIGHTNESS) / DARK_CHROMATIC_LIGHTNESS_SCALE, 0.25, 0.85), Math.max(0.01, lch[1] / 1.12), lch[2]);
  }
  /** Legacy bidirectional ink API: a light target treats the input as dark. */
  function autoThemeVariant(hex, targetTheme) {
    return targetTheme === 'dark' ? autoDarkVariant(hex) : autoLightVariant(hex);
  }
  function formatPaint(parsed, targetHex) {
    if (!parsed || parsed.alpha === undefined || parsed.alpha >= 1) return targetHex;
    var rgb = hexToRgb(targetHex);
    return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + Math.round(parsed.alpha * 1000) / 1000 + ')';
  }
  /** Authored paints always have a light-theme source; never reverse-map them. */
  function themePaint(value, targetTheme) {
    if (targetTheme !== 'dark' && targetTheme !== 'kindle') return value;
    var parsed = parsePaint(value);
    if (!parsed) return value;
    var target;
    if (targetTheme === 'dark') target = autoDarkVariant(parsed.hex);
    else target = oklchToHex(hexToOklch(parsed.hex)[0], 0, 0);
    return formatPaint(parsed, target);
  }

  function luminance(hex) {
    var rgb = hexToRgb(hex).map(function (channel) { return srgbToLinear(channel / 255); });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function contrastRatio(foregroundHex, backgroundHex) {
    var foreground = luminance(foregroundHex), background = luminance(backgroundHex);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  }

  /** Preserve readable opaque authored pairs when the dark ramp compresses them. */
  function themePaintPair(foreground, background, targetTheme) {
    var result = { foreground: themePaint(foreground, targetTheme), background: themePaint(background, targetTheme) };
    if (targetTheme !== 'dark' && targetTheme !== 'kindle') return result;
    var sourceForeground = parsePaint(foreground), sourceBackground = parsePaint(background);
    if (!sourceForeground || !sourceBackground || sourceForeground.alpha < 1 || sourceBackground.alpha < 1) return result;
    var minimumContrast = 4.5;
    if (contrastRatio(sourceForeground.hex, sourceBackground.hex) < minimumContrast) return result;
    var convertedForeground = parsePaint(result.foreground), convertedBackground = parsePaint(result.background);
    if (contrastRatio(convertedForeground.hex, convertedBackground.hex) >= minimumContrast) return result;
    var lch = hexToOklch(convertedForeground.hex);
    var candidates = [];
    [0, 1].forEach(function (endpoint) {
      var best = oklchToHex(endpoint, lch[1], lch[2]);
      if (contrastRatio(best, convertedBackground.hex) < minimumContrast) return;
      var good = endpoint, bad = lch[0];
      for (var i = 0; i < 32; i++) {
        var middle = (good + bad) / 2;
        var next = oklchToHex(middle, lch[1], lch[2]);
        if (contrastRatio(next, convertedBackground.hex) >= minimumContrast) { good = middle; best = next; }
        else bad = middle;
      }
      candidates.push({ hex: best, delta: Math.abs(good - lch[0]) });
    });
    // Some hues cannot reach sufficient contrast at fixed chroma after sRGB
    // clipping. A neutral endpoint preserves readability in that narrow case.
    if (!candidates.length) {
      var endpoints = ['#000000', '#ffffff'];
      endpoints.sort(function (a, b) {
        return contrastRatio(b, convertedBackground.hex) - contrastRatio(a, convertedBackground.hex);
      });
      candidates.push({ hex: endpoints[0], delta: Math.abs(hexToOklch(endpoints[0])[0] - lch[0]) });
    }
    candidates.sort(function (a, b) { return a.delta - b.delta; });
    result.foreground = candidates[0].hex;
    return result;
  }

  var api = {
    parsePaint: parsePaint, formatPaint: formatPaint, themePaint: themePaint,
    themePaintPair: themePaintPair, contrastRatio: contrastRatio,
    hexToRgb: hexToRgb, rgbToHex: rgbToHex, hexToOklch: hexToOklch, oklchToHex: oklchToHex,
    autoDarkVariant: autoDarkVariant, autoLightVariant: autoLightVariant,
    perceptualDarkVariant: autoDarkVariant, perceptualLightVariant: autoLightVariant,
    autoThemeVariant: autoThemeVariant
  };
  if (typeof window !== 'undefined') window.RprintThemeColors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
