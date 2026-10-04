/* Реєстр активів АРМА — клієнтська логіка без зовнішніх бібліотек:
   діаграми (SVG), вкладки, виділення рядків, підтвердження дій. */
(function () {
  'use strict';
  var C = {cyan: '#35D6E8', gold: '#F5C518', violet: '#8B7BF7', ok: '#3DD68C', lim: '#F5A524',
           lost: '#F0524E', unk: '#6E7F9E', blue: '#4C8DF6', closed: '#5B7DB1'};
  var PALETTE = ['#35D6E8', '#F5C518', '#8B7BF7', '#3DD68C', '#F5A524', '#4C8DF6', '#F0524E', '#6E7F9E', '#5B7DB1', '#C3B8FF'];
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(v) {
    v = Number(v);
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',') + ' млрд';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' млн';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1).replace('.', ',') + ' тис.';
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function color(c, i) { return C[c] || c || PALETTE[i % PALETTE.length]; }
  function go(links, i) { if (links && links[i]) window.location = links[i]; }

  function barH(box, d) {
    var n = d.labels.length, rowH = 21, top = 4;
    var W = box.clientWidth || 360, H = Math.max(n * rowH + top * 2, 60);
    box.style.height = H + 'px';
    var labW = Math.min(170, Math.max(90, W * 0.38)), valW = 52, bw = W - labW - valW - 6;
    var max = Math.max.apply(null, d.values.concat([1]));
    var svg = el('svg', {'class': 'ch', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none'}, box);
    d.labels.forEach(function (lab, i) {
      var y = top + i * rowH, w = Math.max(2, bw * d.values[i] / max);
      var t = el('text', {x: labW - 8, y: y + 13, 'text-anchor': 'end', 'class': 'lbl'}, svg);
      t.textContent = lab.length > 30 ? lab.slice(0, 29) + '…' : lab;
      var title = el('title', {}, t); title.textContent = lab;
      var r = el('rect', {x: labW, y: y + 3, width: w, height: 13, rx: 3, fill: color(d.colors ? d.colors[i] : d.color, i), 'class': 'bar'}, svg);
      r.addEventListener('click', function () { go(d.links, i); });
      var tt = el('title', {}, r); tt.textContent = lab + ': ' + fmt(d.values[i]);
      var v = el('text', {x: labW + w + 5, y: y + 13.5, 'class': 'val'}, svg);
      v.textContent = fmt(d.values[i]);
    });
  }

  function barV(box, d) {
    var W = box.clientWidth || 360, H = box.clientHeight || 150, n = d.labels.length;
    var top = 16, bottom = 22, slot = W / n, bw = Math.min(28, slot * 0.6);
    var max = Math.max.apply(null, d.values.concat([1]));
    var svg = el('svg', {'class': 'ch', viewBox: '0 0 ' + W + ' ' + H}, box);
    d.labels.forEach(function (lab, i) {
      var h = Math.max(2, (H - top - bottom) * d.values[i] / max), x = i * slot + (slot - bw) / 2, y = H - bottom - h;
      var r = el('rect', {x: x, y: y, width: bw, height: h, rx: 3, fill: color(d.colors ? d.colors[i] : d.color, i), 'class': 'bar'}, svg);
      r.addEventListener('click', function () { go(d.links, i); });
      var v = el('text', {x: x + bw / 2, y: y - 4, 'text-anchor': 'middle', 'class': 'val'}, svg);
      v.textContent = fmt(d.values[i]);
      var t = el('text', {x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', 'class': 'lbl'}, svg);
      t.textContent = lab.length > 12 ? lab.slice(0, 11) + '…' : lab;
    });
  }

  function donut(box, d) {
    var total = d.values.reduce(function (a, b) { return a + b; }, 0) || 1;
    var wrap = document.createElement('div'); wrap.className = 'donut-wrap'; box.appendChild(wrap);
    var S = 140, R = 62, r = 38, cx = S / 2, cy = S / 2;
    var svg = el('svg', {'class': 'ch', viewBox: '0 0 ' + S + ' ' + S, width: S, height: S}, wrap);
    var a0 = -Math.PI / 2;
    d.values.forEach(function (v, i) {
      if (!v) return;
      var a1 = a0 + 2 * Math.PI * v / total, large = (a1 - a0) > Math.PI ? 1 : 0;
      if (v === total) a1 -= 0.0001;
      var p = ['M', cx + R * Math.cos(a0), cy + R * Math.sin(a0), 'A', R, R, 0, large, 1, cx + R * Math.cos(a1), cy + R * Math.sin(a1),
               'L', cx + r * Math.cos(a1), cy + r * Math.sin(a1), 'A', r, r, 0, large, 0, cx + r * Math.cos(a0), cy + r * Math.sin(a0), 'Z'].join(' ');
      var path = el('path', {d: p, fill: color(d.colors ? d.colors[i] : null, i), 'class': 'bar'}, svg);
      path.addEventListener('click', function () { go(d.links, i); });
      var tt = el('title', {}, path); tt.textContent = d.labels[i] + ': ' + fmt(v);
      var pct = v / total * 100;
      if (pct >= 7) {
        var am = (a0 + a1) / 2, rm = (R + r) / 2;
        var t = el('text', {x: cx + rm * Math.cos(am), y: cy + rm * Math.sin(am) + 3.5, 'text-anchor': 'middle', 'class': 'val', fill: '#0A0F1C', style: 'fill:#0A0F1C'}, svg);
        t.textContent = Math.round(pct) + '%';
      }
      a0 = a1;
    });
    var c = el('text', {x: cx, y: cy + 4, 'text-anchor': 'middle', 'class': 'val', style: 'font-size:13px'}, svg);
    c.textContent = fmt(total);
    var lg = document.createElement('div'); lg.className = 'legend-mini'; wrap.appendChild(lg);
    d.labels.forEach(function (lab, i) {
      var row = document.createElement(d.links && d.links[i] ? 'a' : 'div');
      if (d.links && d.links[i]) { row.href = d.links[i]; row.style.color = 'inherit'; }
      row.innerHTML = '<i style="background:' + color(d.colors ? d.colors[i] : null, i) + '"></i>' +
        lab + ' — <b style="color:#E7EDF7">' + fmt(d.values[i]) + '</b>';
      lg.appendChild(row);
    });
  }

  window.ArmaCharts = {render: function () { renderCharts(); }};

  function renderCharts() {
    document.querySelectorAll('[data-chart]').forEach(function (box) {
      if (box.dataset.done) return;
      var d; try { d = JSON.parse(box.dataset.chart); } catch (e) { return; }
      box.dataset.done = '1';
      if (!d.values || !d.values.length) { box.innerHTML = '<div class="empty">Немає даних</div>'; return; }
      ({barh: barH, barv: barV, donut: donut}[d.type] || barH)(box, d);
    });
  }

  function tabs() {
    document.querySelectorAll('[data-tabs]').forEach(function (bar) {
      var links = bar.querySelectorAll('a[data-tab]');
      function show(id) {
        links.forEach(function (a) { a.classList.toggle('on', a.dataset.tab === id); });
        document.querySelectorAll('.tabpane[data-group="' + bar.dataset.tabs + '"]').forEach(function (p) {
          p.classList.toggle('on', p.id === id);
        });
        renderCharts();
      }
      links.forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); show(a.dataset.tab); history.replaceState(null, '', '#' + a.dataset.tab); });
      });
      var h = location.hash.replace('#', '');
      show(h && bar.querySelector('a[data-tab="' + h + '"]') ? h : links[0].dataset.tab);
    });
  }

  function selection() {
    var all = document.querySelector('[data-select-all]');
    var boxes = document.querySelectorAll('input[data-row]');
    var counter = document.querySelector('[data-sel-count]');
    function upd() {
      var n = 0; boxes.forEach(function (b) { if (b.checked) n++; });
      if (counter) counter.textContent = n;
      document.querySelectorAll('[data-need-sel]').forEach(function (b) { b.disabled = n === 0; });
    }
    if (all) all.addEventListener('change', function () { boxes.forEach(function (b) { b.checked = all.checked; }); upd(); });
    boxes.forEach(function (b) { b.addEventListener('change', upd); });
    upd();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-confirm]');
    if (t && !window.confirm(t.dataset.confirm)) e.preventDefault();
  });

  // форма за категорією: показ лише полів обраної категорії
  function categoryFields() {
    var sel = document.querySelector('[data-category-select]');
    if (!sel) return;
    function upd() {
      document.querySelectorAll('[data-cat-fields]').forEach(function (b) {
        b.style.display = b.dataset.catFields === sel.value ? '' : 'none';
      });
    }
    sel.addEventListener('change', upd); upd();
  }

  // розбір координат Google Карт: 50°28'53.1"N 30°35'29.3"E або 50.481417, 30.591472
  function coords() {
    var src = document.querySelector('[data-coords-paste]');
    if (!src) return;
    src.addEventListener('input', function () {
      var s = src.value.trim(), lat, lon, m;
      m = s.match(/(\d+)°(\d+)'([\d.]+)"?\s*([NS])\s*,?\s*(\d+)°(\d+)'([\d.]+)"?\s*([EW])/i);
      if (m) {
        lat = +m[1] + m[2] / 60 + m[3] / 3600; lon = +m[5] + m[6] / 60 + m[7] / 3600;
        if (m[4].toUpperCase() === 'S') lat = -lat; if (m[8].toUpperCase() === 'W') lon = -lon;
      } else if ((m = s.match(/(-?\d+[.,]\d+)\s*[,; ]\s*(-?\d+[.,]\d+)/))) {
        lat = parseFloat(m[1].replace(',', '.')); lon = parseFloat(m[2].replace(',', '.'));
      } else if ((m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) {
        lat = parseFloat(m[1]); lon = parseFloat(m[2]);
      }
      if (lat !== undefined) {
        document.querySelector('[name=lat]').value = lat.toFixed(6);
        document.querySelector('[name=lon]').value = lon.toFixed(6);
        var w = document.querySelector('[data-coords-warn]');
        if (w) w.textContent = (lat < 44 || lat > 53 || lon < 22 || lon > 41) ? 'Координати поза межами України — перевірте, чи не переставлені широта і довгота.' : '';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    tabs(); renderCharts(); selection(); categoryFields(); coords();
    window.addEventListener('resize', function () {
      document.querySelectorAll('[data-chart]').forEach(function (b) { b.innerHTML = ''; delete b.dataset.done; });
      renderCharts();
    });
  });
})();
