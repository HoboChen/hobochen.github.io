/**
 * features/ink/core/stroke-format.js — canonical, headless owner of the WBRD
 * *format*: the version/limit constants, the tool/style/font wire tables, the
 * primitive field codecs (UUID, colour, pressure, embedded JSON) and the
 * single-stroke encode/decode pair.
 *
 * This file deliberately contains no rendering, no geometry, no editor state
 * and no DOM access, so the same bytes can be produced and parsed by the
 * browser, the live SPA server, the static builder, the offline runtime, the
 * whiteboard server adapter and the PDF annotator without any of them pulling
 * in a canvas. Everything client-facing (stroke rasterisation, smoothing,
 * hit-testing, lasso selection, the text editor) stays in
 * features/ink/core/canvas-codec.js and features/ink/core/stroke-codec.js,
 * which layer on top of this module.
 *
 * Load order (classic scripts, each layer widening the previous one):
 *   stroke-format.js  ->  canvas-codec.js  ->  stroke-codec.js
 * Public URLs: `/static/core/ink-stroke-format.js`,
 * `/static/drawing-engine-render.js`, `/static/drawing-engine.js`.
 *
 * In a browser this publishes its own stable `window.InkStrokeFormat` handle
 * rather than widening `window.DrawingEngine`: that global keeps its existing
 * meaning ("the render layer, then the full engine"), so nothing can observe a
 * half-built `DrawingEngine` if a later chunk fails to load.
 */
(function () {
  'use strict';

  // ---- Binary format constants ----
  // This is the single owner of the WBRD version numbers: canvas-codec.js,
  // stroke-codec.js, the whiteboard operation codec and the whiteboard server
  // read these instead of redeclaring them so a version bump only happens in
  // one place.
  var WB_MAGIC = 0x44524257; // "WBRD" little-endian
  var WB_BIN_VERSION = 3;
  var WB_FORMAT_VERSION = [0, 0, 7]; // semver [major, minor, patch]
  var WB_FORMAT_VERSION_STR = '0.0.7';
  var WB_MIN_SUPPORTED_VERSION = '0.0.1';
  var TOOL_UNMAP = ['pen', 'eraser', 'text', 'widget'];
  var STYLE_UNMAP = ['quill', 'highlighter', 'marker', 'ballpoint', 'quill', 'quill', 'quill', 'pen', 'quill', 'quill'];
  var FONT_UNMAP = ['sans-serif', 'serif', 'monospace', 'cursive'];
  var TOOL_MAP = { pen: 0, eraser: 1, text: 2, widget: 3 };
  var STYLE_MAP = { quill: 0, highlighter: 1, marker: 2, ballpoint: 3, pen: 7 };
  var FONT_MAP = { 'sans-serif': 0, 'serif': 1, 'monospace': 2, 'cursive': 3 };
  var WIDGET_TYPE_MAX_BYTES = 64;
  var WIDGET_STATE_MAX_BYTES = 65536;
  var WIDGET_LOG_MAX_BYTES = 1048576;
  // Safety ceiling for stroke point counts when decoding (mirrors the bound
  // the server enforces when reading arbitrary/legacy files from disk).
  var WB_MAX_POINTS_PER_STROKE = 100000;
  // Numeric encoding of WB_FORMAT_VERSION, e.g. [0,0,7] -> 7. Used as the
  // default `vNum` for decode calls that don't pass one explicitly (this
  // module and its callers only ever see current-version data — legacy
  // version-aware decoding is exercised via the explicit `vNum` parameter,
  // used when replaying older on-disk formats).
  function currentVNum() {
    return WB_FORMAT_VERSION[0] * 10000 + WB_FORMAT_VERSION[1] * 100 + WB_FORMAT_VERSION[2];
  }

  // ---- Primitive field codecs ----

  function bytesToUuid(bytes, offset) {
    var hex = '';
    for (var i = 0; i < 16; i++) {
      var b = bytes[offset + i];
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    return hex.substr(0, 8) + '-' + hex.substr(8, 4) + '-' + hex.substr(12, 4) + '-' + hex.substr(16, 4) + '-' + hex.substr(20, 12);
  }

  function uuidToBytes(str) {
    var hex = str.replace(/-/g, '');
    var bytes = new Uint8Array(16);
    for (var i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }

  function rgbToColor(r, g, b) {
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function colorToRGB(hex) {
    var v = parseInt(hex.replace('#', ''), 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  }

  function u16ToPressure(v) {
    return v / 65535;
  }

  function pressureToU16(p) {
    return Math.round(Math.max(0, Math.min(1, p)) * 65535);
  }

  function decodeJsonBytes(u8, offset, byteLen, fallback, strict) {
    if (!byteLen) {
      if (strict) throw new Error('Invalid WBRD JSON payload: empty');
      return fallback;
    }
    try {
      var decoder = strict
        ? new TextDecoder('utf-8', { fatal: true })
        : new TextDecoder();
      var text = decoder.decode(u8.slice(offset, offset + byteLen));
      return JSON.parse(text);
    } catch (e) {
      if (strict) throw new Error('Invalid WBRD JSON payload: ' + e.message);
      return fallback;
    }
  }

  function encodeJsonBytes(value, fallback, maxBytes, label) {
    var source = value === undefined ? fallback : value;
    var text;
    try {
      text = JSON.stringify(source);
    } catch (e) {
      text = JSON.stringify(fallback);
    }
    if (text === undefined) text = JSON.stringify(fallback);
    var bytes = new TextEncoder().encode(text);
    if (bytes.length > maxBytes) throw new Error(label + ' is too large');
    return bytes;
  }

  function normalizeWidgetState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  }

  function normalizeWidgetLog(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    for (var i = 0; i < value.length; i++) {
      if (value[i] && typeof value[i] === 'object' && !Array.isArray(value[i])) out.push(value[i]);
    }
    return out;
  }

  // ---- UUID helper ----
  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ---- Codec: decodeStroke ----

  // vNum: numeric version (e.g. 5 for 0.0.5), used to gate fields that were
  // added in later format revisions. Defaults to the current version since
  // this module only ever sees current-version data in the browser — the
  // server passes an explicit historical vNum when migrating legacy .wb
  // files loaded from disk (see features/whiteboard/core/migration.js).
  function decodeStroke(view, u8, offset, vNum, strict) {
    if (vNum === undefined) vNum = currentVNum();
    var id = bytesToUuid(u8, offset);
    var toolByte = view.getUint8(offset + 16);
    var styleByte = view.getUint8(offset + 17);
    var r = u8[offset + 18], g = u8[offset + 19], b = u8[offset + 20];
    var baseSize = view.getFloat32(offset + 21, true);
    var tool = TOOL_UNMAP[toolByte] || 'pen';
    var inkStyle = STYLE_UNMAP[styleByte] || 'quill';
    var color = rgbToColor(r, g, b);

    if (tool === 'widget') {
      var xw = view.getFloat32(offset + 25, true);
      var yw = view.getFloat32(offset + 29, true);
      var width = view.getFloat32(offset + 33, true);
      var height = view.getFloat32(offset + 37, true);
      var widgetVersion = view.getUint16(offset + 41, true);
      var typeLen = view.getUint16(offset + 43, true);
      if (typeLen > WIDGET_TYPE_MAX_BYTES) throw new Error('Widget type is too large');
      var wOff = offset + 45;
      if (wOff + typeLen + 8 > u8.length) throw new Error('Buffer too short for widget stroke');
      var widgetType = new TextDecoder().decode(u8.slice(wOff, wOff + typeLen));
      wOff += typeLen;
      var stateLen = view.getUint32(wOff, true); wOff += 4;
      if (stateLen > WIDGET_STATE_MAX_BYTES || wOff + stateLen + 4 > u8.length) throw new Error('Widget state is too large');
      var decodedState = decodeJsonBytes(u8, wOff, stateLen, {}, strict);
      if (strict && (!decodedState || typeof decodedState !== 'object'
          || Array.isArray(decodedState))) {
        throw new Error('Invalid WBRD widget state');
      }
      var compactedState = normalizeWidgetState(decodedState);
      wOff += stateLen;
      var logLen = view.getUint32(wOff, true); wOff += 4;
      if (logLen > WIDGET_LOG_MAX_BYTES || wOff + logLen > u8.length) throw new Error('Widget log is too large');
      var decodedLog = decodeJsonBytes(u8, wOff, logLen, [], strict);
      if (strict && (!Array.isArray(decodedLog)
          || decodedLog.some(function (entry) {
            return !entry || typeof entry !== 'object' || Array.isArray(entry);
          }))) {
        throw new Error('Invalid WBRD widget log');
      }
      var widgetLog = normalizeWidgetLog(decodedLog);
      wOff += logLen;
      return {
        stroke: {
          id: id,
          tool: tool,
          inkStyle: inkStyle,
          color: color,
          baseSize: baseSize,
          x: xw,
          y: yw,
          width: width,
          height: height,
          widgetType: widgetType || 'unknown',
          widgetVersion: widgetVersion || 1,
          compactedState: compactedState,
          log: widgetLog,
        },
        bytesRead: wOff - offset,
      };
    }

    if (tool === 'text') {
      var fontFamily = FONT_UNMAP[styleByte] || 'sans-serif';
      var x = view.getFloat32(offset + 25, true);
      var y = view.getFloat32(offset + 29, true);
      var fontSize = view.getFloat32(offset + 33, true);
      var textLen = view.getUint16(offset + 37, true);
      var textBytes = u8.slice(offset + 39, offset + 39 + textLen);
      var text = new TextDecoder().decode(textBytes);
      var epOff = offset + 39 + textLen;
      var eraserPaths = [];
      var totalRead = 39 + textLen;
      // eraserPaths only exist for v0.0.5+ — older versions don't have this field.
      if (vNum >= 5 && epOff + 2 <= u8.length) {
        var pathCount = view.getUint16(epOff, true); epOff += 2;
        for (var epi = 0; epi < pathCount; epi++) {
          var epBaseSize = view.getFloat32(epOff, true); epOff += 4;
          var epPtCount = view.getUint16(epOff, true); epOff += 2;
          var epPts = [];
          for (var epj = 0; epj < epPtCount; epj++) {
            epPts.push({ x: view.getFloat32(epOff, true), y: view.getFloat32(epOff + 4, true) });
            epOff += 8;
          }
          eraserPaths.push({ baseSize: epBaseSize, points: epPts });
        }
        totalRead = epOff - offset;
      }
      var ts = { id: id, tool: tool, inkStyle: inkStyle, color: color, baseSize: baseSize, text: text, x: x, y: y, fontSize: fontSize, fontFamily: fontFamily };
      if (eraserPaths.length > 0) ts.eraserPaths = eraserPaths;
      return { stroke: ts, bytesRead: totalRead };
    }

    var count = view.getUint32(offset + 25, true);
    if (count > WB_MAX_POINTS_PER_STROKE) {
      throw new Error('Stroke point count exceeds limit (' + count + ' > ' + WB_MAX_POINTS_PER_STROKE + ')');
    }
    if (offset + 29 + count * 10 > u8.length) {
      throw new Error('Buffer too short for ' + count + ' stroke points');
    }
    var points = [];
    var off = offset + 29;
    for (var i = 0; i < count; i++) {
      points.push({
        x: view.getFloat32(off, true),
        y: view.getFloat32(off + 4, true),
        pressure: u16ToPressure(view.getUint16(off + 8, true)),
      });
      off += 10;
    }
    return {
      stroke: { id: id, tool: tool, inkStyle: inkStyle, color: color, baseSize: baseSize, points: points },
      bytesRead: 29 + count * 10,
    };
  }

  // ---- Codec: encodeStroke ----

  function encodeStroke(s) {
    var uuid = uuidToBytes(s.id);
    var rgb = colorToRGB(s.color || '#0969da');
    var toolByte = TOOL_MAP[s.tool] || 0;
    var styleByte = s.tool === 'text' ? (FONT_MAP[s.fontFamily] || 0) : (STYLE_MAP[s.inkStyle] || 0);

    if (s.tool === 'text') {
      var textBytes = new TextEncoder().encode(s.text || '');
      var epaths = s.eraserPaths || [];
      var epSize = 2;
      for (var ei0 = 0; ei0 < epaths.length; ei0++) {
        epSize += 4 + 2 + (epaths[ei0].points ? epaths[ei0].points.length * 8 : 0);
      }
      var tbuf = new ArrayBuffer(25 + 12 + 2 + textBytes.length + epSize);
      var tview = new DataView(tbuf);
      var tu8 = new Uint8Array(tbuf);
      tu8.set(uuid, 0);
      tview.setUint8(16, toolByte);
      tview.setUint8(17, styleByte);
      tu8[18] = rgb[0]; tu8[19] = rgb[1]; tu8[20] = rgb[2];
      tview.setFloat32(21, s.baseSize, true);
      tview.setFloat32(25, s.x || 0, true);
      tview.setFloat32(29, s.y || 0, true);
      tview.setFloat32(33, s.fontSize || 16, true);
      tview.setUint16(37, textBytes.length, true);
      tu8.set(textBytes, 39);
      var epOff = 39 + textBytes.length;
      tview.setUint16(epOff, epaths.length, true); epOff += 2;
      for (var ei = 0; ei < epaths.length; ei++) {
        var ep = epaths[ei];
        var epPts = ep.points || [];
        tview.setFloat32(epOff, ep.baseSize, true); epOff += 4;
        tview.setUint16(epOff, epPts.length, true); epOff += 2;
        for (var epi = 0; epi < epPts.length; epi++) {
          tview.setFloat32(epOff, epPts[epi].x, true); epOff += 4;
          tview.setFloat32(epOff, epPts[epi].y, true); epOff += 4;
        }
      }
      return new Uint8Array(tbuf);
    }

    if (s.tool === 'widget') {
      var typeBytes = new TextEncoder().encode(s.widgetType || 'unknown');
      if (typeBytes.length > WIDGET_TYPE_MAX_BYTES) throw new Error('Widget type is too large');
      var stateBytes = encodeJsonBytes(s.compactedState || {}, {}, WIDGET_STATE_MAX_BYTES, 'Widget state');
      var logBytes = encodeJsonBytes(Array.isArray(s.log) ? s.log : [], [], WIDGET_LOG_MAX_BYTES, 'Widget log');
      var wbuf = new ArrayBuffer(45 + typeBytes.length + 4 + stateBytes.length + 4 + logBytes.length);
      var wview = new DataView(wbuf);
      var wu8 = new Uint8Array(wbuf);
      wu8.set(uuid, 0);
      wview.setUint8(16, toolByte);
      wview.setUint8(17, styleByte);
      wu8[18] = rgb[0]; wu8[19] = rgb[1]; wu8[20] = rgb[2];
      wview.setFloat32(21, s.baseSize || 1, true);
      wview.setFloat32(25, s.x || 0, true);
      wview.setFloat32(29, s.y || 0, true);
      wview.setFloat32(33, s.width || 220, true);
      wview.setFloat32(37, s.height || 120, true);
      wview.setUint16(41, s.widgetVersion || 1, true);
      wview.setUint16(43, typeBytes.length, true);
      var wOff = 45;
      wu8.set(typeBytes, wOff); wOff += typeBytes.length;
      wview.setUint32(wOff, stateBytes.length, true); wOff += 4;
      wu8.set(stateBytes, wOff); wOff += stateBytes.length;
      wview.setUint32(wOff, logBytes.length, true); wOff += 4;
      wu8.set(logBytes, wOff);
      return new Uint8Array(wbuf);
    }

    var pts = s.points || [];
    if (pts.length > WB_MAX_POINTS_PER_STROKE) {
      throw new Error('Stroke has too many points (' + pts.length + ' > ' + WB_MAX_POINTS_PER_STROKE + ')');
    }
    var buf = new ArrayBuffer(25 + 4 + pts.length * 10);
    var view = new DataView(buf);
    var u8 = new Uint8Array(buf);
    u8.set(uuid, 0);
    view.setUint8(16, toolByte);
    view.setUint8(17, styleByte);
    u8[18] = rgb[0]; u8[19] = rgb[1]; u8[20] = rgb[2];
    view.setFloat32(21, s.baseSize, true);
    view.setUint32(25, pts.length, true);
    var off = 29;
    for (var i = 0; i < pts.length; i++) {
      view.setFloat32(off, pts[i].x, true);
      view.setFloat32(off + 4, pts[i].y, true);
      view.setUint16(off + 8, pressureToU16(pts[i].pressure), true);
      off += 10;
    }
    return new Uint8Array(buf);
  }

  // ---- Export ----

  var api = {
    // Constants
    WB_MAGIC: WB_MAGIC,
    WB_BIN_VERSION: WB_BIN_VERSION,
    WB_FORMAT_VERSION: WB_FORMAT_VERSION,
    WB_FORMAT_VERSION_STR: WB_FORMAT_VERSION_STR,
    WB_MIN_SUPPORTED_VERSION: WB_MIN_SUPPORTED_VERSION,
    WB_MAX_POINTS_PER_STROKE: WB_MAX_POINTS_PER_STROKE,
    TOOL_MAP: TOOL_MAP,
    TOOL_UNMAP: TOOL_UNMAP,
    STYLE_MAP: STYLE_MAP,
    STYLE_UNMAP: STYLE_UNMAP,
    FONT_MAP: FONT_MAP,
    FONT_UNMAP: FONT_UNMAP,
    WIDGET_TYPE_MAX_BYTES: WIDGET_TYPE_MAX_BYTES,
    WIDGET_STATE_MAX_BYTES: WIDGET_STATE_MAX_BYTES,
    WIDGET_LOG_MAX_BYTES: WIDGET_LOG_MAX_BYTES,
    currentVNum: currentVNum,
    // Primitive field codecs
    bytesToUuid: bytesToUuid,
    uuidToBytes: uuidToBytes,
    rgbToColor: rgbToColor,
    colorToRGB: colorToRGB,
    u16ToPressure: u16ToPressure,
    pressureToU16: pressureToU16,
    decodeJsonBytes: decodeJsonBytes,
    encodeJsonBytes: encodeJsonBytes,
    normalizeWidgetState: normalizeWidgetState,
    normalizeWidgetLog: normalizeWidgetLog,
    generateId: generateId,
    // Stroke codec
    decodeStroke: decodeStroke,
    encodeStroke: encodeStroke,
  };

  if (typeof window !== 'undefined') window.InkStrokeFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
