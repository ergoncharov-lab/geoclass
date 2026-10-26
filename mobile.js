/* Мобильная версия (до 960 px). Подключается последним. На десктопе ничего не меняет: всё, что создаётся здесь, скрыто в mobile.css.
   1) индикатор блоков + подсказка «смахните вверх» (само листание — CSS scroll-snap)
   2) сворачиваемые тексты и карточки
   3) все виджеты карты (поиск, маршрут, местоположение, север, рисование, длина, площадь и виджеты справа) собраны в один раскрывающийся виджет
   4) паспорт участка: страницы, листаемые вбок */
(function () {
    var mq = window.matchMedia('(max-width: 960px)'), root = document.documentElement;
    function mob() { return mq.matches; }
    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function onMq(fn) { if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn); }

    /* ---------- 1. индикатор блоков ---------- */
    var header = document.getElementById('siteHeader');
    var PAGES = [['top', 'Главная'], ['map-section', 'Карта'], ['data-catalog', 'Каталог данных'], ['features', 'Возможности'], ['how', 'Как это работает'], ['sources', 'Данные'], ['contacts', 'Вопросы и контакты']];
    function pos(id) { var el = document.getElementById(id); if (!el || id === 'top') return 0; return Math.round(el.getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 0)); }   // та же формула, что в site.js
    var dots = document.createElement('nav'); dots.className = 'mb-dots'; dots.setAttribute('aria-label', 'Блоки сайта');
    PAGES.forEach(function (p) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-id', p[0]); b.title = p[1]; b.setAttribute('aria-label', p[1]); dots.appendChild(b);
    });
    dots.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) window.scrollTo({ top: pos(b.getAttribute('data-id')), behavior: 'smooth' }); });
    document.body.appendChild(dots);
    var dotRaf = 0;
    function dotsUpdate() {
        if (dotRaf) return;
        dotRaf = requestAnimationFrame(function () {
            dotRaf = 0; if (!mob()) return;
            var y = window.scrollY, best = 0, bd = 1e9;
            PAGES.forEach(function (p, i) { var d = Math.abs(y - pos(p[0])); if (d < bd) { bd = d; best = i; } });
            $$('button', dots).forEach(function (b, i) { b.classList.toggle('on', i === best); });
            root.classList.toggle('mb-in-map', PAGES[best][0] === 'map-section');
        });
    }
    window.addEventListener('scroll', dotsUpdate, { passive: true });
    window.addEventListener('resize', dotsUpdate);
    onMq(dotsUpdate); dotsUpdate();

    /* прокрутка страницы на телефоне запрещена (html { overflow: hidden } в mobile.css): переходы — кнопками меню и точками;
       единственное исключение — с главной страницы на карту можно смахнуть вверх (или крутануть колесо) */
    var heroEl = document.getElementById('top'), tY = null;
    function heroAtEnd() { return !heroEl || heroEl.scrollTop + heroEl.clientHeight >= heroEl.scrollHeight - 2; }
    function toMap() { window.scrollTo({ top: pos('map-section'), behavior: 'smooth' }); }
    if (heroEl) {
        heroEl.addEventListener('touchstart', function (e) { tY = e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
        heroEl.addEventListener('touchend', function (e) {
            if (tY === null || !mob()) return;
            var dy = e.changedTouches[0].clientY - tY; tY = null;
            if (dy < -50 && window.scrollY < 4 && heroAtEnd()) toMap();
        }, { passive: true });
        heroEl.addEventListener('wheel', function (e) { if (mob() && e.deltaY > 20 && window.scrollY < 4 && heroAtEnd()) toMap(); }, { passive: true });
    }

    /* ---------- 2. сворачиваемые блоки ---------- */
    function fold(target, label, icon) {
        if (!target || target.getAttribute('data-mb-fold')) return;
        target.setAttribute('data-mb-fold', '1'); target.classList.add('mb-folded');
        var b = document.createElement('button'); b.type = 'button'; b.className = 'mb-fold';
        b.innerHTML = '<i class="fas fa-' + icon + '"></i><span>' + esc(label) + '</span><i class="fas fa-chevron-down mb-fc"></i>';
        b.addEventListener('click', function () { var o = !target.classList.contains('mb-open'); target.classList.toggle('mb-open', o); b.classList.toggle('mb-open', o); });
        target.parentNode.insertBefore(b, target);
    }
    fold($('#top .s-hero-about'), 'О проекте и возможностях', 'circle-info');
    fold($('#top .s-tiles'), 'Что внутри', 'layer-group');
    fold($('#data-catalog .s-cat-head .lead'), 'О каталоге', 'circle-question');
    fold($('#features .s-head > p'), 'О стоимости', 'coins');
    fold($('#how .s-mods'), 'Что входит в отчёт', 'list-check');
    fold($('#how .s-note'), 'Факты и интерпретации', 'scale-balanced');
    fold($('#contacts .s-form'), 'Написать нам', 'paper-plane');

    // каталог — аккордеон (открыта одна карточка), карточки возможностей и отчёта — описание по нажатию
    document.addEventListener('click', function (e) {
        if (!mob()) return;
        var top = e.target.closest && e.target.closest('.s-cat-top');
        if (top) {
            var card = top.closest('.s-cat-card');
            if (card) { var o = !card.classList.contains('mb-open'); $$('.s-cat-card.mb-open').forEach(function (c) { c.classList.remove('mb-open'); }); card.classList.toggle('mb-open', o); }
            return;
        }
        var c = e.target.closest && e.target.closest('.s-mod');
        if (c) c.classList.toggle('mb-open');
    });

    /* ---------- 3. виджеты карты — один раскрывающийся виджет ----------
       Кнопка справа вверху раскрывает: горизонтальный ряд влево [рисование, длина, площадь] [поиск, маршрут, моё местоположение, север] и прежние виджеты справа — колонкой вниз.
       Кнопки местоположения, севера, рисования и измерений — те же элементы, что и на десктопе: на телефоне они переносятся в виджет, на десктопе возвращаются на место. */
    var mcr = $('#map-section .map-controls-right'), tg = null, gNav = null, gTools = null;
    function mcOff(off) {
        if (!mcr || !tg) return;
        mcr.classList.toggle('mb-mc-off', off);
        tg.innerHTML = '<i class="fas fa-' + (off ? 'sliders' : 'xmark') + '"></i>';
    }
    if (mcr && !mcr.querySelector('.mb-mc-toggle')) {
        var mrow = document.createElement('div'); mrow.className = 'mb-mc-row';   // кнопка-тоггл и две группы: раскрываются влево от кнопки
        tg = document.createElement('button'); tg.type = 'button'; tg.className = 'mb-mc-toggle'; tg.title = 'Виджеты карты';
        mcr.insertBefore(mrow, mcr.firstChild); mrow.appendChild(tg); mcOff(true);
        tg.addEventListener('click', function () { mcOff(!mcr.classList.contains('mb-mc-off')); });
        gNav = document.createElement('div'); gNav.className = 'mc-group mc-row mb-g mb-g-nav';
        gTools = document.createElement('div'); gTools.className = 'mc-group mc-row mb-g mb-g-tools';
        mrow.appendChild(gNav); mrow.appendChild(gTools);
    }

    // поиск: в шторке скрыт, открывается по кнопке-лупе в виджете
    var sbox = $('#map-section .map-search'), sinp = document.getElementById('searchInput');
    if (gNav && sbox) {
        var sbtn = document.createElement('button'); sbtn.type = 'button'; sbtn.className = 'map-btn mb-search-btn'; sbtn.title = 'Поиск'; sbtn.innerHTML = '<i class="fas fa-search"></i>';
        gNav.appendChild(sbtn);
        // маршрут: кнопка в виджете нажимает штатную «Маршрут» и раскрывает шторку
        var rbtn = document.createElement('button'); rbtn.type = 'button'; rbtn.className = 'map-btn mb-route-btn'; rbtn.title = 'Построить маршрут'; rbtn.innerHTML = '<i class="fas fa-diamond-turn-right"></i>';
        gNav.appendChild(rbtn);
        rbtn.addEventListener('click', function () {
            var r = document.getElementById('routeBtn'); if (r) r.click();
            setTimeout(function () { if (window.gcSheet) window.gcSheet('half'); }, 0);
        });
        // пока открыт поиск, страница стоит на блоке карты (клавиатура и фокус её не сдвигают), а шторка не раскрывается на весь экран
        var keepMap = function () { var y = pos('map-section'); if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' }); };
        window.addEventListener('scroll', function () { if (root.classList.contains('mb-search-open')) keepMap(); }, { passive: true });
        if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (root.classList.contains('mb-search-open')) keepMap(); });
        window.addEventListener('focusin', function (e) { if (mob() && sbox.classList.contains('mb-pop') && e.target === sinp) e.stopPropagation(); }, true);
        var openS = function (on) {
            sbox.classList.toggle('mb-pop', on); root.classList.toggle('mb-search-open', on); sbtn.classList.toggle('on', on);
            if (on && sinp) setTimeout(function () { try { sinp.focus({ preventScroll: true }); } catch (x) { sinp.focus(); } keepMap(); }, 60);
        };
        sbtn.addEventListener('click', function () { openS(!sbox.classList.contains('mb-pop')); });
        document.addEventListener('click', function (e) {
            if (!sbox.classList.contains('mb-pop') || e.target.closest('.mb-search-btn')) return;
            if (e.target.closest('.map-search')) { if (e.target.closest('#searchResults')) setTimeout(function () { openS(false); }, 250); return; }   // выбрали результат — закрываем
            openS(false);
        }, true);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sbox.classList.contains('mb-pop')) openS(false); });
        onMq(function () { if (!mob()) openS(false); });
    }

    // перенос настоящих кнопок (с обработчиками) в виджет и обратно; на месте остаётся комментарий-метка
    var moved = [], tlTools = $('#map-section .map-tl-tools');
    function relocate(el, to) {
        if (!el || !to) return;
        var rec = null; moved.forEach(function (m) { if (m.el === el) rec = m; });
        if (!rec) { rec = { el: el, ph: document.createComment('mb:' + (el.id || 'x')) }; el.parentNode.insertBefore(rec.ph, el); moved.push(rec); }
        to.appendChild(el);
    }
    function placeWidgets() {
        if (!gNav || !gTools) return;
        if (mob()) {
            relocate(document.getElementById('locateBtn'), gNav);
            relocate(document.getElementById('northBtn'), gNav);
            ['drawWidget', 'measureWidget', 'measureAreaWidget'].forEach(function (id) { relocate(document.getElementById(id), gTools); });
        } else {
            moved.forEach(function (m) { if (m.ph.parentNode && m.el.parentNode !== m.ph.parentNode) m.ph.parentNode.insertBefore(m.el, m.ph); });
        }
        if (tlTools) tlTools.classList.toggle('mb-tl-empty', mob());
    }
    onMq(placeWidgets); placeWidgets();

    if (mcr && tg) {
        // выбрали действие (поиск, маршрут, место, рисование, длина, площадь) — виджет сворачивается и освобождает карту; север — остаётся открытым
        mcr.addEventListener('click', function (e) {
            if (!mob() || !e.target.closest || e.target.closest('#northBtn')) return;
            if (e.target.closest('.mb-g button')) setTimeout(function () { mcOff(true); }, 0);
            if (e.target.closest('[data-mmode]')) setTimeout(function () { if (window.gcSheet) window.gcSheet('peek'); }, 0);   // замер включён — шторка не должна закрывать карту
        }, true);
        // нажатие по карте (вне виджета, поиска и шторки) тоже сворачивает виджет
        document.addEventListener('click', function (e) {
            if (!mob() || !e.target.closest || mcr.classList.contains('mb-mc-off')) return;
            if (e.target.closest('.map-controls-right, .map-search, .widget-panel, #mainPanel')) return;
            mcOff(true);
        });
        onMq(function () { if (!mob()) mcOff(true); });
    }

    // ручки у шторки больше нет: повторное нажатие на уже открытую закладку нижнего меню сворачивает шторку
    var railBar = document.getElementById('gcRail');
    if (railBar) railBar.addEventListener('click', function (e) {
        var b = mob() && e.target.closest && e.target.closest('.gc-rail-btn');
        if (!b || b.getAttribute('data-rail') === 'help') return;
        var was = b.classList.contains('on'), shA = $('#map-section .app-container'), sh = shA && shA.getAttribute('data-sheet');
        if (was && sh && sh !== 'peek') setTimeout(function () { if (window.gcSheet) window.gcSheet('peek'); }, 40);
    }, true);

    // местоположение и погода: на карте — внизу по центру; на десктопе блок возвращается на место в шторке
    var loc = document.getElementById('spLoc'), stage = mcr && mcr.parentNode;
    if (loc && stage) {
        var ph = document.createComment('spLoc'); loc.parentNode.insertBefore(ph, loc);
        var placeLoc = function () {
            if (mob()) { if (loc.parentNode !== stage) stage.appendChild(loc); loc.classList.add('mb-loc'); }
            else { if (loc.parentNode !== ph.parentNode) ph.parentNode.insertBefore(loc, ph.nextSibling); loc.classList.remove('mb-loc'); }
        };
        onMq(placeLoc); placeLoc();
    }

    // закладки внизу; нажатие на закладку — кнопки раздела выезжают колонкой слева, шторка скрыта;
    // нажатие на кнопку раздела — его содержимое открывается в шторке (как «Анализ участка»), колонка убирается; «назад» возвращает колонку
    var app = $('#map-section .app-container');
    var rail = document.getElementById('gcRail'), panelEl = document.getElementById('mainPanel'), tkey = null, lastKey = 'main', inRail = false;
    if (app && rail) {
        var tilesOff = function () { app.classList.remove('mb-tiles'); tkey = null; };
        rail.addEventListener('click', function (e) {
            inRail = true; setTimeout(function () { inRail = false; }, 80);
            var hb = mob() && e.target.closest && e.target.closest('.gc-rail-btn'), hk = hb && hb.getAttribute('data-rail');
            if (hb && hk !== 'help' && hk !== 'bookmarks') { app.classList.add('mb-hold'); setTimeout(function () { app.classList.remove('mb-hold'); }, 160); }   // пока site.js на мгновение раскрывает шторку — её не видно
        }, true);
        document.addEventListener('click', function (e) {
            if (!mob() || !e.target.closest) return;
            var rb = e.target.closest('#gcRail .gc-rail-btn');
            if (rb) {
                var k = rb.getAttribute('data-rail');
                if (k === 'help' || k === 'bookmarks') { tilesOff(); return; }
                lastKey = k;
                if (app.classList.contains('mb-tiles') && tkey === k) { tilesOff(); setTimeout(function () { if (window.gcSheet) window.gcSheet('peek'); }, 0); return; }
                app.classList.add('mb-tiles'); tkey = k;
                setTimeout(function () { if (window.gcSheet) window.gcSheet('peek'); }, 0);
                return;
            }
            if (!app.classList.contains('mb-tiles') || e.target.closest('#mainPanel')) return;
            if (panelEl && panelEl.getAttribute('data-view') === 'home') tilesOff();   // клик по карте убирает колонку
        });
        if (panelEl && window.MutationObserver) new MutationObserver(function () {
            if (!mob()) return;
            var v = panelEl.getAttribute('data-view');
            if (v !== 'home') { if (app.classList.contains('mb-tiles')) { tilesOff(); if (window.gcSheet) window.gcSheet('half'); } return; }   // раздел открыт — в шторке
            if (inRail || app.classList.contains('mb-tiles') || app.classList.contains('passport-open')) return;
            var sh = app.getAttribute('data-sheet');
            if (sh && sh !== 'peek') { app.classList.add('mb-tiles'); tkey = lastKey; if (window.gcSheet) window.gcSheet('peek'); }   // «назад» из раздела — колонка кнопок снова слева
        }).observe(panelEl, { attributes: true, attributeFilter: ['data-view'] });
        onMq(function () { if (!mob()) tilesOff(); });
    }

    // паспорт или справка открыты — страница под ними не прокручивается
    var help = document.getElementById('gcHelpWin');
    function lockSync() { root.classList.toggle('mb-lock', mob() && !!((app && app.classList.contains('passport-open')) || (help && !help.hidden))); }
    if (window.MutationObserver) {
        var lo = new MutationObserver(lockSync);
        if (app) lo.observe(app, { attributes: true, attributeFilter: ['class'] });
        if (help) lo.observe(help, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    onMq(lockSync); lockSync();

    /* ---------- 4. паспорт участка: страницы вбок ---------- */
    var pane = document.getElementById('passportPane'), body = document.getElementById('ppBody');
    if (!pane || !body) return;
    var bar = document.createElement('div'); bar.id = 'mbPpBar'; pane.insertBefore(bar, body);
    var slides = [], groups = [], cur = 0, sig = '', buildT = 0, scRaf = 0;

    function secInfo(sec) {
        var h = $('.pp-sec-h h3', sec), ic = $('.pp-sec-h .pp-ic i', sec);
        return { t: h ? h.textContent.trim() : 'Паспорт', ic: ic ? ic.className : 'fas fa-circle', ac: sec.style.getPropertyValue('--ac') || '#059669' };
    }
    function hasContent(el) { return !!(el.textContent.trim() || el.querySelector('svg, canvas, img, table, .leaflet-container')); }
    function mark(el, info) { el.classList.add('mb-slide'); el.setAttribute('data-mb-sec', info.t); el.setAttribute('data-mb-ic', info.ic); el.style.setProperty('--mbac', info.ac); }
    // каждый блок («pp-sub») — отдельная страница; обёртки-сетки между разделом и блоками «растворяются» (display: contents)
    function walk(el, info) {
        Array.prototype.forEach.call(el.children, function (c) {
            if (c.classList.contains('pp-sec-h') || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') { c.classList.add('mb-hide'); return; }
            if (c.classList.contains('pp-sub')) { mark(c, info); return; }
            if (c.querySelector('.pp-sub')) { c.classList.add('mb-flat'); walk(c, info); return; }
            if (hasContent(c)) mark(c, info); else c.classList.add('mb-hide');
        });
    }
    function clear() {
        $$('.mb-slide, .mb-flat, .mb-hide', body).forEach(function (e) {
            e.classList.remove('mb-slide', 'mb-flat', 'mb-hide'); e.removeAttribute('data-mb-sec'); e.removeAttribute('data-mb-ic'); e.style.removeProperty('--mbac');
        });
    }
    function build() {
        clear();
        if (!mob()) { slides = []; return; }
        Array.prototype.forEach.call(body.children, function (c) {
            if (c.classList.contains('pp-bar')) { c.classList.add('mb-hide'); return; }                          // длинная подсказка про «Расшифровку»
            if (c.classList.contains('pp-sec')) { c.classList.add('mb-flat'); walk(c, secInfo(c)); return; }
            if (c.classList.contains('pp-kpis')) { mark(c, { t: 'Сводка', ic: 'fas fa-gauge-high', ac: '#059669' }); return; }
            if (hasContent(c)) mark(c, { t: 'Паспорт', ic: 'fas fa-id-card', ac: '#059669' }); else c.classList.add('mb-hide');
        });
        slides = $$('.mb-slide', body);
        groups = [];
        slides.forEach(function (s, i) {
            var t = s.getAttribute('data-mb-sec');
            if (!groups.length || groups[groups.length - 1].t !== t) groups.push({ t: t, ic: s.getAttribute('data-mb-ic'), ac: s.style.getPropertyValue('--mbac'), first: i });
        });
        var s2 = groups.map(function (g) { return g.t + ':' + g.first; }).join('|') + '#' + slides.length;
        if (s2 !== sig) { sig = s2; drawBar(); }
        if (cur >= slides.length) cur = Math.max(0, slides.length - 1);
        mark2();
    }
    function drawBar() {
        if (!slides.length) { bar.innerHTML = ''; return; }
        bar.innerHTML = '<button type="button" class="mb-ar" data-d="-1" aria-label="Назад"><i class="fas fa-chevron-left"></i></button><div class="mb-chs">' +
            groups.map(function (g, k) { return '<button type="button" class="mb-ch" data-k="' + k + '" style="--c:' + esc(g.ac) + '"><i class="' + esc(g.ic) + '"></i><span>' + esc(g.t) + '</span></button>'; }).join('') +
            '</div><span class="mb-cnt"></span><button type="button" class="mb-ar" data-d="1" aria-label="Вперёд"><i class="fas fa-chevron-right"></i></button><i class="mb-pg"><b></b></i>';
    }
    function mark2() {   // отметить текущую страницу в полосе
        var n = slides.length; if (!n) return;
        var cnt = $('.mb-cnt', bar), pg = $('.mb-pg b', bar); if (cnt) cnt.textContent = (cur + 1) + ' / ' + n; if (pg) pg.style.width = ((cur + 1) / n * 100) + '%';
        var gi = 0; groups.forEach(function (g, k) { if (g.first <= cur) gi = k; });
        $$('.mb-ch', bar).forEach(function (b, k) {
            var on = k === gi; b.classList.toggle('on', on);
            if (on) { var w = b.parentNode; if (w && (b.offsetLeft < w.scrollLeft || b.offsetLeft + b.offsetWidth > w.scrollLeft + w.clientWidth)) w.scrollTo({ left: Math.max(0, b.offsetLeft - 30), behavior: 'smooth' }); }
        });
        var pv = $('.mb-ar[data-d="-1"]', bar), nx = $('.mb-ar[data-d="1"]', bar); if (pv) pv.disabled = cur <= 0; if (nx) nx.disabled = cur >= n - 1;
    }
    function go(i) { i = Math.max(0, Math.min(slides.length - 1, i)); body.scrollTo({ left: i * body.clientWidth, behavior: 'smooth' }); }
    bar.addEventListener('click', function (e) {
        var c = e.target.closest('.mb-ch'), a = e.target.closest('.mb-ar');
        if (c) { var g = groups[+c.getAttribute('data-k')]; if (g) go(g.first); } else if (a && !a.disabled) go(cur + (+a.getAttribute('data-d')));
    });
    body.addEventListener('scroll', function () {
        if (scRaf || !mob()) return;
        scRaf = requestAnimationFrame(function () { scRaf = 0; var i = Math.round(body.scrollLeft / (body.clientWidth || 1)); if (i !== cur) { cur = Math.max(0, Math.min(slides.length - 1, i)); mark2(); } });
    }, { passive: true });

    // паспорт строится и дозагружается постепенно — страницы пересчитываются после паузы (мутации внутри карт игнорируем)
    function sched() { clearTimeout(buildT); buildT = setTimeout(build, 250); }
    if (window.MutationObserver) {
        new MutationObserver(function (rs) {
            if (!mob()) return;
            for (var i = 0; i < rs.length; i++) { var n = rs[i].target.nodeType === 1 ? rs[i].target : rs[i].target.parentNode; if (n && n.closest && n.closest('.leaflet-container')) continue; sched(); return; }
        }).observe(body, { childList: true, subtree: true });
    }
    document.addEventListener('passport-open', sched);
    onMq(function () { sig = ''; build(); });
    window.addEventListener('orientationchange', function () { setTimeout(function () { go(cur); }, 300); });
    build();
})();
