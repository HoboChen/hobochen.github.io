/**
 * features/pdf/core/page-map-format.js — canonical owner of the
 * `pdfa.pageMap` WBRD extension: the per-stroke "which PDF page is this ink
 * on" map that the annotator carries inside a `.wb` container.
 *
 * Wire layout: count(u32 LE) + { strokeUuid(16) + pageNum(u16 LE) } × count.
 *
 * One implementation for every runtime. It is written as a classic script with
 * no import/export syntax so the exact same bytes are produced by:
 *   - Node (`require`): the PDF server adapter, the whiteboard inspector CLI
 *     and the golden-fixture tests, through
 *     features/pdf/core/annotation-format.js, which re-exports it;
 *   - the browser: `/static/core/pdf-page-map-format.js`, a classic script
 *     loaded ahead of the `/static/pdf-annotator.js` ES module graph, which
 *     reads it off `window.PdfPageMapFormat`
 *     (src/features/pdf/client/annotation-store.js).
 *
 * Payloads may arrive as a Node Buffer (server) or a Uint8Array (browser
 * extension-area payload), so decode reads through a DataView over the view's
 * own byteOffset/byteLength rather than assuming either API. Encode returns a
 * Uint8Array; annotation-format.js wraps it in a zero-copy Buffer view for its
 * Node callers.
 *
 * UUID <-> bytes conversion is reused from ink's public core entry point (the
 * same codec the stroke/canvas wire format uses) rather than re-implemented,
 * per the cross-feature import rule enforced by scripts/check-boundaries.js.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  var ink = root.InkStrokeFormat || root.DrawingEngine ||
            (typeof require === 'function' && require('../../ink/core'));
  if (!ink) {
    throw new Error('page-map-format.js requires features/ink/core (stroke-format.js) to be loaded first');
  }
  var uuidToBytes = ink.uuidToBytes;
  var bytesToUuid = ink.bytesToUuid;

  var ENTRY_BYTES = 18; // uuid(16) + pageNum(u16)

  function encodePageMap(pageMap) {
    var count = pageMap.size;
    var buf = new ArrayBuffer(4 + count * ENTRY_BYTES);
    var view = new DataView(buf);
    var u8 = new Uint8Array(buf);
    view.setUint32(0, count, true);
    var off = 4;
    pageMap.forEach(function (pageNum, uuid) {
      u8.set(uuidToBytes(uuid), off); off += 16;
      view.setUint16(off, pageNum, true); off += 2;
    });
    return u8;
  }

  function decodePageMap(payload) {
    var result = new Map();
    if (!payload || payload.length < 4) return result;
    var view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    var count = view.getUint32(0, true);
    var off = 4;
    for (var i = 0; i < count; i++) {
      if (off + ENTRY_BYTES > payload.length) break;
      var uuid = bytesToUuid(payload, off); off += 16;
      var pageNum = view.getUint16(off, true); off += 2;
      result.set(uuid, pageNum);
    }
    return result;
  }

  var api = {
    PAGE_MAP_ENTRY_BYTES: ENTRY_BYTES,
    encodePageMap: encodePageMap,
    decodePageMap: decodePageMap,
  };

  if (typeof window !== 'undefined') window.PdfPageMapFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
