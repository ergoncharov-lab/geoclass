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
