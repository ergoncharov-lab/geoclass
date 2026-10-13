/* Навигация, «листание с приглашением» и паспорт участка. К коду карты (script.js) отношения не имеет. */
(function () {
    var root = document.documentElement;
    var header = document.getElementById('siteHeader');
    var nav = document.getElementById('siteNav');
    var burger = document.getElementById('siteBurger');
    var hero = document.getElementById('top'), mapSec = document.getElementById('map-section');
    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]:not(.s-cta)'));

    burger.addEventListener('click', function () { nav.classList.toggle('open'); });

    // ---- позиции блоков: каждый блок — на весь экран; переход между ними одинаков (колесо -> стрелка -> ещё раз колесо) ----
    var ORDER = ['top', 'map-section', 'data-catalog', 'features', 'how', 'report', 'pricing', 'sources', 'faq', 'contacts'];
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
    var LABEL = { 'top': 'На главную', 'map-section': 'К карте', 'data-catalog': 'Каталог данных', 'features': 'Возможности', 'how': 'Как это работает', 'report': 'Отчёт', 'pricing': 'Тарифы', 'sources': 'Источники данных', 'faq': 'Частые вопросы', 'contacts': 'Контакты' };
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
    // паспорт раскрывается по клику на отчёт во вкладке «Отчёты»
    Array.prototype.forEach.call(document.querySelectorAll('[data-open-passport]'), function (el) {
        el.addEventListener('click', function () { setPassport(true); });
    });
    // меню на вкладке «Главная» переключает вкладки боковой панели
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (el) {
        el.addEventListener('click', function () {
            var t = document.querySelector('.panel-tab[data-tab="' + el.getAttribute('data-goto') + '"]');
            if (t) t.click();
        });
    });
    // ---- виджет «Слои»: публичная кадастровая карта (НСПД, WMS) ----
    // Адрес сервиса и ID слоя — в одном месте, чтобы при смене легко поправить.
    var CADASTRE = { url: 'https://nspd.gov.ru/api/aeggis/v3/36049/wms', layers: '36049', minZoom: 14 };
    var cadLayer = null, cadErr = 0;
    var lBtn = document.getElementById('layersBtn'), cadT = document.getElementById('cadToggle');
    var cadO = document.getElementById('cadOpacity'), cadS = document.getElementById('cadStatus');
    if (lBtn && typeof togglePanel === 'function') lBtn.addEventListener('click', function (e) {
        e.stopPropagation(); togglePanel('layersPanel', 'layersBtn');
    });
    function setCad(on) {
        if (typeof map === 'undefined' || typeof L === 'undefined') return;
        if (on && !cadLayer) {
            cadLayer = L.tileLayer.wms(CADASTRE.url, {
                layers: CADASTRE.layers, format: 'image/png', transparent: true, version: '1.3.0',
                opacity: cadO.value / 100, minZoom: CADASTRE.minZoom, maxZoom: 22, zIndex: 450
            });
            cadLayer.on('tileerror', function () {
                if (++cadErr === 3) cadS.textContent = 'сервис НСПД не отвечает';
            });
            cadLayer.on('tileload', function () { cadErr = 0; cadS.textContent = 'виден с масштаба z' + CADASTRE.minZoom; });
        }
        if (!cadLayer) return;
        if (on) cadLayer.addTo(map); else map.removeLayer(cadLayer);
        cadT.classList.toggle('active', on);
    }
    if (cadT) cadT.addEventListener('click', function (e) { e.stopPropagation(); setCad(!cadT.classList.contains('active')); });
    if (cadO) cadO.addEventListener('input', function () { if (cadLayer) cadLayer.setOpacity(cadO.value / 100); });
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
        if (r && window.ppShow) window.ppShow(r.gj, { cad: r.cad, sat: r.sat });
    });
    rpRender();
    // плоский список слоёв участков (группы GeoJSON раскрываются) → GeoJSON-полигоны
    function rpShapes() {
        var out = [];
        (function walk(l) {
            if (l.getLayers && !(l instanceof L.Path)) { l.getLayers().forEach(walk); return; }
            try {
                var f;
                if (l instanceof L.Circle) { var c = l.getLatLng(); f = turf.circle([c.lng, c.lat], l.getRadius() / 1000, { steps: 64, units: 'kilometers' }); }
                else { var g = l.toGeoJSON(); f = g.type === 'FeatureCollection' ? g.features[0] : g; }
                if (f && f.geometry && /Polygon/.test(f.geometry.type)) out.push({ gj: f, cad: (l.feature && l.feature.properties && l.feature.properties.cad_number) || '', layer: l });
            } catch (e) { /* не полигон */ }
        })(drawnItems);
        return out;
    }
    // ---- выбор даты снимка Sentinel-2 для анализа (календарь как в разделе «Снимки»; сцены ищутся по контуру участка) ----
    var snCal = document.getElementById('anSatCal');
    if (snCal) (function () {
        var month = new Date(), groups = [], seq = 0, cache = {}, lastKey = '', sel = null, note = 'Сначала загрузите или нарисуйте участок — затем здесь появятся даты со снимками.';
        month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
        var $ = function (id) { return document.getElementById(id); }, p2 = function (n) { return (n < 10 ? '0' : '') + n; };
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
        $('anSatPrev').addEventListener('click', function () { month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)); load(0); });
        $('anSatNext').addEventListener('click', function () { month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)); load(0); });
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
            var ha = turf.area(s.gj) / 1e4;
            reports.unshift({ id: 'r' + now.getTime().toString(36) + i, name: s.cad ? 'Участок № ' + s.cad : 'Участок ' + ha.toFixed(2).replace('.', ',') + ' га', cad: s.cad, areaHa: ha, date: date, gj: s.gj, sat: { day: sat.day, cc: sat.cc, scenes: sat.scenes } });
        });
        rpSave(); rpRender();
        var tab = document.querySelector('.panel-tab[data-tab="reports"]'); if (tab) tab.click();
        updateStatus('✅ Анализ выполнен, отчётов сохранено: ' + list.length + ' (вкладка «Отчёты»)');
        if (list.length === 1 && window.ppShow) window.ppShow(reports[0].gj, { cad: reports[0].cad, sat: reports[0].sat });
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
    var back = document.getElementById('spBack'), backBtn = document.getElementById('spBackBtn'), backTitle = document.getElementById('spBackTitle');
    var TITLES = {
        tab: { analysis: 'Анализ участка', reports: 'Мои отчёты', catalog: 'Каталог геоданных', help: 'Инструкции', bookmarks: 'Закладки' },
        bp: { main: 'Легенда слоёв', draw: 'Рисование', '3d': '3D режим', measure: 'Измерения', chem: 'Почвенный анализ', 'export': 'Экспорт карты', profile: 'Профиль рельефа', logistics: 'Логистика',
              weather: 'Прогноз погоды', climate: 'Климат участка', gdd: 'Тепло и вегетация', frost: 'Заморозки', windwork: 'Ветер и окна работ', dates: 'Снимки', ndvi: 'NDVI', ndwi: 'NDWI', ndmi: 'NDMI', nbr: 'NBR', change: 'Изменения', catalog: 'Каталог данных' }
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

        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
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
    var route = document.getElementById('routeBtn');
    if (route) route.addEventListener('click', function () {
        if (!RT) { if (typeof updateStatus === 'function') updateStatus('ℹ️ Карта ещё не загружена', true); return; }
        setView('route', 'Маршрут'); RT.open();
    });
    // ---- правый клик по карте: «Маршрут сюда» / «Маршрут отсюда» / «Сохранить закладку» ----
    function ctxPt() { return (typeof contextMenuLatLng !== 'undefined' && contextMenuLatLng) ? [contextMenuLatLng.lat, contextMenuLatLng.lng] : null; }
    function ctxRoute(which) {
        var ll = ctxPt();
        if (typeof hideMapContextMenu === 'function') hideMapContextMenu();
        if (!ll) return;
        if (!RT) { if (typeof updateStatus === 'function') updateStatus('ℹ️ Карта ещё не загружена', true); return; }
        if (panel.classList.contains('hidden')) { var tg = document.getElementById('toggleDrawerBtn'); if (tg) tg.click(); }
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
        safe(function () { if (window.mxClearAll) window.mxClearAll(); });   // вкладка «Измерения»
        safe(function () { if (window.snClearAll) window.snClearAll(); });   // фигура, зоны и аномальные точки разделов NDVI / NDWI…
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
        Array.prototype.forEach.call(sec.querySelectorAll('.s-cat-all'), function (b) {
            var card = b.closest('.s-cat-card'), all = card.querySelectorAll('.s-opt'), sel = card.querySelectorAll('.s-opt.selected');
            b.textContent = (sel.length === all.length) ? 'Снять выбор' : 'Выбрать все';
        });
    }
    opts.forEach(function (o) { o.addEventListener('click', function () { o.classList.toggle('selected'); refresh(); }); });
    Array.prototype.forEach.call(sec.querySelectorAll('.s-cat-all'), function (b) {
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
    btn.addEventListener('click', function () { if (cur && cur.cancel) { btn.disabled = true; cur.cancel(); } });

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
    var listEl = document.getElementById('bmList'), emptyEl = document.getElementById('bmEmpty'), cntEl = document.getElementById('bmCount');
    if (!listEl || typeof L === 'undefined' || typeof map === 'undefined') return;
    var items = [], pin = null;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
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
        var p = document.getElementById('mainPanel');
        if (p && p.classList.contains('hidden')) { var tg = document.getElementById('toggleDrawerBtn'); if (tg) tg.click(); }
        var t = document.querySelector('.panel-tab[data-tab="bookmarks"]'); if (t) t.click();
        if (window.gcRailMark) window.gcRailMark('bookmarks');
    }
    window.gcBookmarkAdd = function (ll) {
        var b = { id: 'b' + Date.now().toString(36), name: ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5), desc: '', lat: ll.lat, lng: ll.lng, zoom: Math.round(map.getZoom()), img: '', auto: true, ts: Date.now() };
        items.unshift(b); save(); render(); openPane();
        fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&accept-language=ru&lat=' + ll.lat + '&lon=' + ll.lng)
            .then(function (r) { return r.json(); }).then(function (d) {
                if (d && d.display_name && b.auto && items.indexOf(b) >= 0) { b.name = d.display_name.split(', ').slice(0, 2).join(', '); save(); patch(b); }
            }).catch(function () { /* название останется координатами */ });
        shot(ll).then(function (img) { if (items.indexOf(b) < 0) return; b.img = img; save(); patch(b); });
        if (typeof updateStatus === 'function') updateStatus('🔖 Закладка сохранена');
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
            pin = L.marker(ll, { icon: L.divIcon({ html: '<i class="fas fa-bookmark bm-pin"></i>', className: 'custom-marker', iconSize: [22, 26], iconAnchor: [11, 24] }) }).addTo(map);
            pin.bindTooltip(b.name || 'Закладка'); pin.on('click', dropPin);
            map.flyTo(ll, Math.max(b.zoom || 15, 12), { duration: .6 });
        } else {
            items = items.filter(function (x) { return x !== b; }); save(); render(); dropPin();
        }
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
        if (panel.classList.contains('hidden')) { var tg = document.getElementById('toggleDrawerBtn'); if (tg) tg.click(); }
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
        { ic: 'fa-ruler-combined', c: '#0ea5e9', t: 'Измерения', d: 'Расстояние, площадь и периметр, радиус, азимут, координаты (ГМС, UTM), экспорт GeoJSON и KML.', h: 'Выберите режим и кликайте по карте. Enter — завершить, Backspace — убрать точку.', bp: 'measure', m: 'Быстрые замеры без отдельных программ. Итог виден сразу, историю измерений можно сохранить, а единицы длины и площади переключаются под вашу привычку.', f: ['Расстояние, площадь с периметром, радиус, азимут', 'Координаты: ГМС, UTM, высота', 'Своя система единиц, экспорт GeoJSON и KML'] },
        { ic: 'fa-mountain', c: '#14b8a6', t: 'Профиль рельефа', d: 'График высот по линии и гипсометрия по площади: перепад, длина, уклоны (данные Terrarium DEM).', h: 'Проведите линию или обведите полигон. Двойной клик по последней точке — завершить.', bp: 'profile', m: 'Показывает, как меняется высота вдоль линии или по всей площади участка. Помогает оценить эрозионные риски, стока воды и пригодность склонов для техники.', f: ['Профиль по линии: длина, перепад, уклоны', 'Гипсометрия по площади участка', 'Высоты из тайлов Terrarium DEM'] },
        { ic: 'fa-route', c: '#ef4444', t: 'Логистика', d: 'Буфер вокруг точки или участка, дороги и водоёмы OpenStreetMap и расстояния до ближайших.', h: 'Нарисуйте точку или участок и задайте размер буфера.', bp: 'logistics', m: 'Оценка окружения: насколько участок удобен для подъезда и водоснабжения. Считает, что попадает в заданный буфер, и показывает расстояния до ближайших объектов.', f: ['Буфер вокруг точки или участка', 'Дороги и водоёмы OpenStreetMap в буфере', 'Расстояния до ближайших объектов'] },
        { ic: 'fa-flask', c: '#a855f7', t: 'Почвенный анализ', d: 'pH, углерод, азот, глина, песок и другие показатели по фигуре, зоны на карте (SoilGrids, 250 м).', h: 'Нарисуйте фигуру, выберите показатель и глубину, нажмите «Рассчитать по фигуре».', bp: 'chem', m: 'Значения почвенных свойств внутри вашей фигуры по данным мировой карты SoilGrids. Участок можно разбить на зоны по значению показателя — основа для дифференцированного внесения.', f: ['8 показателей: pH, углерод, азот, глина, песок, ил, CEC, плотность', 'Шесть слоёв глубины от 0–5 до 100–200 см', 'Зоны внутри фигуры и слой значений на карте'] },
        { ic: 'fa-calendar-days', c: '#ec4899', t: 'Снимки Sentinel-2', d: 'Снимки 10 м по датам: естественные цвета и CIR, календарь, превью с облачностью, скачивание GeoTIFF.', h: 'Выберите дату в календаре, при необходимости обведите нужную область.', bp: 'dates', m: 'Свежие спутниковые снимки Sentinel-2 с разрешением 10 м. Выбирайте безоблачную дату, переключайте режимы отображения и сохраняйте область в GeoTIFF для работы в ГИС.', f: ['Естественные цвета и ложные (CIR)', 'Календарь дат с процентом облачности', 'Скачивание GeoTIFF выбранной области'] },
        { ic: 'fa-leaf', c: '#22c55e', t: 'NDVI — растительность', d: 'Густота и состояние растительности: от воды и голой почвы до густых посевов, статистика и зоны.', h: 'Выберите дату и обведите поле.', bp: 'ndvi', m: 'Главный индекс состояния посевов: чем выше значение, тем гуще и здоровее растительность. Помогает находить проблемные места на поле и планировать обследование.', f: ['Карта индекса и статистика по фигуре', 'Зоны внутри поля — равные по площади или по интервалам', 'Сравнение разных дат'] },
        { ic: 'fa-droplet', c: '#06b6d4', t: 'NDWI — вода', d: 'Выделяет водные объекты и переувлажнённые участки.', h: 'Откройте раздел и выберите дату без облаков.', bp: 'ndwi', m: 'Индекс воды по снимкам Sentinel-2. Полезен, чтобы найти водоёмы, промоины и участки поля, где вода застаивается после дождей и паводков.', f: ['Водоёмы и промоины', 'Переувлажнённые участки поля', 'Календарь, область и скачивание GeoTIFF'] },
        { ic: 'fa-seedling', c: '#0284c7', t: 'NDMI — влажность растений', d: 'Содержание влаги в растениях: помогает заметить засуху и водный стресс.', h: 'Выберите дату и сравните поля между собой.', bp: 'ndmi', m: 'Индекс влажности растительного покрова. Падение значений раньше глаза показывает, что растения начали страдать от нехватки воды.', f: ['Водный стресс растений', 'Раннее выявление засухи', 'Календарь, область и скачивание GeoTIFF'] },
        { ic: 'fa-fire', c: '#f59e0b', t: 'NBR — гари', d: 'Гари и повреждение растительности; сравнение «до и после» помогает оценить ущерб.', h: 'Сравните снимки до и после события.', bp: 'nbr', m: 'Индекс горения: по нему различают сгоревшие и здоровые участки. Сравнение снимков до и после события показывает масштаб и тяжесть повреждения.', f: ['Выявление гарей', 'Оценка тяжести повреждения', 'Календарь, область и скачивание GeoTIFF'] },
        { ic: 'fa-cloud-sun-rain', c: '#0ea5e9', t: 'Прогноз погоды', d: 'Погода сейчас и на 7 дней по вашему участку: температура, осадки, ветер, дни с заморозком.', h: 'Нарисуйте участок или загрузите контур — расчёт идёт по фигуре.', bp: 'weather', m: 'Погода по вашему участку, а не по городу: расчёт идёт по точкам внутри нарисованной фигуры. Видно, что происходит сейчас и чего ждать всю неделю.', f: ['Сейчас: температура, влажность, облачность, ветер, осадки', 'Прогноз на 7 дней с вероятностью осадков', 'Сумма T > 5 °C и дни с заморозком'] },
        { ic: 'fa-chart-line', c: '#6366f1', t: 'Климат участка', d: 'Климатограмма за 10 лет: температура и осадки по месяцам, ГТК Селянинова.', h: 'Нарисуйте участок — данные ERA5 загрузятся для его центра.', bp: 'climate', m: 'Типичный климат участка за последние 10 лет по реанализу ERA5. Нужен для подбора культур и сортов и оценки климатических рисков.', f: ['Температура и осадки по месяцам', 'Климатограмма и самый влажный месяц', 'ГТК Селянинова — оценка увлажнения'] },
        { ic: 'fa-sun-plant-wilt', c: '#22c55e', t: 'Тепло и вегетация', d: 'Суммы температур выше 5 и 10 °C, период вегетации и культуры, которым хватит тепла.', h: 'Нарисуйте участок и откройте раздел.', bp: 'gdd', m: 'Сколько тепла получает участок за год и хватит ли его выбранной культуре. Даты вегетации помогают планировать сроки сева и уборки.', f: ['Суммы температур выше 5 и 10 °C за год', 'Даты начала и конца вегетации', 'Кривая накопления тепла и подходящие культуры'] },
        { ic: 'fa-snowflake', c: '#06b6d4', t: 'Заморозки', d: 'Безморозный период, даты последнего и первого заморозка и риск по датам для сева и уборки.', h: 'Нарисуйте участок и откройте раздел.', bp: 'frost', m: 'Заморозки — главный риск для всходов и цветения. Раздел показывает, когда они обычно заканчиваются весной и начинаются осенью, и насколько это рискованно.', f: ['Безморозный период в днях', 'Средние даты последнего и первого заморозка', 'Вероятность заморозка по датам'] },
        { ic: 'fa-wind', c: '#64748b', t: 'Ветер и окна работ', d: 'Роза ветров, стрелки ветра на участке и таблица: когда опрыскивать и работать в поле.', h: 'Нарисуйте участок — стрелки появятся на карте.', bp: 'windwork', m: 'Ветер определяет, когда можно опрыскивать и где ставить лесополосы. На карте стрелки показывают текущий ветер на участке, а таблица — удачные дни недели.', f: ['Роза ветров за 10 лет', 'Анимированные стрелки ветра на участке', 'Окна для опрыскивания и полевых работ на 7 дней'] },
        { ic: 'fa-cube', c: '#6366f1', t: 'Режим 3D', d: 'Объёмный вид территории: рельеф, 3D-здания OSM, деревья и импорт моделей.', h: 'Включите 3D и наклоните карту. Вернуться — кнопка «2D».', bp: '3d', m: 'Посмотрите на территорию объёмно: рельеф с высотами, здания, деревья. Удобно для презентации участка и оценки склонов на глаз.', f: ['Рельеф и 3D-здания OSM', 'Деревья и импорт моделей', 'Возврат к плоской карте кнопкой «2D»'] },
        { ic: 'fa-file-export', c: '#8b5cf6', t: 'Экспорт карты', d: 'Сохранение текущего вида: PDF (GeoPDF), PNG, JPEG, WebP и GeoTIFF с пространственной привязкой.', h: 'Настройте вид и формат, затем сохраните файл.', bp: 'export', m: 'Сохраните карту так, как вы её видите: для печати, отчёта или работы в ГИС. GeoTIFF и GeoPDF сохраняют пространственную привязку.', f: ['PDF (GeoPDF), PNG, JPEG, WebP', 'GeoTIFF с пространственной привязкой', 'Сохраняется текущий вид карты'] },
        { ic: 'fa-database', c: '#0f766e', t: 'Каталог геоданных', d: 'Наборы данных, которые можно подключить к карте.', h: 'Выберите набор и включите слой.', tab: 'catalog', m: 'Каталог готовых наборов геоданных, которые можно подключить к карте, чтобы не искать их по разным сайтам.', f: ['Готовые наборы геоданных', 'Подключение слоя к карте'] },
        { ic: 'fa-bookmark', c: '#e11d48', t: 'Закладки', d: 'Важные места со скриншотом, названием и описанием — возвращайтесь к ним в один клик.', h: 'Откройте вкладку и добавьте закладку на нужной точке карты.', tab: 'bookmarks', m: 'Запомните важные места на карте и возвращайтесь к ним в один клик. Каждая закладка хранит снимок вида, название и ваши заметки.', f: ['Скриншот карты, название и описание', 'Координаты точки', 'Кнопка «На карте» возвращает к месту'] },
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
                '<button type="button" class="gt-go"' + (t.bp ? ' data-bp="' + t.bp + '"' : ' data-gt-tab="' + t.tab + '"') + '><i class="fas fa-play"></i><span>Открыть: ' + t.t + '</span></button>';
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
})();
