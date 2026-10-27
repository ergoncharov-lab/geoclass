/* Кнопка «?» в шапке боковой панели: открывает справку на блоке текущего раздела */
(function () {
    var btn = document.getElementById('spHelpBtn'), back = document.getElementById('spBack'), panel = document.getElementById('mainPanel');
    var win = document.getElementById('gcHelpWin'), frame = win && win.querySelector('iframe');
    if (!btn || !back || !panel || !frame) return;

    // раздел боковой панели → якорь в help.html
    var BP = {
        profile: 'an-profile', logistics: 'an-logistics', chem: 'an-soil', shape: 'an-shape',
        dates: 'im-dates', ndvi: 'im-ndvi', ndmi: 'im-ndmi', nbr: 'im-nbr', change: 'im-change',
        draw: 'tl-draw', measure: 'tl-measure', '3d': 'tl-3d', 'export': 'tl-export', agro: 'tl-agro',
        cadastre: 'ly-cadastre', userlayers: 'ly-user', catalog: 'ly-catalog',
        weather: 'wx-forecast', climate: 'wx-climate', gdd: 'wx-gdd', frost: 'wx-frost', windwork: 'wx-wind',
        gndvi: 'im-gndvi', ndre: 'im-ndre', savi: 'im-savi', ndwi: 'im-ndwi', ndti: 'im-ndti',   // индексы: раньше для них кнопка «?» была скрыта
        soil: 'ly-soil', objects: 'ly-objects', matrix: 'tl-matrix'
    };
    var TAB = { analysis: 'an-site', reports: 'st-reports', catalog: 'ly-catalog', bookmarks: 'st-bm', sources: 'src' };

    var st = document.createElement('style');
    st.textContent = '.sp-help-btn{margin-left:auto;flex:none;width:24px;height:24px;border-radius:50%;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:color .15s,background .15s,border-color .15s}' +
        '.sp-help-btn:hover{background:var(--soft);color:var(--green);border-color:var(--softline)}.sp-help-btn[hidden]{display:none}';
    document.head.appendChild(st);

    function key() {
        var v = panel.getAttribute('data-view'), t;
        if (v === 'bp') { t = document.querySelector('.bp-tab.active'); return t && BP[t.getAttribute('data-bp-tab')]; }
        if (v === 'tab') { t = document.querySelector('.panel-tab.active'); return t && TAB[t.getAttribute('data-tab')]; }
        return null;
    }
    function update() { var hide = !key(); if (btn.hidden !== hide) btn.hidden = hide; }   // меняем только при реальной смене, иначе наблюдатель зациклится
    var title = document.getElementById('spBackTitle'), mo = new MutationObserver(update);
    if (title) mo.observe(title, { childList: true, characterData: true, subtree: true });
    mo.observe(panel, { attributes: true, attributeFilter: ['data-view'] });
    document.addEventListener('click', function () { setTimeout(update, 0); });

    var ready = false;
    try { ready = frame.contentDocument.readyState === 'complete' && !!frame.getAttribute('src'); } catch (e) { /* ещё не загружено */ }
    frame.addEventListener('load', function () { ready = true; });
    var app = document.querySelector('#map-section .app-container');
    new MutationObserver(function () { if (win.hidden) win.style.zIndex = ''; }).observe(win, { attributes: true, attributeFilter: ['hidden'] });
    function openAt(id) {
        var rail = document.querySelector('.gc-rail-btn[data-rail="help"]');
        if (win.hidden) { if (rail) rail.click(); else win.hidden = false; }
        if (app && app.classList.contains('passport-open')) win.style.zIndex = '2600';   // поверх открытого паспорта участка
        function send() { try { frame.contentWindow.postMessage({ gcHelpGoto: id }, '*'); } catch (e) { /* окно справки недоступно */ } }
        if (ready) setTimeout(send, 60);
        else { frame.addEventListener('load', function f() { frame.removeEventListener('load', f); setTimeout(send, 60); }); if (!frame.getAttribute('src')) frame.src = 'help.html'; }
    }
    window.gcOpenHelp = openAt;   // используется кнопками «?» в паспорте участка
    btn.addEventListener('click', function () { var id = key(); if (id) openAt(id); });
    update();
})();
