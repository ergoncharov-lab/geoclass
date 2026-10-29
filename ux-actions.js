/* Три улучшения удобства (подключается после script.js):
   1) панель «Что сделать с участком» после рисования / импорта полигона (и по клавише A для выбранного);
   2) единые уведомления на карте: загрузка · ошибка с кнопкой «Повторить» · пусто (Sentinel и все предупреждения updateStatus);
   3) горячие клавиши: кнопка «Клавиши» в левом меню, подсказки с клавишами у инструментов, пункт A в справке по клавишам. */
(function () {
    var map0 = document.getElementById('map');
    if (!map0 || !map0.parentElement || typeof L === 'undefined') return;
    var host = map0.parentElement, T0 = Date.now();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    var st = document.createElement('style');
    st.textContent =
        '#gcToasts{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:1500;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;max-width:92%}' +
        '.gc-toast{pointer-events:auto;display:flex;align-items:center;gap:8px;padding:7px 10px 7px 12px;border-radius:10px;background:#fff;color:#0f172a;font-size:13px;line-height:1.35;box-shadow:0 4px 16px rgba(15,23,42,.22);border-left:4px solid #94a3b8}' +
        '.gc-toast.error{border-left-color:#ef4444}.gc-toast.loading{border-left-color:#10b981}.gc-toast.empty{border-left-color:#f59e0b}.gc-toast.ok{border-left-color:#22c55e}' +
        '.gc-toast button{border:1px solid #cbd5e1;background:#f8fafc;border-radius:7px;padding:3px 9px;font-size:12px;cursor:pointer;color:#0f172a}.gc-toast button:hover{background:#e2e8f0}' +
        '.gc-toast .gc-tx{background:none;border:0;padding:2px 4px;color:#64748b;font-size:14px}' +
        '#gcNext{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:1450;max-width:94%;background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.28);padding:10px 12px;font-size:13px}' +
        '#gcNext .gn-h{display:flex;align-items:center;gap:8px;margin-bottom:8px}#gcNext .gn-h b{flex:1}#gcNext .gn-x{border:0;background:none;color:#64748b;cursor:pointer;font-size:15px}' +
        '#gcNext .gn-b{display:flex;flex-wrap:wrap;gap:6px}' +
        '#gcNext .gn-b button{display:flex;align-items:center;gap:6px;border:1px solid #d1fae5;background:#ecfdf5;color:#065f46;border-radius:9px;padding:6px 10px;cursor:pointer;font-size:12.5px}' +
        '#gcNext .gn-b button:hover{background:#d1fae5}' +
        '.gc-rail-btn.gc-kbd i{font-size:19px}';
    document.head.appendChild(st);

    /* ---------- 2. единые уведомления ---------- */
    var tbox = document.createElement('div'); tbox.id = 'gcToasts'; host.appendChild(tbox);
    var toasts = {};
    function toastOff(id) { var t = toasts[id]; if (!t) return; clearTimeout(t.timer); if (t.el.parentNode) t.el.remove(); delete toasts[id]; }
    function toast(id, o) {
        toastOff(id);
        var el = document.createElement('div'); el.className = 'gc-toast ' + (o.kind || '');
        var ic = { loading: 'fa-spinner fa-spin', error: 'fa-triangle-exclamation', empty: 'fa-circle-info', ok: 'fa-circle-check' }[o.kind] || 'fa-circle-info';
        var i = document.createElement('i'); i.className = 'fas ' + ic; el.appendChild(i);
        var sp = document.createElement('span'); sp.textContent = o.text; el.appendChild(sp);
        if (o.retry) { var rb = document.createElement('button'); rb.type = 'button'; rb.textContent = 'Повторить'; rb.addEventListener('click', function () { toastOff(id); try { o.retry(); } catch (e) { } }); el.appendChild(rb); }
        if (o.kind !== 'loading') { var x = document.createElement('button'); x.type = 'button'; x.className = 'gc-tx'; x.textContent = '✕'; x.title = 'Закрыть'; x.addEventListener('click', function () { toastOff(id); }); el.appendChild(x); }
        tbox.appendChild(el);
        while (tbox.children.length > 3) { var f = tbox.firstChild; Object.keys(toasts).forEach(function (k) { if (toasts[k].el === f) delete toasts[k]; }); f.remove(); }
        toasts[id] = { el: el, timer: o.ttl ? setTimeout(function () { toastOff(id); }, o.ttl) : 0 };
    }
    window.gcToast = toast; window.gcToastOff = toastOff;

    var muted = 0;   // пока true, updateStatus не дублирует своё предупреждение отдельным уведомлением
    function snRetry() { try { (SENTINEL.live || []).forEach(function (l) { if (l && l.redraw) l.redraw(); }); } catch (e) { } }
    if (typeof window.updateStatus === 'function') {
        var us = window.updateStatus;
        window.updateStatus = function (msg, isErr) {
            var r = us.apply(this, arguments);
            if (isErr && !muted && msg) toast('st:' + msg, { kind: 'error', text: String(msg).replace(/^⚠️\s*/, ''), ttl: 7000 });
            return r;
        };
    }
    if (typeof window.snWarn === 'function') {
        var sw = window.snWarn;
        window.snWarn = function (e) {
            muted++; try { sw.apply(this, arguments); } finally { muted--; }
            toast('sn', { kind: 'error', text: 'Sentinel: ' + (e && e.message ? e.message : e), retry: snRetry, ttl: 15000 });
        };
    }
    // загрузка снимков Sentinel: индикатор; если идёт слишком долго — подсказка и «Повторить»
    var loadingN = 0, slowT = 0;
    var snDetail = '', snSlow = false;
    function snText() { return (snSlow ? 'Снимки грузятся медленно — проверьте соединение' : 'Загружаю снимки Sentinel…') + (snDetail ? ' ' + snDetail : ''); }
    window.gcSnProgress = function (d) {   // процент и число тайлов (кэш / сеть) из script.js
        snDetail = d || '';
        var t = toasts.snload, sp = t && t.el.querySelector('span');
        if (sp && loadingN > 0) sp.textContent = snText();
    };
    function snLoadStart() { if (loadingN++ === 0) { snDetail = ''; snSlow = false; toast('snload', { kind: 'loading', text: snText() }); clearTimeout(slowT); slowT = setTimeout(function () { snSlow = true; toast('snload', { kind: 'empty', text: snText(), retry: snRetry }); }, 20000); } }
    function snLoadEnd() { if (loadingN > 0 && --loadingN === 0) { clearTimeout(slowT); toastOff('snload'); } }
    setInterval(function () {
        try { (SENTINEL.live || []).forEach(function (l) { if (!l || l._gcT || !l.on) return; l._gcT = 1; l.on('loading', snLoadStart); l.on('load', snLoadEnd); l.on('remove', function () { loadingN = 0; clearTimeout(slowT); toastOff('snload'); }); }); } catch (e) { }
    }, 1500);

    /* ---------- 1. панель «Что сделать с участком» ---------- */
    var nextEl = null, nextTimer = 0, seen = new WeakSet(), seenSk = {};
    function closeNext() { clearTimeout(nextTimer); if (nextEl) { nextEl.remove(); nextEl = null; } if (typeof gcFlyClose === 'function') gcFlyClose(0); }
    function isPoly(l) { return l instanceof L.Polygon || l instanceof L.Circle; }
    function itemOf0(l) {
        if (l._sk && typeof skShapeItem === 'function') return skShapeItem(l);
        return gcPolyItem(l, l._gcName || 'Участок', 'Полный анализ', 'фигуры из «Полного анализа»');
    }
    function areaText(l, ft) {
        try { var f = ft || gcLayerGJ(l), a = turf.area(f); return a >= 1e4 ? (a / 1e4).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' га' : Math.round(a).toLocaleString('ru-RU') + ' м²'; } catch (e) { return ''; }
    }
    function showNext(l, cit) {   // l — нарисованная фигура; cit — найденный или выделенный объект кадастра { c, f } (тогда l не нужен)
        var api = window.gcShapeMenuApi;
        if (!api || (!cit && (!l || !isPoly(l) || !map.hasLayer(l)))) return;
        closeNext();
        var nm = cit ? (cit.name || 'Участок') : (l._sk && l._sk.name) || l._gcName || 'Участок', ar = cit ? areaText(null, cit.item.f) : areaText(l), itemOf = cit ? function () { return cit.item; } : itemOf0;
        nextEl = document.createElement('div'); nextEl.id = 'gcNext';
        nextEl.innerHTML = '<div class="gn-h"><b></b><button type="button" class="gn-x" title="Закрыть (Esc)">✕</button></div><div class="gn-b"></div>';
        nextEl.querySelector('b').textContent = 'Что сделать с участком «' + nm + '»' + (ar ? ' · ' + ar : '') + '?';
        var bx = nextEl.querySelector('.gn-b');
        var go = function (bp, label) { return function () { var it = itemOf(l); closeNext(); if (!it) { updateStatus('⚠️ Не удалось собрать геометрию фигуры', true); return; } api.toAnalysis(it, bp, label); }; };
        var btn = function (icon, label, fn) { var b = document.createElement('button'); b.type = 'button'; b.innerHTML = '<i class="fas ' + icon + '"></i>'; b.appendChild(document.createTextNode(label)); b.addEventListener('click', fn); bx.appendChild(b); return b; };
        btn('fa-magnifying-glass-chart', 'Полный анализ', go());
        btn('fa-leaf', 'NDVI', go('ndvi', 'NDVI'));
        btn('fa-cloud-sun-rain', 'Погода', go('weather', 'Погода'));
        btn('fa-mountain', 'Профиль', go('profile', 'Профиль'));
        btn('fa-route', 'Логистика', go('logistics', 'Логистика'));
        var dl = btn('fa-file-arrow-down', 'Скачать', function () {
            var it = itemOf(l);
            if (!it || typeof gcFlyOpen !== 'function') return;
            gcFlyOpen(dl, api.formats.map(function (f) { return { icon: 'fa-file-arrow-down', label: f.label, fn: function () { api.exportAs(f.id, [it]); } }; }), 0, closeNext);
        });
        nextEl.querySelector('.gn-x').addEventListener('click', closeNext);
        ['mousedown', 'dblclick', 'wheel', 'contextmenu'].forEach(function (t) { nextEl.addEventListener(t, function (e) { e.stopPropagation(); }); });
        nextEl.addEventListener('mouseenter', function () { clearTimeout(nextTimer); });
        nextEl.addEventListener('mouseleave', function () { clearTimeout(nextTimer); nextTimer = setTimeout(closeNext, 8000); });
        host.appendChild(nextEl);
        nextTimer = setTimeout(closeNext, 16000);
    }
    function onNew(l, key) {
        if (Date.now() - T0 < 4000 || !l || !isPoly(l)) return;   // восстановление сохранённого при загрузке — не считаем
        if (key != null) { if (seenSk[key]) return; seenSk[key] = 1; } else { if (seen.has(l)) return; seen.add(l); }
        setTimeout(function () { showNext(l); }, 350);
    }
    function hook(group, keyOf) { try { group.on('layeradd', function (e) { onNew(e.layer, keyOf ? keyOf(e.layer) : null); }); } catch (e) { } }
    try { sketchItems.eachLayer(function (l) { if (l._sk) seenSk[l._sk.id] = 1; }); } catch (e) { }
    try { drawnItems.eachLayer(function (l) { seen.add(l); }); } catch (e) { }
    if (typeof sketchItems !== 'undefined') hook(sketchItems, function (l) { return l._sk ? l._sk.id : null; });   // отмена / повтор вернут тот же id — панель не повторится
    if (typeof drawnItems !== 'undefined') hook(drawnItems);
    window.addEventListener('gc-cad-select', function (e) { var d = e.detail; if (d && d.item) setTimeout(function () { showNext(null, d); }, 350); });   // поиск по кадастровому номеру и клик по участку в слое кадастра
    map.on('draw:drawstart', closeNext);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nextEl) closeNext(); });

    /* ---------- 3. горячие клавиши ---------- */
    try {
        if (Array.isArray(window.GC_HOTKEYS) || typeof GC_HOTKEYS !== 'undefined') GC_HOTKEYS.splice(GC_HOTKEYS.length - 1, 0, ['A', 'панель «Что сделать с участком» для выбранного полигона']);
    } catch (e) { }
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.code !== 'KeyA') return;
        if (typeof gcKbOk !== 'function' || !gcKbOk(e) || typeof gcKbTarget !== 'function') return;
        var tg = gcKbTarget();
        if (!tg || !isPoly(tg.l)) return;
        e.preventDefault(); showNext(tg.l);
    });
    var hints = [['[data-tool="polygon"],[data-sk-tool="polygon"]', 'P'], ['[data-tool="rectangle"],[data-sk-tool="rectangle"]', 'R'], ['[data-tool="circle"],[data-sk-tool="circle"]', 'C'], ['[data-sk-tool="line"]', 'L']];
    hints.forEach(function (h) {
        document.querySelectorAll(h[0]).forEach(function (b) { if (b.title && b.title.indexOf('(' + h[1] + ')') < 0) b.title += ' (' + h[1] + ')'; });
    });
    var rail = document.getElementById('gcRail'), helpBtn = rail && rail.querySelector('[data-rail="help"]');
    if (rail && typeof gcHotkeysHelp === 'function') {
        var kb = document.createElement('button');
        kb.type = 'button'; kb.className = 'gc-rail-btn gc-kbd'; kb.title = 'Горячие клавиши (?)';
        kb.innerHTML = '<i class="fas fa-keyboard"></i><span>Клавиши</span>';
        kb.addEventListener('click', function () { gcHotkeysHelp(); });
        rail.insertBefore(kb, helpBtn || null);
    }
})();
