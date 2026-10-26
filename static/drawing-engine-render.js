/**
 * features/ink/core/canvas-codec.js — canonical read-only decode + render
 * layer for the WBRD stroke/canvas binary format: whole-canvas decoding plus
 * the client-facing stroke rendering/geometry primitives.
 *
 * The pure format layer underneath (WBRD version/limit constants, tool/style/
 * font tables, UUID/colour/pressure/JSON field codecs and the single-stroke
 * encode/decode pair) is owned by features/ink/core/stroke-format.js, which
 * must be loaded first; this file widens that API rather than redeclaring any
 * of it.
 *
 * Exports `window.DrawingEngine` (in a browser) / `module.exports` (in
 * Node) with:
 *   - Codec: decodeStroke, decodeCanvas
 *   - Rendering: drawStroke, drawTextStroke
 *
 * src/features/ink/core/stroke-codec.js extends this module with encoding,
 * eraser, hit-testing, selection, and text editor capabilities.
 *
 * src/client/ink/drawing-engine-render.js is now a thin adapter over this file
 * (see that file's header) so the existing `/static/drawing-engine-render.js`
 * URL and `window.DrawingEngine` global keep working unchanged for browsers,
 * the live SPA server, the static site builder, and Node/test consumers.
 */
(function () {
  'use strict';

  // ---- Grab the pure format layer from stroke-format.js ----
  var base = (typeof window !== 'undefined' && window.InkStrokeFormat) ||
             (typeof require === 'function' && require('./stroke-format'));
  if (!base) throw new Error('canvas-codec.js requires stroke-format.js to be loaded first');

  var WB_MAGIC = base.WB_MAGIC;
  var WB_BIN_VERSION = base.WB_BIN_VERSION;
  var WB_FORMAT_VERSION = base.WB_FORMAT_VERSION;
  var WB_FORMAT_VERSION_STR = base.WB_FORMAT_VERSION_STR;
  var WB_MIN_SUPPORTED_VERSION = base.WB_MIN_SUPPORTED_VERSION;
  var WB_MAX_POINTS_PER_STROKE = base.WB_MAX_POINTS_PER_STROKE;
  var TOOL_UNMAP = base.TOOL_UNMAP;
  var STYLE_UNMAP = base.STYLE_UNMAP;
  var FONT_UNMAP = base.FONT_UNMAP;
  var WIDGET_TYPE_MAX_BYTES = base.WIDGET_TYPE_MAX_BYTES;
  var WIDGET_STATE_MAX_BYTES = base.WIDGET_STATE_MAX_BYTES;
  var WIDGET_LOG_MAX_BYTES = base.WIDGET_LOG_MAX_BYTES;
  var currentVNum = base.currentVNum;
  var bytesToUuid = base.bytesToUuid;
  var rgbToColor = base.rgbToColor;
  var u16ToPressure = base.u16ToPressure;
  var decodeJsonBytes = base.decodeJsonBytes;
  var normalizeWidgetState = base.normalizeWidgetState;
  var normalizeWidgetLog = base.normalizeWidgetLog;
  var decodeStroke = base.decodeStroke;

  var INK_STYLES = {
    quill:       { label: 'Quill',     pressure: true,  widthMul: 1,   alpha: 1 },
    pen:         { label: 'Pen',       pressure: true,  widthMul: 1,   alpha: 1 },
    ballpoint:   { label: 'Ballpoint', pressure: true,  widthMul: 0.6, alpha: 1 },
    highlighter: { label: 'Highlight', pressure: false, widthMul: 3,   alpha: 0.35 },
    marker:      { label: 'Marker',    pressure: false, widthMul: 0.5, alpha: 1 },
  };

  // ---- Codec: decodeCanvas ----

  function decodeCanvas(buffer) {
    var view = new DataView(buffer);
    var u8 = new Uint8Array(buffer);
    if (buffer.byteLength < 10) return { strokes: [], version: null, extensions: new Map() };
    var magic = view.getUint32(0, true);
    if (magic !== WB_MAGIC) return { strokes: [], version: null, extensions: new Map() };
    var binVer = view.getUint16(4, true);
    var version, headerSize;
    if (binVer <= 2) {
      version = '0.0.1';
      headerSize = 10;
    } else {
      if (buffer.byteLength < 13) return { strokes: [], version: null, extensions: new Map() };
      version = u8[6] + '.' + u8[7] + '.' + u8[8];
      headerSize = 13;
    }
    var vParts = version.split('.').map(Number);
    var vNum = vParts[0] * 10000 + vParts[1] * 100 + vParts[2];
    var countOffset = headerSize - 4;
    var count = view.getUint32(countOffset, true);
    var strokes = [];
    var off = headerSize;
    for (var i = 0; i < count; i++) {
      var result = decodeStroke(view, u8, off, vNum);
      strokes.push(result.stroke);
      off += result.bytesRead;
    }

    var extensions = new Map();
    if (vNum >= 3 && off + 8 <= buffer.byteLength) {
      off += 4; // skip compactedSeq
      var logCount = view.getUint32(off, true); off += 4;
      if (logCount === 0 && vNum >= 6 && off + 2 <= buffer.byteLength) {
        var extCount = view.getUint16(off, true); off += 2;
        for (var ei = 0; ei < extCount; ei++) {
          var idLen = view.getUint8(off); off += 1;
          var idBytes = u8.slice(off, off + idLen); off += idLen;
          var id = new TextDecoder().decode(idBytes);
          var byteLen = view.getUint32(off, true); off += 4;
          var payload = new Uint8Array(buffer, off, byteLen);
          extensions.set(id, new Uint8Array(payload));
          off += byteLen;
        }
      }
    }

    return { strokes: strokes, version: version, extensions: extensions };
  }

  // ---- Rendering primitives ----

  function streamlineFilter(pts, alpha) {
    if (!pts || pts.length < 2 || alpha >= 1) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var prev = out[i - 1];
      out.push({
        x: prev.x + (pts[i].x - prev.x) * alpha,
        y: prev.y + (pts[i].y - prev.y) * alpha,
        pressure: pts[i].pressure,
      });
    }
    return out;
  }

  function catmullRomPath(ctx, pts, tension) {
    if (pts.length < 2) return;
    if (pts.length === 2 || tension <= 0) {
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      return;
    }
    var tau = 0.5 * (1 - (1 - tension) * 0.5);
    for (var j = 0; j < pts.length - 1; j++) {
      var p0 = pts[Math.max(j - 1, 0)];
      var p1 = pts[j];
      var p2 = pts[j + 1];
      var p3 = pts[Math.min(j + 2, pts.length - 1)];
      var cp1x = p1.x + (p2.x - p0.x) * tau / 3;
      var cp1y = p1.y + (p2.y - p0.y) * tau / 3;
      var cp2x = p2.x - (p3.x - p1.x) * tau / 3;
      var cp2y = p2.y - (p3.y - p1.y) * tau / 3;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  function computeStrokeWidths(pts, bs, inkStyleName) {
    if (bs < 0.5) bs = 0.5;
    var widths = [];
    for (var i = 0; i < pts.length; i++) {
      var w = bs * pts[i].pressure;
      if (w < 0.5) w = 0.5;
      if (w > bs) w = bs;
      widths.push(w);
    }

    var dirSpan = 1;
    if (pts.length > 4) {
      var totalDist = 0;
      for (var di = 1; di < pts.length; di++) {
        var ddx = pts[di].x - pts[di - 1].x, ddy = pts[di].y - pts[di - 1].y;
        totalDist += Math.sqrt(ddx * ddx + ddy * ddy);
      }
      var avgStep = totalDist / (pts.length - 1);
      if (avgStep > 0) dirSpan = Math.max(1, Math.min(8, Math.round(3 / avgStep)));
    }

    if (inkStyleName === 'quill') {
      for (var j = 0; j < pts.length; j++) {
        var dx, dy;
        var ja = Math.min(j + dirSpan, pts.length - 1);
        var jb = Math.max(j - dirSpan, 0);
        if (ja === jb) { dx = 1; dy = 0; }
        else { dx = pts[ja].x - pts[jb].x; dy = pts[ja].y - pts[jb].y; }
        var angleQ = Math.atan2(dy, dx);
        var dirFactorQ = 0.2 + 0.8 * Math.abs(Math.sin(angleQ));
        widths[j] *= dirFactorQ;
      }
    } else if (inkStyleName === 'pen') {
      for (var k = 0; k < pts.length; k++) {
        var dxp, dyp;
        var ka = Math.min(k + dirSpan, pts.length - 1);
        var kb = Math.max(k - dirSpan, 0);
        if (ka === kb) { dxp = 1; dyp = 0; }
        else { dxp = pts[ka].x - pts[kb].x; dyp = pts[ka].y - pts[kb].y; }
        var angleP = Math.atan2(dyp, dxp);
        var dirFactorP = 0.5 + 0.5 * Math.abs(Math.sin(angleP));
        widths[k] *= dirFactorP;
      }
    } else if (inkStyleName === 'ballpoint') {
      for (var m = 0; m < pts.length; m++) {
        widths[m] = bs * (0.3 + 0.5 * pts[m].pressure);
        if (widths[m] < 0.5) widths[m] = 0.5;
      }
    }

    for (var pass = 0; pass < 2; pass++) {
      if (widths.length >= 3) {
        var sw = [widths[0]];
        for (var n = 1; n < widths.length - 1; n++) {
          sw.push((widths[n - 1] + widths[n] + widths[n + 1]) / 3);
        }
        sw.push(widths[widths.length - 1]);
        widths = sw;
      }
    }
    return widths;
  }

  function buildOutline(pts, widths) {
    var left = [];
    var right = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var r = widths[i] * 0.5;
      var dx, dy;
      if (i === 0) { dx = pts[1].x - p.x; dy = pts[1].y - p.y; }
      else if (i === pts.length - 1) { dx = p.x - pts[i - 1].x; dy = p.y - pts[i - 1].y; }
      else { dx = pts[i + 1].x - pts[i - 1].x; dy = pts[i + 1].y - pts[i - 1].y; }
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) len = 1;
      var nx = -dy / len, ny = dx / len;
      left.push({ x: p.x + nx * r, y: p.y + ny * r });
      right.push({ x: p.x - nx * r, y: p.y - ny * r });
    }
    return { left: left, right: right };
  }

  function traceOutline(c, left, right) {
    c.moveTo(left[0].x, left[0].y);
    for (var i = 1; i < left.length; i++) {
      if (i < left.length - 1) {
        var mx = (left[i].x + left[i + 1].x) / 2;
        var my = (left[i].y + left[i + 1].y) / 2;
        c.quadraticCurveTo(left[i].x, left[i].y, mx, my);
      } else {
        c.lineTo(left[i].x, left[i].y);
      }
    }
    c.lineTo(right[right.length - 1].x, right[right.length - 1].y);
    for (var j = right.length - 2; j >= 0; j--) {
      if (j > 0) {
        var rmx = (right[j].x + right[j - 1].x) / 2;
        var rmy = (right[j].y + right[j - 1].y) / 2;
        c.quadraticCurveTo(right[j].x, right[j].y, rmx, rmy);
      } else {
        c.lineTo(right[j].x, right[j].y);
      }
    }
  }

  function roundCaps(c, pts, widths) {
    var firstPt = pts[0];
    var firstR = Math.max(0, widths[0] * 0.5);
    c.beginPath();
    c.arc(firstPt.x, firstPt.y, firstR, 0, Math.PI * 2);
    c.fill();
    var lastPt = pts[pts.length - 1];
    var lastR = Math.max(0, widths[widths.length - 1] * 0.5);
    c.beginPath();
    c.arc(lastPt.x, lastPt.y, lastR, 0, Math.PI * 2);
    c.fill();
  }

  function drawBallpointFilled(c, pts, widths, color) {
    var outline = buildOutline(pts, widths);
    c.fillStyle = color;
    c.beginPath();
    traceOutline(c, outline.left, outline.right);
    c.closePath();
    c.fill();
    roundCaps(c, pts, widths);
  }

  function drawFilledStroke(ctx, stroke, opts) {
    opts = opts || {};
    var slAlpha = opts.streamlineAlpha;
    var style = INK_STYLES[stroke.inkStyle] || INK_STYLES.quill;
    var pts = (slAlpha && slAlpha < 1) ? streamlineFilter(stroke.points, slAlpha) : stroke.points;
    var bs = stroke.baseSize;
    var widths = computeStrokeWidths(pts, bs, stroke.inkStyle);

    if (stroke.inkStyle === 'ballpoint') {
      drawBallpointFilled(ctx, pts, widths, stroke.color);
      return;
    }

    var outline = buildOutline(pts, widths);
    ctx.beginPath();
    ctx.fillStyle = stroke.color;
    traceOutline(ctx, outline.left, outline.right);
    ctx.closePath();
    ctx.fill();
    roundCaps(ctx, pts, widths);
  }

  function drawStroke(ctx, stroke, opts) {
    if (!stroke.points || stroke.points.length === 0) return;
    opts = opts || {};
    var smoothing = opts.smoothing || 0;
    var style = INK_STYLES[stroke.inkStyle] || INK_STYLES.quill;

    ctx.save();
    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      if (style.alpha < 1) ctx.globalAlpha = style.alpha;
    }

    var pts = stroke.points;

    if (pts.length === 1) {
      var r = stroke.tool === 'eraser' ? stroke.baseSize * 0.5 : stroke.baseSize * pts[0].pressure * 0.5;
      if (r < 0.5) r = 0.5;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
      ctx.fillStyle = stroke.tool === 'eraser' ? '#000' : stroke.color;
      ctx.fill();
      ctx.restore();
      return;
    }

    if (stroke.tool === 'eraser' || !style.pressure) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.baseSize;
      if (stroke.tool !== 'eraser') ctx.strokeStyle = stroke.color;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (smoothing > 0 && stroke.tool !== 'eraser') {
        catmullRomPath(ctx, pts, smoothing);
      } else {
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    drawFilledStroke(ctx, stroke, opts);
    ctx.restore();
  }

  // ---- Text rendering ----

  var TEXT_LINE_HEIGHT = 1.4;

  function drawTextStroke(ctx, textStroke, opts) {
    if (!textStroke.text) return;
    opts = opts || {};
    var ox = opts.offsetX || 0;
    var oy = opts.offsetY || 0;
    var ff = textStroke.fontFamily || 'sans-serif';
    var lines = textStroke.text.split('\n');
    var lh = textStroke.fontSize * TEXT_LINE_HEIGHT;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = textStroke.color;
    ctx.font = textStroke.fontSize + 'px ' + ff;
    ctx.textBaseline = 'top';
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textStroke.x + ox, textStroke.y + oy + i * lh);
    }
    ctx.restore();
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
    TOOL_UNMAP: TOOL_UNMAP,
    STYLE_UNMAP: STYLE_UNMAP,
    FONT_UNMAP: FONT_UNMAP,
    INK_STYLES: INK_STYLES,
    TEXT_LINE_HEIGHT: TEXT_LINE_HEIGHT,
    currentVNum: currentVNum,
    // Codec helpers
    bytesToUuid: bytesToUuid,
    rgbToColor: rgbToColor,
    u16ToPressure: u16ToPressure,
    decodeJsonBytes: decodeJsonBytes,
    normalizeWidgetState: normalizeWidgetState,
    normalizeWidgetLog: normalizeWidgetLog,
    // Codec
    decodeStroke: decodeStroke,
    decodeCanvas: decodeCanvas,
    // Geometry
    streamlineFilter: streamlineFilter,
    catmullRomPath: catmullRomPath,
    // Rendering
    computeStrokeWidths: computeStrokeWidths,
    buildOutline: buildOutline,
    traceOutline: traceOutline,
    roundCaps: roundCaps,
    drawBallpointFilled: drawBallpointFilled,
    drawFilledStroke: drawFilledStroke,
    drawStroke: drawStroke,
    drawTextStroke: drawTextStroke,
    WIDGET_TYPE_MAX_BYTES: WIDGET_TYPE_MAX_BYTES,
    WIDGET_STATE_MAX_BYTES: WIDGET_STATE_MAX_BYTES,
    WIDGET_LOG_MAX_BYTES: WIDGET_LOG_MAX_BYTES,
  };

  if (typeof window !== 'undefined') window.DrawingEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
