/* Навигация, «листание с приглашением» и паспорт участка. К коду карты (script.js) отношения не имеет. */
/* Общие помощники для блоков этого файла (window.gcSite): экранирование HTML, поиск по id, открытие боковой панели */
(function () {
    window.gcSite = {
        $: function (id) { return document.getElementById(id); },
        esc: function (s) { return String(s == null ? '' : s).replace(/[&<>\"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
        // боковая панель скрыта — нажать кнопку-«язычок», чтобы открыть
        openDrawer: function (panel) { if (panel && panel.classList.contains('hidden')) { var tg = document.getElementById('toggleDrawerBtn'); if (tg) tg.click(); } }
    };
})();
(function () {
    var root = document.documentElement;
    var header = document.getElementById('siteHeader');
    var nav = document.getElementById('siteNav');
    var burger = document.getElementById('siteBurger');
    var hero = document.getElementById('top'), mapSec = document.getElementById('map-section');
    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]:not(.s-cta)'));

    burger.addEventListener('click', function () { nav.classList.toggle('open'); });

    // ---- позиции блоков: каждый блок — на весь экран; переход между ними одинаков (колесо -> стрелка -> ещё раз колесо) ----
    var ORDER = ['top', 'map-section', 'data-catalog', 'features', 'how', 'sources', 'contacts'];
    var BLK = {}; ORDER.forEach(function (id) { BLK[id] = document.getElementById(id); });
    function pos() {
        var p = { top: 0 }, hh = header.offsetHeight;
        p['map-section'] = hero.offsetHeight;
        ORDER.slice(2).forEach(function (id) { p[id] = Math.round(BLK[id].getBoundingClientRect().top + window.scrollY - hh); });
        return p;
    }
    function where() {
        var y = window.scrollY, p = pos();
        if (y <= 2) return 'top';
        for (var i = 1; i < ORDER.length; i++) if (Math.abs(y - p[ORDER[i]]) <= 3) return ORDER[i];
        return null;
    }

    // ---- листание с приглашением: колесо -> кнопка -> ещё раз колесо или клик -> переход ----
    var prompt = document.getElementById('sPrompt');
    var pText = document.getElementById('sPromptT'), pIcon = document.getElementById('sPromptI');
    var LABEL = { 'top': 'На главную', 'map-section': 'К карте', 'data-catalog': 'Каталог данных', 'features': 'Возможности', 'how': 'Как это работает', 'sources': 'Источники данных', 'faq': 'Частые вопросы', 'contacts': 'Вопросы и контакты' };
    var armed = null, armTimer = 0, lastWheel = 0, lockUntil = 0;
    var desktop = window.matchMedia('(min-width: 961px)');

    // ---- блок карты (ПК): колесом, клавишами и полосой прокрутки отсюда никуда не листаем — переход только кнопками меню ----
    var mapLock = false, settleT = 0;
    function lockCheck() { mapLock = desktop.matches && where() === 'map-section'; }
    function relock(ms) { clearTimeout(settleT); settleT = setTimeout(lockCheck, ms); }
    window.addEventListener('scroll', function () {
        if (mapLock && performance.now() > lockUntil) {
            var y = pos()['map-section'];
            if (Math.abs(window.scrollY - y) > 3) window.scrollTo({ top: y, behavior: 'instant' });
            return;
        }
        relock(180);
    }, { passive: true });
    window.addEventListener('resize', function () {
        if (!desktop.matches) { mapLock = false; return; }
        if (mapLock) window.scrollTo({ top: pos()['map-section'], behavior: 'instant' }); else lockCheck();
    });
    document.addEventListener('keydown', function (e) {
        if (!mapLock || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        if (['PageDown', 'PageUp', 'Home', 'End', ' ', 'ArrowDown', 'ArrowUp'].indexOf(e.key) < 0) return;
        var t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(t.tagName))) return;
        e.preventDefault();
    });
    lockCheck();

    function disarm() { armed = null; prompt.classList.remove('show'); clearTimeout(armTimer); }
    function arm(t) {
        armed = t; pText.textContent = LABEL[t];
        var up = ORDER.indexOf(t) < ORDER.indexOf(where());
        prompt.classList.toggle('up', up);
        pIcon.className = up ? 'fas fa-arrow-up' : 'fas fa-arrow-down';
        prompt.classList.add('show');
        clearTimeout(armTimer); armTimer = setTimeout(disarm, 3500);
    }
    function go(t) {
        mapLock = false; relock(1300);
        disarm(); lockUntil = performance.now() + 1100;
        window.scrollTo({ top: pos()[t], behavior: 'smooth' });
    }
    function innerScroll(node, dy) {   // есть ли внутри элемента ещё что прокручивать (панель, списки)
        while (node && node !== document.body && node.nodeType === 1) {
            var st = getComputedStyle(node);
            if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
                if (dy > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
                if (dy < 0 && node.scrollTop > 0) return true;
            }
            node = node.parentNode;
        }
        return false;
    }
    window.addEventListener('wheel', function (e) {
        if (!desktop.matches || e.defaultPrevented || e.ctrlKey || Math.abs(e.deltaY) < 3) return;
        var now = performance.now(), fresh = now - lastWheel > 200; lastWheel = now;
        if (now < lockUntil) { e.preventDefault(); return; }
        var w = where();
        if (mapLock || w === 'map-section') {   // на карте колесо только масштабирует карту и прокручивает панели; страница стоит на месте
            if (!innerScroll(e.target, e.deltaY)) e.preventDefault();
            if (armed) disarm();
            return;
        }
        if (!w) return;
        var dy = e.deltaY, t = ORDER[ORDER.indexOf(w) + (dy > 0 ? 1 : -1)] || null;
        // блок выше окна: сначала обычная прокрутка до его низа
        var cur = w === 'top' ? hero : BLK[w];
        if (dy > 0 && w !== 'map-section' && cur.offsetHeight > window.innerHeight - header.offsetHeight + 3) t = null;
        if (!t) { if (armed) disarm(); return; }
        if (innerScroll(e.target, dy)) return;
        e.preventDefault();
        // от блока карты вниз к каталогу — только по клику на кнопку-приглашение; колесо лишь удерживает приглашение на экране
        if (armed === t) { if (w === 'map-section' && t === 'data-catalog') arm(t); else if (fresh) go(t); } else arm(t);
    }, { passive: false });
    prompt.addEventListener('click', function () { if (armed) go(armed); });

    // ---- ссылки меню на три блока (sticky-карта требует точных позиций) ----
    var ANCH = {}; ORDER.forEach(function (id) { ANCH['#' + id] = id; }); ANCH['#about'] = 'features';
    document.addEventListener('click', function (e) {
        var a = e.target.closest('a[href^="#"]'); if (!a) return;
        nav.classList.remove('open');
        var t = ANCH[a.getAttribute('href')]; if (!t) return;
        e.preventDefault(); mapLock = false; relock(1300); disarm(); lockUntil = performance.now() + 1100;
        window.scrollTo({ top: pos()[t], behavior: 'smooth' });
    });

    // ---- подсветка пункта меню ----
    function update() {
        header.classList.toggle('scrolled', window.scrollY > 4);
        var vh = window.innerHeight, id = '#top';
        ORDER.slice(1).forEach(function (k) {
            var passed = k === 'map-section' ? hero.getBoundingClientRect().bottom < vh * 0.5 : BLK[k].getBoundingClientRect().top < vh * 0.5;
            if (passed && links.some(function (a) { return a.getAttribute('href') === '#' + k; })) id = '#' + k;
        });
        links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === id); });
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    // ---- паспорт участка: боковая панель раскрывается на всю область карты ----
    var app = document.querySelector('#map-section .app-container');
    function setPassport(on) {
        app.classList.toggle('passport-open', on);
        if (on) document.dispatchEvent(new Event('passport-open'));
    }
    // демо-участок ≈150 га (Московская область, сельхозугодья) — открывается демо-отчётом без регистрации
    var GC_DEMO_CAD = '50:21:0000000:1234';
    var GC_DEMO_GJ = { type: 'Feature', properties: { cad_number: GC_DEMO_CAD, name: 'Демо-участок' }, geometry: { type: 'Polygon', coordinates: [[[38.54726, 54.83082], [38.560671, 54.829557], [38.57207, 54.831792], [38.573243, 54.837722], [38.562012, 54.840054], [38.549271, 54.838499], [38.54726, 54.83082]]] } };
    // для демо подбираем самый чистый (малооблачный) снимок Sentinel-2 середины последнего лета (20 июня — 10 августа) — без даты спутниковые блоки паспорта не считаются
    var demoSatP = null;
    function demoSat() {
        if (demoSatP) return demoSatP;
        var now = new Date(), yr = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, from = new Date(Date.UTC(yr, 5, 20)), to = new Date(Date.UTC(yr, 7, 10, 23, 59, 59)), mid = Date.UTC(yr, 6, 15), bb = [38.54, 54.828, 38.576, 54.842];
        if (typeof updateStatus === 'function') updateStatus('⏳ Подбираем снимок Sentinel-2 для демо-участка…');
        demoSatP = fetch(((typeof SENTINEL !== 'undefined' && SENTINEL.stacUrl) || 'https://earth-search.aws.element84.com/v1') + '/search', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: bb, limit: 200, datetime: from.toISOString().slice(0, 19) + 'Z/' + to.toISOString().slice(0, 19) + 'Z', fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover'] } })
        }).then(function (r) { return r.json(); }).then(function (j) {
            var by = {};
            (j.features || []).forEach(function (f) {
                var p = f.properties || {}; if (!p.datetime || p['eo:cloud_cover'] == null) return;
                var d = p.datetime.slice(0, 10); (by[d] = by[d] || { day: d, scenes: [] }).scenes.push({ id: f.id, cc: Math.round(p['eo:cloud_cover']) });
            });
            var best = null;
            Object.keys(by).forEach(function (k) {
                var g = by[k]; g.scenes.sort(function (a, b) { return a.cc - b.cc; });
                g.cc = Math.round(g.scenes.reduce(function (s, x) { return s + x.cc; }, 0) / g.scenes.length);
                if (!best || g.cc < best.cc || (g.cc === best.cc && Math.abs(Date.parse(g.day) - mid) < Math.abs(Date.parse(best.day) - mid))) best = g;   // меньше облаков, при равенстве — ближе к 15 июля
            });
            return best;
        }).catch(function () { return null; }).then(function (b) { if (!b) demoSatP = null; return b; });   // не получилось — при следующем открытии попробуем ещё раз
        return demoSatP;
    }
    // паспорт раскрывается по клику на отчёт во вкладке «Отчёты»
    Array.prototype.forEach.call(document.querySelectorAll('[data-open-passport]'), function (el) {
        el.addEventListener('click', function () {
            if (!window.ppShow) { setPassport(true); return; }   // демо-паспорт: участок ≈150 га в сельхозместности Московской области
            demoSat().then(function (sat) { window.ppShow(GC_DEMO_GJ, { cad: GC_DEMO_CAD, sat: sat }); });
        });
    });
    // меню на вкладке «Главная» переключает вкладки боковой панели
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (el) {
        el.addEventListener('click', function () {
            var t = document.querySelector('.panel-tab[data-tab="' + el.getAttribute('data-goto') + '"]');
            if (t) t.click();
        });
    });
    // кнопка «Запустить анализ участка» (заготовка)
    var run = document.getElementById('runAnalysisBtn');
    // ---- «Мои отчёты»: хранятся в localStorage, по клику открывается паспорт участка ----
    var RKEY = 'geoclass.reports.v1', rpList = document.getElementById('rpList'), rpCount = document.getElementById('rpCount');
    var reports = [];
    try { reports = JSON.parse(localStorage.getItem(RKEY) || '[]'); if (!Array.isArray(reports)) reports = []; } catch (e) { reports = []; }
    function rpSave() { try { localStorage.setItem(RKEY, JSON.stringify(reports)); } catch (e) { if (typeof updateStatus === 'function') updateStatus('⚠️ Не удалось сохранить отчёт (хранилище браузера переполнено)', true); } }
    function rpEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function rpRender() {
        if (!rpList) return;
        rpCount.textContent = reports.length + 1;
        rpList.innerHTML = reports.map(function (r) {
            return '<button type="button" class="rp-item" data-rp="' + r.id + '"><i class="fas fa-file-pdf"></i><span><b>' + rpEsc(r.name) + '</b><small>' + r.areaHa.toFixed(2).replace('.', ',') + ' га · анализ от ' + rpEsc(r.date) + (r.sat ? ' · снимок ' + rpEsc(r.sat.day) : '') + '</small></span><span class="rp-del" data-rp-del="' + r.id + '" title="Удалить отчёт" style="padding:6px;color:#94a3b8"><i class="fas fa-trash" style="width:auto;height:auto;background:none;color:inherit"></i></span></button>';
        }).join('');
    }
    if (rpList) rpList.addEventListener('click', function (e) {
        var d = e.target.closest('[data-rp-del]');
        if (d) { e.stopPropagation(); reports = reports.filter(function (r) { return r.id !== d.getAttribute('data-rp-del'); }); rpSave(); rpRender(); return; }
        var b = e.target.closest('[data-rp]'); if (!b) return;
        var r = reports.filter(function (x) { return x.id === b.getAttribute('data-rp'); })[0];
        if (r && window.ppShow) window.ppShow(r.gj, { cad: r.cad, name: r.uname, sat: r.sat });
    });
    rpRender();
    // плоский список слоёв участков (группы GeoJSON раскрываются) → GeoJSON-полигоны
    function rpShapes() {
        var out = [];
        (function walk(l, gn) {
            var nm = l._gcName || l._gcDef || gn || '';   // имя из «Списка объектов»: у самой фигуры или у группы, в которую она вложена
            if (l.getLayers && !(l instanceof L.Path)) { l.getLayers().forEach(function (c) { walk(c, nm); }); return; }
            try {
                var f;
                if (l instanceof L.Circle) { var c = l.getLatLng(); f = turf.circle([c.lng, c.lat], l.getRadius() / 1000, { steps: 64, units: 'kilometers' }); }
                else { var g = l.toGeoJSON(); f = g.type === 'FeatureCollection' ? g.features[0] : g; }
                if (f && f.geometry && /Polygon/.test(f.geometry.type)) out.push({ gj: f, cad: (l.feature && l.feature.properties && l.feature.properties.cad_number) || '', layer: l, nm: nm });
            } catch (e) { /* не полигон */ }
        })(drawnItems);
        return out;
    }
    // ---- выбор даты снимка Sentinel-2 для анализа (календарь как в разделе «Снимки»; сцены ищутся по контуру участка) ----
    var snCal = document.getElementById('anSatCal');
    if (snCal) (function () {
        var month = new Date(), groups = [], seq = 0, cache = {}, lastKey = '', sel = null, note = 'Сначала загрузите или нарисуйте участок — затем здесь появятся даты со снимками.';
        month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
        var $ = gcSite.$, p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        var ccCol = function (c) { return c == null ? '#94a3b8' : c <= 10 ? '#10b981' : c <= 30 ? '#84cc16' : c <= 60 ? '#f59e0b' : '#ef4444'; };
        var fmtD = function (d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
        var stacUrl = function () { return (typeof SENTINEL !== 'undefined' && SENTINEL.stacUrl) || 'https://earth-search.aws.element84.com/v1'; };
        function curShape() { var l = rpShapes(); return l.filter(function (s) { return s.layer === selectedLayer; })[0] || l[0] || null; }
        function bboxOf(s) { var t = turf.bbox(s.gj); return [t[0] - 0.0005, t[1] - 0.0005, t[2] + 0.0005, t[3] + 0.0005].map(function (v) { return +v.toFixed(3); }); }
        function viewBox() {   // нет фигуры — ищем снимки по видимой области карты
            if (map.getZoom() < 7) return null;
            var v = map.getBounds();
            return [v.getWest(), v.getSouth(), v.getEast(), v.getNorth()].map(function (x) { return +x.toFixed(3); });
        }
        function group(fs) {
            var by = {};
            fs.forEach(function (f) { var p = f.properties || {}; if (!p.datetime) return; var d = p.datetime.slice(0, 10), cc = p['eo:cloud_cover'] != null ? Math.round(p['eo:cloud_cover']) : null; (by[d] = by[d] || { day: d, scenes: [] }).scenes.push({ id: f.id, cc: cc }); });
            return Object.keys(by).map(function (k) {
                var g = by[k]; g.scenes.sort(function (a, b) { return (a.cc == null ? 101 : a.cc) - (b.cc == null ? 101 : b.cc); });
                var v = g.scenes.filter(function (s) { return s.cc != null; }); g.cc = v.length ? Math.round(v.reduce(function (t, s) { return t + s.cc; }, 0) / v.length) : null; return g;
            });
        }
        function showSel() {
            var b = $('anSatBadge'), s = $('anSatSel');
            if (sel) { b.textContent = sel.day.split('-').reverse().join('.'); s.innerHTML = '<i class="fas fa-circle-check"></i> Выбрано: <b>' + fmtD(sel.day) + '</b> · облачность ' + (sel.cc == null ? 'нет данных' : sel.cc + ' %') + ' · снимков: ' + sel.scenes.length; }
            else { b.textContent = 'не выбрана'; s.textContent = 'Дата не выбрана — выберите день, отмеченный цветной чертой.'; }
            window.gcSatSel = sel;
        }
        function draw() {
            var y = month.getUTCFullYear(), m = month.getUTCMonth(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), lead = (month.getUTCDay() + 6) % 7, by = {}, max = +$('anSatCc').value, h = '', i, d, day, g;
            groups.forEach(function (x) { by[x.day] = x; });
            for (i = 0; i < lead; i++) h += '<span class="sn-cd empty"></span>';
            for (d = 1; d <= dim; d++) {
                day = y + '-' + p2(m + 1) + '-' + p2(d); g = by[day];
                if (!g) { h += '<span class="sn-cd off">' + d + '</span>'; continue; }
                h += '<button type="button" class="sn-cd has' + (sel && sel.day === day ? ' sel' : '') + (g.cc != null && g.cc > max ? ' dim' : '') + '" data-day="' + day + '" style="--c:' + ccCol(g.cc) + '" title="' + fmtD(day) + ' · облачность ' + (g.cc == null ? 'нет данных' : g.cc + ' %') + ' · снимков: ' + g.scenes.length + '">' + d + '<i></i></button>';
            }
            snCal.innerHTML = h; snCal.classList.remove('busy');
            $('anSatMonth').textContent = month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
            var now = new Date(); $('anSatNext').disabled = month >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            $('anSatInfo').textContent = note;
        }
        function load(retries) {   // retries — на сколько месяцев можно шагнуть назад, если в месяце нет снимков
            var shp = curShape(), my = ++seq;
            var bb = shp ? bboxOf(shp) : viewBox();
            if (!bb) { groups = []; note = 'Загрузите или нарисуйте участок (либо приблизьте карту) — появятся даты со снимками.'; draw(); return; }
            var y = month.getUTCFullYear(), m = month.getUTCMonth(), ck = bb.join(',') + '|' + y + '-' + m, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
            if (cache[ck]) { groups = cache[ck]; note = groups.length ? '' : 'В этом месяце снимков нет.'; draw(); return; }
            snCal.classList.add('busy'); $('anSatInfo').textContent = 'Поиск снимков…';
            fetch(stacUrl() + '/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: bb, limit: 200, datetime: y + '-' + p2(m + 1) + '-01T00:00:00Z/' + y + '-' + p2(m + 1) + '-' + p2(last) + 'T23:59:59Z', fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover'] } }) })
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(function (data) {
                    if (my !== seq) return;
                    groups = group(data.features || []); cache[ck] = groups;
                    if (!groups.length && retries > 0) { month = new Date(Date.UTC(y, m - 1, 1)); load(retries - 1); return; }
                    note = groups.length ? '' : 'В этом месяце снимков нет.'; draw();
                })
                .catch(function (e) { if (my !== seq) return; console.warn('Sentinel STAC', e); groups = []; note = 'Не удалось получить список снимков (' + (e && e.message || 'нет связи с каталогом') + '). Нажмите ⟳.'; draw(); });
        }
        snCal.addEventListener('click', function (e) {
            var b = e.target.closest('[data-day]'); if (!b) return;
            var g = groups.filter(function (x) { return x.day === b.getAttribute('data-day'); })[0]; if (!g) return;
            sel = { day: g.day, cc: g.cc, scenes: g.scenes.map(function (s) { return { id: s.id, cc: s.cc }; }) }; showSel(); draw();
        });
        function shiftMonth(d) { month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + d, 1)); load(0); }
        $('anSatPrev').addEventListener('click', function () { shiftMonth(-1); });
        $('anSatNext').addEventListener('click', function () { shiftMonth(1); });
        $('anSatFind').addEventListener('click', function () { cache = {}; lastKey = ''; load(3); });
        $('anSatCc').addEventListener('input', function () { $('anSatCcVal').textContent = this.value; draw(); });
        // контур участка могли загрузить, нарисовать или изменить — следим, пока вкладка «Анализ» открыта
        setInterval(function () {
            if (!snCal.getClientRects().length) return;
            var shp = curShape(), k = shp ? bboxOf(shp).join(',') : 'v' + (viewBox() || []).join(',');
            if (k === lastKey) return;
            lastKey = k; if (sel && shp) { sel = null; showSel(); }
            load(3);
        }, 1500);
        showSel(); draw();
    })();
    if (run) run.addEventListener('click', function () {
        if (typeof updateStatus !== 'function') return;
        var list = rpShapes();
        if (!list.length) { updateStatus('⚠️ Сначала загрузите или нарисуйте участок', true); return; }
        var sel = list.filter(function (s) { return s.layer === selectedLayer; });
        if (sel.length) list = sel;
        var sat = window.gcSatSel;   // дата снимка Sentinel-2 обязательна
        if (!sat || !sat.day) {
            updateStatus('⚠️ Сначала выберите дату снимка Sentinel-2 в календаре', true);
            var ss = document.getElementById('anSatSection'); if (ss) { ss.scrollIntoView({ behavior: 'smooth', block: 'center' }); ss.classList.add('an-need'); setTimeout(function () { ss.classList.remove('an-need'); }, 2200); }
            return;
        }
        var now = new Date(), date = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        list.forEach(function (s, i) {
            var ha = turf.area(s.gj) / 1e4, un = s.nm || '';   // имя фигуры из «Списка объектов» (стандартное или своё)
            reports.unshift({ id: 'r' + now.getTime().toString(36) + i, name: s.cad ? 'Участок № ' + s.cad : un || 'Участок ' + ha.toFixed(2).replace('.', ',') + ' га', uname: s.cad ? '' : un, cad: s.cad, areaHa: ha, date: date, gj: s.gj, sat: { day: sat.day, cc: sat.cc, scenes: sat.scenes } });
        });
        rpSave(); rpRender();
        var tab = document.querySelector('.panel-tab[data-tab="reports"]'); if (tab) tab.click();
        updateStatus('✅ Анализ выполнен, отчётов сохранено: ' + list.length + ' (вкладка «Отчёты»)');
        if (list.length === 1 && window.ppShow) window.ppShow(reports[0].gj, { cad: reports[0].cad, name: reports[0].uname, sat: reports[0].sat });
    });
    // в 3D рисование недоступно (инструменты теперь в панели, а не на карте)
    var anDraw = document.querySelector('.an-draw');
    if (anDraw) anDraw.addEventListener('click', function (e) {
        if (typeof m3d !== 'undefined' && m3d.active && e.target.closest('.map-btn')) {
            e.stopPropagation(); e.preventDefault();
            if (typeof updateStatus === 'function') updateStatus('ℹ️ Рисование работает в 2D — выключите 3D кнопкой «2D» на карте', true);
        }
    }, true);
    var close = document.getElementById('ppClose');
    if (close) close.addEventListener('click', function () { setPassport(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && app.classList.contains('passport-open')) setPassport(false); });

    // ---- форма-заготовка (отправки пока нет) ----
    var form = document.getElementById('contactForm');
    if (form) form.addEventListener('submit', function (e) {
        e.preventDefault();
        document.getElementById('contactOk').hidden = false;
        form.reset();
    });
    var y = document.getElementById('siteYear');
    if (y) y.textContent = new Date().getFullYear();
})();

/* Боковая панель в стиле Яндекс Карт: меню разделов, стрелка «назад», карточка «Что здесь?», кнопка маршрута (заглушка).
   Работает поверх прежней логики вкладок (script.js не изменён): плитки нажимают на старые вкладки панелей. */
(function () {
    var panel = document.getElementById('mainPanel');
    if (!panel) return;
    var esc = gcSite.esc, openDrawer = gcSite.openDrawer;
    var back = document.getElementById('spBack'), backBtn = document.getElementById('spBackBtn'), backTitle = document.getElementById('spBackTitle');
    var TITLES = {
        tab: { analysis: 'Анализ участка', sources: 'Источники анализа', reports: 'Мои отчёты', catalog: 'Каталог геоданных', help: 'Инструкции', bookmarks: 'Закладки' },
        bp: { userlayers: 'Свои слои', objects: 'Объекты на карте', main: 'Легенда слоёв', draw: 'Рисование', '3d': '3D режим', measure: 'Измерения', chem: 'Почвенный анализ', 'export': 'Экспорт карты', profile: 'Профиль рельефа', logistics: 'Логистика',
              weather: 'Прогноз погоды', climate: 'Климат участка', gdd: 'Тепло и вегетация', frost: 'Заморозки', windwork: 'Ветер и окна работ', dates: 'Снимки', ndvi: 'NDVI', ndmi: 'NDMI', nbr: 'NBR', shape: 'Границы, форма и кадастр', agro: 'Агрокалькулятор', matrix: 'Матрица расстояний', change: 'Сравнение снимков', catalog: 'Каталог данных' }
    };
    function setView(v, title) {
        panel.setAttribute('data-view', v);
        back.hidden = (v === 'home');
        backTitle.textContent = title || '';
        panel.scrollTop = 0;
    }
    function goHome() {
        var m = document.querySelector('.panel-tab[data-tab="main"]');
        if (m) m.click();
        setView('home');
    }
    // любое переключение старых вкладок (в т.ч. из script.js, например включение 3D) сразу показывается в боковой панели
    document.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('.bp-tab, .panel-tab');
        if (!t) return;
        if (t.classList.contains('bp-tab')) {
            var k = t.getAttribute('data-bp-tab');
            setView('bp', TITLES.bp[k] || (t.textContent || '').trim());
        } else {
            var id = t.getAttribute('data-tab');
            if (id === 'main') setView('home'); else setView('tab', TITLES.tab[id] || (t.textContent || '').trim());
        }
    });
    // плитки меню разделов (плитки с data-goto обрабатывает код выше в этом файле)
    panel.addEventListener('click', function (e) {
        var b = e.target.closest('[data-bp]');
        if (!b) return;
        var tab = document.querySelector('.bp-tab[data-bp-tab="' + b.getAttribute('data-bp') + '"]');
        if (tab) tab.click();
    });
    backBtn.addEventListener('click', function () {
        if (panel.getAttribute('data-view') === 'route' && typeof RT !== 'undefined' && RT) RT.close();
        if (panel.getAttribute('data-view') === 'here') {
            var c = document.getElementById('geoCloseBtn');
            if (c && !c.hidden) c.click();   // как в Яндексе: закрытие карточки убирает точку с карты
        }
        goHome();
    });
    // «Что здесь?»: карточка открывается, когда точка выбрана (правый клик или результат поиска), и закрывается, когда точку убрали
    var row = document.getElementById('geoCoordsRow');
    if (row && window.MutationObserver) {
        var geoSec = document.getElementById('geoSection');   // карточка под поиском: видна, пока выбрана точка
        new MutationObserver(function () {
            if (geoSec) geoSec.classList.toggle('geo-on', !row.hidden);
        }).observe(row, { attributes: true, attributeFilter: ['hidden'] });
    }
    window.gcGoHome = goHome;
    // панель свёрнута — поиск остаётся на карте (переезжает на карту, при разворачивании возвращается в панель)
    var sp = panel.querySelector('.sp-search'), head = panel.querySelector('.sp-head'), stage = document.getElementById('mapStage');
    if (sp && head && stage && window.MutationObserver) {
        new MutationObserver(function () {
            if (panel.classList.contains('hidden')) { if (sp.parentNode !== stage) stage.appendChild(sp); }
            else if (sp.parentNode !== head) head.insertBefore(sp, head.firstChild);
        }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    // ---- МАРШРУТ в стиле Яндекс Карт: пункты A/B/промежуточные, способ, варианты, пошаговый маршрут. Расчёт — OSRM ----
    var RT = (function () {
        var pane = document.getElementById('routePane');
        if (!pane || typeof L === 'undefined' || typeof map === 'undefined') return null;
        var elPts = document.getElementById('rtPoints'), elAlts = document.getElementById('rtAlts'), elSteps = document.getElementById('rtSteps'), elState = document.getElementById('rtState');
        // адреса OSRM (авто — тот же сервер, что в «Логистике»; пешком и велосипед — публичные OSRM-серверы OSM)
        var BASE = {
            car: 'https://router.project-osrm.org/route/v1/driving/',
            foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/',
            bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/'
        };
        var MAXPTS = 6, HELP = elState.textContent;
        var pts = [{ q: '', ll: null }, { q: '', ll: null }], mode = 'car', routes = [], sel = 0, picking = -1, req = 0, sugTimer = 0, showSteps = false;
        var layer = L.featureGroup().addTo(map), mk = [], stepMk = null;
        // точки текущего расчёта и их привязка к дорогам (OSRM waypoints): там, где дороги нет, участок достраивается прямой пунктирной линией
        var okPts = [], wps = [];
        var SPD = { car: 5, foot: 1.4, bike: 4 };   // м/с — оценка скорости на участках вне дорог (для времени)

        function fmtT(sec) { var m = Math.max(1, Math.round(sec / 60)); return m < 60 ? m + ' мин' : Math.floor(m / 60) + ' ч ' + (m % 60 ? (m % 60) + ' мин' : ''); }
        function fmtD(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' м' : (m < 100000 ? (m / 1000).toFixed(1).replace('.', ',') : Math.round(m / 1000)) + ' км'; }
        function letter(i) { return i === 0 ? 'A' : (i === pts.length - 1 ? 'B' : String(i)); }
        function color(i) { return i === 0 ? '#16a34a' : (i === pts.length - 1 ? '#ef4444' : '#475569'); }
        function say(txt, err) { elState.textContent = txt; elState.classList.toggle('err', !!err); elState.hidden = !txt; }

        // ---- пункты ----
        function renderPoints() {
            elPts.innerHTML = pts.map(function (p, i) {
                var last = i === pts.length - 1, mid = i > 0 && !last;
                return '<div class="rt-pt" data-i="' + i + '"><span class="rt-dot" style="background:' + color(i) + '">' + letter(i) + '</span>' +
                    '<input type="text" class="rt-in" autocomplete="off" placeholder="' + (i === 0 ? 'Откуда' : last ? 'Куда' : 'Через') + '" value="' + esc(p.q) + '">' +
                    (i === 0 ? '<button type="button" class="rt-ib rt-here" title="Моё местоположение"><i class="fas fa-location-crosshairs"></i></button>' : '') +
                    '<button type="button" class="rt-ib rt-pick' + (picking === i ? ' on' : '') + '" title="Указать на карте"><i class="fas fa-location-dot"></i></button>' +
                    (mid ? '<button type="button" class="rt-ib rt-del" title="Убрать пункт"><i class="fas fa-xmark"></i></button>' : '') +
                    '<div class="rt-sug" hidden></div></div>';
            }).join('');
            document.getElementById('rtAdd').disabled = pts.length >= MAXPTS;
        }
        function renderMarkers() {
            mk.forEach(function (m) { map.removeLayer(m); }); mk = [];
            pts.forEach(function (p, i) {
                if (!p.ll) return;
                var m = L.marker(p.ll, { draggable: true, zIndexOffset: 900, icon: L.divIcon({ className: 'rt-mk', html: '<span style="background:' + color(i) + '">' + letter(i) + '</span>', iconSize: [28, 34], iconAnchor: [14, 34] }) }).addTo(map);
                m.on('dragend', function () { var ll = m.getLatLng(); setPoint(i, [ll.lat, ll.lng], ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5), true); });
                mk.push(m);
            });
        }
        function setPoint(i, ll, q, reverse) {
            pts[i] = { q: q, ll: ll };
            renderPoints(); renderMarkers(); build(true);
            if (reverse) nameOf(ll).then(function (nm) { if (nm && pts[i] && pts[i].ll === ll) { pts[i].q = nm; var inp = elPts.querySelectorAll('.rt-in')[i]; if (inp) inp.value = nm; } });
        }
        function nameOf(ll) {
            return fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=ru&lat=' + ll[0] + '&lon=' + ll[1])
                .then(function (r) { return r.json(); }).then(function (d) {
                    var a = (d && d.address) || {}, street = [a.road, a.house_number].filter(Boolean).join(', ');
                    return street || a.city || a.town || a.village || a.hamlet || (d && d.name) || '';
                }).catch(function () { return ''; });
        }
        function geocode(q) {
            return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ru&q=' + encodeURIComponent(q))
                .then(function (r) { return r.json(); }).catch(function () { return []; });
        }
        function suggest(i, q, box) {
            if (q.trim().length < 3) { box.hidden = true; return; }
            geocode(q).then(function (list) {
                if (!list.length) { box.innerHTML = '<div class="rt-none">Ничего не найдено</div>'; box.hidden = false; return; }
                box.innerHTML = list.map(function (r, k) {
                    var parts = r.display_name.split(', ');
                    return '<button type="button" class="rt-opt" data-k="' + k + '"><b>' + esc(parts[0]) + '</b><small>' + esc(parts.slice(1, 4).join(', ')) + '</small></button>';
                }).join('');
                box._list = list; box.hidden = false;
            });
        }
        function pickResult(i, r) { setPoint(i, [parseFloat(r.lat), parseFloat(r.lon)], r.display_name.split(', ').slice(0, 2).join(', ')); if (!pts[i + 1] || pts[i + 1].ll) return; var n = elPts.querySelectorAll('.rt-in')[i + 1]; if (n) n.focus(); }

        elPts.addEventListener('input', function (e) {
            var row = e.target.closest('.rt-pt'); if (!row || !e.target.classList.contains('rt-in')) return;
            var i = +row.dataset.i; pts[i].q = e.target.value; pts[i].ll = null; renderMarkers(); clearRoute();
            clearTimeout(sugTimer); sugTimer = setTimeout(function () { suggest(i, e.target.value, row.querySelector('.rt-sug')); }, 600);
        });
        elPts.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' || !e.target.classList.contains('rt-in')) return;
            var row = e.target.closest('.rt-pt'), i = +row.dataset.i, box = row.querySelector('.rt-sug');
            clearTimeout(sugTimer);
            if (box._list && !box.hidden) { pickResult(i, box._list[0]); return; }
            geocode(e.target.value).then(function (l) { if (l[0]) pickResult(i, l[0]); else say('Адрес «' + e.target.value + '» не найден', true); });
        });
        elPts.addEventListener('focusin', function (e) { var row = e.target.closest('.rt-pt'); if (row && e.target.classList.contains('rt-in')) e.target.select(); });
        elPts.addEventListener('focusout', function (e) { var box = e.target.closest('.rt-pt') && e.target.closest('.rt-pt').querySelector('.rt-sug'); if (box) setTimeout(function () { box.hidden = true; }, 220); });
        elPts.addEventListener('click', function (e) {
            var row = e.target.closest('.rt-pt'); if (!row) return; var i = +row.dataset.i;
            var opt = e.target.closest('.rt-opt');
            if (opt) { pickResult(i, row.querySelector('.rt-sug')._list[+opt.dataset.k]); return; }
            if (e.target.closest('.rt-here')) {
                if (window.userLoc) setPoint(i, [window.userLoc.lat, window.userLoc.lng], 'Моё местоположение');
                else if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { window.userLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; setPoint(i, [p.coords.latitude, p.coords.longitude], 'Моё местоположение'); }, function () { say('Не удалось определить местоположение', true); });
                return;
            }
            if (e.target.closest('.rt-pick')) { startPick(i); return; }
            if (e.target.closest('.rt-del')) { pts.splice(i, 1); renderPoints(); renderMarkers(); build(true); }
        });
        function startPick(i) {
            stopPick();
            picking = i; renderPoints(); map.getContainer().classList.add('rt-picking');
            say('Щёлкните по карте, чтобы указать пункт «' + letter(i) + '» (Esc — отмена)');
            map.once('click', onMapPick);
        }
        function stopPick() { picking = -1; map.off('click', onMapPick); map.getContainer().classList.remove('rt-picking'); }
        function onMapPick(e) {
            var i = picking; stopPick();
            if (i < 0) return;
            setPoint(i, [e.latlng.lat, e.latlng.lng], e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5), true);
        }
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && picking >= 0) { stopPick(); renderPoints(); say(HELP); } });

        document.getElementById('rtAdd').addEventListener('click', function () {
            if (pts.length >= MAXPTS) return;
            pts.splice(pts.length - 1, 0, { q: '', ll: null }); renderPoints();
            var inp = elPts.querySelectorAll('.rt-in')[pts.length - 2]; if (inp) inp.focus();
        });
        document.getElementById('rtSwap').addEventListener('click', function () { pts.reverse(); renderPoints(); renderMarkers(); build(true); });
        document.getElementById('rtModes').addEventListener('click', function (e) {
            var b = e.target.closest('.rt-mode'); if (!b) return;
            mode = b.dataset.mode;
            Array.prototype.forEach.call(document.querySelectorAll('#rtModes .rt-mode'), function (x) { x.classList.toggle('active', x === b); });
            build(false);
        });

        // ---- расчёт и показ ----
        function clearRoute() { layer.clearLayers(); routes = []; elAlts.innerHTML = ''; elSteps.hidden = true; elSteps.innerHTML = ''; if (stepMk) { map.removeLayer(stepMk); stepMk = null; } }
        function build(fit) {
            var ok = pts.filter(function (p) { return p.ll; });
            clearRoute();
            if (ok.length < 2 || ok.length !== pts.filter(function (p) { return p.q || p.ll; }).length) { say(ok.length < 2 ? HELP : 'Укажите все пункты маршрута'); return; }
            var id = ++req, coords = ok.map(function (p) { return p.ll[1] + ',' + p.ll[0]; }).join(';');
            say('Строим маршрут…');
            okPts = ok.map(function (p) { return p.ll; }); wps = [];
            fetch(BASE[mode] + coords + '?overview=full&geometries=geojson&steps=true&alternatives=' + (ok.length === 2 ? 'true' : 'false'))
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (id !== req) return;
                    if (!j.routes || !j.routes.length) {
                        if (j.code === 'NoRoute' || j.code === 'NoSegment') { straight(fit !== false); return; }   // дорог нет совсем — соединяем пункты прямой пунктирной линией
                        say('Не удалось построить маршрут', true); return;
                    }
                    routes = j.routes; wps = j.waypoints || []; sel = 0; say(''); draw(fit !== false);
                })
                .catch(function () { if (id === req) say('Сервис маршрутов OSRM недоступен. Попробуйте позже.', true); });
        }
        // прямая пунктирная линия (с белой подложкой, чтобы было видно на любой подложке карты)
        function dashedLine(ll) {
            L.polyline(ll, { color: '#fff', weight: 8, opacity: .9, dashArray: '8 8', lineCap: 'butt', interactive: false }).addTo(layer);
            return L.polyline(ll, { color: '#2563eb', weight: 4, opacity: 1, dashArray: '8 8', lineCap: 'butt', interactive: false }).addTo(layer);
        }
        // участки вне дорог: от указанной точки до ближайшей дороги (прямой пунктир); возвращает их суммарную длину, м
        function drawGaps() {
            var total = 0;
            okPts.forEach(function (p, i) {
                var w = wps[i]; if (!w || !w.location) return;
                var b = [w.location[1], w.location[0]], d = L.latLng(p).distanceTo(b);
                if (d < 15) return;   // точка и так на дороге
                dashedLine([p, b]); total += d;
            });
            return total;
        }
        // дорог между пунктами нет: пункты соединяются прямой пунктирной линией
        function straight(fit) {
            var len = 0; layer.clearLayers();
            for (var i = 1; i < okPts.length; i++) len += L.latLng(okPts[i - 1]).distanceTo(okPts[i]);
            var line = dashedLine(okPts);
            if (fit) map.fitBounds(line.getBounds(), { padding: [50, 50] });
            say('Дорог между пунктами нет — показана прямая пунктиром: ' + fmtD(len) + ' (время не рассчитывается)');
        }
        function draw(fit) {
            layer.clearLayers();
            routes.forEach(function (r, i) {
                if (i === sel) return;
                var ll = r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
                L.polyline(ll, { color: '#94a3b8', weight: 6, opacity: .9, lineCap: 'round' }).on('click', function () { sel = i; draw(false); }).addTo(layer);
            });
            var main = routes[sel].geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
            L.polyline(main, { color: '#fff', weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
            var line = L.polyline(main, { color: '#2563eb', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
            var gapM = drawGaps(), bnds = line.getBounds();
            okPts.forEach(function (p) { bnds.extend(p); });
            if (fit) map.fitBounds(bnds, { padding: [50, 50] });
            elAlts.innerHTML = routes.map(function (r, i) {
                var via = r.legs && r.legs[0] && r.legs[0].summary ? 'через ' + r.legs[0].summary.split(', ')[0] : '';
                return '<button type="button" class="rt-alt' + (i === sel ? ' active' : '') + '" data-i="' + i + '"><b>' + fmtT(r.duration + gapM / SPD[mode]) + '</b><span>' + fmtD(r.distance + gapM) + '</span>' +
                    '<small>' + (i === 0 ? 'Оптимальный' : 'Альтернатива') + (via ? ' · ' + esc(via) : '') + (gapM >= 15 ? ' · по прямой (без дорог) ' + fmtD(gapM) : '') + '</small></button>';
            }).join('');
            renderSteps();
        }
        elAlts.addEventListener('click', function (e) { var b = e.target.closest('.rt-alt'); if (!b) return; sel = +b.dataset.i; draw(false); });

        // ---- пошаговый маршрут ----
        var DIR = { 'left': 'налево', 'right': 'направо', 'slight left': 'слегка налево', 'slight right': 'слегка направо', 'sharp left': 'резко налево', 'sharp right': 'резко направо', 'straight': 'прямо' };
        var ANG = { 'straight': 0, 'slight right': 45, 'right': 90, 'sharp right': 135, 'uturn': 180, 'sharp left': -135, 'left': -90, 'slight left': -45 };
        function stepInfo(s) {
            var m = s.maneuver || {}, ty = m.type, md = m.modifier, d = DIR[md] || '', nm = s.name ? ' — ' + s.name : '', txt, icon;
            if (ty === 'depart') { txt = 'Начните движение' + nm; icon = 'fa-circle-dot'; }
            else if (ty === 'arrive') { txt = 'Вы прибыли в пункт назначения'; icon = 'fa-flag-checkered'; }
            else if (ty === 'roundabout' || ty === 'rotary' || ty === 'roundabout turn') { txt = 'На кольце ' + (m.exit ? 'сверните на ' + m.exit + '-й съезд' : 'продолжайте движение') + nm; icon = 'fa-rotate-right'; }
            else if (ty === 'exit roundabout' || ty === 'exit rotary') { txt = 'Съезжайте с кольца' + nm; icon = 'fa-rotate-right'; }
            else if (ty === 'fork') { txt = 'На развилке держитесь ' + (md && md.indexOf('left') >= 0 ? 'левее' : 'правее') + nm; }
            else if (ty === 'merge') { txt = 'Перестройтесь ' + (d || 'прямо') + nm; }
            else if (ty === 'on ramp' || ty === 'off ramp') { txt = (ty === 'on ramp' ? 'Въезжайте на трассу ' : 'Съезжайте ') + d + nm; }
            else if (ty === 'end of road') { txt = 'В конце дороги поверните ' + (d || 'направо') + nm; }
            else if (ty === 'turn') { txt = md === 'uturn' ? 'Развернитесь' + nm : 'Поверните ' + (d || 'направо') + nm; }
            else { txt = 'Продолжайте движение ' + (d || 'прямо') + nm; }
            return { txt: txt, icon: icon || 'fa-arrow-up', rot: icon ? 0 : (ANG[md] || 0) };
        }
        function renderSteps() {
            var r = routes[sel], all = [];
            (r.legs || []).forEach(function (lg) { (lg.steps || []).forEach(function (s) { all.push(s); }); });
            if (!all.length) { elSteps.hidden = true; return; }
            elSteps.hidden = false;
            elSteps.innerHTML = '<button type="button" class="rt-steps-h"><span>Маршрут по шагам <em>' + all.length + '</em></span><i class="fas fa-chevron-' + (showSteps ? 'up' : 'down') + '"></i></button>' +
                (showSteps ? '<ol>' + all.map(function (s, k) {
                    var o = stepInfo(s);
                    return '<li><button type="button" class="rt-step" data-k="' + k + '"><i class="fas ' + o.icon + '" style="transform:rotate(' + o.rot + 'deg)"></i><span>' + esc(o.txt) + '</span><small>' + (s.distance ? fmtD(s.distance) : '') + '</small></button></li>';
                }).join('') + '</ol>' : '');
            elSteps._all = all;
        }
        elSteps.addEventListener('click', function (e) {
            if (e.target.closest('.rt-steps-h')) { showSteps = !showSteps; renderSteps(); return; }
            var b = e.target.closest('.rt-step'); if (!b) return;
            var s = elSteps._all[+b.dataset.k], ll = [s.maneuver.location[1], s.maneuver.location[0]];
            if (stepMk) map.removeLayer(stepMk);
            stepMk = L.circleMarker(ll, { radius: 9, color: '#2563eb', weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
            map.flyTo(ll, Math.max(map.getZoom(), 16), { duration: .6 });
        });

        return {
            setEnd: function (which, ll) {   // «Маршрут отсюда» (пункт A) / «Маршрут сюда» (последний пункт) из меню карты
                setPoint(which === 'from' ? 0 : pts.length - 1, ll, ll[0].toFixed(5) + ', ' + ll[1].toFixed(5), true);
            },
            open: function () {
                if (!pts[0].ll && !pts[0].q && window.userLoc) { pts[0] = { q: 'Моё местоположение', ll: [window.userLoc.lat, window.userLoc.lng] }; renderMarkers(); }
                renderPoints(); say(pts.filter(function (p) { return p.ll; }).length >= 2 ? '' : HELP);
                var inp = elPts.querySelectorAll('.rt-in'); var tgt = pts[0].ll ? inp[inp.length - 1] : inp[0]; if (tgt) setTimeout(function () { tgt.focus(); }, 50);
            },
            close: function () {
                stopPick(); req++; clearRoute();
                mk.forEach(function (m) { map.removeLayer(m); }); mk = [];
                pts = [{ q: '', ll: null }, { q: '', ll: null }]; routes = []; showSteps = false; renderPoints();
            }
        };
    })();
    // маршрутизатор подключён? иначе — сообщение в строку состояния
    function rtReady() { if (RT) return true; if (typeof updateStatus === 'function') updateStatus('ℹ️ Карта ещё не загружена', true); return false; }
    var route = document.getElementById('routeBtn');
    if (route) route.addEventListener('click', function () {
        if (!rtReady()) return;
        setView('route', 'Маршрут'); RT.open();
    });
    // ---- правый клик по карте: «Маршрут сюда» / «Маршрут отсюда» / «Сохранить закладку» ----
    function ctxPt() { return (typeof contextMenuLatLng !== 'undefined' && contextMenuLatLng) ? [contextMenuLatLng.lat, contextMenuLatLng.lng] : null; }
    function ctxRoute(which) {
        var ll = ctxPt();
        if (typeof hideMapContextMenu === 'function') hideMapContextMenu();
        if (!ll) return;
        if (!rtReady()) return;
        openDrawer(panel);
        setView('route', 'Маршрут'); RT.open(); RT.setEnd(which, ll);
    }
    var cTo = document.getElementById('ctxRouteTo'), cFrom = document.getElementById('ctxRouteFrom'), cBm = document.getElementById('ctxBookmark');
    if (cTo) cTo.addEventListener('click', function () { ctxRoute('to'); });
    if (cFrom) cFrom.addEventListener('click', function () { ctxRoute('from'); });
    if (cBm) cBm.addEventListener('click', function () {
        var ll = ctxPt();
        if (typeof hideMapContextMenu === 'function') hideMapContextMenu();
        if (ll && window.gcBookmarkAdd) window.gcBookmarkAdd(L.latLng(ll[0], ll[1]));
    });
    // ---- кнопка «Очистить» вверху слева на карте: убирает всё нарисованное и загруженное, замеры, маршрут, точку «Что здесь?» и результаты анализов ----
    var clearBtn = document.getElementById('mapClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
        function safe(fn) { try { fn(); } catch (err) { /* один из модулей мог не загрузиться — остальное чистим дальше */ } }
        function press(id) { var b = document.getElementById(id); if (b) safe(function () { b.click(); }); }
        safe(function () { if (currentTool || activeDrawHandler || isEditing || sketchState.tool) deactivateAllTools(); });   // отменить незавершённое рисование
        safe(function () { if (measureMode) deactivateMeasureMode(); });
        safe(function () {   // участки: нарисованные и загруженные из файлов (та же логика, что у кнопки «Очистить» во вкладке анализа; её клик в 3D блокируется)
            drawnItems.clearLayers();
            objectLabels.forEach(function (l) { if (map.hasLayer(l)) map.removeLayer(l); });
            objectLabels = [];
            disableEditForAll();
            selectedLayer = null;
            if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
            document.getElementById('infoSection').style.display = 'none';
            areaHa = 0; estimatedCost = 0; objectsCount = 0;
            updateObjectList();
        });
        safe(function () { if (sketchItems.getLayers().length) { skSelect(null); sketchItems.clearLayers(); skCommit(); skRenderList(); } });   // фигуры, линии, значки и текст из «Рисования»
        safe(function () { clearMeasurements(); });   // линейка и площадь
        safe(function () { clearGeoPoint(); });   // точка «Что здесь?»
        safe(function () { if (RT) RT.close(); });   // маршрут
        press('pfClear'); press('hyClearBtn'); press('lgClear');
        safe(function () { if (window.wxClearAll) window.wxClearAll(); });   // погода: фигура и результаты
        safe(function () { if (window.chClearAll) window.chClearAll(); });   // почвенный анализ: фигура, статистика, графики и зоны
        safe(function () { if (window.agClearAll) window.agClearAll(); });   // агрокалькулятор: фигура
        safe(function () { if (window.shpClearAll) window.shpClearAll(); });   // границы и форма: фигура и результаты
        safe(function () { if (window.mxClearAll) window.mxClearAll(); });   // вкладка «Измерения»
        safe(function () { if (window.snClearAll) window.snClearAll(); });   // фигура, зоны и аномальные точки разделов NDVI / NDMI…
        safe(function () { if (window.gcProfileClear) window.gcProfileClear(); });   // профиль и гипсометрия: линия, полигон, тепловая карта   // профиль рельефа, гипсометрия, логистика (объект, буфер, дороги, водоёмы)
        safe(function () { map.closePopup(); });
        safe(function () {   // 3D: модели и выдавленные полигоны
            if (typeof m3d === 'undefined') return;
            if (m3d.map) { m3d.items.slice().forEach(m3RemoveItem); m3RenderList(); m3SyncSelectedUI(); m3CancelPlacing(); m3RemoveMarker(); }
            if (m3d.active) m3RefreshUser();
        });
        if (typeof updateStatus === 'function') updateStatus('🧹 Карта очищена');
    });
    setView('home');
})();

/* Каталог данных: выбор наборов для приобретения (оформление заказа — заготовка). */
(function () {
    var sec = document.getElementById('data-catalog');
    if (!sec) return;
    var opts = Array.prototype.slice.call(sec.querySelectorAll('.s-opt'));
    function eachCatAll(fn) { Array.prototype.forEach.call(sec.querySelectorAll('.s-cat-all'), fn); }
    var sum = document.getElementById('catSum'), clr = document.getElementById('catClear'), ord = document.getElementById('catOrder'), ok = document.getElementById('catOk');
    var NAMES = { osm: 'векторные OSM', sat: 'спутниковые', ana: 'аналитические' };
    function plural(n) { var a = n % 10, b = n % 100; return (a === 1 && b !== 11) ? 'набор' : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? 'набора' : 'наборов'; }
    function refresh() {
        var on = opts.filter(function (o) { return o.classList.contains('selected'); });
        if (!on.length) sum.textContent = 'Ничего не выбрано';
        else {
            var by = {};
            on.forEach(function (o) { var k = o.closest('.s-cat-card').getAttribute('data-cat'); by[k] = (by[k] || 0) + 1; });
            sum.textContent = 'Выбрано: ' + on.length + ' ' + plural(on.length) + ' (' + Object.keys(by).map(function (k) { return NAMES[k] + ' — ' + by[k]; }).join(', ') + ')';
        }
        clr.disabled = ord.disabled = !on.length;
        ok.hidden = true;
        eachCatAll(function (b) {
            var card = b.closest('.s-cat-card'), all = card.querySelectorAll('.s-opt'), sel = card.querySelectorAll('.s-opt.selected');
            b.textContent = (sel.length === all.length) ? 'Снять выбор' : 'Выбрать все';
        });
    }
    opts.forEach(function (o) { o.addEventListener('click', function () { o.classList.toggle('selected'); refresh(); }); });
    eachCatAll(function (b) {
        b.addEventListener('click', function () {
            var all = b.closest('.s-cat-card').querySelectorAll('.s-opt'), full = b.closest('.s-cat-card').querySelectorAll('.s-opt.selected').length === all.length;
            Array.prototype.forEach.call(all, function (o) { o.classList.toggle('selected', !full); });
            refresh();
        });
    });
    clr.addEventListener('click', function () { opts.forEach(function (o) { o.classList.remove('selected'); }); refresh(); });
    ord.addEventListener('click', function () { ok.hidden = false; });
    refresh();
})();

/* Заставка анализа: крупная анимация в брендовых цветах поверх инструментов боковой панели, пока идёт расчёт.
   API: var id = AnLoader.start('Заголовок', 'Текст шага', { onCancel: fn, delay: мс }); AnLoader.progress(0..100 | null, 'Текст'); AnLoader.end(id);
   Показывается с небольшой задержкой (быстрые расчёты не мигают) и не исчезает мгновенно. */
(function () {
    var el = document.getElementById('anLoader'), panel = document.getElementById('mainPanel');
    if (!el || !panel) return;
    var box = el.querySelector('.an-loader-box'), bar = document.getElementById('anBar'), barWrap = document.getElementById('anBarWrap');
    var tTitle = document.getElementById('anTitle'), tText = document.getElementById('anText'), tPct = document.getElementById('anPct'), tTime = document.getElementById('anTime');
    var btn = document.getElementById('anCancel');
    var seq = 0, cur = null, shown = false, shownAt = 0, startAt = 0, showT = 0, hideT = 0, tick = 0, MIN_SHOW = 900;

    function fit() { box.style.height = panel.clientHeight + 'px'; }
    function setPct(p) {
        if (p == null || isNaN(p)) { barWrap.classList.add('ind'); bar.style.width = ''; tPct.innerHTML = '&nbsp;'; return; }
        p = Math.max(0, Math.min(100, p));
        barWrap.classList.remove('ind'); bar.style.width = p + '%'; tPct.textContent = Math.round(p) + '%';
    }
    function reveal() {
        if (shown || !cur) return;
        fit(); el.hidden = false; void el.offsetWidth; el.classList.add('on');
        shown = true; shownAt = Date.now();
        tick = setInterval(function () { tTime.textContent = Math.round((Date.now() - startAt) / 1000) + ' с'; }, 250);
    }
    function hide() {
        if (!shown || cur) return;
        shown = false; el.classList.remove('on'); clearInterval(tick);
        setTimeout(function () { if (!shown) el.hidden = true; }, 240);
    }
    box.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });   // панель под заставкой не прокручивается
    window.addEventListener('resize', function () { if (shown) fit(); });
    var gone = {};   // расчёты, отменённые пользователем
    btn.addEventListener('click', function () { if (cur && cur.cancel) { cur.stop = true; gone[cur.id] = 1; btn.disabled = true; cur.cancel(); } });

    window.AnLoader = {
        start: function (title, text, opt) {
            var id = ++seq;
            cur = { id: id, cancel: opt && opt.onCancel };
            startAt = Date.now(); tTime.textContent = '0 с';
            tTitle.textContent = title || 'Анализ'; tText.textContent = text || 'Обработка данных…'; setPct(null);
            btn.hidden = !cur.cancel; btn.disabled = false;
            clearTimeout(hideT);
            if (!shown) { clearTimeout(showT); showT = setTimeout(reveal, opt && opt.delay != null ? opt.delay : 250); }
            return id;
        },
        progress: function (pct, text) {
            if (!cur) return;
            if (text) tText.textContent = text;
            setPct(pct);
        },
        cancelled: function (id) { return !!gone[id]; },   // этот расчёт отменён
        cancelledNow: function () { return !!(cur && cur.stop); },   // текущий расчёт отменён
        end: function (id) {
            if (!cur || (id != null && id !== cur.id)) return;   // уже идёт другой расчёт — его заставку не трогаем
            cur = null; clearTimeout(showT);
            if (shown) { clearTimeout(hideT); hideT = setTimeout(hide, Math.max(0, MIN_SHOW - (Date.now() - shownAt))); }
        }
    };
})();

/* ===== Закладки: хранятся в localStorage браузера (скриншот карты, название, описание) ===== */
(function () {
    var KEY = 'geoclass.bookmarks.v1';
    var esc = gcSite.esc;
    var listEl = document.getElementById('bmList'), emptyEl = document.getElementById('bmEmpty'), cntEl = document.getElementById('bmCount');
    if (!listEl || typeof L === 'undefined' || typeof map === 'undefined') return;
    var items = [], pin = null;
    function load() { try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); items = Array.isArray(a) ? a : []; } catch (e) { items = []; } }
    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(items)); }
        catch (e) {   // не хватило места — сохраняем без скриншотов
            try { localStorage.setItem(KEY, JSON.stringify(items.map(function (b) { var c = {}; for (var k in b) c[k] = b[k]; c.img = ''; return c; }))); } catch (e2) { /* хранилище недоступно */ }
        }
    }
    function imgHtml(b) { return b.img && b.img.indexOf('data:image/') === 0 ? '<img src="' + b.img + '" alt="">' : '<i class="fas fa-map-location-dot"></i>'; }
    function render() {
        cntEl.textContent = items.length; emptyEl.hidden = items.length > 0;
        listEl.innerHTML = items.map(function (b) {
            return '<div class="bm-card" data-id="' + esc(b.id) + '"><div class="bm-img">' + imgHtml(b) + '</div>' +
                '<input class="bm-name" maxlength="80" placeholder="Название" value="' + esc(b.name) + '">' +
                '<div class="bm-xy">' + b.lat.toFixed(5) + '°, ' + b.lng.toFixed(5) + '°</div>' +
                '<textarea class="bm-desc" rows="2" maxlength="500" placeholder="Описание">' + esc(b.desc) + '</textarea>' +
                '<div class="bm-act"><button type="button" class="bm-go"><i class="fas fa-location-crosshairs"></i> На карте</button>' +
                '<button type="button" class="bm-del"><i class="fas fa-trash"></i> Удалить</button></div></div>';
        }).join('');
    }
    function patch(b) {   // обновление карточки без перерисовки списка (чтобы не сбивать ввод)
        var card = listEl.querySelector('[data-id="' + b.id + '"]'); if (!card) return;
        card.querySelector('.bm-img').innerHTML = imgHtml(b);
        var inp = card.querySelector('.bm-name'); if (inp !== document.activeElement) inp.value = b.name;
    }
    function byId(el) { var c = el.closest('.bm-card'); if (!c) return null; var id = c.getAttribute('data-id'); return items.filter(function (b) { return b.id === id; })[0] || null; }
    // миниатюра: мозаика тайлов OSM вокруг точки + булавка
    function shot(ll) {
        var W = 320, H = 180, z = Math.max(3, Math.min(17, Math.round(map.getZoom())));
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d'); ctx.fillStyle = '#e2e8f0'; ctx.fillRect(0, 0, W, H);
        var c = map.project(ll, z), x0 = c.x - W / 2, y0 = c.y - H / 2, n = Math.pow(2, z), jobs = [];
        function tile(tx, ty) {
            return new Promise(function (res) {
                var im = new Image(); im.crossOrigin = 'anonymous';
                im.onload = function () { ctx.drawImage(im, tx * 256 - x0, ty * 256 - y0); res(); };
                im.onerror = function () { res(); };
                im.src = 'https://tile.openstreetmap.org/' + z + '/' + (((tx % n) + n) % n) + '/' + ty + '.png';
            });
        }
        for (var tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++)
            for (var ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty++) if (ty >= 0 && ty < n) jobs.push(tile(tx, ty));
        var limit = new Promise(function (res) { setTimeout(res, 7000); });
        return Promise.race([Promise.all(jobs), limit]).then(function () {
            ctx.fillStyle = '#ef4444'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(W / 2, H / 2, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            try { return cv.toDataURL('image/jpeg', 0.72); } catch (e) { return ''; }
        });
    }
    function openPane() {
        gcSite.openDrawer(document.getElementById('mainPanel'));
        var t = document.querySelector('.panel-tab[data-tab="bookmarks"]'); if (t) t.click();
        if (window.gcRailMark) window.gcRailMark('bookmarks');
    }
    window.gcBookmarkAdd = function (ll, bb) {
        var b = { id: 'b' + Date.now().toString(36), name: ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5), desc: '', lat: ll.lat, lng: ll.lng, zoom: Math.round(map.getZoom()), img: '', auto: true, ts: Date.now() };
        if (bb) b.bb = bb;
        items.unshift(b); save(); render(); openPane();
        fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&accept-language=ru&lat=' + ll.lat + '&lon=' + ll.lng)
            .then(function (r) { return r.json(); }).then(function (d) {
                if (d && d.display_name && b.auto && items.indexOf(b) >= 0) { b.name = d.display_name.split(', ').slice(0, 2).join(', '); save(); patch(b); }
            }).catch(function () { /* название останется координатами */ });
        shot(ll).then(function (img) { if (items.indexOf(b) < 0) return; b.img = img; save(); patch(b); });
        if (typeof updateStatus === 'function') updateStatus(bb ? '🔖 Экстент сохранён в закладки' : '🔖 Закладка сохранена');
    };
    function dropPin() { if (pin) { map.removeLayer(pin); pin = null; } }
    listEl.addEventListener('input', function (e) {
        var b = byId(e.target); if (!b) return;
        if (e.target.classList.contains('bm-name')) { b.name = e.target.value; b.auto = false; }
        else if (e.target.classList.contains('bm-desc')) b.desc = e.target.value;
        save();
    });
    listEl.addEventListener('click', function (e) {
        var go = e.target.closest('.bm-go'), del = e.target.closest('.bm-del');
        if (!go && !del) return;
        var b = byId(e.target); if (!b) return;
        if (go) {
            var ll = L.latLng(b.lat, b.lng); dropPin();
            if (b.bb) { map.flyToBounds([[b.bb[0], b.bb[1]], [b.bb[2], b.bb[3]]], { duration: .6 }); return; }
            pin = L.marker(ll, { icon: L.divIcon({ html: '<i class="fas fa-bookmark bm-pin"></i>', className: 'custom-marker', iconSize: [22, 26], iconAnchor: [11, 24] }) }).addTo(map);
            pin.bindTooltip(b.name || 'Закладка'); pin.on('click', dropPin);
            map.flyTo(ll, Math.max(b.zoom || 15, 12), { duration: .6 });
        } else {
            items = items.filter(function (x) { return x !== b; }); save(); render(); dropPin();
        }
    });
    var extBtn = document.getElementById('bmAddExtent');
    if (extBtn) extBtn.addEventListener('click', function () {
        var bd = map.getBounds();
        window.gcBookmarkAdd(map.getCenter(), [bd.getSouth(), bd.getWest(), bd.getNorth(), bd.getEast()]);
    });
    load(); render();
})();

/* ===== Левое вертикальное меню: кнопки разделов показывают свои плитки в боковой панели; «Справка» — окно на всю карту ===== */
(function () {
    var rail = document.getElementById('gcRail'), panel = document.getElementById('mainPanel');
    if (!rail || !panel) return;
    var app = document.querySelector('#map-section .app-container'), helpWin = document.getElementById('gcHelpWin');
    var groups = panel.querySelectorAll('.sp-group'), cur = 'main';
    function mark(k) {
        rail.querySelectorAll('.gc-rail-btn').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-rail') === k); });
    }
    function setHelp(on) { if (helpWin) helpWin.hidden = !on; mark(on ? 'help' : cur); }
    window.gcRailMark = mark;
    rail.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.gc-rail-btn');
        if (!b) return;
        var k = b.getAttribute('data-rail');
        if (k === 'help') { setHelp(true); return; }
        setHelp(false);
        if (app && app.classList.contains('passport-open')) { var pc = document.getElementById('ppClose'); if (pc) pc.click(); }
        gcSite.openDrawer(panel);
        var bb = document.getElementById('spBackBtn');
        if (panel.getAttribute('data-view') !== 'home' && bb) bb.click();   // закрыть открытый раздел или маршрут
        if (k === 'bookmarks') { var t = document.querySelector('.panel-tab[data-tab="bookmarks"]'); if (t) t.click(); mark(k); return; }
        cur = k;
        groups.forEach(function (g) { g.classList.toggle('on', g.getAttribute('data-group') === k); });
        mark(k);
    });
    // стрелка «назад» возвращает к плиткам последнего раздела
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#spBackBtn')) mark(cur); });
    var hc = document.getElementById('gcHelpClose');
    if (hc) hc.addEventListener('click', function () { setHelp(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && helpWin && !helpWin.hidden) setHelp(false); });
    // плитки-заглушки
    panel.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.sp-stub') && typeof updateStatus === 'function') updateStatus('ℹ️ Раздел в разработке');
    });
})();


/* ===== Мобильная карта (≤960px): нижняя шторка с тремя положениями и нижнее меню разделов — как в картографических приложениях ===== */
(function () {
    var mq = window.matchMedia('(max-width: 960px)');
    var panel = document.getElementById('mainPanel'), app = document.querySelector('#map-section .app-container');
    var head = panel && panel.querySelector('.sp-head'), rail = document.getElementById('gcRail');
    if (!panel || !app || !head) return;
    var grab = document.createElement('div'); grab.className = 'sp-grab'; grab.innerHTML = '<i></i>'; grab.title = 'Потяните вверх или вниз';
    head.appendChild(grab);
    var st = 'peek', drag = null;
    function dims() {
        var h = Math.max(200, app.clientHeight - (rail && rail.offsetHeight || 58));
        return { peek: Math.min(head.offsetHeight + 2, Math.round(h * 0.45)), half: Math.round(h * 0.5), full: h - 10 };
    }
    function apply(s) { st = s; if (!mq.matches) return; app.setAttribute('data-sheet', s); app.style.setProperty('--sh', dims()[s] + 'px'); }
    window.gcSheet = function (x) { apply(x); };   // положение шторки из других скриптов (mobile.js)
    function sync() { if (mq.matches) apply(st); else { app.removeAttribute('data-sheet'); app.style.removeProperty('--sh'); } }
    if (mq.addEventListener) mq.addEventListener('change', sync); else mq.addListener(sync);
    window.addEventListener('resize', function () { if (mq.matches && !drag) apply(st); });
    window.addEventListener('load', sync);
    if (window.ResizeObserver) new ResizeObserver(function () { if (mq.matches && st === 'peek' && !drag) apply('peek'); }).observe(head);

    function end() {
        if (!drag) return;
        var d = dims(), cur = panel.offsetHeight, moved = drag.moved;
        drag = null; panel.classList.remove('dragging');
        if (!moved) { apply(st === 'peek' ? 'half' : st === 'half' ? 'full' : 'peek'); return; }
        var best = 'peek', bd = 1e9;
        ['peek', 'half', 'full'].forEach(function (k) { var x = Math.abs(d[k] - cur); if (x < bd) { bd = x; best = k; } });
        apply(best);
    }
    grab.addEventListener('pointerdown', function (e) {
        if (!mq.matches) return;
        drag = { y: e.clientY, h: panel.offsetHeight, moved: false };
        panel.classList.add('dragging');
        try { grab.setPointerCapture(e.pointerId); } catch (x) { /* не критично */ }
    });
    grab.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dy = drag.y - e.clientY, d = dims();
        if (Math.abs(dy) > 4) drag.moved = true;
        app.style.setProperty('--sh', Math.max(d.peek, Math.min(d.full, drag.h + dy)) + 'px');
    });
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);

    // авто-положения: поиск и маршрут — на всю высоту; открыт раздел — половина; указание точки и рисование — карта открывается
    document.addEventListener('focusin', function (e) { if (mq.matches && e.target.closest && e.target.closest('#searchInput, .rt-in')) apply('full'); });
    new MutationObserver(function () { if (mq.matches && panel.getAttribute('data-view') !== 'home' && st === 'peek') apply('half'); }).observe(panel, { attributes: true, attributeFilter: ['data-view'] });
    var gs = document.getElementById('geoSection');
    if (gs) new MutationObserver(function () { if (mq.matches && st === 'full' && gs.classList.contains('geo-on')) apply('peek'); }).observe(gs, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', function (e) {
        if (!mq.matches || !e.target.closest) return;
        var t = e.target;
        if (t.closest('#searchResults') || t.closest('.rt-pick')) setTimeout(function () { apply('peek'); }, 0);
        else if (t.closest('[data-sk-tool], [data-lg-tool], .draw-tool-btn, .an-draw .map-btn')) { if (st === 'full') apply('half'); }
        else if (t.closest('.map-controls-right .map-btn')) { if (st !== 'peek') apply('peek'); }
        else if (t.closest('#gcRail .gc-rail-btn:not([data-rail="help"])')) { if (st === 'peek') apply('half'); }
    });
    setTimeout(sync, 0);
})();

/* Анимированные подсказки по инструментам: вместо картинки под кнопками каждой вкладки боковой панели.
   Карточки сменяются сами (полоска-таймер сверху), стрелки и счётчик — вручную; пауза при наведении.
   Кнопка запуска: data-bp — открывает раздел (общий обработчик плиток выше), data-gt-tab — открывает вкладку панели. */
(function () {
    var TIPS = [
        { ic: 'fa-chart-pie', c: '#10b981', t: 'Анализ участка', d: 'Паспорт участка по одному контуру: рельеф, почва, климат, логистика и индекс пригодности.', h: 'Загрузите контур (KML, GeoJSON, Excel, XML Росреестра) или нарисуйте участок и запустите анализ.', tab: 'analysis', m: 'Главный инструмент сайта: один контур превращается в подробный отчёт — «паспорт участка» с графиками, расшифровкой каждого блока и итоговыми выводами. Готовые отчёты хранятся во вкладке «Мои отчёты».', f: ['Рельеф: уклоны, перепад высот, гипсометрия', 'Почва (SoilGrids) и климат за 10 лет, ГТК, безморозный период', 'Логистика, форма участка и индекс пригодности 0–100'], hot: true },
        { ic: 'fa-file-lines', c: '#f97316', t: 'Мои отчёты', d: 'Готовые паспорта участков хранятся в одном месте, к ним можно вернуться в любой момент.', h: 'Нажмите на отчёт — паспорт участка раскроется во всю карту.', tab: 'reports', m: 'Каждый выполненный анализ — отдельный отчёт. Откройте его, и паспорт участка раскроется с графиками и выводами; у каждого блока есть кнопка «Расшифровка», которая объясняет показатели простыми словами.', f: ['Паспорт раскрывается во всю карту', 'У блоков есть «Расшифровка» показателей', 'Все отчёты по вашим участкам в одном списке'] },
        { ic: 'fa-pen-ruler', c: '#3b82f6', t: 'Рисование', d: 'Фигуры, линии, значки и текст прямо на карте. Готовую фигуру можно править и экспортировать.', h: 'Выберите инструмент — рядом появятся его параметры.', bp: 'draw', m: 'Универсальный чертёж поверх карты: отметьте границы полей, подпишите объекты, поставьте значки. Нарисованные фигуры можно выбирать, двигать, править вершины и сохранять в файл.', f: ['Полигоны, прямоугольники, круги, линии, значки, текст', 'Выбор кликом, правка вершин, перемещение', 'Импорт и экспорт контуров (KML, GeoJSON)'] },
        { ic: 'fa-mountain', c: '#14b8a6', t: 'Профиль рельефа', d: 'График высот по линии и гипсометрия по площади: перепад, длина, уклоны (данные Terrarium DEM).', h: 'Проведите линию или обведите полигон. Двойной клик по последней точке — завершить.', bp: 'profile', m: 'Показывает, как меняется высота вдоль линии или по всей площади участка. Помогает оценить эрозионные риски, стока воды и пригодность склонов для техники.', f: ['Профиль по линии: длина, перепад, уклоны', 'Гипсометрия по площади участка', 'Высоты из тайлов Terrarium DEM'] },
        { ic: 'fa-route', c: '#ef4444', t: 'Логистика', d: 'Буфер вокруг точки или участка, дороги и водоёмы OpenStreetMap и расстояния до ближайших.', h: 'Нарисуйте точку или участок и задайте размер буфера.', bp: 'logistics', m: 'Оценка окружения: насколько участок удобен для подъезда и водоснабжения. Считает, что попадает в заданный буфер, и показывает расстояния до ближайших объектов.', f: ['Буфер вокруг точки или участка', 'Дороги и водоёмы OpenStreetMap в буфере', 'Расстояния до ближайших объектов'] },
        { ic: 'fa-flask', c: '#a855f7', t: 'Почвенный анализ', d: 'pH, углерод, азот, глина, песок и другие показатели по фигуре, зоны на карте (SoilGrids, 250 м).', h: 'Нарисуйте фигуру, выберите показатель и глубину, нажмите «Рассчитать по фигуре».', bp: 'chem', m: 'Значения почвенных свойств внутри вашей фигуры по данным мировой карты SoilGrids. Участок можно разбить на зоны по значению показателя — основа для дифференцированного внесения.', f: ['8 показателей: pH, углерод, азот, глина, песок, ил, CEC, плотность', 'Шесть слоёв глубины от 0–5 до 100–200 см', 'Зоны внутри фигуры и слой значений на карте'] },
        { ic: 'fa-calendar-days', c: '#ec4899', t: 'Снимки Sentinel-2', d: 'Снимки 10 м по датам: естественные цвета и CIR, календарь, превью с облачностью, скачивание GeoTIFF.', h: 'Выберите дату в календаре, при необходимости обведите нужную область.', bp: 'dates', m: 'Свежие спутниковые снимки Sentinel-2 с разрешением 10 м. Выбирайте безоблачную дату, переключайте режимы отображения и сохраняйте область в GeoTIFF для работы в ГИС.', f: ['Естественные цвета и ложные (CIR)', 'Календарь дат с процентом облачности', 'Скачивание GeoTIFF выбранной области'] },
        { ic: 'fa-leaf', c: '#22c55e', t: 'NDVI — растительность', d: 'Густота и состояние растительности: от воды и голой почвы до густых посевов, статистика и зоны.', h: 'Выберите дату и обведите поле.', bp: 'ndvi', m: 'Главный индекс состояния посевов: чем выше значение, тем гуще и здоровее растительность. Помогает находить проблемные места на поле и планировать обследование.', f: ['Карта индекса и статистика по фигуре', 'Зоны внутри поля — равные по площади или по интервалам', 'Сравнение разных дат'] },
        { ic: 'fa-code-compare', c: '#6366f1', t: 'Сравнение снимков', d: 'Два снимка Sentinel-2 на разные даты рядом: карта делится пополам, под каждым — дата и статистика индекса.', h: 'Нарисуйте или импортируйте фигуру — сравнение запустится автоматически.', bp: 'change', m: 'Сравнивайте состояние участка на две даты: до и после события, в разные фазы вегетации или в соседние сезоны. Карта делится на две половины, внизу у каждой — календарь выбора даты и показатели индекса, а сверху — сводка изменения среднего значения.', f: ['Естественные и ложные цвета, NDVI, NDMI, NBR', 'Область — рисование или импорт фигуры (KML, GeoJSON, Excel, XML Росреестра)', 'Статистика и гистограмма под каждым снимком'] },
        { ic: 'fa-seedling', c: '#0284c7', t: 'NDMI — влажность растений', d: 'Содержание влаги в растениях: помогает заметить засуху и водный стресс.', h: 'Выберите дату и сравните поля между собой.', bp: 'ndmi', m: 'Индекс влажности растительного покрова. Падение значений раньше глаза показывает, что растения начали страдать от нехватки воды.', f: ['Водный стресс растений', 'Раннее выявление засухи', 'Календарь, область и скачивание GeoTIFF'] },
        { ic: 'fa-wheat-awn', c: '#f59e0b', t: 'NBR — состояние покрова', d: 'Сухая биомасса и угнетение растений; сравнение дат показывает динамику состояния участка.', h: 'Сравните снимки на разные даты.', bp: 'nbr', m: 'Индекс по ближнему и коротковолновому ИК (SWIR2): чувствителен к сухой биомассе, влажности покрова и голой почве. Сравнение снимков на разные даты показывает, как меняется состояние покрова за сезон — до и после уборки, засухи или обработки.', f: ['Сухая биомасса и угнетённые посевы', 'Динамика покрова за сезон (сравнение двух дат)', 'Календарь, область и скачивание GeoTIFF'] },
        { ic: 'fa-cloud-sun-rain', c: '#0ea5e9', t: 'Прогноз погоды', d: 'Погода сейчас и на 7 дней по вашему участку: температура, осадки, ветер, дни с заморозком.', h: 'Нарисуйте участок или загрузите контур — расчёт идёт по фигуре.', bp: 'weather', m: 'Погода по вашему участку, а не по городу: расчёт идёт по точкам внутри нарисованной фигуры. Видно, что происходит сейчас и чего ждать всю неделю.', f: ['Сейчас: температура, влажность, облачность, ветер, осадки', 'Прогноз на 7 дней с вероятностью осадков', 'Сумма T > 5 °C и дни с заморозком'] },
        { ic: 'fa-chart-line', c: '#6366f1', t: 'Климат участка', d: 'Климатограмма за 10 лет: температура и осадки по месяцам, ГТК Селянинова.', h: 'Нарисуйте участок — данные ERA5 загрузятся для его центра.', bp: 'climate', m: 'Типичный климат участка за последние 10 лет по реанализу ERA5. Нужен для подбора культур и сортов и оценки климатических рисков.', f: ['Температура и осадки по месяцам', 'Климатограмма и самый влажный месяц', 'ГТК Селянинова — оценка увлажнения'] },
        { ic: 'fa-sun-plant-wilt', c: '#22c55e', t: 'Тепло и вегетация', d: 'Суммы температур выше 5 и 10 °C, период вегетации и культуры, которым хватит тепла.', h: 'Нарисуйте участок и откройте раздел.', bp: 'gdd', m: 'Сколько тепла получает участок за год и хватит ли его выбранной культуре. Даты вегетации помогают планировать сроки сева и уборки.', f: ['Суммы температур выше 5 и 10 °C за год', 'Даты начала и конца вегетации', 'Кривая накопления тепла и подходящие культуры'] },
        { ic: 'fa-snowflake', c: '#06b6d4', t: 'Заморозки', d: 'Безморозный период, даты последнего и первого заморозка и риск по датам для сева и уборки.', h: 'Нарисуйте участок и откройте раздел.', bp: 'frost', m: 'Заморозки — главный риск для всходов и цветения. Раздел показывает, когда они обычно заканчиваются весной и начинаются осенью, и насколько это рискованно.', f: ['Безморозный период в днях', 'Средние даты последнего и первого заморозка', 'Вероятность заморозка по датам'] },
        { ic: 'fa-wind', c: '#64748b', t: 'Ветер и окна работ', d: 'Роза ветров, стрелки ветра на участке и таблица: когда опрыскивать и работать в поле.', h: 'Нарисуйте участок — стрелки появятся на карте.', bp: 'windwork', m: 'Ветер определяет, когда можно опрыскивать и где ставить лесополосы. На карте стрелки показывают текущий ветер на участке, а таблица — удачные дни недели.', f: ['Роза ветров за 10 лет', 'Анимированные стрелки ветра на участке', 'Окна для опрыскивания и полевых работ на 7 дней'] },
        { ic: 'fa-cube', c: '#6366f1', t: 'Режим 3D', d: 'Объёмный вид территории: рельеф, 3D-здания OSM, деревья и импорт моделей.', h: 'Включите 3D и наклоните карту. Вернуться — кнопка «2D».', bp: '3d', m: 'Посмотрите на территорию объёмно: рельеф с высотами, здания, деревья. Удобно для презентации участка и оценки склонов на глаз.', f: ['Рельеф и 3D-здания OSM', 'Деревья и импорт моделей', 'Возврат к плоской карте кнопкой «2D»'] },
        { ic: 'fa-file-export', c: '#8b5cf6', t: 'Экспорт карты', d: 'Сохранение текущего вида: PDF (GeoPDF), PNG, JPEG, WebP и GeoTIFF с пространственной привязкой.', h: 'Настройте вид и формат, затем сохраните файл.', bp: 'export', m: 'Сохраните карту так, как вы её видите: для печати, отчёта или работы в ГИС. GeoTIFF и GeoPDF сохраняют пространственную привязку.', f: ['PDF (GeoPDF), PNG, JPEG, WebP', 'GeoTIFF с пространственной привязкой', 'Сохраняется текущий вид карты'] },
        { ic: 'fa-magnifying-glass', c: '#0ea5e9', t: 'Поиск и «Что здесь?»', d: 'Поиск адресов и координат, карточка выбранной точки: адрес, координаты, копирование.', h: 'Введите адрес в поиске панели или нажмите правой кнопкой по карте → «Что здесь?».', m: 'Найдите место по названию или координатам либо просто укажите точку на карте — карточка покажет адрес и координаты, которые можно скопировать.', f: ['Поиск по адресу и координатам', 'Правый клик → «Что здесь?»', 'Копирование координат в буфер'] },
        { ic: 'fa-diamond-turn-right', c: '#2563eb', t: 'Маршрут', d: 'Маршрут между точками с промежуточными остановками и пошаговым описанием.', h: 'Правый клик по карте → «Маршрут отсюда» / «Маршрут сюда» или кнопка маршрута рядом с поиском.', m: 'Постройте путь на машине и другими способами; где дорог нет, маршрут достраивается прямой пунктирной линией. Расчёт выполняет OSRM.', f: ['Откуда, куда и промежуточные точки', 'Варианты и пошаговый маршрут', 'Достройка пунктиром там, где нет дорог'] },
        { ic: 'fa-layer-group', c: '#10b981', t: 'Подложки и слои', d: 'Базовые карты, спутниковые снимки и аналитические подложки меняют основу карты.', h: 'Кнопки справа на карте: «Базовые карты», «Спутник», «Аналитика».', m: 'Выберите подходящую основу: схема, реальные снимки или готовые аналитические слои. Легенда включённого слоя появляется на панели.', f: ['Базовые карты и спутник', 'Аналитические подложки с легендой', 'Свои слои подключаются в разделе «Свои слои»'] },
        { ic: 'fa-plug', c: '#f59e0b', t: 'Свои слои', d: 'Подключение WMS, WFS, WMTS/XYZ, ArcGIS и GeoJSON по ссылке.', h: 'Откройте раздел, выберите тип сервиса и вставьте адрес.', bp: 'userlayers', m: 'Добавьте внешние данные на карту: сервисы хранятся в браузере, плитки кэшируются локальным прокси.', f: ['WMS, WFS, WMTS/XYZ, ArcGIS, GeoJSON и KML', 'Список сервисов сохраняется в браузере', 'Включение и скрытие каждого слоя'] },
        { ic: 'fa-left-right', c: '#6366f1', t: 'Шторка и дублирование', d: 'Сравнение двух подложек на одной карте; у каждой половины свой переключатель 3D.', h: 'Кнопка «Шторка» среди виджетов справа на карте.', m: 'Разделите карту на две части с разными подложками и двигайте разделитель: удобно сравнивать снимки разных дат или 3D и плоскую карту.', f: ['Две подложки на одной карте', 'Подвижный разделитель', '3D можно включить на каждой половине отдельно'] },
        { ic: 'fa-border-all', c: '#1d4ed8', t: 'Сетка координат', d: 'Координатная сетка на карте: формат, шаг, цвет и подписи.', h: 'Кнопка «Сетка координат» справа на карте — настройки откроются в панели.', m: 'Сетка помогает ориентироваться и читать координаты. Формат — градусы или град-мин-сек, шаг подбирается под масштаб.', f: ['Градусы или град-мин-сек', 'Шаг, цвет и прозрачность', 'Подписи включаются отдельно'] },
        { ic: 'fa-ruler-combined', c: '#0ea5e9', t: 'Измерения на карте', d: 'Расстояние и площадь по клику прямо на карте.', h: 'Кнопки «Длина» и «Площадь» вверху слева рядом с «Рисованием».', m: 'Нажмите «Длина» или «Площадь» — инструмент включается сразу, остаётся кликать по карте: результат виден сразу. Кнопка «Очистить» убирает замер.', f: ['Расстояние по ломаной линии', 'Площадь и периметр фигуры', 'Быстрая очистка замера'] },
        { ic: 'fa-eraser', c: '#64748b', t: 'Очистить карту', d: 'Одной кнопкой убирает с карты всё лишнее.', h: 'Кнопка-ластик вверху слева на карте.', m: 'Удаляет рисунки, замеры, маршрут и результаты анализов, чтобы начать работу с чистой карты.', f: ['Рисунки и замеры', 'Маршрут и точки', 'Результаты анализов'] },
        { ic: 'fa-file-import', c: '#14b8a6', t: 'Импорт и экспорт контуров', d: 'Загрузка и выгрузка фигур во всех блоках с рисованием.', h: 'Ищите кнопки импорта и экспорта рядом с инструментами рисования.', m: 'Один и тот же механизм работает в рисовании, анализе, NDVI, логистике и других блоках: загрузите контур из файла или сохраните нарисованное.', f: ['KML, GeoJSON и другие форматы', 'Единые кнопки во всех блоках', 'Выгрузка нарисованного в файл'] },
        { ic: 'fa-database', c: '#0f766e', t: 'Каталог геоданных', d: 'Наборы данных, которые можно подключить к карте.', h: 'Выберите набор и включите слой.', tab: 'catalog', m: 'Каталог готовых наборов геоданных, которые можно подключить к карте, чтобы не искать их по разным сайтам.', f: ['Готовые наборы геоданных', 'Подключение слоя к карте'] },
        { ic: 'fa-bookmark', c: '#e11d48', t: 'Закладки', d: 'Важные места со скриншотом, названием и описанием — возвращайтесь к ним в один клик.', h: 'Откройте вкладку и добавьте закладку на нужной точке карты.', tab: 'bookmarks', m: 'Запомните важные места на карте и возвращайтесь к ним в один клик. Каждая закладка хранит снимок вида, название и ваши заметки.', f: ['Скриншот карты, название и описание', 'Координаты точки', 'Кнопка «На карте» возвращает к месту'] },
        { ic: 'fa-shapes', c: '#0d9488', t: 'Границы, форма и кадастр', d: 'Размеры, компактность и координаты участка по его контуру; для кадастровых участков — ещё и данные из НСПД.', h: 'Правый клик по кадастровому участку → «Перенести границы в» → «Границы, форма и кадастр».', bp: 'shape', m: 'Раздел определяет форму контура и показывает, многоконтурный участок или нет (число отдельных контуров). Сведения кадастра подписаны по-русски.', f: ['Площадь, периметр, габариты', 'Многоконтурный участок или нет', 'Сведения НСПД с русскими названиями полей'] },
        { ic: 'fa-map-location-dot', c: '#6366f1', t: 'Кадастр НСПД', d: 'Кварталы, земельные участки и здания в родных цветах НСПД, поиск по кадастровому номеру.', h: 'Включите слой кнопкой «Слои» справа на карте или поищите номер вида 77:05:0001005:19.', bp: 'cadastre', m: 'Клик по объекту выделяет его и показывает сведения. Ctrl+клик выбирает несколько объектов. Границы — для ознакомления, они не заменяют выписку ЕГРН.', f: ['Три слоя: кварталы, участки, здания', 'Выбор нескольких объектов', 'Скачивание в KML, GeoJSON, SHP, DXF'] },
        { ic: 'fa-bars', c: '#10b981', t: 'Меню по правой кнопке', d: 'Быстрые действия с точкой и участком прямо на карте.', h: 'Щёлкните правой кнопкой по карте; на кадастровом участке появятся дополнительные пункты.', m: 'Группы пунктов раскрываются вбок: «Перенести границы в» отправляет контур в нужный раздел анализа, «Скачать границы» выгружает его в файл.', f: ['«Что здесь?», маршрут, закладка', 'Перенос границ в разделы анализа', 'Скачивание участка в KML, GeoJSON, SHP, DXF'] },
        { ic: 'fa-layer-group', c: '#0891b2', t: 'Кнопка «Слои» на карте', d: 'Быстрое включение кадастровых слоёв и вход в «Свои слои» — под кнопками подложек.', h: 'Нажмите кнопку «Слои» справа на карте и выберите слой.', m: 'При включении слоя автоматически открывается его панель в боковом меню: можно сразу искать объекты и смотреть легенду.', f: ['Кварталы, участки, здания', 'Свои слои: WMS, WFS, XYZ, GeoJSON', 'Панель слоя открывается сама'] },
        { ic: 'fa-tractor', c: '#f59e0b', t: 'Агрокалькулятор', d: 'Семена, удобрения, средства защиты, топливо и машинное время по площади участка.', h: 'Нарисуйте участок или введите площадь вручную, затем задайте нормы.', bp: 'agro', m: 'Площадь берётся с нарисованной фигуры или вводится вручную; итоги можно сверить по каждой статье затрат.', f: ['Площадь с карты или вручную', 'Нормы по культурам и препаратам', 'Топливо и машинное время'] },
        { ic: 'fa-circle-question', c: '#0ea5e9', t: 'О карте', d: 'Описание возможностей карты и инструкции по работе с её блоками.', h: 'Откройте справку, если не знаете, с чего начать.', tab: 'help', m: 'Справка по возможностям карты и инструкции по работе с каждым блоком — подойдёт, если вы только начинаете.', f: ['Описание возможностей карты', 'Инструкции по работе с блоками'] }
    ];
    var DUR = 14, DUR_HOT = 22;   // секунд на карточку (на «Анализе участка» дольше)
    function build(el, start) {
        var i = start, dir = 1, busy = false;
        el.className = 'tab-art gc-tips'; el.removeAttribute('data-art');
        el.innerHTML = '<div class="gt-card"><span class="gt-blob"></span><i class="fas gt-wm"></i>' +
            '<div class="gt-bar"><i></i></div><div class="gt-slide"></div>' +
            '<div class="gt-nav"><button type="button" class="gt-ar" data-gt="-1" aria-label="Назад"><i class="fas fa-chevron-left"></i></button>' +
            '<span class="gt-cnt"></span><button type="button" class="gt-ar" data-gt="1" aria-label="Дальше"><i class="fas fa-chevron-right"></i></button></div></div>';
        var card = el.querySelector('.gt-card'), slide = el.querySelector('.gt-slide'), bar = el.querySelector('.gt-bar i'), cnt = el.querySelector('.gt-cnt'), wm = el.querySelector('.gt-wm');
        function show() {
            var t = TIPS[i];
            card.style.setProperty('--c', t.c);
            wm.className = 'fas gt-wm ' + t.ic;
            slide.className = 'gt-slide ' + (dir > 0 ? 'gt-r' : 'gt-l');
            card.classList.toggle('gt-hot', !!t.hot);
            slide.innerHTML = '<div class="gt-hd"><div class="gt-ic"><i class="fas ' + t.ic + '"></i></div><div class="gt-t">' + t.t + '</div></div><div class="gt-d">' + t.d + '</div>' +
                '<div class="gt-m">' + t.m + '</div><ul class="gt-f">' + t.f.map(function (x) { return '<li><i class="fas fa-check"></i>' + x + '</li>'; }).join('') + '</ul>' +
                '<div class="gt-h"><i class="fas fa-lightbulb"></i><span>' + t.h + '</span></div>' +
                ((t.bp || t.tab) ? '<button type="button" class="gt-go"' + (t.bp ? ' data-bp="' + t.bp + '"' : ' data-gt-tab="' + t.tab + '"') + '><i class="fas fa-play"></i><span>Открыть: ' + t.t + '</span></button>' : '');
            cnt.textContent = (i + 1) + ' / ' + TIPS.length;
            bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = 'gtbar ' + (t.hot ? DUR_HOT : DUR) + 's linear forwards';
            busy = false;
        }
        function go(d) {
            if (busy) return; busy = true; dir = d;
            slide.className = 'gt-slide ' + (d > 0 ? 'gt-outl' : 'gt-outr');
            setTimeout(function () { i = (i + d + TIPS.length) % TIPS.length; show(); }, 220);
        }
        bar.addEventListener('animationend', function () { go(1); });
        el.addEventListener('click', function (e) {
            var a = e.target.closest('[data-gt]'), g = e.target.closest('[data-gt-tab]');
            if (a) go(+a.getAttribute('data-gt'));
            else if (g) { var tb = document.querySelector('.panel-tab[data-tab="' + g.getAttribute('data-gt-tab') + '"]'); if (tb) tb.click(); }
        });
        card.addEventListener('pointerenter', function () { card.classList.add('paused'); });
        card.addEventListener('pointerleave', function () { card.classList.remove('paused'); });
        card.addEventListener('focusin', function () { card.classList.add('paused'); });
        card.addEventListener('focusout', function () { card.classList.remove('paused'); });
        show();
    }
    var arts = document.querySelectorAll('.tab-art');
    Array.prototype.forEach.call(arts, function (el, k) { build(el, k === 0 ? 0 : (k * 5 + Math.floor(Math.random() * TIPS.length)) % TIPS.length); });   // на главной начинаем с анализа участка
    // на месте слайдов подсказок — данные выписки (XML) либо легенда включённого слоя; иначе показываются слайды
    function refreshSlot() {
        var xml = window.gcXmlInfo, keys = window.gcLegKeys || [], html = '';
        if (xml) html = '<div class="gls-hd"><b>Данные участка</b><button type="button" class="gls-x" data-gls-x title="Скрыть">×</button></div>' + xml;
        else if (keys.length && typeof renderLayerLegendBlock === 'function') html = '<div class="gls-hd"><b>Легенда слоя</b></div>' + keys.map(renderLayerLegendBlock).join('');
        Array.prototype.forEach.call(document.querySelectorAll('.tab-art.gc-tips'), function (el) {
            var s = el.nextElementSibling;
            if (!s || !s.classList.contains('gc-leg-slot')) {
                s = document.createElement('div'); s.className = 'gc-leg-slot'; el.parentNode.insertBefore(s, el.nextSibling);
                s.addEventListener('click', function (e) { if (e.target.closest('[data-gls-x]')) { window.gcXmlInfo = null; refreshSlot(); } });
            }
            s.style.display = html ? '' : 'none'; el.style.display = html ? 'none' : '';
            if (html) s.innerHTML = html;
        });
    }
    window.gcTipsRefresh = refreshSlot; refreshSlot();
})();

/* «Свои слои»: подключение пользовательских WMS / WFS / WMTS(XYZ) / ArcGIS / GeoJSON в боковой панели; список хранится в localStorage. */
(function () {
    'use strict';
    var KEY = 'gc_user_layers', pane = document.querySelector('[data-bp-pane="userlayers"]');
    if (!pane || typeof map === 'undefined') return;
    var $ = gcSite.$, esc = gcSite.esc;
    var TYPES = { xyz: 'XYZ / TMS / WMTS ({z}/{x}/{y})', wms: 'WMS', wfs: 'WFS', arcgis: 'ArcGIS MapServer (плитки)', arcfeat: 'ArcGIS FeatureServer', geojson: 'GeoJSON / KML по ссылке' };
    var HINT = { xyz: 'Пример: https://tile.example.com/{z}/{x}/{y}.png', wms: 'Адрес сервиса без параметров; в поле «Слои» — имя слоя из GetCapabilities.', wfs: 'Адрес WFS и typeName. Сервер должен отдавать JSON и разрешать CORS.', arcgis: 'Адрес …/MapServer или …/MapServer/0 (растровый показ слоя).', arcfeat: 'Адрес слоя …/FeatureServer/0', geojson: 'Прямая ссылка на .geojson / .json / .kml.' };
    var items = [], live = {};
    try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(items)) items = []; } catch (e) { items = []; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { say('⚠️ Не удалось сохранить слои в браузере', true); } }
    function say(m, w) { if (typeof updateStatus === 'function') updateStatus(m, w); }

    var st = document.createElement('style');
    st.textContent = '.bp-ul .ul-in{flex:1;min-width:0;height:28px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;font:inherit;font-size:12px;box-sizing:border-box;background:#fff}' +
        '.bp-ul .dw-row select{flex:1;min-width:0}.bp-ul .dw-row input[type=color]{width:42px;height:28px;border:1px solid #cbd5e1;border-radius:8px;padding:2px;background:#fff}' +
        '.ul-it{padding:8px 0;border-bottom:1px solid #edf1f5}.ul-it:last-child{border-bottom:0}.ul-top{display:flex;gap:8px;align-items:center}.ul-top input[type=checkbox]{accent-color:#0d9488}' +
        '.ul-leg{margin-top:6px;font-size:11px;max-height:200px;overflow:auto;color:#334155}.ul-le{display:flex;gap:6px;align-items:center;margin:2px 0}.ul-le img{max-width:100%}.ul-sw{width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.25);flex:none}.ul-tb{width:100%}.ul-tb td{padding:2px 8px 2px 0;vertical-align:top;word-break:break-word}.ul-grip{cursor:grab;color:#94a3b8;font-size:12px;padding:0 2px}.ul-it.ul-drag{opacity:.4}.ul-it.ul-over{box-shadow:0 -2px 0 #0d9488}.ul-mv{border:0;background:none;color:#94a3b8;cursor:pointer;font-size:11px;padding:0 2px}.ul-mv:hover{color:#0d9488}.ul-top .ul-in{height:26px}.ul-top small{font-size:10px;font-weight:700;color:#94a3b8}.ul-del{border:0;background:none;color:#94a3b8;cursor:pointer;font-size:17px;padding:0 4px}.ul-del:hover{color:#ef4444}' +
        '.ul-sub{display:flex;gap:8px;align-items:center;margin-top:5px;font-size:11px;color:#64748b}.ul-sub input[type=range]{flex:1;accent-color:#0d9488}.ul-empty{font-size:12px;color:#94a3b8}';
    document.head.appendChild(st);

    function vecLayer(it, loader) {
        var tm, g = L.geoJSON(null, {
            style: function () { return { color: it.color || '#0d9488', weight: 2, fillOpacity: 0.2 * it.opacity, opacity: it.opacity }; },
            pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 5, color: it.color || '#0d9488', weight: 1, fillOpacity: 0.7 * it.opacity, opacity: it.opacity }); },
            onEachFeature: function (f, l) {
                l.on('click', function (e) { if (!ppOn) return; L.DomEvent.stop(e); selectVec(g, l, f, it); });
            }
        });
        g._gcMove = function () { clearTimeout(tm); tm = setTimeout(function () { loader(g); }, 500); };
        g.on('add', function () { if (it.type !== 'geojson') map.on('moveend', g._gcMove); loader(g); });
        g.on('remove', function () { map.off('moveend', g._gcMove); });
        return g;
    }
    var idbp = null, proxyOk = false;
    function idb() { return idbp || (idbp = new Promise(function (res, rej) { try { var r = indexedDB.open('gc_ul_cache', 1); r.onupgradeneeded = function () { r.result.createObjectStore('c'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; } catch (e) { rej(e); } })); }
    function idbGet(k) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction('c').objectStore('c').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
    function idbSet(k, v) { idb().then(function (db) { db.transaction('c', 'readwrite').objectStore('c').put(v, k); }).catch(function () { }); }
    function idbClear(id) { idb().then(function (db) { var s = db.transaction('c', 'readwrite').objectStore('c'); if (id) s.delete(IDBKeyRange.bound(id + '|', id + '|\uffff')); else s.clear(); }).catch(function () { }); }
    function probe() { return fetch('/s3/ping').then(function (r) { proxyOk = r.headers.get('X-GeoClass-Proxy') === '1'; }).catch(function () { }); }   // локальный сервер кэширует плитки на диске
    function px(l) { var f = l.getTileUrl; l.getTileUrl = function (c) { var x = f.call(this, c); return proxyOk ? '/ucache?u=' + encodeURIComponent(x) : x; }; return l; }
    function jfetch(url, g, kml, key) {
        var got = false, shown = false;
        if (key) idbGet(key).then(function (d) { if (d && !got) { shown = true; g.clearLayers(); g.addData(d); applyOrder(); say('⚡ Слой показан из кэша, обновляю…'); } });
        return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return kml ? r.text() : r.json(); }).then(function (d) {
            got = true;
            if (kml) d = toGeoJSON.kml(new DOMParser().parseFromString(d, 'text/xml'));
            g.clearLayers(); g.addData(d); applyOrder(); if (key) idbSet(key, d); say('✅ Слой загружен');
        }).catch(function (e) {
            if (shown) say('⚠️ Нет связи с сервером — показаны сохранённые данные', true);
            else say('⚠️ Слой недоступен (' + e.message + '). Возможно, сервер не разрешает CORS', true);
        });
    }
    function bbox() {                                                                 // область привязана к сетке 0.05°: меньше перезапросов и больше попаданий в кэш
        var b = map.getBounds(), q = 0.05;
        return [Math.floor(b.getWest() / q) * q, Math.floor(b.getSouth() / q) * q, Math.ceil(b.getEast() / q) * q, Math.ceil(b.getNorth() / q) * q].map(function (n) { return n.toFixed(4); }).join(',');
    }
    function build(it) {
        var o = { opacity: it.opacity, zIndex: 460, maxZoom: 22 }, u = it.url.trim(), base = u.split('?')[0];
        if (it.type === 'xyz') return px(L.tileLayer(u, o));
        if (it.type === 'wms') return px(L.tileLayer.wms(base, Object.assign(o, { layers: it.layers, format: 'image/png', transparent: true, version: '1.3.0' })));
        if (it.type === 'arcgis') {                                                   // динамический экспорт: работает и с некэшированными сервисами, и с адресом слоя …/MapServer/0
            var m = base.match(/^(.*\/MapServer)(?:\/(\d+))?\/*$/i);
            if (!m) throw new Error('адрес должен заканчиваться на /MapServer или /MapServer/N');
            var AG = L.TileLayer.extend({
                getTileUrl: function (c) {
                    var b = this._tileCoordsToBounds(c), p1 = L.CRS.EPSG3857.project(b.getSouthWest()), p2 = L.CRS.EPSG3857.project(b.getNorthEast());
                    return m[1] + '/export?bbox=' + [p1.x, p1.y, p2.x, p2.y].join(',') + '&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image' + (m[2] != null ? '&layers=show:' + m[2] : '');
                }
            });
            return px(new AG('', o));
        }
        if (it.type === 'geojson') return vecLayer(it, function (g) { jfetch(u, g, /\.kml(\?|$)/i.test(u), it.id + '|all'); });
        if (it.type === 'wfs') return vecLayer(it, function (g) {
            jfetch(base + '?service=WFS&version=1.1.0&request=GetFeature&typeName=' + encodeURIComponent(it.layers) + '&outputFormat=application%2Fjson&srsName=EPSG:4326&maxFeatures=3000&bbox=' + bbox() + ',EPSG:4326', g, false, it.id + '|' + bbox());
        });
        return vecLayer(it, function (g) {
            jfetch(base.replace(/\/+$/, '') + '/query?where=1%3D1&outFields=*&f=geojson&inSR=4326&outSR=4326&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&geometry=' + bbox(), g, false, it.id + '|' + bbox());
        });
    }
    // ---------- служебное: JSONP (ArcGIS отвечает без CORS), легенда, всплывающие окна ----------
    function jsonp(url) {
        return new Promise(function (res, rej) {
            var cb = 'gcjp' + Date.now() + Math.floor(Math.random() * 1e4), sc = document.createElement('script'), to = setTimeout(function () { cl(); rej(new Error('timeout')); }, 15000);
            function cl() { clearTimeout(to); delete window[cb]; sc.remove(); }
            window[cb] = function (d) { cl(); res(d); };
            sc.onerror = function () { cl(); rej(new Error('load')); };
            sc.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'f=json&callback=' + cb; document.head.appendChild(sc);
        });
    }
    function ag(it) { var m = it.url.split('?')[0].match(/^(.*\/MapServer)(?:\/(\d+))?\/*$/i); return m ? { root: m[1], layer: m[2] != null ? m[2] : null } : null; }
    function tbl(p) {
        var k = Object.keys(p || {}).filter(function (x) { return !/^shape/i.test(x) && p[x] != null && p[x] !== 'Null'; }).slice(0, 50);
        return k.length ? '<table class="ul-tb">' + k.map(function (x) { return '<tr><td><b>' + esc(x) + '</b></td><td>' + esc(p[x]) + '</td></tr>'; }).join('') + '</table>' : '';
    }
    function legendHtml(it) {
        if (it.type === 'wms') {
            var base = it.url.split('?')[0];
            return Promise.resolve(it.layers.split(',').map(function (n) { n = n.trim(); return '<div class="ul-le"><img src="' + esc(base + '?service=WMS&version=1.1.0&request=GetLegendGraphic&format=image/png&layer=' + encodeURIComponent(n)) + '" alt="' + esc(n) + '" onerror="this.outerHTML=\'Легенда недоступна\'"></div>'; }).join(''));
        }
        if (it.type === 'arcgis') {
            var a = ag(it);
            return a ? jsonp(a.root + '/legend').then(function (d) {
                var ls = (d.layers || []).filter(function (l) { return a.layer == null || String(l.layerId) === a.layer; });
                return ls.map(function (l) {
                    return (ls.length > 1 ? '<b>' + esc(l.layerName) + '</b>' : '') + (l.legend || []).map(function (e) {
                        return '<div class="ul-le">' + (e.imageData ? '<img src="data:' + (e.contentType || 'image/png') + ';base64,' + e.imageData + '" alt="">' : '') + '<span>' + esc(e.label || l.layerName) + '</span></div>';
                    }).join('');
                }).join('') || 'Легенда пуста';
            }) : Promise.resolve('Легенда недоступна');
        }
        if (it.type === 'xyz') return Promise.resolve('Для плиточного слоя легенда не передаётся сервером');
        return Promise.resolve('<div class="ul-le"><i class="ul-sw" style="background:' + esc(it.color) + '"></i><span>' + esc(it.name) + '</span></div>');
    }
    var lgOpen = {}, lgCache = {};
    function fillLegends() {
        items.forEach(function (it) {
            var box = $('ulList').querySelector('[data-lg-box="' + it.id + '"]');
            if (!box) return;
            if (lgCache[it.id]) { box.innerHTML = lgCache[it.id]; return; }
            legendHtml(it).then(function (h) { lgCache[it.id] = h; box.innerHTML = h; }).catch(function () { box.textContent = 'Легенда недоступна'; });
        });
    }
    function queryHtml(it, e) {
        var b = map.getBounds(), sz = map.getSize(), p1 = L.CRS.EPSG3857.project(b.getSouthWest()), p2 = L.CRS.EPSG3857.project(b.getNorthEast());
        if (it.type === 'arcgis') {
            var a = ag(it);
            if (!a) return Promise.resolve({ html: '', geoms: [] });
            return jsonp(a.root + '/identify?geometry=' + e.latlng.lng + ',' + e.latlng.lat + '&geometryType=esriGeometryPoint&sr=4326&layers=' + (a.layer != null ? 'all:' + a.layer : 'visible') +
                '&tolerance=5&mapExtent=' + [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',') + '&imageDisplay=' + sz.x + ',' + sz.y + ',96&returnGeometry=true&maxAllowableOffset=' + ((b.getEast() - b.getWest()) / sz.x)).then(function (d) {
                var rs = (d.results || []).slice(0, 5);
                return { html: rs.map(function (r) { return '<b>' + esc(r.layerName || it.name) + '</b>' + tbl(r.attributes); }).join('<hr>'), geoms: rs.map(function (r) { return r.geometry; }).filter(Boolean) };
            }).catch(function () { return { html: '', geoms: [] }; });
        }
        var url = it.url.split('?')[0] + '?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=' + encodeURIComponent(it.layers) + '&query_layers=' + encodeURIComponent(it.layers) + '&styles=&crs=EPSG:3857&bbox=' +
            [p1.x, p1.y, p2.x, p2.y].join(',') + '&width=' + sz.x + '&height=' + sz.y + '&i=' + Math.round(e.containerPoint.x) + '&j=' + Math.round(e.containerPoint.y) + '&feature_count=5&info_format=';
        function get(fmt) { return fetch(url + encodeURIComponent(fmt)).then(function (r) { return r.text(); }); }
        return get('application/json').then(function (t) {
            var d = JSON.parse(t);
            return { html: (d.features || []).map(function (f) { return '<b>' + esc(it.name) + '</b>' + tbl(f.properties); }).join('<hr>'), geoms: [] };
        }).catch(function () {
            return get('text/plain').then(function (t) { return { html: /^\s*$|no features|nothing/i.test(t) ? '' : '<b>' + esc(it.name) + '</b><pre style="white-space:pre-wrap;margin:2px 0">' + esc(t.slice(0, 800)) + '</pre>', geoms: [] }; }).catch(function () { return { html: '', geoms: [] }; });
        });
    }
    var ppOn = localStorage.getItem('gc_user_layers_pp') !== '0';
    // ---------- выбранный объект: подсветка на карте и сведения в боковой панели ----------
    var SELKEY = 'gc_user_layers_sel', HL = { color: '#f59e0b', weight: 4, opacity: 1, fillColor: '#fbbf24', fillOpacity: 0.4 }, hl = L.featureGroup().addTo(map), sel = null;
    var info = document.createElement('div');
    info.className = 'dw-block ul-info'; info.style.display = 'none';
    info.innerHTML = '<div class="dw-title">Выбранный объект <button type="button" class="ul-del" id="ulInfoX" title="Снять выделение" style="float:right">×</button></div><div id="ulInfoT" style="font-size:12px"></div>';
    pane.insertBefore(info, pane.firstChild);
    function clearSel() {
        if (sel) { try { sel.g.resetStyle(sel.l); } catch (x) { } sel = null; }
        hl.clearLayers(); info.style.display = 'none'; try { localStorage.removeItem(SELKEY); } catch (x) { }
    }
    function saveSel(title, html, shapes) { try { var j = JSON.stringify({ title: title, html: html, shapes: shapes }); if (j.length < 400000) localStorage.setItem(SELKEY, j); } catch (x) { } }
    function showInfo(title, html, quiet) {
        $('ulInfoT').innerHTML = '<div style="font-weight:600;margin-bottom:4px">' + esc(title) + '</div>' + html;
        info.style.display = '';
        var tb = document.querySelector('.bp-tab[data-bp-tab="userlayers"]');
        if (!quiet && tb && !tb.classList.contains('active')) tb.click();                       // раздел «Свои слои» открывается в боковой панели
        try { info.scrollIntoView({ block: 'nearest' }); } catch (x) { }
    }
    function selectVec(g, l, f, it) {
        clearSel(); sel = { g: g, l: l };
        l.setStyle(HL); if (l.bringToFront) l.bringToFront();
        var h = tbl(f.properties) || 'У объекта нет атрибутов';
        showInfo(it.name, h);
        try { saveSel(it.name, h, [{ k: 'gj', g: l.toGeoJSON().geometry }]); } catch (x) { }
    }
    function drawEsri(g) {
        var o = Object.assign({ interactive: false }, HL), sw = function (r) { return r.map(function (p) { return [p[1], p[0]]; }); };
        if (g.rings) hl.addLayer(L.polygon(g.rings.map(sw), o));
        else if (g.paths) hl.addLayer(L.polyline(g.paths.map(sw), o));
        else if (g.points) g.points.forEach(function (p) { hl.addLayer(L.circleMarker([p[1], p[0]], Object.assign({ radius: 7 }, o))); });
        else if (g.x != null) hl.addLayer(L.circleMarker([g.y, g.x], Object.assign({ radius: 7 }, o)));
    }
    $('ulInfoX').addEventListener('click', clearSel);
    function restoreSel() {
        var d; try { d = JSON.parse(localStorage.getItem(SELKEY) || 'null'); } catch (x) { }
        if (!d) return;
        (d.shapes || []).forEach(function (sh) {
            if (sh.k === 'esri') drawEsri(sh.g);
            else hl.addLayer(L.geoJSON(sh.g, { style: function () { return HL; }, pointToLayer: function (f, ll) { return L.circleMarker(ll, Object.assign({ radius: 7, interactive: false }, HL)); }, interactive: false }));
        });
        showInfo(d.title, d.html, true);
    }
    map.on('click', function (e) {
        if (!ppOn || (typeof m3d !== 'undefined' && m3d.active) || measureMode || currentTool || activeDrawHandler) return;
        var at = document.querySelector('.bp-tab.active'), k = at && at.getAttribute('data-bp-tab');
        if (/^(draw|measure|profile|logistics|3d|export)$/.test(k || '')) return;
        var qs = items.filter(function (it) { return it.on && (it.type === 'wms' || it.type === 'arcgis') && live[it.id] && map.hasLayer(live[it.id]); });
        if (!qs.length) { clearSel(); return; }
        Promise.all(qs.map(function (it) { return queryHtml(it, e); })).then(function (parts) {
            clearSel();
            var ok = parts.filter(function (p) { return p.html; });
            if (!ok.length) return;
            ok.forEach(function (p) { p.geoms.forEach(drawEsri); });
            var h = ok.map(function (p) { return p.html; }).join('<hr>');
            showInfo('Информация по слою', h);
            saveSel('Информация по слою', h, [].concat.apply([], ok.map(function (p) { return p.geoms.map(function (g) { return { k: 'esri', g: g }; }); })));
        });
    });
    function applyOrder() {                                                           // верх списка = верх на карте
        var n = items.length;
        items.forEach(function (it, i) { var l = live[it.id]; if (l && l.setZIndex) l.setZIndex(460 + n - i); });
        for (var i = n - 1; i >= 0; i--) { var l = live[items[i].id]; if (l && l.bringToFront && map.hasLayer(l)) l.bringToFront(); }
        hl.bringToFront();
    }
    function setOn(it, on) {
        it.on = on;
        if (on) {
            if (!live[it.id]) { try { live[it.id] = build(it); } catch (e) { say('⚠️ Ошибка слоя: ' + e.message, true); it.on = false; return; } }
            live[it.id].addTo(map); applyOrder();
        } else if (live[it.id]) { map.removeLayer(live[it.id]); clearSel(); }
    }
    function setOp(it) {
        var l = live[it.id];
        if (!l) return;
        if (l.setOpacity) l.setOpacity(it.opacity); else if (l.setStyle) l.setStyle({ opacity: it.opacity, fillOpacity: 0.2 * it.opacity });
    }

    // ---------- форма и список ----------
    $('ulType').innerHTML = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + '</option>'; }).join('');
    function form() {
        var t = $('ulType').value;
        $('ulLyrRow').style.display = (t === 'wms' || t === 'wfs') ? '' : 'none';
        $('ulHint').textContent = HINT[t] + ' Если сервер не разрешает CORS, слой не отобразится.';
    }
    function list() {
        $('ulList').innerHTML = items.length ? items.map(function (it) {
            return '<div class="ul-it" data-id="' + it.id + '"><div class="ul-top"><i class="fas fa-grip-vertical ul-grip" title="Перетащите, чтобы изменить порядок: верх списка — верх на карте"></i><input type="checkbox" data-t="' + it.id + '" title="Показать на карте"' + (it.on ? ' checked' : '') + '>' +
                '<input type="text" class="ul-in" data-n="' + it.id + '" maxlength="60" value="' + esc(it.name) + '" title="Название слоя — можно изменить"><small>' + it.type.toUpperCase() + '</small>' +
                '<button type="button" class="ul-mv" data-lg="' + it.id + '" title="Легенда">▤</button><button type="button" class="ul-mv" data-up="' + it.id + '" title="Выше">▲</button><button type="button" class="ul-mv" data-dn="' + it.id + '" title="Ниже">▼</button><button type="button" class="ul-del" data-d="' + it.id + '" title="Удалить слой">×</button></div>' +
                '<div class="ul-sub" title="' + esc(it.url) + '">Прозр. <input type="range" min="10" max="100" step="5" data-o="' + it.id + '" value="' + Math.round(it.opacity * 100) + '"></div>' + (lgOpen[it.id] ? '<div class="ul-leg" data-lg-box="' + it.id + '">Загрузка…</div>' : '') + '</div>';
        }).join('') : '<div class="ul-empty">Подключённых слоёв пока нет.</div>';
        fillLegends();
    }
    function find(id) { return items.filter(function (x) { return x.id === id; })[0]; }
    $('ulType').addEventListener('change', form);
    $('ulOp').addEventListener('input', function () { $('ulOpVal').textContent = this.value; });
    $('ulAdd').addEventListener('click', function () {
        var it = { id: 'ul' + Date.now(), type: $('ulType').value, name: $('ulName').value.trim(), url: $('ulUrl').value.trim(), layers: $('ulLyr').value.trim(), color: $('ulCol').value, opacity: (+$('ulOp').value || 100) / 100, on: true };
        if (!/^https?:\/\//i.test(it.url)) { say('⚠️ Укажите ссылку, начинающуюся с http(s)://', true); return; }
        if ((it.type === 'wms' || it.type === 'wfs') && !it.layers) { say('⚠️ Укажите имя слоя', true); return; }
        if (!it.name) it.name = TYPES[it.type].split(' ')[0] + ' ' + (items.length + 1);
        items.unshift(it); setOn(it, true); applyOrder(); save(); list();
        $('ulName').value = ''; $('ulUrl').value = ''; $('ulLyr').value = '';
        say('✅ Слой «' + it.name + '» подключён и сохранён');
    });
    $('ulList').addEventListener('change', function (e) {
        var it = find(e.target.getAttribute('data-t')), n = find(e.target.getAttribute('data-n'));
        if (it) { setOn(it, e.target.checked); save(); }
        if (n) { n.name = e.target.value.trim() || n.name; e.target.value = n.name; save(); }
    });
    $('ulList').addEventListener('input', function (e) {
        var it = find(e.target.getAttribute('data-o'));
        if (it) { it.opacity = e.target.value / 100; setOp(it); save(); }
    });
    $('ulList').addEventListener('click', function (e) {
        var lg = e.target.getAttribute('data-lg');
        if (lg) { lgOpen[lg] = !lgOpen[lg]; list(); return; }
        var up = e.target.getAttribute('data-up'), dn = e.target.getAttribute('data-dn');
        if (up || dn) { var i = items.indexOf(find(up || dn)), j = up ? i - 1 : i + 1; if (j >= 0 && j < items.length) { var t = items[i]; items[i] = items[j]; items[j] = t; applyOrder(); save(); list(); } return; }
        var id = e.target.getAttribute('data-d');
        if (!id) return;
        if (live[id]) { map.removeLayer(live[id]); delete live[id]; clearSel(); }
        idbClear(id); delete lgOpen[id]; delete lgCache[id]; items = items.filter(function (x) { return x.id !== id; }); save(); list();
    });
    var ppl = document.createElement('label');
    ppl.className = 'dw-check'; ppl.innerHTML = '<input type="checkbox" id="ulPP"' + (ppOn ? ' checked' : '') + '> Выделять объект и показывать сведения в панели по клику';
    $('ulList').parentNode.insertBefore(ppl, $('ulList'));
    $('ulPP').addEventListener('change', function () { ppOn = this.checked; try { localStorage.setItem('gc_user_layers_pp', ppOn ? '1' : '0'); } catch (x) { } });
    var clr = document.createElement('button');
    clr.type = 'button'; clr.className = 'ul-mv'; clr.style.cssText = 'font-size:11px;margin-top:6px'; clr.textContent = '🗑 Очистить кэш данных слоёв';
    clr.addEventListener('click', function () { idbClear(); say('✅ Кэш векторных данных очищен'); });
    $('ulList').parentNode.appendChild(clr);
    var dragId = null;
    $('ulList').addEventListener('mousedown', function (e) { var r = e.target.closest('.ul-it'); if (r) r.draggable = !!e.target.closest('.ul-grip'); });
    $('ulList').addEventListener('dragstart', function (e) { var r = e.target.closest('.ul-it'); if (!r) return; dragId = r.getAttribute('data-id'); r.classList.add('ul-drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { } });
    $('ulList').addEventListener('dragover', function (e) {
        var r = e.target.closest('.ul-it'); if (!r || !dragId) return;
        e.preventDefault(); [].forEach.call($('ulList').querySelectorAll('.ul-over'), function (x) { x.classList.remove('ul-over'); }); r.classList.add('ul-over');
    });
    $('ulList').addEventListener('drop', function (e) {
        var r = e.target.closest('.ul-it'); if (!r || !dragId) return;
        e.preventDefault();
        var a = find(dragId), b = find(r.getAttribute('data-id'));
        if (a && b && a !== b) { items.splice(items.indexOf(a), 1); items.splice(items.indexOf(b), 0, a); applyOrder(); save(); }
        dragId = null; list();
    });
    $('ulList').addEventListener('dragend', function () { dragId = null; list(); });
    form(); list();
    probe().then(function () { items.forEach(function (it) { if (it.on) setOn(it, true); }); applyOrder(); restoreSel(); });   // восстановление: слои, порядок и выделение                     // восстановление при запуске
})();

/* Виджет «Рисование» на карте: открывает боковую панель, вкладку «Инструменты» и блок рисования */
(function () {
    var b = document.getElementById('drawMapBtn'); if (!b) return;
    b.addEventListener('click', function (e) {
        e.stopPropagation();
        gcSite.openDrawer(document.getElementById('mainPanel'));
        var t = document.querySelector('#mainPanel .sp-tile[data-bp="draw"]'); if (t) t.click();
        if (window.gcRailMark) window.gcRailMark('tools');
    });
})();

/* «Матрица расстояний»: расстояния и время по дорогам (OSRM) между точками «Откуда» и «Куда» — матрица «все со всеми» или K ближайших.
   Точки: Excel / CSV (название, X-долгота, Y-широта) или KML, ввод вручную, клик по карте. Полное достроение до точек, стоимость, экспорт в Excel. */
(function () {
    'use strict';
    var pane = document.querySelector('[data-bp-pane="matrix"]');
    if (!pane || typeof map === 'undefined') return;
    var esc = gcSite.esc;
    var P = { from: [], to: [] }, S = null, R = [], G = {}, busy = false, stop = false, pick = null, hl = null, fileT = 'from';
    var COL = { from: '#059669', to: '#3b82f6' }, NAME = { from: 'Откуда', to: 'Куда' };
    var layer = L.featureGroup().addTo(map), pts = L.featureGroup().addTo(map);
    var q = function (k) { return pane.querySelector('[data-mx="' + k + '"]'); };
    var ll = function (c) { return [c[1], c[0]]; };
    var f2 = function (n) { return n.toFixed(2).replace('.', ','); };
    var rd = function (n) { return Math.round(n * 100) / 100; };
    var cut = function (s) { s = String(s); return s.length > 16 ? s.slice(0, 15) + '…' : s; };
    var num = function (v) { var x = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/\s/g, '')); return isFinite(x) ? x : NaN; };

    var st = document.createElement('style');
    st.textContent = '.bp-mx .mx-in{flex:1;min-width:0;height:26px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;font:inherit;font-size:12px;box-sizing:border-box;background:#fff}' +
        '.bp-mx .mx-list{max-height:108px;overflow:auto;margin-top:4px}' +
        '.bp-mx .mx-pt{display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 4px;border-bottom:1px solid #eef2f7}' +
        '.bp-mx .mx-pt span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.bp-mx .mx-pt small{color:#64748b;font-size:9px}' +
        '.bp-mx .mx-pt button{border:0;background:none;color:#94a3b8;cursor:pointer}' +
        '.bp-mx .mx-pt button:hover{color:#dc2626}' +
        '.bp-mx .mx-n{background:#e2e8f0;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px}' +
        '.bp-mx .mx-bar{height:6px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-top:6px}' +
        '.bp-mx .mx-bar i{display:block;height:100%;width:0;background:#10b981;transition:width .2s}' +
        '.bp-mx .mx-tw{overflow:auto;max-height:320px;margin-top:6px}' +
        '.bp-mx table{border-collapse:separate;border-spacing:0;font-size:10px}' +
        '.bp-mx th,.bp-mx td{border:1px solid #e2e8f0;padding:2px 5px;white-space:nowrap;text-align:right;background:#fff}' +
        '.bp-mx th{background:#f8fafc;text-align:left}' +
        '.bp-mx thead th{position:sticky;top:0;z-index:2}.bp-mx tbody th{position:sticky;left:0;z-index:1}.bp-mx thead th:first-child{left:0;z-index:3}' +
        '.bp-mx [data-r]{cursor:pointer}.bp-mx [data-r]:hover td,.bp-mx td[data-r]:hover{background:#ecfdf5}.bp-mx td.mn{background:#dcfce7;font-weight:700}';
    document.head.appendChild(st);

    function blk(t) {
        return '<div class="dw-block"><div class="dw-title">Точки «' + NAME[t] + '» <span class="mx-n" data-mx="n-' + t + '">0</span></div>' +
            '<div class="dw-act-grid"><button class="dw-act" type="button" data-mx="file" data-t="' + t + '" title="Excel / CSV: название, долгота (X), широта (Y); либо KML"><i class="fas fa-file-import"></i><span>Загрузить файл</span></button>' +
            '<button class="dw-act" type="button" data-mx="pick" data-t="' + t + '" title="Режим: каждый клик по карте добавляет точку"><i class="fas fa-location-crosshairs"></i><span>Указать на карте</span></button></div>' +
            '<div class="mx-list" data-mx="list-' + t + '"></div></div>';
    }
    var row = function (l, h) { return '<div class="dw-row"><label>' + l + '</label>' + h + '</div>'; };
    pane.innerHTML = blk('from') + blk('to') +
        '<input type="file" data-mx="inf" accept=".xlsx,.xls,.csv,.kml" style="display:none">' +
        '<div class="dw-block"><div class="dw-title">Добавить вручную</div>' +
        row('Название', '<input type="text" class="mx-in" data-mx="nm" placeholder="Например: Ферма 1">') +
        row('Долгота', '<input type="text" class="mx-in" data-mx="lon" placeholder="X, например 37.6173">') +
        row('Широта', '<input type="text" class="mx-in" data-mx="lat" placeholder="Y, например 55.7558">') +
        '<div class="dw-act-grid"><button class="dw-act" type="button" data-mx="addman" data-t="from"><i class="fas fa-plus"></i><span>В «Откуда»</span></button>' +
        '<button class="dw-act" type="button" data-mx="addman" data-t="to"><i class="fas fa-plus"></i><span>В «Куда»</span></button>' +
        '<button class="dw-act dw-danger" type="button" data-mx="clear" style="grid-column:1/-1"><i class="fas fa-trash"></i><span>Очистить все точки</span></button></div></div>' +
        '<div class="dw-block"><div class="dw-title">Настройки</div>' +
        row('Режим', '<select data-mx="mode"><option value="matrix">Матрица (все со всеми)</option><option value="nearest">Ближайшие</option></select>') +
        '<div class="dw-row" data-mx="kRow" style="display:none"><label>Ближайших</label><input type="text" class="mx-in" data-mx="k" value="1" title="Сколько ближайших точек «Куда» оставить для каждой точки «Откуда»"></div>' +
        row('Транспорт', '<select data-mx="veh"><option value="driving">Автомобиль</option><option value="walking">Пешком</option><option value="bike">Велосипед</option></select>') +
        row('Задержка', '<select data-mx="delay"><option value="100">100 мс</option><option value="200" selected>200 мс</option><option value="500">500 мс</option></select>') +
        '<label class="dw-check" title="Добавляет прямые от точки «Откуда» до дороги и от дороги до точки «Куда»; общее расстояние = прямая + дорога + прямая"><input type="checkbox" data-mx="ext"> Полное достроение до точек (прямые от точки до дороги)</label>' +
        '<label class="dw-check"><input type="checkbox" data-mx="draw" checked> Рисовать маршруты на карте</label></div>' +
        '<div class="dw-block"><div class="dw-title">Стоимость перевозки</div>' +
        row('Расход, л/100км', '<input type="text" class="mx-in" data-mx="fuel" value="10">') +
        row('Цена, ₽/л', '<input type="text" class="mx-in" data-mx="price" value="55">') +
        row('Доп., ₽/км', '<input type="text" class="mx-in" data-mx="extra" value="0" title="Амортизация, зарплата водителя, прочее">') +
        '<div class="m3-hint" data-mx="cpk"></div></div>' +
        '<div class="dw-block"><div class="dw-act-grid"><button class="dw-act" type="button" data-mx="calc"><i class="fas fa-play"></i><span>Рассчитать</span></button>' +
        '<button class="dw-act dw-danger" type="button" data-mx="abort" disabled><i class="fas fa-stop"></i><span>Прервать</span></button>' +
        '<button class="dw-act" type="button" data-mx="export" disabled style="grid-column:1/-1"><i class="fas fa-file-excel"></i><span>Экспорт в Excel</span></button></div>' +
        '<div class="mx-bar" data-mx="bar" style="display:none"><i></i></div><div class="m3-hint" data-mx="msg"></div></div>' +
        '<div class="dw-block" data-mx="res" style="display:none"><div class="dw-title">Результаты</div><div class="m3-hint" data-mx="stat"></div><div class="mx-tw" data-mx="out"></div></div>';
    pane.classList.add('bp-mx');

    function say(m, w) { var e = q('msg'); e.textContent = m; e.style.color = w ? '#dc2626' : ''; if (typeof updateStatus === 'function') updateStatus(m, w); }
    function cpk() { var v = (num(q('fuel').value) || 0) * (num(q('price').value) || 0) / 100 + (num(q('extra').value) || 0); q('cpk').textContent = 'Итого: ' + f2(v) + ' ₽/км'; return v; }

    /* ---- точки ---- */
    function refresh() {
        ['from', 'to'].forEach(function (t) {
            q('n-' + t).textContent = P[t].length;
            q('list-' + t).innerHTML = P[t].map(function (p, i) {
                return '<div class="mx-pt" title="' + esc(p.name) + '"><span>' + esc(p.name) + '</span><small>' + p.lat.toFixed(4) + ', ' + p.lon.toFixed(4) + '</small><button type="button" data-mx="del" data-t="' + t + '" data-i="' + i + '"><i class="fas fa-xmark"></i></button></div>';
            }).join('') || '<div class="m3-hint">Нет точек</div>';
        });
        pts.clearLayers();
        ['from', 'to'].forEach(function (t) {
            P[t].forEach(function (p) { L.circleMarker([p.lat, p.lon], { radius: 6, color: '#fff', weight: 2, fillColor: COL[t], fillOpacity: 1 }).bindTooltip(NAME[t] + ': ' + p.name).addTo(pts); });
        });
    }
    function fit() { if (pts.getLayers().length) map.fitBounds(pts.getBounds().pad(0.2), { maxZoom: 14 }); }
    function add(t, p) {
        if (!(p.lon >= -180 && p.lon <= 180 && p.lat >= -90 && p.lat <= 90)) return false;
        P[t].push(p); return true;
    }
    function addManual(t) {
        var lon = num(q('lon').value), lat = num(q('lat').value);
        if (!isFinite(lon) || !isFinite(lat) || !add(t, { name: q('nm').value.trim() || ('Точка ' + (P[t].length + 1)), lon: lon, lat: lat })) { say('Укажите корректные координаты: долгота X (−180…180), широта Y (−90…90)', true); return; }
        q('nm').value = q('lon').value = q('lat').value = '';
        refresh(); fit(); say('Добавлена точка в «' + NAME[t] + '»');
    }
    function setPick(t) {
        pick = (t && pick !== t) ? t : null;
        pane.querySelectorAll('[data-mx="pick"]').forEach(function (b) { b.classList.toggle('pf-on', b.getAttribute('data-t') === pick); });
        map.getContainer().style.cursor = pick ? 'crosshair' : '';
        if (pick) say('Кликайте по карте — точки добавляются в «' + NAME[pick] + '». Повторное нажатие кнопки выключит режим.');
    }
    map.on('click', function (e) {
        if (!pick || !pane.classList.contains('active')) return;
        add(pick, { name: 'Точка ' + (P[pick].length + 1), lon: e.latlng.lng, lat: e.latlng.lat }); refresh();
    });
    document.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('.bp-tab, .panel-tab');
        if (t && pick && t.getAttribute('data-bp-tab') !== 'matrix') setPick(null);
    });
    function readFile(file, t) {
        var ext = (file.name.split('.').pop() || '').toLowerCase(), rdr = new FileReader();
        rdr.onerror = function () { say('Не удалось прочитать файл', true); };
        rdr.onload = function (ev) {
            var out = [];
            try {
                if (ext === 'kml') {
                    var gj = (window.toGeoJSON || window.togeojson).kml(new DOMParser().parseFromString(ev.target.result, 'text/xml'));
                    (gj.features || []).forEach(function (f, i) {
                        if (!f.geometry) return;
                        var c = f.geometry.type === 'Point' ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;
                        out.push({ name: (f.properties && f.properties.name) || ('Точка ' + (i + 1)), lon: c[0], lat: c[1] });
                    });
                } else {
                    var wb = XLSX.read(ev.target.result, { type: 'array' }), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
                    var h = (rows[0] || []).map(function (v) { return String(v == null ? '' : v).toLowerCase(); });
                    var ci = function (re, d) { var k = h.findIndex(function (s) { return re.test(s); }); return k < 0 ? d : k; };
                    var iN = ci(/наимен|назв|name/, 0), iX = ci(/коорд\S*\s*x|долг|lon|^x$/, 1), iY = ci(/коорд\S*\s*y|широт|lat|^y$/, 2);
                    rows.forEach(function (r) {
                        var lon = num(r[iX]), lat = num(r[iY]);
                        if (r[iN] != null && r[iN] !== '' && isFinite(lon) && isFinite(lat)) out.push({ name: String(r[iN]), lon: lon, lat: lat });
                    });
                }
            } catch (err) { say('Ошибка чтения файла: ' + err.message, true); return; }
            var n = 0; out.forEach(function (p) { if (add(t, p)) n++; });
            refresh(); fit(); say('Загружено точек в «' + NAME[t] + '»: ' + n + ' (' + file.name + ')', !n);
        };
        if (ext === 'kml') rdr.readAsText(file); else rdr.readAsArrayBuffer(file);
    }

    /* ---- маршруты (OSRM) ---- */
    function hv(lo1, la1, lo2, la2) {
        var r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
        var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function nearIdx(g, lon, lat) {
        var m = Infinity, k = 0;
        for (var i = 0; i < g.length; i++) { var d = hv(g[i][0], g[i][1], lon, lat); if (d < m) { m = d; k = i; } }
        return { i: k, d: m };
    }
    function extend(g, a, b) {
        var s = nearIdx(g, a.lon, a.lat), e = nearIdx(g, b.lon, b.lat);
        var part = s.i <= e.i ? g.slice(s.i, e.i + 1) : g.slice(e.i, s.i + 1).reverse(), rdist = 0;
        for (var i = 0; i < part.length - 1; i++) rdist += hv(part[i][0], part[i][1], part[i + 1][0], part[i + 1][1]);
        return {
            km: s.d + rdist + e.d, r: rdist, s: s.d, e: e.d, geom: [[a.lon, a.lat]].concat(part, [[b.lon, b.lat]]),
            seg: [s.d > 0.01 ? [[a.lat, a.lon], [g[s.i][1], g[s.i][0]]] : null, e.d > 0.01 ? [[g[e.i][1], g[e.i][0]], [b.lat, b.lon]] : null]
        };
    }
    function osrm(a, b, veh) {
        var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 25000);
        return fetch('https://router.project-osrm.org/route/v1/' + veh + '/' + a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat + '?overview=full&geometries=geojson', { signal: ctl.signal })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { return d && d.code === 'Ok' && d.routes && d.routes[0] ? { km: d.routes[0].distance / 1000, min: d.routes[0].duration / 60, geom: d.routes[0].geometry.coordinates } : null; })
            .catch(function () { return null; })
            .then(function (x) { clearTimeout(tm); return x; });
    }
    function drawRoute(r) {
        L.polyline(r.geom.map(ll), { color: '#059669', weight: 3, opacity: 0.85 }).addTo(layer);
        if (r.seg) [['#f59e0b', r.seg[0]], ['#8b5cf6', r.seg[1]]].forEach(function (s) { if (s[1]) L.polyline(s[1], { color: s[0], weight: 3, dashArray: '8,6' }).addTo(layer); });
    }
    function highlight(r) {
        if (hl) { map.removeLayer(hl); hl = null; }
        if (!r || !r.geom) return;
        hl = L.polyline(r.geom.map(ll), { color: '#2563eb', weight: 6, opacity: 0.95 }).addTo(map);
        map.fitBounds(hl.getBounds(), { padding: [60, 60] });
        say('Маршрут: ' + S.from[r.f].name + ' → ' + S.to[r.t].name + ' — ' + f2(r.km) + ' км, ' + Math.round(r.min) + ' мин');
    }
    function setBusy(b) {
        q('calc').disabled = b; q('abort').disabled = !b; q('export').disabled = b || !R.length;
        q('bar').style.display = b ? '' : 'none';
    }
    function resetRes() {
        R = []; G = {}; S = null; layer.clearLayers();
        if (hl) { map.removeLayer(hl); hl = null; }
        q('res').style.display = 'none'; q('export').disabled = true;
    }
    async function calc() {
        if (busy) return;
        var from = P.from.slice(), to = (P.to.length ? P.to : P.from).slice();
        if (!from.length || !to.length) { say('Добавьте точки «Откуда» и «Куда»', true); return; }
        var mode = q('mode').value, veh = q('veh').value, delay = +q('delay').value || 200, k = Math.max(1, parseInt(q('k').value, 10) || 1);
        var ext = q('ext').checked, draw = q('draw').checked;
        resetRes(); busy = true; stop = false;
        S = { from: from, to: to, mode: mode, cpk: cpk() };
        var total = from.length * to.length, done = 0, ok = 0;
        setBusy(true);
        for (var fi = 0; fi < from.length && !stop; fi++) {
            var rowR = [];
            for (var ti = 0; ti < to.length && !stop; ti++) {
                if (from[fi] === to[ti]) { done++; continue; }
                var rt = await osrm(from[fi], to[ti], veh), r = { f: fi, t: ti, ok: !!rt };
                if (rt) {
                    var x = ext ? extend(rt.geom, from[fi], to[ti]) : null;
                    r.km = x ? x.km : rt.km; r.min = rt.min; r.geom = x ? x.geom : rt.geom;
                    r.s = x ? x.s : 0; r.r = x ? x.r : rt.km; r.e = x ? x.e : 0; r.seg = x ? x.seg : null; ok++;
                }
                rowR.push(r); done++;
                q('bar').firstChild.style.width = (done / total * 100) + '%';
                say('Расчёт: ' + done + ' / ' + total + ' (успешно ' + ok + ')');
                if (done < total && !stop) await new Promise(function (res) { setTimeout(res, delay); });
            }
            if (mode === 'nearest') rowR = rowR.filter(function (z) { return z.ok; }).sort(function (a, b) { return a.km - b.km; }).slice(0, k);
            rowR.forEach(function (z) { z.i = R.push(z) - 1; G[z.f + '_' + z.t] = z; if (draw && z.ok) drawRoute(z); });
        }
        busy = false; setBusy(false); render();
        if (draw && layer.getLayers().length) map.fitBounds(layer.getBounds().pad(0.1));
        say((stop ? 'Прервано. ' : 'Готово. ') + 'Маршрутов найдено: ' + R.filter(function (z) { return z.ok; }).length, !ok);
    }

    /* ---- результаты и экспорт ---- */
    function render() {
        var okR = R.filter(function (z) { return z.ok; }), res = q('res');
        res.style.display = '';
        if (!okR.length) { q('stat').textContent = ''; q('out').innerHTML = '<div class="m3-hint">Нет результатов</div>'; return; }
        var kms = okR.map(function (z) { return z.km; }), sum = kms.reduce(function (a, b) { return a + b; }, 0);
        q('stat').innerHTML = 'Маршрутов: <b>' + okR.length + '</b> · средн. <b>' + f2(sum / okR.length) + '</b> км · мин. <b>' + f2(Math.min.apply(null, kms)) + '</b> · макс. <b>' + f2(Math.max.apply(null, kms)) + '</b> · стоимость всех: <b>' + Math.round(sum * S.cpk).toLocaleString('ru-RU') + ' ₽</b>. Нажмите на ячейку — маршрут подсветится на карте.';
        var h;
        if (S.mode === 'matrix') {
            h = '<table><thead><tr><th>Откуда \\ Куда</th>' + S.to.map(function (p) { return '<th title="' + esc(p.name) + '">' + esc(cut(p.name)) + '</th>'; }).join('') + '</tr></thead><tbody>';
            S.from.forEach(function (p, fi) {
                var min = Infinity;
                S.to.forEach(function (_, ti) { var z = G[fi + '_' + ti]; if (z && z.ok && z.km < min) min = z.km; });
                h += '<tr><th title="' + esc(p.name) + '">' + esc(cut(p.name)) + '</th>';
                S.to.forEach(function (_, ti) {
                    var z = G[fi + '_' + ti];
                    if (S.from[fi] === S.to[ti]) h += '<td>0</td>';
                    else if (!z) h += '<td>–</td>';
                    else if (!z.ok) h += '<td title="Маршрут не найден">✕</td>';
                    else h += '<td data-r="' + z.i + '" class="' + (z.km === min ? 'mn' : '') + '" title="' + Math.round(z.min) + ' мин · ' + Math.round(z.km * S.cpk) + ' ₽">' + f2(z.km) + '</td>';
                });
                h += '</tr>';
            });
            h += '</tbody></table>';
        } else {
            h = '<table><thead><tr><th>Откуда</th><th>Куда</th><th>км</th><th>мин</th><th>₽</th></tr></thead><tbody>' + okR.map(function (z) {
                return '<tr data-r="' + z.i + '"><th>' + esc(S.from[z.f].name) + '</th><th>' + esc(S.to[z.t].name) + '</th><td>' + f2(z.km) + '</td><td>' + Math.round(z.min) + '</td><td>' + Math.round(z.km * S.cpk) + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
        q('out').innerHTML = h;
    }
    function exportXls() {
        if (!R.length || !S) { say('Нет данных для экспорта', true); return; }
        var near = {};
        R.forEach(function (z) { if (z.ok && (near[z.f] == null || z.km < R[near[z.f]].km)) near[z.f] = z.i; });
        var rows = [['№', 'Откуда', 'Куда', 'Прямая от «Откуда» (км)', 'По дорогам (км)', 'Прямая до «Куда» (км)', 'Общее расстояние (км)', 'Время (мин)', 'Стоимость (₽)', 'Ближайший', 'Достроение']];
        R.forEach(function (z, i) {
            var a = S.from[z.f].name, b = S.to[z.t].name;
            rows.push(z.ok ? [i + 1, a, b, rd(z.s), rd(z.r), rd(z.e), rd(z.km), Math.round(z.min), Math.round(z.km * S.cpk), near[z.f] === z.i ? '⭐' : '', (z.s > 0.01 || z.e > 0.01) ? 'да' : ''] : [i + 1, a, b, '', '', '', '', '', '', '', 'ошибка']);
        });
        var mat = [['Откуда \\ Куда'].concat(S.to.map(function (p) { return p.name; }))];
        S.from.forEach(function (p, fi) {
            mat.push([p.name].concat(S.to.map(function (_, ti) { var z = G[fi + '_' + ti]; return S.from[fi] === S.to[ti] ? 0 : (z && z.ok ? rd(z.km) : ''); })));
        });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Маршруты');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mat), 'Матрица');
        XLSX.writeFile(wb, 'матрица_расстояний_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.xlsx');
        say('Экспортировано маршрутов в Excel: ' + R.length);
    }

    /* ---- события ---- */
    pane.addEventListener('click', function (e) {
        var b = e.target.closest('[data-mx],[data-r]'); if (!b) return;
        if (b.hasAttribute('data-r')) { highlight(R[+b.getAttribute('data-r')]); return; }
        var a = b.getAttribute('data-mx'), t = b.getAttribute('data-t');
        if (a === 'file') { fileT = t; q('inf').value = ''; q('inf').click(); }
        else if (a === 'pick') setPick(t);
        else if (a === 'addman') addManual(t);
        else if (a === 'del') { P[t].splice(+b.getAttribute('data-i'), 1); refresh(); }
        else if (a === 'clear') { P.from = []; P.to = []; resetRes(); refresh(); say('Все точки удалены'); }
        else if (a === 'calc') calc();
        else if (a === 'abort') { stop = true; }
        else if (a === 'export') exportXls();
    });
    q('inf').addEventListener('change', function () { if (this.files && this.files[0]) readFile(this.files[0], fileT); });
    q('mode').addEventListener('change', function () { q('kRow').style.display = this.value === 'nearest' ? '' : 'none'; });
    ['fuel', 'price', 'extra'].forEach(function (k) { q(k).addEventListener('input', cpk); });
    cpk(); refresh();
})();

/* Главная: кнопки «Полный анализ» и «Справка» — переход к карте и открытие нужного раздела */
(function () {
    function q(s) { return document.querySelector(s); }
    var full = document.getElementById('heroFull'), help = document.getElementById('heroHelp');
    if (full) full.addEventListener('click', function () {
        var rb = q('#gcRail [data-rail="analysis"]'), tb = q('.panel-tab[data-tab="analysis"]');
        if (rb) rb.click(); if (tb) tb.click();
    });
    if (help) help.addEventListener('click', function () {
        setTimeout(function () { var win = document.getElementById('gcHelpWin'), rb = q('.gc-rail-btn[data-rail="help"]'); if (win && win.hidden && rb) rb.click(); }, 700);
    });
})();

/* Ссылки «на карту» из блока «Возможности»: переход к карте и открытие нужного раздела боковой панели */
(function () {
    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[data-open-bp]');
        if (!a) return;
        e.preventDefault();
        var bp = a.getAttribute('data-open-bp'), nav = document.querySelector('.s-nav-map');
        if (nav) nav.click();
        setTimeout(function () {
            var tile = document.querySelector('.sp-tile[data-bp="' + bp + '"]'), tab = document.querySelector('.bp-tab[data-bp-tab="' + bp + '"]');
            var g = tile && tile.closest('[data-group]'), rail = g && document.querySelector('#gcRail [data-rail="' + g.getAttribute('data-group') + '"]');
            if (rail) rail.click();
            setTimeout(function () { if (tile) tile.click(); else if (tab) tab.click(); }, 60);
        }, 700);
    });
})();

/* Кнопка входа / регистрации в шапке: пока заглушка — открывает окно «скоро» */
(function () {
    var btn = document.getElementById('siteUser'); if (!btn) return;
    var box = document.createElement('div'); box.className = 's-auth'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Вход и регистрация');
    box.innerHTML = '<div class="s-auth-box"><button type="button" class="s-auth-x" aria-label="Закрыть"><i class="fas fa-xmark"></i></button>' +
        '<div class="s-auth-ic"><i class="far fa-user"></i></div><h3>Вход и регистрация</h3>' +
        '<p>Личный кабинет находится в разработке. Скоро здесь можно будет войти или создать аккаунт, чтобы хранить отчёты и закладки на любом устройстве.</p>' +
        '<div class="s-auth-btns"><button type="button" disabled>Войти</button><button type="button" disabled>Регистрация</button></div></div>';
    document.body.appendChild(box);
    function open() { box.classList.add('open'); }
    function close() { box.classList.remove('open'); btn.focus(); }
    btn.addEventListener('click', open);
    box.addEventListener('click', function (e) { if (e.target === box || e.target.closest('.s-auth-x')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.classList.contains('open')) { e.stopPropagation(); close(); } }, true);
})();
