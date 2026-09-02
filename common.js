(function (global) {
  function $(id) { return document.getElementById(id); }
  function money(x) {
    if (x == null || isNaN(x)) return '—';
    return '$' + Number(x).toFixed(2);
  }
  function ceil(x) { return Math.ceil(x - 1e-9); }

  var catalog = {};
  var catalogLoaded = false;

  function mergePrices(key) {
    const saved = (function () {
      try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
    })();
    const cat = catalog[key] || {};
    const out = {};
    Object.keys(cat).concat(Object.keys(saved)).forEach(function (id) {
      const s = saved[id] || {};
      const c = cat[id] || {};
      out[id] = {
        hd: (s.hd !== undefined && s.hd !== '') ? s.hd : (c.hd || ''),
        lw: (s.lw !== undefined && s.lw !== '') ? s.lw : (c.lw || ''),
        ml: (s.ml !== undefined && s.ml !== '') ? s.ml : (c.ml || '')
      };
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

  function renderTable(items, priceKey, notesText) {
    const prices = mergePrices(priceKey);
    const tb = document.querySelector('#list tbody');
    tb.innerHTML = '';
    let hd = 0, lw = 0, ml = 0;

    items.forEach(function (it) {
      const p = prices[it.id] || {};
      const phd = parseFloat(p.hd), plw = parseFloat(p.lw), pml = parseFloat(p.ml);
      const ehd = isNaN(phd) ? 0 : phd * it.qty;
      const elw = isNaN(plw) ? 0 : plw * it.qty;
      const eml = isNaN(pml) ? 0 : pml * it.qty;
      if (!isNaN(phd)) hd += ehd;
      if (!isNaN(plw)) lw += elw;
      if (!isNaN(pml)) ml += eml;

      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + it.name + (it.note ? '<div style="color:#5b6b7a;font-size:.78rem;">' + it.note + '</div>' : '') + '</td>' +
        '<td class="num"><b>' + it.qty + '</b></td>' +
        '<td>' + it.unit + '</td>' +
        '<td class="num"><input class="price" data-id="' + it.id + '" data-store="hd" value="' + (p.hd || '') + '" placeholder="—"></td>' +
        '<td class="num"><input class="price" data-id="' + it.id + '" data-store="lw" value="' + (p.lw || '') + '" placeholder="—"></td>' +
        '<td class="num"><input class="price" data-id="' + it.id + '" data-store="ml" value="' + (p.ml || '') + '" placeholder="—"></td>' +
        '<td class="num">' + (isNaN(phd) ? '—' : money(ehd)) + '</td>' +
        '<td class="num">' + (isNaN(plw) ? '—' : money(elw)) + '</td>' +
        '<td class="num">' + (isNaN(pml) ? '—' : money(eml)) + '</td>';
      tb.appendChild(tr);
    });

    const all = [hd, lw, ml];
    function badge(val) {
      const filled = all.filter(function (x) { return x > 0; });
      return (filled.length && val === Math.min.apply(null, filled)) ? ' win' : '';
    }
    document.getElementById('totals').innerHTML =
      '<div class="tot hd">Home Depot<b class="' + badge(hd) + '">' + money(hd) + '</b></div>' +
      '<div class="tot lw">Lowe’s<b class="' + badge(lw) + '">' + money(lw) + '</b></div>' +
      '<div class="tot ml">Local shop<b class="' + badge(ml) + '">' + money(ml) + '</b></div>';

    const notes = document.getElementById('notes');
    if (notes) notes.textContent = notesText || '';

    tb.querySelectorAll('input.price').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const cur = mergePrices(priceKey);
        cur[inp.dataset.id] = cur[inp.dataset.id] || {};
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

  global.HJ = {
    $, money, ceil, loadPrices, savePrices, loadCatalog, renderTable, millText, wireCopy, wireReset
  };
})(window);
