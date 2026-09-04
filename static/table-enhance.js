// ===== Table Sort, Filter & Selection =====
// Enhances all <table> elements inside .article with column-level
// sort, condition filter (equals/not-equal/contains/not-contain with regex),
// and checkbox-based value selection.

document.addEventListener('DOMContentLoaded', function() {
  var activeDD = null;

  function closeDD() {
    if (activeDD) { activeDD.el.remove(); activeDD = null; }
  }

  document.addEventListener('click', function(e) {
    if (activeDD && !activeDD.el.contains(e.target)) closeDD();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeDD();
  });
  window.addEventListener('scroll', closeDD, { passive: true });

  function initTableEnhance(root) {
  var tables = (root || document).querySelectorAll('.article table, table');
  var count = 0;
  tables.forEach(function(table) {
    if (!table.closest('.article')) return;
    if (table.closest('.syllabus-dag')) return;
    if (table.dataset.teEnhanced) return;
    count++;
    table.dataset.teEnhanced = '1';
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    var ths = Array.from(thead.querySelectorAll('th'));
    if (!ths.length) return;
    var origRows = Array.from(tbody.rows);
    var sortCol = -1, sortDir = 0;
    // selection[ci] = Set of checked values (null = all selected)
    var selection = {};
    // condFilters[ci] = { mode: 'eq'|'neq'|'contains'|'notcontains', value: string }
    var condFilters = {};

    var wrap = table.closest('.table-wrap');
    if (wrap) wrap.addEventListener('scroll', closeDD, { passive: true });

    ths.forEach(function(th, ci) {
      th.classList.add('th-enhanced');

      var ind = document.createElement('span');
      ind.className = 'th-sort-ind';
      th.appendChild(ind);

      var trig = document.createElement('span');
      trig.className = 'th-trigger';
      trig.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v2H1zM3 7h10v2H3zM6 12h4v2H6z"/></svg>';
      th.appendChild(trig);

      th.addEventListener('click', function(e) {
        e.stopPropagation();
        if (activeDD && activeDD.th === th) { closeDD(); return; }
        closeDD();
        showDD(th, ci);
      });
    });

    function colValues(ci) {
      var seen = {}, vals = [];
      origRows.forEach(function(row) {
        var t = cellText(row, ci);
        if (!seen[t]) { seen[t] = true; vals.push(t); }
      });
      vals.sort(function(a, b) {
        var an = parseNum(a), bn = parseNum(b);
        if (an !== null && bn !== null) return an - bn;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });
      return vals;
    }

    function mkLabel(text) {
      var lbl = document.createElement('div');
      lbl.className = 'th-dd-label';
      lbl.textContent = text;
      return lbl;
    }

    function showDD(th, ci) {
      var dd = document.createElement('div');
      dd.className = 'th-dropdown';

      // === Sort section ===
      dd.appendChild(mkLabel('Sort'));
      var sortDiv = document.createElement('div');
      sortDiv.className = 'th-dd-sort';
      [{l: '\u2191 Asc', d: 1}, {l: '\u2193 Desc', d: -1}].forEach(function(o) {
        var btn = document.createElement('button');
        btn.className = 'th-dd-btn' + (sortCol === ci && sortDir === o.d ? ' active' : '');
        btn.textContent = o.l;
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          if (sortCol === ci && sortDir === o.d) { sortCol = -1; sortDir = 0; }
          else { sortCol = ci; sortDir = o.d; }
          applyState();
          closeDD();
        });
        sortDiv.appendChild(btn);
      });
      dd.appendChild(sortDiv);

      // === Filter section (condition) ===
      dd.appendChild(document.createElement('div')).className = 'th-dd-sep';
      dd.appendChild(mkLabel('Filter'));

      var cf = condFilters[ci] || { mode: '', value: '' };
      var modes = [
        { key: 'eq', label: 'Equals' },
        { key: 'neq', label: 'Not Equal' },
        { key: 'contains', label: 'Contains (.*)' },
        { key: 'notcontains', label: 'Not Contain (.*)' }
      ];

      var modeSelect = document.createElement('select');
      modeSelect.className = 'th-dd-select';
      var noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'None';
      modeSelect.appendChild(noneOpt);
      modes.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.key;
        opt.textContent = m.label;
        if (cf.mode === m.key) opt.selected = true;
        modeSelect.appendChild(opt);
      });
      dd.appendChild(modeSelect);

      var condInp = document.createElement('input');
      condInp.type = 'text';
      condInp.className = 'th-dd-input';
      condInp.placeholder = 'Value\u2026';
      condInp.value = cf.value || '';
      condInp.style.display = cf.mode ? '' : 'none';
      condInp.addEventListener('click', function(e) { e.stopPropagation(); });
      condInp.addEventListener('keydown', function(e) {
        e.stopPropagation();
        if (e.key === 'Escape') closeDD();
      });

      var condErr = document.createElement('div');
      condErr.className = 'th-dd-err';
      condErr.style.display = 'none';

      function commitCond() {
        var mode = modeSelect.value;
        var val = condInp.value.trim();
        condErr.style.display = 'none';
        if (!mode || !val) {
          delete condFilters[ci];
        } else {
          if (mode === 'contains' || mode === 'notcontains') {
            try { new RegExp(val, 'i'); } catch(e) {
              if (window._log) _log.error('table', 'Invalid regex filter: ' + val, String(e));
              condErr.textContent = 'Invalid regex';
              condErr.style.display = '';
              return;
            }
          }
          condFilters[ci] = { mode: mode, value: val };
        }
        applyState();
      }

      modeSelect.addEventListener('change', function(e) {
        e.stopPropagation();
        condInp.style.display = modeSelect.value ? '' : 'none';
        if (!modeSelect.value) { condInp.value = ''; }
        commitCond();
      });
      condInp.addEventListener('input', commitCond);

      dd.appendChild(condInp);
      dd.appendChild(condErr);

      // === Selection section (checkbox list) ===
      dd.appendChild(document.createElement('div')).className = 'th-dd-sep';
      dd.appendChild(mkLabel('Selection'));

      var allVals = colValues(ci);
      var checked = selection[ci] ? new Set(selection[ci]) : new Set(allVals);

      var searchInp = document.createElement('input');
      searchInp.type = 'text';
      searchInp.className = 'th-dd-input';
      searchInp.placeholder = 'Search\u2026';
      searchInp.addEventListener('click', function(e) { e.stopPropagation(); });
      searchInp.addEventListener('keydown', function(e) {
        e.stopPropagation();
        if (e.key === 'Escape') closeDD();
      });
      dd.appendChild(searchInp);

      // Select All
      var allLabel = document.createElement('label');
      allLabel.className = 'th-dd-item th-dd-all';
      var allCb = document.createElement('input');
      allCb.type = 'checkbox';
      allCb.checked = checked.size === allVals.length;
      allLabel.appendChild(allCb);
      allLabel.appendChild(document.createTextNode('Select All'));
      dd.appendChild(allLabel);

      // Scrollable list
      var listDiv = document.createElement('div');
      listDiv.className = 'th-dd-list';
      var itemEls = [];

      allVals.forEach(function(val) {
        var label = document.createElement('label');
        label.className = 'th-dd-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked.has(val);
        label.appendChild(cb);
        var span = document.createElement('span');
        span.className = 'th-dd-val';
        span.textContent = val || '(\u7A7A)';
        label.appendChild(span);
        listDiv.appendChild(label);
        itemEls.push({ label: label, cb: cb, val: val });

        cb.addEventListener('change', function(e) {
          e.stopPropagation();
          if (cb.checked) checked.add(val); else checked.delete(val);
          syncAll();
          commitSelection();
        });
      });
      dd.appendChild(listDiv);

      function syncAll() {
        var visibleVals = itemEls.filter(function(it) { return it.label.style.display !== 'none'; });
        var allChecked = visibleVals.length > 0 && visibleVals.every(function(it) { return it.cb.checked; });
        allCb.checked = allChecked;
        allCb.indeterminate = !allChecked && visibleVals.some(function(it) { return it.cb.checked; });
      }

      allCb.addEventListener('change', function(e) {
        e.stopPropagation();
        var on = allCb.checked;
        itemEls.forEach(function(it) {
          if (it.label.style.display !== 'none') {
            it.cb.checked = on;
            if (on) checked.add(it.val); else checked.delete(it.val);
          }
        });
        commitSelection();
      });

      searchInp.addEventListener('input', function() {
        var q = searchInp.value.trim().toLowerCase();
        itemEls.forEach(function(it) {
          it.label.style.display = (!q || it.val.includes(q)) ? '' : 'none';
        });
        syncAll();
      });

      function commitSelection() {
        if (checked.size === allVals.length) {
          delete selection[ci];
        } else {
          selection[ci] = new Set(checked);
        }
        applyState();
      }

      syncAll();

      // Position
      document.body.appendChild(dd);
      var rect = th.getBoundingClientRect();
      var ddW = dd.offsetWidth;
      var left = rect.left + rect.width / 2 - ddW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - ddW - 8));
      var top = rect.bottom + window.scrollY + 4;
      var maxH = window.innerHeight - (rect.bottom + 4) - 16;
      if (maxH < 200) maxH = 200;
      dd.style.left = (left + window.scrollX) + 'px';
      dd.style.top = top + 'px';
      dd.style.maxHeight = maxH + 'px';

      activeDD = { el: dd, th: th };
    }

    function testCond(cf, text) {
      var val = cf.value.toLowerCase();
      if (cf.mode === 'eq') return text === val;
      if (cf.mode === 'neq') return text !== val;
      try {
        var re = new RegExp(cf.value, 'i');
        if (cf.mode === 'contains') return re.test(text);
        if (cf.mode === 'notcontains') return !re.test(text);
      } catch(e) { return true; }
      return true;
    }

    function applyState() {
      var rows = origRows.slice();
      if (sortCol >= 0 && sortDir !== 0) {
        var sc = sortCol, sd = sortDir;
        rows.sort(function(a, b) {
          var at = cellText(a, sc), bt = cellText(b, sc);
          var an = parseNum(at), bn = parseNum(bt);
          if (an !== null && bn !== null) return (an - bn) * sd;
          return at.localeCompare(bt, undefined, { numeric: true, sensitivity: 'base' }) * sd;
        });
      }
      rows.forEach(function(row) {
        var vis = true;
        for (var c in selection) {
          var allowed = selection[c];
          if (allowed && !allowed.has(cellText(row, parseInt(c)))) { vis = false; break; }
        }
        if (vis) {
          for (var c in condFilters) {
            if (!testCond(condFilters[c], cellText(row, parseInt(c)))) { vis = false; break; }
          }
        }
        row.style.display = vis ? '' : 'none';
        tbody.appendChild(row);
      });
      updateInd();
    }

    function updateInd() {
      ths.forEach(function(th, i) {
        var ind = th.querySelector('.th-sort-ind');
        ind.textContent = sortCol === i ? (sortDir === 1 ? ' \u2191' : ' \u2193') : '';
        var active = (sortCol === i) || !!selection[i] || !!condFilters[i];
        th.classList.toggle('th-active', active);
        th.classList.toggle('th-filtered', !!selection[i] || !!condFilters[i]);
      });
    }
  });

  function cellText(row, ci) {
    var c = row.cells[ci];
    return c ? c.textContent.trim().toLowerCase() : '';
  }

  function parseNum(s) {
    if (s === '') return null;
    var n = parseFloat(s.replace(/,/g, ''));
    return (!isNaN(n) && isFinite(n)) ? n : null;
  }
  if (window._log && count > 0) _log.info('table', 'Enhanced ' + count + ' table(s)');
  } // end initTableEnhance

  window.initTableEnhance = initTableEnhance;
  initTableEnhance(document);
});
