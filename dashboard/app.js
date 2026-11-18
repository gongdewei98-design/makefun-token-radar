// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail view with the model's own inputs and the farm plan, and
// a model sandbox that recomputes every row live. No network: every byte it
// shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = {
    q: '', category: 'all', chain: 'all', tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null, sandbox: null
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. The sandbox calls it
  // with changed constants and re-ranks the whole board live.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor,
      row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor +
      (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
  }

  /** The model the page currently scores with: the published one, or the sandbox's. */
  function activeModel() {
    if (!state.sandbox) return DATA.model;
    var m = DATA.model;
    return {
      base_multiple: state.sandbox.multiple,
      multiple_sample: m.multiple_sample,
      growth_weight: state.sandbox.growthWeight,
      growth_floor: m.growth_floor,
      growth_cap: m.growth_cap,
      maturity_floor: m.maturity_floor,
      maturity_range: state.sandbox.maturityRange,
      maturity_days: m.maturity_days,
      unknown_age_days: m.unknown_age_days
    };
  }

  /** Rows scored under the active model, with a display rank for the current scoring. */
  function scoredRows() {
    var model = activeModel();
    var list = DATA.rows.map(function (r) {
      return { row: r, value: impliedOf(r, model) };
    });
    list.sort(function (a, b) {
      return b.value - a.value || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0);
    });
    var rankOf = {};
    list.forEach(function (s, i) { rankOf[s.row.slug] = i + 1; });
    return { list: list, rankOf: rankOf };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filtered(scored) {
    var q = state.q.trim().toLowerCase();
    return scored.list.filter(function (s) {
      var r = s.row;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (key === 'growth') {
        av = a.row.change_7d === null ? -Infinity : a.row.change_7d;
        bv = b.row.change_7d === null ? -Infinity : b.row.change_7d;
      } else if (key === 'age') {
        av = a.row.age_days === null ? Infinity : a.row.age_days;
        bv = b.row.age_days === null ? Infinity : b.row.age_days;
      } else { av = a.value; bv = b.value; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'sweep', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'Token ', el('em', { text: 'Radar' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill' }, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { class: 'pill' }, 'DefiLlama protocol index'),
        el('span', { class: 'pill' }, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('h1', null,
        'Every pre-token protocol on the watchlist, ranked by ',
        el('span', { class: 'hi', text: 'implied value' }),
        '.'
      ),
      el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) +
        'M of TVL and no token on record. The early radar adds ' + DATA.early_size +
        ' pre-token protocols below that floor, held to the same exclusion rule. Implied value is a model, not a promise.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' },
          el('span', { text: 'Watchlist covered' }),
          el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
          el('small', { text: 'every slug on the floor' })),
        el('div', { class: 'fact' },
          el('span', { text: 'Pre-token rows scored' }),
          el('b', { text: String(DATA.board_size) }),
          el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'fact' },
          el('span', { text: 'Top implied value' }),
          el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }),
          el('small', { text: top ? top.name : '' })),
        el('div', { class: 'fact' },
          el('span', { text: 'Live-token protocols set aside' }),
          el('b', { text: String(DATA.live_size) }),
          el('small', { text: 'shown at market cap, never ranked' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var scored = scoredRows();
    var shown = state.tab === 'pre-token' ? filtered(scored).length : DATA.live.length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: shown + (state.tab === 'pre-token' ? ' rows shown' : ' live-token protocols') })
    );
  }

  function sandboxNote() {
    if (!state.sandbox) return null;
    return el('div', { class: 'sandbox-note' },
      el('span', null,
        el('b', { text: 'Sandbox on: ' }),
        'the board below is re-scored with your constants. board.json keeps the published model.'
      ),
      el('button', { type: 'button', text: 'Reset to published model', onclick: function () { state.sandbox = null; render(); } })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
      } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var scored = scoredRows();
    var list = sortedRows(filtered(scored));
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, s) { return Math.max(m, s.value); }, 1);
    var tbody = el('tbody');
    list.forEach(function (s) {
      var r = s.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank-cell', text: String(scored.rankOf[r.slug]) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((s.value / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(s.value) })
        )),
        el('td', null, el('span', { class: r.watchlist ? 'status watch' : 'status pre', text: r.watchlist ? 'watchlist' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num rank-cell', text: 'live' }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var multiple = m.base_multiple.toFixed(3);
    var sandbox = state.sandbox;
    function slider(id, label, value, min, max, step, fmt, apply) {
      var out = el('b', { text: fmt(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () {
        if (!state.sandbox) {
          state.sandbox = { multiple: m.base_multiple, growthWeight: m.growth_weight, maturityRange: m.maturity_range };
        }
        apply(state.sandbox, parseFloat(input.value));
        out.textContent = fmt(parseFloat(input.value));
        render();
      });
      return el('div', { class: 'slider' },
        el('label', { for: id }, el('span', { text: label }), out),
        input
      );
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ',
        el('b', { text: multiple }),
        ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')',
        ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The base multiple ' + multiple + ' is not a guess: it is the median market-cap-to-TVL ratio of the snapshot\'s own ' +
        m.multiple_sample + ' live-token protocols, computed from the same snapshot. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' +
        m.unknown_age_days + ' days. Early rows pass the same exclusion rule as the watchlist: no exchange, no bridge, no liquid-staking or restaking wrapper, no versioned pool name.' }),
      el('div', { class: 'sandbox' },
        el('h3', { text: 'Model sandbox' }),
        el('p', { class: 'sub', text: 'Move a constant and the whole board re-scores in the page, from the same function. The published board keeps the constants above.' }),
        el('div', { class: 'sliders' },
          slider('sb-multiple', 'Base multiple', sandbox ? sandbox.multiple : m.base_multiple, 0.05, 0.6, 0.005,
            function (v) { return v.toFixed(3); },
            function (s, v) { s.multiple = v; }),
          slider('sb-growth', 'Growth weight', sandbox ? sandbox.growthWeight : m.growth_weight, 0, 1.5, 0.05,
            function (v) { return v.toFixed(2); },
            function (s, v) { s.growthWeight = v; }),
          slider('sb-maturity', 'Maturity range', sandbox ? sandbox.maturityRange : m.maturity_range, 0, 1, 0.05,
            function (v) { return v.toFixed(2); },
            function (s, v) { s.maturityRange = v; })
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var model = activeModel();
    var value = impliedOf(row, model);
    var published = row.implied_value_usd;
    var same = value === published;
    var cells = [
      { label: 'TVL', value: fmtUsd(row.tvl_usd) },
      { label: 'Seven-day growth', value: fmtPct(row.change_7d) },
      { label: 'Age with no token', value: fmtAge(row.age_days) },
      { label: 'Growth multiplier', value: String(row.growth_multiplier) },
      { label: 'Maturity multiplier', value: String(row.maturity_multiplier) },
      { label: state.sandbox ? 'Implied value (sandbox)' : 'Implied value', value: fmtUsd(value), big: true }
    ];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rank-tag', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  watchlist' : '  ·  early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') +
          (row.listed_at ? '  ·  listed ' + row.listed_at : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' }, cells.map(function (c) {
        return el('div', { class: c.big ? 'big' : null },
          el('span', { text: c.label }),
          el('b', { class: 'num', text: c.value })
        );
      })),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' +
        fmtUsd(value) + (same
          ? ', the same number board.json carries.'
          : ', against the published ' + fmtUsd(published) + ' (sandbox what-if).') +
        ' An estimate, not a price; the protocol records no token.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Data: DefiLlama protocol index, snapshot ' + DATA.as_of + '. The board ranks protocols that record no token; ' +
        'a protocol on it may still have a token its record does not carry. Implied values are this radar\'s own model, never make.fun\'s, ' +
        'and this page predicts neither whether nor when any protocol issues a token. Farm plans are starting points, not financial advice.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    var note = sandboxNote();
    if (note) shell.appendChild(note);
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
