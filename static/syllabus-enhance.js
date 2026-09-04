/**
 * syllabus-enhance.js — prerequisite DAG from markdown tables
 *
 * Reads structured data from a .syllabus-dag container:
 *   - <table>  course data (id | alias | name | cat | major | prereqs | req | desc)
 *   - <script type="application/json" class="sd-cats">  category colours / labels
 *
 * Layers are computed automatically from the prerequisite graph (longest path).
 * Filters are generated from the unique values in the "major" column.
 * A course is "required" when the selected major appears in its "req" column.
 */
(function () {
  'use strict';

  function addCandidate(candidates, value) {
    if (value === undefined || value === null) return;
    var text = String(value).trim();
    if (text && candidates.indexOf(text) === -1) candidates.push(text);
  }

  function withoutHtmlExtension(value) {
    return String(value || '').replace(/\.html?$/i, '');
  }

  function defaultMajorCandidates(value) {
    var candidates = [];
    var raw = String(value || '').trim();
    addCandidate(candidates, raw);
    try { addCandidate(candidates, decodeURIComponent(raw)); } catch (e) { /* ignore */ }

    var noQuery = raw.split('#')[0].split('?')[0].replace(/\/+$/, '');
    addCandidate(candidates, noQuery);
    addCandidate(candidates, withoutHtmlExtension(noQuery));

    var pathname = noQuery;
    try { pathname = new URL(raw, location.origin).pathname.replace(/\/+$/, ''); } catch (e2) { /* ignore */ }
    addCandidate(candidates, pathname);
    addCandidate(candidates, withoutHtmlExtension(pathname));

    var parts = pathname.split('/').filter(Boolean);
    if (parts.length) {
      var last = parts[parts.length - 1];
      addCandidate(candidates, last);
      addCandidate(candidates, withoutHtmlExtension(last));
      try { addCandidate(candidates, decodeURIComponent(last)); } catch (e3) { /* ignore */ }
    }
    return candidates;
  }

  function looseMajorKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function resolveDefaultMajor(defaultMajor, orderedMajors) {
    if (!defaultMajor) return null;
    var candidates = defaultMajorCandidates(defaultMajor);
    for (var i = 0; i < candidates.length; i++) {
      if (orderedMajors.indexOf(candidates[i]) !== -1) {
        return candidates[i];
      }
    }

    var byLower = {};
    orderedMajors.forEach(function (m) { byLower[String(m).toLowerCase()] = m; });
    for (var j = 0; j < candidates.length; j++) {
      var lowerMatch = byLower[String(candidates[j]).toLowerCase()];
      if (lowerMatch) return lowerMatch;
    }

    var byLoose = {};
    orderedMajors.forEach(function (m) { byLoose[looseMajorKey(m)] = m; });
    for (var k = 0; k < candidates.length; k++) {
      var looseMatch = byLoose[looseMajorKey(candidates[k])];
      if (looseMatch) return looseMatch;
    }
    return null;
  }

  // Tracks each currently-enhanced dag element's teardown (its
  // window/document-level resize listener + MutationObserver). Calling
  // initSyllabusEnhance() again — e.g. after an SPA content swap — first
  // disposes any tracked dag that's no longer attached to the document
  // (the old content was replaced) before scanning for new ones, so
  // navigating away from and back to syllabus pages never accumulates
  // duplicate handlers. Dags that are still attached and already enhanced
  // are left alone (matches the pre-existing `seEnhanced` no-op guard —
  // calling this twice on unchanged content stays idempotent).
  var trackedDags = [];
  var dagDisposers = new WeakMap();

  function initSyllabusEnhance(root) {
    trackedDags = trackedDags.filter(function (el) {
      if (el.isConnected) return true;
      var dispose = dagDisposers.get(el);
      if (dispose) dispose();
      dagDisposers.delete(el);
      return false;
    });

    var scope = root || document;
    var dags = [];
    if (scope.nodeType === 1 && scope.matches && scope.matches('.syllabus-dag')) dags.push(scope);
    scope.querySelectorAll('.syllabus-dag').forEach(function (el) { dags.push(el); });
    dags.forEach(function (el) {
      if (dagDisposers.has(el)) return; // already enhanced + tracked
      var dispose = initDag(el);
      if (typeof dispose === 'function') {
        dagDisposers.set(el, dispose);
        trackedDags.push(el);
      }
    });

    return function disposeAllTracked() {
      trackedDags.forEach(function (el) {
        var dispose = dagDisposers.get(el);
        if (dispose) dispose();
        dagDisposers.delete(el);
      });
      trackedDags = [];
    };
  }

  window.initSyllabusEnhance = initSyllabusEnhance;
  initSyllabusEnhance(document);

  function initDag(root) {
    if (root.dataset.seEnhanced) return undefined;

    /* ── Parse data ── */
    var table = root.querySelector('table.sd-src') || root.querySelector('table');
    if (!table) return;

    var catOverrides, majorNames, linkData;
    function parseJsonScript(selector, label) {
      var script = root.querySelector(selector);
      var raw = script ? script.textContent : '';
      if (!raw || !raw.trim()) return {};
      try {
        return JSON.parse(raw);
      } catch (e) {
        throw e;
      }
    }
    try {
      catOverrides = parseJsonScript('script.sd-cats', 'sd-cats');
      majorNames = parseJsonScript('script.sd-majors', 'sd-majors');
      linkData = parseJsonScript('script.sd-links', 'sd-links');
    } catch (e) {
      if (window._log) _log.error('syllabus', 'Failed to parse DAG JSON data', String(e));
      return;
    }
    root.dataset.seEnhanced = '1';
    var storageKey = root.dataset.key || 'syllabus-dag-taken';

    // Columns: id | alias | name | cat | major | prereqs | req | desc
    var courses = [];
    var allMajors = new Set();
    var catOrder = [];
    var catSeen = {};
    function splitList(s) { return s ? s.split(/\s*,\s*/).filter(Boolean) : []; }

    var sourceRows = table.querySelectorAll('tbody tr');
    if (!sourceRows.length) sourceRows = table.querySelectorAll('tr');
    sourceRows.forEach(function (tr) {
      var cells = tr.querySelectorAll('td');
      if (cells.length < 8) return;
      var c = {
        id:      cells[0].textContent.trim(),
        alias:   splitList(cells[1].textContent.trim()),
        name:    cells[2].textContent.trim(),
        cat:     cells[3].textContent.trim(),
        majors:  splitList(cells[4].textContent.trim()),
        prereqs: splitList(cells[5].textContent.trim()),
        req:     splitList(cells[6].textContent.trim()),
        desc:    cells[7].textContent.trim()
      };
      var ld = linkData[c.id] || {};
      c.links = ld.links || [];
      c.alts = ld.alts || '';
      courses.push(c);
      c.majors.forEach(function (m) { allMajors.add(m); });
      if (!catSeen[c.cat]) { catSeen[c.cat] = true; catOrder.push(c.cat); }
    });

    // Auto-generate well-separated colors via golden angle in HSL
    var catMeta = {};
    var golden = 137.508;
    catOrder.forEach(function (cat, i) {
      var hue = (i * golden) % 360;
      var autoColor = 'hsl(' + Math.round(hue) + ', 65%, 45%)';
      var ov = catOverrides[cat] || {};
      catMeta[cat] = {
        label: ov.label || cat.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
        color: ov.color || autoColor
      };
    });

    /* ── State ── */
    var taken = readTakenState(storageKey);
    function saveTaken() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(taken)));
      } catch (e) {
        if (window._log) _log.error('syllabus', 'Failed to save taken state', String(e));
      }
    }

    function readTakenState(key) {
      var raw;
      try {
        raw = localStorage.getItem(key);
      } catch (e) {
        if (window._log) _log.error('syllabus', 'Failed to read taken state', String(e));
        return new Set();
      }
      if (!raw) return new Set();
      try {
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Expected an array');
        return new Set(parsed.filter(function (id) { return typeof id === 'string'; }));
      } catch (e2) {
        try { localStorage.setItem(key, '[]'); } catch (ignore) {}
        return new Set();
      }
    }

    /* ── Build UI shell ── */
    var toolbar = document.createElement('div');
    toolbar.className = 'sd-toolbar';

    var select = document.createElement('select');
    var allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = 'All Courses';
    select.appendChild(allOpt);
    var majorKeys = Object.keys(majorNames);
    var orderedMajors = majorKeys.length > 0
      ? majorKeys.filter(function (m) { return allMajors.has(m); })
          .concat(Array.from(allMajors).filter(function (m) { return majorKeys.indexOf(m) === -1; }).sort())
      : Array.from(allMajors).sort();
    orderedMajors.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m; opt.textContent = majorNames[m] || m;
      select.appendChild(opt);
    });
    var defaultMajor = root.dataset.defaultMajor;
    var defaultMatch = resolveDefaultMajor(defaultMajor, orderedMajors);
    if (defaultMatch) {
      select.value = defaultMatch;
    } else if (orderedMajors.length > 0) {
      select.value = orderedMajors[0];
    }
    toolbar.appendChild(select);

    var clearBtn = document.createElement('button');
    clearBtn.className = 'sd-clear-btn';
    clearBtn.textContent = 'Clear Taken';
    clearBtn.title = 'Clear completed courses';

    // Mode switcher
    var modes = [
      { key: 'view', label: 'View', hint: 'Click a course to see details.' },
      { key: 'deps', label: 'Dependency', hint: 'Hover to highlight prereqs (blue) & unlocks (orange).' },
      { key: 'taken', label: 'Stage', hint: 'Click to mark taken. Unlocked courses (prereqs met) are bright; locked ones are dimmed.' }
    ];
    var currentMode = 'view';
    var modeWrap = document.createElement('span');
    modeWrap.className = 'sd-mode-wrap';
    var modeBtns = {};
    modes.forEach(function (m) {
      var btn = document.createElement('button');
      btn.className = 'sd-mode-btn' + (m.key === currentMode ? ' sd-mode-active' : '');
      btn.dataset.mode = m.key;
      btn.textContent = m.label;
      btn.addEventListener('click', function () {
        currentMode = m.key;
        Object.keys(modeBtns).forEach(function (k) {
          modeBtns[k].classList.toggle('sd-mode-active', k === currentMode);
        });
        hint.textContent = m.hint;
        hideTooltip(); activeTooltip = null; resetEdges();
        svg.style.cursor = currentMode === 'taken' ? 'pointer' : 'default';
        render();
      });
      modeBtns[m.key] = btn;
      modeWrap.appendChild(btn);
    });
    toolbar.appendChild(modeWrap);
    toolbar.appendChild(clearBtn);

    var hint = document.createElement('span');
    hint.className = 'sd-hint';
    hint.textContent = modes[0].hint;
    toolbar.appendChild(hint);

    var legend = document.createElement('div');
    legend.className = 'sd-legend';

    var tooltip = document.createElement('div');
    tooltip.className = 'sd-tooltip';

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    table.classList.add('sd-src');
    var tableAnchor = table.closest('.table-wrap') || table;
    root.insertBefore(toolbar, tableAnchor);
    root.insertBefore(legend, tableAnchor);
    root.insertBefore(tooltip, tableAnchor);
    root.appendChild(svg);

    var activeTooltip = null;

    /* ── Layout constants (base values, scaled by fontScale at render) ── */
    var BASE_NODE_H = 72, PAD_X = 16, BASE_PAD_Y = 36, PAD = 40;

    /* ── Compute layers from prereqs (longest path from roots) ── */
    function computeLayers(visible) {
      var ids = new Set(visible.map(function (c) { return c.id; }));
      var byId = {};
      visible.forEach(function (c) { byId[c.id] = c; });
      var cache = {}, pending = {};
      function depth(id) {
        if (cache[id] !== undefined) return cache[id];
        if (pending[id]) return 0;
        pending[id] = true;
        var c = byId[id];
        if (!c) { cache[id] = 0; return 0; }
        var max = -1;
        c.prereqs.forEach(function (pid) {
          if (ids.has(pid)) max = Math.max(max, depth(pid));
        });
        cache[id] = max + 1;
        delete pending[id];
        return cache[id];
      }
      visible.forEach(function (c) { depth(c.id); });
      return cache;
    }

    /* ── Layout: Sugiyama / barycenter ── */
    function layout(visible, containerWidth, fontScale) {
      var NODE_H = Math.round(BASE_NODE_H * fontScale);
      var PAD_Y = Math.round(BASE_PAD_Y * fontScale);
      if (!visible.length) return { nodes: {}, edges: [], width: 0, height: 0, nodeW: 0, nodeH: NODE_H };
      var maxPerLayer = containerWidth < 500 ? 3 : containerWidth < 750 ? 4 : containerWidth < 1000 ? 5 : 6;
      var ids = new Set(visible.map(function (c) { return c.id; }));
      var edges = [];
      visible.forEach(function (c) {
        c.prereqs.forEach(function (pid) {
          if (ids.has(pid)) edges.push({ from: pid, to: c.id });
        });
      });

      var layerMap = computeLayers(visible);

      // Group by layer, split >maxPerLayer
      var rawLayers = {};
      visible.forEach(function (c) {
        var ly = layerMap[c.id] || 0;
        (rawLayers[ly] = rawLayers[ly] || []).push(c);
      });
      var layers = {}, layerIdx = 0;
      Object.keys(rawLayers).map(Number).sort(function (a, b) { return a - b; }).forEach(function (ly) {
        var arr = rawLayers[ly];
        for (var i = 0; i < arr.length; i += maxPerLayer) {
          var chunk = arr.slice(i, i + maxPerLayer);
          layers[layerIdx] = chunk;
          chunk.forEach(function (c) { c._ly = layerIdx; });
          layerIdx++;
        }
      });
      var layerKeys = Object.keys(layers).map(Number).sort(function (a, b) { return a - b; });

      // Adjacency
      var childrenOf = {}, parentsOf = {};
      visible.forEach(function (c) { childrenOf[c.id] = []; parentsOf[c.id] = []; });
      edges.forEach(function (e) { childrenOf[e.from].push(e.to); parentsOf[e.to].push(e.from); });

      // Count crossings between two adjacent layers (top fixed, bottom ordered)
      function countCrossings(topArr, botArr, adj) {
        var posTop = {};
        topArr.forEach(function (c, i) { posTop[c.id] = i; });
        // Build sorted edge-pair list: (topPos, botPos)
        var pairs = [];
        botArr.forEach(function (c, bi) {
          (adj[c.id] || []).forEach(function (pid) {
            if (posTop[pid] !== undefined) pairs.push([posTop[pid], bi]);
          });
        });
        // Count inversions (crossing = pair where top order and bottom order disagree)
        var cross = 0;
        for (var i = 0; i < pairs.length; i++) {
          for (var j = i + 1; j < pairs.length; j++) {
            if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) cross++;
          }
        }
        return cross;
      }

      // Crossings involving a specific layer (with its upper and lower neighbors)
      function layerCrossings(li) {
        var c = 0;
        if (li > 0)
          c += countCrossings(layers[layerKeys[li - 1]], layers[layerKeys[li]], parentsOf);
        if (li < layerKeys.length - 1)
          c += countCrossings(layers[layerKeys[li]], layers[layerKeys[li + 1]], parentsOf);
        return c;
      }

      // Initial positions
      var pos = {};
      layerKeys.forEach(function (ly) { layers[ly].forEach(function (c, i) { pos[c.id] = i; }); });

      // Phase 1: Barycenter sweeps (fast initial ordering)
      for (var iter = 0; iter < 12; iter++) {
        var li;
        for (li = 1; li < layerKeys.length; li++) {
          var ly = layerKeys[li];
          layers[ly].forEach(function (c) {
            var pars = parentsOf[c.id];
            if (pars.length > 0) pos[c.id] = pars.reduce(function (s, p) { return s + pos[p]; }, 0) / pars.length;
          });
          layers[ly].sort(function (a, b) { return pos[a.id] - pos[b.id]; });
          layers[ly].forEach(function (c, i) { pos[c.id] = i; });
        }
        for (li = layerKeys.length - 2; li >= 0; li--) {
          var ly2 = layerKeys[li];
          layers[ly2].forEach(function (c) {
            var chs = childrenOf[c.id];
            if (chs.length > 0) pos[c.id] = chs.reduce(function (s, ch) { return s + pos[ch]; }, 0) / chs.length;
          });
          layers[ly2].sort(function (a, b) { return pos[a.id] - pos[b.id]; });
          layers[ly2].forEach(function (c, i) { pos[c.id] = i; });
        }
      }

      // Phase 2: Sifting — for each node, try every position in its layer,
      // keep the one that minimizes crossings on its adjacent layers.
      // This is the well-known Sugiyama "sifting" optimization.
      var siftImproved = true;
      for (var siftRound = 0; siftRound < 10 && siftImproved; siftRound++) {
        siftImproved = false;
        for (var li2 = 0; li2 < layerKeys.length; li2++) {
          var lk = layerKeys[li2];
          var arr = layers[lk];
          if (arr.length < 2) continue;
          for (var ni = 0; ni < arr.length; ni++) {
            var bestCross = layerCrossings(li2);
            var bestPos = ni;
            // Remove node from position ni
            var node = arr.splice(ni, 1)[0];
            // Try inserting at every position
            for (var ti = 0; ti <= arr.length; ti++) {
              arr.splice(ti, 0, node);
              arr.forEach(function (c, i) { pos[c.id] = i; });
              var tc = layerCrossings(li2);
              if (tc < bestCross) { bestCross = tc; bestPos = ti; }
              arr.splice(ti, 1);
            }
            // Place at best position
            arr.splice(bestPos, 0, node);
            arr.forEach(function (c, i) { pos[c.id] = i; });
            if (bestPos !== ni) siftImproved = true;
          }
        }
      }

      // Position nodes
      var maxPerLayer = Math.max.apply(null, layerKeys.map(function (ly) { return layers[ly].length; }));
      var NODE_W = Math.min(240, Math.max(60, (containerWidth - 2 * PAD) / Math.max(1, maxPerLayer) - PAD_X));
      var totalW = maxPerLayer * (NODE_W + PAD_X);
      var nodes = {};
      layerKeys.forEach(function (ly) {
        var arr = layers[ly];
        var w = arr.length * (NODE_W + PAD_X) - PAD_X;
        var x0 = (totalW - w) / 2;
        arr.forEach(function (c, i) {
          nodes[c.id] = { x: x0 + i * (NODE_W + PAD_X), y: ly * (NODE_H + PAD_Y), c: c };
        });
      });
      return { nodes: nodes, edges: edges, width: totalW, height: layerKeys.length * (NODE_H + PAD_Y), nodeW: NODE_W, nodeH: NODE_H };
    }

    /* ── Render ── */
    function render() {
      var filterKey = select.value;
      var isFiltered = filterKey !== 'all';
      var visible = isFiltered
        ? courses.filter(function (c) { return c.majors.indexOf(filterKey) >= 0; })
        : courses.slice();

      // Required = courses whose req list includes the selected major
      var requiredSet = new Set();
      if (isFiltered) {
        visible.forEach(function (c) {
          if (c.req.indexOf(filterKey) >= 0) requiredSet.add(c.id);
        });
      }

      var containerWidth = root.clientWidth || 800;
      var baseFontSize = parseFloat(getComputedStyle(document.body).fontSize) || 16;
      var fontScale = baseFontSize / 16;
      var L = layout(visible, containerWidth, fontScale);
      var nodes = L.nodes, edges = L.edges, width = L.width, height = L.height;
      var NODE_W = L.nodeW;
      var NODE_H = L.nodeH;

      var pad = containerWidth < 500 ? 16 : PAD;
      var svgW = width + pad * 2;
      var svgH = height + pad;
      svg.setAttribute('viewBox', (-pad) + ' ' + (-pad / 2) + ' ' + svgW + ' ' + svgH);
      svg.setAttribute('width', svgW);
      svg.setAttribute('height', svgH);
      svg.removeAttribute('preserveAspectRatio');
      svg.style.fontFamily = 'inherit';

      var s = '';

      // In taken mode, compute unlocked courses (all prereqs in visible set are taken)
      var unlockedSet = new Set();
      if (currentMode === 'taken') {
        var visibleIds = new Set(visible.map(function (c) { return c.id; }));
        visible.forEach(function (c) {
          if (taken.has(c.id)) return; // already taken, not "unlocked"
          var visPrereqs = c.prereqs.filter(function (p) { return visibleIds.has(p); });
          var allMet = visPrereqs.length === 0 ? true : visPrereqs.every(function (p) { return taken.has(p); });
          if (allMet) unlockedSet.add(c.id);
        });
      }

      // Nodes
      var isKindle = document.documentElement.getAttribute('data-theme') === 'kindle';
      Object.keys(nodes).forEach(function (id) {
        var n = nodes[id], c = n.c;
        var col = isKindle ? '#000' : ((catMeta[c.cat] || {}).color || '#888');
        var isTaken = taken.has(id);
        var isReq = requiredSet.has(id);
        var isUnlocked = unlockedSet.has(id);
        var isLocked = currentMode === 'taken' && !isTaken && !isUnlocked;
        var fill = isTaken ? 'var(--sd-taken-bg)' : 'var(--sd-card)';
        var stroke = isTaken ? 'var(--sd-taken-border)' : col;
        var sw = isTaken ? 2.5 : 1.5;
        var dash = (isFiltered && !isReq) ? ' stroke-dasharray="4 2"' : '';
        var lockOpacity = isLocked ? ' opacity="0.35"' : '';

        s += '<g class="sd-node" data-id="' + id + '" style="cursor:pointer"' + lockOpacity + '>';
        s += '<rect x="' + n.x + '" y="' + n.y + '" width="' + NODE_W + '" height="' + NODE_H + '" rx="6" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + ' data-orig-sw="' + sw + '" data-orig-stroke="' + stroke + '"/>';
        s += '<rect x="' + n.x + '" y="' + n.y + '" width="6" height="' + NODE_H + '" rx="3" fill="' + col + '"/>';

        // Code line
        var aliasStr = c.alias.length ? ' (' + c.alias.join(', ') + ')' : '';
        var codeStr = id + aliasStr;
        var codeFontSize = (codeStr.length > 16 ? 11 : (codeStr.length > 12 ? 12 : 14)) * fontScale;
        s += '<text x="' + (n.x + NODE_W / 2 + 2) + '" y="' + (n.y + Math.round(20 * fontScale)) + '" text-anchor="middle" font-size="' + codeFontSize + '" fill="var(--sd-muted)">' + codeStr + '</text>';

        // Name — up to 2 lines
        var maxChars = Math.max(10, Math.floor(NODE_W / (9 * fontScale)));
        var words = c.name.split(' ');
        var line1 = '', line2 = '';
        words.forEach(function (w) {
          if (!line2 && (line1 + ' ' + w).trim().length <= maxChars) line1 = (line1 + ' ' + w).trim();
          else line2 = (line2 + ' ' + w).trim();
        });
        if (line2.length > maxChars) line2 = line2.substring(0, maxChars - 1) + '\u2026';
        var nameFontSize = 13 * fontScale;
        s += '<text x="' + (n.x + NODE_W / 2 + 2) + '" y="' + (n.y + Math.round(40 * fontScale)) + '" text-anchor="middle" font-size="' + nameFontSize + '" font-weight="700" fill="var(--sd-fg)">' + line1 + '</text>';
        if (line2) s += '<text x="' + (n.x + NODE_W / 2 + 2) + '" y="' + (n.y + Math.round(56 * fontScale)) + '" text-anchor="middle" font-size="' + nameFontSize + '" font-weight="700" fill="var(--sd-fg)">' + line2 + '</text>';

        s += '</g>';
      });

      svg.innerHTML = s;

      // Legend — counts are dynamic per selected major (hidden in kindle)
      if (isKindle) {
        legend.innerHTML = '';
      } else {
        var usedCats = {};
        visible.forEach(function (c) { usedCats[c.cat] = true; });
        legend.innerHTML = Object.keys(usedCats).map(function (cat) {
          var m = catMeta[cat] || { label: cat, color: '#888' };
          var catReq = visible.filter(function (c) { return c.cat === cat && requiredSet.has(c.id); }).length;
          var catTaken = visible.filter(function (c) { return c.cat === cat && taken.has(c.id) && requiredSet.has(c.id); }).length;
          var reqStr = catReq > 0 ? ' <span class="sd-legend-req">' + catTaken + '/' + catReq + '</span>' : '';
          var dotColor = m.color;
          return '<span class="sd-legend-item"><span class="sd-legend-dot" style="background:' + dotColor + '"></span>' + m.label + reqStr + '</span>';
        }).join('');
      }

      // Event handlers — mode-dependent

      svg.querySelectorAll('.sd-node').forEach(function (g) {
        var nid = g.dataset.id;
        g.addEventListener('mouseenter', function () {
          if (currentMode === 'deps') { resetEdges(); highlightEdges(nid); }
        });
        g.addEventListener('mouseleave', function () {
          if (currentMode === 'deps') { resetEdges(); }
        });
        g.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (currentMode === 'view') {
            if (activeTooltip === nid) { hideTooltip(); activeTooltip = null; }
            else { activeTooltip = nid; showTooltip(ev, nid, nodes, edges); }
          } else if (currentMode === 'deps') {
            // no details on click in dependency view
          } else if (currentMode === 'taken') {
            if (taken.has(nid)) taken.delete(nid);
            else if (unlockedSet.has(nid)) taken.add(nid);
            else { flashUnmet(nid); return; }
            saveTaken(); render();
          }
        });
      });
    }

    function flashUnmet(id) {
      var c = courses.find(function (x) { return x.id === id; });
      if (!c) return;
      var unmet = c.prereqs.filter(function (p) { return !taken.has(p); });
      var targets = [];
      svg.querySelectorAll('.sd-node').forEach(function (g) {
        if (unmet.indexOf(g.dataset.id) >= 0) targets.push(g);
      });
      if (!targets.length) return;
      var origState = targets.map(function (g) {
        var rect = g.querySelector('rect');
        return { g: g, rect: rect, stroke: rect.getAttribute('stroke'), sw: rect.getAttribute('stroke-width'), opacity: g.getAttribute('opacity') || '' };
      });
      var count = 0;
      function tick() {
        var on = count % 2 === 0;
        origState.forEach(function (o) {
          o.rect.setAttribute('stroke', on ? 'var(--sd-edge-hi)' : o.stroke);
          o.rect.setAttribute('stroke-width', on ? '3.5' : o.sw);
          if (on) o.g.setAttribute('opacity', '1');
          else if (o.opacity) o.g.setAttribute('opacity', o.opacity);
          else o.g.removeAttribute('opacity');
        });
        count++;
        if (count < 6) setTimeout(tick, 200);
      }
      tick();
    }

    function highlightEdges(id) {
      var c = courses.find(function (x) { return x.id === id; });
      var prereqIds = c ? new Set(c.prereqs) : new Set();
      var depIds = new Set();
      courses.forEach(function (x) {
        if (x.prereqs.indexOf(id) >= 0) depIds.add(x.id);
      });
      svg.querySelectorAll('.sd-node').forEach(function (g) {
        var nid = g.dataset.id;
        if (nid === id) return;
        var rect = g.querySelector('rect');
        if (prereqIds.has(nid)) {
          rect.setAttribute('stroke-width', '3');
          rect.setAttribute('stroke', 'var(--sd-edge-hi)');
          g.setAttribute('opacity', '1');
        } else if (depIds.has(nid)) {
          rect.setAttribute('stroke-width', '3');
          rect.setAttribute('stroke', 'var(--sd-dep-hi)');
          g.setAttribute('opacity', '1');
        } else {
          g.setAttribute('opacity', '0.3');
        }
      });
    }
    function resetEdges() {
      svg.querySelectorAll('.sd-node').forEach(function (g) {
        g.removeAttribute('opacity');
        var rect = g.querySelector('rect');
        if (rect) {
          var origSw = rect.getAttribute('data-orig-sw');
          var origStroke = rect.getAttribute('data-orig-stroke');
          if (origSw) rect.setAttribute('stroke-width', origSw);
          if (origStroke) rect.setAttribute('stroke', origStroke);
        }
      });
    }

    function showTooltip(ev, id, nodes, edges) {
      var c = nodes[id] && nodes[id].c;
      if (!c) return;
      var prereqNames = c.prereqs.map(function (p) {
        var pc = courses.find(function (x) { return x.id === p; });
        return pc ? pc.id + ' ' + pc.name : p;
      });
      var depOf = edges.filter(function (e) { return e.from === id; }).map(function (e) {
        var dc = courses.find(function (x) { return x.id === e.to; });
        return dc ? dc.id + ' ' + dc.name : e.to;
      });
      var aliasStr = c.alias.length ? ' [' + c.alias.join(', ') + ']' : '';
      var h = '<b>' + c.id + aliasStr + ' \u2014 ' + c.name + '</b>';
      h += '<div>' + c.desc + '</div>';
      if (c.links && c.links.length) {
        h += '<div class="sd-link-line">';
        h += c.links.map(function (l) {
          return '<a href="' + l.url + '" target="_blank" rel="noopener">' + l.label + '</a>';
        }).join(' \u00b7 ');
        h += '</div>';
      }
      if (c.alts) h += '<div class="prereq-line">Also: ' + c.alts + '</div>';
      if (c.majors.length) h += '<div class="prereq-line">Majors: ' + c.majors.map(function (m) { return majorNames[m] || m; }).join(', ') + '</div>';
      if (prereqNames.length) h += '<div class="prereq-line">\u2190 Prereqs: ' + prereqNames.join(', ') + '</div>';
      if (depOf.length) h += '<div class="prereq-line">\u2192 Unlocks: ' + depOf.join(', ') + '</div>';
      tooltip.innerHTML = h;
      tooltip.style.display = 'block';
      var rect = tooltip.getBoundingClientRect();
      var tx = ev.clientX + 12, ty = ev.clientY + 12;
      if (tx + rect.width > window.innerWidth - 10) tx = ev.clientX - rect.width - 12;
      if (ty + rect.height > window.innerHeight - 10) ty = ev.clientY - rect.height - 12;
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
    }
    function hideTooltip() { tooltip.style.display = 'none'; }

    // Clicking non-link areas of the tooltip dismisses it
    tooltip.addEventListener('click', function (e) {
      if (e.target.tagName !== 'A') { hideTooltip(); activeTooltip = null; }
    });

    /* ── Major description panels ── */
    var majorDescs = root.querySelectorAll('.sd-major-desc');
    function updateMajorDescs() {
      var sel = select.value;
      majorDescs.forEach(function (d) {
        d.style.display = (sel !== 'all' && d.dataset.sdMajor === sel) ? '' : 'none';
      });
    }

    /* ── Controls ── */
    select.addEventListener('change', function () { updateMajorDescs(); render(); });
    clearBtn.addEventListener('click', function () { taken.clear(); saveTaken(); render(); });

    // Click on empty SVG area dismisses tooltip (registered once)
    svg.addEventListener('click', function () { hideTooltip(); activeTooltip = null; });

    updateMajorDescs();
    render();
    var resizeTimer;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 150);
    }
    window.addEventListener('resize', onResize);
    // Re-render when theme panel changes font size/family/theme
    var styleTimer;
    var styleObserver = new MutationObserver(function () {
      clearTimeout(styleTimer);
      styleTimer = setTimeout(render, 100);
    });
    styleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-size', 'data-theme', 'style'] });

    // Disposer: tear down the window/document-level listener + observer
    // this dag mounted, so re-navigating away from (and eventually back
    // to) a syllabus page never accumulates duplicate handlers.
    return function disposeDag() {
      clearTimeout(resizeTimer);
      clearTimeout(styleTimer);
      window.removeEventListener('resize', onResize);
      styleObserver.disconnect();
    };
  }
})();
