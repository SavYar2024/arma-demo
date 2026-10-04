/* Реєстр активів АРМА — демоверсія для GitHub Pages.
   Повністю працює в браузері: дані завантажуються з data/*.json, усі зміни зберігаються
   у сховищі браузера (IndexedDB) лише на цьому комп'ютері. Сервер не потрібен. */
(function () {
  'use strict';
  var D = window.D;
  var $app = document.getElementById('app');
  var S = {};               // дані
  var CH = {assets: {}, tables: {}};   // зміни для збереження
  var PER = 50;

  // ================================================================ утиліти
  function esc(s) { return s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function num(v, d) { if (v === null || v === undefined || v === '') return '—'; v = Number(v); if (isNaN(v)) return esc(v);
    var s = v.toFixed(d || 0).split('.'); s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' '); return s.join(','); }
  function money(v) { if (!v) return '—'; v = Number(v); if (Math.abs(v) >= 1e9) return num(v / 1e9, 2) + ' млрд ₴';
    if (Math.abs(v) >= 1e6) return num(v / 1e6, 1) + ' млн ₴'; return num(v) + ' ₴'; }
  function dt(v) { if (!v) return '—'; var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '.' + m[2] + '.' + m[1] : esc(v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function nowS() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
  function map(pairs) { var o = {}; pairs.forEach(function (p) { o[p[0]] = p[1]; }); return o; }
  function addWorkdays(d, n) { d = new Date(d); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n--; } return d.toISOString().slice(0, 10); }
  function qs(o) { var p = []; for (var k in o) if (o[k] !== undefined && o[k] !== null && o[k] !== '') p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); return p.length ? '?' + p.join('&') : ''; }
  function link(path, o) { return '#' + path + qs(o || {}); }

  var N = {
    MTU: map(D.MTU.map(function (m) { return [m[0], m[1]]; })), DMA: map(D.DMA), DMA_SHORT: D.DMA_SHORT,
    CAT: map(D.CATEGORIES.map(function (c) { return [c[0], c[1]]; })), KIND: map(D.REPORT_KINDS), CX: map(D.COMPLEXITY),
    INV: map(D.INVEST_GRADES), POS: map(D.MGMT_POSSIBLE), REASON: map(D.IMPOSSIBLE_REASONS), WAY: map(D.TRANSFER_WAYS),
    LEGAL: map(D.LEGAL.map(function (l) { return [l[0], l[1]]; })), LS: D.LEGAL_SHORT, LCSS: map(D.LEGAL.map(function (l) { return [l[0], l[2]]; })),
    DEC: map(D.DECISION_TYPES.map(function (x) { return [x[0], x[1]]; })), DECEFF: map(D.DECISION_TYPES.map(function (x) { return [x[0], x[2]]; })),
    EFF: D.EFFECT_NAME, SCOPE: map(D.ARREST_SCOPES), DOC: map(D.DOC_TYPES),
    PROC: map(D.PROCESSES.map(function (p) { return [p[0], p[1]]; })), STEPS: map(D.PROCESSES.map(function (p) { return [p[0], p[3]]; })),
    PERM: map(D.PERMISSIONS)
  };
  N.REGION_MTU = {}; D.MTU.forEach(function (m) { m[3].forEach(function (r) { N.REGION_MTU[r] = m[0]; }); });
  var MTU_OPT = D.MTU.map(function (m) { return [m[0], m[1]]; });
  var CAT_OPT = D.CATEGORIES.map(function (c) { return [c[0], c[1]]; });
  var LEGAL_OPT = D.LEGAL.map(function (l) { return [l[0], l[1]]; });

  // ================================================================ сховище змін (IndexedDB)
  var idb = null;
  function idbOpen() {
    return new Promise(function (res) {
      try {
        var r = indexedDB.open('arma-demo', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { idb = r.result; res(); };
        r.onerror = function () { res(); };
      } catch (e) { res(); }
    });
  }
  function idbGet(k) {
    return new Promise(function (res) {
      if (!idb) return res(null);
      try { var r = idb.transaction('kv').objectStore('kv').get(k); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); }; }
      catch (e) { res(null); }
    });
  }
  function idbPut(k, v) { if (!idb) return; try { idb.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { console.warn(e); } }
  function idbClear() { return new Promise(function (res) { if (!idb) return res(); var t = idb.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = res; t.onerror = res; }); }
  var saveTimer = null, dirty = {};
  function touch(table) { dirty[table] = 1; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
  function flush() {
    var tabs = Object.keys(dirty); dirty = {};
    tabs.forEach(function (t) {
      if (t === 'assets') idbPut('assets', CH.assets);
      else idbPut('t:' + t, S[t]);
    });
    idbPut('meta', {tables: Object.keys(CH.tables), saved: nowS()});
  }
  function setAsset(a, patch) {
    var p = CH.assets[a.id] || (CH.assets[a.id] = {});
    for (var k in patch) { a[k] = patch[k]; p[k] = patch[k]; }
    a.updated_at = nowS(); p.updated_at = a.updated_at;
    touch('assets');
  }
  function changed(table) { CH.tables[table] = 1; touch(table); }
  function nextId(arr) { var m = 0; arr.forEach(function (x) { if (x.id > m) m = x.id; }); return m + 1; }

  // ================================================================ завантаження
  function loadJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ': ' + r.status); return r.json(); }); }
  function boot() {
    $app.innerHTML = '<div class="boot"><img src="logo.png" alt=""><div>Завантаження реєстру активів…</div><div class="mini">≈ 3–5 МБ, лише під час першого відкриття</div></div>';
    Promise.all([idbOpen(), loadJSON('assets-index.json').then(function (ix) {
      return Promise.all(ix.parts.map(function (p) { return loadJSON(p); })).then(function (parts) { ix.rows = [].concat.apply([], parts); return ix; });
    }), loadJSON('base.json')]).then(function (r) {
      var A = r[1], B = r[2], dec = A.cols.map(function (c) { return A.dicts[c] || null; });
      S.assets = A.rows.map(function (row) { var o = {}; A.cols.forEach(function (c, i) { o[c] = dec[i] ? dec[i][row[i]] : row[i]; }); return o; });
      ['decisions', 'links', 'valuations', 'val_assets', 'pools', 'plans', 'steps', 'companies', 'rates', 'users', 'roles', 'files'].forEach(function (k) { S[k] = B[k] || []; });
      S.settings = B.settings || {}; S.audit = [];
      var keys = ['decisions', 'links', 'valuations', 'val_assets', 'pools', 'plans', 'steps', 'companies', 'rates', 'users', 'roles', 'files', 'audit', 'settings'];
      return idbGet('meta').then(function (meta) {
        var tabs = (meta && meta.tables) || [];
        return Promise.all([idbGet('assets')].concat(tabs.map(function (t) { return idbGet('t:' + t); }))).then(function (res) {
          var ap = res[0] || {};
          tabs.forEach(function (t, i) { if (res[i + 1] && keys.indexOf(t) >= 0) { S[t] = res[i + 1]; CH.tables[t] = 1; } });
          CH.assets = ap;
          index();
          S.assets.forEach(function (a) { var p = ap[a.id]; if (p) for (var k in p) a[k] = p[k]; });
          var u = sessionStorage.getItem('demo-user');
          S.user = u ? S.users.filter(function (x) { return x.login === u; })[0] : null;
          window.addEventListener('hashchange', route);
          route();
        });
      });
    }).catch(function (e) {
      $app.innerHTML = '<div class="boot"><b>Не вдалося завантажити дані.</b><div class="mini">' + esc(e.message) +
        '</div><div class="mini">Відкривайте демоверсію через GitHub Pages або локальний вебсервер (не подвійним кліком по файлу).</div></div>';
    });
  }
  function index() {
    S.byId = {}; S.byNo = {}; S.assets.forEach(function (a) { S.byId[a.id] = a; if (!S.byNo[a.asset_no] || !a.is_duplicate) S.byNo[a.asset_no] = a; });
    reindex();
  }
  function reindex() {
    S.decById = {}; S.decisions.forEach(function (d) { S.decById[d.id] = d; });
    S.decByAsset = {}; S.assetsByDec = {};
    S.links.forEach(function (l) { (S.decByAsset[l[1]] = S.decByAsset[l[1]] || []).push(l); (S.assetsByDec[l[0]] = S.assetsByDec[l[0]] || []).push(l); });
    S.poolById = {}; S.pools.forEach(function (p) { S.poolById[p.id] = p; });
    S.valById = {}; S.valuations.forEach(function (v) { S.valById[v.id] = v; });
    S.vaByAsset = {}; S.vaByVal = {};
    S.val_assets.forEach(function (x) { (S.vaByAsset[x[1]] = S.vaByAsset[x[1]] || []).push(x[0]); (S.vaByVal[x[0]] = S.vaByVal[x[0]] || []).push(x[1]); });
    S.compByCode = {}; S.companies.forEach(function (c) { S.compByCode[c.edrpou] = c; });
    S.stepsByPlan = {}; S.steps.forEach(function (s) { (S.stepsByPlan[s.plan_id] = S.stepsByPlan[s.plan_id] || []).push(s); });
    for (var k in S.stepsByPlan) S.stepsByPlan[k].sort(function (a, b) { return a.ord - b.ord; });
    S.filesBy = {}; S.files.forEach(function (f) { var k = f.target_type + ':' + f.target_id; (S.filesBy[k] = S.filesBy[k] || []).push(f); });
    S.rateBy = {}; S.rates.forEach(function (r) { S.rateBy[r.token] = r; });
  }

  // ================================================================ права і видимість
  function perms() { var r = S.roles.filter(function (x) { return x.code === (S.user || {}).role_code; })[0]; return (r && r.perms) || []; }
  function can(p) { return perms().indexOf(p) >= 0; }
  function role() { return S.roles.filter(function (x) { return x.code === (S.user || {}).role_code; })[0] || {}; }
  function inScope(a) {
    if (can('view_all')) return true; var u = S.user;
    return !!((u.mtu_code && a.mtu_code === u.mtu_code) || (u.dept_code && a.dept_code === u.dept_code));
  }
  function canEdit(a, section) {
    if (can('edit_any_asset')) return true; var u = S.user;
    if ((a.category === 'money' || a.category === 'crypto') && section === 'main') return can('edit_money');
    var od = u.dept_code && a.dept_code === u.dept_code, om = u.mtu_code && a.mtu_code === u.mtu_code;
    if (section === 'screening') return (can('edit_screening') && om) || (can('edit_assets') && (od || om));
    return can('edit_assets') && od;
  }
  function log(action, entity, id, details) {
    S.audit.unshift({id: S.audit.length + 1, ts: nowS(), login: S.user ? S.user.login : 'anon', action: action, entity: entity || '', entity_id: id || '', details: details ? JSON.stringify(details).slice(0, 400) : ''});
    if (S.audit.length > 5000) S.audit.length = 5000;
    changed('audit');
  }
  var flashQ = [];
  function flash(msg, kind) { flashQ.push([kind || 'ok', msg]); }

  // ================================================================ правовий стан
  function legalFromDecisions(rows, fallback) {
    var rel = rows.filter(function (r) { return (r.effect || N.DECEFF[r.dtype] || 'none') !== 'none'; });
    if (!rel.length) return fallback;
    rel.sort(function (a, b) { return (a.decision_date || '').localeCompare(b.decision_date || '') || (a.id - b.id); });
    var eff = rel[rel.length - 1].effect || N.DECEFF[rel[rel.length - 1].dtype];
    if (eff === 'close') return 'closed'; if (eff === 'terminate') return 'lost'; if (eff === 'restrict') return 'limited';
    var sc = rel.filter(function (r) { return r.arrest_scope; }).map(function (r) { return r.arrest_scope; });
    if (sc.length && sc[sc.length - 1] === 'disposal_only') return 'limited';
    var tr = rel.some(function (r) { return (r.dtype || '').indexOf('transfer') === 0; });
    return tr ? 'full' : (fallback === 'limited' ? 'limited' : 'unknown');
  }
  function recomputeLegal(a) {
    var rows = (S.decByAsset[a.id] || []).map(function (l) { var d = S.decById[l[0]]; return d && {id: d.id, dtype: d.dtype, decision_date: d.decision_date, arrest_scope: d.arrest_scope, source: d.source, effect: l[2]}; }).filter(Boolean);
    var src = a.legal_src || 'unknown', status = src, note = null;
    if (rows.length) {
      var by = legalFromDecisions(rows, src);
      rows.sort(function (x, y) { return (x.decision_date || '').localeCompare(y.decision_date || '') || x.id - y.id; });
      if (rows[rows.length - 1].source === 'manual' || src === 'unknown') status = by;
      else if (src === 'full' && ['lost', 'closed', 'limited'].indexOf(by) >= 0) { status = 'full'; note = 'Розбіжність: за журналом рішень — «' + N.LS[by] + '», за інвентаризацією — повний обсяг. Потрібна перевірка.'; }
    }
    var last = rows.reduce(function (m, r) { return (r.decision_date || '') > m ? r.decision_date : m; }, '') || null;
    setAsset(a, {legal_status: status, legal_note: note, decisions_count: rows.length, last_decision_date: last});
  }

  // ================================================================ HTML-помічники
  function opts(options, value, empty) {
    var h = empty === null ? '' : '<option value="">' + esc(empty || '— не обрано —') + '</option>';
    options.forEach(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      h += '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>'; });
    return h;
  }
  function sel(name, options, value, empty, attrs) { return '<select name="' + name + '" ' + (attrs || '') + '>' + opts(options, value, empty) + '</select>'; }
  function field(label, name, value, type, req, hint, cls) {
    var inp = type === 'textarea' ? '<textarea name="' + name + '">' + esc(value) + '</textarea>'
      : '<input type="' + (type || 'text') + '" name="' + name + '" value="' + esc(value === null || value === undefined ? '' : value) + '"' + (type === 'number' ? ' step="any"' : '') + '>';
    return '<div class="field ' + (cls || '') + '"><label class="' + (req ? 'req' : '') + '">' + esc(label) + '</label>' + inp + (hint ? '<div class="mini">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function fsel(label, name, options, value, req, hint, cls, attrs) {
    return '<div class="field ' + (cls || '') + '"><label class="' + (req ? 'req' : '') + '">' + esc(label) + '</label>' + sel(name, options, value, undefined, attrs) + (hint ? '<div class="mini">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function chart(type, labels, values, color, colors, links, h) {
    var j = JSON.stringify({type: type, labels: labels, values: values, color: color || null, colors: colors || null, links: links || null}).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    return '<div class="chart" style="height:' + (h || 168) + 'px" data-chart=\'' + j + '\'></div>';
  }
  function legal(code, long) { return '<span class="tag t-' + (N.LCSS[code] || 'unk') + '">' + esc((long ? N.LEGAL : N.LS)[code] || 'Уточнюється') + '</span>'; }
  function invest(code) {
    return code === 'attractive' ? '<span class="tag t-gold">Привабливий</span>' : code === 'conditional' ? '<span class="tag t-lim">Умовно</span>'
      : code === 'unattractive' ? '<span class="tag t-unk">Не привабливий</span>' : code === 'na' ? '<span class="mini">—</span>' : '<span class="mini">не оцінено</span>';
  }
  function kpi(title, value, desc, href, cls) {
    return '<div class="panel kpi"><h3>' + esc(title) + '</h3>' + (href ? '<a class="v ' + (cls || '') + '" href="' + href + '">' + value + '</a>' : '<div class="v ' + (cls || '') + '">' + value + '</div>') + '<div class="d">' + esc(desc || '') + '</div></div>';
  }
  function pager(total, page, base, params) {
    var pages = Math.max(1, Math.ceil(total / PER));
    if (pages <= 1) return '<div class="pager"><span>Записів: ' + num(total) + '</span></div>';
    var h = '<div class="pager"><span>Записів: ' + num(total) + '</span>';
    function a(p, t) { var o = Object.assign({}, params, {page: p}); return '<a href="' + link(base, o) + '">' + t + '</a>'; }
    if (page > 1) h += a(1, '«') + a(page - 1, '‹');
    for (var i = Math.max(1, page - 3); i <= Math.min(pages, page + 3); i++) h += i === page ? '<span class="cur">' + i + '</span>' : a(i, i);
    if (page < pages) h += a(page + 1, '›') + a(pages, '»');
    return h + '<span>сторінка ' + page + ' з ' + pages + '</span></div>';
  }
  function grp(list, key, names) {
    var c = {}; list.forEach(function (a) { var k = typeof key === 'function' ? key(a) : a[key]; k = k === null || k === undefined || k === '' ? '' : k; c[k] = (c[k] || 0) + 1; });
    var arr = Object.keys(c).map(function (k) { return [k, c[k]]; }).sort(function (x, y) { return y[1] - x[1]; });
    return arr;
  }
  function series(arr, names, linkFn, limit) {
    arr = limit ? arr.slice(0, limit) : arr;
    return [arr.map(function (x) { return x[0] === '' ? 'Не визначено' : ((names && names[x[0]]) || x[0]); }), arr.map(function (x) { return x[1]; }),
            arr.map(function (x) { return linkFn ? linkFn(x[0] === '' ? '__none__' : x[0]) : null; })];
  }
  function fullAddress(a) {
    var p = [];
    if (a.region) p.push(/^(м\.|АР)/.test(a.region) ? a.region : a.region + ' обл.');
    if (a.district) p.push(a.district + ' р-н'); if (a.hromada) p.push(a.hromada + ' громада');
    if (a.settl_name) p.push(((a.settl_type || '') + ' ' + a.settl_name).trim());
    if (a.street_name) p.push(((a.street_type || '') + ' ' + a.street_name).trim() + (a.building ? ', ' + a.building : ''));
    return p.join(', ');
  }
  function valState(d) { if (!d) return 'none'; return (Date.now() - new Date(d).getTime()) / 864e5 > D.VALUATION_MAX_AGE_DAYS ? 'expired' : 'valid'; }

  // ================================================================ фото (ліниве завантаження thumbs.json / views.json)
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', MEDIA = {t: null, v: null};
  function thumbImg(f, extra) { return f.thumb ? '<img src="' + f.thumb + '" ' + (extra || '') + ' alt="">' : '<img src="' + BLANK + '" data-m="' + f.id + '" ' + (extra || '') + ' alt="">'; }
  function fillMedia() {
    var els = document.querySelectorAll('img[data-m]'); if (!els.length) return;
    (MEDIA.t ? Promise.resolve(MEDIA.t) : loadJSON('thumbs.json').then(function (j) { MEDIA.t = j; return j; })).then(function (t) {
      document.querySelectorAll('img[data-m]').forEach(function (i) { if (t[i.dataset.m]) i.src = t[i.dataset.m]; i.removeAttribute('data-m'); });
    }).catch(function () {});
  }
  function lightbox(id) {
    var f = S.files.filter(function (x) { return String(x.id) === String(id); })[0]; if (!f) return;
    var box = document.createElement('div');
    box.className = 'lightbox'; box.style.cssText = 'position:fixed;inset:0;background:rgba(5,8,15,.92);z-index:99;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    box.innerHTML = '<div class="mini">Завантаження…</div>'; box.onclick = function () { box.remove(); }; document.body.appendChild(box);
    function show(src) { box.innerHTML = '<img src="' + src + '" style="max-width:94vw;max-height:92vh;border-radius:6px">'; }
    if (f.view) return show(f.view);
    (MEDIA.v ? Promise.resolve(MEDIA.v) : loadJSON('views.json').then(function (j) { MEDIA.v = j; return j; })).then(function (v) { show(v[f.id] || (MEDIA.t || {})[f.id] || BLANK); });
  }

  // ================================================================ каркас
  function shell(title, sub, actions, content) {
    var r = location.hash.slice(1).split('?')[0] || '/';
    function nav(href, label, match) { return '<a href="#' + href + '" class="' + ((match ? r.indexOf(match) === 0 : r === href) ? 'on' : '') + '">' + label + '</a>'; }
    var u = S.user, ro = role();
    var h = '<div class="shell"><aside class="rail"><div class="brand"><img src="logo.png" alt="АРМА"><div><b>Реєстр активів</b><span>АРМА · демоверсія</span></div></div><nav>' +
      '<div class="grp">Аналітика</div>' + nav('/', 'Огляд портфеля') +
      '<div class="grp">Категорії активів</div>' + D.CATEGORIES.map(function (c) { return nav('/c/' + c[0], c[1], '/c/' + c[0]); }).join('') +
      '<div class="grp">Робота з активами</div>' + nav('/assets', 'Реєстр активів', '/asset') + nav('/pools', 'Пули активів', '/pool') +
      nav('/plans', 'Плани дій (CRM)', '/plans') + nav('/decisions', 'Судові рішення', '/decision') + nav('/valuations', 'Оцінки', '/valuation') +
      ((can('export') || can('view_all')) ? nav('/reports', 'Звіти', '/reports') : '');
    if (can('manage_users') || can('manage_roles') || can('view_audit') || can('system') || can('manage_public')) {
      h += '<div class="grp">Адміністрування</div>' + (can('manage_users') ? nav('/admin/users', 'Користувачі', '/admin/users') : '') +
        (can('manage_roles') ? nav('/admin/roles', 'Ролі та права', '/admin/roles') : '') + (can('view_audit') ? nav('/admin/audit', 'Журнал дій', '/admin/audit') : '') +
        (can('manage_public') ? nav('/admin/public', 'Публічний сайт', '/admin/public') : '') + (can('system') ? nav('/admin/system', 'Демо-дані', '/admin/system') : '');
    }
    h += '</nav><div class="who"><b>' + esc(u.full_name) + '</b>' + esc(ro.name || '') + (u.mtu_code ? ' · ' + esc(N.MTU[u.mtu_code]) : u.dept_code ? ' · ' + esc(N.DMA_SHORT[u.dept_code]) : '') +
      '<div style="margin-top:6px"><a href="#/login" data-act="logout">Змінити користувача</a></div></div></aside><main>' +
      '<div class="topbar"><div><h1>' + esc(title) + '</h1><p class="sub">' + esc(sub || '') + '</p></div><div class="row-actions">' + (actions || '') +
      '<div class="demo" title="Дані знеособлено, зміни зберігаються лише у вашому браузері">Демоверсія</div></div></div>';
    flashQ.forEach(function (f) { h += '<div class="flash ' + f[0] + '">' + esc(f[1]) + '</div>'; }); flashQ = [];
    return h + content + '</main></div>';
  }
  function render(html) { $app.innerHTML = html; window.scrollTo(0, 0); if (window.ArmaCharts) window.ArmaCharts.render(); initTabs(); initSel(); initCat(); fillMedia(); }
  function initTabs() {
    document.querySelectorAll('[data-tabbar]').forEach(function (bar) {
      var g = bar.dataset.tabbar, links = bar.querySelectorAll('a[data-tab]');
      function show(id) { links.forEach(function (a) { a.classList.toggle('on', a.dataset.tab === id); });
        document.querySelectorAll('.tabpane[data-group="' + g + '"]').forEach(function (p) { p.classList.toggle('on', p.id === id); });
        if (window.ArmaCharts) window.ArmaCharts.render(); sessionStorage.setItem('tab:' + g, id); }
      links.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); show(a.dataset.tab); }); });
      var want = sessionStorage.getItem('tab:' + g);
      show(want && bar.querySelector('a[data-tab="' + want + '"]') ? want : links[0].dataset.tab);
    });
  }
  function initSel() {
    var all = document.querySelector('[data-select-all]'), boxes = document.querySelectorAll('input[data-row]'), cnt = document.querySelector('[data-sel-count]');
    function upd() { var n = 0; boxes.forEach(function (b) { if (b.checked) n++; }); if (cnt) cnt.textContent = n;
      document.querySelectorAll('[data-need-sel]').forEach(function (b) { b.disabled = n === 0; }); }
    if (all) all.addEventListener('change', function () { boxes.forEach(function (b) { b.checked = all.checked; }); upd(); });
    boxes.forEach(function (b) { b.addEventListener('change', upd); }); upd();
  }
  function initCat() {
    var s = document.querySelector('[data-category-select]'); if (!s) return;
    function upd() { document.querySelectorAll('[data-cat-fields]').forEach(function (b) { b.style.display = b.dataset.catFields === s.value ? '' : 'none'; }); }
    s.addEventListener('change', upd); upd();
    var src = document.querySelector('[data-coords-paste]');
    if (src) src.addEventListener('input', function () {
      var t = src.value.trim(), m, lat, lon;
      if ((m = t.match(/(\d+)°(\d+)'([\d.]+)"?\s*([NS])\s*,?\s*(\d+)°(\d+)'([\d.]+)"?\s*([EW])/i))) { lat = +m[1] + m[2] / 60 + m[3] / 3600; lon = +m[5] + m[6] / 60 + m[7] / 3600; }
      else if ((m = t.match(/(-?\d+[.,]\d+)\s*[,; ]\s*(-?\d+[.,]\d+)/))) { lat = parseFloat(m[1].replace(',', '.')); lon = parseFloat(m[2].replace(',', '.')); }
      if (lat !== undefined) { document.querySelector('[name=lat]').value = lat.toFixed(6); document.querySelector('[name=lon]').value = lon.toFixed(6); }
    });
  }

  // ================================================================ маршрутизація
  var routes = [];
  function on(re, fn) { routes.push([re, fn]); }
  function params() { var q = location.hash.split('?')[1] || '', o = {}; q.split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); o[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); }); return o; }
  function route() {
    document.querySelectorAll('.lightbox').forEach(function (b) { b.remove(); });
    var path = location.hash.slice(1).split('?')[0] || '/';
    if (path.indexOf('/public') === 0) { return publicRoute(path); }
    if (!S.user && path !== '/login') { location.hash = '#/login'; return; }
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i][0]);
      if (m) { try { return routes[i][1].apply(null, m.slice(1).concat([params()])); } catch (e) { console.error(e); return render(shell('Помилка', '', '', '<div class="flash err">' + esc(e.message) + '</div>')); } }
    }
    render(shell('Сторінку не знайдено', '', '', '<div class="empty">Немає такої сторінки. <a href="#/">На головну</a></div>'));
  }
  function deny() { render(shell('Недостатньо прав', '', '', '<div class="flash err">Ваша роль не має права на цю дію. Змініть користувача (ліворуч унизу).</div>')); }

  // ================================================================ вхід
  on(/^\/login$/, function () {
    var groups = {}; S.users.forEach(function (u) { var r = S.roles.filter(function (x) { return x.code === u.role_code; })[0]; (groups[r ? r.name : u.role_code] = groups[r ? r.name : u.role_code] || []).push(u); });
    var h = '<div class="login-demo"><div class="panel" style="max-width:860px;margin:40px auto"><div style="display:flex;gap:14px;align-items:center;margin-bottom:10px"><img src="logo.png" style="width:56px">' +
      '<div><h1 style="margin:0">Реєстр активів АРМА</h1><p class="sub">Демоверсія для ознайомлення · оберіть, під ким увійти</p></div></div>' +
      '<p class="mini">У демоверсії пароль не потрібен: оберіть користувача — і ви побачите систему так, як її бачить ця роль (МТУ — лише свої активи, відділ ДМА — свій відділ). ' +
      'Дані з інвентаризації знеособлено. Усе, що ви змінюєте, зберігається тільки у вашому браузері.</p><div class="grid g3">';
    Object.keys(groups).forEach(function (g) {
      h += '<div><h3 style="margin:10px 0 6px;font-size:13px;color:var(--gold)">' + esc(g) + '</h3>' + groups[g].map(function (u) {
        return '<a class="tile" href="#/" data-act="login" data-login="' + esc(u.login) + '" style="margin-bottom:6px"><b style="font-size:14px">' + esc(u.full_name) + '</b><span>' + esc(u.login) + (u.mtu_code ? ' · ' + esc(N.MTU[u.mtu_code]) : u.dept_code ? ' · ' + esc(N.DMA_SHORT[u.dept_code]) : '') + '</span></a>';
      }).join('') + '</div>';
    });
    h += '</div><p class="mini" style="margin-top:14px"><a href="#/public">Публічний каталог активів →</a></p></div></div>';
    $app.innerHTML = h;
  });

  // ================================================================ фільтри реєстру
  var FILTERS = ['q', 'category', 'mtu', 'dept', 'legal', 'invest', 'reason', 'way', 'complexity', 'region', 'zone', 'photo', 'val', 'plan', 'pool', 'review', 'discrepancy', 'unassigned', 'public', 'publish', 'company', 'sort', 'kind'];
  function planIndex() {
    var act = {}, over = {}, t = today();
    S.plans.forEach(function (p) { if (p.status !== 'active') return; var k = p.target_type + ':' + p.target_id; act[k] = 1;
      (S.stepsByPlan[p.id] || []).forEach(function (s) { if ((s.status === 'active' || s.status === 'review') && s.due_date && s.due_date < t) over[k] = 1; }); });
    return {act: act, over: over};
  }
  function filterAssets(f, base) {
    var list = (base || S.assets).filter(inScope), words = (f.q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6), pi = null;
    function eq(field, v) { return v === '__none__' ? function (a) { return !a[field]; } : function (a) { return a[field] === v; }; }
    var tests = [];
    if (words.length) tests.push(function (a) { var s = a._s || (a._s = [a.asset_no, a.name, a.cadastral, a.company_code, a.region, a.settl_name, a.owner, a.vid].join(' ').toLowerCase());
      return words.every(function (w) { return s.indexOf(w) >= 0; }); });
    [['category', 'category'], ['mtu', 'mtu_code'], ['dept', 'dept_code'], ['legal', 'legal_status'], ['invest', 'invest_grade'], ['reason', 'impossible_reason'],
     ['way', 'transfer_way'], ['complexity', 'complexity'], ['region', 'region'], ['zone', 'zone'], ['company', 'company_code'], ['kind', 'report_kind']].forEach(function (p) { if (f[p[0]]) tests.push(eq(p[1], f[p[0]])); });
    if (f.photo === 'yes') tests.push(function (a) { return a.photo_count > 0; }); if (f.photo === 'no') tests.push(function (a) { return !a.photo_count; });
    if (f.val === 'yes') tests.push(function (a) { return a.val_amount || a.val_source === 'Групова оцінка'; });
    if (f.val === 'no') tests.push(function (a) { return !a.val_amount && a.val_source !== 'Групова оцінка'; });
    if (f.val === 'group') tests.push(function (a) { return a.val_source === 'Групова оцінка'; });
    if (f.pool === 'any') tests.push(function (a) { return a.pool_id; }); else if (f.pool === 'none') tests.push(function (a) { return !a.pool_id; });
    else if (f.pool) tests.push(function (a) { return String(a.pool_id) === f.pool; });
    if (f.review) tests.push(function (a) { return a.needs_review; }); if (f.discrepancy) tests.push(function (a) { return a.legal_note; });
    if (f.unassigned) tests.push(function (a) { return !a.mtu_code && !a.dept_code; });
    if (f.public) tests.push(function (a) { return a.public_candidate; }); if (f.publish) tests.push(function (a) { return a.publish; });
    if (f.plan) { pi = planIndex(); tests.push(function (a) { var k1 = 'asset:' + a.id, k2 = 'pool:' + a.pool_id;
      return f.plan === 'active' ? (pi.act[k1] || pi.act[k2]) : f.plan === 'none' ? !(pi.act[k1] || pi.act[k2]) : (pi.over[k1] || pi.over[k2]); }); }
    list = list.filter(function (a) { for (var i = 0; i < tests.length; i++) if (!tests[i](a)) return false; return true; });
    var s = f.sort;
    if (s === 'value') list.sort(function (a, b) { return (b.val_amount || 0) - (a.val_amount || 0); });
    else if (s === 'name') list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    else if (s === 'decision') list.sort(function (a, b) { return (b.last_decision_date || '').localeCompare(a.last_decision_date || ''); });
    else if (s === 'updated') list.sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); });
    return list;
  }
  function filtersForm(f, base, fixedCat) {
    var more = f.reason || f.way || f.zone || f.photo || f.val || f.plan || f.pool || f.review || f.discrepancy || f.unassigned || f.public || f.complexity || f.region;
    return '<form class="filters" data-act="filter" data-base="' + base + '"><input name="q" value="' + esc(f.q) + '" placeholder="Номер, назва, ЄДРПОУ, кадастровий номер, область" style="min-width:300px;flex:1">' +
      (fixedCat ? '' : sel('category', CAT_OPT, f.category, 'Усі категорії')) + sel('mtu', MTU_OPT.concat([['__none__', 'Без МТУ']]), f.mtu, 'Усі МТУ') +
      sel('dept', D.DMA.concat([['__none__', 'Без відділу ДМА']]), f.dept, 'Усі відділи ДМА') + sel('legal', LEGAL_OPT, f.legal, 'Правовий стан') +
      sel('invest', D.INVEST_GRADES, f.invest, 'Привабливість') + '<button class="btn">Знайти</button><a class="btn plain" href="#' + base + '">Скинути</a>' +
      '<details style="width:100%"' + (more ? ' open' : '') + '><summary class="mini" style="cursor:pointer;margin:4px 0 8px">Додаткові фільтри</summary><div class="filters" style="margin:0">' +
      sel('reason', D.IMPOSSIBLE_REASONS, f.reason, 'Причина неможливості') + sel('way', D.TRANSFER_WAYS, f.way, 'Спосіб передачі') +
      sel('complexity', D.COMPLEXITY, f.complexity, 'Простий / складний / пул') + sel('region', D.REGIONS, f.region, 'Усі області') + sel('zone', D.ZONES, f.zone, 'Зона') +
      sel('photo', [['yes', 'Є фото'], ['no', 'Немає фото']], f.photo, 'Фото') + sel('val', [['yes', 'Є оцінка'], ['no', 'Немає оцінки'], ['group', 'Групова оцінка']], f.val, 'Оцінка') +
      sel('plan', [['active', 'План діє'], ['overdue', 'Прострочений крок'], ['none', 'Без плану']], f.plan, 'План дій') + sel('pool', [['any', 'У пулі'], ['none', 'Не в пулі']], f.pool, 'Пул') +
      sel('review', [['1', 'Потребує перевірки']], f.review, 'Перевірка') + sel('discrepancy', [['1', 'Розбіжність у правовому стані']], f.discrepancy, 'Розбіжності') +
      sel('unassigned', [['1', 'Не закріплено']], f.unassigned, 'Закріплення') + sel('public', [['1', 'Публічний за критерієм']], f.public, 'Критерій критичності') +
      sel('sort', [['no', 'за номером'], ['name', 'за назвою'], ['value', 'за оцінкою'], ['decision', 'за датою рішення'], ['updated', 'нещодавно змінені']], f.sort, 'Сортування') +
      '</div></details></form>';
  }
  function assetTable(rows, back) {
    var h = '<form data-act="bulk" data-back="' + esc(back) + '"><div class="wrap-tbl"><table><thead><tr><th style="width:26px"><input type="checkbox" data-select-all style="width:auto"></th><th>№ активу</th><th>Найменування</th><th>Підрозділ</th><th>Правовий стан</th><th>Привабливість</th><th class="num">Оцінка</th><th class="num">Фото</th><th>Пул</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var p = r.pool_id && S.poolById[r.pool_id];
      h += '<tr><td><input type="checkbox" name="ids" value="' + r.id + '" data-row style="width:auto"></td><td class="nowrap"><a class="id" href="#/asset/' + r.id + '">' + esc(r.asset_no) + '</a>' + (r.zone === 'Червона зона' ? '<span class="sub" style="color:var(--lost)">червона зона</span>' : '') + '</td>' +
        '<td>' + esc((r.name || '').slice(0, 110)) + ((r.name || '').length > 110 ? '…' : '') + '<span class="sub">' + esc(N.CAT[r.category] || '') + (r.region ? ' · ' + esc(r.region) : '') + '</span></td>' +
        '<td class="mini">' + (r.mtu_code ? esc(N.MTU[r.mtu_code]) + '<br>' : '') + (r.dept_code ? esc(N.DMA_SHORT[r.dept_code]) : '') + (!r.mtu_code && !r.dept_code ? '<span class="tag t-lim">не закріплено</span>' : '') + (r.dma_manager ? '<span class="sub">' + esc(r.dma_manager) + '</span>' : '') + '</td>' +
        '<td>' + legal(r.legal_status) + (r.legal_note ? '<span class="sub" style="color:var(--lim)">розбіжність</span>' : '') + (r.impossible_reason ? '<span class="sub">' + esc(N.REASON[r.impossible_reason]) + '</span>' : '') + '</td>' +
        '<td>' + invest(r.invest_grade) + (r.transfer_way && r.transfer_way !== 'none' ? '<span class="sub">' + esc(N.WAY[r.transfer_way]) + '</span>' : '') + '</td>' +
        '<td class="num nowrap">' + (r.val_amount ? money(r.val_amount) : r.val_source === 'Групова оцінка' ? '<span class="mini">групова</span>' : '—') + (r.val_date ? '<span class="sub">' + dt(r.val_date) + '</span>' : '') + '</td>' +
        '<td class="num">' + (r.photo_count || '—') + '</td><td class="mini">' + (p ? '<a href="#/pool/' + p.id + '">' + esc(p.code) + '</a>' : '—') + '</td></tr>';
    });
    if (!rows.length) h += '<tr><td colspan="9"><div class="empty">За умовами пошуку активів не знайдено.</div></td></tr>';
    h += '</tbody></table></div>';
    if (rows.length) {
      var mg = S.users.filter(function (u) { return u.dept_code; });
      h += '<div class="sel-bar"><span class="mini">Обрано: <b data-sel-count>0</b></span><select name="action" style="min-width:230px"><option value="">— масова дія —</option>' +
        ((can('edit_assets') || can('edit_any_asset')) ? '<option value="dept">Закріпити за відділом ДМА</option><option value="mtu">Закріпити за МТУ</option><option value="manager">Призначити менеджера ДМА</option><option value="invest">Встановити привабливість</option>' : '') +
        (can('manage_pools') ? '<option value="pool_new">Створити пул з обраних</option><option value="pool_add">Додати до пулу</option><option value="pool_remove">Вилучити з пулу</option>' : '') +
        (can('manage_public') ? '<option value="publish">Опублікувати на сайті</option><option value="unpublish">Зняти з публікації</option>' : '') +
        '</select><select name="value" style="min-width:230px"><option value="">— значення —</option><optgroup label="Відділ ДМА">' + opts(D.DMA, null, null) + '</optgroup><optgroup label="МТУ">' + opts(MTU_OPT, null, null) +
        '</optgroup><optgroup label="Менеджер ДМА">' + opts(mg.map(function (u) { return [u.id, u.full_name + ' — ' + (N.DMA_SHORT[u.dept_code] || '')]; }), null, null) +
        '</optgroup><optgroup label="Привабливість">' + opts(D.INVEST_GRADES, null, null) + '</optgroup><optgroup label="Пул">' + opts(S.pools.map(function (p) { return [p.id, p.code + ' — ' + (p.name || '').slice(0, 50)]; }), null, null) +
        '</optgroup></select><button class="btn gold" data-need-sel>Застосувати</button></div>';
    }
    return h + '</form>';
  }
  function pageOf(list, f) { var page = Math.max(1, parseInt(f.page || 1, 10)); return {page: page, rows: list.slice((page - 1) * PER, page * PER)}; }

  // ================================================================ огляд
  on(/^\/$/, function () {
    var A = S.assets.filter(inScope), att = A.filter(function (a) { return a.invest_grade === 'attractive'; }), t = today();
    function c(fn) { return A.filter(fn).length; }
    var valTotal = S.valuations.filter(function (v) { return v.is_current && v.value_uah && !/^Інвентаризація/.test(v.source || ''); }).reduce(function (s, v) { return s + v.value_uah; }, 0);
    var act = S.plans.filter(function (p) { return p.status === 'active'; }), steps = [];
    act.forEach(function (p) { (S.stepsByPlan[p.id] || []).forEach(function (s) { if (s.status === 'active' || s.status === 'review') steps.push([p, s]); }); });
    var overdue = steps.filter(function (x) { return x[1].due_date && x[1].due_date < t; }).length, review = steps.filter(function (x) { return x[1].status === 'review'; }).length;
    var L = function (o) { return link('/assets', o); };
    var h = '<div class="grid g5">' + kpi('Активів в обліку', num(A.length), 'інвентаризація + оновлення', '#/assets') +
      kpi('Інвестиційно привабливі', num(att.length), 'ключовий фокус ДМА', L({invest: 'attractive'})) +
      kpi('Передано за договором', num(c(function (a) { return a.transfer_way === 'manager_contract'; })), 'управитель визначений', L({way: 'manager_contract'})) +
      kpi('Пошук управителя', num(c(function (a) { return a.transfer_way === 'manager_search'; })), 'конкурсний відбір', L({way: 'manager_search'})) +
      kpi('Реалізація', num(c(function (a) { return a.transfer_way === 'realization'; })), 'електронні торги', L({way: 'realization'})) + '</div><div class="grid g5" style="margin-top:14px">' +
      kpi('Оцінена вартість', num(valTotal, 2) + ' ₴', 'актуальні оцінки модуля оцінок', '#/valuations') + kpi('Пулів активів', num(S.pools.length), 'оцінка і план — на рівні пулу', '#/pools') +
      kpi('Активних планів дій', num(act.length), review + ' кроків очікують підтвердження', '#/plans') + kpi('Прострочені кроки', num(overdue), 'строк кроку минув', link('/plans', {state: 'overdue'}), 'overdue') +
      kpi('Без оцінки', num(att.filter(function (a) { return !a.val_amount && !a.pool_id && a.val_source !== 'Групова оцінка'; }).length), 'привабливі поза пулами', L({invest: 'attractive', val: 'no', pool: 'none'})) + '</div>';
    var k = series(grp(att, 'report_kind'), N.KIND, function (v) { return L({invest: 'attractive', kind: v}); }),
      cx = series(grp(att, 'complexity'), N.CX, function (v) { return L({invest: 'attractive', complexity: v}); }),
      w = series(grp(att, 'transfer_way'), N.WAY, function (v) { return L({invest: 'attractive', way: v}); }),
      dp = series(grp(att, 'dept_code'), N.DMA_SHORT, function (v) { return L({invest: 'attractive', dept: v}); });
    h += '<h2>Інвестиційно привабливі активи — структура за наказом</h2><div class="grid g4"><div class="panel"><h3>За видом активу</h3>' + chart('barh', k[0], k[1], 'gold', null, k[2]) + '</div>' +
      '<div class="panel"><h3>Прості, складні, пули</h3>' + chart('donut', cx[0], cx[1], null, ['#35D6E8', '#8B7BF7', '#F5C518', '#6E7F9E'], cx[2]) + '</div>' +
      '<div class="panel"><h3>Спосіб передачі</h3>' + chart('barh', w[0], w[1], 'ok', null, w[2]) + '</div><div class="panel"><h3>За відділами ДМА</h3>' + chart('barh', dp[0], dp[1], 'blue', null, dp[2]) + '</div></div>';
    var fun = {}; steps.forEach(function (x) { var key = x[0].process + '|' + x[1].ord; var o = fun[key] || (fun[key] = {p: x[0].process, ord: x[1].ord, name: x[1].name, n: 0, o: 0}); o.n++; if (x[1].due_date && x[1].due_date < t) o.o++; });
    var fl = Object.keys(fun).map(function (k2) { return fun[k2]; }).sort(function (a, b) { return a.p.localeCompare(b.p) || a.ord - b.ord; });
    h += '<h2>Етапи робіт за планами дій</h2><div class="panel"><table><thead><tr><th>Процес</th><th>Поточний крок</th><th class="num">Планів</th><th class="num">Прострочено</th></tr></thead><tbody>' +
      (fl.length ? fl.map(function (f) { return '<tr><td class="mini">' + esc(N.PROC[f.p]) + '</td><td>' + f.ord + '. ' + esc(f.name) + '</td><td class="num"><a href="' + link('/plans', {process: f.p, step: f.ord}) + '">' + f.n + '</a></td><td class="num ' + (f.o ? 'overdue' : '') + '">' + (f.o || '—') + '</td></tr>'; }).join('') : '<tr><td colspan="4"><div class="empty">Активних планів немає</div></td></tr>') + '</tbody></table></div>';
    var rs = {}; A.forEach(function (a) { if (a.impossible_reason) rs[a.impossible_reason] = (rs[a.impossible_reason] || 0) + 1; });
    h += '<h2>Ефективне управління неможливе — переліки за наказом</h2><div class="tiles">' + D.IMPOSSIBLE_REASONS.map(function (r) { return '<a class="tile ' + (rs[r[0]] ? 'warn' : '') + '" href="' + L({reason: r[0]}) + '"><b>' + num(rs[r[0]] || 0) + '</b><span>' + esc(r[1]) + '</span></a>'; }).join('') + '</div>';
    var leg = {}; A.forEach(function (a) { leg[a.legal_status] = (leg[a.legal_status] || 0) + 1; }); var tot = A.length || 1;
    h += '<h2>Обсяг повноважень АРМА</h2><div class="panel"><div class="bar">' + D.LEGAL.map(function (l) { var v = leg[l[0]] || 0; return v ? '<div class="s-' + l[2] + '" style="width:' + (v * 100 / tot).toFixed(1) + '%" title="' + esc(l[1]) + '">' + (v * 100 / tot > 5 ? (v * 100 / tot).toFixed(1) + '%' : '') + '</div>' : ''; }).join('') +
      '</div><div class="legend">' + D.LEGAL.map(function (l) { return '<div class="l-' + l[2] + '"><b><a href="' + L({legal: l[0]}) + '" style="color:inherit">' + num(leg[l[0]] || 0) + '</a></b>' + esc(l[1]) + '</div>'; }).join('') + '</div></div>';
    var ct = series(grp(A, 'category'), N.CAT, function (v) { return '#/c/' + v; }), iv = series(grp(A, 'invest_grade'), N.INV, function (v) { return L({invest: v}); }),
      mt = series(grp(A.filter(function (a) { return a.mtu_code; }), 'mtu_code'), N.MTU, function (v) { return L({mtu: v}); }), de = series(grp(A.filter(function (a) { return a.dept_code; }), 'dept_code'), N.DMA_SHORT, function (v) { return L({dept: v}); });
    h += '<h2>Структура портфеля</h2><div class="grid g4"><div class="panel"><h3>Категорії</h3>' + chart('barh', ct[0], ct[1], 'cyan', null, ct[2]) + '</div><div class="panel"><h3>Інвестиційна привабливість</h3>' + chart('donut', iv[0], iv[1], null, ['#F5C518', '#3DD68C', '#F5A524', '#6E7F9E', '#5B7DB1'], iv[2]) +
      '</div><div class="panel"><h3>За МТУ</h3>' + chart('barh', mt[0], mt[1], 'gold', null, mt[2]) + '</div><div class="panel"><h3>За відділами ДМА</h3>' + chart('barh', de[0], de[1], 'violet', null, de[2]) + '</div></div>';
    render(shell('Огляд портфеля', 'Пріоритет — інвестиційно привабливі активи та проходження етапів робіт',
      '<form data-act="search" style="display:flex;gap:6px"><input name="q" placeholder="Номер, назва, кадастровий номер" style="min-width:260px"><button class="btn">Знайти</button></form>', h));
  });

  // ================================================================ реєстр
  on(/^\/assets$/, function (f) {
    var list = filterAssets(f), pg = pageOf(list, f), p = Object.assign({}, f); delete p.page;
    render(shell('Реєстр активів', 'Пошук, фільтри, масові дії', can('export') ? '<a class="btn gold" href="#" data-act="csv" data-q="' + esc(JSON.stringify(p)) + '">Вивантажити (CSV для Excel)</a>' : '',
      filtersForm(f, '/assets') + pager(list.length, pg.page, '/assets', p) + assetTable(pg.rows, location.hash) + pager(list.length, pg.page, '/assets', p)));
  });

  // ================================================================ категорії
  on(/^\/c\/(\w+)$/, function (code, f) {
    if (!N.CAT[code]) return route404();
    var all = S.assets.filter(function (a) { return a.category === code && inScope(a); });
    var ff = Object.assign({}, f, {category: code}), list = filterAssets(ff, all), pg = pageOf(list, f), p = Object.assign({}, f); delete p.page;
    var C = function (o) { return link('/c/' + code, o); };
    var h = '<div class="grid g5">' + kpi('Активів', num(all.length), N.CAT[code], C({})) + kpi('Інвестиційно привабливі', num(all.filter(function (a) { return a.invest_grade === 'attractive'; }).length), 'фокус ДМА', C({invest: 'attractive'})) +
      kpi('Повний обсяг повноважень', num(all.filter(function (a) { return a.legal_status === 'full'; }).length), 'правовий стан', C({legal: 'full'}));
    var x = '';
    if (code === 'crypto') {
      var tot = 0; var rows = all.map(function (a) { var d = a.details || {}, r = S.rateBy[d.token], v = r && d.units ? Number(d.units) * r.uah : null; tot += v || 0; return [a, d, r, v]; });
      h += kpi('Вартість за курсом', money(tot), 'кількість × курс агрегатора');
      x = '<h2>Криптоактиви <span class="mini">відповідальний — Відділ грошових коштів та банківських металів ДМА</span></h2><div class="panel"><div class="wrap-tbl"><table><thead><tr><th>№ активу</th><th>Криптоактив</th><th class="num">Кількість на момент арешту</th><th class="num">Курс, ₴</th><th class="num">Вартість, ₴</th><th>Зберігання</th><th>Лот Prozorro.Продажі</th><th>Правовий стан</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td><a class="id" href="#/asset/' + r[0].id + '">' + esc(r[0].asset_no) + '</a></td><td>' + esc(r[1].token || '—') + '<span class="sub">' + esc(r[1].network || '') + '</span></td><td class="num">' + num(r[1].units, 2) + '</td><td class="num">' + (r[2] ? num(r[2].uah, 2) : '—') + '</td><td class="num"><b>' + (r[3] ? money(r[3]) : '—') + '</b></td><td class="mini">ХОЛОДНІ ГАМАНЦІ' + (r[1].custodian ? '<br>кастодіан: ' + esc(r[1].custodian) : '') + '</td><td class="mini mono">' + esc(r[1].prozorro_lot || '—') + '</td><td>' + legal(r[0].legal_status) + '</td></tr>'; }).join('') +
        '</tbody></table></div><p class="mini">Курс — з агрегатора CoinGecko на момент перегляду (у демо — демонстраційний). Адреси гаманців у демоверсії приховано.</p>' +
        (can('edit_money') || can('system') ? '<form data-act="rate" style="display:flex;gap:6px;margin-top:8px">' + sel('token', ['USDT', 'USDC', 'BTC', 'ETH', 'TRX'], 'USDT', null) + '<input name="uah" placeholder="курс, ₴" style="width:110px"><button class="btn">Внести курс вручну</button></form>' : '') + '</div>';
    } else h += kpi('Оцінена вартість', money(all.reduce(function (s, a) { return s + (a.val_amount || 0); }, 0)), 'оцінки активів поза пулами');
    h += kpi('Не закріплено', num(all.filter(function (a) { return !a.mtu_code && !a.dept_code; }).length), 'без МТУ і відділу ДМА', C({unassigned: 1}), 'overdue') + '</div>' + x;
    if (code === 'money') {
      var cur = {}, place = {}, kind = {};
      all.forEach(function (a) { var d = a.details || {}; if (typeof d.amount === 'number') cur[d.currency || 'н/д'] = (cur[d.currency || 'н/д'] || 0) + d.amount; place[d.placement || 'Не визначено'] = (place[d.placement || 'Не визначено'] || 0) + 1; kind[d.money_kind || 'Не визначено'] = (kind[d.money_kind || 'Не визначено'] || 0) + 1; });
      var o2a = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); };
      var pl = o2a(place), kd = o2a(kind);
      h += '<h2>Кошти, метали, цінні папери — розміщення</h2><div class="grid g3"><div class="panel"><h3>Суми за валютами</h3><table><tbody>' + o2a(cur).map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + num(r[1], 2) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="panel"><h3>Розміщення</h3>' + chart('barh', pl.map(function (r) { return r[0]; }), pl.map(function (r) { return r[1]; }), 'ok') + '</div><div class="panel"><h3>Вид</h3>' + chart('barh', kd.map(function (r) { return r[0]; }), kd.map(function (r) { return r[1]; }), 'gold') + '</div></div>';
    }
    if (code === 'land') h += landMap(all);
    if (code === 'corporate') {
      var cos = {}; all.forEach(function (a) { if (a.company_code) { var o = cos[a.company_code] || (cos[a.company_code] = {c: a.company_code, n: 0}); o.n++; } });
      var st = {}; Object.keys(cos).forEach(function (k2) { var s = (S.compByCode[k2] || {}).status || 'Не визначено'; st[s] = (st[s] || 0) + 1; });
      var top = Object.keys(cos).map(function (k2) { return cos[k2]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 15);
      h += '<h2>Товариства <span class="mini">' + Object.keys(cos).length + ' товариств</span></h2><div class="tiles" style="margin-bottom:12px">' + Object.keys(st).map(function (s) { return '<a class="tile ' + (/банкрут/.test(s) ? 'bad' : /припин/i.test(s) ? 'warn' : '') + '" href="' + link('/companies', {status: s}) + '"><b>' + st[s] + '</b><span>' + esc(s) + '</span></a>'; }).join('') + '</div>' +
        '<div class="panel"><div class="wrap-tbl"><table><thead><tr><th>ЄДРПОУ</th><th>Товариство</th><th>Стан</th><th class="num">Активів</th></tr></thead><tbody>' + top.map(function (r) { var co = S.compByCode[r.c] || {}; return '<tr><td class="mono"><a href="#/company/' + esc(r.c) + '">' + esc(r.c) + '</a></td><td>' + esc(co.name || '—') + '</td><td>' + compStatus(co.status) + '</td><td class="num">' + r.n + '</td></tr>'; }).join('') +
        '</tbody></table></div><p class="mini"><a href="#/companies">Усі товариства →</a></p></div>';
    }
    var lg = series(grp(all, 'legal_status'), N.LS, function (v) { return C({legal: v}); }), iv = series(grp(all, 'invest_grade'), N.INV, function (v) { return C({invest: v}); }),
      wy = series(grp(all, 'transfer_way'), N.WAY, function (v) { return C({way: v}); }), dp = series(grp(all, 'dept_code'), N.DMA_SHORT, function (v) { return C({dept: v}); }),
      mt = series(grp(all, 'mtu_code'), N.MTU, function (v) { return C({mtu: v}); }), rg = series(grp(all.filter(function (a) { return a.region; }), 'region'), null, function (v) { return C({region: v}); }, 12);
    h += '<h2>Аналітика</h2><div class="grid g3"><div class="panel"><h3>Правовий стан</h3>' + chart('barh', lg[0], lg[1], 'ok', null, lg[2]) + '</div><div class="panel"><h3>Інвестиційна привабливість</h3>' + chart('donut', iv[0], iv[1], null, ['#F5C518', '#3DD68C', '#F5A524', '#6E7F9E', '#5B7DB1'], iv[2]) +
      '</div><div class="panel"><h3>Спосіб передачі</h3>' + chart('barh', wy[0], wy[1], 'cyan', null, wy[2]) + '</div><div class="panel"><h3>Відділи ДМА</h3>' + chart('barh', dp[0], dp[1], 'violet', null, dp[2]) +
      '</div><div class="panel"><h3>МТУ</h3>' + chart('barh', mt[0], mt[1], 'gold', null, mt[2]) + '</div><div class="panel"><h3>Області <span>топ-12</span></h3>' + chart('barh', rg[0], rg[1], 'blue', null, rg[2]) + '</div></div>';
    h += '<h2>Перелік активів</h2>' + filtersForm(f, '/c/' + code, true) + pager(list.length, pg.page, '/c/' + code, p) + assetTable(pg.rows, location.hash) + pager(list.length, pg.page, '/c/' + code, p);
    render(shell(N.CAT[code], 'Аналітика, перелік і картки активів категорії', code === 'corporate' ? '<a class="btn" href="#/companies">Пул товариств</a>' : '', h));
  });
  var CITIES = [['Київ', 50.45, 30.52], ['Львів', 49.84, 24.03], ['Одеса', 46.48, 30.73], ['Харків', 49.99, 36.23], ['Дніпро', 48.46, 35.05], ['Запоріжжя', 47.84, 35.14], ['Вінниця', 49.23, 28.47], ['Житомир', 50.25, 28.66], ['Чернігів', 51.49, 31.29], ['Суми', 50.91, 34.80], ['Полтава', 49.59, 34.55], ['Черкаси', 49.44, 32.06], ['Кропивницький', 48.51, 32.26], ['Миколаїв', 46.98, 31.99], ['Херсон', 46.64, 32.61], ['Сімферополь', 44.95, 34.10], ['Донецьк', 48.02, 37.80], ['Луганськ', 48.57, 39.31], ['Рівне', 50.62, 26.25], ['Луцьк', 50.75, 25.33], ['Тернопіль', 49.55, 25.59], ['Хмельницький', 49.42, 26.99], ['Чернівці', 48.29, 25.94], ['Івано-Франківськ', 48.92, 24.71], ['Ужгород', 48.62, 22.29]];
  function landMap(all) {
    var W = 900, H = 600, lon0 = 22, lon1 = 40.3, lat0 = 44.3, lat1 = 52.4, kx = W / (lon1 - lon0), ky = H / (lat1 - lat0);
    function pr(lo, la) { return [((lo - lon0) * kx).toFixed(1), ((lat1 - la) * ky).toFixed(1)]; }
    var col = {ok: '#3DD68C', lim: '#F5A524', lost: '#F2545B', closed: '#8B7BF7'}, pts = all.filter(function (a) { return a.lat && a.lon && a.lon >= lon0 && a.lon <= lon1 && a.lat >= lat0 && a.lat <= lat1; });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;background:#0E1526;border-radius:8px">' +
      CITIES.map(function (c) { var p = pr(c[2], c[1]); return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.6" fill="#5B6B88"/><text x="' + (+p[0] + 4) + '" y="' + (p[1] - 3) + '" fill="#8B9BB6" font-size="10">' + c[0] + '</text>'; }).join('') +
      pts.slice(0, 6000).map(function (a) { var p = pr(a.lon, a.lat); return '<a href="#/asset/' + a.id + '"><circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="' + (col[N.LCSS[a.legal_status]] || '#6E7F9E') + '"><title>' + esc(a.asset_no) + '</title></circle></a>'; }).join('') + '</svg>';
    return '<h2>Карта ділянок <span class="mini">схема без зовнішніх карт</span></h2><div class="grid" style="grid-template-columns:minmax(0,1fr) 280px;align-items:start"><div class="panel">' + svg +
      '</div><div class="panel"><h3>Ділянки</h3><dl class="kv" style="grid-template-columns:1fr auto"><dt>З кадастровим номером</dt><dd>' + num(all.filter(function (a) { return a.cadastral; }).length) + '</dd><dt>З координатами</dt><dd>' + num(pts.length) +
      '</dd></dl><p class="mini">Колір точки — правовий стан. У робочій версії сюди ж завантажуються контури ділянок (GeoJSON) із розрахунком площі.</p></div></div>';
  }
  function route404() { render(shell('Сторінку не знайдено', '', '', '<div class="empty">Немає такої сторінки.</div>')); }
  function compStatus(s) { return s ? '<span class="tag t-' + (D.COMPANY_STATUS_CSS[s] || 'unk') + '">' + esc(s) + '</span>' : '<span class="mini">не визначено</span>'; }

  // ================================================================ картка активу
  function assetVals(a) {
    var pool = a.pool_id && S.poolById[a.pool_id];
    var ids = {}; S.valuations.forEach(function (v) { if (pool ? (v.target_type === 'pool' && v.target_id === pool.id) : (v.target_type === 'asset' && v.target_id === a.id)) ids[v.id] = 1; });
    if (!pool) (S.vaByAsset[a.id] || []).forEach(function (i) { ids[i] = 1; });
    return Object.keys(ids).map(function (i) { return S.valById[i]; }).filter(Boolean).sort(function (x, y) { return (y.value_date || '').localeCompare(x.value_date || ''); });
  }
  function plansOf(tt, tid) { return S.plans.filter(function (p) { return p.target_type === tt && p.target_id === tid; }).sort(function (a, b) { return b.id - a.id; }); }
  function plansHTML(tt, tid, editable) {
    var t = today(), h = '';
    plansOf(tt, tid).forEach(function (p) {
      var st = S.stepsByPlan[p.id] || [], done = st.filter(function (s) { return s.status === 'done' || s.status === 'skipped'; }).length;
      h += '<div class="panel" style="margin-bottom:12px"><h3>' + esc(N.PROC[p.process]) + ' <span>' + esc(N.DMA_SHORT[p.dept_code] || 'відділ не визначено') + (p.manager ? ' · ' + esc(p.manager) : '') + ' · розпочато ' + dt(p.started_at) + ' · виконано ' + Math.round(done * 100 / (st.length || 1)) + '%' + (p.status === 'done' ? ' · <b style="color:var(--ok)">завершено</b>' : '') + '</span></h3><ul class="steps">';
      st.forEach(function (s) {
        var over = (s.status === 'active' || s.status === 'review') && s.due_date && s.due_date < t;
        var tag = s.status === 'done' ? '<span class="tag t-ok">виконано</span>' : s.status === 'review' ? '<span class="tag t-closed">на підтвердженні</span>' : s.status === 'active' ? '<span class="tag ' + (over ? 't-lost' : 't-lim') + '">' + (over ? 'прострочено' : 'у роботі') + '</span>' : s.status === 'skipped' ? '<span class="tag t-unk">пропущено</span>' : '<span class="tag t-unk">очікує</span>';
        var act = '';
        if (editable && s.status === 'active' && can('crm_edit')) act = '<form data-act="step" data-sid="' + s.id + '"><input type="hidden" name="action" value="complete"><input name="comment" placeholder="коментар" style="width:110px;padding:4px 7px;font-size:12px"><button class="btn sm">Виконано</button></form>';
        else if (editable && s.status === 'review' && can('crm_confirm')) act = '<form data-act="step" data-sid="' + s.id + '"><input name="comment" placeholder="коментар" style="width:100px;padding:4px 7px;font-size:12px"><button class="btn sm gold" name="action" value="confirm">Підтвердити</button><button class="btn sm danger" name="action" value="return">Повернути</button></form>';
        h += '<li class="' + (s.status === 'done' ? 'done' : s.status === 'active' ? 'now' : s.status === 'review' ? 'review' : s.status === 'skipped' ? 'skip' : '') + '"><div class="n">' + s.ord + '</div><div><div class="t">' + esc(s.name) + '</div><div class="s">' + esc(s.responsible) + (s.needs_confirm ? ' · підтверджує менеджер ДМА' : '') + (s.comment ? ' · ' + esc(s.comment) : '') + '</div></div>' +
          '<div class="s">' + (s.due_date ? 'строк: <span class="' + (over ? 'overdue' : '') + '">' + dt(s.due_date) + '</span>' : 'норматив: ' + s.norm_days + ' р. дн.') + (s.done_by ? '<br>виконав: ' + esc(s.done_by) : '') + (s.confirmed_by ? '<br>підтвердив: ' + esc(s.confirmed_by) : '') + '</div><div>' + tag + '</div><div class="row-actions">' + act + '</div></li>';
      });
      h += '</ul></div>';
    });
    if (!h) h = '<div class="empty">План дій ще не розпочато.</div>';
    if (editable && can('crm_edit')) h += '<form data-act="plan-create" data-tt="' + tt + '" data-tid="' + tid + '" class="panel" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><div class="field" style="margin:0;min-width:320px"><label>Розпочати новий план дій за бізнес-процесом</label>' + sel('process', D.PROCESSES.map(function (p) { return [p[0], p[1]]; }), null) + '</div><button class="btn gold">Розпочати план</button><span class="mini">Кроки, строки і відповідальні — за затвердженими схемами бізнес-процесів.</span></form>';
    return h;
  }
  function filesHTML(tt, tid, editable, red) {
    var fs = S.filesBy[tt + ':' + tid] || [];
    var h = '<div class="panel"><h3>Фотографії <span>' + fs.length + '</span></h3>' + (fs.length ? '<div class="gallery">' + fs.map(function (f) {
      return '<a href="#" data-lb="' + f.id + '" style="position:relative">' + thumbImg(f) + (editable && can('upload_files') ? '<button class="btn sm danger del" data-act="unfile" data-fid="' + f.id + '" title="Відв’язати">×</button>' : '') + '</a>'; }).join('') + '</div>' : '<div class="empty">Фото немає</div>') + '</div>';
    if (editable && can('upload_files')) {
      if (red) h += '<div class="flash err" style="margin-top:12px">Актив у Червоній зоні — завантаження фото і документів заборонено.</div>';
      else h += '<form class="panel" data-act="upload" data-tt="' + tt + '" data-tid="' + tid + '" style="margin-top:12px"><h3>Завантажити фото</h3><input type="file" name="files" accept="image/*" multiple> <button class="btn gold">Завантажити</button><p class="mini">У демоверсії фото зберігаються лише у вашому браузері (зменшені копії).</p></form>';
    }
    return h;
  }
  on(/^\/asset\/(\d+)$/, function (id) {
    var a = S.byId[id]; if (!a) return route404(); if (!inScope(a)) return deny();
    var pool = a.pool_id && S.poolById[a.pool_id], red = a.zone === 'Червона зона', em = canEdit(a, 'main'), es = canEdit(a, 'screening');
    var decs = (S.decByAsset[a.id] || []).map(function (l) { var d = S.decById[l[0]]; return d && Object.assign({}, d, {link_effect: l[2]}); }).filter(Boolean).sort(function (x, y) { return (x.decision_date || '').localeCompare(y.decision_date || ''); });
    var vals = assetVals(a), det = a.details || {}, fields = D.CATEGORY_FIELDS[a.category] || [];
    var act = (em || es || can('manage_public') ? '<a class="btn gold" href="#/asset/' + a.id + '/edit">Редагувати</a>' : '') + (can('edit_decisions') ? '<a class="btn" href="' + link('/decision/new', {asset: a.id}) + '">+ Судове рішення</a>' : '') +
      (can('edit_valuations') && !pool ? '<a class="btn" href="' + link('/valuation/new', {tt: 'asset', tid: a.id}) + '">+ Оцінка</a>' : '') + '<a class="btn plain" href="#/assets">До реєстру</a>';
    var h = (pool ? '<div class="banner">Актив входить до пулу <a href="#/pool/' + pool.id + '"><b>' + esc(pool.code) + '</b> — ' + esc(pool.name) + '</a>. Оцінка, план дій та план управління ведуться в картці пулу. <a class="btn sm gold" href="#/pool/' + pool.id + '">Перейти до картки пулу →</a></div>' : '') +
      (a.legal_note ? '<div class="flash info">' + esc(a.legal_note) + '</div>' : '') +
      '<div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start"><div><div class="tabs" data-tabbar="card"><a href="#" data-tab="t-o">Огляд</a><a href="#" data-tab="t-s">Скринінг МТУ</a><a href="#" data-tab="t-m">Ефективне управління</a><a href="#" data-tab="t-d">Судові рішення <span class="pill">' + decs.length + '</span></a><a href="#" data-tab="t-v">Оцінки <span class="pill">' + vals.length + '</span></a><a href="#" data-tab="t-p">План дій</a><a href="#" data-tab="t-f">Фото <span class="pill">' + (S.filesBy['asset:' + a.id] || []).length + '</span></a></div>';
    h += '<div class="tabpane" id="t-o" data-group="card"><div class="panel"><h3>Загальні відомості</h3><dl class="kv"><dt>№ активу в Реєстрі</dt><dd class="mono">' + esc(a.asset_no) + '</dd><dt>Найменування</dt><dd>' + esc(a.name) + '</dd><dt>Категорія</dt><dd>' + esc(N.CAT[a.category] || '—') + (a.vid ? ' · <span class="mini">' + esc(a.vid) + '</span>' : '') + '</dd>' +
      '<dt>Вид за наказом</dt><dd>' + esc(N.KIND[a.report_kind] || '—') + '</dd><dt>Складність</dt><dd>' + esc(N.CX[a.complexity] || '—') + '</dd>' + (a.owner ? '<dt>Власник</dt><dd>' + esc(a.owner) + '</dd>' : '') +
      (a.company_code ? '<dt>Товариство</dt><dd><a href="#/company/' + esc(a.company_code) + '">' + esc((S.compByCode[a.company_code] || {}).name || a.company_code) + '</a></dd>' : '') +
      '<dt>Вартість за Реєстром</dt><dd>' + money(a.value_registry) + '</dd><dt>Критерій критичності</dt><dd>' + esc(a.crit || '—') + (a.public_candidate ? ' · <span class="tag t-ok">публічний</span>' : '') + (a.publish ? ' · <span class="tag t-gold">опубліковано</span>' : '') + '</dd>' +
      '<dt>Зона</dt><dd>' + (a.zone ? '<span class="tag ' + (red ? 't-lost' : a.zone === 'Жовта зона' ? 't-lim' : 't-unk') + '">' + esc(a.zone) + '</span>' : '—') + '</dd><dt>Адреса</dt><dd>' + esc(fullAddress(a) || '—') + '</dd>' + (a.cadastral ? '<dt>Кадастровий номер</dt><dd class="mono">' + esc(a.cadastral) + '</dd>' : '') +
      (a.lat && a.lon ? '<dt>Координати (≈)</dt><dd class="mono">' + a.lat + ', ' + a.lon + ' <a href="https://www.google.com/maps?q=' + a.lat + ',' + a.lon + '" target="_blank" rel="noopener">на карті</a></dd>' : '') + '</dl></div>';
    if (fields.length) h += '<div class="panel" style="margin-top:12px"><h3>Характеристики — ' + esc(N.CAT[a.category]) + '</h3><dl class="kv">' + fields.filter(function (fd) { return det[fd[0]] !== undefined && det[fd[0]] !== null && det[fd[0]] !== ''; }).map(function (fd) { return '<dt>' + esc(fd[1]) + '</dt><dd>' + (fd[2] === 'date' ? dt(det[fd[0]]) : fd[2] === 'num' ? num(det[fd[0]], 2) : esc(det[fd[0]])) + '</dd>'; }).join('') +
      (a.category === 'crypto' && S.rateBy[det.token] ? '<dt>Курс</dt><dd>1 ' + esc(det.token) + ' = ' + num(S.rateBy[det.token].uah, 2) + ' ₴</dd><dt>Вартість за курсом</dt><dd><b>' + money(Number(det.units || 0) * S.rateBy[det.token].uah) + '</b></dd>' : '') + '</dl></div>';
    h += '<div class="panel" style="margin-top:12px"><h3>Дані інвентаризації <span>первинне джерело</span></h3><dl class="kv">' + (a.inv_status ? '<dt>Статус інвентаризації</dt><dd>' + esc(a.inv_status) + '</dd>' : '') + (a.mgmt_type_src ? '<dt>Тип управління</dt><dd>' + esc(a.mgmt_type_src) + '</dd>' : '') + (a.proposal ? '<dt>Пропозиції / стан</dt><dd>' + esc(a.proposal) + '</dd>' : '') + '</dl></div></div>';
    h += '<div class="tabpane" id="t-s" data-group="card"><div class="panel"><h3>Скринінг активу <span>' + esc(N.MTU[a.mtu_code] || 'МТУ не визначено') + '</span></h3><dl class="kv"><dt>Дата огляду</dt><dd>' + dt(a.inspect_date) + '</dd><dt>Технічний стан</dt><dd>' + esc(a.tech_state || a.phys_src || '—') + '</dd><dt>Стан використання</dt><dd>' + esc(a.usage_state || a.usage_src || '—') + '</dd><dt>Ризик місцезнаходження</dt><dd>' + esc(a.location_risk || '—') + '</dd><dt>Опис</dt><dd>' + esc(a.description || '—') + '</dd><dt>Зберігання</dt><dd>' + esc(a.custodian_name || a.storage_place || '—') + '</dd></dl></div></div>';
    h += '<div class="tabpane" id="t-m" data-group="card"><div class="panel"><h3>Ефективне управління <span>за наказом</span></h3><dl class="kv"><dt>Можливість управління</dt><dd>' + esc(N.POS[a.mgmt_possible] || '—') + '</dd>' + (a.impossible_reason ? '<dt>Причина неможливості</dt><dd><span class="tag t-lost">' + esc(N.REASON[a.impossible_reason]) + '</span>' + (a.procedural_decision ? '<div class="mini">Яке рішення потрібне: ' + esc(a.procedural_decision) + '</div>' : '') + '</dd>' : '') +
      '<dt>Інвестиційна привабливість</dt><dd>' + invest(a.invest_grade) + '</dd><dt>Спосіб передачі</dt><dd>' + esc(N.WAY[a.transfer_way] || '—') + '</dd><dt>Економічний потенціал</dt><dd>' + esc(a.economic_potential || '—') + '</dd><dt>Очікуваний дохід / рік</dt><dd>' + money(a.expected_income_year) + '</dd><dt>Управитель</dt><dd>' + esc(a.manager_name || '—') + '</dd><dt>Договір управління</dt><dd>' + esc(a.mgmt_contract || '—') + (a.mgmt_start ? ' · з ' + dt(a.mgmt_start) : '') + '</dd>' + (a.realization_measure ? '<dt>Реалізація</dt><dd>' + esc(a.realization_measure) + '</dd>' : '') + '</dl></div></div>';
    h += '<div class="tabpane" id="t-d" data-group="card"><div class="panel"><h3>Хронологія судових рішень <span>правовий стан розраховується автоматично</span></h3>' + (decs.length ? '<ul class="timeline">' + decs.map(function (x) { return '<li class="e-' + esc(x.link_effect || x.effect) + '"><div class="date">' + dt(x.decision_date) + '</div><div class="what"><a href="#/decision/' + x.id + '">' + esc(N.DEC[x.dtype] || x.dtype) + '</a></div><div class="meta">' + esc(x.court || '') + (x.case_no ? ' · справа ' + esc(x.case_no) : '') + '</div><div class="meta">' + esc(N.EFF[x.link_effect || x.effect] || '') + '</div></li>'; }).join('') + '</ul>' : '<div class="empty">Рішень не зафіксовано.</div>') + '</div></div>';
    h += '<div class="tabpane" id="t-v" data-group="card">' + (pool ? '<div class="flash info">Оцінка ведеться на рівні пулу ' + esc(pool.code) + '.</div>' : '') + '<div class="panel">' + (vals.length ? '<div class="wrap-tbl"><table><thead><tr><th>Дата оцінки</th><th class="num">Вартість</th><th>Закупівля</th><th>Статус</th><th></th></tr></thead><tbody>' + vals.map(function (v) { var s = valState(v.value_date); return '<tr><td>' + dt(v.value_date) + (s === 'expired' ? '<span class="sub overdue">понад 6 міс.</span>' : s === 'valid' ? '<span class="sub" style="color:var(--ok)">чинна</span>' : '') + '</td><td class="num">' + money(v.value_uah) + '</td><td class="mini">' + esc(v.procurement_id || '') + (v.lot_no ? ' · лот ' + esc(v.lot_no) : '') + '</td><td class="mini">' + esc(v.status || '—') + (v.is_current ? ' <span class="tag t-ok">актуальна</span>' : '') + (v.target_type === 'group' ? '<br><span class="tag t-lim">групова: ' + v.assets_count + ' активів</span>' : '') + '</td><td><a href="#/valuation/' + v.id + '">відкрити</a></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Оцінок немає.</div>') + '</div></div>';
    h += '<div class="tabpane" id="t-p" data-group="card">' + (pool ? '<div class="flash info">План дій ведеться на рівні пулу ' + esc(pool.code) + '.</div>' + plansHTML('pool', pool.id, false) : plansHTML('asset', a.id, em || es)) + '</div>';
    h += '<div class="tabpane" id="t-f" data-group="card">' + filesHTML('asset', a.id, em || es, red) + '</div></div>';
    var grpV = vals.filter(function (v) { return v.target_type === 'group'; })[0], src = pool || a;
    h += '<aside><div class="panel"><h3>Правовий стан</h3><div style="font-size:15px;margin:4px 0 8px">' + legal(a.legal_status, true) + '</div><div class="mini">Рішень: ' + (a.decisions_count || 0) + (a.last_decision_date ? ' · останнє ' + dt(a.last_decision_date) : '') + '</div></div>' +
      '<div class="panel" style="margin-top:12px"><h3>Відповідальний МТУ <span>скринінг</span></h3><b>' + esc(N.MTU[a.mtu_code] || 'Не закріплено') + '</b><div class="mini">' + esc(a.mtu_manager || 'Виконавця не призначено') + '</div></div>' +
      '<div class="panel" style="margin-top:12px"><h3>Відділ ДМА і менеджер-куратор</h3><b>' + esc(N.DMA[a.dept_code] || 'Не закріплено') + '</b><div class="mini">' + esc(a.dma_manager || 'Менеджера не призначено') + '</div></div>' +
      '<div class="panel" style="margin-top:12px"><h3>Актуальна оцінка</h3>' + (!pool && !a.val_amount && grpV ? '<div class="kpi"><div class="v" style="font-size:20px">' + money(grpV.value_uah) + '</div><div class="d">групова оцінка на ' + grpV.assets_count + ' активів</div></div>' : '<div class="kpi"><div class="v" style="font-size:20px">' + money(src.val_amount) + '</div><div class="d">' + (src.val_date ? 'станом на ' + dt(src.val_date) : 'оцінки немає') + (pool ? ' · оцінка пулу' : '') + '</div></div>') + '</div></aside></div>';
    log('Перегляд картки активу', 'asset', a.id);
    render(shell((a.name || a.asset_no).slice(0, 140), 'Актив № ' + a.asset_no + ' · ' + (N.CAT[a.category] || ''), act, h));
  });

  // ================================================================ редагування активу
  var SEC_MAIN = ['category', 'report_kind', 'complexity', 'invest_grade', 'mgmt_possible', 'impossible_reason', 'procedural_decision', 'transfer_way', 'economic_potential', 'expected_income_year', 'mtu_code', 'dept_code', 'dma_manager', 'manager_name', 'mgmt_contract', 'mgmt_start', 'company_code'];
  var SEC_SCREEN = ['mtu_manager', 'inspect_date', 'tech_state', 'usage_state', 'location_risk', 'description', 'region', 'district', 'hromada', 'settl_type', 'settl_name', 'street_type', 'street_name', 'building', 'cadastral', 'lat', 'lon', 'custodian_name', 'storage_place'];
  on(/^\/asset\/(\d+)\/edit$/, function (id) {
    var a = S.byId[id]; if (!a) return route404();
    var em = canEdit(a, 'main'), es = canEdit(a, 'screening'), ep = can('manage_public');
    if (!(em || es || ep)) return deny();
    var det = a.details || {}, dm = S.users.filter(function (u) { return u.dept_code; });
    var h = '<form data-act="asset-save" data-id="' + a.id + '">';
    if (em) h += '<fieldset class="panel"><legend>Класифікація та ефективне управління <span class="mini">— відділ ДМА</span></legend><div class="form-grid">' +
      fsel('Категорія', 'category', CAT_OPT, a.category, true, null, '', 'data-category-select') + fsel('Вид за наказом', 'report_kind', D.REPORT_KINDS, a.report_kind) + fsel('Простий / складний / пул', 'complexity', D.COMPLEXITY, a.complexity) +
      fsel('Інвестиційна привабливість', 'invest_grade', D.INVEST_GRADES, a.invest_grade) + fsel('Можливість ефективного управління', 'mgmt_possible', D.MGMT_POSSIBLE, a.mgmt_possible) + fsel('Причина неможливості', 'impossible_reason', D.IMPOSSIBLE_REASONS, a.impossible_reason) +
      field('Яке процесуальне рішення потрібне', 'procedural_decision', a.procedural_decision, 'text', false, 'Обов’язково для причини «Потребує іншого процесуального рішення»', 'wide') + fsel('Спосіб передачі', 'transfer_way', D.TRANSFER_WAYS, a.transfer_way) +
      field('Економічний потенціал', 'economic_potential', a.economic_potential) + field('Очікуваний дохід, грн / рік', 'expected_income_year', a.expected_income_year, 'number') + '</div></fieldset>' +
      '<fieldset class="panel"><legend>Закріплення</legend><div class="form-grid">' + fsel('МТУ (скринінг)', 'mtu_code', MTU_OPT, a.mtu_code) + fsel('Відділ ДМА', 'dept_code', D.DMA, a.dept_code) +
      fsel('Менеджер-куратор ДМА', 'dma_manager', dm.map(function (u) { return [u.full_name, u.full_name + ' — ' + (N.DMA_SHORT[u.dept_code] || '')]; }), a.dma_manager) + field('Управитель', 'manager_name', a.manager_name) + field('Договір управління', 'mgmt_contract', a.mgmt_contract) + field('Початок управління', 'mgmt_start', a.mgmt_start, 'date') + field('ЄДРПОУ товариства', 'company_code', a.company_code) + '</div></fieldset>';
    if (em || es) {
      h += '<fieldset class="panel"><legend>Характеристики за категорією</legend>';
      D.CATEGORIES.forEach(function (c) {
        h += '<div class="form-grid" data-cat-fields="' + c[0] + '"' + (c[0] !== a.category ? ' style="display:none"' : '') + '>';
        (D.CATEGORY_FIELDS[c[0]] || []).forEach(function (fd) {
          if (D.INTERNAL_DETAIL_KEYS.indexOf(fd[0]) >= 0) return;
          var nm = 'det_' + c[0] + '_' + fd[0], v = c[0] === a.category ? det[fd[0]] : null;
          h += Array.isArray(fd[2]) ? fsel(fd[1], nm, fd[2], v) : field(fd[1], nm, v, fd[2] === 'date' ? 'date' : ['num', 'int', 'year'].indexOf(fd[2]) >= 0 ? 'number' : 'text', false, fd[4]);
        });
        h += '</div>';
      });
      h += '</fieldset>';
    }
    if (es) h += '<fieldset class="panel"><legend>Скринінг МТУ <span class="mini">— виконавець МТУ</span></legend><div class="form-grid">' + field('Виконавець МТУ', 'mtu_manager', a.mtu_manager) + field('Дата огляду', 'inspect_date', a.inspect_date, 'date', true) +
      fsel('Технічний стан', 'tech_state', D.TECH_STATE, a.tech_state, true) + fsel('Стан використання', 'usage_state', D.USAGE_STATE, a.usage_state, true) + fsel('Ризик місцезнаходження', 'location_risk', D.LOCATION_RISK, a.location_risk) +
      field('Опис активу', 'description', a.description, 'textarea', true, null, 'wide') + '</div></fieldset><fieldset class="panel"><legend>Адреса (єдиний формат) і координати</legend><div class="form-grid">' +
      fsel('Область', 'region', D.REGIONS, a.region, true) + field('Район', 'district', a.district) + field('Громада', 'hromada', a.hromada) + fsel('Тип населеного пункту', 'settl_type', D.SETTLEMENT_TYPES, a.settl_type) + field('Населений пункт', 'settl_name', a.settl_name, 'text', true) +
      fsel('Тип вулиці', 'street_type', D.STREET_TYPES, a.street_type) + field('Назва вулиці', 'street_name', a.street_name) + field('Будинок', 'building', a.building) + field('Кадастровий номер', 'cadastral', a.cadastral) +
      '<div class="field wide"><label>Вставте координати з Google Карт</label><input data-coords-paste placeholder="50°28\'53.1&quot;N 30°35\'29.3&quot;E або 50.481417, 30.591472" style="width:100%"></div>' + field('Широта', 'lat', a.lat, 'number') + field('Довгота', 'lon', a.lon, 'number') +
      field('Зберігач', 'custodian_name', a.custodian_name) + field('Місце зберігання', 'storage_place', a.storage_place) + '</div></fieldset>';
    if (ep) h += '<fieldset class="panel"><legend>Публічний сайт</legend>' + (a.public_candidate ? '<label><input type="checkbox" name="publish" value="1"' + (a.publish ? ' checked' : '') + ' style="width:auto"> Опублікувати на публічному сайті</label>' : '<p class="mini">Актив не може бути опублікований: критерій критичності — «' + esc(a.crit || 'не визначено') + '».</p>') + '</fieldset>';
    h += '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn gold">Зберегти зміни</button><a class="btn plain" href="#/asset/' + a.id + '">Скасувати</a></div></form>';
    render(shell('Редагування активу', '№ ' + a.asset_no + ' · ' + (a.name || '').slice(0, 90), '<a class="btn plain" href="#/asset/' + a.id + '">Скасувати</a>', h));
  });

  // ================================================================ пули
  on(/^\/pools$/, function (f) {
    var rows = S.pools.filter(function (p) { return can('view_all') || p.dept_code === S.user.dept_code || S.assets.some(function (a) { return a.pool_id === p.id && inScope(a); }); });
    var cnt = {}; S.assets.forEach(function (a) { if (a.pool_id) cnt[a.pool_id] = (cnt[a.pool_id] || 0) + 1; });
    var h = '<div class="wrap-tbl"><table><thead><tr><th>Код</th><th>Назва</th><th>Відділ ДМА</th><th class="num">Активів</th><th>Привабливість</th><th class="num">Оцінка пулу</th><th>План управління</th></tr></thead><tbody>' +
      rows.map(function (p) { return '<tr><td class="nowrap"><a class="id" href="#/pool/' + p.id + '">' + esc(p.code) + '</a></td><td>' + esc((p.name || '').slice(0, 120)) + '<span class="sub">' + esc(N.CAT[p.category] || '') + (p.transfer_way ? ' · ' + esc(N.WAY[p.transfer_way] || '') : '') + '</span></td><td class="mini">' + esc(N.DMA_SHORT[p.dept_code] || '—') + '</td><td class="num">' + num(cnt[p.id] || 0) + '</td><td>' + invest(p.invest_grade) + '</td><td class="num">' + money(p.val_amount) + (p.val_date ? '<span class="sub">' + dt(p.val_date) + '</span>' : '') + '</td><td class="mini">' + esc(p.mgmt_plan_status || '—') + '</td></tr>'; }).join('') +
      (rows.length ? '' : '<tr><td colspan="7"><div class="empty">Пулів немає</div></td></tr>') + '</tbody></table></div>';
    render(shell('Пули активів', 'Набори активів: оцінка, план дій і план управління ведуться спільно', can('manage_pools') ? '<span class="mini">Новий пул: оберіть активи в <a href="#/assets">реєстрі</a> → «Створити пул з обраних»</span>' : '', h));
  });
  function poolForm(p, ids) {
    return '<form data-act="pool-save" data-id="' + (p.id || '') + '" data-ids="' + esc(ids || '') + '"><fieldset class="panel"><legend>Пул активів</legend><div class="form-grid">' + field('Назва пулу', 'name', p.name, 'text', true, null, 'wide') + fsel('Категорія', 'category', CAT_OPT, p.category) +
      fsel('Відділ ДМА', 'dept_code', D.DMA, p.dept_code) + fsel('Інвестиційна привабливість', 'invest_grade', D.INVEST_GRADES, p.invest_grade) + fsel('Спосіб передачі', 'transfer_way', D.TRANSFER_WAYS, p.transfer_way) +
      fsel('Стан плану управління', 'mgmt_plan_status', ['Не розроблено', 'На розробці', 'На погодженні', 'Затверджено', 'Потребує оновлення'], p.mgmt_plan_status) + field('Очікуваний дохід, грн / рік', 'expected_income_year', p.expected_income_year, 'number') +
      field('Опис', 'description', p.description, 'textarea', false, null, 'wide') + '</div></fieldset><button class="btn gold">' + (p.id ? 'Зберегти' : 'Створити пул') + '</button></form>';
  }
  on(/^\/pool\/new$/, function (f) {
    if (!can('manage_pools')) return deny();
    var ids = (f.ids || '').split(',').filter(Boolean), as = ids.map(function (i) { return S.byId[i]; }).filter(Boolean);
    render(shell('Новий пул активів', 'Обрано активів: ' + as.length, '', poolForm({category: as.length ? as[0].category : null, dept_code: as.length ? as[0].dept_code : null, invest_grade: 'attractive'}, f.ids) +
      '<div class="panel" style="margin-top:12px"><h3>Активи, що увійдуть до пулу</h3><ul class="docs">' + as.slice(0, 200).map(function (a) { return '<li><span><span class="mono">' + esc(a.asset_no) + '</span> — ' + esc((a.name || '').slice(0, 100)) + '</span>' + (a.pool_id ? '<span class="tag t-lim">вже в іншому пулі — буде пропущено</span>' : '') + '</li>'; }).join('') + '</ul></div>'));
  });
  on(/^\/pool\/(\d+)\/edit$/, function (id) { var p = S.poolById[id]; if (!p) return route404(); if (!can('manage_pools')) return deny(); render(shell('Редагування пулу', p.code, '', poolForm(p))); });
  on(/^\/pool\/(\d+)$/, function (id) {
    var p = S.poolById[id]; if (!p) return route404();
    var as = S.assets.filter(function (a) { return a.pool_id === p.id && inScope(a); }), ed = can('manage_pools') && (can('edit_any_asset') || !p.dept_code || p.dept_code === S.user.dept_code);
    var vals = S.valuations.filter(function (v) { return v.target_type === 'pool' && v.target_id === p.id; });
    var h = '<div class="grid g4">' + kpi('Активів у пулі', num(as.length), '') + kpi('Оцінка пулу', money(p.val_amount), p.val_date ? 'станом на ' + dt(p.val_date) : 'оцінки немає') + kpi('Очікуваний дохід', money(p.expected_income_year), 'на рік') + kpi('План управління', esc(p.mgmt_plan_status || 'Не розроблено'), '') + '</div>' +
      '<div class="tabs" data-tabbar="pool" style="margin-top:14px"><a href="#" data-tab="p-i">Відомості</a><a href="#" data-tab="p-a">Активи <span class="pill">' + as.length + '</span></a><a href="#" data-tab="p-p">Етапи робіт</a><a href="#" data-tab="p-v">Оцінки <span class="pill">' + vals.length + '</span></a><a href="#" data-tab="p-f">Фото</a></div>' +
      '<div class="tabpane" id="p-i" data-group="pool"><div class="panel"><dl class="kv"><dt>Код</dt><dd class="mono">' + esc(p.code) + '</dd><dt>Назва</dt><dd>' + esc(p.name) + '</dd><dt>Відділ ДМА</dt><dd>' + esc(N.DMA[p.dept_code] || 'Не закріплено') + '</dd><dt>Привабливість</dt><dd>' + invest(p.invest_grade) + '</dd><dt>Спосіб передачі</dt><dd>' + esc(N.WAY[p.transfer_way] || '—') + '</dd><dt>Підстава</dt><dd>' + esc(p.court_basis || '—') + '</dd><dt>Закупівля / конкурс</dt><dd>' + esc(p.procurement_info || '—') + '</dd><dt>Договір управління</dt><dd>' + esc(p.mgmt_contract || '—') + '</dd><dt>Опис</dt><dd>' + esc(p.description || '—') + '</dd></dl></div></div>' +
      '<div class="tabpane" id="p-a" data-group="pool"><form data-act="pool-remove" data-id="' + p.id + '"><div class="wrap-tbl"><table><thead><tr>' + (ed ? '<th style="width:26px"><input type="checkbox" data-select-all style="width:auto"></th>' : '') + '<th>№ активу</th><th>Найменування</th><th>Регіон</th><th>Правовий стан</th></tr></thead><tbody>' +
      as.slice(0, 500).map(function (a) { return '<tr>' + (ed ? '<td><input type="checkbox" name="ids" value="' + a.id + '" data-row style="width:auto"></td>' : '') + '<td><a class="id" href="#/asset/' + a.id + '">' + esc(a.asset_no) + '</a></td><td>' + esc((a.name || '').slice(0, 120)) + '</td><td class="mini">' + esc(a.region || '—') + '</td><td>' + legal(a.legal_status) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (as.length > 500 ? '<p class="mini">Показано 500 з ' + as.length + '. <a href="' + link('/assets', {pool: p.id}) + '">Усі в реєстрі →</a></p>' : '') + (ed && as.length ? '<div class="sel-bar"><span class="mini">Обрано: <b data-sel-count>0</b></span><button class="btn danger" data-need-sel>Вилучити з пулу</button></div>' : '') + '</form></div>' +
      '<div class="tabpane" id="p-p" data-group="pool">' + plansHTML('pool', p.id, ed) + '</div>' +
      '<div class="tabpane" id="p-v" data-group="pool"><div class="panel">' + (vals.length ? '<ul class="docs">' + vals.map(function (v) { return '<li><span><a href="#/valuation/' + v.id + '">' + dt(v.value_date) + '</a> · ' + esc(v.status || '') + '</span><b>' + money(v.value_uah) + (v.is_current ? ' <span class="tag t-ok">актуальна</span>' : '') + '</b></li>'; }).join('') + '</ul>' : '<div class="empty">Оцінок немає</div>') + '</div></div>' +
      '<div class="tabpane" id="p-f" data-group="pool">' + filesHTML('pool', p.id, ed, false) + '</div>';
    render(shell(p.name || p.code, 'Пул ' + p.code + ' · активів: ' + as.length, (ed ? '<a class="btn gold" href="#/pool/' + p.id + '/edit">Редагувати пул</a>' : '') + (can('edit_valuations') ? '<a class="btn" href="' + link('/valuation/new', {tt: 'pool', tid: p.id}) + '">+ Оцінка пулу</a>' : '') + '<a class="btn plain" href="#/pools">До пулів</a>', h));
  });

  // ================================================================ плани дій
  on(/^\/plans$/, function (f) {
    var t = today(), rows = S.plans.filter(function (p) { return (f.status || 'active') === 'all' || p.status === (f.status || 'active'); });
    if (f.process) rows = rows.filter(function (p) { return p.process === f.process; });
    if (f.dept) rows = rows.filter(function (p) { return p.dept_code === f.dept; });
    rows = rows.map(function (p) { var st = S.stepsByPlan[p.id] || [], cur = st.filter(function (s) { return s.status === 'active' || s.status === 'review'; })[0];
      var tgt = p.target_type === 'pool' ? S.poolById[p.target_id] : S.byId[p.target_id];
      return {p: p, cur: cur, done: st.filter(function (s) { return s.status === 'done'; }).length, n: st.length, over: cur && cur.due_date && cur.due_date < t, tgt: tgt}; })
      .filter(function (r) { return r.tgt && (r.p.target_type === 'pool' || inScope(r.tgt)); });
    if (f.state === 'overdue') rows = rows.filter(function (r) { return r.over; }); if (f.state === 'review') rows = rows.filter(function (r) { return r.cur && r.cur.status === 'review'; });
    if (f.step) rows = rows.filter(function (r) { return r.cur && String(r.cur.ord) === f.step; });
    var sum = {}; S.plans.forEach(function (p) { if (p.status !== 'active') return; var o = sum[p.dept_code || ''] || (sum[p.dept_code || ''] = {n: 0, r: 0, o: 0}); o.n++; (S.stepsByPlan[p.id] || []).forEach(function (s) { if (s.status === 'review') o.r++; if ((s.status === 'active' || s.status === 'review') && s.due_date && s.due_date < t) o.o++; }); });
    var h = '<div class="grid g2"><div class="panel"><h3>Виконання за відділами ДМА <span>діючі плани</span></h3><table><thead><tr><th>Відділ</th><th class="num">Планів</th><th class="num">На підтвердженні</th><th class="num">Прострочено</th></tr></thead><tbody>' +
      Object.keys(sum).map(function (k) { return '<tr><td><a href="' + link('/plans', {dept: k}) + '">' + esc(N.DMA_SHORT[k] || 'Не визначено') + '</a></td><td class="num">' + sum[k].n + '</td><td class="num">' + (sum[k].r || '—') + '</td><td class="num ' + (sum[k].o ? 'overdue' : '') + '">' + (sum[k].o || '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="panel"><h3>Як це працює</h3><p class="mini">План дій запускається з картки активу або пулу. Кожен крок має відповідального і нормативний строк у робочих днях. Кроки з позначкою «підтверджує менеджер ДМА» переходять далі лише після підтвердження.</p><div class="chips-filter"><a href="' + link('/plans', {state: 'review'}) + '">Очікують підтвердження</a><a href="' + link('/plans', {state: 'overdue'}) + '">Прострочені</a><a href="' + link('/plans', {status: 'done'}) + '">Завершені</a><a href="#/plans">Усі діючі</a></div></div></div>' +
      '<form class="filters" data-act="filter" data-base="/plans" style="margin-top:14px">' + sel('process', D.PROCESSES.map(function (p) { return [p[0], p[1]]; }), f.process, 'Усі процеси') + sel('dept', D.DMA, f.dept, 'Усі відділи ДМА') + sel('state', [['overdue', 'Прострочені'], ['review', 'На підтвердженні']], f.state, 'Стан кроку') + '<button class="btn">Показати</button></form>' +
      '<div class="wrap-tbl"><table><thead><tr><th>Актив / пул</th><th>Процес</th><th>Поточний крок</th><th>Строк</th><th>Відділ</th><th class="num">Виконано</th></tr></thead><tbody>' +
      rows.map(function (r) { var href = r.p.target_type === 'pool' ? '#/pool/' + r.p.target_id : '#/asset/' + r.p.target_id; return '<tr><td><a class="id" href="' + href + '">' + esc(r.tgt.code || r.tgt.asset_no) + '</a><span class="sub">' + esc((r.tgt.name || '').slice(0, 60)) + '</span></td><td class="mini">' + esc(N.PROC[r.p.process]) + '</td><td>' + (r.cur ? r.cur.ord + '. ' + esc(r.cur.name) + '<span class="sub">' + esc(r.cur.responsible) + (r.cur.status === 'review' ? ' · <b>очікує підтвердження</b>' : '') + '</span>' : r.p.status === 'done' ? '<span class="tag t-ok">завершено</span>' : '—') + '</td><td class="nowrap ' + (r.over ? 'overdue' : '') + '">' + (r.cur ? dt(r.cur.due_date) : '—') + '</td><td class="mini">' + esc(N.DMA_SHORT[r.p.dept_code] || '—') + '</td><td class="num">' + r.done + ' / ' + r.n + '<div class="prog"><div style="width:' + Math.round(r.done * 100 / (r.n || 1)) + '%"></div></div></td></tr>'; }).join('') +
      (rows.length ? '' : '<tr><td colspan="6"><div class="empty">Планів не знайдено</div></td></tr>') + '</tbody></table></div>';
    render(shell('Плани дій (CRM)', 'Етапи робіт за бізнес-процесами', '', h));
  });

  // ================================================================ судові рішення
  on(/^\/decisions$/, function (f) {
    var rows = S.decisions.slice(), q = (f.q || '').toLowerCase();
    if (q) rows = rows.filter(function (d) { return [d.case_no, d.proceeding_no, d.court, d.summary].join(' ').toLowerCase().indexOf(q) >= 0; });
    if (f.dtype) rows = rows.filter(function (d) { return d.dtype === f.dtype; }); if (f.effect) rows = rows.filter(function (d) { return d.effect === f.effect; });
    if (f.unlinked) rows = rows.filter(function (d) { return !(S.assetsByDec[d.id] || []).length; });
    rows.sort(function (a, b) { return (b.decision_date || '').localeCompare(a.decision_date || '') || b.id - a.id; });
    var pg = pageOf(rows, f), p = Object.assign({}, f); delete p.page;
    var eff = {}; S.decisions.forEach(function (d) { eff[d.effect] = (eff[d.effect] || 0) + 1; });
    var h = '<div class="tiles">' + Object.keys(eff).map(function (k) { return '<a class="tile" href="' + link('/decisions', {effect: k}) + '"><b>' + num(eff[k]) + '</b><span>' + esc(N.EFF[k] || k) + '</span></a>'; }).join('') + '<a class="tile warn" href="' + link('/decisions', {unlinked: 1}) + '"><b>' + num(S.decisions.filter(function (d) { return !(S.assetsByDec[d.id] || []).length; }).length) + '</b><span>Потребують зіставлення з активами</span></a></div>' +
      '<form class="filters" data-act="filter" data-base="/decisions" style="margin-top:14px"><input name="q" value="' + esc(f.q) + '" placeholder="Номер справи, провадження, суд" style="min-width:280px;flex:1">' + sel('dtype', D.DECISION_TYPES.map(function (x) { return [x[0], x[1]]; }), f.dtype, 'Усі види рішень') + sel('effect', Object.keys(N.EFF).map(function (k) { return [k, N.EFF[k]]; }), f.effect, 'Наслідок') + '<button class="btn">Знайти</button><a class="btn plain" href="#/decisions">Скинути</a></form>' +
      pager(rows.length, pg.page, '/decisions', p) + '<div class="wrap-tbl"><table><thead><tr><th>Дата</th><th>Вид рішення</th><th>Суд</th><th>Справа</th><th>Наслідок</th><th class="num">Активів</th></tr></thead><tbody>' +
      pg.rows.map(function (d) { var n = (S.assetsByDec[d.id] || []).length; return '<tr><td class="nowrap">' + dt(d.decision_date) + '</td><td><a href="#/decision/' + d.id + '">' + esc(N.DEC[d.dtype] || d.dtype) + '</a>' + (d.summary ? '<span class="sub">' + esc(d.summary.slice(0, 90)) + '</span>' : '') + '</td><td class="mini">' + esc(d.court || '—') + '</td><td class="mini mono">' + esc(d.case_no || '') + '</td><td class="mini">' + esc(N.EFF[d.effect] || '—') + '</td><td class="num">' + (n || '<span class="tag t-lim">0</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>' + pager(rows.length, pg.page, '/decisions', p);
    render(shell('Судові рішення', 'Окрема база рішень, пов’язана з активами; правовий стан рахується автоматично', can('edit_decisions') ? '<a class="btn gold" href="#/decision/new">+ Внести рішення</a>' : '', h));
  });
  on(/^\/decision\/new$/, function (f) {
    if (!can('edit_decisions')) return deny();
    var a = f.asset && S.byId[f.asset];
    var h = '<form data-act="decision-save"><fieldset class="panel"><legend>Рішення</legend><div class="form-grid">' + fsel('Вид рішення', 'dtype', D.DECISION_TYPES.map(function (x) { return [x[0], x[1]]; }), null, true, 'Наслідок для правового стану визначається видом рішення', 'wide') +
      field('Суд / орган', 'court', '', 'text', false, null, 'wide') + field('Номер справи', 'case_no', '', 'text', true) + field('Номер провадження', 'proceeding_no', '') + field('Дата рішення', 'decision_date', '', 'date', true) + field('Набрало законної сили', 'effective_date', '', 'date') +
      fsel('Обсяг арешту', 'arrest_scope', D.ARREST_SCOPES, null) + fsel('Стан виконання', 'execution', D.EXECUTION, null) + field('Короткий зміст', 'summary', '', 'textarea', false, null, 'wide') + '</div></fieldset>' +
      '<fieldset class="panel"><legend>Пов’язані активи</legend><textarea name="asset_nos" placeholder="Номери активів — по одному в рядку або через кому" style="width:100%">' + esc(a ? a.asset_no : '') + '</textarea></fieldset><button class="btn gold">Зберегти</button></form>';
    render(shell('Нове судове рішення', 'Після збереження правовий стан активів перераховується автоматично', '', h));
  });
  on(/^\/decision\/(\d+)$/, function (id) {
    var d = S.decById[id]; if (!d) return route404();
    var as = (S.assetsByDec[d.id] || []).map(function (l) { return [S.byId[l[1]], l[2]]; }).filter(function (x) { return x[0] && inScope(x[0]); });
    var chain = d.case_no ? S.decisions.filter(function (x) { return x.case_no === d.case_no; }).sort(function (a, b) { return (a.decision_date || '').localeCompare(b.decision_date || ''); }) : [];
    var h = '<div class="grid g2"><div class="panel"><h3>Реквізити</h3><dl class="kv"><dt>Вид</dt><dd>' + esc(N.DEC[d.dtype]) + '</dd><dt>Наслідок</dt><dd>' + esc(N.EFF[d.effect] || '—') + '</dd><dt>Суд</dt><dd>' + esc(d.court || '—') + '</dd><dt>Справа</dt><dd class="mono">' + esc(d.case_no || '—') + '</dd><dt>Провадження</dt><dd class="mono">' + esc(d.proceeding_no || '—') + '</dd><dt>Дата</dt><dd>' + dt(d.decision_date) + '</dd><dt>Обсяг арешту</dt><dd>' + esc(N.SCOPE[d.arrest_scope] || '—') + '</dd><dt>Зміст</dt><dd>' + esc(d.summary || '—') + '</dd><dt>Джерело</dt><dd class="mini">' + esc(d.source === 'manual' ? 'внесено вручну' : d.source) + '</dd></dl></div>' +
      '<div class="panel"><h3>Хронологія у справі</h3>' + (chain.length ? '<ul class="timeline">' + chain.map(function (c) { return '<li class="e-' + esc(c.effect) + '"><div class="date">' + dt(c.decision_date) + '</div><div class="what">' + (c.id === d.id ? '<b>' + esc(N.DEC[c.dtype]) + '</b> (це рішення)' : '<a href="#/decision/' + c.id + '">' + esc(N.DEC[c.dtype]) + '</a>') + '</div><div class="meta">' + esc(c.court || '') + '</div></li>'; }).join('') + '</ul>' : '<div class="empty">Інших рішень немає</div>') + '</div></div>' +
      '<div class="panel" style="margin-top:14px"><h3>Пов’язані активи <span>' + as.length + '</span></h3><div class="wrap-tbl"><table><tbody>' + as.slice(0, 300).map(function (x) { return '<tr><td><a class="id" href="#/asset/' + x[0].id + '">' + esc(x[0].asset_no) + '</a></td><td>' + esc((x[0].name || '').slice(0, 110)) + '</td><td class="mini">' + esc(N.EFF[x[1]] || '') + '</td><td>' + legal(x[0].legal_status) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (can('edit_decisions') ? '<form data-act="decision-link" data-id="' + d.id + '" style="margin-top:12px"><textarea name="asset_nos" placeholder="Додати активи за номерами" style="width:100%"></textarea><button class="btn gold" style="margin-top:6px">Пов’язати</button></form>' : '') + '</div>';
    render(shell(N.DEC[d.dtype] || 'Судове рішення', (d.court || '') + ' · справа ' + (d.case_no || '—'), '<a class="btn plain" href="#/decisions">До реєстру рішень</a>', h));
  });

  // ================================================================ оцінки
  on(/^\/valuations$/, function (f) {
    var rows = S.valuations.slice(), q = (f.q || '').toLowerCase();
    if (q) rows = rows.filter(function (v) { return [v.lot_name, v.asset_nos, v.procurement_id, v.winner, v.lot_no].join(' ').toLowerCase().indexOf(q) >= 0; });
    if (f.state) rows = rows.filter(function (v) { return valState(v.value_date) === f.state; });
    rows.sort(function (a, b) { return (b.value_date || b.procurement_date || '').localeCompare(a.value_date || a.procurement_date || ''); });
    var cur = S.valuations.filter(function (v) { return v.is_current && v.value_uah && !/^Інвентаризація/.test(v.source || ''); });
    var tot = cur.reduce(function (s, v) { return s + v.value_uah; }, 0), pg = pageOf(rows, f), p = Object.assign({}, f); delete p.page;
    var h = '<div class="grid g4">' + kpi('Оцінена вартість портфеля', num(tot, 2) + ' ₴', 'актуальні оцінки модуля (' + cur.length + ')') + kpi('Записів оцінок', num(S.valuations.length), 'лоти, закупівлі, звіти') +
      kpi('Застарілі', num(S.valuations.filter(function (v) { return valState(v.value_date) === 'expired'; }).length), 'понад 6 міс.', link('/valuations', {state: 'expired'}), 'overdue') + kpi('Без звіту', num(S.valuations.filter(function (v) { return !v.value_date; }).length), 'закупівля триває', link('/valuations', {state: 'none'})) + '</div>' +
      '<form class="filters" data-act="filter" data-base="/valuations" style="margin-top:14px"><input name="q" value="' + esc(f.q) + '" placeholder="№ лоту, назва, № активу, ID закупівлі" style="min-width:300px;flex:1">' + sel('state', [['valid', 'Чинна'], ['expired', 'Понад 6 міс.'], ['none', 'Без звіту']], f.state, 'Актуальність') + '<button class="btn">Знайти</button></form>' +
      pager(rows.length, pg.page, '/valuations', p) + '<div class="wrap-tbl"><table><thead><tr><th>Лот</th><th>Актив / пул</th><th>Закупівля</th><th class="num">Оцінка</th><th>Статус</th></tr></thead><tbody>' +
      pg.rows.map(function (v) { var t = v.target_type === 'pool' ? S.poolById[v.target_id] : v.target_type === 'asset' ? S.byId[v.target_id] : null; return '<tr><td><a class="id" href="#/valuation/' + v.id + '">' + esc(v.lot_no || '#' + v.id) + '</a><span class="sub">' + esc((v.lot_name || '').slice(0, 60)) + '</span></td><td class="mini">' + (v.target_type === 'group' ? 'група: ' + v.assets_count + ' активів' : t ? '<a href="#/' + (v.target_type === 'pool' ? 'pool/' : 'asset/') + t.id + '">' + esc(t.code || t.asset_no) + '</a>' : '<span class="tag t-lim">не прив’язано</span>') + '</td><td class="mini">' + esc(v.procurement_id || '—') + '</td><td class="num nowrap">' + money(v.value_uah) + (v.value_date ? '<span class="sub ' + (valState(v.value_date) === 'expired' ? 'overdue' : '') + '">' + dt(v.value_date) + '</span>' : '') + '</td><td class="mini">' + esc(v.status || '—') + (v.is_current ? '<br><span class="tag t-ok">актуальна</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' + pager(rows.length, pg.page, '/valuations', p);
    render(shell('Оцінки', 'Моніторинг закупівель послуг з оцінки та звітів', can('edit_valuations') ? '<a class="btn gold" href="#/valuation/new">+ Оцінка</a>' : '', h));
  });
  on(/^\/valuation\/new$/, function (f) {
    if (!can('edit_valuations')) return deny();
    var t = f.tt === 'pool' ? S.poolById[f.tid] : f.tt === 'asset' ? S.byId[f.tid] : null;
    var h = '<form data-act="valuation-save" data-tt="' + esc(f.tt || '') + '" data-tid="' + esc(f.tid || '') + '"><fieldset class="panel"><legend>Об’єкт оцінки</legend>' + (t ? '<p><b class="mono">' + esc(t.code || t.asset_no) + '</b> — ' + esc(t.name) + '</p>' : '<div class="form-grid">' + field('Номер активу або код пулу', 'target_ref', '', 'text', true) + '</div>') + '</fieldset>' +
      '<fieldset class="panel"><legend>Закупівля і звіт</legend><div class="form-grid">' + field('№ лоту', 'lot_no', '') + fsel('Статус', 'status', D.VALUATION_STATUS, null) + field('ID закупівлі (Prozorro)', 'procurement_id', '') + field('Переможець', 'winner', '') + field('Ціна договору, грн', 'contract_cost', '', 'number') +
      field('Ринкова вартість, грн', 'value_uah', '', 'number') + field('Дата оцінки', 'value_date', '', 'date') + field('№ звіту', 'report_no', '') + '<div class="field"><label><input type="checkbox" name="is_current" value="1" checked style="width:auto"> Актуальна оцінка</label></div></div></fieldset><button class="btn gold">Зберегти</button></form>';
    render(shell('Нова оцінка', '', '', h));
  });
  on(/^\/valuation\/(\d+)$/, function (id) {
    var v = S.valById[id]; if (!v) return route404();
    var ga = (S.vaByVal[v.id] || []).map(function (i) { return S.byId[i]; }).filter(Boolean);
    var h = (valState(v.value_date) === 'expired' ? '<div class="flash err">Оцінка старша 6 місяців — потрібна нова оцінка.</div>' : '') + '<div class="grid g2"><div class="panel"><h3>Результат</h3><dl class="kv"><dt>Ринкова вартість</dt><dd><b>' + money(v.value_uah) + '</b>' + (v.is_current ? ' <span class="tag t-ok">актуальна</span>' : '') + '</dd><dt>Дата оцінки</dt><dd>' + dt(v.value_date) + '</dd><dt>Звіт</dt><dd>' + esc(v.report_no || '—') + '</dd><dt>Попередня оцінка</dt><dd>' + money(v.prev_value) + '</dd>' + (v.note ? '<dt>Примітка</dt><dd>' + esc(v.note) + '</dd>' : '') + '</dl></div>' +
      '<div class="panel"><h3>Закупівля</h3><dl class="kv"><dt>Лот</dt><dd>' + esc(v.lot_no || '—') + ' ' + esc(v.lot_name || '') + '</dd><dt>Статус</dt><dd>' + esc(v.status || '—') + '</dd><dt>ID закупівлі</dt><dd class="mono">' + esc(v.procurement_id || '—') + '</dd><dt>Очікувана вартість</dt><dd>' + money(v.expected_cost) + '</dd><dt>Переможець</dt><dd>' + esc(v.winner || '—') + '</dd><dt>Ціна договору</dt><dd>' + money(v.contract_cost) + '</dd></dl></div></div>' +
      (ga.length ? '<div class="panel" style="margin-top:14px"><h3>Активи групової оцінки <span>' + ga.length + '</span></h3><p class="mini">Сума — на весь набір. Сформуйте пул, щоб вести оцінку і план спільно.</p><div class="wrap-tbl"><table><tbody>' + ga.slice(0, 300).map(function (a) { return '<tr><td><a class="id" href="#/asset/' + a.id + '">' + esc(a.asset_no) + '</a></td><td>' + esc((a.name || '').slice(0, 110)) + '</td></tr>'; }).join('') + '</tbody></table></div>' + (can('manage_pools') ? '<a class="btn gold" style="margin-top:10px" href="' + link('/pool/new', {ids: ga.map(function (a) { return a.id; }).join(',')}) + '">Сформувати пул з цих активів</a>' : '') + '</div>' : '');
    render(shell('Оцінка' + (v.lot_no ? ' — лот ' + v.lot_no : ''), (v.lot_name || '').slice(0, 140), '<a class="btn plain" href="#/valuations">До оцінок</a>', h));
  });

  // ================================================================ товариства
  on(/^\/companies$/, function (f) {
    var codes = {}; S.assets.forEach(function (a) { if (a.company_code && inScope(a)) codes[a.company_code] = (codes[a.company_code] || 0) + 1; });
    var rows = Object.keys(codes).map(function (c) { return Object.assign({edrpou: c, n: codes[c]}, S.compByCode[c] || {}); }), q = (f.q || '').toLowerCase();
    if (q) rows = rows.filter(function (c) { return (c.name || '').toLowerCase().indexOf(q) >= 0 || c.edrpou.indexOf(q) >= 0; });
    if (f.status) rows = rows.filter(function (c) { return (c.status || 'Не визначено') === f.status; });
    rows.sort(function (a, b) { return b.n - a.n; });
    var pg = pageOf(rows, f), p = Object.assign({}, f); delete p.page;
    var h = '<form class="filters" data-act="filter" data-base="/companies"><input name="q" value="' + esc(f.q) + '" placeholder="Назва або ЄДРПОУ" style="min-width:280px">' + sel('status', D.COMPANY_STATUS, f.status, 'Будь-який стан') + '<button class="btn">Знайти</button></form>' + pager(rows.length, pg.page, '/companies', p) +
      '<div class="wrap-tbl"><table><thead><tr><th>ЄДРПОУ</th><th>Товариство</th><th>Стан</th><th>Основний вид діяльності</th><th class="num">Активів</th><th></th></tr></thead><tbody>' + pg.rows.map(function (c) { return '<tr><td class="mono"><a href="#/company/' + esc(c.edrpou) + '">' + esc(c.edrpou) + '</a></td><td>' + esc(c.name || '—') + '</td><td>' + compStatus(c.status) + '</td><td class="mini">' + esc((c.kved || '—').slice(0, 80)) + '</td><td class="num">' + c.n + '</td><td class="mini"><a href="' + D.YOUCONTROL_URL.replace('{}', encodeURIComponent(c.edrpou)) + '" target="_blank" rel="noopener">YouControl ↗</a></td></tr>'; }).join('') + '</tbody></table></div>';
    render(shell('Пул товариств', 'Корпоративні права: стан товариства і види діяльності', '', h));
  });
  var COMP_F = [['name', 'Найменування'], ['status', 'Стан товариства'], ['kved', 'Основний вид діяльності (КВЕД)'], ['activities', 'Інші види діяльності'], ['legal_form', 'Організаційно-правова форма'], ['address', 'Місцезнаходження']];
  on(/^\/company\/([^/]+)$/, function (code) {
    var c = S.compByCode[code] || {edrpou: code}, as = S.assets.filter(function (a) { return a.company_code === code && inScope(a); }), ed = can('edit_corp_extra');
    var h = '<div class="grid g2" style="align-items:start"><div class="panel"><h3>Відомості про товариство <span>стан і види діяльності — вносяться вручну за даними ЄДР / YouControl</span></h3><div style="margin-bottom:10px">' + compStatus(c.status) + '</div>' +
      (ed ? '<form data-act="company-save" data-code="' + esc(code) + '"><div class="form-grid two">' + COMP_F.map(function (x) { return x[0] === 'status' ? fsel(x[1], 'status', D.COMPANY_STATUS, c.status) : field(x[1], x[0], c[x[0]], x[0] === 'activities' || x[0] === 'address' ? 'textarea' : 'text', false, x[0] === 'kved' ? 'наприклад 68.20 Надання в оренду нерухомого майна' : null, x[0] === 'name' || x[0] === 'activities' ? 'wide' : ''); }).join('') + '</div><button class="btn gold">Зберегти</button></form>'
        : '<dl class="kv">' + COMP_F.map(function (x) { return '<dt>' + x[1] + '</dt><dd>' + esc(c[x[0]] || '—') + '</dd>'; }).join('') + '</dl>') + '</div>' +
      '<div class="panel"><h3>Корпоративні права в управлінні <span>' + as.length + '</span></h3><div class="wrap-tbl"><table><tbody>' + as.map(function (a) { return '<tr><td><a class="id" href="#/asset/' + a.id + '">' + esc(a.asset_no) + '</a></td><td class="mini">' + esc((a.name || '').slice(0, 80)) + '</td><td>' + legal(a.legal_status) + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>';
    render(shell(c.name || 'Товариство ' + code, 'Код ЄДРПОУ ' + code, '<a class="btn" href="' + D.YOUCONTROL_URL.replace('{}', encodeURIComponent(code)) + '" target="_blank" rel="noopener">Відкрити в YouControl ↗</a><a class="btn plain" href="#/companies">До пулу товариств</a>', h));
  });

  // ================================================================ звіти
  on(/^\/reports$/, function () {
    var h = '<div class="grid g3">' + [['Усі активи (у межах ваших прав)', {}], ['Інвестиційно привабливі', {invest: 'attractive'}], ['Управління неможливе', {reason: '__any__'}], ['Без оцінки (привабливі)', {invest: 'attractive', val: 'no'}], ['Розбіжності у правовому стані', {discrepancy: 1}], ['Не закріплені', {unassigned: 1}]].map(function (r) {
      return '<div class="panel"><h3>' + esc(r[0]) + '</h3><a class="btn gold" href="#" data-act="csv" data-q="' + esc(JSON.stringify(r[1])) + '">Вивантажити CSV</a></div>'; }).join('') + '</div><p class="mini" style="margin-top:12px">У демоверсії вивантаження — у форматі CSV (відкривається в Excel). Робоча версія формує XLSX, у тому числі сім переліків окремими аркушами і звіт про виконання планів за відділами ДМА.</p>';
    render(shell('Звіти', 'Вивантаження з урахуванням прав доступу', '', h));
  });

  // ================================================================ адміністрування
  on(/^\/admin\/users$/, function () {
    if (!can('manage_users')) return deny();
    var rn = {}; S.roles.forEach(function (r) { rn[r.code] = r.name; });
    var h = '<div class="wrap-tbl"><table><thead><tr><th>Логін</th><th>ПІБ / посада</th><th>Роль</th><th>Підрозділ</th></tr></thead><tbody>' + S.users.map(function (u) { return '<tr><td class="mono">' + esc(u.login) + '</td><td>' + esc(u.full_name) + '<span class="sub">' + esc(u.position || '') + '</span></td><td class="mini">' + esc(rn[u.role_code] || u.role_code) + '</td><td class="mini">' + esc(N.MTU[u.mtu_code] || N.DMA_SHORT[u.dept_code] || '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<form class="panel" data-act="user-add" style="margin-top:14px"><h3>Новий користувач</h3><div class="form-grid">' + field('Логін', 'login', '', 'text', true) + field('ПІБ', 'full_name', '', 'text', true) + fsel('Роль', 'role_code', S.roles.map(function (r) { return [r.code, r.name]; }), null, true) + fsel('МТУ (для ролей МТУ)', 'mtu_code', MTU_OPT, null) + fsel('Відділ ДМА (для ролей ДМА)', 'dept_code', D.DMA, null) + '</div><button class="btn gold">Створити</button><p class="mini">У робочій версії система видає тимчасовий пароль (діє 72 год.), є блокування і журнал входів.</p></form>';
    render(shell('Користувачі', 'Облікові записи і доступ', '', h));
  });
  on(/^\/admin\/roles$/, function () {
    if (!can('manage_roles')) return deny();
    var h = '<form data-act="roles-save"><div class="wrap-tbl"><table><thead><tr><th>Право</th>' + S.roles.map(function (r) { return '<th style="text-align:center">' + esc(r.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      D.PERMISSIONS.map(function (p) { return '<tr><td>' + esc(p[1]) + '<span class="sub mono">' + p[0] + '</span></td>' + S.roles.map(function (r) { return '<td style="text-align:center"><input type="checkbox" name="p_' + r.code + '_' + p[0] + '"' + (r.perms.indexOf(p[0]) >= 0 ? ' checked' : '') + ' style="width:auto"></td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div><button class="btn gold" style="margin-top:12px">Зберегти права</button></form>';
    render(shell('Ролі та права', 'Права груп користувачів', '', h));
  });
  on(/^\/admin\/audit$/, function (f) {
    if (!can('view_audit')) return deny();
    var pg = pageOf(S.audit, f);
    var h = '<div class="wrap-tbl"><table><thead><tr><th>Дата і час</th><th>Користувач</th><th>Дія</th><th>Об’єкт</th><th>Деталі</th></tr></thead><tbody>' + pg.rows.map(function (r) { return '<tr><td class="mini nowrap">' + esc(r.ts) + '</td><td class="mono mini">' + esc(r.login) + '</td><td>' + esc(r.action) + '</td><td class="mini">' + (r.entity === 'asset' && r.entity_id ? '<a href="#/asset/' + r.entity_id + '">актив #' + r.entity_id + '</a>' : esc(r.entity + ' ' + r.entity_id)) + '</td><td class="mini">' + esc(r.details) + '</td></tr>'; }).join('') +
      (S.audit.length ? '' : '<tr><td colspan="5"><div class="empty">Дій ще немає</div></td></tr>') + '</tbody></table></div>' + pager(S.audit.length, pg.page, '/admin/audit', {});
    render(shell('Журнал дій користувачів', 'У демоверсії — дії в цьому браузері', S.audit.length ? '<a class="btn gold" href="#" data-act="audit-csv">Вивантажити CSV</a>' : '', h));
  });
  on(/^\/admin\/public$/, function () {
    if (!can('manage_public')) return deny();
    var cand = S.assets.filter(function (a) { return a.public_candidate; }), pub = S.assets.filter(function (a) { return a.publish; });
    var h = '<div class="grid g3">' + kpi('Публічні за критерієм', num(cand.length), 'критерій критичності «#Н/Д»', link('/assets', {public: 1})) + kpi('З них з фото', num(cand.filter(function (a) { return a.photo_count; }).length), 'готові до публікації') + kpi('Опубліковано', num(pub.length), 'на сайті', link('/assets', {publish: 1})) + '</div>' +
      '<div class="panel" style="margin-top:14px"><p class="mini">На сайт потрапляють лише активи з критерієм «#Н/Д», позначені до публікації, поза Червоною зоною. Службові поля не показуються.</p><a class="btn gold" href="#/public" target="_blank">Відкрити публічний каталог</a></div>';
    render(shell('Публічний сайт', 'Конструктор каталогу активів', '', h));
  });
  on(/^\/admin\/system$/, function () {
    if (!can('system')) return deny();
    var n = Object.keys(CH.assets).length;
    var h = '<div class="grid g2"><div class="panel"><h3>Ваші зміни в демоверсії</h3><p>Змінено карток активів: <b>' + n + '</b>. Змінені таблиці: ' + esc(Object.keys(CH.tables).join(', ') || 'немає') + '.</p><p class="mini">Зміни зберігаються лише в цьому браузері (IndexedDB). Інші користувачі їх не бачать.</p>' +
      '<button class="btn" data-act="export-changes">Зберегти мої зміни у файл</button> <button class="btn danger" data-act="reset" style="margin-left:6px">Скинути демо до початкового стану</button></div>' +
      '<div class="panel"><h3>Чим демо відрізняється від робочої версії</h3><ul class="mini"><li>Робоча версія працює на сервері Ubuntu з базою PostgreSQL — усі бачать спільні дані.</li><li>Вхід за логіном і паролем, тимчасові паролі, блокування.</li><li>Файли і фото зберігаються на сервері, Червона зона — заборона.</li><li>Імпорт Excel, резервні копії, XLSX-звіти.</li><li>Дані в демо знеособлено: ПІБ і РНОКПП фізичних осіб, номери КП, VIN, номерні знаки, гаманці приховано.</li></ul></div></div>';
    render(shell('Демо-дані', 'Збереження і скидання змін', '', h));
  });

  // ================================================================ публічний каталог
  function publicRoute(path) {
    var pub = S.assets.filter(function (a) { return a.publish && a.public_candidate && a.zone !== 'Червона зона'; }), m = path.match(/^\/public\/(\d+)$/);
    var head = '<div class="pub"><header class="pub-top"><img src="logo.png" alt=""><div><b>' + esc(S.settings.org_name || 'АРМА') + '</b><span>' + esc(S.settings.public_title || 'Каталог активів') + '</span></div></header>';
    var h;
    if (m) {
      var a = pub.filter(function (x) { return String(x.id) === m[1]; })[0];
      if (!a) h = '<div class="empty">Актив не опубліковано.</div>';
      else { var fs = S.filesBy['asset:' + a.id] || [], det = a.details || {};
        h = '<p><a href="#/public">← До каталогу</a></p><h1 style="font-size:22px">' + esc(a.name) + '</h1><p class="sub">' + esc(N.CAT[a.category]) + ' · ' + esc([a.region, a.settl_name].filter(Boolean).join(', ')) + '</p>' +
          '<div class="pgal" style="margin:14px 0">' + fs.map(function (f) { return '<a href="#" data-lb="' + f.id + '">' + thumbImg(f) + '</a>'; }).join('') + '</div>' +
          '<div class="panel"><h3>Характеристики</h3><dl class="kv">' + (D.CATEGORY_FIELDS[a.category] || []).filter(function (fd) { return det[fd[0]] && D.INTERNAL_DETAIL_KEYS.indexOf(fd[0]) < 0; }).map(function (fd) { return '<dt>' + esc(fd[1]) + '</dt><dd>' + esc(det[fd[0]]) + '</dd>'; }).join('') + (a.tech_state ? '<dt>Технічний стан</dt><dd>' + esc(a.tech_state) + '</dd>' : '') + '</dl></div>'; }
    } else {
      h = '<p>' + esc(S.settings.public_intro || '') + '</p><div class="pcards">' + pub.map(function (a) { var f = (S.filesBy['asset:' + a.id] || [])[0];
        return '<a class="pcard" href="#/public/' + a.id + '"><div class="ph">' + (f ? thumbImg(f) : 'фото готується') + '</div><div class="b"><b>' + esc((a.name || '').slice(0, 110)) + '</b><span>' + esc(N.CAT[a.category]) + (a.region ? ' · ' + esc(a.region) : '') + '</span></div></a>'; }).join('') + (pub.length ? '' : '<div class="empty">Опублікованих активів немає</div>') + '</div>';
    }
    $app.innerHTML = head + h + '<footer class="mini" style="margin-top:30px">' + esc(S.settings.public_contacts || '') + (S.user ? ' · <a href="#/">Повернутися до внутрішньої системи</a>' : ' · <a href="#/login">Вхід до демоверсії</a>') + '</footer></div>';
    window.scrollTo(0, 0); fillMedia();
  }

  // ================================================================ дії (форми, кнопки)
  function fd(form) { var o = {}; new FormData(form).forEach(function (v, k) { if (o[k] !== undefined) { if (!Array.isArray(o[k])) o[k] = [o[k]]; o[k].push(v); } else o[k] = v; }); return o; }
  function arr(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }
  function nos(text) { var list = String(text || '').split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean), found = [], miss = [];
    list.forEach(function (n) { var a = S.byNo[n]; if (a) found.push(a); else miss.push(n); }); return {found: found, miss: miss}; }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') document.querySelectorAll('.lightbox').forEach(function (b) { b.remove(); }); });
  document.addEventListener('submit', function (e) {
    var form = e.target, act = form.dataset.act; if (!act) return; e.preventDefault();
    var d = fd(form), btn = e.submitter; if (btn && btn.name) d[btn.name] = btn.value;
    var h = ACT[act]; if (h) h(form, d);
  });
  document.addEventListener('click', function (e) {
    var lb = e.target.closest('[data-lb]');
    if (lb && !e.target.closest('[data-act]')) { e.preventDefault(); return lightbox(lb.dataset.lb); }
    var t = e.target.closest('[data-act]'); if (!t || t.tagName === 'FORM') return;
    var act = t.dataset.act;
    if (act === 'login') { e.preventDefault(); S.user = S.users.filter(function (u) { return u.login === t.dataset.login; })[0]; sessionStorage.setItem('demo-user', S.user.login); log('Вхід до системи', 'user', S.user.id); go('#/'); }
    else if (act === 'logout') { e.preventDefault(); S.user = null; sessionStorage.removeItem('demo-user'); go('#/login'); }
    else if (act === 'csv') { e.preventDefault(); csv(JSON.parse(t.dataset.q || '{}')); }
    else if (act === 'audit-csv') { e.preventDefault(); download('zhurnal_dij.csv', [['Дата', 'Логін', 'Дія', 'Об’єкт', 'ID', 'Деталі']].concat(S.audit.map(function (r) { return [r.ts, r.login, r.action, r.entity, r.entity_id, r.details]; }))); }
    else if (act === 'reset') { if (confirm('Скинути всі ваші зміни в демоверсії?')) idbClear().then(function () { sessionStorage.clear(); location.hash = '#/login'; location.reload(); }); }
    else if (act === 'export-changes') { var b = new Blob([JSON.stringify({assets: CH.assets, tables: Object.keys(CH.tables).reduce(function (o, k) { o[k] = S[k]; return o; }, {})})], {type: 'application/json'}); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'arma-demo-zminy.json'; a.click(); }
    else if (act === 'unfile') { e.preventDefault(); e.stopPropagation(); if (!confirm('Відв’язати фото?')) return; var id = +t.dataset.fid, f = S.files.filter(function (x) { return x.id === id; })[0];
      S.files = S.files.filter(function (x) { return x.id !== id; }); changed('files'); reindex(); if (f && f.target_type === 'asset') setAsset(S.byId[f.target_id], {photo_count: (S.filesBy['asset:' + f.target_id] || []).length}); flash('Фото відв’язано.'); route(); }
  });

  var ACT = {
    search: function (f, d) { go(link('/assets', {q: d.q})); },
    filter: function (f, d) { var o = {}; for (var k in d) if (d[k]) o[k] = d[k]; go(link(f.dataset.base, o)); },
    bulk: function (f, d) {
      var ids = arr(d.ids).map(Number), as = ids.map(function (i) { return S.byId[i]; }).filter(Boolean), a = d.action, v = d.value;
      if (!ids.length || !a) { flash('Оберіть активи і дію.', 'err'); return route(); }
      if (a === 'pool_new') { if (!can('manage_pools')) return deny(); return go(link('/pool/new', {ids: ids.join(',')})); }
      var ed = as.filter(function (x) { return (a === 'publish' || a === 'unpublish') ? can('manage_public') : canEdit(x, 'main') || (a.indexOf('pool') === 0 && can('manage_pools')); }), n = 0;
      ed.forEach(function (x) {
        var p = null;
        if (a === 'dept') p = {dept_code: v || null}; else if (a === 'mtu') p = {mtu_code: v || null}; else if (a === 'invest') p = {invest_grade: v || null};
        else if (a === 'manager') { var u = S.users.filter(function (u2) { return String(u2.id) === v; })[0]; if (u) p = {dma_manager: u.full_name}; }
        else if (a === 'pool_add' && S.poolById[v]) p = {pool_id: +v}; else if (a === 'pool_remove') p = {pool_id: null};
        else if (a === 'publish' && x.public_candidate) p = {publish: 1}; else if (a === 'unpublish') p = {publish: 0};
        if (p) { setAsset(x, p); n++; }
      });
      log('Масова дія: ' + a, 'asset', '', {count: n}); flash('Оновлено активів: ' + n + ' з ' + ids.length + '.'); route();
    },
    'asset-save': function (f, d) {
      var a = S.byId[f.dataset.id], em = canEdit(a, 'main'), es = canEdit(a, 'screening'), p = {}, err = [];
      (em ? SEC_MAIN : []).concat(es ? SEC_SCREEN : []).forEach(function (k) { if (k in d) p[k] = d[k] === '' ? null : d[k]; });
      ['lat', 'lon', 'expected_income_year'].forEach(function (k) { if (p[k] !== undefined && p[k] !== null) { p[k] = parseFloat(String(p[k]).replace(',', '.')); if (isNaN(p[k])) err.push('Поле ' + k + ': потрібне число'); } });
      if (p.lat && (p.lat < 43 || p.lat > 53.5)) err.push('Широта поза межами України — можливо, переставлені широта і довгота.');
      if (p.lon && (p.lon < 21 || p.lon > 41.5)) err.push('Довгота поза межами України.');
      if (p.impossible_reason) p.mgmt_possible = 'no';
      if (p.impossible_reason === 'other_procedural' && !p.procedural_decision) err.push('Для причини «Потребує іншого процесуального рішення» зазначте, якого саме.');
      if (em || es) { var cat = p.category || a.category, det = Object.assign({}, a.details || {});
        (D.CATEGORY_FIELDS[cat] || []).forEach(function (fd2) { var k = 'det_' + cat + '_' + fd2[0]; if (!(k in d)) return; var v = d[k].trim();
          if (!v) { delete det[fd2[0]]; return; } if (['num', 'int', 'year'].indexOf(fd2[2]) >= 0) { v = parseFloat(v.replace(',', '.')); if (isNaN(v)) { err.push('«' + fd2[1] + '»: потрібне число'); return; } } det[fd2[0]] = v; });
        p.details = det; }
      if (can('manage_public')) { p.publish = d.publish && a.public_candidate ? 1 : 0; }
      if (es && (p.inspect_date || p.tech_state)) p.screening_date = today();
      if (err.length) { err.forEach(function (x) { flash(x, 'err'); }); return route(); }
      setAsset(a, p); a._s = null; log('Редагування активу', 'asset', a.id); flash('Зміни збережено.'); go('#/asset/' + a.id);
    },
    'pool-save': function (f, d) {
      if (!can('manage_pools')) return deny();
      if (!d.name) { flash('Вкажіть назву пулу.', 'err'); return route(); }
      d.expected_income_year = d.expected_income_year ? parseFloat(d.expected_income_year) : null;
      var p;
      if (f.dataset.id) { p = S.poolById[f.dataset.id]; Object.assign(p, d, {updated_at: nowS()}); }
      else { var y = new Date().getFullYear(), n = S.pools.filter(function (x) { return (x.code || '').indexOf('POOL-' + y + '-') === 0; }).length + 1;
        p = Object.assign({id: nextId(S.pools), code: 'POOL-' + y + '-' + ('00' + n).slice(-3), status: 'active', complexity: 'pool', source: 'Сформовано в системі', created_by: S.user.login, created_at: nowS()}, d);
        S.pools.push(p); var added = 0;
        (f.dataset.ids || '').split(',').filter(Boolean).forEach(function (i) { var a = S.byId[i]; if (a && !a.pool_id) { setAsset(a, {pool_id: p.id}); added++; } });
        flash('Пул ' + p.code + ' створено, додано активів: ' + added + '.'); }
      changed('pools'); reindex(); log('Пул: збереження', 'pool', p.id); go('#/pool/' + p.id);
    },
    'pool-remove': function (f, d) { arr(d.ids).forEach(function (i) { setAsset(S.byId[i], {pool_id: null}); }); flash('Вилучено з пулу: ' + arr(d.ids).length + '.'); route(); },
    'plan-create': function (f, d) {
      if (!d.process) { flash('Оберіть бізнес-процес.', 'err'); return route(); }
      var tt = f.dataset.tt, tid = +f.dataset.tid, t = tt === 'pool' ? S.poolById[tid] : S.byId[tid];
      if (S.plans.some(function (p) { return p.target_type === tt && p.target_id === tid && p.process === d.process && p.status === 'active'; })) { flash('План за цим процесом уже діє.', 'err'); return route(); }
      var pid = nextId(S.plans), sid = nextId(S.steps), td = today();
      S.plans.push({id: pid, target_type: tt, target_id: tid, process: d.process, dept_code: t.dept_code, manager: t.dma_manager || null, status: 'active', started_at: td, created_by: S.user.login});
      N.STEPS[d.process].forEach(function (s, i) { S.steps.push({id: sid + i, plan_id: pid, ord: i + 1, name: s[0], responsible: s[1], norm_days: s[2], needs_confirm: s[3] ? 1 : 0, status: i ? 'pending' : 'active', started_at: i ? null : td, due_date: i ? null : addWorkdays(td, s[2])}); });
      changed('plans'); changed('steps'); reindex(); log('Розпочато план дій', tt, tid, {process: d.process}); flash('План «' + N.PROC[d.process] + '» розпочато.'); route();
    },
    step: function (f, d) {
      var s = S.steps.filter(function (x) { return x.id === +f.dataset.sid; })[0], who = S.user.full_name, td = today();
      function next() { var nx = (S.stepsByPlan[s.plan_id] || []).filter(function (x) { return x.ord > s.ord && x.status === 'pending'; })[0];
        if (nx) { nx.status = 'active'; nx.started_at = td; nx.due_date = addWorkdays(td, nx.norm_days); } else { var p = S.plans.filter(function (x) { return x.id === s.plan_id; })[0]; p.status = 'done'; p.finished_at = td; changed('plans'); } }
      if (d.action === 'complete' && s.status === 'active') { s.done_by = who; s.done_at = nowS(); s.comment = d.comment || s.comment; if (s.needs_confirm) { s.status = 'review'; flash('Крок виконано, очікує підтвердження менеджера ДМА.'); } else { s.status = 'done'; next(); flash('Крок виконано.'); } }
      else if (d.action === 'confirm' && s.status === 'review') { s.status = 'done'; s.confirmed_by = who; s.comment = d.comment || s.comment; next(); flash('Крок підтверджено.'); }
      else if (d.action === 'return' && s.status === 'review') { if (!d.comment) { flash('Вкажіть, що доопрацювати.', 'err'); return route(); } s.status = 'active'; s.done_by = null; s.comment = 'Повернуто (' + who + '): ' + d.comment; flash('Крок повернуто на доопрацювання.'); }
      changed('steps'); reindex(); log('План дій: ' + d.action, 'plan', s.plan_id, {step: s.name}); route();
    },
    'decision-save': function (f, d) {
      var err = []; if (!d.dtype) err.push('Оберіть вид рішення.'); if (!d.decision_date) err.push('Вкажіть дату рішення.'); if (!d.case_no) err.push('Вкажіть номер справи.');
      var r = nos(d.asset_nos); if (r.miss.length) err.push('Не знайдено активів: ' + r.miss.slice(0, 10).join(', '));
      if (err.length) { err.forEach(function (x) { flash(x, 'err'); }); return route(); }
      var id = nextId(S.decisions), dec = {id: id, dtype: d.dtype, effect: N.DECEFF[d.dtype], court: d.court, case_no: d.case_no, proceeding_no: d.proceeding_no, decision_date: d.decision_date, effective_date: d.effective_date || null, arrest_scope: d.arrest_scope || null, execution: d.execution || null, summary: d.summary, source: 'manual'};
      S.decisions.push(dec); r.found.forEach(function (a) { S.links.push([id, a.id, dec.effect]); }); changed('decisions'); changed('links'); reindex();
      r.found.forEach(recomputeLegal); log('Внесено судове рішення', 'decision', id, {assets: r.found.length}); flash('Рішення внесено, пов’язано активів: ' + r.found.length + '. Правовий стан перераховано.'); go('#/decision/' + id);
    },
    'decision-link': function (f, d) {
      var dec = S.decById[f.dataset.id], r = nos(d.asset_nos), n = 0;
      r.found.forEach(function (a) { if (!(S.assetsByDec[dec.id] || []).some(function (l) { return l[1] === a.id; })) { S.links.push([dec.id, a.id, dec.effect]); n++; } });
      changed('links'); reindex(); r.found.forEach(recomputeLegal); flash('Пов’язано активів: ' + n + '.'); if (r.miss.length) flash('Не знайдено: ' + r.miss.join(', '), 'err'); route();
    },
    'valuation-save': function (f, d) {
      var tt = f.dataset.tt || null, tid = f.dataset.tid ? +f.dataset.tid : null;
      if (d.target_ref) { var p = S.pools.filter(function (x) { return x.code === d.target_ref; })[0], a = S.byNo[d.target_ref];
        if (p) { tt = 'pool'; tid = p.id; } else if (a) { if (a.pool_id) { tt = 'pool'; tid = a.pool_id; } else { tt = 'asset'; tid = a.id; } } else { flash('Актив або пул не знайдено.', 'err'); return route(); } }
      var v = {id: nextId(S.valuations), target_type: tt, target_id: tid, lot_no: d.lot_no, status: d.status, procurement_id: d.procurement_id, winner: d.winner, contract_cost: d.contract_cost ? +d.contract_cost : null, value_uah: d.value_uah ? +d.value_uah : null, value_date: d.value_date || null, report_no: d.report_no, is_current: d.is_current ? 1 : 0, source: 'manual'};
      if (v.is_current && !(v.value_uah && v.value_date)) { flash('Актуальною може бути лише оцінка з сумою і датою.', 'err'); return route(); }
      if (v.is_current) S.valuations.forEach(function (x) { if (x.target_type === tt && x.target_id === tid) x.is_current = 0; });
      S.valuations.push(v); changed('valuations'); reindex();
      if (v.is_current) { if (tt === 'pool') { var pl = S.poolById[tid]; pl.val_amount = v.value_uah; pl.val_date = v.value_date; changed('pools'); } else if (tt === 'asset') setAsset(S.byId[tid], {val_amount: v.value_uah, val_date: v.value_date, val_source: 'Модуль оцінок'}); }
      log('Внесено оцінку', 'valuation', v.id); flash('Оцінку збережено.'); go('#/valuation/' + v.id);
    },
    'company-save': function (f, d) {
      var c = S.compByCode[f.dataset.code]; if (!c) { c = {edrpou: f.dataset.code}; S.companies.push(c); }
      COMP_F.forEach(function (x) { c[x[0]] = d[x[0]] || null; }); changed('companies'); reindex(); log('Редагування товариства', 'company', c.edrpou); flash('Збережено.'); route();
    },
    rate: function (f, d) { var u = parseFloat(String(d.uah).replace(',', '.')); if (isNaN(u)) { flash('Вкажіть курс числом.', 'err'); return route(); }
      var r = S.rateBy[d.token]; if (r) { r.uah = u; r.fetched_at = nowS() + ' (вручну)'; } else S.rates.push({token: d.token, uah: u, usd: null, fetched_at: nowS() + ' (вручну)'}); changed('rates'); reindex(); flash('Курс збережено.'); route(); },
    'user-add': function (f, d) { if (!d.login || !d.full_name || !d.role_code) { flash('Заповніть логін, ПІБ і роль.', 'err'); return route(); }
      if (S.users.some(function (u) { return u.login === d.login; })) { flash('Такий логін уже існує.', 'err'); return route(); }
      S.users.push({id: nextId(S.users), login: d.login, full_name: d.full_name, role_code: d.role_code, mtu_code: d.mtu_code || null, dept_code: d.dept_code || null}); changed('users'); flash('Користувача створено — він з’явиться на сторінці вибору користувача.'); route(); },
    'roles-save': function (f, d) { S.roles.forEach(function (r) { r.perms = D.PERMISSIONS.map(function (p) { return p[0]; }).filter(function (p) { return d['p_' + r.code + '_' + p]; }); if (r.code === 'admin') ['manage_roles', 'manage_users', 'system'].forEach(function (p) { if (r.perms.indexOf(p) < 0) r.perms.push(p); }); });
      changed('roles'); flash('Права збережено.'); route(); },
    upload: function (f, d) {
      var tt = f.dataset.tt, tid = +f.dataset.tid, files = f.querySelector('input[type=file]').files, left = files.length;
      if (tt === 'asset' && S.byId[tid].zone === 'Червона зона') { flash('Червона зона — завантаження заборонено.', 'err'); return route(); }
      if (!left) { flash('Оберіть файли.', 'err'); return route(); }
      Array.prototype.forEach.call(files, function (file) {
        if (file.size > 10 * 1024 * 1024) { flash(file.name + ': понад 10 МБ', 'err'); if (!--left) done(); return; }
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () { function sz(m) { var c = document.createElement('canvas'), k = Math.min(1, m / Math.max(img.width, img.height)); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.8); }
          S.files.push({id: nextId(S.files) + 100000, target_type: tt, target_id: tid, doc_type: 'photo', title: file.name, thumb: sz(320), view: sz(1280)}); if (!--left) done(); };
        img.onerror = function () { flash(file.name + ': не є зображенням', 'err'); if (!--left) done(); };
        img.src = url;
      });
      function done() { changed('files'); reindex(); if (tt === 'asset') setAsset(S.byId[tid], {photo_count: (S.filesBy['asset:' + tid] || []).length}); log('Завантажено фото', tt, tid); flash('Фото додано.'); route(); }
    }
  };

  // ================================================================ CSV
  function download(name, rows) {
    var s = '﻿' + rows.map(function (r) { return r.map(function (c) { c = c === null || c === undefined ? '' : String(c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';'); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], {type: 'text/csv;charset=utf-8'})); a.download = name; a.click();
  }
  function csv(f) {
    var list = f.reason === '__any__' ? S.assets.filter(function (a) { return a.impossible_reason && inScope(a); }) : filterAssets(f);
    download('aktyvy.csv', [['№ активу', 'Найменування', 'Категорія', 'Правовий стан', 'Привабливість', 'Можливість управління', 'Причина неможливості', 'Спосіб передачі', 'МТУ', 'Відділ ДМА', 'Менеджер ДМА', 'Область', 'Адреса', 'Кадастровий номер', 'Оцінка, грн', 'Дата оцінки', 'Пул', 'Зона']].concat(list.map(function (a) {
      return [a.asset_no, a.name, N.CAT[a.category], N.LS[a.legal_status], N.INV[a.invest_grade], N.POS[a.mgmt_possible], N.REASON[a.impossible_reason], N.WAY[a.transfer_way], N.MTU[a.mtu_code], N.DMA[a.dept_code], a.dma_manager, a.region, fullAddress(a), a.cadastral, a.val_amount, a.val_date, (S.poolById[a.pool_id] || {}).code, a.zone]; })));
    log('Вивантаження CSV', 'report', '', {rows: list.length});
  }

  boot();
})();
