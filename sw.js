// Build: 733754f1
var CDN_PROXY = false;

/**
 * Generic service-worker lifecycle, cache strategies, and module dispatch.
 * The shell assembler appends manifest-selected policy and canonical worker
 * contributions. This bootstrap also works without any feature contribution.
 */
const CACHE_VERSION = 'kb-v9';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';
const DYNAMIC_CACHE_MAX_ENTRIES = 200;
const serviceWorkerModules = [];

function moduleFailure(module, phase, error) {
  module.active = false;
  console.error('[sw] Module ' + module.id + ' failed during ' + phase + ':', error);
  for (const dependent of serviceWorkerModules) {
    if (dependent.active && (dependent.requires || []).includes(module.id)) {
      moduleFailure(dependent, 'dependency', new Error('Required worker module ' + module.id + ' is unavailable'));
    }
  }
}

// Registration is synchronous and transactional: a broken script cannot leave
// behind half a module's handlers or policy. Sources receive only this small
// cache/registration API; the bootstrap never names or imports a feature.
function registerServiceWorkerModule(metadata, initialize) {
  const module = { ...metadata, handlers: [], active: true };
  let registering = true;
  try {
    const unavailable = (module.requires || []).find(id => !serviceWorkerModules.some(
      dependency => dependency.id === id && dependency.active
    ));
    if (unavailable) throw new Error('Service-worker dependency ' + unavailable + ' is unavailable');
    const result = initialize(Object.freeze({
      STATIC_CACHE,
      DYNAMIC_CACHE,
      stripVary,
      cacheName: (suffix) => CACHE_VERSION + '-' + suffix,
      register(contribution) {
        if (!registering) throw new Error('Service-worker registration must be synchronous');
        if (!contribution || typeof contribution !== 'object' || Array.isArray(contribution)
            || ['fetch', 'message'].some(key => contribution[key] !== undefined
              && typeof contribution[key] !== 'function')
            || (contribution.cacheNames !== undefined
              && (!Array.isArray(contribution.cacheNames)
                || contribution.cacheNames.some(name => typeof name !== 'string' || !name)))) {
          throw new Error('Invalid service-worker contribution');
        }
        module.handlers.push(contribution);
      },
    }));
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(error => moduleFailure(module, 'registration', error));
      throw new Error('Service-worker initialization must be synchronous');
    }
    serviceWorkerModules.push(module);
  } catch (error) {
    moduleFailure(module, 'registration', error);
  } finally {
    registering = false;
  }
}

self.addEventListener('install', (event) => {
  const required = new Set(['/']);
  const optional = new Map();
  for (const module of serviceWorkerModules) {
    if (!module.active) continue;
    for (const url of module.precache || []) {
      if (!optional.has(url)) optional.set(url, module.id);
    }
  }
  for (const url of required) optional.delete(url);
  console.log('[sw] Installing, pre-caching ' + (required.size + optional.size) + ' files');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      try {
        await cache.addAll([...required]);
      } catch (error) {
        console.error('[sw] Core precache failed:', error);
        throw error;
      }
      await Promise.all([...optional].map(async ([url, id]) => {
        try {
          await cache.addAll([url]);
        } catch (error) {
          console.warn('[sw] Optional precache failed for module ' + id + ': ' + url, error);
        }
      }));
    }).then(() => {
      // Keep the waiting phase: an open page may still use an older loader
      // and must not be mixed with a newly composed asset graph.
      console.log('[sw] Install complete; waiting for safe activation');
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const keep = new Set([STATIC_CACHE, DYNAMIC_CACHE]);
      for (const module of serviceWorkerModules) {
        if (!module.active) continue;
        for (const handler of module.handlers) {
          // Owned data caches can retain a schema generation independently
          // of the shell's asset/HTML generation.
          for (const name of handler.cacheNames || []) keep.add(name);
        }
      }
      const old = keys.filter((key) => !keep.has(key));
      if (old.length > 0) console.log('[sw] Cleaning ' + old.length + ' old cache(s)');
      return Promise.all(old.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

function matchesModulePolicy(key, predicate) {
  return serviceWorkerModules.some(module => module.active
    && (module[key] || []).some(predicate));
}

function isNetworkFirstOrigin(url) {
  return matchesModulePolicy('networkFirstOrigins', origin => url.origin === origin)
    || matchesModulePolicy('networkFirstHostSuffixes', suffix => (
      url.hostname === suffix || url.hostname.endsWith('.' + suffix)
    ));
}

function dispatchModuleFetch(event, url) {
  for (const module of serviceWorkerModules) {
    if (!module.active) continue;
    for (const handler of module.handlers) {
      if (!handler.fetch) continue;
      try {
        const response = handler.fetch(event.request, url, event);
        if (response === undefined || response === null) continue;
        event.respondWith(Promise.resolve(response).catch(error => {
          moduleFailure(module, 'fetch', error);
          return new Response('Feature unavailable', { status: 503, statusText: 'Service Unavailable' });
        }));
        return true;
      } catch (error) {
        moduleFailure(module, 'fetch', error);
        break;
      }
    }
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Health must reach the server: an old cached success cannot prove that it
  // is still running. Bypass Cache API reads as well as writes, including
  // health responses retained by earlier versions of this worker.
  if (url.origin === self.location.origin && url.pathname === '/api/health') return;
  if (url.pathname === '/api/events') return;
  if (event.request.headers.get('accept') === 'text/event-stream') return;
  if (matchesModulePolicy('bypassPrefixes', prefix => url.pathname.startsWith(prefix))) return;

  // Version-pinned vendor paths are immutable. Revalidating every worker or
  // viewer load would create duplicate network requests for identical bytes.
  if (url.pathname.startsWith('/static/vendor/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  if (matchesModulePolicy('networkFirstPaths', pathname => url.pathname === pathname)) {
    event.respondWith(networkFirst(event.request, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith('/static/')) {
    const { response, backgroundFetch } = staleWhileRevalidate(event.request, STATIC_CACHE);
    event.respondWith(response);
    event.waitUntil(backgroundFetch);
    return;
  }
  if (url.origin !== self.location.origin && isNetworkFirstOrigin(url)) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  if (typeof CDN_PROXY !== 'undefined' && CDN_PROXY && url.pathname.startsWith('/cdn-proxy/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }
  if (dispatchModuleFetch(event, url)) return;

  // Cache API cannot store partial responses. Unclaimed ranges belong to the
  // browser's HTTP cache, including when their owning feature is disabled.
  if (event.request.headers.has('range')) return;
  if (url.pathname.startsWith('/attachments/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
});

// fetch() transparently decompresses responses. Retaining Vary: Accept-Encoding
// can make the uncompressed cache entry miss for a subsequent request.
function stripVary(response) {
  var headers = new Headers(response.headers);
  headers.delete('Vary');
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, stripVary(response));
    }
    return response;
  } catch {
    console.warn('[sw] Fetch failed (offline):', request.url);
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

function staleWhileRevalidate(request, cacheName) {
  const backgroundFetch = (async () => {
    try {
      const cache = await caches.open(cacheName);
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, stripVary(response));
      }
      return response;
    } catch {
      return null; // Network errors must not reject a cached response.
    }
  })();
  const response = (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const fetched = await backgroundFetch;
    if (fetched) return fetched;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  })();
  return { response, backgroundFetch };
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && request.cache !== 'no-store') {
      const cache = await caches.open(cacheName);
      cache.put(request, stripVary(response));
      trimCache(cacheName, DYNAMIC_CACHE_MAX_ENTRIES);
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      try {
        const previewUrl = new URL(request.url);
        if (previewUrl.searchParams.has('rprint-preview')) {
          previewUrl.searchParams.delete('rprint-preview');
          const canonical = await caches.match(previewUrl.href, { ignoreVary: true });
          if (canonical) return canonical;
          return new Response('Preview unavailable offline', { status: 503, statusText: 'Service Unavailable' });
        }
      } catch { /* malformed request URL falls through to the root fallback */ }
      const fallback = await caches.match('/');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'clearCaches') {
    caches.delete(STATIC_CACHE);
    return;
  }
  for (const module of serviceWorkerModules) {
    if (!module.active) continue;
    for (const handler of module.handlers) {
      if (!handler.message) continue;
      try {
        const result = handler.message(event.data);
        if (result === undefined || result === null) continue;
        if (result && typeof result.then === 'function') {
          event.waitUntil(result.catch(error => moduleFailure(module, 'message', error)));
        }
        return;
      } catch (error) {
        moduleFailure(module, 'message', error);
        break;
      }
    }
  }
});

function trimCache(cacheName, maxEntries) {
  caches.open(cacheName).then(function(cache) {
    if (!cache || typeof cache.keys !== 'function') return;
    cache.keys().then(function(keys) {
      var toDelete = keys.length - maxEntries;
      if (toDelete <= 0) return;
      var chain = Promise.resolve();
      for (var i = 0; i < toDelete; i++) {
        (function(key) {
          chain = chain.then(function() { return cache.delete(key); });
        })(keys[i]);
      }
    });
  });
}

registerServiceWorkerModule({"id":"cdn","requires":[],"precache":[],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"comments","requires":[],"precache":["/static/comments.css","/static/text-anchor.js","/static/comments.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"computation.jupyter","requires":[],"precache":[],"networkFirstPaths":["/static/notebook-spa-jupyter-embed.js"],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":["/jupyter/"]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"computation.notebook","requires":[],"precache":["/static/notebook.css","/static/notebook.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"computation.terminal","requires":[],"precache":[],"networkFirstPaths":["/static/terminal.css","/static/terminal.js"],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"ink","requires":[],"precache":["/static/core/ink-stroke-format.js","/static/drawing-engine-render.js"],"networkFirstPaths":["/static/ink-toolbar.js","/static/ink-toolbar.css"],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"reading","requires":[],"precache":["/static/sidebar-panel.css","/static/link-preview.css","/static/core/code-blocks.js","/static/scrollbar-visibility.js","/static/sidebar-panel.js","/static/core/theme-colors.js","/static/svg-theme.js","/static/render-on-demand.js","/static/reading-navigation-state.js","/static/link-preview.js"],"networkFirstPaths":["/static/scrollbar-visibility.js"],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"ocr","requires":["reading"],"precache":[],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"pdf","requires":["ink"],"precache":["/static/core/ink-stroke-format.js","/static/core/pdf-page-map-format.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":["/api/pdf-source"]}, function(serviceWorker) {
/**
 * PDF range, companion, and offline-book caching.
 * The shell assembler loads this source verbatim with a module-scoped
 * serviceWorker registration API; it is not a page script.
 */
const { STATIC_CACHE, DYNAMIC_CACHE, stripVary } = serviceWorker;
// These bytes and companion manifests have not changed format. Shell upgrades
// must not discard already-downloaded books or their cache metadata.
const RANGE_CACHE = 'kb-v7-pdf-ranges';
const PDF_RANGE_BLOCK_SIZE = 65536;             // 64 KiB, matches pdf.js default rangeChunkSize
const PDF_INITIAL_FULL_MAX_CHUNK_SIZE = 1024 * 1024; // largest configured client chunk (iOS)
const PDF_CACHE_MAX_BYTES = 200 * 1024 * 1024;  // 200 MiB cap per PDF (per-origin quota guardrail)
const PDF_FULL_GET_NETWORK_TIMEOUT_MS = 2500;   // iOS/PWA offline probes can hang instead of rejecting
const PDF_COMPANION_META_VERSION = 7;
const PDF_COMPANION_MANIFEST_VERSION = 1;
const PDF_PENDING_VERSION_CHECKS = new Map();
const PDF_UNTRUSTED_RANGE_CACHE = new Set();

// Diagnostic flag — when true, handlePdfRange logs hit/miss decisions to the
// SW console.  Toggle from a page console with:
//   navigator.serviceWorker.controller.postMessage({type:'pdf-debug', on:true})
// Logs appear in DevTools → Application → Service Workers → click the worker.
let SW_DEBUG_PDF = false;

serviceWorker.register({
  cacheNames: [RANGE_CACHE],
  fetch(request, url, event) {
    // The shell dispatches here only for same-origin, non-API content.
    // Prepared revisions bypass the worker through the PDF module policy.
    // Keep them outside the original-book cache if dispatch ordering changes.
    if (url.pathname === '/api/pdf-source') return;
    if (!url.pathname.endsWith('.pdf')) return;
    // Full GET probes must work on an offline cold start before pdf.js issues
    // ranges, without cloning/caching a potentially huge online response.
    if (request.headers.has('range')) return handlePdfRange(request);
    const response = handlePdfFullGet(request);
    // Return full-GET headers promptly so pdf.js can cancel its probe body,
    // while keeping version checks alive after that body is canceled.
    if (event) event.waitUntil(response.then(() => pdfWaitForVersionCheck(pdfBaseUrl(request.url))));
    return response;
  },
  message(data) {
    if (!data || typeof data !== 'object' || !data.type) return;
    if (data.type === 'pdf-prefetch' && data.url) return pdfPrefetch(data.url);
    if (data.type === 'pdf-cache-status' && data.url) return pdfCacheStatus(data.url);
    if (data.type === 'library-book-cache-status' && data.url) return libraryBookCacheStatus(data);
    if (data.type === 'library-book-prefetch' && data.url) return libraryBookPrefetch(data);
    if (data.type === 'pdf-cache-purge' && data.url) return pdfCachePurgeKeepMeta(data.url);
    if (data.type === 'pdf-cache-reset' && data.url) return pdfCachePurge(data.url);
    if (data.type === 'pdf-debug') {
      SW_DEBUG_PDF = !!data.on;
      console.log('[sw] PDF debug logging:', SW_DEBUG_PDF ? 'ON' : 'OFF');
      return true;
    }
  },
});

// ─── PDF range cache ───────────────────────────────────────
// Stores 64 KiB-aligned chunks of PDFs under cache keys like
//   <baseUrl>?_swrange=<blockIdx>
// plus a single metadata entry at
//   <baseUrl>?_swmeta=1
// containing { etag, lastModified, totalSize, cachedBytes, lastAccess }.
//
// On any range request for a *.pdf URL:
//   1. If we don't yet know totalSize/etag, fetch and validate the requested
//      interval, then learn them from Content-Range + ETag/Last-Modified.
//   2. Otherwise, look up each needed block in the cache, coalesce contiguous
//      misses into upstream Range fetches, store newly-fetched aligned blocks
//      (subject to PDF_CACHE_MAX_BYTES per PDF), then assemble + return a
//      synthesized 206 Partial Content response.
//   3. If a coalesced response carries a different ETag/Last-Modified or total
//      size than our stored meta, purge the URL's entries and reject this
//      request. Subsequent requests rebuild the cache from the fresh source.

function pdfRangeBlockKey(baseUrl, blockIdx) {
  return baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + '_swrange=' + blockIdx;
}

function pdfMetaKey(baseUrl) {
  return baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + '_swmeta=1';
}

function pdfBaseUrl(requestUrl) {
  // Strip query + fragment so cache keys are stable across reload variants.
  return requestUrl.split('#')[0].split('?')[0];
}

function parseRangeHeader(value) {
  if (!value) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : null;
  if (!Number.isSafeInteger(start) || start < 0) return null;
  if (end != null && (!Number.isSafeInteger(end) || end < start)) return null;
  return { start, end };
}

function parseContentRange(value) {
  if (!value) return null;
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(value);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = Number(m[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) return null;
  return { start, end, total };
}

function pdfFetchRange(input, start, end) {
  const headers = new Headers(typeof input === 'string' ? undefined : input.headers);
  // The range cache handles source validators itself. Browser HTTP-cache
  // validators can turn a small Range into a 200 containing the entire PDF.
  for (const name of ['If-Range', 'If-None-Match', 'If-Modified-Since']) headers.delete(name);
  headers.set('Range', 'bytes=' + start + '-' + (end == null ? '' : end));
  return fetch(input, { headers, cache: 'no-store' });
}

async function pdfCancelResponse(response) {
  try {
    if (response.body && typeof response.body.cancel === 'function') await response.body.cancel();
  } catch { /* best effort: do not consume an invalid upstream body */ }
}

function pdfRangeFailure() {
  return new Response('Invalid PDF range response', { status: 502, statusText: 'Bad Gateway' });
}

async function pdfReadSmallFullBody(response, maximum) {
  const contentLength = response.headers.get('content-length');
  const length = contentLength == null ? null : /^\d+$/.test(contentLength) ? Number(contentLength) : NaN;
  const encoding = response.headers.get('content-encoding');
  if ((length != null && (!Number.isSafeInteger(length) || length <= 0 || length > maximum))
      || (encoding != null && encoding.trim().toLowerCase() !== 'identity')
      || !response.body || typeof response.body.getReader !== 'function') {
    await pdfCancelResponse(response);
    throw new Error('invalid-pdf-initial-full-response');
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(length == null ? maximum : length);
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.byteLength - written) throw new Error('invalid-pdf-initial-full-length');
      bytes.set(value, written);
      written += value.byteLength;
    }
    if (written === 0 || (length != null && written !== length)) throw new Error('invalid-pdf-initial-full-length');
    return bytes.slice(0, written).buffer;
  } catch (err) {
    try { await reader.cancel(); } catch { /* best effort */ }
    throw err;
  } finally {
    reader.releaseLock();
  }
}

async function pdfReadRangeBody(response, range, totalSize) {
  const cr = parseContentRange(response.headers.get('content-range'));
  const contentLength = response.headers.get('content-length');
  const contentEncoding = response.headers.get('content-encoding');
  const expectedEnd = cr && Math.min(range.end == null ? cr.total - 1 : range.end, cr.total - 1);
  if (!cr || cr.start !== range.start || cr.end !== expectedEnd
      || (totalSize != null && cr.total !== totalSize)
      // Fetch decodes compressed bodies; their wire byte offsets and lengths
      // cannot identify PDF bytes or be reused with the original headers.
      || (contentEncoding != null && contentEncoding.trim().toLowerCase() !== 'identity')
      || (contentLength != null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== cr.end - cr.start + 1))) {
    await pdfCancelResponse(response);
    throw new Error('invalid-pdf-content-range');
  }
  const expectedLength = cr.end - cr.start + 1;
  let buf;
  if (response.body && typeof response.body.getReader === 'function') {
    // Never buffer an unexpected full PDF, even if its headers claim 206.
    const reader = response.body.getReader();
    const bytes = new Uint8Array(expectedLength);
    let written = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength > expectedLength - written) throw new Error('invalid-pdf-range-length');
        bytes.set(value, written);
        written += value.byteLength;
      }
      if (written !== expectedLength) throw new Error('invalid-pdf-range-length');
      buf = bytes.buffer;
    } catch (err) {
      try { await reader.cancel(); } catch { /* best effort */ }
      throw err;
    } finally {
      reader.releaseLock();
    }
  } else {
    buf = await response.arrayBuffer();
    if (buf.byteLength !== expectedLength) throw new Error('invalid-pdf-range-length');
  }
  return { cr, buf };
}

async function pdfReadMeta(cache, baseUrl) {
  const resp = await cache.match(pdfMetaKey(baseUrl));
  if (!resp) return null;
  try { return await resp.json(); } catch { return null; }
}

async function pdfWriteMeta(cache, baseUrl, meta) {
  const metaKey = pdfMetaKey(baseUrl);
  const resp = new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } });
  await cache.put(metaKey, stripVary(resp));
}

async function pdfWaitForVersionCheck(baseUrl) {
  let pending;
  while ((pending = PDF_PENDING_VERSION_CHECKS.get(baseUrl))) await pending;
}

function pdfQueueFullVersionCheck(baseUrl, response) {
  const previous = PDF_PENDING_VERSION_CHECKS.get(baseUrl);
  const pending = Promise.resolve(previous).then(async () => {
    try {
      const cache = await caches.open(RANGE_CACHE);
      const meta = await pdfReadMeta(cache, baseUrl);
      const etag = response.headers.get('etag') || '';
      const lastModified = response.headers.get('last-modified') || '';
      const headerLength = response.headers.get('content-length');
      const length = headerLength != null && /^\d+$/.test(headerLength) ? Number(headerLength) : null;
      const encoding = response.headers.get('content-encoding');
      const hasPdfLength = Number.isSafeInteger(length) && length > 0
        && (encoding == null || encoding.trim().toLowerCase() === 'identity');
      if (PDF_UNTRUSTED_RANGE_CACHE.has(baseUrl) || (meta && (
        meta.etag !== etag || meta.lastModified !== lastModified
        || (hasPdfLength && meta.totalSize !== length)
      ))) {
        await pdfCachePurge(baseUrl);
      }
      PDF_UNTRUSTED_RANGE_CACHE.delete(baseUrl);
    } catch (err) {
      // A failed invalidation must not let later ranges mix cached old bytes
      // with the new full response. Validated network ranges remain usable.
      PDF_UNTRUSTED_RANGE_CACHE.add(baseUrl);
      console.warn('[sw] PDF full-GET version check failed:', err);
    }
  }).finally(() => {
    if (PDF_PENDING_VERSION_CHECKS.get(baseUrl) === pending) PDF_PENDING_VERSION_CHECKS.delete(baseUrl);
  });
  PDF_PENDING_VERSION_CHECKS.set(baseUrl, pending);
  return pending;
}

async function pdfCachePurge(baseUrl) {
  const cache = await caches.open(RANGE_CACHE);
  const keys = await cache.keys();
  const prefix = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + '_sw';
  const ops = [];
  for (const req of keys) {
    if (req.url.indexOf(prefix) === 0) ops.push(cache.delete(req));
  }
  await Promise.all(ops);
}

// Like pdfCachePurge but preserves the meta entry (totalSize stays known).
// Used for user-initiated "Remove from offline" so the menu can still show
// the file size after removal.
async function pdfCachePurgeKeepMeta(baseUrl) {
  const cache = await caches.open(RANGE_CACHE);
  const meta = await pdfReadMeta(cache, baseUrl);
  const keys = await cache.keys();
  const prefix = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + '_sw';
  const ops = [];
  for (const req of keys) {
    if (req.url.indexOf(prefix) === 0) ops.push(cache.delete(req));
  }
  await Promise.all(ops);
  // Re-write meta with cached bytes zeroed and verification cleared
  if (meta) {
    meta.cachedBytes = 0;
    delete meta.verifiedSha256;
    await pdfWriteMeta(cache, baseUrl, meta);
  }
}

async function pdfCacheStatus(baseUrl) {
  const cache = await caches.open(RANGE_CACHE);
  const meta = await pdfReadMeta(cache, baseUrl);
  // Reconcile against actual cache before reporting — see comment on
  // pdfRecomputeCachedBytes.  Without this, the More menu's initial label
  // can read e.g. "8.4 / 8.6 MiB" forever even though every block is
  // already cached.
  if (meta) await pdfRecomputeCachedBytes(cache, baseUrl, meta);
  return broadcastToClients({
    type: 'pdf-cache-status-result',
    url: baseUrl,
    cached: meta ? meta.cachedBytes : 0,
    total: meta ? meta.totalSize : null,
    capped: meta ? meta.cachedBytes >= PDF_CACHE_MAX_BYTES : false,
    // Persisted SHA-256 from the last successful verify, if any.  Lets
    // the More menu show "Available offline ✓ (verified)" without
    // re-running the verify on every panel open.
    verifiedSha256: meta ? (meta.verifiedSha256 || null) : null,
  });
}

function pdfCompanionMetaUrl(baseUrl) {
  try {
    const url = new URL(baseUrl, self.location.origin);
    const slash = url.pathname.lastIndexOf('/');
    const fileSegment = url.pathname.slice(slash + 1);
    const pdfExt = fileSegment.toLowerCase().lastIndexOf('.pdf');
    if (pdfExt < 0) return null;
    const stemSegment = fileSegment.slice(0, pdfExt);
    url.pathname = url.pathname.slice(0, slash + 1) + stemSegment + '/meta.json';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function pdfBookMetaKey(baseUrl) {
  return pdfCompanionMetaUrl(baseUrl)
    || (baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + '_swbookmeta=1');
}

async function pdfReadBookMeta(cache, baseUrl) {
  const resp = await cache.match(pdfBookMetaKey(baseUrl));
  if (!resp) return null;
  try { return await resp.json(); } catch { return null; }
}

async function pdfWriteBookMeta(cache, baseUrl, meta) {
  const key = pdfBookMetaKey(baseUrl);
  const resp = new Response(JSON.stringify(meta), {
    headers: { 'Content-Type': 'application/json' },
  });
  await cache.put(key, stripVary(resp));
}

function encodeApiPathParam(path) {
  return encodeURIComponent(String(path || '').replace(/^\/+/, ''));
}

function normalizeBookUrl(url) {
  try { return new URL(url, self.location.origin).href; }
  catch { return null; }
}

async function cacheOfflineResource(url, cacheName, opts) {
  opts = opts || {};
  const absUrl = normalizeBookUrl(url);
  if (!absUrl) {
    if (opts.optional) return { ok: false, error: 'bad-url', url };
    throw new Error('bad-url');
  }
  let response;
  try { response = await fetch(absUrl); }
  catch (err) {
    if (opts.optional) return { ok: false, error: 'fetch-failed', url: absUrl };
    throw new Error('fetch-failed');
  }
  if (!response || !response.ok) {
    const status = response ? response.status : 0;
    if (opts.optional) return { ok: false, status, url: absUrl };
    throw new Error('http-' + status);
  }
  let json = null;
  let text = null;
  if (opts.json) {
    try { json = await response.clone().json(); } catch { json = null; }
  }
  if (opts.text) {
    try { text = await response.clone().text(); } catch { text = null; }
  }
  const cache = await caches.open(cacheName);
  await cache.put(absUrl, stripVary(response.clone()));
  return { ok: true, status: response.status, url: absUrl, json, text };
}

async function cacheOfflineResources(urls, cacheName, progress) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  for (let i = 0; i < list.length; i++) {
    if (progress) progress(i + 1, list.length, list[i]);
    await cacheOfflineResource(list[i], cacheName, { optional: false });
  }
}

function extractOcrAssetUrls(html) {
  const out = [];
  const seen = Object.create(null);
  const text = String(html || '');
  const re = /\/api\/ocr-asset\?[^"'\s<>)]+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const url = match[0].replace(/&amp;/g, '&');
    if (seen[url]) continue;
    seen[url] = true;
    out.push(url);
  }
  return out;
}

function ocrAssetUrlsFromDocJson(json) {
  const out = [];
  const seen = Object.create(null);
  const add = (url) => {
    if (typeof url !== 'string' || !url) return;
    const normalized = url.replace(/&amp;/g, '&');
    if (seen[normalized]) return;
    seen[normalized] = true;
    out.push(normalized);
  };
  if (json && Array.isArray(json.assets)) {
    for (const url of json.assets) add(url);
    return out;
  }
  return extractOcrAssetUrls(json && json.html);
}

function langQuery(lang) {
  return lang ? '&lang=' + encodeURIComponent(lang) : '';
}

async function cacheOcrBundle(pdfPath, baseUrl, progress, opts) {
  opts = opts || {};
  const cacheAssets = !!opts.cacheAssets;
  const encodedPath = encodeApiPathParam(pdfPath);
  const langs = [];
  let assetCount = 0;
  let cachedAssetCount = 0;
  let docCount = 0;
  let hasOriginal = false;
  const report = (done, total, lang, step) => {
    if (progress) progress(done, total, lang || 'original', step || 'doc');
  };
  report(0, 0, 'metadata', 'translations');
  const translations = await cacheOfflineResource('/api/ocr-translations?path=' + encodedPath, DYNAMIC_CACHE, { optional: true, json: true });
  if (translations.ok && translations.json && Array.isArray(translations.json.langs)) {
    for (const lang of translations.json.langs) {
      if (typeof lang === 'string' && lang && langs.indexOf(lang) === -1) langs.push(lang);
    }
  }
  report(0, 0, 'outline', 'titles');
  await cacheOfflineResource('/api/ocr-titles?path=' + encodedPath, DYNAMIC_CACHE, { optional: true, json: true });

  const contentLangs = [null].concat(langs);
  for (let i = 0; i < contentLangs.length; i++) {
    const lang = contentLangs[i];
    report(i + 1, contentLangs.length, lang, 'labels');
    await cacheOfflineResource('/api/ocr-labels?path=' + encodedPath + langQuery(lang), DYNAMIC_CACHE, { optional: true, json: true });
    report(i + 1, contentLangs.length, lang, 'doc');
    const doc = await cacheOfflineResource('/api/ocr-doc?path=' + encodedPath + '&md=1' + langQuery(lang), DYNAMIC_CACHE, { optional: true, json: true });
    if (doc.ok && doc.json && typeof doc.json.html === 'string') {
      docCount++;
      if (!lang) hasOriginal = true;
      const assets = ocrAssetUrlsFromDocJson(doc.json);
      assetCount += assets.length;
      if (cacheAssets) {
        for (const assetUrl of assets) {
          report(i + 1, contentLangs.length, lang, 'asset');
          const asset = await cacheOfflineResource(assetUrl, DYNAMIC_CACHE, { optional: true });
          if (asset.ok) cachedAssetCount++;
        }
      }
    }
  }
  return { langs, assetCount, cachedAssetCount, assetsCached: cacheAssets, docCount, hasOriginal };
}

function parseCropDoneFromNdjson(text) {
  const lines = String(text || '').split(/\r?\n/);
  let done = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev;
    try { ev = JSON.parse(trimmed); } catch { continue; }
    if (ev.phase === 'error') throw new Error(ev.error || 'crop-failed');
    if (ev.phase === 'done') done = ev;
  }
  return done;
}

async function readResponseText(resp) {
  if (resp && typeof resp.text === 'function') return resp.text();
  if (resp && typeof resp.arrayBuffer === 'function') {
    const buf = await resp.arrayBuffer();
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(buf);
    const bytes = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }
  return '';
}

async function generateCropFromMeta(pdfPath, cropMeta) {
  if (!cropMeta || !cropMeta.cropData) return null;
  const body = Object.assign({}, cropMeta.cropData);
  if (cropMeta.clientData) body.clientData = cropMeta.clientData;
  const resp = await fetch('/api/pdf-crop?path=' + encodeApiPathParam(pdfPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp || !resp.ok) throw new Error('crop-generate-http-' + (resp ? resp.status : 0));
  const contentType = resp.headers && resp.headers.get ? (resp.headers.get('content-type') || '') : '';
  let done = null;
  if (contentType.indexOf('application/x-ndjson') >= 0) {
    done = parseCropDoneFromNdjson(await readResponseText(resp));
  } else {
    try { done = await resp.json(); } catch { done = null; }
  }
  if (!done || !done.croppedPath) throw new Error('crop-generate-failed');
  return done.croppedPath;
}

async function cacheCropBundle(pdfPath, baseUrl, progress) {
  const encodedPath = encodeApiPathParam(pdfPath);
  const crop = await cacheOfflineResource('/api/pdf-crop?path=' + encodedPath, DYNAMIC_CACHE, { optional: true, json: true });
  const result = { found: false, croppedUrl: null };
  if (!crop.ok || !crop.json) return result;
  let croppedPath = crop.json.croppedPath || null;
  if (!croppedPath && crop.json.found && crop.json.cropData) {
    if (progress) progress('crop-generate', null);
    croppedPath = await generateCropFromMeta(pdfPath, crop.json);
    // Refresh/cache the GET metadata now that POST produced a concrete path.
    await cacheOfflineResource('/api/pdf-crop?path=' + encodedPath, DYNAMIC_CACHE, { optional: true, json: true });
  }
  if (!croppedPath) return result;
  result.found = true;
  result.croppedUrl = normalizeBookUrl('/' + String(croppedPath).replace(/^\/+/, ''));
  if (result.croppedUrl) {
    if (progress) progress('crop-pdf', result.croppedUrl);
    await pdfPrefetch(result.croppedUrl);
  }
  return result;
}

function buildLibraryBookManifestFiles(baseUrl, pdfPath, crop, ocr) {
  const encodedPath = encodeApiPathParam(pdfPath);
  const files = {
    pdf: baseUrl,
    annotations: '/api/pdf-annotations?path=' + encodedPath,
  };
  if (crop && crop.found) {
    files.crop = '/api/pdf-crop?path=' + encodedPath;
    if (crop.croppedUrl) files.croppedPdf = crop.croppedUrl;
  }
  if (ocr && (ocr.hasOriginal || (Array.isArray(ocr.langs) && ocr.langs.length > 0))) {
    if (ocr.hasOriginal) files.ocr = '/api/ocr-doc?path=' + encodedPath + '&md=1';
    if (Array.isArray(ocr.langs) && ocr.langs.length > 0) {
      files.translations = ocr.langs.map((lang) => ({
        lang,
        path: '/api/ocr-doc?path=' + encodedPath + '&md=1&lang=' + encodeURIComponent(lang),
      }));
    }
    if (ocr.assetCount > 0) {
      files.ocrAssets = {
        count: ocr.assetCount,
        cached: !!ocr.assetsCached,
        cachedCount: ocr.cachedAssetCount || 0,
      };
    }
  }
  return files;
}

async function libraryBookCacheStatus(data) {
  const baseUrl = pdfBaseUrl(normalizeBookUrl(data.url) || data.url);
  const expectedSha256 = data.pdfSha256 || '';
  const cache = await caches.open(RANGE_CACHE);
  const pdfMeta = await pdfReadMeta(cache, baseUrl);
  if (pdfMeta) await pdfRecomputeCachedBytes(cache, baseUrl, pdfMeta);
  const bookMeta = await pdfReadBookMeta(cache, baseUrl);
  const fullyCached = !!(pdfMeta && pdfMeta.totalSize != null && pdfMeta.cachedBytes >= pdfMeta.totalSize);
  const sameSource = !expectedSha256 || !!(bookMeta && bookMeta.source && bookMeta.source.sha256 === expectedSha256);
  return broadcastToClients({
    type: 'library-book-cache-status-result',
    url: baseUrl,
    cached: pdfMeta ? pdfMeta.cachedBytes : 0,
    total: pdfMeta ? pdfMeta.totalSize : null,
    complete: !!(bookMeta && bookMeta.complete && fullyCached && sameSource),
    manifest: bookMeta || null,
    verifiedSha256: pdfMeta ? (pdfMeta.verifiedSha256 || null) : null,
  });
}

async function libraryBookPrefetch(data) {
  const baseUrl = pdfBaseUrl(normalizeBookUrl(data.url) || data.url);
  const pdfPath = data.pdfPath || '';
  const libraryDir = data.libraryDir || '';
  const pdfSha256 = data.pdfSha256 || '';
  const startedAt = Date.now();
  const progress = (phase, detail) => broadcastToClients({
    type: 'library-book-prefetch-progress',
    url: baseUrl,
    phase,
    detail: detail || null,
  });

  try {
    await progress('static');
    await cacheOfflineResources(data.staticUrls || [], STATIC_CACHE, (done, total, url) => {
      progress('static', { done, total, url });
    });

    await progress('page');
    await cacheOfflineResources(data.dynamicUrls || [], DYNAMIC_CACHE, (done, total, url) => {
      progress('page', { done, total, url });
    });

    let crop = { found: false, croppedUrl: null };
    if (pdfPath) {
      await progress('annotations');
      await cacheOfflineResource('/api/pdf-annotations?path=' + encodeApiPathParam(pdfPath), DYNAMIC_CACHE, { optional: false });

      await progress('crop');
      crop = await cacheCropBundle(pdfPath, baseUrl, (phase, detail) => progress(phase, detail));

      await progress('translation');
      var ocr = await cacheOcrBundle(pdfPath, baseUrl, (done, total, lang, step) => {
        progress('translation', { done, total, lang, step });
      }, { cacheAssets: !!data.cacheAssets });
    }

    await progress('pdf');
    await pdfPrefetch(baseUrl);

    const cache = await caches.open(RANGE_CACHE);
    const pdfMeta = await pdfReadMeta(cache, baseUrl);
    if (pdfMeta) await pdfRecomputeCachedBytes(cache, baseUrl, pdfMeta);
    const complete = !!(pdfMeta && pdfMeta.totalSize != null && pdfMeta.cachedBytes >= pdfMeta.totalSize);
    if (!complete) throw new Error('pdf-incomplete');

    const manifest = {
      version: PDF_COMPANION_META_VERSION,
      manifestVersion: PDF_COMPANION_MANIFEST_VERSION,
      complete: true,
      source: { path: pdfPath, url: baseUrl, sha256: pdfSha256 || (pdfMeta.verifiedSha256 || null) },
      hasAssets: !!(ocr && ocr.assetCount > 0),
      files: buildLibraryBookManifestFiles(baseUrl, pdfPath, crop, ocr || { langs: [], assetCount: 0 }),
      pdfUrl: baseUrl,
      pdfPath,
      libraryDir,
      libraryPagePath: data.libraryPagePath || '',
      cachedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      crop,
      translations: ocr || { langs: [], assetCount: 0 },
      staticCount: Array.isArray(data.staticUrls) ? data.staticUrls.length : 0,
      dynamicCount: Array.isArray(data.dynamicUrls) ? data.dynamicUrls.length : 0,
    };
    await pdfWriteBookMeta(cache, baseUrl, manifest);

    return broadcastToClients({
      type: 'library-book-prefetch-done',
      url: baseUrl,
      ok: true,
      cached: pdfMeta.cachedBytes,
      total: pdfMeta.totalSize,
      manifest,
    });
  } catch (err) {
    return broadcastToClients({
      type: 'library-book-prefetch-done',
      url: baseUrl,
      ok: false,
      error: err && err.message ? err.message : 'failed',
    });
  }
}

async function broadcastToClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    try { client.postMessage(message); } catch { /* ignore disconnected clients */ }
  }
}

// Store every fully-covered, block-aligned chunk that lies inside [dataStart,
// dataStart+buf.byteLength).  Mutates `meta.cachedBytes` and writes meta back
// when at least one block was newly stored.  Honors PDF_CACHE_MAX_BYTES.
async function pdfStoreBlocks(cache, baseUrl, dataStart, buf, meta) {
  const len = buf.byteLength;
  const dataEnd = dataStart + len; // exclusive
  if (!meta.totalSize || len === 0) return false;
  const lastBlockOfFile = Math.floor((meta.totalSize - 1) / PDF_RANGE_BLOCK_SIZE);
  let firstBlock = Math.ceil(dataStart / PDF_RANGE_BLOCK_SIZE);
  let metaChanged = false;
  for (let b = firstBlock; b <= lastBlockOfFile; b++) {
    const blockStart = b * PDF_RANGE_BLOCK_SIZE;
    const expectedSize = (b === lastBlockOfFile)
      ? (meta.totalSize - blockStart)
      : PDF_RANGE_BLOCK_SIZE;
    if (blockStart + expectedSize > dataEnd) break;
    if (meta.cachedBytes + expectedSize > PDF_CACHE_MAX_BYTES) break;
    const key = pdfRangeBlockKey(baseUrl, b);
    const existing = await cache.match(key);
    if (existing) continue;
    const offset = blockStart - dataStart;
    const slice = buf.slice(offset, offset + expectedSize);
    try {
      const blockResp = new Response(slice, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(expectedSize) } });
      await cache.put(key, stripVary(blockResp));
      meta.cachedBytes += expectedSize;
      metaChanged = true;
    } catch (err) {
      // QuotaExceeded or similar — stop storing further blocks but serve
      // the current request normally.
      console.warn('[sw] pdfStoreBlocks: cache.put failed', err);
      break;
    }
  }
  if (metaChanged) {
    meta.lastAccess = Date.now();
    await pdfWriteMeta(cache, baseUrl, meta);
  }
  return metaChanged;
}

async function handlePdfRange(request, skipInitialRefresh = false) {
  const baseUrl = pdfBaseUrl(request.url);
  const range = parseRangeHeader(request.headers.get('range'));
  if (!range) {
    // Malformed Range — let the network handle it.
    try { return await fetch(request); } catch { return new Response('Offline', { status: 503 }); }
  }
  await pdfWaitForVersionCheck(baseUrl);
  let cache = null;
  if (!PDF_UNTRUSTED_RANGE_CACHE.has(baseUrl)) {
    try { cache = await caches.open(RANGE_CACHE); } catch { /* serve validated network ranges without caching */ }
  }

  let meta = cache ? await pdfReadMeta(cache, baseUrl) : null;
  const refreshInitial = !skipInitialRefresh && request.cache === 'no-store' && range.start === 0
    && (!self.navigator || self.navigator.onLine !== false) && meta && meta.totalSize != null;

  // First-time or stale-size path: validate one requested interval before
  // learning metadata or caching any fully covered aligned blocks.
  if (refreshInitial || !meta || meta.totalSize == null || range.start >= meta.totalSize
      || (range.end != null && range.end >= meta.totalSize)) {
    let resp;
    try { resp = await pdfFetchRange(request, range.start, range.end); } catch (err) {
      console.warn('[sw] PDF range fetch failed (offline, no meta yet):', err);
      // navigator.onLine can stay true after connectivity is lost. Retain
      // the offline cache fallback only when the refresh could not connect.
      if (refreshInitial) return handlePdfRange(request, true);
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
    if (resp.status !== 206) {
      if (resp.status !== 200) return resp;
      // Some hosts ignore Range for a small PDF. Permit a complete first
      // response within two requested chunks (64 KiB desktop, 1 MiB iOS),
      // while keeping all later/missing-range responses strictly partial.
      // These full bytes never become range blocks or range metadata.
      const initialChunk = range.end == null ? null : range.end + 1;
      if ((!meta || meta.totalSize == null) && range.start === 0
          && Number.isSafeInteger(initialChunk) && initialChunk > 0
          && initialChunk <= PDF_INITIAL_FULL_MAX_CHUNK_SIZE) {
        try {
          const buf = await pdfReadSmallFullBody(resp, 2 * initialChunk);
          return new Response(buf, { status: 200, statusText: 'OK', headers: resp.headers });
        } catch (err) {
          console.warn('[sw] Invalid initial full PDF response:', err);
          return pdfRangeFailure();
        }
      }
      await pdfCancelResponse(resp);
      return pdfRangeFailure();
    }
    let data;
    try { data = await pdfReadRangeBody(resp, range); } catch (err) {
      console.warn('[sw] Invalid PDF range response:', err);
      return pdfRangeFailure();
    }
    const { cr, buf } = data;
    const newMeta = {
      etag: resp.headers.get('etag') || '',
      lastModified: resp.headers.get('last-modified') || '',
      totalSize: cr.total,
      cachedBytes: 0,
      lastAccess: Date.now(),
    };
    if (meta && meta.etag === newMeta.etag && meta.lastModified === newMeta.lastModified && meta.totalSize === newMeta.totalSize) {
      newMeta.cachedBytes = meta.cachedBytes;
      if (meta.verifiedSha256) newMeta.verifiedSha256 = meta.verifiedSha256;
    }
    if (meta && (meta.etag !== newMeta.etag || meta.lastModified !== newMeta.lastModified || meta.totalSize !== newMeta.totalSize)) {
      if (SW_DEBUG_PDF) console.log('[sw-pdf] purge (validator changed)', baseUrl);
      await pdfCachePurge(baseUrl);
    }
    meta = newMeta;
    if (cache) await pdfWriteMeta(cache, baseUrl, meta);
    if (SW_DEBUG_PDF) console.log('[sw-pdf] FIRST-TIME', baseUrl, 'range=' + range.start + '-' + range.end, 'totalSize=' + meta.totalSize, 'etag=' + meta.etag);
    try {
      if (cache) await pdfStoreBlocks(cache, baseUrl, cr.start, buf, meta);
    } catch (err) {
      console.warn('[sw] PDF range first-fetch cache failed:', err);
    }
    return new Response(buf, { status: 206, statusText: 'Partial Content', headers: resp.headers });
  }

  // Steady-state path: serve from cache where possible, coalesce missing.
  const startByte = range.start;
  const endByte = range.end != null ? range.end : meta.totalSize - 1;
  const firstBlock = Math.floor(startByte / PDF_RANGE_BLOCK_SIZE);
  const lastBlock = Math.floor(endByte / PDF_RANGE_BLOCK_SIZE);

  const blocks = new Map();
  for (let b = firstBlock; b <= lastBlock; b++) {
    const cached = await cache.match(pdfRangeBlockKey(baseUrl, b));
    if (cached) {
      const buf = await cached.arrayBuffer();
      const expectedSize = Math.min(PDF_RANGE_BLOCK_SIZE, meta.totalSize - b * PDF_RANGE_BLOCK_SIZE);
      if (buf.byteLength === expectedSize) blocks.set(b, buf);
      else {
        await cache.delete(pdfRangeBlockKey(baseUrl, b));
        meta.cachedBytes = Math.max(0, meta.cachedBytes - expectedSize);
        delete meta.verifiedSha256;
      }
    }
  }
  const totalBlocks = lastBlock - firstBlock + 1;
  const hitBlocks = blocks.size;
  let bytesFetchedFromNet = 0;

  // Walk [firstBlock..lastBlock]; coalesce contiguous misses into one upstream
  // Range request per run.
  let cursor = firstBlock;
  while (cursor <= lastBlock) {
    if (blocks.has(cursor)) { cursor++; continue; }
    const runStart = cursor;
    while (cursor <= lastBlock && !blocks.has(cursor)) cursor++;
    const runEnd = cursor - 1;
    const fetchStart = runStart * PDF_RANGE_BLOCK_SIZE;
    const fetchEnd = Math.min((runEnd + 1) * PDF_RANGE_BLOCK_SIZE - 1, meta.totalSize - 1);
    let subResp;
    try {
      subResp = await pdfFetchRange(request, fetchStart, fetchEnd);
    } catch (err) {
      console.warn('[sw] PDF range coalesce fetch failed:', err);
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
    if (subResp.status !== 206) {
      if (subResp.status !== 200) return subResp;
      await pdfCancelResponse(subResp);
      return pdfRangeFailure();
    }
    const newEtag = subResp.headers.get('etag') || '';
    const newLM = subResp.headers.get('last-modified') || '';
    const cr = parseContentRange(subResp.headers.get('content-range'));
    if (newEtag !== meta.etag || newLM !== meta.lastModified || (cr && cr.total !== meta.totalSize)) {
      if (SW_DEBUG_PDF) {
        console.log('[sw-pdf] PURGE (validator changed)', baseUrl,
          'old etag=' + JSON.stringify(meta.etag) + ' new=' + JSON.stringify(newEtag),
          'old lm=' + JSON.stringify(meta.lastModified) + ' new=' + JSON.stringify(newLM));
      }
      await pdfCachePurge(baseUrl);
      await pdfCancelResponse(subResp);
      // A coalesced response covers only this missing run; returning it would
      // truncate the caller's interval or mix old and new source bytes.
      return pdfRangeFailure();
    }
    let buf;
    try { ({ buf } = await pdfReadRangeBody(subResp, { start: fetchStart, end: fetchEnd }, meta.totalSize)); } catch (err) {
      console.warn('[sw] Invalid PDF coalesced range response:', err);
      return pdfRangeFailure();
    }
    bytesFetchedFromNet += buf.byteLength;
    await pdfStoreBlocks(cache, baseUrl, fetchStart, buf, meta);
    for (let b = runStart; b <= runEnd; b++) {
      const off = (b - runStart) * PDF_RANGE_BLOCK_SIZE;
      const sz = Math.min(PDF_RANGE_BLOCK_SIZE, buf.byteLength - off);
      blocks.set(b, buf.slice(off, off + sz));
    }
  }

  // Assemble [startByte, endByte] from the collected block buffers.
  const totalLen = endByte - startByte + 1;
  const out = new Uint8Array(totalLen);
  let written = 0;
  for (let b = firstBlock; b <= lastBlock; b++) {
    const blockBuf = blocks.get(b);
    if (!blockBuf) {
      // Should not happen — we either had it cached or just fetched it.
      console.warn('[sw] PDF range: missing block after coalesce', b);
      return pdfRangeFailure();
    }
    const blockStart = b * PDF_RANGE_BLOCK_SIZE;
    const sliceStart = Math.max(0, startByte - blockStart);
    const sliceEnd = Math.min(blockBuf.byteLength, endByte + 1 - blockStart);
    out.set(new Uint8Array(blockBuf, sliceStart, sliceEnd - sliceStart), written);
    written += (sliceEnd - sliceStart);
  }

  // Update lastAccess (cheap; helps any future LRU eviction).
  meta.lastAccess = Date.now();
  pdfWriteMeta(cache, baseUrl, meta).catch(() => {});

  if (SW_DEBUG_PDF) {
    const tag = (hitBlocks === totalBlocks) ? 'HIT'
              : (hitBlocks === 0)           ? 'MISS'
                                            : 'PARTIAL';
    console.log('[sw-pdf] ' + tag,
      'range=' + startByte + '-' + endByte,
      'blocks=' + hitBlocks + '/' + totalBlocks + ' cached',
      'net=' + bytesFetchedFromNet + 'B',
      'cachedBytes=' + meta.cachedBytes + '/' + meta.totalSize,
      baseUrl);
  }

  return new Response(out, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Range': 'bytes ' + startByte + '-' + endByte + '/' + meta.totalSize,
      'Content-Length': String(totalLen),
      'Accept-Ranges': 'bytes',
      'ETag': meta.etag,
      'Last-Modified': meta.lastModified,
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}

async function handlePdfFullGet(request) {
  const baseUrl = pdfBaseUrl(request.url);
  if (self.navigator && self.navigator.onLine === false) {
    return await pdfFullResponseFromCache(baseUrl) || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
  const controller = new AbortController();
  let timer;
  let discarded = false;
  let abortRequest;
  try {
    const deadline = new Promise((_, reject) => {
      const stop = reason => {
        discarded = true;
        controller.abort();
        reject(new Error(reason));
      };
      timer = setTimeout(() => stop('pdf-full-get-timeout'), PDF_FULL_GET_NETWORK_TIMEOUT_MS);
      abortRequest = () => stop('pdf-full-get-aborted');
      if (request.signal) {
        if (request.signal.aborted) abortRequest();
        else request.signal.addEventListener('abort', abortRequest, { once: true });
      }
    });
    const signal = request.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    const network = Promise.resolve().then(() => fetch(request, { signal })).then(response => {
      // Some fetch implementations can resolve after abort. Never leave
      // that abandoned full-PDF body downloading without a consumer.
      if (discarded) void pdfCancelResponse(response);
      return response;
    });
    const response = await Promise.race([network, deadline]);
    if (response.status === 200) pdfQueueFullVersionCheck(baseUrl, response);
    return response;
  } catch (err) {
    return await pdfFullResponseFromCache(baseUrl) || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  } finally {
    clearTimeout(timer);
    if (request.signal && abortRequest) request.signal.removeEventListener('abort', abortRequest);
  }
}

async function pdfFullResponseFromCache(baseUrl) {
  await pdfWaitForVersionCheck(baseUrl);
  if (PDF_UNTRUSTED_RANGE_CACHE.has(baseUrl)) return null;
  let cache;
  try { cache = await caches.open(RANGE_CACHE); } catch { return null; }
  const meta = await pdfReadMeta(cache, baseUrl);
  if (!meta || meta.totalSize == null) return null;
  await pdfRecomputeCachedBytes(cache, baseUrl, meta);
  if (meta.cachedBytes < meta.totalSize) return null;
  const fullBuf = await pdfReadFullFile(cache, baseUrl, meta);
  if (!fullBuf) return null;
  if (SW_DEBUG_PDF) console.log('[sw-pdf] FULL offline', baseUrl, 'bytes=' + meta.totalSize);
  return new Response(fullBuf, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(meta.totalSize),
      'Accept-Ranges': 'bytes',
      'ETag': meta.etag || '',
      'Last-Modified': meta.lastModified || '',
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}

// Recompute meta.cachedBytes from the actual cache contents.  The stored
// `cachedBytes` counter can drift out of sync with reality:
//  - SW upgrade preserved RANGE_CACHE but the meta key got lost / reset to 0.
//  - `cache.put` of a block succeeded but the subsequent meta-write failed.
//  - First-fetch path through handlePdfRange created fresh meta with
//    `cachedBytes: 0` while previous-version blocks still sat in the cache.
// When that happens, `pdfPrefetch`'s "skip if already cached" loop walks
// every block, finds them all cached, and exits with `cachedBytes` still at
// the stale lower number — so the toolbar shows e.g. "8.4 / 8.6 MiB" forever
// and clicking "Complete offline download" looks like it does nothing.
// Persists the corrected count back to the meta entry.  Returns the new
// cachedBytes so callers can use it directly.
async function pdfRecomputeCachedBytes(cache, baseUrl, meta) {
  if (!meta || meta.totalSize == null) return 0;
  const totalBlocks = Math.ceil(meta.totalSize / PDF_RANGE_BLOCK_SIZE);
  let realCached = 0;
  for (let b = 0; b < totalBlocks; b++) {
    const hit = await cache.match(pdfRangeBlockKey(baseUrl, b));
    if (!hit) continue;
    const blockStart = b * PDF_RANGE_BLOCK_SIZE;
    const expectedSize = (b === totalBlocks - 1)
      ? (meta.totalSize - blockStart)
      : PDF_RANGE_BLOCK_SIZE;
    realCached += expectedSize;
  }
  if (realCached !== meta.cachedBytes) {
    if (SW_DEBUG_PDF) {
      console.log('[sw-pdf] recompute cachedBytes drift', baseUrl,
        'meta=' + meta.cachedBytes, 'real=' + realCached);
    }
    meta.cachedBytes = realCached;
    meta.lastAccess = Date.now();
    await pdfWriteMeta(cache, baseUrl, meta);
  }
  return realCached;
}

// Assemble all cached blocks of `baseUrl` into one Uint8Array of length
// `meta.totalSize`.  Returns null if any block is missing — caller should
// only call this when meta.cachedBytes === meta.totalSize.
async function pdfReadFullFile(cache, baseUrl, meta) {
  if (!meta || meta.totalSize == null) return null;
  const out = new Uint8Array(meta.totalSize);
  const totalBlocks = Math.ceil(meta.totalSize / PDF_RANGE_BLOCK_SIZE);
  for (let b = 0; b < totalBlocks; b++) {
    const hit = await cache.match(pdfRangeBlockKey(baseUrl, b));
    if (!hit) return null;
    let buf;
    try { buf = await hit.arrayBuffer(); } catch { return null; }
    const off = b * PDF_RANGE_BLOCK_SIZE;
    out.set(new Uint8Array(buf), off);
  }
  return out;
}

// Hex-encode an ArrayBuffer.
function pdfHex(buf) {
  const view = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < view.byteLength; i++) {
    const h = view[i].toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s;
}

// Verify the assembled PDF against the server's SHA-256.  Returns one of:
//   { verified: true,  sha256 }                 — bytes match
//   { verified: false, error: 'sha-mismatch',
//                      expected, actual }       — bytes DIFFER (hard fail —
//                                                  caller should purge)
//   { verified: false, error: 'sha-server-…' }  — server unreachable / 404 /
//                                                  bad response (informational
//                                                  only; cache stays put)
//   { verified: false, error: 'sha-compute-…' } — crypto.subtle missing /
//                                                  threw (informational only)
//
// The "informational only" errors let the prefetch still report success on
// platforms that lack crypto.subtle in worker context, or when the server
// endpoint is unavailable for any reason — the file is downloaded, just not
// independently checked.
async function pdfVerifySha256(cache, baseUrl, meta) {
  // Step 1: ask the server for the canonical SHA.  We pass the URL pathname
  // so the server can resolve it the same way it would serve the file.
  let pathnameOnly;
  try {
    const u = new URL(baseUrl);
    pathnameOnly = u.pathname;
  } catch { return { verified: false, error: 'sha-server-bad-url' }; }
  let serverResp;
  try {
    serverResp = await fetch('/api/file-sha256?url=' + encodeURIComponent(pathnameOnly));
  } catch { return { verified: false, error: 'sha-server-unreachable' }; }
  if (!serverResp || typeof serverResp.ok === 'undefined') {
    // Some test fetch mocks resolve to `undefined` rather than throwing
    // when no response is queued; treat the same as unreachable.
    return { verified: false, error: 'sha-server-unreachable' };
  }
  if (!serverResp.ok) {
    return { verified: false, error: 'sha-server-' + serverResp.status };
  }
  let json;
  try { json = await serverResp.json(); } catch { return { verified: false, error: 'sha-server-bad-json' }; }
  const expected = json && json.sha256;
  if (typeof expected !== 'string' || expected.length !== 64) {
    return { verified: false, error: 'sha-server-no-sha' };
  }
  // Step 2: assemble the cached blocks and hash them locally.
  const fullBuf = await pdfReadFullFile(cache, baseUrl, meta);
  if (!fullBuf) return { verified: false, error: 'sha-assemble-failed' };
  if (!self.crypto || !self.crypto.subtle || typeof self.crypto.subtle.digest !== 'function') {
    return { verified: false, error: 'sha-compute-unavailable' };
  }
  let actual;
  try {
    const digest = await self.crypto.subtle.digest('SHA-256', fullBuf);
    actual = pdfHex(digest);
  } catch { return { verified: false, error: 'sha-compute-failed' }; }
  if (actual !== expected) {
    return { verified: false, error: 'sha-mismatch', expected, actual };
  }
  return { verified: true, sha256: actual };
}

// Walk every block of a PDF, fetching missing aligned chunks and caching
// them.  Posts progress messages to all clients.  Honors PDF_CACHE_MAX_BYTES
// (stops early with `capped: true`).  Triggered by the client toolbar's
// "Download for offline" / "Complete offline download" menu item.
async function pdfPrefetch(baseUrl) {
  // Try to upgrade storage to persistent so chunks + IDB annotation queue
  // survive disk pressure.  Silent no-op on Safari.
  try {
    if (self.navigator && self.navigator.storage && self.navigator.storage.persist) {
      await self.navigator.storage.persist();
    }
  } catch { /* best effort */ }

  let cache;
  try { cache = await caches.open(RANGE_CACHE); } catch (err) {
    return broadcastToClients({ type: 'pdf-prefetch-done', url: baseUrl, error: 'cache-open-failed' });
  }

  let meta = await pdfReadMeta(cache, baseUrl);

  // If we don't know totalSize, do a small probe fetch to learn it.
  if (!meta || meta.totalSize == null) {
    let probe;
    try {
      probe = await pdfFetchRange(baseUrl, 0, 0);
    } catch (err) {
      return broadcastToClients({ type: 'pdf-prefetch-done', url: baseUrl, error: 'probe-failed' });
    }
    if (probe.status !== 206) {
      await pdfCancelResponse(probe);
      return broadcastToClients({ type: 'pdf-prefetch-done', url: baseUrl, error: 'no-range-support' });
    }
    let data;
    try { data = await pdfReadRangeBody(probe, { start: 0, end: 0 }); } catch {
      return broadcastToClients({ type: 'pdf-prefetch-done', url: baseUrl, error: 'invalid-range-response' });
    }
    const { cr } = data;
    meta = {
      etag: probe.headers.get('etag') || '',
      lastModified: probe.headers.get('last-modified') || '',
      totalSize: cr.total,
      cachedBytes: 0,
      lastAccess: Date.now(),
    };
    await pdfWriteMeta(cache, baseUrl, meta);
  }

  // Reconcile `meta.cachedBytes` with reality before doing any work.  Without
  // this, drift between the counter and the cache can leave files stuck at
  // e.g. "8.4 / 8.6 MiB" with retry-clicks doing nothing — every block is
  // cached but the counter still says 8.4 because the original write missed.
  await pdfRecomputeCachedBytes(cache, baseUrl, meta);

  const totalBlocks = Math.ceil(meta.totalSize / PDF_RANGE_BLOCK_SIZE);
  let capped = false;
  let lastProgress = 0;
  let firstError = null;
  let blocksFailed = 0;
  for (let b = 0; b < totalBlocks; b++) {
    if (meta.cachedBytes >= PDF_CACHE_MAX_BYTES) { capped = true; break; }
    const key = pdfRangeBlockKey(baseUrl, b);
    if (await cache.match(key)) continue;
    const blockStart = b * PDF_RANGE_BLOCK_SIZE;
    const blockEnd = Math.min((b + 1) * PDF_RANGE_BLOCK_SIZE - 1, meta.totalSize - 1);
    let subResp;
    try {
      subResp = await pdfFetchRange(baseUrl, blockStart, blockEnd);
    } catch (err) {
      // Skip-and-continue rather than hard-abort.  A single transient
      // network blip late in the file used to leave the user stuck —
      // every retry hit the same block and bailed in the same place.
      // Now we record the first failure and try the rest; if everything
      // else succeeds the user can click again to retry just the gaps.
      blocksFailed++;
      if (!firstError) firstError = 'fetch-failed';
      continue;
    }
    if (subResp.status !== 206) {
      await pdfCancelResponse(subResp);
      blocksFailed++;
      if (!firstError) firstError = 'http-' + subResp.status;
      continue;
    }
    const newEtag = subResp.headers.get('etag') || '';
    const newLM = subResp.headers.get('last-modified') || '';
    const cr = parseContentRange(subResp.headers.get('content-range'));
    if (newEtag !== meta.etag || newLM !== meta.lastModified || (cr && cr.total !== meta.totalSize)) {
      // Validator change is special — every block we have is now
      // garbage.  Purge and surface so the client can restart cleanly.
      await pdfCachePurge(baseUrl);
      await pdfCancelResponse(subResp);
      return broadcastToClients({
        type: 'pdf-prefetch-done', url: baseUrl,
        error: 'validator-changed',
      });
    }
    let buf;
    try { ({ buf } = await pdfReadRangeBody(subResp, { start: blockStart, end: blockEnd }, meta.totalSize)); } catch {
      blocksFailed++;
      if (!firstError) firstError = 'invalid-range-response';
      continue;
    }
    await pdfStoreBlocks(cache, baseUrl, blockStart, buf, meta);
    // Throttle progress messages — at most one per ~1% of file.
    if (meta.cachedBytes - lastProgress >= meta.totalSize / 100 || b === totalBlocks - 1) {
      lastProgress = meta.cachedBytes;
      broadcastToClients({
        type: 'pdf-prefetch-progress', url: baseUrl,
        cached: meta.cachedBytes, total: meta.totalSize,
      });
    }
  }
  // Final reconcile — covers any blocks stored mid-loop without a meta
  // write (e.g. QuotaExceeded mid-batch in pdfStoreBlocks).
  await pdfRecomputeCachedBytes(cache, baseUrl, meta);

  // SHA-256 verification safety net — only when the file is fully cached
  // and no blocks failed in this run.  A previous partial verify attempt
  // (e.g. server was offline) does not block re-attempting next time;
  // verifiedSha256 is sticky across runs only on success.
  let verification = null;
  const fullyCached = meta.cachedBytes >= meta.totalSize;
  if (fullyCached && blocksFailed === 0 && !capped) {
    // Surface a "Verifying…" UI hint via a special progress message.
    broadcastToClients({
      type: 'pdf-prefetch-progress', url: baseUrl,
      cached: meta.cachedBytes, total: meta.totalSize, verifying: true,
    });
    verification = await pdfVerifySha256(cache, baseUrl, meta);
    if (verification.verified) {
      // Persist so subsequent status queries can report verified=true
      // without re-running the verify on every menu open.
      meta.verifiedSha256 = verification.sha256;
      meta.lastAccess = Date.now();
      await pdfWriteMeta(cache, baseUrl, meta);
    } else if (verification.error === 'sha-mismatch') {
      // Hard failure: cached bytes do not match the server's file.
      // Either the file changed mid-download (validator should have
      // caught it but didn't) or the cache is corrupt.  Either way the
      // contents are unsafe to keep — purge so the next click starts
      // fresh.  The user sees a red error label; the persisted
      // verifiedSha256 (if any) is gone with the meta.
      await pdfCachePurge(baseUrl);
    }
    // Other (informational) verify errors leave the cache alone — we
    // downloaded the bytes successfully, we just couldn't independently
    // check them.
  }

  const verifyMismatch = verification && verification.error === 'sha-mismatch';
  return broadcastToClients({
    type: 'pdf-prefetch-done', url: baseUrl,
    // After a sha-mismatch purge, cachedBytes/totalSize don't reflect
    // the wiped state — report 0 so the menu label updates correctly.
    cached: verifyMismatch ? 0 : meta.cachedBytes,
    total: verifyMismatch ? null : meta.totalSize,
    capped,
    // Surface a partial-failure error code only if we actually missed
    // blocks.  If every gap got filled we report success even when
    // some attempts threw.  A sha-mismatch is also a hard error.
    error: blocksFailed > 0
      ? firstError
      : (verifyMismatch ? 'sha-mismatch' : undefined),
    blocksFailed,
    // Verification result, if it ran:
    //   true  → bytes match the server
    //   false → mismatch OR an informational verify error
    //   null  → not attempted (partial download, capped, etc.)
    verified: verification ? !!verification.verified : null,
    sha256: verification ? (verification.sha256 || null) : null,
    expectedSha256: verification ? (verification.expected || null) : null,
    actualSha256: verification ? (verification.actual || null) : null,
    verifyError: verification && !verification.verified ? verification.error : null,
  });
}

});

registerServiceWorkerModule({"id":"search","requires":[],"precache":[],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"shell","requires":["reading"],"precache":["/static/main.css","/static/themes.css","/static/shell-lifecycle.js","/static/module-browser.js","/static/shell-preferences.js","/static/shell-bootstrap.js","/static/core/code-blocks.js","/static/main.js","/static/shell-layout.js","/static/shell-search-settings.js","/static/shell-router.js","/static/themes.js","/static/settings.html"],"networkFirstPaths":["/static/main.js","/static/main.css","/static/settings.html","/static/themes.css","/static/shell-search-settings.js","/static/themes.js"],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"library","requires":["shell"],"precache":[],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"draftbook","requires":["shell","library","ink"],"precache":[],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":["/api/draftbook"]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"reading.image-viewer","requires":["shell","ink"],"precache":["/static/ink-toolbar.css","/static/image-viewer.css","/static/shell-lifecycle.js","/static/module-browser.js","/static/core/ink-theme-colors.js","/static/ink-toolbar.js","/static/image-viewer.js"],"networkFirstPaths":["/static/image-viewer.js","/static/image-viewer.css"],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"reading.page-scripts","requires":["shell","reading"],"precache":["/static/shell-lifecycle.js","/static/module-browser.js","/static/page-scripts.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"reading.syllabus","requires":["reading","shell"],"precache":["/static/syllabus-enhance.css","/static/core/code-blocks.js","/static/vendor/js-yaml.js","/static/core/syllabus-spec.js","/static/shell-lifecycle.js","/static/module-browser.js","/static/syllabus-enhance.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"reading.table","requires":["shell"],"precache":["/static/table-enhance.css","/static/shell-lifecycle.js","/static/module-browser.js","/static/table-enhance.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"reading.theme-colors","requires":["shell","reading"],"precache":["/static/core/theme-colors.js","/static/shell-lifecycle.js","/static/module-browser.js","/static/theme-colors.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"site.greeting","requires":["shell"],"precache":["/static/greeting.css","/static/shell-lifecycle.js","/static/module-browser.js","/static/greeting.js"],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"watch","requires":[],"precache":[],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":[],"bypassPrefixes":[]}, function(serviceWorker) {

});

registerServiceWorkerModule({"id":"whiteboard","requires":["ink"],"precache":[],"networkFirstPaths":[],"networkFirstOrigins":[],"networkFirstHostSuffixes":["open-meteo.com"],"bypassPrefixes":[]}, function(serviceWorker) {

});
