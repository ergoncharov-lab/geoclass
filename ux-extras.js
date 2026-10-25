/* UX-доработки: горячие клавиши рисования, список объектов (переименование, сортировка, группировка),
   индикация сетевых запросов, сворачивание разделов паспорта. Подключается после script.js. */
(function () {
    'use strict';

    // ---------- общие помощники (window.gcUx): используются во всех блоках этого файла ----------
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var vis = function (el) { var r = el && el.getBoundingClientRect(); return !!r && r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
    var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    // положение выноски-подсказки относительно элемента: pos — l / r / t / b; a — рамка контейнера, r — рамка элемента, w × hh — размер выноски;
    // возвращает левый/верхний угол (x, y) и смещение «хвостика» выноски (ax, ay)
    var bubblePlace = function (pos, a, r, w, hh) {
        var cx = r.left + r.width / 2 - a.left, cy = r.top + r.height / 2 - a.top, x, y;
        if (pos === 'l') { x = r.left - a.left - w - 14; y = cy - hh / 2; }
        else if (pos === 'r') { x = r.right - a.left + 14; y = cy - hh / 2; }
        else if (pos === 't') { x = cx - w / 2; y = r.top - a.top - hh - 14; }
        else { x = cx - w / 2; y = r.bottom - a.top + 14; }
        x = clamp(x, 8, a.width - w - 8); y = clamp(y, 8, a.height - hh - 8);
        return { x: x, y: y, ax: clamp(cx - x, 14, w - 14), ay: clamp(cy - y, 14, hh - 14) };
    };
    window.gcUx = { $: $, esc: esc, vis: vis, bubblePlace: bubblePlace };

    // ---------- стили ----------
    var st = document.createElement('style');
    st.textContent =
        '.cad-leg{margin:0 0 4px 27px;font-size:11.5px}.cad-leg summary{cursor:pointer;color:#4338ca;font-weight:600;padding:2px 0}.cad-legb{padding:3px 0 2px;color:#475569;line-height:1.35}' +
        '.cad-legimg{max-width:100%;display:none;margin-top:2px}.cad-lr{display:flex;gap:7px;align-items:center;margin:2px 0}.cad-lr i{width:14px;height:10px;border-radius:2px;flex:none;border:1px solid rgba(0,0,0,.15)}.cad-lnote{color:#94a3b8;margin-top:3px}' +
        '.cad-ld{display:inline-flex;gap:3px;vertical-align:middle;margin-right:7px}.cad-ld i{width:5px;height:5px;border-radius:50%;background:#4f46e5;animation:cadld 1s infinite ease-in-out both}.cad-ld i:nth-child(2){animation-delay:.15s}.cad-ld i:nth-child(3){animation-delay:.3s}' +
        '@keyframes cadld{0%,80%,100%{transform:scale(.4);opacity:.4}40%{transform:scale(1);opacity:1}}' +
        '.cad-dl-t .cad-chev{margin-left:auto;font-size:10px;transition:transform .15s}.cad-dl-t.open .cad-chev{transform:rotate(180deg)}' +
        '.cad-dd-m{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:4px}.cad-dd-m[hidden]{display:none}' +
        '.cad-dli{padding:6px 2px;border:1px solid #c7d2fe;border-radius:8px;background:#eef2ff;color:#3730a3;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer}.cad-dli:hover{background:#e0e7ff}' +
        '.map-context-menu .ctx-grp{display:flex;align-items:center}.map-context-menu .ctx-grp .ctx-chev{margin-left:auto;font-size:10px;color:#94a3b8;transition:transform .15s}.map-context-menu .ctx-grp.open .ctx-chev{transform:rotate(90deg)}' +
        '.map-context-menu .ctx-sub{position:absolute;z-index:2;min-width:190px;white-space:nowrap;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);padding:4px}.map-context-menu .ctx-grp.open{background:#f0fdf4}.map-context-menu .ctx-grp.open .ctx-chev{transform:none;color:#059669}' +
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
    st.textContent += '.maplibregl-ctrl-logo,.leaflet-attribution-flag,.leaflet-control-attribution a[href*="leafletjs.com"]{display:none!important}';   // флаг и логотип в углу карты
    document.head.appendChild(st);
    try { if (typeof map !== 'undefined' && map.attributionControl) map.attributionControl.setPrefix(false); } catch (x) { /* подписи источников тайлов остаются */ }

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
        bar.innerHTML = '<label title="Группировать по типу фигуры"><input type="checkbox" id="olGroup"> По типам</label>';
        box.parentNode.insertBefore(bar, box);
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
        $('ppCollapseAll').innerHTML = col ? '<i class="fas fa-angles-down"></i> Развернуть' : '<i class="fas fa-angles-up"></i> Свернуть';
        if (!col) window.dispatchEvent(new Event('resize'));                              // карты внутри разделов подстраиваются
    }
    if (body && top) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'pp-btn'; btn.id = 'ppCollapseAll';
        btn.innerHTML = '<i class="fas fa-angles-up"></i> Свернуть'; btn.title = 'Свернуть / развернуть все разделы паспорта';
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
    var $ = gcUx.$, vis = gcUx.vis, bubblePlace = gcUx.bubblePlace;
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
        { id: 'drawer', s: '#toggleDrawerBtn', p: 'r', t: 'Боковая панель', d: 'Сворачивает и разворачивает панель с инструментами.' },
        { id: 'sat', s: '#satelliteBtn', p: 'l', t: 'Спутниковые снимки', d: 'Google, Esri, Sentinel-2, Landsat и другие. Выбор Sentinel открывает его раздел с датами.' },
        { id: 'layers', s: '#layersWidgetBtn', p: 'l', t: 'Слои', d: 'Кварталы, участки и здания кадастра НСПД, а также свои слои. Включённый слой открывает свою панель.' },
        { id: 'profile', s: '#profileBtn', p: 'l', t: 'Профиль рельефа', d: 'Нарисуйте линию на карте — построится график высот с перепадом и уклонами.' },
        { id: 'weather', s: '#weatherBtn', p: 'l', t: 'Слой погоды', d: 'Облака, температура, ветер и осадки поверх карты. Для части слоёв нужен бесплатный ключ OpenWeatherMap.' },
        { id: 'draw', s: '#drawMapBtn', p: 'r', t: 'Рисование', d: 'Фигуры, линии, значки и текст на карте. Параметры открываются в нижней панели.' },
        { id: 'measure', s: '#measureBtn', p: 'r', t: 'Длина', d: 'Расстояние по клику: инструмент включается сразу. Результат остаётся на карте до очистки.' },
        { id: 'measure-area', s: '#measureAreaBtn', p: 'r', t: 'Площадь', d: 'Площадь и периметр по клику: инструмент включается сразу. Результат остаётся на карте до очистки.' }
    ];
    var seen = []; try { seen = JSON.parse(ls('gc_hints_seen') || '[]'); if (!Array.isArray(seen)) seen = []; } catch (e) { seen = []; }
    var bub = null, bubT = 0, mq = window.matchMedia('(max-width: 960px)');
    var off = function () { return ls('gc_hints_off') === '1'; };
    function hide() { clearTimeout(bubT); if (bub) { if (bub._t) bub._t.classList.remove('gh-pulse'); bub.remove(); bub = null; } }
    function show(h) {
        var t = document.querySelector(h.s);
        if (!vis(t)) return false;
        hide();
        bub = document.createElement('div'); bub.className = 'gh gh-' + h.p;
        bub.innerHTML = '<button type="button" class="gh-x" aria-label="Закрыть">×</button><b>' + h.t + '</b>' + h.d + '<button type="button" class="gh-off">Больше не показывать подсказки</button>';
        app.appendChild(bub);
        var pl = bubblePlace(h.p, app.getBoundingClientRect(), t.getBoundingClientRect(), bub.offsetWidth, bub.offsetHeight);
        bub.style.left = pl.x + 'px'; bub.style.top = pl.y + 'px';
        bub.style.setProperty('--ay', pl.ay + 'px');
        bub.style.setProperty('--ax', pl.ax + 'px');
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
        if (off() || mq.matches || document.hidden || bub || document.querySelector('.gh-tour')) return false;
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
   Какие слои включены, не запоминается (при каждом открытии сайта все слои выключены); в localStorage хранятся только правки ID и добавленные слои. */
(function () {
    'use strict';
    var $ = gcUx.$, esc = gcUx.esc;
    var tree = $('cadTree');
    if (!tree || typeof map === 'undefined') return;
    var pane = document.querySelector('[data-bp-pane="cadastre"]');
    // nspd — ID слоя НСПД (можно поправить кликом по номеру справа от названия); rgb — цвет выделения объекта на карте
    // ID слоёв «регионы», «районы» и «ООПТ» взяты по каталогу НСПД приблизительно: при включении слоя в строке состояния показывается его название из НСПД — если оно не то, поправьте номер здесь
    var LAYERS = [
        { id: 'r', nspd: '875815', name: 'Регионы', group: 'Единицы административного деления', rgb: [190, 18, 60], minZoom: 3 },
        { id: 'd', nspd: '36070', name: 'Кадастровые районы', group: 'Единицы кадастрового деления', rgb: [219, 39, 119], minZoom: 7 },
        { id: 'm', nspd: '875819', name: 'Муниципальные образования', group: 'Единицы административного деления', rgb: [2, 132, 199], minZoom: 6 },
        { id: 'q', nspd: '36071', name: 'Кадастровые кварталы', group: 'Единицы кадастрового деления', rgb: [124, 58, 237], minZoom: 10 },
        { id: 'z', nspd: '36048', name: 'Земельные участки из ЕГРН', group: 'Земельные участки', rgb: [245, 158, 11], minZoom: 14 },
        { id: 'o', nspd: '36049', name: 'Здания и ОКС', group: 'Объекты капитального строительства', rgb: [37, 99, 235], minZoom: 15 },
        { id: 'p', nspd: '37578', name: 'ООПТ (особо охраняемые территории)', group: 'Особо охраняемые природные территории', rgb: [22, 163, 74], minZoom: 6 },
        { id: 'n', nspd: '875831', name: 'Населённые пункты', group: 'Административно-территориальное деление', rgb: [234, 88, 12], minZoom: 8 }
    ];
    // ключевые атрибуты: [подпись, [возможные поля НСПД], тип форматирования]
    var FIELDS = [
        ['Наименование', ['name', 'name_by_doc'], 's'],
        ['Вид зоны', ['type_zone', 'zone_type', 'type_boundary_value'], 's'],
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
    try { var sv = JSON.parse(ls('gc_cad_state') || '{}'); if (sv && typeof sv === 'object') { st.ids = sv.v === 2 ? (sv.ids || {}) : {}; } } catch (e) { /* по умолчанию */ }
    var save = function () { ls('gc_cad_state', JSON.stringify({ v: 2, ids: st.ids })); };
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
        var html = '';
        LAYERS.forEach(function (c) {
            html += '<label class="cad-it"><input type="checkbox" data-id="' + c.id + '"' + (st.on[c.id] ? ' checked' : '') + '><span class="cad-sw" style="background:' + rgbs(c.rgb) + '" title="Цвет выделения объекта на карте"></span><span class="cad-nm">' + esc(c.name) + '</span><button type="button" class="cad-zm" data-id="' + c.id + '" title="Приблизить карту до масштаба, с которого виден слой"><i class="fas fa-magnifying-glass-plus"></i></button></label>'
                + '<details class="cad-leg" data-id="' + c.id + '"><summary>Легенда</summary><div class="cad-legb"><img class="cad-legimg" alt="Легенда слоя"><div class="cad-legfb">' + legFallback(c) + '</div></div></details>';
        });
        tree.innerHTML = html;
    }
    // запасная расшифровка (если легенду не отдал сервер НСПД); оттенки ориентировочные — по описанию слоя на портале НСПД
    function legFallback(c) {
        var row = function (col, t) { return '<div class="cad-lr"><i style="background:' + col + '"></i><span>' + t + '</span></div>'; };
        if (c.id === 'z') return '<div>Участки окрашены по <b>категории земель</b>:</div>' + row('#f9a8d4', 'земли населённых пунктов') + row('#fde047', 'земли сельскохозяйственного назначения') + row('#bbf7d0', 'земли лесного фонда') + row('#a16207', 'земли промышленности, транспорта и иного назначения') + '<div class="cad-lnote">Точная категория и вид разрешённого использования — в карточке участка после клика.</div>';
        if (c.id === 'n') return 'Границы населённых пунктов (города, посёлки, сёла) по данным НСПД. Название, тип и статус — в карточке после клика.';
        if (c.id === 'm') return 'Границы муниципальных образований (районы, округа, поселения). Название и вид — в карточке после клика.';
        if (c.id === 'r') return 'Границы регионов — линейный слой: клик нужно делать точно по линии границы.';
        if (c.id === 'd') return 'Границы кадастровых районов; подписаны номером района (например 77:05).';
        if (c.id === 'p') return '<div>Границы <b>особо охраняемых природных территорий</b> (ООПТ). Цвет — вид территории (ориентировочно):</div>' + row('#16a34a', 'государственные природные заповедники') + row('#0d9488', 'национальные парки') + row('#84cc16', 'государственные природные заказники') + row('#f59e0b', 'памятники природы') + row('#a855f7', 'дендрологические парки, ботанические сады') + row('#0ea5e9', 'лечебно-оздоровительные местности и курорты') + '<div class="cad-lnote">Точное название, вид, категория и документ о создании — в карточке после клика по территории.</div>';
        if (c.id === 'q') return 'Границы кадастровых кварталов; подписаны номером квартала (например 77:05:0001005).';
        return 'Контуры зданий, сооружений и объектов незавершённого строительства.';
    }
    // легенда запрашивается у НСПД при первом раскрытии (GetLegendGraphic); если сервер её не отдаёт — остаётся расшифровка выше
    tree.addEventListener('toggle', function (e) {
        var d = e.target; if (!d.classList || !d.classList.contains('cad-leg') || !d.open || d._ld) return;
        d._ld = 1;
        var c = byId(d.getAttribute('data-id')), img = d.querySelector('.cad-legimg'), fb = d.querySelector('.cad-legfb'), n = nid(c);
        proxyP.then(function (ok) {
            if (!ok) return;
            img.onload = function () { if (img.naturalWidth > 1) { img.style.display = 'block'; fb.style.display = 'none'; } };
            img.src = viaProxy(base(n) + '?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.3.0&FORMAT=image/png&LAYER=' + n + '&LAYERS=' + n + '&STYLE=');
        });
    }, true);

    // ---- слой: готовые плитки WMS НСПД в родных цветах (через кэширующий прокси; браузер и диск хранят копии) ----
    var CadTile = L.TileLayer.extend({
        getTileUrl: function (co) {
            var c = this.options.cfg, s = this.getTileSize(), ll = this._tileCoordsToBounds(co), n = nid(c);
            var a = L.CRS.EPSG3857.project(ll.getSouthWest()), b = L.CRS.EPSG3857.project(ll.getNorthEast());
            return viaProxy(base(n) + '?REQUEST=GetMap&SERVICE=WMS&VERSION=1.3.0&FORMAT=image/png&STYLES=&TRANSPARENT=true&LAYERS=' + n + '&WIDTH=' + s.x + '&HEIGHT=' + s.y + '&CRS=EPSG:3857&BBOX=' + [a.x, a.y, b.x, b.y].map(r3).join(','));
        }
    });
    // слои «регионы» и «округа»: номер в каталоге НСПД не подтверждён, поэтому при первом включении подбираем его по названию слоя из GetCapabilities
    function resolveId(c) {
        if (!c.want || c._ok) return Promise.resolve();
        c._ok = 1;
        var ids = [nid(c)].concat(c.cand || []).filter(function (v, i, a) { return a.indexOf(String(v)) < 0 || a.indexOf(v) === i; }).map(String);
        ids = ids.filter(function (v, i) { return ids.indexOf(v) === i; });
        return ids.reduce(function (p, id) {
            return p.then(function (found) {
                if (found) return found;
                return fetch(viaProxy(base(id) + '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0')).then(okText).then(function (t) {
                    var m = (t.match(/<Title>([^<]*)<\/Title>/g) || []).map(function (x) { return x.replace(/<\/?Title>/g, '').trim(); }).slice(0, 3).join(' ');
                    return c.want.test(m) ? id : null;
                }).catch(function () { return null; });
            });
        }, Promise.resolve(null)).then(function (id) {
            if (id && id !== String(nid(c))) { st.ids[c.id] = id; save(); say('Слой «' + c.name + '»: найден номер НСПД ' + id + '.'); }
        });
    }
    var live = {}, errs = 0;
    function setLayer(c, on) {
        st.on[c.id] = on; save();
        if (!on) { if (live[c.id]) map.removeLayer(live[c.id]); syncCredit(); hint(); return; }
        proxyP.then(function (ok) { return ok ? resolveId(c) : 0; }).then(function () { return proxyP; }).then(function (ok) {
            if (!ok) { say(NOPROXY); st.on[c.id] = false; save(); renderTree(); syncCredit(); return; }
            if (live[c.id] && live[c.id]._gcId !== nid(c)) { map.removeLayer(live[c.id]); live[c.id] = null; }
            if (!live[c.id]) {
                live[c.id] = new CadTile('', { cfg: c, minZoom: c.minZoom, maxZoom: 22, zIndex: 450 + LAYERS.indexOf(c), tileSize: 256, keepBuffer: 4, updateWhenIdle: true });
                live[c.id]._gcId = nid(c);
                live[c.id].on('tileerror', function (e) {
                    var t = e.tile;
                    if (t && !t._gcRetry) { t._gcRetry = 1; setTimeout(function () { try { t.src = e.tile.src; } catch (x) { /* плитка уже снята */ } }, 1500); return; }   // одна повторная попытка
                    if (++errs === 4) {      // причина — от самого прокси serve_site.py (то же, что http://localhost:8000/nspdcheck)
                        say('НСПД не отдаёт плитки. Выясняю причину…');
                        fetch('/nspdcheck').then(function (r) { return r.json(); }).then(function (d) {
                            var cc = d.ip && d.ip.country_code ? ' IP: ' + d.ip.ip + ' (' + d.ip.country_code + ').' : '';
                            say('НСПД не отдаёт плитки: ' + (d.error || ('ответ ' + d.status + (d.type ? ', ' + d.type : ''))) + '.' + cc + ' Если на компьютере корпоративный прокси — задайте GEO_PROXY (см. консоль serve_site.py).');
                        }).catch(function () { say('НСПД не отдаёт плитки, а диагностика недоступна: проверьте, что serve_site.py запущен (python serve_site.py).'); });
                    }
                });
                live[c.id].on('tileload', function () { errs = 0; });
            }
            live[c.id].addTo(map); syncCredit(); hint();
            if (!c._chk) {      // проверка номера слоя: показываем название слоя из GetCapabilities НСПД
                c._chk = 1;
                fetch(viaProxy(base(nid(c)) + '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0')).then(okText).then(function (t) {
                    var m = t.match(/<Title>([^<]*)<\/Title>/g) || [];
                    var tt = m.map(function (x) { return x.replace(/<\/?Title>/g, '').trim(); }).filter(Boolean).slice(0, 2).join(' / ');
                    if (tt) say('Слой «' + c.name + '» (НСПД ' + nid(c) + '): ' + tt);
                }).catch(function () { /* название недоступно — не критично */ });
            }
        });
    }
    var active = function () { return LAYERS.filter(function (c) { return st.on[c.id]; }); };
    // ---- указание источника в углу карты (виден, пока включён хотя бы один слой НСПД); логотип — файл nspd-logo.png рядом с сайтом, без него остаётся значок ----
    var credStyle = document.createElement('style');
    credStyle.textContent = '.gc-nspd-credit{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.92);border:1px solid #cbd5e1;border-radius:8px;padding:4px 9px 4px 6px;font:11.5px/1.2 "Segoe UI",system-ui,sans-serif;color:#334155;box-shadow:0 1px 4px rgba(0,0,0,.18)}' +
        '.gc-nspd-credit a{color:#0f5132;font-weight:600;text-decoration:none}.gc-nspd-credit a:hover{text-decoration:underline}.gc-nspd-credit img{height:20px;width:auto;display:block}.gc-nspd-credit i{color:#047857;font-size:15px}@media print{.gc-nspd-credit{display:none}}';
    document.head.appendChild(credStyle);
    var credit = L.control({ position: 'bottomright' }), creditOn = false;
    credit.onAdd = function () {
        var d = L.DomUtil.create('div', 'gc-nspd-credit');
        d.innerHTML = '<a href="https://nspd.gov.ru" target="_blank" rel="noopener" title="Национальная система пространственных данных"><img src="nspd-logo.png" alt="" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'\'"><i class="fas fa-landmark" style="display:none"></i></a>' +
            '<span>Источник: <a href="https://nspd.gov.ru" target="_blank" rel="noopener">НСПД (Росреестр)</a></span>';
        L.DomEvent.disableClickPropagation(d);
        return d;
    };
    function syncCredit() {
        var need = active().length > 0;
        if (need && !creditOn) { credit.addTo(map); creditOn = true; }
        else if (!need && creditOn) { credit.remove(); creditOn = false; }
    }
    function hint() {
        var act = active(), z = map.getZoom();
        if (!act.length) { say('Отметьте слой в списке. Клик по объекту на карте покажет его сведения.'); return; }
        var far = act.filter(function (c) { return z < c.minZoom; });
        say(far.length ? 'Приблизьте карту: ' + far.map(function (c) { return c.name + ' — с z' + c.minZoom; }).join('; ') + ' (сейчас z' + z + ').' : 'Слои включены. Клик по объекту — сведения; Ctrl+клик — выбрать несколько.');
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
    });

    // ---- сведения об объекте: карточка в боковой панели ----
    var hl = L.featureGroup().addTo(map), bnds = [], reqN = 0;
    var info = document.createElement('div');
    info.className = 'dw-block cad-info'; info.style.display = 'none';
    info.innerHTML = '<div class="dw-title">Выбранный объект <span id="cadInfoN" class="cad-n"></span><button type="button" class="cad-x" id="cadInfoX" title="Снять выделение"><i class="fas fa-xmark"></i></button></div><div id="cadInfoT"></div>';
    var sb = $('cadQuery') ? $('cadQuery').closest('.dw-block') : null;
    if (sb && sb.parentNode === pane) pane.insertBefore(info, sb.nextSibling); else pane.insertBefore(info, pane.firstChild);
    function clearSel() { reqN++; hl.clearLayers(); bnds = []; sel = []; info.style.display = 'none'; }
    ['mapClearBtn', 'clearMapBtn'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', function () { clearSel(); hint(); }); });   // общая кнопка «Очистить» снимает выделение объектов НСПД
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
    // подписи полей НСПД по-русски: точные названия, иначе перевод по словам; незнакомое поле получает понятную русскую подпись
    var RU_KEYS = { cad_num: 'Кадастровый номер', cad_number: 'Кадастровый номер', land_record_type: 'Вид земельного участка', land_record_subtype: 'Подвид земельного участка', land_record_category_type: 'Категория земель', land_record_area: 'Площадь участка', land_record_reg_date: 'Дата постановки на учёт', land_record_cancel_date: 'Дата снятия с учёта', ownership_type: 'Форма собственности', status: 'Статус', specified_area: 'Уточнённая площадь', declared_area: 'Декларированная площадь', area: 'Площадь', readable_address: 'Адрес', address: 'Адрес', cost_value: 'Кадастровая стоимость', cost_index: 'Удельный показатель стоимости', cost_determination_date: 'Дата определения стоимости', cost_application_date: 'Дата применения стоимости', cost_registration_date: 'Дата внесения стоимости', quarter_cad_number: 'Кадастровый квартал', permitted_use_established_by_document: 'Разрешённое использование по документу', permitted_use_name: 'Вид разрешённого использования', permitted_use: 'Разрешённое использование', util_by_doc: 'Использование по документу', util_code: 'Код вида использования', build_record_type_value: 'Вид объекта капитального строительства', build_record_area: 'Площадь здания', build_record_registration_date: 'Дата постановки здания на учёт', year_built: 'Год постройки', year_commisioning: 'Год ввода в эксплуатацию', commission_year: 'Год ввода в эксплуатацию', floors: 'Этажность', underground_floors: 'Подземных этажей', purpose: 'Назначение', building_purpose: 'Назначение здания', name: 'Наименование', name_by_doc: 'Наименование по документу', materials: 'Материал стен', object_type: 'Вид объекта', type_zone: 'Вид зоны', zone_type: 'Вид зоны', registration_date: 'Дата постановки на учёт', information_source: 'Источник сведений', previously_posted: 'Ранее учтённый', right_type: 'Вид права', rights_count: 'Количество прав', ref_no: 'Номер', number: 'Номер', description: 'Описание', note: 'Примечание' };
    var RU_WORDS = { cad: 'кадастровый', num: 'номер', number: 'номер', land: 'земельный', record: 'запись', type: 'вид', subtype: 'подвид', category: 'категория', area: 'площадь', reg: 'регистрация', registration: 'регистрация', date: 'дата', ownership: 'собственность', status: 'статус', specified: 'уточнённая', declared: 'декларированная', readable: 'читаемый', address: 'адрес', cost: 'стоимость', value: 'значение', index: 'показатель', determination: 'определение', application: 'применение', quarter: 'квартал', permitted: 'разрешённое', use: 'использование', established: 'установленное', by: 'по', document: 'документу', doc: 'документу', util: 'использование', code: 'код', build: 'здание', year: 'год', built: 'постройки', floors: 'этажность', underground: 'подземных', purpose: 'назначение', name: 'наименование', materials: 'материалы', object: 'объект', zone: 'зона', source: 'источник', information: 'сведения', right: 'право', rights: 'права', count: 'количество', previously: 'ранее', posted: 'учтён', cancel: 'снятие', commisioning: 'ввода в эксплуатацию', commission: 'ввода в эксплуатацию', info: 'сведения', total: 'общая', length: 'длина', width: 'ширина', height: 'высота', depth: 'глубина', perimeter: 'периметр', unit: 'единица', measure: 'измерения', of: '', the: '', size: 'размер', owner: 'владелец', region: 'регион', district: 'район', city: 'город', settlement: 'населённый пункт', street: 'улица', house: 'дом', level: 'уровень', parent: 'родительский', child: 'дочерний', geometry: 'геометрия', update: 'обновление', updated: 'обновлено', created: 'создано', start: 'начало', end: 'окончание', first: 'первый', last: 'последний', series: 'серия', kind: 'вид', group: 'группа', class: 'класс', title: 'название', text: 'текст', comment: 'комментарий', note: 'примечание', description: 'описание', is: '', has: 'есть' };
    function labelRu(k) {
        var key = String(k).trim(), low = key.toLowerCase().replace(/[\s-]+/g, '_');
        if (RU_KEYS[low]) return RU_KEYS[low];
        if (/[а-яё]/i.test(key)) return key;      // уже по-русски
        var parts = low.split(/_+/).filter(Boolean), miss = false;
        var out = parts.map(function (w) { if (w in RU_WORDS) return RU_WORDS[w]; if (/^\d+$/.test(w)) return w; miss = true; return w; }).filter(Boolean);
        if (!miss && out.length) { var s = out.join(' '); return s.charAt(0).toUpperCase() + s.slice(1); }
        return 'Дополнительное поле НСПД (' + key.replace(/_/g, ' ') + ')';
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
        if (!list.length) {      // у объекта нет знакомых полей (например, у слоя, добавленного по ID) — показываем первые простые значения как есть
            Object.keys(m).forEach(function (k) {
                var v = m[k]; if (list.length >= 8 || /id$|^id|geom|coord/i.test(k) || String(v).length > 200) return;
                list.push([labelRu(k), String(v)]);
            });
        }
        var used = {}, more = []; NUMKEYS.forEach(function (k) { used[k] = 1; }); FIELDS.forEach(function (f) { f[1].forEach(function (k) { used[k] = 1; }); });
        Object.keys(m).forEach(function (k) {   // остальные простые поля слоя — для паспорта участка
            var v = m[k]; if (used[k] || more.length >= 30 || typeof v === 'object' || /(^|_)id$|^id|geom|coord|^(label|descr|externalKey|categoryName|options)$/i.test(k) || String(v).length > 200) return;
            var s = fmt('s', v), lb = labelRu(k); if (s && !list.some(function (x) { return x[0] === lb; })) more.push([lb, s]);
        });
        return { num: num, list: list, more: more };
    }
    function card(c, pr, idx) {
        var ro = rowsOf(pr), num = ro.num, rows = '';
        ro.list.forEach(function (r) { rows += '<div class="cad-r"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; });
        if (!rows) rows = '<div class="cad-r cad-none">Ключевых сведений у объекта нет</div>';
        return '<div class="cad-card" style="--cc:' + rgbs(c.rgb) + '"><div class="cad-hd"><span class="cad-kind">' + esc((pr && pr.categoryName) || c.name) + '</span>'
            + '<div class="cad-num"><span>' + esc(num || '—') + '</span>'
            + (num ? '<button type="button" class="cad-cp" data-t="' + esc(num) + '" title="Скопировать номер"><i class="fas fa-copy"></i></button>' : '')
            + '<button type="button" class="cad-go" data-i="' + idx + '" title="Приблизить к объекту"><i class="fas fa-magnifying-glass-plus"></i></button>'
            + (sel.length > 1 ? '<button type="button" class="cad-rm" data-i="' + idx + '" title="Убрать из выбранных"><i class="fas fa-xmark"></i></button>' : '') + '</div></div>'
            + '<div class="cad-rows">' + rows + '</div>'
            + dlBtns(idx, false) + '</div>';
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
    var hex2 = function (n) { return ('0' + n.toString(16)).slice(-2); };
    function kstyle(c) {
        var rgb = c.rgb, kcol = function (a) { return hex2(a) + hex2(rgb[2]) + hex2(rgb[1]) + hex2(rgb[0]); };   // KML: aabbggrr
        return '<Style id="s_' + c.id + '"><LineStyle><color>' + kcol(255) + '</color><width>3</width></LineStyle><PolyStyle><color>' + kcol(70) + '</color></PolyStyle></Style>';
    }
    function placemark(it) {
        if (!it || !it.f.geometry) return '';
        var pr = it.f.properties || it.f, ro = rowsOf(pr), g;
        try { g = kgeom(it.f.geometry); } catch (x) { g = ''; }
        if (!g) return '';
        var name = ro.num || it.c.name;
        return '<Placemark><name>' + xe(name) + '</name><styleUrl>#s_' + it.c.id + '</styleUrl>'
            + '<description><![CDATA[' + ro.list.map(function (r) { return '<b>' + xe(r[0]) + ':</b> ' + xe(r[1]); }).join('<br>') + ']]></description>'
            + '<ExtendedData><Data name="Тип"><value>' + xe((pr && pr.categoryName) || it.c.name) + '</value></Data>' + ro.list.map(function (r) { return '<Data name="' + xe(r[0]) + '"><value>' + xe(r[1]) + '</value></Data>'; }).join('') + '</ExtendedData>'
            + g + '</Placemark>';
    }
    // which: номер объекта в списке выбранных или 'all' — все выбранные одним файлом
    function exportKml(which) {
        var list = (Array.isArray(which) ? which : which === 'all' ? sel.slice() : [sel[+which]]).filter(Boolean), seen = {}, styles = '';
        var pms = list.map(placemark).filter(Boolean);
        if (!pms.length) { say('Не удалось собрать геометрию объекта для KML.'); return; }
        list.forEach(function (it) { if (!seen[it.c.id]) { seen[it.c.id] = 1; styles += kstyle(it.c); } });
        var name = list.length > 1 ? 'Кадастр: объектов ' + pms.length : (rowsOf(list[0].f.properties || list[0].f).num || list[0].c.name);
        var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xe(name) + '</name>' + styles + pms.join('') + '</Document></kml>';
        var a = document.createElement('a'), url = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
        a.href = url; a.download = list.length > 1 ? 'cadastre_' + pms.length + '_objects.kml' : (name.replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g, '_') || 'cadastre') + '.kml';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        say('KML сохранён: ' + a.download);
    }
    // ---- экспорт в GeoJSON и Shapefile (WGS84, EPSG:4326); KML — выше ----
    var FMT = { kml: 'KML', geojson: 'GeoJSON', shp: 'SHP', dxf: 'DXF' };
    function dlBtns(idx, all) {   // одна кнопка «Скачать границы» с раскрывающимся списком форматов
        return '<div class="cad-dd' + (all ? ' cad-dd-all' : '') + '"><button type="button" class="cad-dl cad-dl-t' + (all ? ' cad-dl-all' : '') + '" title="Скачать ' + (all ? 'все выбранные объекты' : 'этот объект') + '"><i class="fas fa-file-arrow-down"></i> Скачать границы <i class="fas fa-chevron-down cad-chev"></i></button>'
            + '<div class="cad-dd-m" hidden>' + Object.keys(FMT).map(function (f) {
                return '<button type="button" class="cad-dli" data-i="' + idx + '" data-f="' + f + '" title="' + FMT[f] + (f === 'shp' ? ' (ZIP: shp, shx, dbf, prj, cpg; с атрибутами)' : f === 'dxf' ? ' (AutoCAD, метры, UTM)' : '') + '">' + FMT[f] + '</button>';
            }).join('') + '</div></div>';
    }
    var listOf = function (which) { return (Array.isArray(which) ? which : which === 'all' ? sel.slice() : [sel[+which]]).filter(Boolean); };
    function saveFile(blob, name) {
        var a = document.createElement('a'), url = URL.createObjectURL(blob);
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        say(FMT[/\.kml$/.test(name) ? 'kml' : /\.zip$/.test(name) ? 'shp' : /\.dxf$/.test(name) ? 'dxf' : 'geojson'] + ' сохранён: ' + name);
    }
    // коллекция объектов GeoJSON: свойства — номер, тип и ключевые сведения (подписи по-русски, как в карточке и KML)
    function toFC(list, full) {
        var fs = [];
        list.forEach(function (it) {
            var g = it.f && it.f.geometry; if (!g || !g.coordinates) return;
            var pr = it.f.properties || it.f, ro = rowsOf(pr), p = { 'Номер': ro.num || '', 'Тип': (pr && pr.categoryName) || it.c.name };
            ro.list.forEach(function (r) { if (!(r[0] in p)) p[r[0]] = r[1]; });
            if (full) ro.more.forEach(function (r) { if (!(r[0] in p)) p[r[0]] = r[1]; });   // для SHP — и остальные поля слоя
            fs.push({ type: 'Feature', properties: p, geometry: { type: g.type, coordinates: cv(g.coordinates) } });
        });
        return { type: 'FeatureCollection', features: fs };
    }
    var baseName = function (list) { return list.length > 1 ? 'cadastre_' + list.length + '_objects' : (((rowsOf(list[0].f.properties || list[0].f).num || list[0].c.name) + '').replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g, '_') || 'cadastre'); };
    // --- Shapefile: геометрия (.shp/.shx), атрибуты (.dbf, кодировка CP1251 — читается QGIS и ArcGIS), проекция (.prj), кодировка (.cpg) ---
    var DBF_NAMES = { 'Номер': 'NUM', 'Тип': 'TYPE', 'Наименование': 'NAME', 'Вид зоны': 'ZONE_TYPE', 'Вид объекта': 'OBJ_KIND', 'Назначение': 'PURPOSE', 'Адрес': 'ADDRESS', 'Категория земель': 'CATEGORY', 'Разрешённое использование': 'PERM_USE', 'Площадь': 'AREA', 'Форма собственности': 'OWNERSHIP', 'Этажей': 'FLOORS', 'Подземных этажей': 'UFLOORS', 'Год постройки': 'YEAR_BUILT', 'Ввод в эксплуатацию': 'YEAR_COMM', 'Кадастровый квартал': 'QUARTER', 'Статус': 'STATUS', 'Кадастровая стоимость': 'COST', 'Удельный показатель': 'COST_M2', 'Стоимость определена': 'COST_DATE', 'Поставлен на учёт': 'REG_DATE' };
    var TR1 = 'а a б b в v г g д d е e ё e ж zh з z и i й y к k л l м m н n о o п p р r с s т t у u ф f х h ц c ч ch ш sh щ sch ъ  ы y ь  э e ю yu я ya'.split(' ');
    var TR = {}; for (var ti = 0; ti + 1 < TR1.length; ti += 2) TR[TR1[ti]] = TR1[ti + 1];
    function dbfName(k) {   // имя поля до 10 латинских символов: транслитерация подписи (напр. «Кадастровый номер» → KADASTROVY)
        var t = String(k).toLowerCase().split('').map(function (ch) { return ch in TR ? TR[ch] : ch; }).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().slice(0, 10);
        return t || 'ATTR';
    }
    function cp1251(s) {
        var out = [], i, c;
        s = String(s == null ? '' : s).replace(/[\u00A0\u202F\u2009]/g, ' ').replace(/[\r\n\t]+/g, ' ');
        for (i = 0; i < s.length; i++) {
            c = s.charCodeAt(i);
            out.push(c < 128 ? c : (c >= 0x410 && c <= 0x44F) ? c - 0x350 : c === 0x401 ? 0xA8 : c === 0x451 ? 0xB8 : c === 0x2116 ? 0xB9 : c === 0xAB || c === 0xBB || c === 0xB0 || c === 0xB1 ? c : c === 0xB2 ? 0x32 : c === 0x2014 ? 0x97 : c === 0x2013 ? 0x96 : c === 0x2019 || c === 0x2018 ? 0x27 : c === 0x201C || c === 0x201D ? 0x22 : 63);
        }
        return out;
    }
    function ringArea(r) { var a = 0, i; for (i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
    function shpGroup(feats, kind, base) {   // kind: 'poly' | 'line' | 'point'; возвращает набор файлов shp/shx/dbf/prj/cpg
        var recs = feats.map(function (f) {
            var g = f.geometry, parts = [], pts = 0, bb = [Infinity, Infinity, -Infinity, -Infinity];
            if (kind === 'point') { parts = [[g.coordinates]]; }
            else if (kind === 'line') { parts = (g.type === 'LineString' ? [g.coordinates] : g.coordinates).map(function (l) { return l; }); }
            else (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach(function (pl) {
                pl.forEach(function (r, ri) {
                    r = r.slice(); var a = ringArea(r);
                    if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) { r.push(r[0].slice()); a = ringArea(r); }
                    parts.push((ri === 0 && a > 0) || (ri > 0 && a < 0) ? r.reverse() : r);   // внешние кольца — по часовой стрелке, дыры — против
                });
            });
            parts.forEach(function (r) { (kind === 'point' ? r : r).forEach(function (q) { pts++; if (q[0] < bb[0]) bb[0] = q[0]; if (q[1] < bb[1]) bb[1] = q[1]; if (q[0] > bb[2]) bb[2] = q[0]; if (q[1] > bb[3]) bb[3] = q[1]; }); });
            return { parts: parts, n: pts, bb: bb, len: kind === 'point' ? 20 : 44 + 4 * parts.length + 16 * pts };
        });
        var all = recs.reduce(function (b, r) { return [Math.min(b[0], r.bb[0]), Math.min(b[1], r.bb[1]), Math.max(b[2], r.bb[2]), Math.max(b[3], r.bb[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]);
        var shpLen = 100 + recs.reduce(function (s, r) { return s + 8 + r.len; }, 0), shxLen = 100 + 8 * recs.length, type = kind === 'point' ? 1 : kind === 'line' ? 3 : 5;
        var shp = new DataView(new ArrayBuffer(shpLen)), shx = new DataView(new ArrayBuffer(shxLen)), o = 100;
        [[shp, shpLen], [shx, shxLen]].forEach(function (h) {
            h[0].setInt32(0, 9994, false); h[0].setInt32(24, h[1] / 2, false); h[0].setInt32(28, 1000, true); h[0].setInt32(32, type, true);
            for (var k = 0; k < 4; k++) h[0].setFloat64(36 + 8 * k, all[k], true);
        });
        recs.forEach(function (r, i) {
            shx.setInt32(100 + 8 * i, o / 2, false); shx.setInt32(104 + 8 * i, r.len / 2, false);
            shp.setInt32(o, i + 1, false); shp.setInt32(o + 4, r.len / 2, false); shp.setInt32(o + 8, type, true);
            if (kind === 'point') { shp.setFloat64(o + 12, r.parts[0][0][0], true); shp.setFloat64(o + 20, r.parts[0][0][1], true); }
            else {
                for (var k = 0; k < 4; k++) shp.setFloat64(o + 12 + 8 * k, r.bb[k], true);
                shp.setInt32(o + 44, r.parts.length, true); shp.setInt32(o + 48, r.n, true);
                var pi = 0, po = o + 52 + 4 * r.parts.length;
                r.parts.forEach(function (rg, j) {
                    shp.setInt32(o + 52 + 4 * j, pi, true);
                    rg.forEach(function (q) { shp.setFloat64(po, q[0], true); shp.setFloat64(po + 8, q[1], true); po += 16; });
                    pi += rg.length;
                });
            }
            o += 8 + r.len;
        });
        // атрибуты: все свойства объектов группы, имена полей — до 10 латинских символов
        var keys = [], used = {}, seq = 0;
        feats.forEach(function (f) { Object.keys(f.properties).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
        var defs = keys.map(function (k) {
            var nm = DBF_NAMES[k] || dbfName(k); while (used[nm]) nm = nm.slice(0, 7) + '_' + (++seq); used[nm] = 1;
            var bytes = feats.map(function (f) { return cp1251(f.properties[k]).slice(0, 254); });
            return { key: k, name: nm, bytes: bytes, len: Math.max(1, bytes.reduce(function (m, b) { return Math.max(m, b.length); }, 1)) };
        });
        var recLen = 1 + defs.reduce(function (s, d) { return s + d.len; }, 0), hdrLen = 33 + 32 * defs.length, now = new Date();
        var dbf = new Uint8Array(hdrLen + recLen * feats.length + 1), dd = new DataView(dbf.buffer);
        dbf[0] = 3; dbf[1] = now.getFullYear() - 1900; dbf[2] = now.getMonth() + 1; dbf[3] = now.getDate();
        dd.setUint32(4, feats.length, true); dd.setUint16(8, hdrLen, true); dd.setUint16(10, recLen, true); dbf[29] = 0xC9;   // 0xC9 — Russian Windows ANSI (CP1251)
        defs.forEach(function (d, i) { var q = 32 + 32 * i; for (var k = 0; k < d.name.length; k++) dbf[q + k] = d.name.charCodeAt(k); dbf[q + 11] = 67; dbf[q + 16] = d.len; });
        dbf[32 + 32 * defs.length] = 13;
        feats.forEach(function (f, i) {
            var q = hdrLen + recLen * i; dbf[q++] = 32;
            defs.forEach(function (d) { var b = d.bytes[i], k; for (k = 0; k < d.len; k++) dbf[q + k] = k < b.length ? b[k] : 32; q += d.len; });
        });
        dbf[dbf.length - 1] = 26;
        var enc = new TextEncoder(), prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
        return [{ name: base + '.shp', data: new Uint8Array(shp.buffer) }, { name: base + '.shx', data: new Uint8Array(shx.buffer) }, { name: base + '.dbf', data: dbf },
            { name: base + '.prj', data: enc.encode(prj) }, { name: base + '.cpg', data: enc.encode('CP1251') }];
    }
    function shpBlob(fc, base) {
        var G = { poly: [], line: [], point: [] };
        fc.features.forEach(function (f) { var t = f.geometry.type; if (t === 'Polygon' || t === 'MultiPolygon') G.poly.push(f); else if (t === 'LineString' || t === 'MultiLineString') G.line.push(f); else if (t === 'Point') G.point.push(f); });
        var kinds = Object.keys(G).filter(function (k) { return G[k].length; }), files = [];
        kinds.forEach(function (k) { files = files.concat(shpGroup(G[k], k, kinds.length > 1 ? base + '_' + { poly: 'polygons', line: 'lines', point: 'points' }[k] : base)); });
        return files.length ? snZip(files) : null;
    }
    // --- DXF (AutoCAD R12, ASCII): координаты в метрах (UTM WGS84 по центру выбранных объектов), слой на каждый тип объекта, подпись — номер ---
    function utm(lon, lat, zn) {
        var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), rad = Math.PI / 180, e4 = e2 * e2, e6 = e4 * e2;
        var phi = lat * rad, lam = (lon - ((zn - 1) * 6 - 180 + 3)) * rad, sn = Math.sin(phi), cs = Math.cos(phi), tn = Math.tan(phi);
        var N = a / Math.sqrt(1 - e2 * sn * sn), T = tn * tn, C = ep2 * cs * cs, A = lam * cs;
        var M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
        var x = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
        var y = k0 * (M + N * tn * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
        return [x, lat < 0 ? y + 10000000 : y];
    }
    var dxfTx = function (s) { return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, function (ch) { return '\\U+' + ('0000' + ch.charCodeAt(0).toString(16).toUpperCase()).slice(-4); }); };
    function dxfText(list) {
        var items = list.filter(function (it) { return it.f && it.f.geometry && it.f.geometry.coordinates; }), lo = 1e9, hi = -1e9, la = 0, n = 0;
        items.forEach(function (it) { (function w(c) { if (typeof c[0] === 'number') { lo = Math.min(lo, c[0]); hi = Math.max(hi, c[0]); la += c[1]; n++; } else c.forEach(w); })(cv(it.f.geometry.coordinates)); });
        if (!n) return null;
        var zn = Math.min(60, Math.max(1, Math.floor(((lo + hi) / 2 + 180) / 6) + 1)), north = la / n >= 0, pj = function (p) { return utm(p[0], p[1], zn); };
        var layers = {}, order = [], body = [], ACI = [3, 5, 1, 2, 6, 4, 30, 40, 150, 200];
        var add = function () { Array.prototype.forEach.call(arguments, function (v) { body.push(v); }); };
        var lay = function (id) { var nm = 'CAD_' + String(id).replace(/[^A-Za-z0-9_]/g, '_'); if (!layers[nm]) { layers[nm] = ACI[order.length % ACI.length]; order.push(nm); } return nm; };
        var poly = function (pts, L, closed) {
            if (closed && pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
            if (pts.length < 2) return;
            add(0, 'POLYLINE', 8, L, 66, 1, 70, closed ? 1 : 0);
            pts.map(pj).forEach(function (q) { add(0, 'VERTEX', 8, L, 10, q[0].toFixed(3), 20, q[1].toFixed(3), 30, 0); });
            add(0, 'SEQEND', 8, L);
        };
        items.forEach(function (it) {
            var g = it.f.geometry, c = cv(g.coordinates), L = lay(it.c.id), outer = null;
            if (g.type === 'Polygon') { c.forEach(function (r) { poly(r, L, true); }); outer = c[0]; }
            else if (g.type === 'MultiPolygon') { c.forEach(function (pl) { pl.forEach(function (r) { poly(r, L, true); }); }); outer = c[0] && c[0][0]; }
            else if (g.type === 'LineString') { poly(c, L, false); outer = c; }
            else if (g.type === 'MultiLineString') { c.forEach(function (l) { poly(l, L, false); }); outer = c[0]; }
            else if (g.type === 'Point') { var q = pj(c); add(0, 'POINT', 8, L, 10, q[0].toFixed(3), 20, q[1].toFixed(3), 30, 0); outer = [c]; }
            var num = rowsOf(it.f.properties || it.f).num;
            if (num && outer && outer.length) {     // подпись — номер объекта в центре контура
                var q = pj([outer.reduce(function (s, p) { return s + p[0]; }, 0) / outer.length, outer.reduce(function (s, p) { return s + p[1]; }, 0) / outer.length]);
                var xs = outer.map(pj).map(function (p) { return p[0]; }), h = Math.max(1, (Math.max.apply(null, xs) - Math.min.apply(null, xs)) / 25);
                add(0, 'TEXT', 8, L + '_TXT', 10, q[0].toFixed(3), 20, q[1].toFixed(3), 30, 0, 40, h.toFixed(2), 1, dxfTx(num), 72, 1, 11, q[0].toFixed(3), 21, q[1].toFixed(3), 31, 0);
                lay(it.c.id + '_TXT');
            }
        });
        var hd = [999, 'WGS84 / UTM zone ' + zn + (north ? 'N' : 'S') + ', metres', 0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC',
            0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, '0.0', 0, 'ENDTAB',
            0, 'TABLE', 2, 'LAYER', 70, order.length];
        order.forEach(function (nm) { hd.push(0, 'LAYER', 2, nm, 70, 0, 62, layers[nm], 6, 'CONTINUOUS'); });
        hd.push(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
        return hd.concat(body, [0, 'ENDSEC', 0, 'EOF']).join('\r\n') + '\r\n';
    }
    // fmt: 'kml' | 'geojson' | 'shp' | 'dxf'; which — номер объекта в списке выбранных, 'all' или массив объектов
    function exportAs(fmt, which) {
        if (fmt === 'kml') { exportKml(which); return; }
        if (fmt === 'dxf') {
            var dl = listOf(which), dt = dxfText(dl);
            if (!dt) { say('Не удалось собрать геометрию объекта для DXF.'); return; }
            saveFile(new Blob([dt], { type: 'application/dxf' }), baseName(dl) + '.dxf'); return;
        }
        var list = listOf(which), fc = toFC(list, fmt === 'shp');
        if (!fc.features.length) { say('Не удалось собрать геометрию объекта для ' + FMT[fmt] + '.'); return; }
        var base = baseName(list);
        if (fmt === 'geojson') { saveFile(new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' }), base + '.geojson'); return; }
        if (typeof snZip !== 'function') { say('Экспорт SHP недоступен: не найден модуль упаковки ZIP из script.js.'); return; }
        var b = shpBlob(fc, base);
        if (!b) { say('В выбранных объектах нет геометрии, пригодной для Shapefile.'); return; }
        saveFile(b, base + '_shp.zip');
    }
    info.addEventListener('click', function (e) {
        var cp = e.target.closest('.cad-cp'), go = e.target.closest('.cad-go'), kb = e.target.closest('.cad-dli'), tg = e.target.closest('.cad-dl-t'), rm = e.target.closest('.cad-rm');
        if (tg) { var mm = tg.parentNode.querySelector('.cad-dd-m'); mm.hidden = !mm.hidden; tg.classList.toggle('open', !mm.hidden); return; }
        if (kb) { exportAs(kb.getAttribute('data-f') || 'kml', kb.getAttribute('data-i')); return; }
        if (rm) { var left = sel.filter(function (x, k) { return k !== +rm.getAttribute('data-i'); }); if (left.length) select(left); else clearSel(); return; }
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
        items.slice().reverse().forEach(function (it, ri) { bnds[items.length - 1 - ri] = addGeom(it.f.geometry, it.c.rgb, it.c.id === 'q' || it.c.id === 'd' || it.c.id === 'r' || it.c.id === 'k' || it.c.id === 'm'); });   // кварталы рисуются под участками
        showInfo(items.map(function (it, i) { return card(it.c, it.f.properties || it.f, i); }).join('')
            + (items.length > 1 ? '<div class="cad-dlt">Скачать все выбранные (' + items.length + ')</div>' + dlBtns('all', true) : ''));
        $('cadInfoN').textContent = items.length > 1 ? '· ' + items.length : '';
    }
    var keyOf = function (it) { var ro = rowsOf(it.f.properties || it.f); return it.c.id + '|' + (ro.num || it.f.id || JSON.stringify(it.f.geometry || '').length); };
    // ---- правый клик по выделенному объекту: «Скачать KML» и «Анализ участка» ----
    function inRing(pt, ring) {
        var ins = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) ins = !ins;
        }
        return ins;
    }
    function inPoly(pt, rings) {
        if (!rings.length || !inRing(pt, rings[0])) return false;
        for (var k = 1; k < rings.length; k++) if (inRing(pt, rings[k])) return false;
        return true;
    }
    function hitGeom(g, ll) {
        if (!g || !g.coordinates) return false;
        var c = cv(g.coordinates), pt = [ll.lng, ll.lat];
        if (g.type === 'Polygon') return inPoly(pt, c);
        if (g.type === 'MultiPolygon') return c.some(function (p) { return inPoly(pt, p); });
        return false;
    }
    // нулевой кадастровый квартал (номер вида 50:21:0000000) покрывает весь район и мешает выбрать участок — при клике он не выделяется
    var ZERO_Q = /^\d+:\d+:0+$/;
    function isZeroQ(it) {
        try {
            var pr = it.f.properties || it.f;
            if (!(it.c.id === 'q' || detect(pr).id === 'q')) return false;
            if (ZERO_Q.test(String(rowsOf(pr).num).trim())) return true;
            var m = flat(pr && pr.options ? pr.options : pr, {});
            return Object.keys(m).some(function (k) { return /(^|_)(cad_?num|cad_?number|quarter_cad_number|cn)$/i.test(k) && ZERO_Q.test(String(m[k]).trim()); });
        } catch (x) { return false; }
    }
    var ctxHit = null;     // объект под курсором при правом клике
    var ctxSep = document.createElement('div'), ctxKml = document.createElement('div'), ctxGj = document.createElement('div'), ctxShp = document.createElement('div'), ctxAn = document.createElement('div'), ctxDxf = document.createElement('div'), ctxPf = document.createElement('div'), ctxLg = document.createElement('div'), ctxIm = document.createElement('div'), ctxWx = document.createElement('div'), mnu = $('mapContextMenu');
    ctxSep.className = 'ctx-sep'; ctxKml.className = 'ctx-item'; ctxGj.className = 'ctx-item'; ctxShp.className = 'ctx-item'; ctxAn.className = 'ctx-item'; ctxDxf.className = 'ctx-item'; ctxPf.className = 'ctx-item'; ctxLg.className = 'ctx-item'; ctxIm.className = 'ctx-item'; ctxWx.className = 'ctx-item';
    ctxKml.innerHTML = '<i class="fas fa-file-arrow-down"></i> Скачать участок в KML';
    ctxGj.innerHTML = '<i class="fas fa-file-arrow-down"></i> Скачать участок в GeoJSON';
    ctxShp.innerHTML = '<i class="fas fa-file-arrow-down"></i> Скачать участок в SHP';
    ctxDxf.innerHTML = '<i class="fas fa-file-arrow-down"></i> Скачать участок в DXF';
    ctxAn.innerHTML = '<i class="fas fa-magnifying-glass-chart"></i> Анализ участка';
    ctxPf.innerHTML = '<i class="fas fa-mountain"></i> Участок в «Профиль»';
    ctxLg.innerHTML = '<i class="fas fa-route"></i> Участок в «Логистику»';
    ctxIm.innerHTML = '<i class="fas fa-satellite"></i> Участок в «Снимки»';
    ctxWx.innerHTML = '<i class="fas fa-cloud-sun-rain"></i> Участок в «Погоду»';
    ctxKml.innerHTML = '<i class="fas fa-file-arrow-down"></i> KML'; ctxGj.innerHTML = '<i class="fas fa-file-arrow-down"></i> GeoJSON';
    ctxShp.innerHTML = '<i class="fas fa-file-arrow-down"></i> SHP (с атрибутами)'; ctxDxf.innerHTML = '<i class="fas fa-file-arrow-down"></i> DXF';
    ctxPf.innerHTML = '<i class="fas fa-mountain"></i> Профиль'; ctxLg.innerHTML = '<i class="fas fa-route"></i> Логистика';
    ctxIm.innerHTML = '<i class="fas fa-satellite"></i> Снимки'; ctxWx.innerHTML = '<i class="fas fa-cloud-sun-rain"></i> Погода';
    // пункты сгруппированы: «Анализ участка» сверху, остальное — в раскрывающихся группах
    function ctxGroup(icon, label, items) {   // заголовок + вложенный список (группы могут быть вложены друг в друга)
        var hd = document.createElement('div'), sub = document.createElement('div');
        hd.className = 'ctx-item ctx-grp'; hd.innerHTML = '<i class="fas ' + icon + '"></i>&nbsp;' + label + '<i class="fas fa-chevron-right ctx-chev"></i>';
        sub.className = 'ctx-sub'; sub.style.display = 'none'; items.forEach(function (el) { sub.appendChild(el); });
        hd.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = !hd.classList.contains('open');
            Array.prototype.forEach.call(hd.parentNode.children, function (h) { if (h !== hd && h._sub) { h.classList.remove('open'); h._sub.style.display = 'none'; } });
            hd.classList.toggle('open', open); sub.style.display = open ? '' : 'none';
            if (open) {   // подменю выплывает вбок от заголовка; у края экрана — влево/вверх
                sub.style.left = (hd.offsetLeft + hd.offsetWidth - 2) + 'px'; sub.style.top = (hd.offsetTop - 4) + 'px';
                var rr = sub.getBoundingClientRect();
                if (rr.right > window.innerWidth - 4) sub.style.left = (hd.offsetLeft - sub.offsetWidth + 2) + 'px';
                rr = sub.getBoundingClientRect();
                if (rr.bottom > window.innerHeight - 4) sub.style.top = (parseFloat(sub.style.top) - (rr.bottom - window.innerHeight + 4)) + 'px';
            }
        });
        hd._sub = sub; return hd;
    }
    function mkItem(icon, label, bp, title) {
        var el = document.createElement('div'); el.className = 'ctx-item'; el.innerHTML = '<i class="fas ' + icon + '"></i> ' + label;
        el.addEventListener('click', function () { var it = ctxHit; hideCtx(); if (it) toAnalysis(it, bp, title); });
        return el;
    }
    var hdWx = ctxGroup('fa-cloud-sun-rain', 'Погода и климат', [ctxWx, mkItem('fa-chart-line', 'Климат участка', 'climate', 'Климат участка'), mkItem('fa-seedling', 'Тепло и вегетация', 'gdd', 'Тепло и вегетация'), mkItem('fa-snowflake', 'Заморозки', 'frost', 'Заморозки'), mkItem('fa-wind', 'Ветер и окна работ', 'windwork', 'Ветер и окна работ')]);
    var hdSn = ctxGroup('fa-satellite', 'Снимки и индексы', [ctxIm, mkItem('fa-leaf', 'NDVI', 'ndvi', 'NDVI'), mkItem('fa-cloud-rain', 'NDMI', 'ndmi', 'NDMI'), mkItem('fa-wheat-awn', 'NBR', 'nbr', 'NBR'), mkItem('fa-code-compare', 'Сравнение снимков', 'change', 'Сравнение снимков')]);
    var hdTr = ctxGroup('fa-share-from-square', 'Перенести границы в', [ctxPf, ctxLg, mkItem('fa-flask', 'Почвенный анализ', 'chem', 'Почвенный анализ'), mkItem('fa-draw-polygon', 'Границы, форма и кадастр', 'shape', 'Границы, форма и кадастр'), hdWx, hdWx._sub, hdSn, hdSn._sub]);
    var hdDl = ctxGroup('fa-file-arrow-down', 'Скачать границы', [ctxKml, ctxGj, ctxShp, ctxDxf]);
    var ctxAll = [ctxSep, ctxAn, hdTr, hdTr._sub, hdDl, hdDl._sub];
    ctxAll.forEach(function (el) { el.style.display = 'none'; if (mnu) mnu.appendChild(el); });
    function ctxSync() {
        ctxHit = null;
        var ll = (typeof contextMenuLatLng !== 'undefined') ? contextMenuLatLng : null;
        if (ll && sel.length) {
            var hits = sel.filter(function (it) { try { return hitGeom(it.f.geometry, ll); } catch (x) { return false; } });
            var rank = function (it) { return it.c.id === 'z' ? 0 : it.c.id === 'o' ? 1 : it.c.id === 'q' ? 3 : it.c.id === 'd' ? 4 : it.c.id === 'r' ? 5 : it.c.id === 'k' ? 6 : it.c.id === 'm' ? 4 : 2; };
            hits.sort(function (a, b) { return rank(a) - rank(b); });
            ctxHit = hits[0] || null;
        }
        ctxAll.forEach(function (el) { el.style.display = ctxHit && el !== hdTr._sub && el !== hdDl._sub ? '' : 'none'; });
        if (mnu) { Array.prototype.forEach.call(mnu.querySelectorAll('.ctx-grp'), function (h) { h.classList.remove('open'); }); Array.prototype.forEach.call(mnu.querySelectorAll('.ctx-sub'), function (x) { x.style.display = 'none'; }); }
    }
    if (mnu && typeof window.showMapContextMenu === 'function') {
        var osm = window.showMapContextMenu;
        window.showMapContextMenu = function () { try { ctxSync(); } catch (x) { /* меню покажется без кадастровых пунктов */ } return osm.apply(this, arguments); };
    }
    var hideCtx = function () { if (typeof hideMapContextMenu === 'function') hideMapContextMenu(); };
    ctxKml.addEventListener('click', function () { var it = ctxHit; hideCtx(); if (it) exportKml([it]); });
    ctxGj.addEventListener('click', function () { var it = ctxHit; hideCtx(); if (it) exportAs('geojson', [it]); });
    ctxShp.addEventListener('click', function () { var it = ctxHit; hideCtx(); if (it) exportAs('shp', [it]); });
    ctxDxf.addEventListener('click', function () { var it = ctxHit; hideCtx(); if (it) exportAs('dxf', [it]); });
    // перенос границ в раздел «Анализ участка»: так же, как при загрузке контура из файла
    function toAnalysis(it, bp, title) {   // bp — вкладка нижней панели (profile / logistics / dates / weather); без неё — «Анализ участка»
        try {
            var ro = rowsOf(it.f.properties || it.f), g = it.f.geometry;
            var cn = g.type === 'MultiPolygon' ? g.coordinates.length : (g.type === 'Polygon' ? 1 : 0), isMulti = cn > 1;   // многоконтурность: число отдельных контуров участка
            var mcRow = cn ? [['Многоконтурный участок', isMulti ? 'Да, контуров: ' + cn : 'Нет, один контур']] : [];
            var gj = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cad_number: it.src ? '' : ro.num, name: ro.num, source: it.src || 'НСПД', contours: cn, multi_contour: isMulti, attrs: mcRow.concat(ro.list, ro.more) }, geometry: { type: g.type, coordinates: cv(g.coordinates) } }] };
            if (bp) {   // как загрузка файла в разделе: gcShapeIO[...].put ставит фигуру и запускает расчёт раздела
                var KEY = { profile: 'hy', logistics: 'lg', chem: 'ch', weather: 'wx', climate: 'wx', gdd: 'wx', frost: 'wx', windwork: 'wx', dates: 'sn', ndvi: 'sn', ndmi: 'sn', nbr: 'sn', change: 'sn', shape: 'shp' }[bp];
                var io = typeof gcShapeIO !== 'undefined' ? gcShapeIO[KEY] : null;
                if (!io || !io.put) { say('Раздел «' + title + '» недоступен для переноса.'); return; }
                var tb0 = document.querySelector('.bp-tab[data-bp-tab="' + bp + '"]'); if (tb0) tb0.click();
                clearSel();
                setTimeout(function () {
                    io.put(gj, null);
                    var go = function (sel, ms) { setTimeout(function () { var b = document.querySelector(sel); if (b && !b.classList.contains('on')) b.click(); }, ms); };   // кнопка запуска, если раздел не стартует сам
                    if (bp === 'logistics') go('#lgBuffer', 0);
                    else if (bp === 'chem') go('[data-bp-pane="chem"] [data-ch-act="calc"]', 300);
                    else if (bp === 'change') go('[data-bp-pane="change"] [data-sn-act="cmp"]', 250);
                    if (typeof updateStatus === 'function') updateStatus('📥 Границы ' + (it.from || 'участка ' + (ro.num || '') + ' из НСПД') + ' перенесены в «' + title + '».');
                }, 120);
                return;
            }
            if (typeof objectLabels !== 'undefined') { objectLabels.forEach(function (l) { if (map.hasLayer(l)) map.removeLayer(l); }); objectLabels = []; }
            drawnItems.clearLayers();
            if (typeof disableEditForAll === 'function') disableEditForAll();
            var grp = L.geoJSON(gj, { style: typeof SHAPE_STYLE !== 'undefined' ? SHAPE_STYLE : undefined });
            grp.eachLayer(function (l) { if (ro.num) l._gcName = ro.num; drawnItems.addLayer(l); });
            map.fitBounds(grp.getBounds(), { maxZoom: 18, padding: [40, 40] });
            if (typeof updateAllLabels === 'function') updateAllLabels();
            if (typeof updateObjectList === 'function') updateObjectList();
            clearSel();
            var tb = bp ? document.querySelector('.bp-tab[data-bp-tab="' + bp + '"]') : document.querySelector('.panel-tab[data-tab="analysis"]'); if (tb) tb.click();
            if (typeof updateStatus === 'function') updateStatus('📥 Границы ' + (it.from || 'участка ' + (ro.num || '') + ' из НСПД') + ' перенесены в «' + (title || 'Анализ участка') + '».' + (bp ? '' : ' Выберите дату снимка и запустите анализ.'));
        } catch (x) { say('Не удалось перенести границы в анализ: ' + x.message); }
    }
    ctxAn.addEventListener('click', function () { var it = ctxHit; hideCtx(); if (it) toAnalysis(it); });
    [[ctxPf, 'profile', 'Профиль'], [ctxLg, 'logistics', 'Логистика'], [ctxIm, 'dates', 'Снимки'], [ctxWx, 'weather', 'Погода']].forEach(function (a) {
        a[0].addEventListener('click', function () { var it = ctxHit; hideCtx(); if (it) toAnalysis(it, a[1], a[2]); });
    });

    // общий вход для меню правой кнопки других инструментов (например «Рисование»): те же форматы скачивания и те же разделы переноса границ, что у участков НСПД
    window.gcShapeMenuApi = {
        formats: [{ id: 'kml', label: 'KML' }, { id: 'geojson', label: 'GeoJSON' }, { id: 'shp', label: 'SHP (с атрибутами)' }, { id: 'dxf', label: 'DXF' }],
        targets: [
            { icon: 'fa-mountain', label: 'Профиль', bp: 'profile' },
            { icon: 'fa-route', label: 'Логистика', bp: 'logistics' },
            { icon: 'fa-flask', label: 'Почвенный анализ', bp: 'chem' },
            { icon: 'fa-draw-polygon', label: 'Границы, форма и кадастр', bp: 'shape' },
            { icon: 'fa-cloud-sun-rain', label: 'Погода и климат', sub: [
                { icon: 'fa-cloud-sun-rain', label: 'Погода', bp: 'weather' }, { icon: 'fa-chart-line', label: 'Климат участка', bp: 'climate' },
                { icon: 'fa-seedling', label: 'Тепло и вегетация', bp: 'gdd' }, { icon: 'fa-snowflake', label: 'Заморозки', bp: 'frost' },
                { icon: 'fa-wind', label: 'Ветер и окна работ', bp: 'windwork' }] },
            { icon: 'fa-satellite', label: 'Снимки и индексы', sub: [
                { icon: 'fa-satellite', label: 'Снимки', bp: 'dates' }, { icon: 'fa-leaf', label: 'NDVI', bp: 'ndvi' }, { icon: 'fa-cloud-rain', label: 'NDMI', bp: 'ndmi' },
                { icon: 'fa-wheat-awn', label: 'NBR', bp: 'nbr' }, { icon: 'fa-code-compare', label: 'Сравнение снимков', bp: 'change' }] }
        ],
        exportAs: exportAs,
        toAnalysis: toAnalysis
    };

    function feats(t) {
        try { var j = JSON.parse(t); return { f: j.features || (j.data && j.data.features) || (j.data && j.data.type === 'Feature' ? [j.data] : []), raw: '' }; }
        catch (e) { return { f: [], raw: String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }; }
    }
    var okText = function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
    var busy = function () { return (typeof currentTool !== 'undefined' && currentTool) || (typeof activeDrawHandler !== 'undefined' && activeDrawHandler); };
    var fiCache = {};      // ответы GetFeatureInfo в памяти (на диске их хранит прокси)

    function cadClick(e) {
        var z = map.getZoom(), act = active().filter(function (c) { return live[c.id] && map.hasLayer(live[c.id]) && z >= c.minZoom; });
        if (!act.length || busy()) return;
        var oe = e.originalEvent, multi = !!(oe && (oe.ctrlKey || oe.metaKey)), my = multi ? reqN : ++reqN;   // Ctrl+клик — добавить объект к выбранным (повторный — убрать)
        if (multi) statusEl.innerHTML = '<span class="cad-ld"><i></i><i></i><i></i></span>Запрос в НСПД';
        else {
            hl.clearLayers(); bnds = []; sel = [];
            showInfo('<div class="cad-wait"><span class="cad-ld"><i></i><i></i><i></i></span>Запрос в НСПД</div>');
        }
        // точка привязывается к пикселю карты — повторные клики рядом берут ответ из кэша
        var m = L.CRS.EPSG3857.project(e.latlng), res = 40075016.68 / (256 * Math.pow(2, z));
        var cx = (Math.floor(m.x / res) + 0.5) * res, cy = (Math.floor(m.y / res) + 0.5) * res, r = res * 50.5;
        var bb = [cx - r, cy - r, cx + r, cy + r].map(r3).join(',');
        Promise.all(act.map(function (c) {
            var n = nid(c), u = base(n) + '?REQUEST=GetFeatureInfo&SERVICE=WMS&VERSION=1.3.0&FORMAT=image/png&STYLES=&TRANSPARENT=true&LAYERS=' + n + '&QUERY_LAYERS=' + n + '&CRS=EPSG:3857&BBOX=' + bb + '&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=application/json&FEATURE_COUNT=5';
            var p = fiCache[u] ? Promise.resolve(fiCache[u]) : fetch(viaProxy(u)).then(okText).then(function (t) { fiCache[u] = t; return t; });
            return p.then(function (t) { return { c: c, p: feats(t) }; }).catch(function () { return { c: c, err: true }; });
        })).then(function (res2) {
            if (!multi && my !== reqN) return;      // пришёл ответ на устаревший клик
            var items = [], errn = 0, raw = '', zeroN = 0;
            res2.forEach(function (x) {
                if (x.err) { errn++; return; }
                x.p.f.filter(function (f) { if (isZeroQ({ c: x.c, f: f })) { zeroN++; return false; } return true; }).slice(0, 2).forEach(function (f) { items.push({ c: x.c, f: f }); });
                if (!x.p.f.length && x.p.raw) raw = x.p.raw;
            });
            items.sort(function (a, b) { return LAYERS.indexOf(b.c) - LAYERS.indexOf(a.c); });
            if (multi) {
                var add = items.filter(function (it) { return !/^[qdrkm]$/.test(it.c.id); });
                if (!add.length) add = items;          // кварталы добавляются, только если в точке нет ничего другого
                if (!add.length) { say(errn === res2.length ? 'НСПД не ответил. Проверьте интернет и доступ к НСПД.' : zeroN ? 'В этой точке только нулевой кадастровый квартал — он не выделяется.' : 'В этой точке объектов нет.'); return; }
                var have = sel.map(keyOf), fresh = add.filter(function (it) { return have.indexOf(keyOf(it)) < 0; });
                if (fresh.length) select(sel.concat(fresh));
                else { var ks = add.map(keyOf), left2 = sel.filter(function (it) { return ks.indexOf(keyOf(it)) < 0; }); if (left2.length) select(left2); else clearSel(); }
                hint();
                return;
            }
            if (items.length) { select(items); return; }
            showInfo('<div class="cad-wait">' + (errn === res2.length ? 'НСПД не ответил. Проверьте интернет и доступ к НСПД.' : raw ? esc(raw.slice(0, 300)) : zeroN ? 'В этой точке только нулевой кадастровый квартал — он не выделяется.' : 'В этой точке объектов нет.') + '</div>');
        });
    }
    // выбор работает на любой вкладке; раздел «Кадастр» открывается в showInfo
    map.on('click', function (e) { if (e.originalEvent) e.originalEvent._cadSeen = 1; cadClick(e); });
    // фигуры других разделов (участок, буфер…) не пропускают клик до карты — берём такой клик напрямую
    var cadDn = null, mapBox = map.getContainer();
    mapBox.addEventListener('mousedown', function (ev) { cadDn = [ev.clientX, ev.clientY]; }, true);
    mapBox.addEventListener('click', function (ev) {
        if (ev._cadSeen || !cadDn || Math.abs(ev.clientX - cadDn[0]) > 4 || Math.abs(ev.clientY - cadDn[1]) > 4) return;
        var t = ev.target; if (!(typeof SVGElement !== 'undefined' && t instanceof SVGElement) || !t.closest || t.closest('.leaflet-control,.leaflet-popup,.map-context-menu')) return;
        cadClick({ latlng: map.mouseEventToLatLng(ev), originalEvent: ev });
    });

    // ---- пересечения контура с участками слоя «Земельные участки из ЕГРН» НСПД (для паспорта участка) ----
    // GetFeatureInfo опрашивается по сетке точек внутри контура и по его границе; точки, уже попавшие в найденный участок, пропускаются
    window.gcCadIntersect = function (gj, o) {
        o = o || {};
        return proxyP.then(function (ok) {
            if (!ok) throw new Error(NOPROXY);
            var n = nid(byId(o.layer || 'z')), g = gj && (gj.geometry || gj), polys = g ? (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) : [];
            if (!polys.length || typeof turf === 'undefined') return { items: [], req: 0, bad: 0, step: 0 };
            var tp = polys.map(function (p) { return turf.polygon(p); }), bb = turf.bbox({ type: 'Feature', geometry: g, properties: {} });
            var ky = 110574, kx = 111320 * Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180);
            var inside = function (p, arr) { var pt = turf.point(p); return arr.some(function (t) { return turf.booleanPointInPolygon(pt, t); }); };
            var gen = function (s) {
                var out = [], x, y;
                for (y = bb[1] + s / ky / 2; y < bb[3]; y += s / ky) for (x = bb[0] + s / kx / 2; x < bb[2]; x += s / kx) if (inside([x, y], tp)) out.push([x, y]);
                polys.forEach(function (pl) { pl.forEach(function (r) { for (var i = 0; i < r.length - 1; i++) { var a = r[i], b = r[i + 1], k = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) / s)); for (var j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); } }); });
                return out;
            };
            var MAXR = o.max || 240, s = Math.max(30, Math.sqrt((bb[2] - bb[0]) * kx * (bb[3] - bb[1]) * ky / 150)), pts = gen(s), guard = 0;
            while (pts.length > MAXR && guard++ < 12) { s *= 1.25; pts = gen(s); }
            var res = 40075016.68 / (256 * Math.pow(2, 18)), found = [], keys = {}, bad = 0, done = 0, asked = 0, total = pts.length, queue = pts.slice();
            var take = function (f) {
                var gm = f && f.geometry; if (!gm || !gm.coordinates || !/Polygon/.test(gm.type)) return;
                var pr = f.properties || f, ro = rowsOf(pr), m = flat(pr && pr.options ? pr.options : pr, {}), key = ro.num || JSON.stringify(gm.coordinates).slice(0, 60);
                if (keys[key]) return; keys[key] = 1;
                var fld = function (lb) { var fl = FIELDS.filter(function (x) { return x[0] === lb; })[0]; for (var i = 0; fl && i < fl[1].length; i++) { var v = m[fl[1][i]]; if (v != null && v !== '') return String(v); } return ''; };
                var ar = parseFloat(fld('Площадь').replace(',', '.').replace(/\s/g, '')), rights = [], seenR = {};
                Object.keys(m).forEach(function (k) { var v = m[k]; if (/ownership|right|owner|собствен/i.test(k) && typeof v !== 'object' && v !== '' && !/^\d+$/.test(String(v))) { v = fmt('s', v); if (!seenR[v]) { seenR[v] = 1; rights.push([labelRu(k), v]); } } });
                var cg = { type: gm.type, coordinates: cv(gm.coordinates) };
                found.push({ f: f, num: ro.num, geometry: cg, area: isFinite(ar) ? ar : null, use: fld('Разрешённое использование'), cat: fld('Категория земель'), kind: fld('Вид объекта'), name: fld('Наименование'), zone: fld('Вид зоны'), stat: fld('Статус'), own: fld('Форма собственности'), rights: rights, list: ro.list, more: ro.more, _tp: (cg.type === 'Polygon' ? [cg.coordinates] : cg.coordinates).map(function (p) { return turf.polygon(p); }) });
            };
            var one = function (p) {
                var m = L.CRS.EPSG3857.project(L.latLng(p[1], p[0])), cx = (Math.floor(m.x / res) + 0.5) * res, cy = (Math.floor(m.y / res) + 0.5) * res, r = res * 50.5, bx = [cx - r, cy - r, cx + r, cy + r].map(r3).join(',');
                var u = base(n) + '?REQUEST=GetFeatureInfo&SERVICE=WMS&VERSION=1.3.0&FORMAT=image/png&STYLES=&TRANSPARENT=true&LAYERS=' + n + '&QUERY_LAYERS=' + n + '&CRS=EPSG:3857&BBOX=' + bx + '&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=application/json&FEATURE_COUNT=5';
                var pr = fiCache[u] ? Promise.resolve(fiCache[u]) : fetch(viaProxy(u)).then(okText).then(function (t) { fiCache[u] = t; return t; });
                return pr.then(function (t) { feats(t).f.forEach(take); }).catch(function () { bad++; });
            };
            var step = function () {
                if (o.alive && !o.alive()) return;
                var batch = [], p;
                while (queue.length && batch.length < 8) { p = queue.shift(); if (found.some(function (it) { return inside(p, it._tp); })) { done++; continue; } batch.push(p); }
                if (!batch.length) return;
                asked += batch.length;
                return Promise.all(batch.map(one)).then(function () { done += batch.length; if (o.onProgress) o.onProgress(done, total); return step(); });
            };
            return Promise.resolve(step()).then(function () {
                if (asked && bad === asked) throw new Error('НСПД не ответил (проверьте интернет и доступ к НСПД)');
                return { items: found, req: asked, bad: bad, step: Math.round(s) };
            });
        });
    };

    // выгрузка найденных участков целиком (контуры и атрибуты) в тех же форматах, что и из кадастрового слоя на карте: kml | geojson | shp | dxf
    window.gcCadExport = function (fmt, items, layer) { exportAs(fmt, (items || []).map(function (it) { return { c: byId(layer || 'z'), f: it.f }; })); };

    // ---- поиск по кадастровому номеру: вызывается из основной строки поиска сайта (участок, здание, квартал); слой при этом может быть выключен ----
    var CADRE = /^\d{1,2}:\d{1,2}(:\d{1,8}){0,2}$/;
    window.gcCadIsNumber = function (q) { return CADRE.test(String(q || '').trim()); };
    window.gcCadSearch = function (q) {
        q = String(q || '').trim();
        var tell = function (t) { say(t); if (typeof updateStatus === 'function') updateStatus(t); };
        var parts = q.split(':').length;
        // сначала тот раздел поиска, где номер такого вида ожидаем: участок/здание — объекты (1), квартал/район — кадастровое деление (2); остальные — на всякий случай
        var themes = parts >= 4 ? [1, 2, 3, 4, 5] : [2, 1, 3, 4, 5];
        tell('Поиск в НСПД…');
        var norm = function (v) { return String(v || '').replace(/\s+/g, '').split(':').map(function (x) { return x.replace(/^0+(?=\d)/, ''); }).join(':'); };
        var layerFor = function (pr) { return parts === 3 ? byId('q') : parts === 2 ? byId('d') : detect(pr); };
        return new Promise(function (done) {
            var partial = null;      // запасной вариант: частичное совпадение, если точного нет
            (function next(i) {
                if (i >= themes.length) {
                    if (partial) return show(partial.f, partial.n);
                    tell('Ничего не найдено в НСПД по запросу «' + q + '».'); done(false); return;
                }
                fetch(viaProxy('https://nspd.gov.ru/api/geoportal/v2/search/geoportal?thematicSearchId=' + themes[i] + '&query=' + encodeURIComponent(q))).then(okText).then(function (t) {
                    var f = feats(t).f;
                    if (!f.length) return next(i + 1);
                    var exact = f.filter(function (x) { var ro = rowsOf(x.properties || x); return ro.num && norm(ro.num) === norm(q); })[0];
                    if (exact) return show(exact, f.length);
                    if (!partial) partial = { f: f[0], n: f.length };
                    next(i + 1);
                }).catch(function () { next(i + 1); });
            })(0);
            function show(feat, n) {
                reqN++;
                var c = layerFor(feat.properties || feat);
                if (!st.on[c.id]) {      // слой найденного типа включается сам, чтобы объект был виден на карте
                    var chk = tree.querySelector('input[data-id="' + c.id + '"]'); if (chk) chk.checked = true;
                    setLayer(c, true);
                }
                select([{ c: c, f: feat }]);      // открывает раздел «Кадастр» в боковой панели
                tell('Найдено в НСПД: ' + c.name.toLowerCase() + (n > 1 ? ' (совпадений: ' + n + ', показано лучшее)' : '') + '.');
                var bd = bnds[0];
                if (bd && bd.isValid()) map.fitBounds(bd, { maxZoom: 18, padding: [40, 40] });
                done(true);
            }
        });
    };

    renderTree(); hint();
})();

/* Почвы: векторная почвенная карта (soil.geojson) через serve_site.py (/soilgeo) — полигоны по границам экрана, цвет по коду почвы (SOIL0).
   Необязательный файл soil_codes.json вида {"307": "Название почвы", ...} добавляет расшифровку кодов в попапе. */
(function () {
    'use strict';
    var chip = document.querySelector('.ovl-chip[data-soil]');
    if (!chip || typeof map === 'undefined') return;
    var lastF = null, MINZ = 6, names = {}, on = false, timer = null, ctl = null, retry = null;
    var tg = document.getElementById('soilToggle'), op = document.getElementById('soilOp'), st = document.getElementById('soilStatus'), fo = 0.5;
    var say = function (t) { if (st) st.textContent = t; if (typeof updateStatus === 'function') updateStatus(t); };
    fetch('soil_codes.json').then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { names = j || {}; if (cur) cur.setStyle(opts.style); renderLegend(lastF); }).catch(function () { /* файла нет — показываем коды */ });
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var nm = function (c) { var d = names[c]; return c === undefined ? '' : (d ? esc(d.n) + (d.s ? ' <span style="color:#94a3b8">(' + esc(d.s) + ')</span>' : '') : 'код ' + c); };
    var ZH = [['тундр', 190, 'Тундры'], ['тайги', 140, 'Тайга и хвойно-широколиственные леса'], ['широколиствен', 100, 'Широколиственные леса и лесостепи'], ['сухих степей', 35, 'Сухие степи и полупустыни'], ['степей', 55, 'Степи'], ['субтропик', 15, 'Субтропики'], ['Гидроморф', 220, 'Гидроморфные почвы'], ['Засолен', 300, 'Засоленные и солонцеватые почвы'], ['Пойменн', 170, 'Пойменные и маршевые почвы'], ['горных', 270, 'Горные территории'], ['Комплексы', 335, 'Комплексы почв (мерзлотные, полупустынные)']];
    var zoneOf = function (c) { var d = names[c], z = d && d.z; if (!z) return -1; for (var i = 0; i < ZH.length; i++) if (z.indexOf(ZH[i][0]) >= 0) return i; return ZH.length; };
    // цвет: оттенок по почвенной зоне, светлота по коду; без расшифровки — по коду
    var col = function (c) {
        var d = names[c], h = null, z = d && d.z;
        if (z) { for (var i = 0; i < ZH.length; i++) if (z.indexOf(ZH[i][0]) >= 0) { h = ZH[i][1]; break; } if (h === null) return c === 307 ? '#60a5fa' : '#9ca3af'; return 'hsl(' + h + ',55%,' + (38 + (c * 13) % 26) + '%)'; }
        return 'hsl(' + ((c * 47) % 360) + ',55%,52%)';
    };
    // ---- легенда в панели: зоны всегда, а почвы — только те, что видны в текущем окне ----
    var lg = document.getElementById('soilLegend');
    var row = function (c, t) { return '<div class="cad-lr"><i style="background:' + c + '"></i><span>' + t + '</span></div>'; };
    function renderLegend(feats) {
        if (!lg) return;
        var html = '<div style="font-size:11px;color:#64748b;margin-bottom:3px">Цвет — почвенная зона</div>' + ZH.map(function (z) { return row('hsl(' + z[1] + ',55%,50%)', z[2]); }).join('') + row('#60a5fa', 'Вода') + row('#9ca3af', 'Прочие непочвенные образования');
        if (feats && feats.length) {
            var seen = {}, groups = {};
            feats.forEach(function (f) { var c = f.properties.SOIL0; if (c === undefined || seen[c] || !names[c]) return; seen[c] = 1; (groups[zoneOf(c)] = groups[zoneOf(c)] || []).push(c); });
            var keys = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
            if (keys.length) html += '<div style="font-size:11px;color:#64748b;margin:8px 0 3px">В текущем окне карты</div>' + keys.map(function (k) {
                return '<details><summary style="cursor:pointer;font-size:12px">' + (k >= 0 && k < ZH.length ? ZH[k][2] : 'Прочее') + ' (' + groups[k].length + ')</summary>' + groups[k].sort(function (a, b) { return names[a].n < names[b].n ? -1 : 1; }).map(function (c) { return row(col(c), esc(names[c].n)); }).join('') + '</details>';
            }).join('');
        }
        lg.innerHTML = html;
    }
    var cur = null, loaded = null, reqN = 0;
    // почвы рисуются в слое плиток (tilePane) со своим z-index 300: выше подложки, ниже плиток кадастра (z-index 450+); так порядок слоёв не ломается
    var rend = L.canvas({ padding: 0.3, pane: 'tilePane' });
    var opts = {
        renderer: rend,
        style: function (f) { var c = f.properties.SOIL0; return { color: '#4b5563', weight: 0.5, fillColor: c === undefined ? '#9ca3af' : col(c), fillOpacity: fo }; },
        onEachFeature: function (f, l) {
            l.on('click', function (e) {
                var p = f.properties, d0 = names[p.SOIL0], zi = zoneOf(p.SOIL0), rows = [['Почва', d0 ? esc(d0.n) : 'нет расшифровки']];
                if (zi >= 0 && zi < ZH.length) rows.push(['Зона', ZH[zi][2]]);
                var more = ['SOIL1', 'SOIL2', 'SOIL3'].map(function (k) { return names[p[k]] ? esc(names[p[k]].n) : ''; }).filter(Boolean);
                if (more.length) rows.push(['Также', more.join('<br>')]);
                L.popup({ maxWidth: 320 }).setLatLng(e.latlng).setContent('<b>Почвенная карта</b><table style="font-size:12px">' + rows.map(function (r) { return '<tr><td style="color:#64748b;padding-right:8px;vertical-align:top">' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>').openOn(map);
            });
        }
    };
    var inside = function (o, i) { return o[0] <= i[0] && o[1] <= i[1] && o[2] >= i[2] && o[3] >= i[3]; };
    // слой меняется целиком за один такт (новый добавляется, старый снимается) — без «мигания»; пока ответ не пришёл, старые контуры остаются
    function load(force) {
        if (!on) return;
        var z = map.getZoom();
        if (z < MINZ) { if (cur) { map.removeLayer(cur); cur = null; } loaded = null; say('Почвы: приблизьте карту (с масштаба z' + MINZ + ', сейчас z' + z + ')'); return; }
        var b = map.getBounds(), v = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        if (!force && loaded && loaded.z === z && inside(loaded.box, v)) return;     // при небольшом сдвиге карты данные уже есть
        var dx = (v[2] - v[0]) * 0.4, dy = (v[3] - v[1]) * 0.4, box = [v[0] - dx, v[1] - dy, v[2] + dx, v[3] + dy], my = ++reqN;
        if (ctl) ctl.abort();
        ctl = window.AbortController ? new AbortController() : null;
        fetch('/soilgeo?bbox=' + box.map(function (x) { return x.toFixed(3); }).join(',') + '&z=' + z, ctl ? { signal: ctl.signal } : {})
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (j) {
                if (!on || my !== reqN) return;
                if (j.loading !== undefined || j.error) {
                    if (j.error) { say('Почвы: ' + j.error); setOn(false); return; }
                    say('Почвы: сервер читает soil.geojson, подождите…'); clearTimeout(retry); retry = setTimeout(function () { load(true); }, 3000); return;
                }
                var nl = L.geoJSON(j.features, opts).addTo(map);
                if (rend._container) rend._container.style.zIndex = 300;
                if (cur) map.removeLayer(cur);
                cur = nl; loaded = { box: box, z: z }; lastF = j.features; renderLegend(lastF);
                say(j.truncated ? 'Почвы: показана часть контуров — приблизьте карту' : 'Почвы: клик по контуру — сведения о почве');
            })
            .catch(function (e) { if (e && e.name !== 'AbortError') say('Почвы: нет ответа сервера. Запустите python serve_site.py и откройте http://localhost:8000'); });
    }
    map.on('moveend', function () { clearTimeout(timer); timer = setTimeout(load, 400); });
    function setOn(v) {
        on = v; chip.classList.toggle('active', on); if (tg) tg.checked = on;
        if (on) { load(true); } else { reqN++; if (ctl) ctl.abort(); clearTimeout(retry); if (cur) map.removeLayer(cur); cur = null; loaded = null; lastF = null; renderLegend(null); }
    }
    chip.addEventListener('click', function (e) {
        e.stopPropagation(); setOn(!on);
        if (on) { var rail = document.querySelector('#gcRail [data-rail="layers"]'); if (rail) rail.click(); setTimeout(function () { var t = document.querySelector('.sp-tile[data-bp="soil"]'); if (t) t.click(); }, 40); }
    });
    renderLegend(null);
    if (tg) tg.addEventListener('change', function () { setOn(tg.checked); });
    if (op) op.addEventListener('input', function () { fo = op.value / 100; if (cur) cur.setStyle({ fillOpacity: fo }); });
})();

/* Виджет «Слои» на карте (под подложками): кадастровые слои и «Свои слои». Включение слоя открывает его панель. */
(function () {
    'use strict';
    var btn = document.getElementById('layersWidgetBtn'), panel = document.getElementById('layersWidgetPanel'), tree = document.getElementById('cadTree');
    if (!btn || !panel) return;
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (typeof togglePanel === 'function') togglePanel('layersWidgetPanel', 'layersWidgetBtn'); });
    function closeWidget() { panel.classList.remove('active'); btn.classList.remove('active'); try { activePanel = null; } catch (x) { /* не критично */ } }
    function openSection(bp) {   // как плитка в левом меню «Слои»: открывает боковую панель раздела
        var rail = document.querySelector('#gcRail [data-rail="layers"]'); if (rail) rail.click();
        setTimeout(function () { var t = document.querySelector('.sp-tile[data-bp="' + bp + '"]'); if (t) t.click(); }, 40);
    }
    function cb(id) { return tree ? tree.querySelector('input[data-id="' + id + '"]') : null; }
    function sync() { panel.querySelectorAll('[data-cad]').forEach(function (c) { var i = cb(c.getAttribute('data-cad')); c.classList.toggle('active', !!(i && i.checked)); }); }
    panel.addEventListener('click', function (e) {
        var c = e.target.closest && e.target.closest('.ovl-chip'); if (!c) return;
        e.stopPropagation();
        if (c.hasAttribute('data-cad')) {
            var i = cb(c.getAttribute('data-cad')); if (!i) return;
            i.click();
            if (i.checked) { closeWidget(); openSection('cadastre'); }
            sync();
        } else if (c.hasAttribute('data-open')) { closeWidget(); openSection(c.getAttribute('data-open')); }
    });
    if (tree) {
        tree.addEventListener('change', function (e) { sync(); if (e.target && e.target.checked) openSection('cadastre'); });
        if (window.MutationObserver) new MutationObserver(sync).observe(tree, { childList: true, subtree: true });
    }
    sync();
})();

/* Обучающий курс: кнопка на карте показывает всплывающие подсказки по элементам одну за одной (Далее / Назад / Esc). */
(function () {
    'use strict';
    var vis = gcUx.vis, bubblePlace = gcUx.bubblePlace;
    var btn = document.getElementById('tourBtn'), app = document.querySelector('#map-section .app-container');
    if (!btn || !app) return;
    var STEPS = [
        { s: '#searchInput', p: 'r', t: 'Поиск', d: 'Введите адрес, город или координаты — карта переместится туда. Здесь же можно найти кадастровый номер.' },
        { s: '#gcRail [data-rail="analysis"]', p: 'r', t: 'Анализ', d: 'Загрузите контур или нарисуйте участок — получите паспорт: рельеф, почва, климат, логистика.' },
        { s: '#gcRail [data-rail="images"]', p: 'r', t: 'Снимки', d: 'Sentinel-2 по датам, индексы NDVI, NDMI, NBR и сравнение двух снимков.' },
        { s: '#gcRail [data-rail="tools"]', p: 'r', t: 'Инструменты', d: 'Рисование, экспорт карты, 3D, агрокалькулятор, профиль рельефа и логистика.' },
        { s: '#gcRail [data-rail="layers"]', p: 'r', t: 'Слои', d: 'Кадастр НСПД и свои слои. Включённый слой открывает свою панель.' },
        { s: '#gcRail [data-rail="weather"]', p: 'r', t: 'Погода', d: 'Прогноз, климат, сумма температур, заморозки и ветер по участку.' },
        { s: '#toggleDrawerBtn', p: 'r', t: 'Боковая панель', d: 'Сворачивает и разворачивает панель с инструментами, чтобы освободить карту.' },
        { s: '#mapClearBtn', p: 'r', t: 'Очистить карту', d: 'Убирает рисунки, замеры, маршрут и результаты анализов одним нажатием.' },
        { s: '#drawMapBtn', p: 'b', t: 'Рисование', d: 'Фигуры, линии, значки и текст. Параметры открываются в нижней панели.' },
        { s: '#measureBtn', p: 'b', t: 'Длина', d: 'Расстояние по клику прямо на карте — инструмент включается сразу.' },
        { s: '#measureAreaBtn', p: 'b', t: 'Площадь', d: 'Площадь и периметр по клику прямо на карте — инструмент включается сразу.' },
        { s: '#baseLayersBtn', p: 'l', t: 'Базовые карты', d: 'Смените основу: схема, рельеф или другие карты.' },
        { s: '#satelliteBtn', p: 'l', t: 'Спутниковые снимки', d: 'Google, Esri, Sentinel-2, Landsat. Выбор Sentinel открывает раздел с датами.' },
        { s: '#analyticsBtn', p: 'l', t: 'Аналитические подложки', d: 'Land Cover, NDVI и почвенные слои. Легенда появится в боковой панели.' },
        { s: '#layersWidgetBtn', p: 'l', t: 'Слои', d: 'Кварталы, участки и здания кадастра, а также «Свои слои». При включении открывается панель слоя.' },
        { s: '#swipeBtn', p: 'l', t: 'Шторка', d: 'Сравнивайте две подложки или даты снимков, двигая разделитель.' },
        { s: '#gridBtn', p: 'l', t: 'Сетка координат', d: 'Формат, шаг и цвет сетки настраиваются в панели.' },
        { s: '#shareBtn', p: 'l', t: 'Поделиться', d: 'Ссылка с центром и масштабом текущего вида карты.' },
        { s: '#mode3dBtn', p: 'l', t: '3D режим', d: 'Рельеф, здания OSM и деревья. Вернуться к плоской карте — кнопка «2D».' },
        { s: '#profileBtn', p: 'l', t: 'Профиль рельефа', d: 'Нарисуйте линию — построится график высот с перепадом и уклонами.' },
        { s: '#weatherBtn', p: 'l', t: 'Слой погоды', d: 'Облака, температура, ветер и осадки поверх карты.' },
        { s: '#locateBtn', p: 'l', t: 'Моё местоположение', d: 'Переместит карту туда, где вы находитесь.' },
        { s: '#northBtn', p: 'l', t: 'Стрелка севера', d: 'Карту можно вращать (Shift + колесо мыши). Нажмите, чтобы вернуть север вверх.' },
        { s: '#fullscreenBtn', p: 'l', t: 'На весь экран', d: 'Карта раскроется вместе с боковой панелью.' },
        { s: null, p: 'c', t: 'Правая кнопка мыши', d: 'Щёлкните правой кнопкой по карте: «Что здесь?», маршрут, закладка. На кадастровом участке — перенос границ в разделы анализа и скачивание в KML, GeoJSON, SHP, DXF.' },
        { s: null, p: 'c', t: 'Клавиши рисования', d: 'P — полигон, C — круг, L — линия, R — прямоугольник. Enter завершает фигуру, Backspace убирает последнюю точку, Esc отменяет инструмент.' },
        { s: null, p: 'c', t: 'Клавиши для объектов', d: 'Delete — удалить, Ctrl+C / Ctrl+V — копировать и вставить, Ctrl+D — дублировать, Ctrl+E — экспорт в KML, F — приблизить, Home — все объекты, F2 — переименовать.' },
        { s: null, p: 'c', t: 'Все клавиши', d: 'Нажмите ? на карте — откроется список горячих клавиш. Подробности есть в справке, раздел «Горячие клавиши».' }
    ];
    var list = [], i = 0, bub = null, tgt = null, seq = 0, SECT = /data-rail="(analysis|images|tools|layers|weather)"/;
    function tgtOf(st) { return st.el || (st.s ? document.querySelector(st.s) : null); }
    function openRail(st) {   // открывает вкладку левого меню шага; true — если пришлось открывать (нужна пауза на анимацию)
        if (!st.rail) return false;
        var g = document.querySelector('#mainPanel .sp-group[data-group="' + st.rail + '"]');
        if (g && g.classList.contains('on') && vis(g)) return false;
        var rb = document.querySelector('#gcRail [data-rail="' + st.rail + '"]'); if (rb) rb.click();
        return true;
    }
    function clearHl() { if (tgt) { tgt.classList.remove('gh-pulse'); tgt.style.animationIterationCount = ''; tgt = null; } }
    function stop() {
        seq++; clearHl(); if (bub) { bub.remove(); bub = null; }
        document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); stop(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    }
    function show() { var tk = ++seq; if (openRail(list[i])) setTimeout(function () { if (tk === seq) draw(); }, 380); else draw(); }
    function draw() {
        var st = list[i]; clearHl();
        document.querySelectorAll('.widget-panel.active').forEach(function (p) { p.classList.remove('active'); });
        document.querySelectorAll('.widget-btn.active').forEach(function (b) { b.classList.remove('active'); });
        if (bub) bub.remove();
        var t = tgtOf(st); if (t && st.el && t.scrollIntoView) t.scrollIntoView({ block: 'nearest' });
        bub = document.createElement('div'); bub.className = 'gh gh-tour gh-' + st.p;
        bub.innerHTML = '<button type="button" class="gh-x" aria-label="Закончить курс">×</button><span class="gt-cnt2">Шаг ' + (i + 1) + ' из ' + list.length + '</span><b>' + st.t + '</b>' + st.d +
            '<div class="gh-nav"><button type="button" class="gh-prev"' + (i ? '' : ' disabled') + '>Назад</button><button type="button" class="gh-next">' + (i === list.length - 1 ? 'Готово' : 'Далее') + '</button></div>';
        app.appendChild(bub);
        var a = app.getBoundingClientRect(), w = bub.offsetWidth, hh = bub.offsetHeight, x, y;
        if (t && st.p !== 'c') {
            var pl = bubblePlace(st.p, a, t.getBoundingClientRect(), w, hh);
            x = pl.x; y = pl.y;
            bub.style.setProperty('--ay', pl.ay + 'px');
            bub.style.setProperty('--ax', pl.ax + 'px');
            t.classList.add('gh-pulse'); t.style.animationIterationCount = 'infinite'; tgt = t;
        } else { bub.className = 'gh gh-tour gh-c'; x = (a.width - w) / 2; y = (a.height - hh) / 2; }
        bub.style.left = x + 'px'; bub.style.top = y + 'px';
        bub.querySelector('.gh-x').onclick = stop;
        bub.querySelector('.gh-prev').onclick = function () { go(-1); };
        bub.querySelector('.gh-next').onclick = function () { if (i === list.length - 1) { stop(); if (typeof updateStatus === 'function') updateStatus('🎓 Обучающий курс пройден'); } else go(1); };
    }
    function go(d) {
        var n = i + d;
        while (n >= 0 && n < list.length && list[n].s && !list[n].rail && !vis(tgtOf(list[n]))) n += d;   // скрытые элементы пропускаем
        if (n < 0 || n >= list.length) { if (d > 0) stop(); return; }
        i = n; show();
    }
    function start() {
        stop();
        var pc = document.getElementById('ppClose'); if (app.classList.contains('passport-open') && pc) pc.click();
        var hw = document.getElementById('gcHelpWin'); if (hw && !hw.hidden) { var hc = document.getElementById('gcHelpClose'); if (hc) hc.click(); }
        list = [];
        STEPS.forEach(function (s) {
            if (s.s && !vis(document.querySelector(s.s))) return;
            var m = s.s && s.s.match(SECT);
            if (!m) { list.push(s); return; }
            var k = m[1], c = {}; for (var q in s) c[q] = s[q]; c.rail = k; list.push(c);   // вкладка меню + её разделы по порядку
            document.querySelectorAll('#mainPanel .sp-group[data-group="' + k + '"] .sp-tile:not(.sp-stub)').forEach(function (el) {
                var p = (el.getAttribute('title') || '').split('\n'), nm = (p.shift() || '').trim();
                if (nm) list.push({ el: el, rail: k, p: 'r', t: gcUx.esc(nm), d: gcUx.esc(p.join(' ').trim()) || 'Раздел боковой панели.' });
            });
        });
        if (!list.length) return;
        i = 0; show();
        document.addEventListener('keydown', onKey, true);
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); start(); });
})();

/* ===== «Объекты на карте» (вкладка «Слои»): всё, что пользователь нарисовал или загрузил в текущем сеансе =====
   Источники: drawnItems (полигоны, круги, импорт KML / GeoJSON / XML Росреестра) и sketchItems (линии, значки, текст из «Рисования»).
   Файлы со многими фигурами раскрываются до отдельных строк. Список обновляется сам при любых изменениях. */
(function () {
    'use strict';
    var list = document.getElementById('objMapList');
    if (!list || typeof drawnItems === 'undefined' || typeof sketchItems === 'undefined') return;
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var nf = function (v, d) { return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d }); };

    var st = document.createElement('style');
    st.textContent = '.ob-row{display:flex;align-items:center;gap:8px;padding:6px 8px;margin:4px 0;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer}' +
        '.ob-row:hover{border-color:#10b981;background:#f0fdf4}.ob-row>i{width:18px;text-align:center;color:#059669;flex:none}' +
        '.ob-nm{flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.ob-nm small{display:block;font-weight:400;font-size:11px;color:#64748b}.ob-mt{font-size:12px;color:#334155;white-space:nowrap}' +
        '.ob-b{border:0;background:none;color:#94a3b8;cursor:pointer;padding:4px 6px;border-radius:6px}.ob-b:hover{color:#059669;background:#dcfce7}.ob-b[data-a="del"]:hover{color:#ef4444;background:#fee2e2}' +
        '.ob-sum{margin-top:8px;font-size:12px;color:#475569;display:flex;gap:14px;flex-wrap:wrap}.ob-empty{padding:10px 2px;font-size:12.5px;color:#64748b;line-height:1.45}';
    document.head.appendChild(st);

    var items = [];
    function flat(a, out) { a.forEach(function (x) { Array.isArray(x) ? flat(x, out) : out.push(x); }); return out; }
    function lenOf(l) {
        var ll = l.getLatLngs(), parts = Array.isArray(ll[0]) && !(ll[0] instanceof L.LatLng) ? ll : [ll], m = 0;
        parts.forEach(function (p) { p = flat([p], []); for (var i = 1; i < p.length; i++) m += map.distance(p[i - 1], p[i]); });
        return m;
    }
    // фигура (не группа) → строка списка
    function describe(l, parent, top, sketch) {
        var it = { l: l, parent: parent, top: top, sketch: sketch, name: '', type: '', icon: 'fa-shapes', mt: '', ha: 0, m: 0 };
        var sk = l._sk, p = (l.feature && l.feature.properties) || {};
        if (l instanceof L.Circle) { it.type = 'Круг'; it.icon = 'fa-circle'; }
        else if (l instanceof L.CircleMarker) { it.type = 'Точка'; it.icon = 'fa-circle-dot'; }
        else if (l instanceof L.Marker) { it.type = 'Метка'; it.icon = 'fa-location-dot'; }
        else if (l instanceof L.Rectangle) { it.type = 'Прямоугольник'; it.icon = 'fa-vector-square'; }
        else if (l instanceof L.Polygon) { it.type = 'Полигон'; it.icon = 'fa-draw-polygon'; }
        else if (l instanceof L.Polyline) { it.type = 'Линия'; it.icon = 'fa-slash'; }
        else return null;
        if (sk) {
            if (typeof SK_KIND_NAMES !== 'undefined' && SK_KIND_NAMES[sk.kind]) it.type = SK_KIND_NAMES[sk.kind];
            if (typeof SK_KIND_ICONS !== 'undefined' && SK_KIND_ICONS[sk.kind]) it.icon = String(SK_KIND_ICONS[sk.kind]).replace(/^fa[sr]?\s+/, '');
            it.name = sk.kind === 'text' ? '«' + sk.text + '»' : sk.name;
        } else if (l._gcName) it.name = l._gcName;
        else if (p.cad_number) it.name = p.cad_number + (p.contour_count > 1 ? ' · контур ' + p.contour : '');
        else if (p.name || p.Name || p.title) it.name = p.name || p.Name || p.title;
        else it.name = l._gcDef || '';
        if (l instanceof L.Circle || l instanceof L.Polygon) {
            var d = typeof getObjectCenterAndArea === 'function' ? getObjectCenterAndArea(l) : null;
            if (d) { it.ha = d.area; it.mt = nf(d.area, 3) + ' га'; }
        } else if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
            it.m = lenOf(l); it.mt = it.m < 1000 ? nf(it.m, 0) + ' м' : nf(it.m / 1000, 2) + ' км';
        }
        it.src = sketch ? 'Рисование' : (l.feature ? 'Загружено из файла' : 'Нарисовано');
        return it;
    }
    function collect(group, sketch) {
        group.eachLayer(function (top) {
            (function walk(l, parent) {
                if (typeof l.eachLayer === 'function') { l.eachLayer(function (c) { walk(c, l); }); return; }
                var it = describe(l, parent, top, sketch);
                if (it) items.push(it);
            })(top, group);
        });
    }
    function render() {
        items = [];
        collect(drawnItems, false); collect(sketchItems, true);
        var cnt = {}, ha = 0, m = 0;
        items.forEach(function (it) { if (!it.name) { var k = it.type + (it.l.feature ? '*' : ''); cnt[k] = (cnt[k] || 0) + 1; it.name = it.type + (it.l.feature ? ' из файла ' : ' ') + cnt[k]; } ha += it.ha; m += it.m; });
        $('objMapBadge').textContent = items.length;
        list.innerHTML = items.length ? items.map(function (it, i) {
            return '<div class="ob-row" data-i="' + i + '" title="Показать на карте и выбрать"><i class="fas ' + it.icon + '"></i>' +
                '<span class="ob-nm">' + esc(it.name) + '<small>' + esc(it.type + ' · ' + it.src) + '</small></span>' +
                (it.mt ? '<span class="ob-mt">' + it.mt + '</span>' : '') +
                '<button type="button" class="ob-b" data-a="zoom" title="Показать на карте"><i class="fas fa-crosshairs"></i></button>' +
                '<button type="button" class="ob-b" data-a="del" title="Удалить"><i class="fas fa-xmark"></i></button></div>';
        }).join('') : '<div class="ob-empty">Пока ничего нет. Нарисуйте участок, линию или значок либо загрузите файл (KML, GeoJSON, Excel, XML Росреестра) — объекты появятся здесь.</div>';
        $('objMapSum').innerHTML = items.length ? '<span>Объектов: <b>' + items.length + '</b></span>' + (ha ? '<span>Площадь: <b>' + nf(ha, 3) + ' га</b></span>' : '') + (m ? '<span>Длина линий: <b>' + (m < 1000 ? nf(m, 0) + ' м' : nf(m / 1000, 2) + ' км') + '</b></span>' : '') : '';
    }
    var tm = 0;
    function refresh() { clearTimeout(tm); tm = setTimeout(render, 60); }

    function zoomTo(l) {
        if (l.getBounds && !(l instanceof L.CircleMarker && !(l instanceof L.Circle))) map.fitBounds(l.getBounds().pad(0.25), { maxZoom: 18 });
        else map.setView(l.getLatLng(), Math.max(map.getZoom(), 16));
    }
    list.addEventListener('click', function (e) {
        var row = e.target.closest('.ob-row'); if (!row) return;
        var it = items[+row.dataset.i]; if (!it) return;
        var act = (e.target.closest('.ob-b') || {}).dataset;
        act = act && act.a;
        if (act === 'del') {
            if (it.sketch) skDeleteLayer(it.l);
            else if (it.top === it.l) deleteObject(drawnItems.getLayers().indexOf(it.l));
            else {
                it.parent.removeLayer(it.l);
                if (typeof it.top.getLayers === 'function' && !it.top.getLayers().length) drawnItems.removeLayer(it.top);
                if (typeof updateAllLabels === 'function') updateAllLabels();
                updateObjectList(); updateStatus('🗑️ Объект удалён');
            }
            refresh(); return;
        }
        zoomTo(it.l);
        if (act === 'zoom') return;
        if (it.sketch) skSelect(it.l);
        else if (it.top === it.l && typeof selectObject === 'function') selectObject(drawnItems.getLayers().indexOf(it.l));
    });

    // автообновление: добавление / удаление фигур, правка, импорт, переименование, действия «Рисования»
    ['layeradd', 'layerremove'].forEach(function (ev) { drawnItems.on(ev, refresh); sketchItems.on(ev, refresh); });
    map.on('draw:created draw:edited draw:deleted', refresh);
    [['updateObjectList'], ['skRenderList']].forEach(function (n) {
        var o = window[n[0]];
        if (typeof o === 'function') window[n[0]] = function () { var r = o.apply(this, arguments); refresh(); return r; };
    });
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.bp-tab[data-bp-tab="objects"], .sp-tile[data-bp="objects"]')) setTimeout(render, 0);
    });
    render();
})();
