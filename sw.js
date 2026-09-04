// Build: c659b99
/**
 * Service Worker — enables offline access and caching.
 * Works in both SPA server mode and static build mode.
 *
 * Strategies:
 *   /static/*          → Stale-while-revalidate (serve cached, refresh in background)
 *   /api/* (SPA only)  → Network first, cache fallback
 *   HTML pages         → Network first, cache fallback
 *   CDN assets         → Cache first, network fallback
 *   *.pdf  Range:      → Block-aligned range cache (see PDF range handler)
 */

const CACHE_VERSION = 'kb-v7';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';
const RANGE_CACHE = CACHE_VERSION + '-pdf-ranges';
const DYNAMIC_CACHE_MAX_ENTRIES = 200;
const NETWORK_FIRST_STATIC_PATHS = new Set([
  '/static/main.css',
  '/static/scrollbar-visibility.js',
  '/static/settings.html',
  '/static/terminal.css',
  '/static/terminal.js',
  '/static/notebook-spa-jupyter-embed.js',
]);

// Cross-origin hosts that serve live, frequently-changing data (not static
// assets).  These are routed network-first so a long-running tab keeps
// getting fresh responses.  The generic cross-origin branch below is
// cache-first and would otherwise freeze the first response in STATIC_CACHE
// until CACHE_VERSION bumps.  The weather widget
// (src/client/whiteboard/whiteboard-widgets.js) polls open-meteo for forecasts and city
// geocoding; without this its forecast goes stale after a day (the
// first-of-day row stays pinned to the fetch day) and switching back to a
// previously-viewed city replays the frozen cached body.  See isLiveApiHost()
// and doc/development/modules/browser-shell.md.
const LIVE_API_HOST_SUFFIXES = ['open-meteo.com'];

// PDF range cache — see handlePdfRange / pdfPrefetch helpers below.
const PDF_RANGE_BLOCK_SIZE = 65536;             // 64 KiB, matches pdf.js default rangeChunkSize
const PDF_CACHE_MAX_BYTES = 200 * 1024 * 1024;  // 200 MiB cap per PDF (per-origin quota guardrail)
const PDF_FULL_GET_NETWORK_TIMEOUT_MS = 2500;   // iOS/PWA offline probes can hang instead of rejecting
const PDF_COMPANION_META_VERSION = 7;
const PDF_COMPANION_MANIFEST_VERSION = 1;

// Diagnostic flag — when true, handlePdfRange logs hit/miss decisions to the
// SW console.  Toggle from a page console with:
//   navigator.serviceWorker.controller.postMessage({type:'pdf-debug', on:true})
// Logs appear in DevTools → Application → Service Workers → click the worker.
let SW_DEBUG_PDF = false;

// App shell files to pre-cache on install.
//
// Entries trailing with "// SPA-ONLY" are stripped by the static build
// pipeline (src/publishing/build/ → see SW_SPA_ONLY_RE) because the
// corresponding files only ship under the SPA / Electron runtimes —
// `rprint build` does not copy them to dist/<site>/static/.  Pre-caching
// them in a static deployment would otherwise pollute every install with
// a wall of 404s in DevTools' Network tab.
const APP_SHELL = [
  '/',
  '/static/main.css',
  '/static/shell-bootstrap.js',
  '/static/shell-lifecycle.js',
  '/static/shell-preferences.js',
  '/static/main.js',
  '/static/reading-navigation-state.js',
  '/static/shell-layout.js',
  '/static/shell-search-settings.js',
  '/static/shell-router.js',
  '/static/link-preview.css',
  '/static/link-preview.js',
  '/static/scrollbar-visibility.js',
  '/static/svg-theme.js',
  '/static/render-on-demand.js',
  '/static/themes.css',
  '/static/themes.js',
  '/static/table-enhance.css',
  '/static/table-enhance.js',
  '/static/syllabus-enhance.css',
  '/static/syllabus-enhance.js',
  '/static/notebook.css',
  '/static/notebook.js',
  '/static/core/ink-stroke-format.js',
  '/static/drawing-engine-render.js',
  '/static/core/pdf-page-map-format.js',
];

// Install: pre-cache app shell (overwrites stale entries)
self.addEventListener('install', (event) => {
  console.log('[sw] Installing, pre-caching ' + APP_SHELL.length + ' files');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL);
    }).then(() => {
      // Do not skip the waiting phase on upgrades. An already-open page may
      // still run the previous shell, which loads whiteboard.js as one file;
      // the new worker caches a split chunk graph. Waiting until those clients
      // close prevents mixing an old loader with the new composition root.
      console.log('[sw] Install complete; waiting for safe activation');
    })
  );
});

// Activate: clean old caches (keep current static + dynamic + pdf-ranges), claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const keep = new Set([STATIC_CACHE, DYNAMIC_CACHE, RANGE_CACHE]);
      const old = keys.filter((key) => !keep.has(key));
      if (old.length > 0) console.log('[sw] Cleaning ' + old.length + ' old cache(s)');
      return Promise.all(old.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// True for cross-origin hosts in LIVE_API_HOST_SUFFIXES — live data endpoints
// (weather forecast + geocoding) that must bypass the cross-origin cache-first
// branch and use network-first instead.
function isLiveApiHost(hostname) {
  hostname = String(hostname || '').toLowerCase();
  for (let i = 0; i < LIVE_API_HOST_SUFFIXES.length; i++) {
    const suffix = LIVE_API_HOST_SUFFIXES[i];
    if (hostname === suffix || hostname.endsWith('.' + suffix)) return true;
  }
  return false;
}

// Fetch: routing by request type
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip SSE and WebSocket-related
  if (url.pathname === '/api/events') return;
  if (event.request.headers.get('accept') === 'text/event-stream') return;

  // Skip Jupyter proxy
  if (url.pathname.startsWith('/jupyter/')) return;

  // Version-pinned vendor bundles (pdf.js, etc.): cache first, no revalidation.
  // The version is baked into the path (e.g. /static/vendor/pdfjs-5.6.205/...),
  // so contents at a given URL are immutable.  Without this rule these would
  // fall through to the /static/ stale-while-revalidate branch — and pdf.js
  // spawns one Worker per getDocument() call, so opening a page with N PDF
  // thumbnails fires N concurrent fetches for pdf.worker.min.mjs (~360 KiB).
  // Even when every byte is in the SW cache, stale-while-revalidate kicks
  // off N background refreshes that all hit the server.  Cache-first cuts
  // those background fetches down to zero.
  if (url.pathname.startsWith('/static/vendor/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // Shell and isolated-document assets that control scrollbar behavior must not
  // replay stale UI while a newer worker is waiting for old clients to close.
  if (NETWORK_FIRST_STATIC_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(event.request, STATIC_CACHE));
    return;
  }

  // Static assets: stale-while-revalidate (serve cached, refresh in background)
  if (url.pathname.startsWith('/static/')) {
    const { response, backgroundFetch } = staleWhileRevalidate(event.request, STATIC_CACHE);
    event.respondWith(response);
    event.waitUntil(backgroundFetch);
    return;
  }

  // Live cross-origin data APIs (weather forecast + geocoding): network first.
  // MUST precede the cross-origin cache-first branch below — otherwise the
  // first forecast response is frozen in STATIC_CACHE until CACHE_VERSION
  // bumps, so a long-running weather widget shows day-old data (its
  // first-of-day row stays pinned to the fetch day) and switching back to a
  // previously-viewed city replays the stale cached body. See the browser-shell
  // module documentation.
  if (url.origin !== self.location.origin && isLiveApiHost(url.hostname)) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }

  // CDN assets (KaTeX, highlight.js, fonts): cache first
  // When CDN proxy is active (CDN_PROXY injected by server), proxied assets
  // at /cdn-proxy/* are same-origin — cache them with the same strategy.
  if (url.origin !== self.location.origin) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  if (typeof CDN_PROXY !== 'undefined' && CDN_PROXY && url.pathname.startsWith('/cdn-proxy/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // API calls: network first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }

  // PDF range requests: serve from per-block cache when possible, coalesce
  // missing blocks into upstream Range fetches, synthesize 206 from the
  // assembled bytes.  Same-origin only; covers /attachments/*.pdf as well
  // as PDFs colocated with pages (serveRawFile in server.js).
  //
  // Non-Range PDF GETs (pdf.js's open-probe under disableStream:true, plain
  // <a href> downloads, viewer "save as") use a custom network-first path.
  // Online, we still avoid Cache API writes for these full-body responses:
  // cloning a 200 MiB body is wasteful, and pdf.js aborts the probe stream
  // the instant it sees Accept-Ranges.  Offline, however, iPad/PWA cold
  // starts need the probe to succeed before pdf.js will issue Range
  // requests, so handlePdfFullGet synthesizes a 200 response from the
  // already-complete block cache when possible.
  if (url.pathname.endsWith('.pdf')) {
    if (event.request.headers.has('range')) {
      event.respondWith(handlePdfRange(event.request));
    } else {
      event.respondWith(handlePdfFullGet(event.request));
    }
    return;
  }

  // Attachments: cache first.
  // Non-range requests only — the Cache API can't store 206 Partial Content
  // responses (cache.put silently fails); range requests for .pdf go through
  // handlePdfRange above, all other range requests fall through to the
  // browser's HTTP cache (the server sets ETag/Last-Modified/Cache-Control).
  if (url.pathname.startsWith('/attachments/')) {
    if (event.request.headers.has('range')) return;
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // HTML pages: network first
  event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
});

// Strip Vary header before caching.  fetch() transparently decompresses
// gzipped responses, so the cached body is always uncompressed.  Keeping
// Vary: Accept-Encoding in the cache entry would cause cache.match() to
// miss when the new request has a different Accept-Encoding, leading to
// stale-while-revalidate serving an outdated entry or a cache miss.
function stripVary(response) {
  var headers = new Headers(response.headers);
  headers.delete('Vary');
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });
}

// Cache first, network fallback
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

// Stale-while-revalidate: serve from cache immediately, refresh in background.
// Returns { response: Promise<Response>, backgroundFetch: Promise } so the
// caller can pass backgroundFetch to event.waitUntil() to keep the SW alive.
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
      return null; // Swallow network errors for background refresh
    }
  })();

  const response = (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;

    // No cache: wait for network response
    const fetched = await backgroundFetch;
    if (fetched) return fetched;

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  })();

  return { response, backgroundFetch };
}

// Network first, cache fallback
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

    // Preview navigation adds a client-only query parameter. If the article
    // was previously opened normally, reuse that canonical cache entry before
    // considering the generic root fallback.
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

      // For other uncached navigation requests, try the cached root page.
      const fallback = await caches.match('/');
      if (fallback) return fallback;
    }

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Listen for messages from the client
self.addEventListener('message', (event) => {
  // Allow client to clear static cache (e.g., on build-commit change)
  if (event.data === 'clearCaches') {
    caches.delete(STATIC_CACHE);
    return;
  }
  // Structured PDF range-cache messages — see handlePdfRange / pdfPrefetch
  const data = event.data;
  if (!data || typeof data !== 'object' || !data.type) return;
  if (data.type === 'pdf-prefetch' && data.url) {
    event.waitUntil(pdfPrefetch(data.url));
    return;
  }
  if (data.type === 'pdf-cache-status' && data.url) {
    event.waitUntil(pdfCacheStatus(data.url));
    return;
  }
  if (data.type === 'library-book-cache-status' && data.url) {
    event.waitUntil(libraryBookCacheStatus(data));
    return;
  }
  if (data.type === 'library-book-prefetch' && data.url) {
    event.waitUntil(libraryBookPrefetch(data));
    return;
  }
  if (data.type === 'pdf-cache-purge' && data.url) {
    event.waitUntil(pdfCachePurgeKeepMeta(data.url));
    return;
  }
  if (data.type === 'pdf-cache-reset' && data.url) {
    event.waitUntil(pdfCachePurge(data.url));
    return;
  }
  if (data.type === 'pdf-debug') {
    SW_DEBUG_PDF = !!data.on;
    console.log('[sw] PDF debug logging:', SW_DEBUG_PDF ? 'ON' : 'OFF');
    return;
  }
});

// Evict oldest entries when cache exceeds maxEntries (iterative, not recursive)
function trimCache(cacheName, maxEntries) {
  caches.open(cacheName).then(function(cache) {
    if (!cache || typeof cache.keys !== 'function') return;
    cache.keys().then(function(keys) {
      var toDelete = keys.length - maxEntries;
      if (toDelete <= 0) return;
      // Delete excess entries sequentially using a promise chain
      var chain = Promise.resolve();
      for (var i = 0; i < toDelete; i++) {
        (function(key) {
          chain = chain.then(function() { return cache.delete(key); });
        })(keys[i]);
      }
    });
  });
}

// ─── PDF range cache ───────────────────────────────────────
// Stores 64 KiB-aligned chunks of PDFs under cache keys like
//   <baseUrl>?_swrange=<blockIdx>
// plus a single metadata entry at
//   <baseUrl>?_swmeta=1
// containing { etag, lastModified, totalSize, cachedBytes, lastAccess }.
//
// On any range request for a *.pdf URL:
//   1. If we don't yet know totalSize/etag, do a passthrough fetch and learn
//      them from Content-Range + ETag/Last-Modified headers.
//   2. Otherwise, look up each needed block in the cache, coalesce contiguous
//      misses into upstream Range fetches, store newly-fetched aligned blocks
//      (subject to PDF_CACHE_MAX_BYTES per PDF), then assemble + return a
//      synthesized 206 Partial Content response.
//   3. If the upstream response carries a different ETag/Last-Modified than
//      our stored meta, purge all entries for that URL before returning the
//      fresh response.

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
  if (!Number.isFinite(start) || start < 0) return null;
  if (end != null && (!Number.isFinite(end) || end < start)) return null;
  return { start, end };
}

function parseContentRange(value) {
  if (!value) return null;
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(value);
  if (!m) return null;
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10), total: parseInt(m[3], 10) };
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

async function handlePdfRange(request) {
  const baseUrl = pdfBaseUrl(request.url);
  const range = parseRangeHeader(request.headers.get('range'));
  if (!range) {
    // Malformed Range — let the network handle it.
    try { return await fetch(request); } catch { return new Response('Offline', { status: 503 }); }
  }
  let cache;
  try { cache = await caches.open(RANGE_CACHE); } catch { return fetch(request); }

  let meta = await pdfReadMeta(cache, baseUrl);

  // First-time path: passthrough fetch, learn meta, opportunistically cache
  // any aligned blocks fully covered by the response.
  if (!meta || meta.totalSize == null) {
    let resp;
    try { resp = await fetch(request); } catch (err) {
      console.warn('[sw] PDF range fetch failed (offline, no meta yet):', err);
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
    if (resp.status !== 206) return resp;
    const cr = parseContentRange(resp.headers.get('content-range'));
    if (!cr) return resp;
    const newMeta = {
      etag: resp.headers.get('etag') || '',
      lastModified: resp.headers.get('last-modified') || '',
      totalSize: cr.total,
      cachedBytes: 0,
      lastAccess: Date.now(),
    };
    if (meta && (meta.etag !== newMeta.etag || meta.lastModified !== newMeta.lastModified)) {
      if (SW_DEBUG_PDF) console.log('[sw-pdf] purge (validator changed)', baseUrl);
      await pdfCachePurge(baseUrl);
    }
    meta = newMeta;
    await pdfWriteMeta(cache, baseUrl, meta);
    if (SW_DEBUG_PDF) console.log('[sw-pdf] FIRST-TIME', baseUrl, 'range=' + range.start + '-' + range.end, 'totalSize=' + meta.totalSize, 'etag=' + meta.etag);
    try {
      const buf = await resp.clone().arrayBuffer();
      await pdfStoreBlocks(cache, baseUrl, cr.start, buf, meta);
    } catch (err) {
      console.warn('[sw] PDF range first-fetch cache failed:', err);
    }
    return resp;
  }

  // Steady-state path: serve from cache where possible, coalesce missing.
  const startByte = range.start;
  const endByte = range.end != null ? range.end : meta.totalSize - 1;
  if (startByte >= meta.totalSize || endByte >= meta.totalSize) {
    // Out of range — let upstream decide (will likely return 416).
    try { return await fetch(request); } catch { return new Response('Offline', { status: 503 }); }
  }
  const firstBlock = Math.floor(startByte / PDF_RANGE_BLOCK_SIZE);
  const lastBlock = Math.floor(endByte / PDF_RANGE_BLOCK_SIZE);

  const blocks = new Map();
  for (let b = firstBlock; b <= lastBlock; b++) {
    const cached = await cache.match(pdfRangeBlockKey(baseUrl, b));
    if (cached) blocks.set(b, await cached.arrayBuffer());
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
      subResp = await fetch(baseUrl, { headers: { Range: 'bytes=' + fetchStart + '-' + fetchEnd } });
    } catch (err) {
      console.warn('[sw] PDF range coalesce fetch failed:', err);
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
    if (subResp.status !== 206) return subResp;
    const newEtag = subResp.headers.get('etag') || '';
    const newLM = subResp.headers.get('last-modified') || '';
    if (newEtag !== meta.etag || newLM !== meta.lastModified) {
      if (SW_DEBUG_PDF) {
        console.log('[sw-pdf] PURGE (validator changed)', baseUrl,
          'old etag=' + JSON.stringify(meta.etag) + ' new=' + JSON.stringify(newEtag),
          'old lm=' + JSON.stringify(meta.lastModified) + ' new=' + JSON.stringify(newLM));
      }
      await pdfCachePurge(baseUrl);
      // Return the fresh upstream response for this request; subsequent
      // requests will rebuild meta + cache from scratch.
      return subResp;
    }
    let buf;
    try { buf = await subResp.arrayBuffer(); } catch (err) {
      console.warn('[sw] PDF range coalesce arrayBuffer failed:', err);
      return new Response('Offline', { status: 503 });
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
      try { return await fetch(request); } catch { return new Response('Offline', { status: 503 }); }
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
  try {
    return await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('pdf-full-get-timeout')), PDF_FULL_GET_NETWORK_TIMEOUT_MS)),
    ]);
  } catch (err) {
    return await pdfFullResponseFromCache(baseUrl) || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function pdfFullResponseFromCache(baseUrl) {
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
      probe = await fetch(baseUrl, { headers: { Range: 'bytes=0-0' } });
    } catch (err) {
      return broadcastToClients({ type: 'pdf-prefetch-done', url: baseUrl, error: 'probe-failed' });
    }
    if (probe.status !== 206) {
      return broadcastToClients({ type: 'pdf-prefetch-done', url: baseUrl, error: 'no-range-support' });
    }
    const cr = parseContentRange(probe.headers.get('content-range'));
    if (!cr) {
      return broadcastToClients({ type: 'pdf-prefetch-done', url: baseUrl, error: 'no-content-range' });
    }
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
      subResp = await fetch(baseUrl, { headers: { Range: 'bytes=' + blockStart + '-' + blockEnd } });
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
      blocksFailed++;
      if (!firstError) firstError = 'http-' + subResp.status;
      continue;
    }
    const newEtag = subResp.headers.get('etag') || '';
    const newLM = subResp.headers.get('last-modified') || '';
    if (newEtag !== meta.etag || newLM !== meta.lastModified) {
      // Validator change is special — every block we have is now
      // garbage.  Purge and surface so the client can restart cleanly.
      await pdfCachePurge(baseUrl);
      return broadcastToClients({
        type: 'pdf-prefetch-done', url: baseUrl,
        error: 'validator-changed',
      });
    }
    let buf;
    try { buf = await subResp.arrayBuffer(); } catch {
      blocksFailed++;
      if (!firstError) firstError = 'body-read-failed';
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
