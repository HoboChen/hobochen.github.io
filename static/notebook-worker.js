/* Pyodide Web Worker — runs Python in a background thread.
 * Main thread communicates via postMessage.
 * Terminated via worker.terminate() for interrupt. */
'use strict';

self.onmessage = async function (e) {
  var msg = e.data;

  if (msg.type === 'init') {
    try {
      importScripts(msg.pyodideUrl);
      var indexURL = msg.pyodideUrl.substring(0, msg.pyodideUrl.lastIndexOf('/') + 1);
      self.pyodide = await loadPyodide({ indexURL: indexURL });

      var resp = await fetch(msg.pyrunnerUrl);
      var pyCode = await resp.text();
      self.pyodide.runPython(pyCode);

      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init_error', error: String(err) });
    }
    return;
  }

  if (msg.type === 'run') {
    try {
      var py = self.pyodide;
      // Auto-load packages referenced in imports
      await py.loadPackagesFromImports(msg.code);

      // micropip-install pure-Python packages not bundled with Pyodide
      var micropipPkgs = ['plotly', 'ipywidgets'];
      var needed = [];
      for (var i = 0; i < micropipPkgs.length; i++) {
        var re = new RegExp('(?:^|\\n)\\s*(?:import|from)\\s+' + micropipPkgs[i] + '\\b');
        if (re.test(msg.code)) needed.push(micropipPkgs[i]);
      }
      if (needed.length > 0) {
        await py.loadPackage('micropip');
        await py.runPythonAsync(
          'import micropip\nawait micropip.install(' + JSON.stringify(needed) + ')'
        );
      }

      py.globals.set('_kb_code', msg.code);
      var resultJson = await py.runPythonAsync('_kb_run_json(_kb_code)');
      self.postMessage({ type: 'result', data: resultJson });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) });
    }
    return;
  }

  if (msg.type === 'interact_callback') {
    try {
      var py = self.pyodide;
      py.globals.set('_kb_cb_wid', msg.widgetId);
      py.globals.set('_kb_cb_vals', msg.values);
      var resultJson = await py.runPythonAsync('_kb_interact_callback(_kb_cb_wid, _kb_cb_vals)');
      self.postMessage({ type: 'callback_result', callbackId: msg.callbackId, data: resultJson });
    } catch (err) {
      self.postMessage({ type: 'callback_error', callbackId: msg.callbackId, error: String(err) });
    }
    return;
  }

  if (msg.type === 'display_callback') {
    try {
      var py = self.pyodide;
      py.globals.set('_kb_cb_wid', msg.widgetId);
      py.globals.set('_kb_cb_vals', msg.values);
      var resultJson = await py.runPythonAsync('_kb_display_callback(_kb_cb_wid, _kb_cb_vals)');
      self.postMessage({ type: 'callback_result', callbackId: msg.callbackId, data: resultJson });
    } catch (err) {
      self.postMessage({ type: 'callback_error', callbackId: msg.callbackId, error: String(err) });
    }
    return;
  }
};
