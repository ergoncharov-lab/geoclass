/* UX-доработки: горячие клавиши рисования, список объектов (переименование, сортировка, группировка),
   индикация сетевых запросов, сворачивание разделов паспорта. Подключается после script.js. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

    // ---------- стили ----------
    var st = document.createElement('style');
    st.textContent =
        '.ol-bar{display:flex;gap:6px;align-items:center;margin:6px 0 2px;font-size:11px;color:#64748b}' +
        '.ol-bar select{flex:1;min-width:0;height:24px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#1e293b;font-size:11px;font-family:inherit}' +
        '.ol-bar label{display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer}.ol-bar input{accent-color:#059669}' +
        '.ol-grp{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin:8px 2px 2px}' +
        '.object-item .obj-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1e293b;font-weight:500}' +
        '.object-item .obj-ren{background:none;border:none;color:#94a3b8;cursor:pointer;font-size:11px;padding:0 5px}.object-item .obj-ren:hover{color:#059669}' +
        '.object-item input.obj-in{flex:1;min-width:0;height:22px;border:1px solid #34d399;border-radius:5px;padding:0 6px;font:inherit;font-size:12px;outline:none}' +
        '.pp-sec-h{cursor:pointer;user-select:none}' +
        '.pp-sec-h::after{content:"\\f078";font-family:"Font Awesome 6 Free";font-weight:900;font-size:12px;color:#94a3b8;margin-left:6px;transition:transform .2s}' +
        '.pp-sec.pp-col .pp-sec-h::after{transform:rotate(-90deg)}.pp-sec.pp-col .pp-sec-b{display:none!important}' +
        '@media print{.pp-sec.pp-col .pp-sec-b{display:block!important}}';
    document.head.appendChild(st);

    // ---------- 1. горячие клавиши ----------
    var HK = { KeyP: ['polygon', 'Полигон'], KeyC: ['circle', 'Круг'], KeyL: ['line', 'Линия'] };
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var t = e.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        if (typeof m3d !== 'undefined' && m3d.active) return;
        var ms = $('map-section'), r = ms && ms.getBoundingClientRect();
        if (!r || r.bottom < 80 || r.top > innerHeight - 80) return;                    // карта не на экране
        if ($('map-section').querySelector('.app-container.passport-open')) return;
        if (activeDrawHandler) {                                                          // идёт рисование участка
            if (e.key === 'Enter' && activeDrawHandler.completeShape) { activeDrawHandler.completeShape(); e.preventDefault(); return; }
            if (e.key === 'Backspace' && activeDrawHandler.deleteLastVertex) { activeDrawHandler.deleteLastVertex(); e.preventDefault(); return; }
            if (e.key === 'Escape') { deactivateAllTools(); return; }
        } else if (e.key === 'Escape' && currentTool) { deactivateAllTools(); return; }
        var h = HK[e.code];
        if (!h || e.shiftKey) return;
        e.preventDefault();
        if (h[0] === 'line') skActivateTool('line'); else activateTool(h[0]);
        updateStatus('⌨️ ' + h[1] + ' (P — полигон, L — линия, C — круг, Enter — завершить, Backspace — удалить точку, Esc — отмена)');
    });

    // ---------- 2. список объектов ----------
    var S = { sort: 'date', group: false, seq: {}, ts: 0 };
    var TYPES = function (l) { return l instanceof L.Circle ? 'Круг' : l instanceof L.Rectangle ? 'Прямоугольник' : 'Полигон'; };
    var box = $('objectListContainer'), sec = $('objectListSection');
    if (box && sec) {
        var bar = document.createElement('div');
        bar.className = 'ol-bar';
        bar.innerHTML = '<select id="olSort" title="Сортировка"><option value="date">По дате создания</option><option value="area">По площади ↓</option><option value="name">По названию</option></select><label title="Группировать по типу фигуры"><input type="checkbox" id="olGroup"> По типам</label>';
        box.parentNode.insertBefore(bar, box);
        $('olSort').addEventListener('change', function () { S.sort = this.value; updateObjectList(); });
        $('olGroup').addEventListener('change', function () { S.group = this.checked; updateObjectList(); });

        window.updateObjectList = function () {
            if (box.querySelector('input.obj-in')) return;                                // идёт переименование
            var layers = drawnItems.getLayers(), total = 0, items = [];
            objectsCount = layers.length;
            layers.forEach(function (l, i) {
                var d = getObjectCenterAndArea(l);
                if (!d) return;
                var ty = TYPES(l);
                if (!l._gcTs) { l._gcTs = ++S.ts; S.seq[ty] = (S.seq[ty] || 0) + 1; l._gcDef = ty + ' ' + S.seq[ty]; }
                total += d.area;
                items.push({ l: l, i: i, a: d.area, ty: ty, nm: l._gcName || l._gcDef });
            });
            items.sort(function (x, y) { return S.sort === 'area' ? y.a - x.a : S.sort === 'name' ? x.nm.localeCompare(y.nm, 'ru', { numeric: true }) : x.l._gcTs - y.l._gcTs; });
            if (S.group) items.sort(function (x, y) { return x.ty.localeCompare(y.ty, 'ru'); });
            var html = '', last = null;
            items.forEach(function (it) {
                if (S.group && it.ty !== last) { last = it.ty; html += '<div class="ol-grp">' + it.ty + '</div>'; }
                html += '<div class="object-item ' + (selectedLayer === it.l ? 'selected' : '') + '" onclick="selectObject(' + it.i + ')" data-i="' + it.i + '">' +
                    '<span class="obj-name" title="Двойной клик — переименовать">' + esc(it.nm) + '</span>' +
                    '<button class="obj-ren" title="Переименовать"><i class="fas fa-pen"></i></button>' +
                    '<span class="obj-area">' + it.a.toFixed(3) + ' га</span>' +
                    '<button class="obj-delete" onclick="event.stopPropagation(); deleteObject(' + it.i + ')">×</button></div>';
            });
            $('objectsCountBadge').textContent = layers.length;
            box.innerHTML = html + '<div class="object-total"><span>📊 Всего объектов: ' + layers.length + '</span><span>📐 Общая площадь: ' + total.toFixed(3) + ' га</span></div>';
            areaHa = total;
        };

        function rename(row) {
            var l = drawnItems.getLayers()[+row.dataset.i], sp = row.querySelector('.obj-name');
            if (!l || !sp) return;
            var inp = document.createElement('input');
            inp.className = 'obj-in'; inp.maxLength = 60; inp.value = l._gcName || l._gcDef || '';
            sp.replaceWith(inp); inp.focus(); inp.select();
            var done = false;
            function fin(ok) {
                if (done) return; done = true;
                if (ok && inp.value.trim()) { l._gcName = inp.value.trim(); updateStatus('✏️ Объект переименован: ' + l._gcName); }
                else if (ok) delete l._gcName;
                inp.remove(); updateObjectList();
            }
            inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); });
            inp.addEventListener('blur', function () { fin(true); });
        }
        box.addEventListener('click', function (e) {                                        // capture: не даём строке выбрать объект
            if (e.target.closest('input.obj-in')) { e.stopPropagation(); return; }
            var b = e.target.closest('.obj-ren');
            if (b) { e.stopPropagation(); rename(b.closest('.object-item')); }
        }, true);
        box.addEventListener('dblclick', function (e) {
            var s = e.target.closest('.obj-name');
            if (s) rename(s.closest('.object-item'));
        });
        updateObjectList();
    }

    // ---------- 3. индикация сетевых запросов (Overpass, Open-Meteo) ----------
    var ofetch = window.fetch.bind(window), busy = 0;
    window.fetch = function (input) {
        var u = typeof input === 'string' ? input : (input && input.url) || '', on = /overpass|open-meteo\.com/.test(u);
        if (!on) return ofetch.apply(null, arguments);
        busy++; updateStatus('⏳ Загрузка данных (' + (/overpass/.test(u) ? 'OpenStreetMap' : 'Open-Meteo') + ')…');
        var p = ofetch.apply(null, arguments), fin = function () { if (--busy === 0) updateStatus('✅ Данные получены'); };
        p.then(fin, function () { if (--busy === 0) updateStatus('⚠️ Не удалось загрузить данные', true); });
        return p;
    };
    // импорт больших файлов — заставка на боковой панели
    var vf = $('vectorFileInput');
    if (vf) vf.addEventListener('change', function () {
        var f = this.files && this.files[0];
        if (!f || f.size < 400 * 1024 || !window.AnLoader) return;
        var id = AnLoader.start('Импорт файла', 'Чтение и разбор: ' + f.name, { delay: 0 });
        setTimeout(function () { AnLoader.end(id); }, 1500 + Math.min(8000, f.size / 2000));
    });

    // ---------- 4. сворачивание разделов паспорта ----------
    var body = $('ppBody'), top = document.querySelector('#passportPane .pp-top');
    function allToggle() {
        var secs = body.querySelectorAll('.pp-sec'), col = !Array.prototype.every.call(secs, function (s) { return s.classList.contains('pp-col'); });
        Array.prototype.forEach.call(secs, function (s) { s.classList.toggle('pp-col', col); });
        $('ppCollapseAll').innerHTML = col ? '<i class="fas fa-angles-down"></i> Развернуть все' : '<i class="fas fa-angles-up"></i> Свернуть все';
        if (!col) window.dispatchEvent(new Event('resize'));                              // карты внутри разделов подстраиваются
    }
    if (body && top) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'pp-btn'; btn.id = 'ppCollapseAll';
        btn.innerHTML = '<i class="fas fa-angles-up"></i> Свернуть все';
        top.insertBefore(btn, $('ppRefresh'));
        btn.addEventListener('click', allToggle);
        body.addEventListener('click', function (e) {
            var h = e.target.closest('.pp-sec-h');
            if (!h) return;
            var s = h.closest('.pp-sec');
            s.classList.toggle('pp-col');
            if (!s.classList.contains('pp-col')) window.dispatchEvent(new Event('resize'));
        });
    }
})();

/* Сохранение нарисованного в localStorage: участки («Анализ участка», импорт) и фигуры/линии/значки/текст из «Рисования».
   Состояние пишется после каждого изменения, поэтому «Очистить» и удаление объектов тоже сохраняются (пустое состояние). */
(function () {
    'use strict';
    var KD = 'gc_draw_objects_v1', KS = 'gc_draw_sketch_v1', restoring = true;
    var arr = function (a) { return Array.isArray(a) ? a.map(arr) : [a.lat, a.lng]; };
    function putLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* хранилище переполнено или недоступно */ } }
    function getLS(k) { try { var v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function serDrawn() {
        return drawnItems.getLayers().map(function (l) {
            var p = l.options || {}, o = { name: l._gcName || null, st: { color: p.color, weight: p.weight, opacity: p.opacity, fillColor: p.fillColor, fillOpacity: p.fillOpacity, dashArray: p.dashArray } };
            if (l instanceof L.Circle) { o.t = 'c'; o.ll = [l.getLatLng().lat, l.getLatLng().lng]; o.r = l.getRadius(); }
            else if (l instanceof L.Rectangle) { var b = l.getBounds(); o.t = 'r'; o.b = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]; }
            else if (l instanceof L.Polygon) { o.t = 'p'; o.pts = arr(l.getLatLngs()); }
            else return null;
            return o;
        }).filter(Boolean);
    }
    function saveDrawn() { if (!restoring) putLS(KD, serDrawn()); }
    function saveSketch() { if (!restoring && typeof sketchItems !== 'undefined' && typeof skSerializeLayer === 'function') putLS(KS, sketchItems.getLayers().map(skSerializeLayer)); }

    // перехват точек, через которые проходят все изменения (добавление, правка, удаление, «Очистить», отмена/возврат)
    var oul = window.updateObjectList;
    window.updateObjectList = function () { var r = oul.apply(this, arguments); saveDrawn(); return r; };
    if (typeof skCommit === 'function') { var osc = window.skCommit; window.skCommit = function () { var r = osc.apply(this, arguments); saveSketch(); return r; }; }
    if (typeof skRestore === 'function') { var osr = window.skRestore; window.skRestore = function () { var r = osr.apply(this, arguments); saveSketch(); return r; }; }
    window.addEventListener('pagehide', function () { saveDrawn(); saveSketch(); });

    // восстановление при запуске
    try {
        getLS(KD).forEach(function (o) {
            var l;
            if (o.t === 'c') l = L.circle(o.ll, Object.assign({}, o.st, { radius: o.r }));
            else if (o.t === 'r') l = L.rectangle(o.b, o.st);
            else if (o.t === 'p') l = L.polygon(o.pts, o.st);
            if (!l) return;
            if (o.name) l._gcName = o.name;
            drawnItems.addLayer(l);
            if (l instanceof L.Circle) { l.on('move', function () { updateAllLabels(); updateObjectList(); }); l.on('resize', function () { updateAllLabels(); updateObjectList(); }); }
            if (typeof addLabelToLayer === 'function') addLabelToLayer(l);
        });
        if (drawnItems.getLayers().length) { if (typeof updateAllLabels === 'function') updateAllLabels(); updateObjectList(); }
        var sk = getLS(KS);
        if (sk.length && typeof skBuildLayer === 'function') {
            sketchState.restoring = true;
            sk.forEach(function (o) { var l = skBuildLayer(o); if (l) { sketchState.seq = Math.max(sketchState.seq, o.id); skRegister(l); } });
            sketchState.restoring = false;
            skRenderList(); skCommit();
        }
    } catch (e) { console.error('Восстановление рисунков:', e); }
    restoring = false;
})();

/* «Поделиться», кнопка «Полный анализ», вкладка «Поддержка» и всплывающие подсказки-выноски (отключаются, выбор хранится в localStorage). */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var app = document.querySelector('#map-section .app-container');
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } return null; }
    function shareUrl() { var c = map.getCenter(); return location.href.split(/[?#]/)[0] + '?c=' + c.lat.toFixed(5) + ',' + c.lng.toFixed(5) + '&z=' + map.getZoom() + '#map-section'; }

    // ---- 1. Поделиться ----
    var shBtn = $('shareBtn'), shIn = $('shareLink'), shCopy = $('shareCopy'), shNat = $('shareNative');
    function shFill() { shIn.value = shareUrl(); }
    if (shBtn) {
        shBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePanel('sharePanel', 'shareBtn'); shFill(); });
        map.on('moveend', function () { if ($('sharePanel').classList.contains('active')) shFill(); });
        shIn.addEventListener('focus', function () { shIn.select(); });
        shCopy.addEventListener('click', function () {
            shFill();
            var done = function () {
                shCopy.classList.add('ok'); shCopy.innerHTML = '<i class="fas fa-check"></i> Скопировано';
                setTimeout(function () { shCopy.classList.remove('ok'); shCopy.innerHTML = '<i class="fas fa-copy"></i> Копировать'; }, 1800);
                updateStatus('🔗 Ссылка на текущий вид карты скопирована');
            };
            var fallback = function () { shIn.select(); try { document.execCommand('copy'); done(); } catch (e) { updateStatus('⚠️ Не удалось скопировать — выделите ссылку вручную', true); } };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shIn.value).then(done, fallback); else fallback();
        });
        if (navigator.share) {
            shNat.hidden = false;
            shNat.addEventListener('click', function () { shFill(); navigator.share({ title: document.title, url: shIn.value }).catch(function () { /* отмена */ }); });
        }
    }
    // открытие по ссылке: сразу показываем блок карты
    if (window.gcSharedView) window.addEventListener('load', function () {
        setTimeout(function () { var a = document.createElement('a'); a.href = '#map-section'; document.body.appendChild(a); a.click(); a.remove(); }, 400);
    });

    // ---- 2. «Полный анализ» в шапке: блок карты + раздел «Анализ участка» ----
    var fa = $('siteFullAnalysis');
    if (fa) fa.addEventListener('click', function () {
        var rb = document.querySelector('#gcRail [data-rail="analysis"]'), tb = document.querySelector('.panel-tab[data-tab="analysis"]');
        if (rb) rb.click();
        if (tb) tb.click();
    });

    // ---- 3. Поддержка ----
    var SUPPORT_MAIL = 'info@example.ru';   // адрес для обращений — заменить на рабочий
    var chk = $('supHints'), sMsg = $('supMsg');
    if (sMsg) {
        var type = 'Вопрос', sEm = $('supEmail'), ok = $('supOk');
        try { var d = JSON.parse(ls('gc_support_draft') || '{}'); sMsg.value = d.m || ''; sEm.value = d.e || ''; } catch (e) { /* черновика нет */ }
        var cnt = function () { $('supCnt').textContent = sMsg.value.length + ' / 2000'; };
        var draft = function () { ls('gc_support_draft', JSON.stringify({ m: sMsg.value, e: sEm.value })); };
        cnt();
        sMsg.addEventListener('input', function () { cnt(); draft(); });
        sEm.addEventListener('input', draft);
        $('supType').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            type = b.getAttribute('data-t');
            Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
        });
        $('supSend').addEventListener('click', function () {
            var m = sMsg.value.trim(), em = sEm.value.trim();
            ok.hidden = false; ok.classList.remove('err');
            if (m.length < 5) { ok.classList.add('err'); ok.textContent = 'Опишите обращение чуть подробнее.'; sMsg.focus(); return; }
            if (em && !/^\S+@\S+\.\S+$/.test(em)) { ok.classList.add('err'); ok.textContent = 'Проверьте адрес email или оставьте поле пустым.'; sEm.focus(); return; }
            var body = m + (em ? '\n\nОтвет отправить на: ' + em : '');
            if ($('supCtx').checked) { var c = map.getCenter(); body += '\n\n— данные карты —\nЦентр: ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + '\nМасштаб: ' + map.getZoom() + '\nСсылка: ' + shareUrl() + '\nБраузер: ' + navigator.userAgent; }
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(body).catch(function () { /* не критично */ });
            location.href = 'mailto:' + SUPPORT_MAIL + '?subject=' + encodeURIComponent('GeoClass: ' + type) + '&body=' + encodeURIComponent(body);
            ok.textContent = 'Письмо открыто в почтовой программе — проверьте и отправьте его. Если оно не открылось, текст обращения скопирован в буфер обмена.';
        });
    }

    // ---- 4. Всплывающие подсказки-выноски ----
    var HINTS = [
        { id: 'clear', s: '#mapClearBtn', p: 'b', t: 'Очистить карту', d: 'Одним нажатием убирает рисунки, замеры, маршрут и результаты анализов.' },
        { id: 'base', s: '#baseLayersBtn', p: 'l', t: 'Базовые карты', d: 'Смените основу карты: схема, рельеф или спутник.' },
        { id: 'analytics', s: '#analyticsBtn', p: 'l', t: 'Аналитические подложки', d: 'Land Cover и другие слои. Легенда включённого слоя появится в боковой панели.' },
        { id: 'swipe', s: '#swipeBtn', p: 'l', t: 'Шторка', d: 'Сравнивайте две подложки или даты снимков, двигая разделитель.' },
        { id: 'grid', s: '#gridBtn', p: 'l', t: 'Сетка координат', d: 'Формат, шаг и цвет сетки настраиваются здесь.' },
        { id: 'share', s: '#shareBtn', p: 'l', t: 'Поделиться', d: 'Ссылка на сайт с центром и масштабом текущего вида карты.' },
        { id: '3d', s: '#mode3dBtn', p: 'l', t: '3D режим', d: 'Рельеф, здания OSM и деревья. Вернуться к плоской карте — кнопка «2D».' },
        { id: 'locate', s: '#locateBtn', p: 'l', t: 'Моё местоположение', d: 'Быстро переместит карту туда, где вы находитесь.' },
        { id: 'north', s: '#northBtn', p: 'l', t: 'Стрелка севера', d: 'Карту можно вращать (Shift + колесо мыши). Нажмите, чтобы вернуть север вверх.' },
        { id: 'full', s: '#fullscreenBtn', p: 'l', t: 'На весь экран', d: 'Карта раскроется вместе с боковой панелью.' },
        { id: 'drawer', s: '#toggleDrawerBtn', p: 'r', t: 'Боковая панель', d: 'Сворачивает и разворачивает панель с инструментами.' }
    ];
    var seen = []; try { seen = JSON.parse(ls('gc_hints_seen') || '[]'); if (!Array.isArray(seen)) seen = []; } catch (e) { seen = []; }
    var bub = null, bubT = 0, mq = window.matchMedia('(max-width: 960px)');
    var off = function () { return ls('gc_hints_off') === '1'; };
    function hide() { clearTimeout(bubT); if (bub) { if (bub._t) bub._t.classList.remove('gh-pulse'); bub.remove(); bub = null; } }
    function vis(el) { var r = el && el.getBoundingClientRect(); return !!r && r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; }
    function show(h) {
        var t = document.querySelector(h.s);
        if (!vis(t)) return false;
        hide();
        bub = document.createElement('div'); bub.className = 'gh gh-' + h.p;
        bub.innerHTML = '<button type="button" class="gh-x" aria-label="Закрыть">×</button><b>' + h.t + '</b>' + h.d + '<button type="button" class="gh-off">Больше не показывать подсказки</button>';
        app.appendChild(bub);
        var a = app.getBoundingClientRect(), r = t.getBoundingClientRect(), w = bub.offsetWidth, hh = bub.offsetHeight, x, y;
        var cx = r.left + r.width / 2 - a.left, cy = r.top + r.height / 2 - a.top;
        if (h.p === 'l') { x = r.left - a.left - w - 14; y = cy - hh / 2; }
        else if (h.p === 'r') { x = r.right - a.left + 14; y = cy - hh / 2; }
        else { x = cx - w / 2; y = r.bottom - a.top + 14; }
        x = Math.max(8, Math.min(a.width - w - 8, x)); y = Math.max(8, Math.min(a.height - hh - 8, y));
        bub.style.left = x + 'px'; bub.style.top = y + 'px';
        bub.style.setProperty('--ay', Math.max(14, Math.min(hh - 14, cy - y)) + 'px');
        bub.style.setProperty('--ax', Math.max(14, Math.min(w - 14, cx - x)) + 'px');
        t.classList.add('gh-pulse'); bub._t = t;
        bub.querySelector('.gh-x').onclick = hide;
        bub.querySelector('.gh-off').onclick = function () { ls('gc_hints_off', '1'); if (chk) chk.checked = false; hide(); updateStatus('💡 Подсказки на карте отключены (включить: Главное → Поддержка)'); };
        bub.addEventListener('mouseenter', function () { clearTimeout(bubT); });
        bub.addEventListener('mouseleave', function () { bubT = setTimeout(hide, 4000); });
        bubT = setTimeout(hide, 10000);
        if (seen.indexOf(h.id) < 0) { seen.push(h.id); ls('gc_hints_seen', JSON.stringify(seen)); }
        return true;
    }
    function ready() {
        if (off() || mq.matches || document.hidden || bub) return false;
        var r = $('map-section').getBoundingClientRect();
        if (r.top > innerHeight * 0.3 || r.bottom < innerHeight * 0.7) return false;      // карта должна быть на экране
        if (app.classList.contains('passport-open')) return false;
        var hw = $('gcHelpWin'); if (hw && !hw.hidden) return false;
        if (document.querySelector('.widget-panel.active')) return false;
        if (typeof activeDrawHandler !== 'undefined' && activeDrawHandler) return false;
        return true;
    }
    function tick() {
        setTimeout(tick, 35000 + Math.random() * 35000);
        if (!ready()) return;
        var left = HINTS.filter(function (h) { return seen.indexOf(h.id) < 0; });
        for (var i = 0; i < left.length; i++) if (show(left[i])) return;
    }
    setTimeout(tick, 14000);
    map.on('movestart', hide);
    document.addEventListener('fullscreenchange', hide);
    if (chk) {
        chk.checked = !off();
        chk.addEventListener('change', function () {
            if (chk.checked) { ls('gc_hints_off', null); seen = []; ls('gc_hints_seen', null); updateStatus('💡 Подсказки на карте включены'); }
            else { ls('gc_hints_off', '1'); hide(); }
        });
    }
})();

/* Кадастр НСПД: слои (кварталы, участки, ОКС) в родных цветах НСПД, подсветка выбранного объекта цветом,
   ключевые сведения по-русски в боковой панели, поиск по кадастровому номеру.
   Все запросы к НСПД идут через локальный прокси serve_site.py (/ucache) — плитки и ответы кэшируются на диске.
   Выбор слоёв хранится в localStorage. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>\"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]; }); };
    var tree = $('cadTree');
    if (!tree || typeof map === 'undefined') return;
    var pane = document.querySelector('[data-bp-pane="cadastre"]');
    // nspd — ID слоя НСПД (можно поправить кликом по номеру справа от названия); rgb — цвет выделения объекта на карте
    var LAYERS = [
        { id: 'q', nspd: '36071', name: 'Кадастровые кварталы', group: 'Единицы кадастрового деления', rgb: [124, 58, 237], minZoom: 10 },
        { id: 'z', nspd: '36048', name: 'Земельные участки из ЕГРН', group: 'Земельные участки', rgb: [245, 158, 11], minZoom: 14 },
        { id: 'o', nspd: '36049', name: 'Здания и ОКС', group: 'Объекты капитального строительства', rgb: [37, 99, 235], minZoom: 15 }
    ];
    // ключевые атрибуты: [подпись, [возможные поля НСПД], тип форматирования]
    var FIELDS = [
        ['Наименование', ['name'], 's'],
        ['Вид объекта', ['land_record_type', 'build_record_type_value', 'object_type'], 's'],
        ['Назначение', ['purpose', 'building_purpose'], 's'],
        ['Адрес', ['readable_address', 'address'], 's'],
        ['Категория земель', ['land_record_category_type', 'category_type'], 's'],
        ['Разрешённое использование', ['permitted_use_established_by_document', 'permitted_use_name', 'permitted_use'], 's'],
        ['Площадь', ['land_record_area', 'specified_area', 'area', 'build_record_area', 'declared_area'], 'area'],
        ['Форма собственности', ['ownership_type'], 's'],
        ['Этажей', ['floors'], 's'],
        ['Подземных этажей', ['underground_floors'], 's'],
        ['Год постройки', ['year_built', 'build_record_year'], 's'],
        ['Ввод в эксплуатацию', ['year_commisioning', 'commission_year'], 's'],
        ['Кадастровый квартал', ['quarter_cad_number'], 's'],
        ['Статус', ['status'], 's'],
        ['Кадастровая стоимость', ['cost_value'], 'rub'],
        ['Удельный показатель', ['cost_index'], 'rubm'],
        ['Стоимость определена', ['cost_determination_date'], 'date'],
        ['Поставлен на учёт', ['land_record_reg_date', 'registration_date'], 'date']
    ];
    var NUMKEYS = ['cad_num', 'cad_number'];
    var SKIP = /^(coordinates|crs|bbox|style|interactionId|geom_data_id|systemInfo)$/;
    var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } return null; };
    var st = { on: {}, ids: {} };
    try { var sv = JSON.parse(ls('gc_cad_state') || '{}'); if (sv && typeof sv === 'object') { st.on = sv.on || {}; st.ids = sv.v === 2 ? (sv.ids || {}) : {}; } } catch (e) { /* по умолчанию */ }
    var save = function () { ls('gc_cad_state', JSON.stringify({ v: 2, on: st.on, ids: st.ids })); };
    var nid = function (c) { return st.ids[c.id] || c.nspd; };
    var statusEl = $('cadStatus'), say = function (t) { statusEl.textContent = t; };
    var proxyP = fetch('/s3/ping').then(function (r) { return r.headers.get('X-GeoClass-Proxy') === '1'; }).catch(function () { return false; });
    var NOPROXY = 'Слой НСПД работает только через локальный прокси: запустите python serve_site.py и откройте http://localhost:8000';
    var base = function (id) { return 'https://nspd.gov.ru/api/aeggis/v3/' + id + '/wms'; };
    var viaProxy = function (u) { return '/ucache?u=' + encodeURIComponent(u); };
    var r3 = function (n) { return Math.round(n * 1000) / 1000; };
    var byId = function (id) { return LAYERS.filter(function (c) { return c.id === id; })[0]; };
    var rgbs = function (c) { return 'rgb(' + c.join(',') + ')'; };

    // ---- дерево слоёв ----
    function renderTree() {
        var html = '', last = '';
        LAYERS.forEach(function (c) {
            if (c.group !== last) { last = c.group; html += '<div class="cad-grp"><i class="fas fa-folder-open"></i> ' + esc(c.group) + '</div>'; }
            html += '<label class="cad-it"><input type="checkbox" data-id="' + c.id + '"' + (st.on[c.id] ? ' checked' : '') + '><span class="cad-sw" style="background:' + rgbs(c.rgb) + '" title="Цвет выделения объекта на карте"></span><span class="cad-nm">' + esc(c.name) + '</span><small>z' + c.minZoom + '+</small><span class="cad-id" data-id="' + c.id + '" title="Изменить ID слоя НСПД">' + esc(nid(c)) + '</span><button type="button" class="cad-zm" data-id="' + c.id + '" title="Приблизить карту до масштаба z' + c.minZoom + ', с которого виден слой"><i class="fas fa-magnifying-glass-plus"></i></button></label>';
        });
        tree.innerHTML = html;
    }

    // ---- слой: готовые плитки WMS НСПД в родных цветах (через кэширующий прокси; браузер и диск хранят копии) ----
    var CadTile = L.TileLayer.extend({
        getTileUrl: function (co) {
            var c = this.options.cfg, s = this.getTileSize(), ll = this._tileCoordsToBounds(co), n = nid(c);
            var a = L.CRS.EPSG3857.project(ll.getSouthWest()), b = L.CRS.EPSG3857.project(ll.getNorthEast());
            return viaProxy(base(n) + '?REQUEST=GetMap&SERVICE=WMS&VERSION=1.3.0&FORMAT=image/png&STYLES=&TRANSPARENT=true&LAYERS=' + n + '&WIDTH=' + s.x + '&HEIGHT=' + s.y + '&CRS=EPSG:3857&BBOX=' + [a.x, a.y, b.x, b.y].map(r3).join(','));
        }
    });
    var live = {}, errs = 0;
    function setLayer(c, on) {
        st.on[c.id] = on; save();
        if (!on) { if (live[c.id]) map.removeLayer(live[c.id]); hint(); return; }
        proxyP.then(function (ok) {
            if (!ok) { say(NOPROXY); st.on[c.id] = false; save(); renderTree(); return; }
            if (live[c.id] && live[c.id]._gcId !== nid(c)) { map.removeLayer(live[c.id]); live[c.id] = null; }
            if (!live[c.id]) {
                live[c.id] = new CadTile('', { cfg: c, minZoom: c.minZoom, maxZoom: 22, zIndex: 450 + LAYERS.indexOf(c), tileSize: 256, keepBuffer: 4, updateWhenIdle: true });
                live[c.id]._gcId = nid(c);
                live[c.id].on('tileerror', function (e) {
                    var t = e.tile;
                    if (t && !t._gcRetry) { t._gcRetry = 1; setTimeout(function () { try { t.src = e.tile.src; } catch (x) { /* плитка уже снята */ } }, 1500); return; }   // одна повторная попытка
                    if (++errs === 4) say('НСПД не отдаёт плитки: проверьте интернет и доступ к НСПД из РФ (при необходимости задайте прокси GEO_PROXY и перезапустите serve_site.py).');
                });
                live[c.id].on('tileload', function () { errs = 0; });
            }
            live[c.id].addTo(map); hint();
        });
    }
    var active = function () { return LAYERS.filter(function (c) { return st.on[c.id]; }); };
    function hint() {
        var act = active(), z = map.getZoom();
        if (!act.length) { say('Отметьте слой в списке. Клик по объекту на карте покажет его сведения.'); return; }
        var far = act.filter(function (c) { return z < c.minZoom; });
        say(far.length ? 'Приблизьте карту: ' + far.map(function (c) { return c.name + ' — с z' + c.minZoom; }).join('; ') + ' (сейчас z' + z + ').' : 'Слои включены. Клик по объекту — выделение и сведения.');
    }
    map.on('zoomend', hint);
    tree.addEventListener('change', function (e) { var i = e.target.closest('input[data-id]'); if (i) setLayer(byId(i.getAttribute('data-id')), i.checked); });
    tree.addEventListener('click', function (e) {
        var z = e.target.closest('.cad-zm');
        if (z) {                                   // миниатюрная «Приблизить» у каждого подслоя
            e.preventDefault();
            var c0 = byId(z.getAttribute('data-id'));
            if (map.getZoom() < c0.minZoom) map.setZoom(c0.minZoom);
            if (!st.on[c0.id]) { var cb = tree.querySelector('input[data-id="' + c0.id + '"]'); if (cb) cb.checked = true; setLayer(c0, true); }
            return;
        }
        var s = e.target.closest('.cad-id'); if (!s) return;
        e.preventDefault();
        var c = byId(s.getAttribute('data-id')), v = prompt('ID слоя НСПД для «' + c.name + '» (по умолчанию ' + c.nspd + ')', nid(c));
        if (v === null) return;
        v = v.replace(/\D/g, '');
        if (v) { st.ids[c.id] = v; save(); renderTree(); if (st.on[c.id]) setLayer(c, true); }
    });

    // ---- сведения об объекте: карточка в боковой панели ----
    var hl = L.featureGroup().addTo(map), bnds = [], reqN = 0;
    var info = document.createElement('div');
    info.className = 'dw-block cad-info'; info.style.display = 'none';
    info.innerHTML = '<div class="dw-title">Выбранный объект <button type="button" class="cad-x" id="cadInfoX" title="Снять выделение"><i class="fas fa-xmark"></i></button></div><div id="cadInfoT"></div>';
    var sb = $('cadQuery') ? $('cadQuery').closest('.dw-block') : null;
    if (sb && sb.parentNode === pane) pane.insertBefore(info, sb.nextSibling); else pane.insertBefore(info, pane.firstChild);
    function clearSel() { hl.clearLayers(); bnds = []; sel = []; info.style.display = 'none'; }
    function showInfo(html) {
        $('cadInfoT').innerHTML = html;
        info.style.display = '';
        var tb = document.querySelector('.bp-tab[data-bp-tab="cadastre"]');
        if (tb && !tb.classList.contains('active')) tb.click();            // раздел «Кадастр» открывается в боковой панели
        try { info.scrollIntoView({ block: 'nearest' }); } catch (x) { /* прокрутка недоступна */ }
    }
    $('cadInfoX').addEventListener('click', clearSel);
    function cv(c) {
        if (typeof c[0] === 'number') {
            if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) { var ll = L.CRS.EPSG3857.unproject(L.point(c[0], c[1])); return [ll.lng, ll.lat]; }
            return c;
        }
        return c.map(cv);
    }
    // подсветка цветом слоя; возвращает границы объекта
    function addGeom(g, rgb, light) {
        if (!g || !g.coordinates) return null;
        var col = rgbs(rgb);
        try {
            var lyr = L.geoJSON({ type: 'Feature', geometry: { type: g.type, coordinates: cv(g.coordinates) } }, {
                style: { color: col, weight: light ? 3 : 4, opacity: 1, fillColor: col, fillOpacity: light ? 0.1 : 0.38 },
                pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 7, color: col, fillColor: col, fillOpacity: 0.6 }); },
                interactive: false
            }).addTo(hl);
            return lyr.getBounds();
        } catch (e) { return null; }
    }
    function flat(o, out) {
        Object.keys(o || {}).forEach(function (k) {
            var v = o[k];
            if (v == null || v === '' || SKIP.test(k)) return;
            if (Array.isArray(v)) { if (v.length && typeof v[0] !== 'object') { if (!(k in out)) out[k] = v.join(', '); } }
            else if (typeof v === 'object') flat(v, out);
            else if (!(k in out)) out[k] = v;
        });
        return out;
    }
    var nf = function (n, d) { return n.toLocaleString('ru-RU', { maximumFractionDigits: d == null ? 2 : d }); };
    function fmt(t, v) {
        var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
        if (t === 'area') { if (!isFinite(n)) return String(v); return nf(n, 2) + ' м²' + (n >= 10000 ? ' (' + nf(n / 10000, 4) + ' га)' : ''); }
        if (t === 'rub') return isFinite(n) ? nf(n, 2) + ' ₽' : String(v);
        if (t === 'rubm') return isFinite(n) ? nf(n, 2) + ' ₽/м²' : String(v);
        if (t === 'date') { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? m[3] + '.' + m[2] + '.' + m[1] : String(v); }
        return String(v).replace(/\s+/g, ' ').trim();
    }
    function detect(pr) {
        var n = String(pr.categoryName || '').toLowerCase();
        return byId(/квартал/.test(n) ? 'q' : /здани|сооруж|окс|капитальн/.test(n) ? 'o' : 'z');
    }
    // номер и список ключевых сведений [[подпись, текст]] — для карточки и для KML
    function rowsOf(pr) {
        var m = flat(pr && pr.options ? pr.options : pr, {}), num = '', list = [];
        NUMKEYS.forEach(function (k) { if (!num && m[k]) num = String(m[k]); });
        if (!num) num = String((pr && (pr.label || pr.descr || pr.externalKey)) || '');
        FIELDS.forEach(function (f) {
            var v = null;
            for (var i = 0; i < f[1].length; i++) { var x = m[f[1][i]]; if (x != null && x !== '') { v = x; break; } }
            if (v == null || (f[0] === 'Статус' && /^\d+$/.test(String(v)))) return;
            list.push([f[0], fmt(f[2], v)]);
        });
        return { num: num, list: list };
    }
    function card(c, pr, idx) {
        var ro = rowsOf(pr), num = ro.num, rows = '';
        ro.list.forEach(function (r) { rows += '<div class="cad-r"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; });
        if (!rows) rows = '<div class="cad-r cad-none">Ключевых сведений у объекта нет</div>';
        return '<div class="cad-card" style="--cc:' + rgbs(c.rgb) + '"><div class="cad-hd"><span class="cad-kind">' + esc((pr && pr.categoryName) || c.name) + '</span>'
            + '<div class="cad-num"><span>' + esc(num || '—') + '</span>'
            + (num ? '<button type="button" class="cad-cp" data-t="' + esc(num) + '" title="Скопировать номер"><i class="fas fa-copy"></i></button>' : '')
            + '<button type="button" class="cad-kml" data-i="' + idx + '" title="Скачать объект в KML"><i class="fas fa-file-arrow-down"></i></button>'
            + '<button type="button" class="cad-go" data-i="' + idx + '" title="Приблизить к объекту"><i class="fas fa-magnifying-glass-plus"></i></button></div></div>'
            + '<div class="cad-rows">' + rows + '</div></div>';
    }
    // ---- экспорт выделенного объекта в KML (WGS84) ----
    var sel = [];
    var xe = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); };
    var kc = function (p) { return p[0] + ',' + p[1] + ',0'; };
    function kring(r) { return '<LinearRing><coordinates>' + r.map(kc).join(' ') + '</coordinates></LinearRing>'; }
    function kpoly(rs) { return '<Polygon><outerBoundaryIs>' + kring(rs[0]) + '</outerBoundaryIs>' + rs.slice(1).map(function (r) { return '<innerBoundaryIs>' + kring(r) + '</innerBoundaryIs>'; }).join('') + '</Polygon>'; }
    function kgeom(g) {
        var c = cv(g.coordinates);
        if (g.type === 'Polygon') return kpoly(c);
        if (g.type === 'MultiPolygon') return '<MultiGeometry>' + c.map(kpoly).join('') + '</MultiGeometry>';
        if (g.type === 'LineString') return '<LineString><coordinates>' + c.map(kc).join(' ') + '</coordinates></LineString>';
        if (g.type === 'MultiLineString') return '<MultiGeometry>' + c.map(function (l) { return '<LineString><coordinates>' + l.map(kc).join(' ') + '</coordinates></LineString>'; }).join('') + '</MultiGeometry>';
        if (g.type === 'Point') return '<Point><coordinates>' + kc(c) + '</coordinates></Point>';
        return '';
    }
    function exportKml(i) {
        var it = sel[i]; if (!it || !it.f.geometry) { say('У объекта нет геометрии для экспорта.'); return; }
        var pr = it.f.properties || it.f, ro = rowsOf(pr), g;
        try { g = kgeom(it.f.geometry); } catch (x) { g = ''; }
        if (!g) { say('Не удалось собрать геометрию объекта для KML.'); return; }
        var rgb = it.c.rgb, hex = function (n) { return ('0' + n.toString(16)).slice(-2); }, kcol = function (a) { return hex(a) + hex(rgb[2]) + hex(rgb[1]) + hex(rgb[0]); };   // KML: aabbggrr
        var name = ro.num || it.c.name;
        var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xe(name) + '</name>'
            + '<Style id="s"><LineStyle><color>' + kcol(255) + '</color><width>3</width></LineStyle><PolyStyle><color>' + kcol(70) + '</color></PolyStyle></Style>'
            + '<Placemark><name>' + xe(name) + '</name><styleUrl>#s</styleUrl>'
            + '<description><![CDATA[' + ro.list.map(function (r) { return '<b>' + xe(r[0]) + ':</b> ' + xe(r[1]); }).join('<br>') + ']]></description>'
            + '<ExtendedData><Data name="Тип"><value>' + xe((pr && pr.categoryName) || it.c.name) + '</value></Data>' + ro.list.map(function (r) { return '<Data name="' + xe(r[0]) + '"><value>' + xe(r[1]) + '</value></Data>'; }).join('') + '</ExtendedData>'
            + g + '</Placemark></Document></kml>';
        var a = document.createElement('a'), url = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
        a.href = url; a.download = (name.replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g, '_') || 'cadastre') + '.kml';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        say('KML сохранён: ' + a.download);
    }
    info.addEventListener('click', function (e) {
        var cp = e.target.closest('.cad-cp'), go = e.target.closest('.cad-go'), kb = e.target.closest('.cad-kml');
        if (kb) { exportKml(+kb.getAttribute('data-i')); return; }
        if (cp) {
            var t = cp.getAttribute('data-t'), ok = function () { cp.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(function () { cp.innerHTML = '<i class="fas fa-copy"></i>'; }, 1200); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { });
            else { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (x) { /* копирование недоступно */ } document.body.removeChild(ta); }
        } else if (go) {
            var b = bnds[+go.getAttribute('data-i')];
            if (b && b.isValid()) map.fitBounds(b, { maxZoom: 19, padding: [40, 40] });
        }
    });
    // items: [{ c: слой, f: объект GeoJSON }] — самые «мелкие» объекты (ОКС, участки) первыми
    function select(items) {
        hl.clearLayers(); bnds = []; sel = items;
        items.slice().reverse().forEach(function (it, ri) { bnds[items.length - 1 - ri] = addGeom(it.f.geometry, it.c.rgb, it.c.id === 'q'); });   // кварталы рисуются под участками
        showInfo(items.map(function (it, i) { return card(it.c, it.f.properties || it.f, i); }).join(''));
    }
    function feats(t) {
        try { var j = JSON.parse(t); return { f: j.features || (j.data && j.data.features) || (j.data && j.data.type === 'Feature' ? [j.data] : []), raw: '' }; }
        catch (e) { return { f: [], raw: String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }; }
    }
    var okText = function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
    var busy = function () { return (typeof currentTool !== 'undefined' && currentTool) || (typeof activeDrawHandler !== 'undefined' && activeDrawHandler); };
    var fiCache = {};      // ответы GetFeatureInfo в памяти (на диске их хранит прокси)

    map.on('click', function (e) {
        var z = map.getZoom(), act = active().filter(function (c) { return live[c.id] && map.hasLayer(live[c.id]) && z >= c.minZoom; });
        if (!act.length || busy()) return;
        var my = ++reqN;
        hl.clearLayers(); bnds = []; sel = [];
        showInfo('<div class="cad-wait"><i class="fas fa-spinner fa-spin"></i> Запрос в НСПД…</div>');
        // точка привязывается к пикселю карты — повторные клики рядом берут ответ из кэша
        var m = L.CRS.EPSG3857.project(e.latlng), res = 40075016.68 / (256 * Math.pow(2, z));
        var cx = (Math.floor(m.x / res) + 0.5) * res, cy = (Math.floor(m.y / res) + 0.5) * res, r = res * 50.5;
        var bb = [cx - r, cy - r, cx + r, cy + r].map(r3).join(',');
        Promise.all(act.map(function (c) {
            var n = nid(c), u = base(n) + '?REQUEST=GetFeatureInfo&SERVICE=WMS&VERSION=1.3.0&FORMAT=image/png&STYLES=&TRANSPARENT=true&LAYERS=' + n + '&QUERY_LAYERS=' + n + '&CRS=EPSG:3857&BBOX=' + bb + '&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=application/json&FEATURE_COUNT=5';
            var p = fiCache[u] ? Promise.resolve(fiCache[u]) : fetch(viaProxy(u)).then(okText).then(function (t) { fiCache[u] = t; return t; });
            return p.then(function (t) { return { c: c, p: feats(t) }; }).catch(function () { return { c: c, err: true }; });
        })).then(function (res2) {
            if (my !== reqN) return;                // пришёл ответ на устаревший клик
            var items = [], errn = 0, raw = '';
            res2.forEach(function (x) {
                if (x.err) { errn++; return; }
                x.p.f.slice(0, 2).forEach(function (f) { items.push({ c: x.c, f: f }); });
                if (!x.p.f.length && x.p.raw) raw = x.p.raw;
            });
            items.sort(function (a, b) { return LAYERS.indexOf(b.c) - LAYERS.indexOf(a.c); });
            if (items.length) { select(items); return; }
            showInfo('<div class="cad-wait">' + (errn === res2.length ? 'НСПД не ответил. Проверьте интернет и доступ к НСПД.' : raw ? esc(raw.slice(0, 300)) : 'В этой точке объектов нет.') + '</div>');
        });
    });

    // ---- поиск по кадастровому номеру ----
    function find() {
        var q = $('cadQuery').value.trim();
        if (!q) return;
        say('Поиск в НСПД…');
        var themes = [1, 2];     // 1 — объекты недвижимости, 2 — кадастровое деление (кварталы)
        (function next(i) {
            if (i >= themes.length) { say('Ничего не найдено по запросу «' + q + '».'); return; }
            fetch(viaProxy('https://nspd.gov.ru/api/geoportal/v2/search/geoportal?thematicSearchId=' + themes[i] + '&query=' + encodeURIComponent(q))).then(okText).then(function (t) {
                var f = feats(t).f;
                if (!f.length) return next(i + 1);
                reqN++;
                var pr = f[0].properties || f[0];
                select([{ c: detect(pr), f: f[0] }]);
                say('Найдено: ' + f.length + (f.length > 1 ? ' (показан первый)' : '') + '.');
                var b = bnds[0];
                if (b && b.isValid()) map.fitBounds(b, { maxZoom: 18, padding: [40, 40] });
            }).catch(function () { say('Поиск недоступен: проверьте доступ к НСПД и запуск через serve_site.py.'); });
        })(0);
    }
    $('cadFind').addEventListener('click', find);
    $('cadQuery').addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') find(); });

    renderTree(); hint();
    active().forEach(function (c) { setLayer(c, true); });
})();
