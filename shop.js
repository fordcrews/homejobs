(function (global) {
  var KEY = 'homejobs.shop.v1';
  var CUST = 'homejobs.customer.v1';
  var job = { title: '', items: [], labor: [], notes: '', priceKey: '' };

  function defaults() {
    return {
      company: '',
      phone: '',
      email: '',
      address: '',
      taxPct: 7,
      markupPct: 20,
      costStore: 'best',
      nextInvoice: 1001,
      labor: {
        fenceLf: 12,
        fenceGate: 85,
        chainLf: 10,
        chainGate: 65,
        floorSf: 3.5,
        tileSf: 8,
        carpetSf: 2.75,
        paintWallSf: 1.25,
        paintCeilSf: 0.85,
        paintTrimLf: 1.5,
        hourly: 45
      }
    };
  }

  function loadShop() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || '{}');
      var d = defaults();
      s.labor = Object.assign({}, d.labor, s.labor || {});
      return Object.assign(d, s);
    } catch (e) {
      return defaults();
    }
  }
  function saveShop(s) { localStorage.setItem(KEY, JSON.stringify(s)); }

  function loadCustomer() {
    try { return JSON.parse(localStorage.getItem(CUST) || '{}'); } catch (e) { return {}; }
  }
  function saveCustomer(c) { localStorage.setItem(CUST, JSON.stringify(c)); }

  function rate(name) {
    var n = parseFloat(loadShop().labor[name]);
    return isNaN(n) ? 0 : n;
  }

  function pickUnit(p) {
    var shop = loadShop();
    var hd = parseFloat(p.hd), lw = parseFloat(p.lw), ml = parseFloat(p.ml);
    var store = shop.costStore || 'best';
    if (store === 'hd' && !isNaN(hd)) return hd;
    if (store === 'lw' && !isNaN(lw)) return lw;
    if (store === 'ml' && !isNaN(ml)) return ml;
    var filled = [hd, lw, ml].filter(function (x) { return !isNaN(x) && x > 0; });
    if (!filled.length) return 0;
    return Math.min.apply(null, filled);
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function setJob(j) {
    job = j || job;
    renderDocs();
  }

  function totals() {
    var shop = loadShop();
    var prices = HJ.loadPrices(job.priceKey);
    var markup = (parseFloat(shop.markupPct) || 0) / 100;
    var taxPct = (parseFloat(shop.taxPct) || 0) / 100;
    var matCost = 0;
    var matLines = (job.items || []).map(function (it) {
      var u = pickUnit(prices[it.id] || {});
      var cost = u * it.qty;
      matCost += cost;
      var sell = cost * (1 + markup);
      return { name: it.name, qty: it.qty, unit: it.unit, unitCost: u, sell: sell };
    });
    var lab = 0;
    var labLines = (job.labor || []).filter(function (L) { return L.qty > 0 && L.rate > 0; }).map(function (L) {
      var amt = L.qty * L.rate;
      lab += amt;
      return { name: L.name, qty: L.qty, unit: L.unit, rate: L.rate, amt: amt };
    });
    var matSell = matCost * (1 + markup);
    var sub = matSell + lab;
    var tax = sub * taxPct;
    return {
      matLines: matLines, labLines: labLines,
      matCost: matCost, matSell: matSell, lab: lab, sub: sub, tax: tax, total: sub + tax,
      markup: markup, taxPct: taxPct, shop: shop
    };
  }

  function letterhead(kind, extra) {
    var s = loadShop();
    var c = loadCustomer();
    var today = new Date().toLocaleDateString();
    return '<div class="doc-head">' +
      '<div><h2>' + esc(s.company || 'Your company') + '</h2>' +
      '<div class="doc-meta">' + esc(s.address) + '<br>' + esc(s.phone) +
      (s.email ? ' · ' + esc(s.email) : '') + '</div></div>' +
      '<div style="text-align:right"><h2>' + kind + '</h2>' +
      '<div class="doc-meta">' + extra + '<br>' + today + '</div></div></div>' +
      '<div class="doc-parties"><div><strong>Bill to</strong><br>' +
      esc(c.name || 'Customer') + '<br>' + esc(c.address || '') + '<br>' +
      esc(c.phone || '') + (c.email ? '<br>' + esc(c.email) : '') +
      '</div><div><strong>Job</strong><br>' + esc(job.title) +
      '<pre style="white-space:pre-wrap;font:inherit;margin:.35rem 0 0">' + esc(job.notes || '') + '</pre></div></div>';
  }

  function moneyRows(lines, kind) {
    var html = '<table><thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>';
    lines.forEach(function (L) {
      html += '<tr><td>' + esc(L.name) + '</td><td class="num">' + L.qty + '</td><td>' + esc(L.unit) + '</td>' +
        '<td class="num">' + HJ.money(L.price) + '</td><td class="num">' + HJ.money(L.amt) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function sumTable(t) {
    return '<table class="sum"><tr><td>Materials (your cost)</td><td class="num">' + HJ.money(t.matCost) + '</td></tr>' +
      '<tr><td>Materials billed (' + (t.markup * 100).toFixed(0) + '% markup)</td><td class="num">' + HJ.money(t.matSell) + '</td></tr>' +
      '<tr><td>Labor</td><td class="num">' + HJ.money(t.lab) + '</td></tr>' +
      '<tr><td>Subtotal</td><td class="num">' + HJ.money(t.sub) + '</td></tr>' +
      '<tr><td>Tax (' + (t.taxPct * 100).toFixed(2) + '%)</td><td class="num">' + HJ.money(t.tax) + '</td></tr>' +
      '<tr class="grand"><td>Total</td><td class="num">' + HJ.money(t.total) + '</td></tr></table>';
  }

  function renderDocs() {
    var root = document.getElementById('docsRoot');
    if (!root || !job.items) return;
    var t = totals();
    var quoteLines = t.matLines.filter(function (L) { return L.sell > 0 || L.qty; }).map(function (L) {
      return { name: L.name, qty: L.qty, unit: L.unit, price: L.qty ? L.sell / L.qty : 0, amt: L.sell };
    }).concat(t.labLines.map(function (L) {
      return { name: L.name, qty: L.qty, unit: L.unit, price: L.rate, amt: L.amt };
    }));
    var invNo = loadShop().nextInvoice || 1001;
    root.querySelector('.doc-quote').innerHTML = letterhead('QUOTE', 'Valid 30 days') +
      moneyRows(quoteLines) + sumTable(t) +
      '<p class="hint">Not a contract. Materials billed at cost plus markup from Shop settings. Labor from your rate sheet.</p>';
    root.querySelector('.doc-invoice').innerHTML = letterhead('INVOICE', 'Invoice #' + invNo) +
      moneyRows(quoteLines) + sumTable(t) +
      '<p class="hint">Please pay to the company named above. Thank you.</p>';
    var pull = document.getElementById('laborTotals');
    if (pull) {
      pull.innerHTML = '<div class="tot">Materials cost<b>' + HJ.money(t.matCost) + '</b></div>' +
        '<div class="tot">Labor<b>' + HJ.money(t.lab) + '</b></div>' +
        '<div class="tot">Quote total<b>' + HJ.money(t.total) + '</b></div>';
    }
  }

  function showPanel(name) {
    document.querySelectorAll('#docsRoot .panel').forEach(function (p) { p.classList.remove('show'); });
    document.querySelectorAll('#docsRoot .tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.panel === name); });
    var p = document.getElementById('panel-' + name);
    if (p) p.classList.add('show');
  }

  function printDoc(kind) {
    document.body.classList.remove('print-pull', 'print-quote', 'print-invoice');
    document.body.classList.add('print-' + kind);
    if (kind === 'invoice') {
      var s = loadShop();
      s.nextInvoice = (parseInt(s.nextInvoice, 10) || 1001) + 1;
      saveShop(s);
      renderDocs();
    }
    window.print();
    document.body.classList.remove('print-pull', 'print-quote', 'print-invoice');
  }

  function mountDocs() {
    if (document.getElementById('docsRoot')) return;
    var wrap = document.querySelector('.wrap');
    if (!wrap) return;
    var c = loadCustomer();
    var div = document.createElement('div');
    div.id = 'docsRoot';
    div.innerHTML =
      '<div class="totals" id="laborTotals"></div>' +
      '<div class="tabs no-print">' +
      '<button type="button" data-panel="customer" class="active">Customer</button>' +
      '<button type="button" data-panel="quote">Quote</button>' +
      '<button type="button" data-panel="invoice">Invoice</button>' +
      '<button type="button" data-panel="pull">Pull sheet</button>' +
      '</div>' +
      '<div class="panel show no-print" id="panel-customer"><fieldset><legend>Customer</legend><div class="row2">' +
      '<div><label>Name</label><input id="custName" value="' + esc(c.name || '') + '"></div>' +
      '<div><label>Phone</label><input id="custPhone" value="' + esc(c.phone || '') + '"></div>' +
      '<div><label>Email</label><input id="custEmail" value="' + esc(c.email || '') + '"></div>' +
      '<div><label>Job address</label><input id="custAddr" value="' + esc(c.address || '') + '"></div>' +
      '</div><p class="hint">Saved in this browser. Set company name and labor rates on the <a href="shop.html">Shop</a> tab.</p></fieldset></div>' +
      '<div class="panel" id="panel-quote"><div class="doc doc-quote"></div>' +
      '<div class="actions no-print"><button type="button" data-print="quote">Print quote</button></div></div>' +
      '<div class="panel" id="panel-invoice"><div class="doc doc-invoice"></div>' +
      '<div class="actions no-print"><button type="button" data-print="invoice">Print invoice</button></div></div>' +
      '<div class="panel" id="panel-pull"><p class="hint no-print">Use the materials table above for HD / Lowe’s / mill. Print that as the purchase list.</p>' +
      '<div class="actions no-print"><button type="button" data-print="pull">Print pull sheet (materials table)</button></div></div>';
    var foot = wrap.querySelector('footer');
    wrap.insertBefore(div, foot || null);
    div.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { showPanel(b.dataset.panel); });
    });
    ['custName', 'custPhone', 'custEmail', 'custAddr'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        saveCustomer({
          name: document.getElementById('custName').value,
          phone: document.getElementById('custPhone').value,
          email: document.getElementById('custEmail').value,
          address: document.getElementById('custAddr').value
        });
        renderDocs();
      });
    });
    div.querySelectorAll('[data-print]').forEach(function (b) {
      b.addEventListener('click', function () { printDoc(b.dataset.print); });
    });
  }

  global.HJ.loadShop = loadShop;
  global.HJ.saveShop = saveShop;
  global.HJ.rate = rate;
  global.HJ.setJob = setJob;
  global.HJ.mountDocs = mountDocs;
  global.HJ.renderDocs = renderDocs;
})(window);
