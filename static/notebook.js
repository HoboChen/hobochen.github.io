(function () {
  'use strict';

  // CDN versions
  var PYODIDE_VERSION = '0.26.4';
  var PLOTLY_VERSION = '2.35.2';

  // Shared state (persists across SPA navigations)
  var worker = null;
  var workerLoading = null;
  var workerReady = false;
  var pendingRun = null;
  var pendingCallbacks = {};
  var callbackIdCounter = 0;
  var execCounter = 0;
  var plotlyIdCounter = 0;
  var plotlyLoading = null;
  var PLOTLY_CDN = 'https://cdn.plot.ly/plotly-' + PLOTLY_VERSION + '.min.js';

  var PLOTLY_DARK = { plot_bgcolor: '#1e1e1e', paper_bgcolor: '#1e1e1e', font: { color: '#ccc' },
    xaxis: { gridcolor: '#444', zerolinecolor: '#666' }, yaxis: { gridcolor: '#444', zerolinecolor: '#666' } };
  var PLOTLY_LIGHT = { plot_bgcolor: '#fff', paper_bgcolor: '#fff', font: { color: '#333' },
    xaxis: { gridcolor: '#eee', zerolinecolor: '#ccc' }, yaxis: { gridcolor: '#eee', zerolinecolor: '#ccc' } };

  var CELL_TIMEOUT_MS = 30000;

  // Track initialized containers to avoid double-init
  var initializedContainers = new WeakSet();

  // Tracks each currently-initialized container's teardown (its
  // document-level theme MutationObserver). initNotebookCells() disposes
  // any tracked container that's no longer attached to the document (the
  // SPA swapped in new content) before scanning for fresh containers, so
  // repeated SPA visits to notebook pages never accumulate observers.
  var trackedContainers = [];
  var containerDisposers = new WeakMap();

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Worker message handler for run results and widget callbacks
  function handleWorkerMessage(msg) {
    if (msg.type === 'result') {
      if (pendingRun) {
        pendingRun.resolve(JSON.parse(msg.data));
        pendingRun = null;
      }
    } else if (msg.type === 'error') {
      if (pendingRun) {
        pendingRun.reject(new Error(msg.error));
        pendingRun = null;
      }
    } else if (msg.type === 'callback_result') {
      var cb = pendingCallbacks[msg.callbackId];
      if (cb) {
        cb.resolve(msg.data);
        delete pendingCallbacks[msg.callbackId];
      }
    } else if (msg.type === 'callback_error') {
      var cb = pendingCallbacks[msg.callbackId];
      if (cb) {
        cb.reject(new Error(msg.error));
        delete pendingCallbacks[msg.callbackId];
      }
    }
  }

  // Lazy-load Pyodide Worker on first run
  function ensureWorker(statusEl) {
    if (workerReady) return Promise.resolve();
    if (workerLoading) return workerLoading;

    setStatus(statusEl, 'loading');
    if (window._log) _log.info('notebook', 'Starting Pyodide Worker v' + PYODIDE_VERSION);

    worker = new Worker('/static/notebook-worker.js');

    workerLoading = new Promise(function (resolve, reject) {
      worker.onmessage = function (e) {
        var msg = e.data;
        if (msg.type === 'ready') {
          workerReady = true;
          if (window._log) _log.info('notebook', 'Worker ready');
          setStatus(statusEl, 'ready');
          resolve();
        } else if (msg.type === 'init_error') {
          if (window._log) _log.error('notebook', 'Worker init failed', msg.error);
          reject(new Error(msg.error));
        } else {
          handleWorkerMessage(msg);
        }
      };
      worker.onerror = function (e) {
        if (window._log) _log.error('notebook', 'Worker error', e.message);
        reject(new Error('Worker failed'));
      };

      worker.postMessage({
        type: 'init',
        pyodideUrl: 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/pyodide.js',
        pyrunnerUrl: '/static/notebook-pyrunner.py'
      });
    });

    return workerLoading;
  }

  function terminateWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    workerReady = false;
    workerLoading = null;
    if (pendingRun) {
      pendingRun.reject(new Error('Execution interrupted'));
      pendingRun = null;
    }
    var ids = Object.keys(pendingCallbacks);
    for (var i = 0; i < ids.length; i++) {
      pendingCallbacks[ids[i]].reject(new Error('Execution interrupted'));
    }
    pendingCallbacks = {};
  }

  function ensurePlotly() {
    if (typeof Plotly !== 'undefined') return Promise.resolve();
    if (plotlyLoading) return plotlyLoading;
    plotlyLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PLOTLY_CDN;
      s.onload = resolve;
      s.onerror = function () {
        if (window._log) _log.error('notebook', 'Failed to load Plotly CDN');
        reject(new Error('Failed to load Plotly'));
      };
      document.head.appendChild(s);
    });
    return plotlyLoading;
  }

  var STATUS_TITLES = { idle: 'Runtime not loaded', loading: 'Loading runtime…', ready: 'Ready', running: 'Running…' };
  function setStatus(dotEl, type) {
    if (!dotEl) return;
    dotEl.className = 'nb-status-dot ' + (type || 'idle');
    dotEl.title = STATUS_TITLES[type] || '';
  }

  // ---- Rich MIME output rendering ----

  function renderRichMimeItem(item) {
    if (item.html) return '<div class="nb-html">' + item.html + '</div>';
    if (item.svg) return '<div class="nb-svg">' + item.svg + '</div>';
    if (item.latex) return '<div class="nb-latex">' + escapeHtml(item.latex) + '</div>';
    if (item.markdown) return '<div class="nb-md-output">' + escapeHtml(item.markdown) + '</div>';
    if (item.png) return '<img class="nb-img" src="data:image/png;base64,' + item.png + '">';
    return '';
  }

  // ---- ipywidgets rendering ----

  function renderInteractOutput(outputArea, res) {
    var html = '';
    if (res.stdout) html += '<pre class="nb-stream nb-stdout">' + escapeHtml(res.stdout) + '</pre>';
    if (res.stderr) html += '<pre class="nb-stream nb-stderr">' + escapeHtml(res.stderr) + '</pre>';
    if (res.error) html += '<pre class="nb-error">' + escapeHtml(res.error) + '</pre>';
    if (res.figures) {
      var figs = Array.isArray(res.figures) ? res.figures : Array.from(res.figures);
      for (var i = 0; i < figs.length; i++) {
        html += '<img class="nb-img" src="data:image/png;base64,' + figs[i] + '">';
      }
    }
    // Rich MIME result (html, svg, latex) takes priority over plain text
    if (!res.error && (res.html || res.svg || res.latex)) {
      html += renderRichMimeItem(res);
    } else if (res.result && !res.error) {
      html += '<pre class="nb-text">' + escapeHtml(res.result) + '</pre>';
    }
    var wPlotlyFigs = [];
    if (res.plotly) {
      var pArr = Array.isArray(res.plotly) ? res.plotly : Array.from(res.plotly);
      for (var i = 0; i < pArr.length; i++) {
        html += '<div class="nb-plotly" id="nb-plotly-' + plotlyIdCounter + '"></div>';
        wPlotlyFigs.push({ id: 'nb-plotly-' + plotlyIdCounter, json: pArr[i] });
        plotlyIdCounter++;
      }
    }
    outputArea.innerHTML = html;
    if (wPlotlyFigs.length > 0) {
      return ensurePlotly().then(function () {
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        var plots = wPlotlyFigs.map(function (pf) {
          var fig = JSON.parse(pf.json);
          if (isDark) fig.layout = Object.assign(fig.layout || {}, PLOTLY_DARK);
          return Plotly.newPlot(pf.id, fig.data, fig.layout, { responsive: true });
        });
        return Promise.all(plots);
      });
    }
    return Promise.resolve();
  }

  function renderControl(ctrl, widgetId) {
    var row = document.createElement('div');
    row.className = 'nb-widget-row';
    var label = document.createElement('label');
    label.className = 'nb-widget-label';
    label.textContent = ctrl.description || ctrl.name;
    row.appendChild(label);
    var inputWrap = document.createElement('div');
    inputWrap.className = 'nb-widget-input';

    switch (ctrl.widget) {
      case 'IntSlider': case 'FloatSlider':
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = ctrl.min; slider.max = ctrl.max; slider.step = ctrl.step;
        slider.value = ctrl.value;
        slider.dataset.name = ctrl.name; slider.dataset.type = ctrl.widget;
        var valDisp = document.createElement('span');
        valDisp.className = 'nb-widget-value';
        valDisp.textContent = ctrl.value;
        slider.addEventListener('input', function () { valDisp.textContent = this.value; });
        inputWrap.appendChild(slider); inputWrap.appendChild(valDisp);
        break;
      case 'Checkbox':
        var cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = ctrl.value;
        cb.dataset.name = ctrl.name; cb.dataset.type = ctrl.widget;
        inputWrap.appendChild(cb);
        break;
      case 'Text':
        var txt = document.createElement('input');
        txt.type = 'text'; txt.value = ctrl.value || '';
        txt.dataset.name = ctrl.name; txt.dataset.type = ctrl.widget;
        inputWrap.appendChild(txt);
        break;
      case 'Textarea':
        var ta = document.createElement('textarea');
        ta.value = ctrl.value || '';
        ta.dataset.name = ctrl.name; ta.dataset.type = ctrl.widget;
        inputWrap.appendChild(ta);
        break;
      case 'Dropdown': case 'Select':
        var sel = document.createElement('select');
        sel.dataset.name = ctrl.name; sel.dataset.type = ctrl.widget;
        sel.dataset.indexed = ctrl.indexed ? '1' : '';
        for (var i = 0; i < ctrl.options.length; i++) {
          var opt = document.createElement('option');
          opt.value = ctrl.indexed ? i : ctrl.options[i];
          opt.textContent = ctrl.options[i];
          if (ctrl.indexed ? i === ctrl.value : ctrl.options[i] === ctrl.value) opt.selected = true;
          sel.appendChild(opt);
        }
        inputWrap.appendChild(sel);
        break;
      case 'RadioButtons':
        var rname = 'nb-radio-' + widgetId + '-' + ctrl.name;
        for (var i = 0; i < ctrl.options.length; i++) {
          var rl = document.createElement('label');
          rl.className = 'nb-widget-radio-label';
          var rb = document.createElement('input');
          rb.type = 'radio'; rb.name = rname;
          rb.value = ctrl.indexed ? i : ctrl.options[i];
          rb.dataset.name = ctrl.name; rb.dataset.type = ctrl.widget;
          rb.dataset.indexed = ctrl.indexed ? '1' : '';
          if (ctrl.indexed ? i === ctrl.value : ctrl.options[i] === ctrl.value) rb.checked = true;
          rl.appendChild(rb);
          rl.appendChild(document.createTextNode(' ' + ctrl.options[i]));
          inputWrap.appendChild(rl);
        }
        break;
      case 'ToggleButtons':
        var tg = document.createElement('div');
        tg.className = 'nb-widget-toggle-group';
        tg.dataset.name = ctrl.name; tg.dataset.type = ctrl.widget;
        tg.dataset.indexed = ctrl.indexed ? '1' : '';
        for (var i = 0; i < ctrl.options.length; i++) {
          var tb = document.createElement('button');
          tb.type = 'button'; tb.className = 'nb-widget-toggle-btn';
          tb.textContent = ctrl.options[i];
          tb.dataset.value = ctrl.indexed ? i : ctrl.options[i];
          if (ctrl.indexed ? i === ctrl.value : ctrl.options[i] === ctrl.value) tb.classList.add('active');
          tb.addEventListener('click', function () {
            this.parentNode.querySelectorAll('.nb-widget-toggle-btn').forEach(function (b) { b.classList.remove('active'); });
            this.classList.add('active');
            this.parentNode.dispatchEvent(new Event('change', { bubbles: true }));
          });
          tg.appendChild(tb);
        }
        inputWrap.appendChild(tg);
        break;
      case 'IntText': case 'FloatText': case 'BoundedIntText': case 'BoundedFloatText':
        var ni = document.createElement('input');
        ni.type = 'number'; ni.value = ctrl.value;
        ni.dataset.name = ctrl.name; ni.dataset.type = ctrl.widget;
        if (ctrl.min !== undefined) ni.min = ctrl.min;
        if (ctrl.max !== undefined) ni.max = ctrl.max;
        if (ctrl.step !== undefined) ni.step = ctrl.step;
        inputWrap.appendChild(ni);
        break;
      case 'ColorPicker':
        var ci = document.createElement('input');
        ci.type = 'color'; ci.value = ctrl.value || '#000000';
        ci.dataset.name = ctrl.name; ci.dataset.type = ctrl.widget;
        inputWrap.appendChild(ci);
        break;
      default:
        var fb = document.createElement('span');
        fb.className = 'nb-widget-unsupported';
        fb.textContent = '[' + ctrl.widget + ']';
        inputWrap.appendChild(fb);
    }
    row.appendChild(inputWrap);
    return row;
  }

  function collectWidgetValues(controlsEl, controls) {
    var values = {};
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i], name = c.name;
      var el = controlsEl.querySelector('[data-name="' + name + '"]');
      if (!el) continue;
      switch (c.widget) {
        case 'IntSlider': case 'IntText': case 'BoundedIntText':
          values[name] = parseInt(el.value, 10); break;
        case 'FloatSlider': case 'FloatText': case 'BoundedFloatText':
          values[name] = parseFloat(el.value); break;
        case 'Checkbox':
          values[name] = el.checked; break;
        case 'RadioButtons':
          var ck = controlsEl.querySelector('[data-name="' + name + '"]:checked');
          if (ck) values[name] = ck.dataset.indexed === '1' ? parseInt(ck.value, 10) : ck.value;
          break;
        case 'ToggleButtons':
          var ac = el.querySelector('.nb-widget-toggle-btn.active');
          if (ac) values[name] = el.dataset.indexed === '1' ? parseInt(ac.dataset.value, 10) : ac.dataset.value;
          break;
        case 'Dropdown': case 'Select':
          values[name] = el.dataset.indexed === '1' ? parseInt(el.value, 10) : el.value; break;
        default:
          values[name] = el.value;
      }
    }
    return values;
  }

  function updateInteractWidget(widgetId, controlsEl, outputArea, controls, seqObj) {
    var values = collectWidgetValues(controlsEl, controls);
    var seq = ++seqObj.seq;
    outputArea.style.minHeight = outputArea.offsetHeight + 'px';
    outputArea.innerHTML = '<div class="nb-running">Updating…</div>';
    var cbId = ++callbackIdCounter;
    new Promise(function (resolve, reject) {
      pendingCallbacks[cbId] = { resolve: resolve, reject: reject };
      worker.postMessage({ type: 'interact_callback', callbackId: cbId, widgetId: widgetId, values: JSON.stringify(values) });
    }).then(function (resultJson) {
      if (seq !== seqObj.seq) return;
      var res = JSON.parse(resultJson);
      renderInteractOutput(outputArea, res).then(function () {
        outputArea.style.minHeight = '';
      });
    }).catch(function (e) {
      if (seq !== seqObj.seq) return;
      outputArea.innerHTML = '<pre class="nb-error">' + escapeHtml(String(e)) + '</pre>';
      outputArea.style.minHeight = '';
    });
  }

  function renderInteractWidget(w, outputEl) {
    var container = document.createElement('div');
    container.className = 'nb-widget-interact';
    container.dataset.widgetId = w.id;
    var controlsEl = document.createElement('div');
    controlsEl.className = 'nb-widget-controls';
    for (var i = 0; i < w.controls.length; i++) {
      controlsEl.appendChild(renderControl(w.controls[i], w.id));
    }
    var outputArea = document.createElement('div');
    outputArea.className = 'nb-widget-output';
    renderInteractOutput(outputArea, w.initial_output);
    container.appendChild(controlsEl);
    container.appendChild(outputArea);
    outputEl.appendChild(container);

    // Debounced input (sliders), immediate change (dropdowns, checkboxes)
    var debounceTimer = null;
    var seqObj = { seq: 0 };
    controlsEl.addEventListener('input', function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        updateInteractWidget(w.id, controlsEl, outputArea, w.controls, seqObj);
      }, 150);
    });
    controlsEl.addEventListener('change', function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      updateInteractWidget(w.id, controlsEl, outputArea, w.controls, seqObj);
    });
  }

  function renderWidgetTree(tree, widgetId) {
    if (tree.layout === 'HBox' || tree.layout === 'VBox' || tree.layout === 'Box') {
      var box = document.createElement('div');
      box.className = 'nb-widget-' + tree.layout.toLowerCase();
      for (var i = 0; i < tree.children.length; i++) {
        box.appendChild(renderWidgetTree(tree.children[i], widgetId));
      }
      return box;
    }
    if (tree.layout === 'Output') {
      var out = document.createElement('div');
      out.className = 'nb-widget-output';
      return out;
    }
    // Leaf control
    return renderControl(tree, widgetId);
  }

  function renderDisplayWidget(w, outputEl) {
    var container = document.createElement('div');
    container.className = 'nb-widget-display';
    container.dataset.widgetId = w.id;

    // Render widget tree(s) preserving HBox/VBox layout
    var controlsEl = document.createElement('div');
    controlsEl.className = 'nb-widget-controls';
    for (var i = 0; i < w.trees.length; i++) {
      controlsEl.appendChild(renderWidgetTree(w.trees[i], w.id));
    }
    container.appendChild(controlsEl);

    // Output area (for Output widget content)
    var outputArea = document.createElement('div');
    outputArea.className = 'nb-widget-output';
    if (w.has_output) {
      renderInteractOutput(outputArea, w.initial_output);
    }
    container.appendChild(outputArea);
    outputEl.appendChild(container);

    // Wire up change events → call Python observe callbacks
    var debounceTimer = null;
    var seqObj = { seq: 0 };
    function onUpdate() {
      var values = collectWidgetValues(controlsEl, w.controls);
      var seq = ++seqObj.seq;
      outputArea.style.minHeight = outputArea.offsetHeight + 'px';
      outputArea.innerHTML = '<div class="nb-running">Updating…</div>';
      var cbId = ++callbackIdCounter;
      new Promise(function (resolve, reject) {
        pendingCallbacks[cbId] = { resolve: resolve, reject: reject };
        worker.postMessage({ type: 'display_callback', callbackId: cbId, widgetId: w.id, values: JSON.stringify(values) });
      }).then(function (resultJson) {
        if (seq !== seqObj.seq) return;
        var res = JSON.parse(resultJson);
        renderInteractOutput(outputArea, res).then(function () {
          outputArea.style.minHeight = '';
        });
      }).catch(function (e) {
        if (seq !== seqObj.seq) return;
        outputArea.innerHTML = '<pre class="nb-error">' + escapeHtml(String(e)) + '</pre>';
        outputArea.style.minHeight = '';
      });
    }
    controlsEl.addEventListener('input', function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onUpdate, 150);
    });
    controlsEl.addEventListener('change', function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      onUpdate();
    });
  }

  // Toggle a JupyterLab-style collapser bar's fold state.
  // Each collapser sits next to the section it controls and toggles a
  // `*-hidden` class on the relevant ancestor.
  function toggleCollapser(collapser) {
    if (collapser.classList.contains('nb-input-collapser')) {
      var input = collapser.closest('.nb-input');
      if (input) input.classList.toggle('nb-input-hidden');
    } else if (collapser.classList.contains('nb-output-collapser')) {
      var output = collapser.closest('.nb-output');
      if (output) output.classList.toggle('nb-output-hidden');
    } else if (collapser.classList.contains('nb-md-collapser')) {
      var md = collapser.closest('.nb-md-cell');
      if (md) md.classList.toggle('nb-md-hidden');
    }
  }

  // Ensure the cell's .nb-output has the collapser + content wrapper.
  // Auto-clears the nb-output-hidden fold so newly produced output is visible.
  // Returns the .nb-output-content element to write into.
  function ensureOutputArea(cell) {
    var outputEl = cell.querySelector('.nb-output');
    if (!outputEl) return null;
    // New output → always reveal it
    outputEl.classList.remove('nb-output-hidden');
    var content = outputEl.querySelector('.nb-output-content');
    if (!content) {
      // Either an initially empty output, or it was wiped by handleReset.
      // Rebuild the wrapper: <collapser> + <content>.
      outputEl.innerHTML = '';
      var collapser = document.createElement('div');
      collapser.className = 'nb-collapser nb-output-collapser';
      collapser.setAttribute('role', 'button');
      collapser.setAttribute('tabindex', '0');
      collapser.setAttribute('aria-label', 'Toggle output');
      collapser.setAttribute('title', 'Toggle output');
      outputEl.appendChild(collapser);
      content = document.createElement('div');
      content.className = 'nb-output-content';
      outputEl.appendChild(content);
    }
    return content;
  }

  function runCell(cell, container) {
    var statusEl = container.querySelector('.nb-status-dot');
    var cm = cell._cm;
    var outputContent = ensureOutputArea(cell);
    var runBtn = cell.querySelector('.nb-run-btn');
    var promptEl = cell.querySelector('.nb-prompt');
    var code = cm ? cm.getValue() : cell.querySelector('.nb-source').value;

    if (!code.trim()) return Promise.resolve();

    var cellStart = Date.now();
    cell._running = true;
    runBtn.disabled = false;
    runBtn.textContent = '■';
    runBtn.classList.add('nb-stopping');
    if (promptEl) promptEl.textContent = '[*]:';
    outputContent.innerHTML = '<div class="nb-running">Running…</div>';

    setStatus(statusEl, 'running');

    // Timeout warning for runaway cells
    var timeoutId = setTimeout(function () {
      var warn = cell.querySelector('.nb-timeout-warning');
      if (!warn) {
        warn = document.createElement('div');
        warn.className = 'nb-timeout-warning';
        warn.innerHTML = 'Cell is taking too long. ' +
          '<button class="nb-timeout-reset">Stop</button>';
        warn.querySelector('.nb-timeout-reset').addEventListener('click', function () {
          handleStop(container);
        });
        var oc = ensureOutputArea(cell);
        oc.appendChild(warn);
      }
    }, CELL_TIMEOUT_MS);

    return ensureWorker(statusEl).then(function () {
      return new Promise(function (resolve, reject) {
        pendingRun = { resolve: resolve, reject: reject };
        worker.postMessage({ type: 'run', code: code });
      });
    }).then(function (res) {

      execCounter++;
      if (promptEl) promptEl.textContent = '[' + execCounter + ']:';

      var html = '';
      if (res.stdout) html += '<pre class="nb-stream nb-stdout">' + escapeHtml(res.stdout) + '</pre>';
      if (res.stderr) html += '<pre class="nb-stream nb-stderr">' + escapeHtml(res.stderr) + '</pre>';
      if (res.error) html += '<pre class="nb-error">' + escapeHtml(res.error) + '</pre>';

      // Render display() outputs (non-widget rich MIME objects)
      if (res.display_outputs) {
        var douts = Array.isArray(res.display_outputs) ? res.display_outputs : Array.from(res.display_outputs);
        for (var di = 0; di < douts.length; di++) {
          html += renderRichMimeItem(douts[di]);
        }
      }

      if (res.figures) {
        var figs = Array.isArray(res.figures) ? res.figures : Array.from(res.figures);
        for (var i = 0; i < figs.length; i++) {
          html += '<img class="nb-img" src="data:image/png;base64,' + figs[i] + '">';
        }
      }
      // Rich MIME result (html, svg, latex) takes priority over plain text
      if (!res.error && (res.html || res.svg || res.latex)) {
        html += renderRichMimeItem(res);
      } else if (res.result && !res.error) {
        html += '<pre class="nb-text">' + escapeHtml(res.result) + '</pre>';
      }

      // Collect plotly figures to render after DOM update
      var plotlyFigs = [];
      if (res.plotly) {
        var pArr = Array.isArray(res.plotly) ? res.plotly : Array.from(res.plotly);
        for (var i = 0; i < pArr.length; i++) {
          html += '<div class="nb-plotly" id="nb-plotly-' + plotlyIdCounter + '"></div>';
          plotlyFigs.push({ id: 'nb-plotly-' + plotlyIdCounter, json: pArr[i] });
          plotlyIdCounter++;
        }
      }

      // Re-derive in case prior call paths replaced DOM (defensive)
      outputContent = ensureOutputArea(cell);
      outputContent.innerHTML = html;

      // Render interactive widgets
      if (res.widgets) {
        var widgetsArr = Array.isArray(res.widgets) ? res.widgets : [];
        for (var wi = 0; wi < widgetsArr.length; wi++) {
          var w = widgetsArr[wi];
          if (w.type === 'display') {
            renderDisplayWidget(w, outputContent);
          } else {
            renderInteractWidget(w, outputContent);
          }
        }
      }

      // Render plotly figures using Plotly.newPlot()
      if (plotlyFigs.length > 0) {
        return ensurePlotly().then(function () {
          var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
          plotlyFigs.forEach(function (pf) {
            var fig = JSON.parse(pf.json);
            if (isDark) {
              fig.layout = Object.assign(fig.layout || {}, PLOTLY_DARK);
            }
            Plotly.newPlot(pf.id, fig.data, fig.layout, { responsive: true });
          });
        });
      }
    }).catch(function (e) {
      if (window._log) _log.error('notebook', 'Cell execution error', String(e));
      var errContent = ensureOutputArea(cell);
      errContent.innerHTML = '<pre class="nb-error">' + escapeHtml(String(e)) + '</pre>';
      if (promptEl) promptEl.textContent = '[!]:';
    }).finally(function () {
      clearTimeout(timeoutId);
      var warn = cell.querySelector('.nb-timeout-warning');
      if (warn) warn.remove();
      if (window._log) _log.info('notebook', 'Cell executed in ' + (Date.now() - cellStart) + 'ms');
      cell._running = false;
      runBtn.classList.remove('nb-stopping');
      runBtn.disabled = false;
      runBtn.textContent = '▶';
      if (workerReady) setStatus(statusEl, 'ready');
    });
  }

  function handleRunAll(container) {
    var cells = container.querySelectorAll('.nb-code-cell');
    var chain = Promise.resolve();
    cells.forEach(function (cell) {
      chain = chain.then(function () { return runCell(cell, container); });
    });
    return chain;
  }

  function handleReset(container) {
    terminateWorker();
    execCounter = 0;
    var statusEl = container.querySelector('.nb-status-dot');
    setStatus(statusEl, 'idle');
    container.querySelectorAll('.nb-output').forEach(function (el) { el.innerHTML = ''; });
    container.querySelectorAll('.nb-prompt').forEach(function (el) { el.textContent = '[ ]:'; });
  }

  function handleStop(container) {
    terminateWorker();
    var statusEl = container.querySelector('.nb-status-dot');
    setStatus(statusEl, 'idle');
  }

  function toggleLineNumbers(container) {
    var btn = container.querySelector('.nb-line-numbers');
    var isOn = btn && btn.classList.toggle('active');
    container.querySelectorAll('.nb-code-cell').forEach(function (cell) {
      if (cell._cm) cell._cm.setOption('lineNumbers', isOn);
    });
  }

  function syncPlotlyTheme(container, isDark) {
    if (typeof Plotly === 'undefined') return;
    var layout = isDark ? PLOTLY_DARK : PLOTLY_LIGHT;
    container.querySelectorAll('.nb-plotly .plotly-graph-div').forEach(function (el) {
      Plotly.relayout(el, layout);
    });
  }

  function initContainer(container) {
    if (initializedContainers.has(container)) return undefined;
    initializedContainers.add(container);

    // Sync status dot with runtime state (persists across SPA navigations)
    var dot = container.querySelector('.nb-status-dot');
    if (workerReady) setStatus(dot, 'ready');
    else if (workerLoading) setStatus(dot, 'loading');

    // Click handlers
    container.addEventListener('click', function (e) {
      var collapser = e.target.closest('.nb-collapser');
      if (collapser && container.contains(collapser)) {
        toggleCollapser(collapser);
        return;
      }
      var runBtn = e.target.closest('.nb-run-btn');
      if (runBtn) {
        var cell = runBtn.closest('.nb-code-cell');
        if (cell) {
          if (cell._running) {
            handleStop(container);
          } else {
            runCell(cell, container);
          }
        }
        return;
      }
      if (e.target.closest('.nb-run-all')) {
        handleRunAll(container);
        return;
      }
      if (e.target.closest('.nb-reset')) {
        handleReset(container);
        return;
      }
      if (e.target.closest('.nb-stop')) {
        handleStop(container);
        return;
      }
      if (e.target.closest('.nb-line-numbers')) {
        toggleLineNumbers(container);
        return;
      }
    });

    // Keyboard activation for collapsers (Enter / Space)
    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var collapser = e.target.closest && e.target.closest('.nb-collapser');
      if (!collapser || !container.contains(collapser)) return;
      e.preventDefault();
      toggleCollapser(collapser);
    });

    // Initialize CodeMirror on all code cells
    container.querySelectorAll('.nb-code-cell').forEach(function (cell) {
      if (cell._cm) return; // Already initialized
      var textarea = cell.querySelector('.nb-source');
      if (!textarea || typeof CodeMirror === 'undefined') return;

      var cm = CodeMirror.fromTextArea(textarea, {
        mode: 'python',
        theme: 'default',
        lineNumbers: false,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        electricChars: true,
        matchBrackets: true,
        viewportMargin: Infinity,
        extraKeys: {
          'Shift-Enter': function () { runCell(cell, container); },
          'Tab': function (cm) {
            if (cm.somethingSelected()) {
              cm.indentSelection('add');
            } else {
              cm.replaceSelection('    ', 'end');
            }
          }
        }
      });
      cell._cm = cm;
    });

    // Theme sync for this container
    function syncTheme() {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      container.querySelectorAll('.nb-code-cell').forEach(function (cell) {
        if (cell._cm) cell._cm.setOption('theme', isDark ? 'default' : 'default');
      });
      syncPlotlyTheme(container, isDark);
    }
    var observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Disposer: disconnect this container's document-level theme observer
    // so navigating away from (and eventually back to) notebook pages
    // never accumulates duplicate observers on document.documentElement.
    return function disposeContainer() {
      observer.disconnect();
    };
  }

  // Main initialization function — finds and initializes all notebook containers
  function initNotebookCells() {
    trackedContainers = trackedContainers.filter(function (el) {
      if (el.isConnected) return true;
      var dispose = containerDisposers.get(el);
      if (dispose) dispose();
      containerDisposers.delete(el);
      return false;
    });

    var containers = document.querySelectorAll('.nb-container');
    if (window._log && containers.length > 0) _log.info('notebook', 'Initializing ' + containers.length + ' notebook container(s)');
    containers.forEach(function (container) {
      var dispose = initContainer(container);
      if (typeof dispose === 'function') {
        containerDisposers.set(container, dispose);
        trackedContainers.push(container);
      }
    });

    return function disposeAllTracked() {
      trackedContainers.forEach(function (el) {
        var dispose = containerDisposers.get(el);
        if (dispose) dispose();
        containerDisposers.delete(el);
      });
      trackedContainers = [];
    };
  }

  // Export for SPA mode
  window.initNotebookCells = initNotebookCells;

  // Initialize on load
  initNotebookCells();
})();
