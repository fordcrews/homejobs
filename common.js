(function (global) {
  function $(id) { return document.getElementById(id); }
  function money(x) {
    if (x == null || isNaN(x)) return '—';
    return '$' + Number(x).toFixed(2);
  }
  function ceil(x) { return Math.ceil(x - 1e-9); }

  var catalog = {};
  var catalogLoaded = false;

  function localMeta() {
    var s = (global.HJ && global.HJ.loadShop) ? global.HJ.loadShop() : {};
    return {
      l1: s.local1Name || 'Local 1',
      l2: s.local2Name || 'Local 2',
      compare: s.compareLocal === 'l2' ? 'l2' : 'l1'
    };
  }

  function rowFrom(s, c) {
    s = s || {};
    c = c || {};
    function pick(k, fallback) {
      if (s[k] !== undefined && s[k] !== '') return s[k];
      if (fallback && s[fallback] !== undefined && s[fallback] !== '') return s[fallback];
      if (c[k] !== undefined && c[k] !== '') return c[k];
      if (fallback && c[fallback] !== undefined && c[fallback] !== '') return c[fallback];
      return '';
    }
    return {
      hd: pick('hd'),
      lw: pick('lw'),
      l1: pick('l1', 'ml'),
      l2: pick('l2')
    };
  }

  function mergePrices(key) {
    const saved = (function () {
      try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
    })();
    const cat = catalog[key] || {};
    const out = {};
    Object.keys(cat).concat(Object.keys(saved)).forEach(function (id) {
      out[id] = rowFrom(saved[id], cat[id]);
    });
    return out;
  }
  function loadPrices(key) { return mergePrices(key); }
  function savePrices(key, p) { localStorage.setItem(key, JSON.stringify(p)); }

  function applyCatalog(j, then) {
    catalog = j || {};
    catalogLoaded = true;
    var el = document.getElementById('priceAsOf');
    if (el && catalog.updated) {
      el.textContent = 'Catalog prices as of ' + catalog.updated + ' (national web; Jackson, MS store will differ). Edit a cell to override.';
    }
    if (then) then();
  }
  function loadCatalog(then) {
    if (window.HJ_PRICES) {
      applyCatalog(window.HJ_PRICES, then);
      return;
    }
    fetch('prices.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { applyCatalog(j, then); })
      .catch(function () { if (then) then(); });
  }

  function labelThead() {
    var loc = localMeta();
    var map = {
      'th-l1': loc.l1 + ' $',
      'th-l2': loc.l2 + ' $',
      'th-l1-ext': loc.l1,
      'th-l2-ext': loc.l2,
      'th-cmp': loc[loc.compare],
      'th-cmp-u': loc[loc.compare] + ' $'
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = map[id];
    });
  }

  function renderTable(items, priceKey, notesText) {
    const loc = localMeta();
    const cmp = loc.compare;
    const prices = mergePrices(priceKey);
    const tb = document.querySelector('#list tbody');
    tb.innerHTML = '';
    let hd = 0, lw = 0, l1 = 0, l2 = 0;
    labelThead();

    items.forEach(function (it) {
      const p = prices[it.id] || {};
      const phd = parseFloat(p.hd), plw = parseFloat(p.lw);
      const pl1 = parseFloat(p.l1), pl2 = parseFloat(p.l2);
      const ehd = isNaN(phd) ? 0 : phd * it.qty;
      const elw = isNaN(plw) ? 0 : plw * it.qty;
      const el1 = isNaN(pl1) ? 0 : pl1 * it.qty;
      const el2 = isNaN(pl2) ? 0 : pl2 * it.qty;
      if (!isNaN(phd)) hd += ehd;
      if (!isNaN(plw)) lw += elw;
      if (!isNaN(pl1)) l1 += el1;
      if (!isNaN(pl2)) l2 += el2;

      const cmpVal = cmp === 'l2' ? pl2 : pl1;
      const cmpExt = cmp === 'l2' ? el2 : el1;
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + it.name + (it.note ? '<div style="color:#5b6b7a;font-size:.78rem;">' + it.note + '</div>' : '') + '</td>' +
        '<td class="num"><b>' + it.qty + '</b></td>' +
        '<td>' + it.unit + '</td>' +
        '<td class="num"><input class="price" data-id="' + it.id + '" data-store="hd" value="' + (p.hd || '') + '" placeholder="—"></td>' +
        '<td class="num"><input class="price" data-id="' + it.id + '" data-store="lw" value="' + (p.lw || '') + '" placeholder="—"></td>' +
        '<td class="num"><input class="price" data-id="' + it.id + '" data-store="l1" value="' + (p.l1 || '') + '" placeholder="—"></td>' +
        '<td class="num"><input class="price" data-id="' + it.id + '" data-store="l2" value="' + (p.l2 || '') + '" placeholder="—"></td>' +
        '<td class="num">' + (isNaN(phd) ? '—' : money(ehd)) + '</td>' +
        '<td class="num">' + (isNaN(plw) ? '—' : money(elw)) + '</td>' +
        '<td class="num">' + (isNaN(cmpVal) ? '—' : money(cmpExt)) + '</td>';
      tb.appendChild(tr);
    });

    const cmpTot = cmp === 'l2' ? l2 : l1;
    const all = [hd, lw, cmpTot];
    function badge(val) {
      const filled = all.filter(function (x) { return x > 0; });
      return (filled.length && val === Math.min.apply(null, filled)) ? ' win' : '';
    }
    document.getElementById('totals').innerHTML =
      '<div class="tot hd">Home Depot<b class="' + badge(hd) + '">' + money(hd) + '</b></div>' +
      '<div class="tot lw">Lowe’s<b class="' + badge(lw) + '">' + money(lw) + '</b></div>' +
      '<div class="tot ml">' + loc[cmp] + '<b class="' + badge(cmpTot) + '">' + money(cmpTot) + '</b></div>' +
      '<div class="tot" style="opacity:.75">' + loc.l1 + '<b>' + money(l1) + '</b></div>' +
      '<div class="tot" style="opacity:.75">' + loc.l2 + '<b>' + money(l2) + '</b></div>';

    const notes = document.getElementById('notes');
    if (notes) notes.textContent = notesText || '';

    tb.querySelectorAll('input.price').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const cur = mergePrices(priceKey);
        cur[inp.dataset.id] = cur[inp.dataset.id] || { hd: '', lw: '', l1: '', l2: '' };
        cur[inp.dataset.id][inp.dataset.store] = inp.value;
        savePrices(priceKey, cur);
        if (global.rebuild) global.rebuild();
      });
    });
  }

  function millText(title, items, notes) {
    const lines = [title, ''];
    items.forEach(function (it) { lines.push(it.qty + ' ' + it.unit + '  ' + it.name); });
    if (notes) lines.push('', notes);
    return lines.join('\n');
  }

  function wireCopy(btnId, builder) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(builder()).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy shop list'; }, 1500);
      });
    });
  }

  function wireReset(btnId, priceKey, rebuild) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', function () {
      localStorage.removeItem(priceKey);
      rebuild();
    });
  }

  function collectInputs(ids) {
    var o = {};
    (ids || []).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) o[id] = el.value;
    });
    return o;
  }
  function applyInputs(obj) {
    if (!obj) return;
    Object.keys(obj).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = obj[id];
    });
  }

  function downloadJson(name, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function catalogRow(priceKey, id) {
    var cat = (catalog[priceKey] || {})[id] || {};
    return rowFrom({}, cat);
  }

  function mergeUpdatePrices(quotePrices, priceKey) {
    var out = {};
    var ids = {};
    Object.keys(quotePrices || {}).forEach(function (id) { ids[id] = true; });
    Object.keys(catalog[priceKey] || {}).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      var q = rowFrom(quotePrices[id], {});
      var c = catalogRow(priceKey, id);
      out[id] = {
        hd: c.hd !== '' ? c.hd : q.hd,
        lw: c.lw !== '' ? c.lw : q.lw,
        l1: q.l1,
        l2: q.l2
      };
    });
    return out;
  }

  function wireQuoteIO(opts) {
    var exp = document.getElementById('exportQuote');
    var imp = document.getElementById('importQuote');
    var file = document.getElementById('quoteFile');
    if (!exp || !imp || !file) return;

    exp.addEventListener('click', function () {
      var extra = opts.getExtra ? opts.getExtra() : null;
      var payload = {
        kind: 'homejobs-quote',
        version: 1,
        page: opts.page,
        priceKey: opts.priceKey,
        title: opts.title || opts.page,
        exported: new Date().toISOString(),
        inputs: collectInputs(opts.inputIds || []),
        extra: extra,
        prices: mergePrices(opts.priceKey),
        customer: (global.HJ.loadCustomer ? global.HJ.loadCustomer() : {}),
        shop: (global.HJ.loadShop ? global.HJ.loadShop() : {})
      };
      var stamp = payload.exported.slice(0, 10);
      var slug = (opts.page || 'quote').replace('.html', '');
      downloadJson(slug + '-' + stamp + '.json', payload);
    });

    imp.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); } catch (e) {
          alert('Not a valid quote file.');
          return;
        }
        if (data.kind && data.kind !== 'homejobs-quote') {
          alert('That file is not a Home jobs quote.');
          return;
        }
        if (data.page && data.page !== opts.page) {
          if (!confirm('This quote was saved from ' + data.page + '. Load it on this page anyway?')) return;
        }
        var update = confirm('Update HD / Lowe’s from the current catalog?\n\nOK = refresh HD and Lowe’s (Local 1 & 2 stay as saved in the quote).\nCancel = keep every price from the quote.');
        var qPrices = data.prices || {};
        Object.keys(qPrices).forEach(function (id) {
          qPrices[id] = rowFrom(qPrices[id], {});
        });
        var prices = update ? mergeUpdatePrices(qPrices, opts.priceKey) : qPrices;
        savePrices(opts.priceKey, prices);
        applyInputs(data.inputs || {});
        if (opts.setExtra && data.extra) opts.setExtra(data.extra);
        if (data.customer && global.HJ.saveCustomer) {
          global.HJ.saveCustomer(data.customer);
          ['custName', 'custPhone', 'custEmail', 'custAddr'].forEach(function (id, i) {
            var el = document.getElementById(id);
            var k = ['name', 'phone', 'email', 'address'][i];
            if (el) el.value = data.customer[k] || '';
          });
        }
        if (opts.rebuild) opts.rebuild();
        else if (global.rebuild) global.rebuild();
      };
      reader.readAsText(f);
    });
  }

  global.HJ = {
    $, money, ceil, loadPrices, savePrices, loadCatalog, renderTable, millText, wireCopy, wireReset,
    localMeta, wireQuoteIO, collectInputs, applyInputs
  };
})(window);
