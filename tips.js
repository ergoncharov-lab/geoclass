/* Обучающие всплывашки в углу карты: короткие советы о возможностях и клавишах со ссылками на справку.
   Не мешают работе: показываются редко, на несколько секунд, не перехватывают клики вне себя,
   не появляются при вводе, рисовании, 3D, открытой справке/паспорте. Можно отключить. */
(function () {
    var map = document.getElementById('map'), panel = document.getElementById('mainPanel');
    var win = document.getElementById('gcHelpWin'), frame = win && win.querySelector('iframe');
    if (!map || !map.parentElement) return;

    var SHOW_MS = 8000, GAP_MS = 40000, FIRST_MS = 12000, KEY = 'gcTipsOff', SEEN = 'gcTipsSeen';
    // t — текст, h — якорь в справке, c — раздел боковой панели (контекстный совет), k — общий совет
    var TIPS = [
        { c: 'profile', t: 'Определите профиль рельефа: нарисуйте линию по карте и нажмите <kbd>Enter</kbd>.', h: 'an-profile' },
        { c: 'draw', t: 'В «Рисовании» работают <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> и <kbd>Del</kbd> для удаления.', h: 'tl-draw' },
        { c: 'measure', t: 'Измерение: <kbd>Enter</kbd> — завершить, <kbd>Backspace</kbd> — убрать точку.', h: 'tl-measure' },
        { c: '3d', t: '3D: правая кнопка мыши — поворот, <kbd>Del</kbd> — удалить модель.', h: 'tl-3d' },
        { c: 'export', t: 'Результаты можно выгрузить в файл: KML, отчёт, паспорт участка.', h: 'tl-export' },
        { c: 'agro', t: 'Агрокалькулятор считает нормы и затраты по выбранному участку.', h: 'tl-agro' },
        { c: 'cadastre', t: 'Кадастр: <kbd>Ctrl</kbd>+клик выбирает сразу несколько участков.', h: 'ly-cadastre' },
        { c: 'userlayers', t: 'Свои слои: загрузите KML, GeoJSON или GeoTIFF и включайте поверх карты.', h: 'ly-user' },
        { c: 'catalog', t: 'В каталоге данных — готовые слои: рельеф, почвы, земли и другое.', h: 'ly-catalog' },
        { c: 'dates', t: 'Выбирайте снимки с облачностью до 10 % — индексы будут точнее.', h: 'im-dates' },
        { c: 'ndvi', t: 'NDVI показывает вегетацию. Сравнивайте одну и ту же фазу в разные годы.', h: 'im-ndvi' },
        { c: 'ndmi', t: 'NDMI — влажность растений: помогает заметить засуху раньше глаза.', h: 'im-ndmi' },
        { c: 'nbr', t: 'NBR выделяет гари и сильные нарушения покрова.', h: 'im-nbr' },
        { c: 'change', t: 'Сравнение дат показывает, что изменилось на участке между двумя снимками.', h: 'im-change' },
        { c: 'weather', t: 'Прогноз погоды считается для центра участка.', h: 'wx-forecast' },
        { c: 'climate', t: 'Климат: многолетние нормы помогут оценить риски для культуры.', h: 'wx-climate' },
        { c: 'gdd', t: 'GDD — сумма активных температур: так оценивают сроки созревания.', h: 'wx-gdd' },
        { c: 'frost', t: 'Заморозки: проверьте риск в период всходов и цветения.', h: 'wx-frost' },
        { c: 'windwork', t: 'Ветер важен для опрыскивания: сверяйтесь с окнами безопасной работы.', h: 'wx-wind' },
        { c: 'logistics', t: 'Логистика: расстояния и время в пути до выбранных точек.', h: 'an-logistics' },
        { c: 'shape', t: 'Форма участка влияет на проходы техники; ниже — пересечения с кадастром и выгрузка в Excel, KML, SHP.', h: 'an-shape' },
        { c: 'chem', t: 'Почва и химия: оценка по открытым данным, не заменяет анализ в лаборатории.', h: 'an-soil' },
        { k: 1, t: 'Нажмите <kbd>?</kbd> на карте — откроется список всех горячих клавиш.', h: 'keys' },
        { k: 1, t: 'Рисуйте с клавиатуры: <kbd>P</kbd> полигон, <kbd>C</kbd> круг, <kbd>L</kbd> линия, <kbd>R</kbd> прямоугольник.', h: 'keys' },
        { k: 1, t: '<kbd>Del</kbd> — удалить выбранный объект, <kbd>Esc</kbd> — отменить инструмент.', h: 'keys' },
        { k: 1, t: '<kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd> копируют объект, <kbd>Ctrl</kbd>+<kbd>D</kbd> дублирует.', h: 'keys' },
        { k: 1, t: '<kbd>F</kbd> — приблизить к выбранному объекту, <kbd>Home</kbd> — показать все объекты.', h: 'keys' },
        { k: 1, t: '<kbd>F2</kbd> переименовывает выбранный объект, <kbd>Ctrl</kbd>+<kbd>E</kbd> экспортирует его в KML.', h: 'keys' },
        { k: 1, t: '<kbd>Shift</kbd> + колесо мыши поворачивает карту, стрелка севера возвращает север вверх.', h: 'ui-mouse' },
        { k: 1, t: 'Правый клик по карте: «Что здесь?», маршрут, закладка, копирование.', h: 'ui-mouse' },
        { k: 1, t: 'Кнопка «?» в шапке панели открывает справку по текущему разделу.', h: 'start' },
        { k: 1, t: 'Ошибка при рисовании? <kbd>Backspace</kbd> уберёт последнюю точку.', h: 'tl-draw' }
    ];

    var off = false, seen = {}, cur = null, timer = null, lastInput = 0, lastShown = 0, lastCtx = null, ctxTimer = null, gi = 0;
    try { off = localStorage.getItem(KEY) === '1'; seen = JSON.parse(localStorage.getItem(SEEN) || '{}') || {}; } catch (e) { /* хранилище недоступно */ }
    function save() { try { localStorage.setItem(KEY, off ? '1' : '0'); localStorage.setItem(SEEN, JSON.stringify(seen)); } catch (e) { /* ок */ } }

    var st = document.createElement('style');
    st.textContent =
        '.gc-tips{position:absolute;left:12px;bottom:38px;z-index:1000;width:300px;max-width:calc(100% - 24px);pointer-events:none;display:flex;flex-direction:column;gap:8px}' +
        '.gc-tip{pointer-events:auto;position:relative;background:rgba(12,17,16,.92);color:#e2e8f0;border:1px solid #1f3a31;border-left:3px solid var(--green,#059669);border-radius:10px;padding:9px 28px 8px 11px;font:12.8px/1.45 \'Segoe UI\',system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s}' +
        '.gc-tip.in{opacity:1;transform:none}' +
        '.gc-tip kbd{font:11.5px/1 ui-monospace,Consolas,monospace;background:#1e293b;border:1px solid #334155;border-bottom-width:2px;border-radius:4px;padding:1px 5px;color:#fff}' +
        '.gc-tip-x{position:absolute;top:4px;right:5px;width:20px;height:20px;border:0;background:transparent;color:#94a3b8;font-size:15px;line-height:1;cursor:pointer;border-radius:50%;padding:0}' +
        '.gc-tip-x:hover{color:#fff;background:#1e293b}' +
        '.gc-tip-f{display:flex;gap:12px;margin-top:5px;font-size:12px}' +
        '.gc-tip-f a,.gc-tip-f button{color:#34d399;background:none;border:0;padding:0;font:inherit;cursor:pointer;text-decoration:none}' +
        '.gc-tip-f button{color:#94a3b8;margin-left:auto}.gc-tip-f a:hover,.gc-tip-f button:hover{text-decoration:underline}' +
        '.gc-tip-bar{position:absolute;left:0;bottom:0;height:2px;background:var(--green,#059669);width:100%;border-radius:0 0 10px 10px;transform-origin:left;animation:gcTipBar linear forwards}' +
        '.gc-tip:hover .gc-tip-bar{animation-play-state:paused}@keyframes gcTipBar{to{transform:scaleX(0)}}' +
        '@media (max-width:640px){.gc-tips{width:240px;bottom:44px}}@media print{.gc-tips{display:none}}';
    document.head.appendChild(st);

    var host = map.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var box = document.createElement('div'); box.className = 'gc-tips'; box.setAttribute('aria-live', 'polite');
    host.appendChild(box);

    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { lastInput = Date.now(); }, true); });

    function openHelp(id) {
        var rail = document.querySelector('.gc-rail-btn[data-rail="help"]');
        if (win && win.hidden) { if (rail) rail.click(); else win.hidden = false; }
        if (!frame) return;
        function send() { try { frame.contentWindow.postMessage({ gcHelpGoto: id }, '*'); } catch (e) { /* нет доступа */ } }
        var ready = false;
        try { ready = frame.contentDocument.readyState === 'complete' && !!frame.getAttribute('src'); } catch (e) { /* ещё не загружено */ }
        if (ready) setTimeout(send, 60);
        else { frame.addEventListener('load', function f() { frame.removeEventListener('load', f); setTimeout(send, 60); }); if (!frame.getAttribute('src')) frame.src = 'help.html'; }
    }

    function hide(el) {
        if (!el) return;
        clearTimeout(timer); el.classList.remove('in');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
        if (cur === el) cur = null;
    }

    // можно ли сейчас показывать: ничего не мешаем
    function quiet(force) {
        if (off || cur || document.hidden) return false;
        var t = document.activeElement;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return false;
        if (win && !win.hidden) return false;
        if (typeof m3d !== 'undefined' && m3d.active) return false;
        if (typeof activeDrawHandler !== 'undefined' && activeDrawHandler) return false;
        if (typeof currentTool !== 'undefined' && currentTool) return false;
        if (typeof sketchState !== 'undefined' && sketchState.tool) return false;
        var r = map.getBoundingClientRect();
        if (r.bottom < 120 || r.top > innerHeight - 120) return false;
        if (host.querySelector('.app-container.passport-open') || document.querySelector('.app-container.passport-open')) return false;
        if (Date.now() - lastInput < 3000) return false;        // пользователь активно работает
        if (!force && Date.now() - lastShown < GAP_MS) return false;
        return true;
    }

    function show(tip) {
        var el = document.createElement('div'); el.className = 'gc-tip'; el.setAttribute('role', 'status');
        el.innerHTML = '<button class="gc-tip-x" aria-label="Закрыть" title="Закрыть">×</button><div>💡 ' + tip.t + '</div>' +
            '<div class="gc-tip-f">' + (tip.h ? '<a href="#" data-go="1">Подробнее →</a>' : '') + '<button data-off="1" title="Отключить все подсказки">Отключить</button></div>' +
            '<i class="gc-tip-bar" style="animation-duration:' + SHOW_MS + 'ms"></i>';
        el.addEventListener('click', function (e) {
            var b = e.target.closest('button,a'); if (!b) return;
            e.preventDefault();
            if (b.classList.contains('gc-tip-x')) hide(el);
            else if (b.getAttribute('data-go')) { hide(el); openHelp(tip.h); }
            else if (b.getAttribute('data-off')) { off = true; save(); hide(el); setTimeout(offNote, 350); }
        });
        box.appendChild(el); cur = el; lastShown = Date.now();
        requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('in'); }); });
        var key = tip.c || ('k' + TIPS.indexOf(tip)); seen[key] = 1; save();
        timer = setTimeout(function () { hide(el); }, SHOW_MS);
        el.addEventListener('mouseenter', function () { clearTimeout(timer); });
        el.addEventListener('mouseleave', function () { timer = setTimeout(function () { hide(el); }, 2500); });
    }

    function offNote() {
        var el = document.createElement('div'); el.className = 'gc-tip';
        el.innerHTML = '<button class="gc-tip-x" aria-label="Закрыть">×</button><div>Подсказки отключены.</div><div class="gc-tip-f"><button data-on="1" style="margin-left:0;color:#34d399">Включить обратно</button></div>';
        el.addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            if (b.getAttribute('data-on')) api.enable();
            hide(el);
        });
        box.appendChild(el); cur = el;
        requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('in'); }); });
        timer = setTimeout(function () { hide(el); }, 6000);
    }

    // следующий общий совет: сначала ещё не показанные
    function nextGeneral() {
        var g = TIPS.filter(function (x) { return x.k; }), i, n = g.length;
        for (i = 0; i < n; i++) { var t = g[(gi + i) % n]; if (!seen['k' + TIPS.indexOf(t)]) { gi = (gi + i + 1) % n; return t; } }
        var t2 = g[gi % n]; gi = (gi + 1) % n; return t2;
    }

    function ctxKey() {
        if (!panel || panel.getAttribute('data-view') !== 'bp') return null;
        var t = document.querySelector('.bp-tab.active'); return t && t.getAttribute('data-bp-tab');
    }
    function onCtx() {
        var k = ctxKey(); if (k === lastCtx) return; lastCtx = k;
        clearTimeout(ctxTimer);
        var tip = k && TIPS.filter(function (x) { return x.c === k; })[0];
        if (!tip || seen[k]) return;
        ctxTimer = setTimeout(function () { if (ctxKey() === k && quiet(true)) show(tip); }, 2500);   // только если пользователь задержался в разделе
    }
    if (panel) {
        new MutationObserver(onCtx).observe(panel, { attributes: true, attributeFilter: ['data-view'], subtree: true });
        document.addEventListener('click', function () { setTimeout(onCtx, 0); });
    }

    // периодические общие советы
    setTimeout(function () {
        if (quiet(false)) show(nextGeneral());
        setInterval(function () { if (quiet(false)) show(nextGeneral()); }, 15000);
    }, FIRST_MS);

    var api = window.gcTips = {
        enable: function () { off = false; seen = {}; save(); lastShown = 0; },
        disable: function () { off = true; save(); },
        isOff: function () { return off; },
        show: function () { if (!cur) show(nextGeneral()); }
    };
})();
