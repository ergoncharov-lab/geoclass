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
        var w = where(); if (!w) return;
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
        e.preventDefault(); disarm(); lockUntil = performance.now() + 1100;
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
    if (run) run.addEventListener('click', function () {
        var n = parseInt(document.getElementById('objectsCountBadge').textContent, 10) || 0;
        if (typeof updateStatus !== 'function') return;
        if (!n) updateStatus('⚠️ Сначала загрузите или нарисуйте участок', true);
        else updateStatus('ℹ️ Запуск анализа пока не подключён (заготовка)');
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
        tab: { analysis: 'Анализ участка', reports: 'Мои отчёты', catalog: 'Каталог геоданных', help: 'Инструкции' },
        bp: { main: 'Легенда слоёв', draw: 'Рисование', '3d': '3D режим', 'export': 'Экспорт карты', profile: 'Профиль рельефа', logistics: 'Логистика',
              weather: 'Погода', dates: 'Снимки', ndvi: 'NDVI', ndwi: 'NDWI', ndmi: 'NDMI', nbr: 'NBR', change: 'Изменения', catalog: 'Каталог данных' }
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
        new MutationObserver(function () {
            if (!row.hidden) setView('here', 'Что здесь?');
            else if (panel.getAttribute('data-view') === 'here') goHome();
        }).observe(row, { attributes: true, attributeFilter: ['hidden'] });
    }
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
