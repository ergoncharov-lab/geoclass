/* Паспорт участка: разделы-блоки, мини-карты, расчёты. Данные берутся из выбранной (или последней нарисованной) фигуры либо из сохранённого отчёта.
   Использует глобальные объекты карты: map, GC_SHAPES, gcSel, turf, а также мосты ppDem / ppOverpass / ppSoil из script.js. */
(function () {
    var body = document.getElementById('ppBody');
    if (!body) return;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var nf = function (v, d) { return isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: d == null ? 1 : d }) : '—'; };
    var minis = {}, m3s = {}, seq = 0, D = {}, forced = null, keep = false, retry = null;   // forced — контур из сохранённого отчёта
    var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    var DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

    // ---------- фигура ----------
    function toGJ(l) {
        try {
            if (l instanceof L.Circle) { var c = l.getLatLng(); return turf.circle([c.lng, c.lat], l.getRadius() / 1000, { steps: 64, units: 'kilometers' }); }
            var g = l.toGeoJSON(), f = g.type === 'FeatureCollection' ? g.features[0] : g;
            if (f && f.geometry && /Polygon/.test(f.geometry.type)) return f;
        } catch (e) { /* не полигон */ }
        return null;
    }
    function pick() {
        var c = []; GC_SHAPES.forEach(function (l) { if (map.hasLayer(l) && toGJ(l)) c.push(l); });
        return (gcSel && c.indexOf(gcSel) >= 0) ? gcSel : (c[c.length - 1] || null);
    }
    var polysOf = function (g) { return g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : g.geometry.coordinates; };
    var hav = function (a, b, c, d) { var R = 6371000, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r * Math.cos((a + c) / 2 * r); return R * Math.hypot(x, y); };
    function inRing(x, y, r) { var c = false, i, j; for (i = 0, j = r.length - 1; i < r.length; j = i++) { var a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
    function inPolys(x, y, polys) { return polys.some(function (p) { return inRing(x, y, p[0]) && !p.slice(1).some(function (h) { return inRing(x, y, h); }); }); }

    // ---------- разметка ----------
    // ---------- разметка (v2: цветные разделы, квадратные карты, расшифровка у каждого блока) ----------
    var CC = { gen: '#6366f1', cls: '#16a34a', sat: '#7c3aed', soil: '#92400e', rel: '#0d9488', log: '#ea580c', clim: '#2563eb', sum: '#059669' };
    var SPIN = '<div class="pp-note"><i class="fas fa-spinner fa-spin"></i> Загружаем данные…</div>';
    function sec(n, icon, title, sub, color, inner) { return '<section class="pp-sec" style="--ac:' + color + '"><div class="pp-sec-h"><span class="pp-ic"><i class="fas fa-' + icon + '"></i></span><div class="pp-ht"><h3>' + title + '</h3><p>' + sub + '</p></div><span class="pp-n">' + n + '</span></div><div class="pp-sec-b">' + inner + '</div></section>'; }
    // блок: o.t — заголовок, o.i — значок, o.c — цвет, o.info — [что это, зачем нужно, как считается], o.map — колонка слева (квадратная карта), o.id/o.body — данные справа
    // ---------- кнопка «?» в шапке блока: открывает справку на нужном разделе ----------
    var HELP_ID = { ppWx_w: 'wx-wind', ppWx_f: 'wx-forecast', ppWx_b: 'wx-frost', ppWx_c: 'wx-climate', ppSoilSum: 'an-soil', ppCadBody: 'ly-cadastre' };
    var HELP_T = [[/^Границы/, 'an-shape'], [/кадастр/i, 'ly-cadastre'], [/землепользования/, 'an-site'], [/^Sentinel-2/, 'im-dates'],
        [/^NDVI/, 'im-ndvi'], [/^NDMI/, 'im-ndmi'], [/^NBR/, 'im-nbr'], [/^GNDVI/, 'im-gndvi'], [/^NDRE/, 'im-ndre'], [/^SAVI/, 'im-savi'], [/^NDWI/, 'im-ndwi'], [/^NDTI/, 'im-ndti'],
        [/Сводные расчётные/, 'an-soil'], [/^(Высоты|Уклоны|Экспозиция)/, 'an-profile'], [/^3D/, 'tl-3d'],
        [/^(Ближайшие|Расстояния|Дорожная)/, 'an-logistics'], [/^Солнечный/, 'wx-climate']];
    function helpOf(o) {
        if (o.help) return o.help;
        if (o.id) { if (HELP_ID[o.id]) return HELP_ID[o.id]; if (/^ppSB_/.test(o.id)) return 'an-soil'; var m = /^ppSatB_(.+)$/.exec(o.id); if (m) return m[1] === 's2rgb' ? 'im-dates' : 'im-' + m[1]; }
        for (var i = 0; i < HELP_T.length; i++) if (HELP_T[i][0].test(o.t || '')) return HELP_T[i][1];
        return 'st-reports';
    }
    function helpBtn(o) { return '<button type="button" class="pp-h-btn" data-help="' + helpOf(o) + '" title="Открыть справку по этому блоку" aria-label="Справка"><i class="fas fa-circle-question"></i></button>'; }

    function blk(o) {
        var f = o.info;
        return '<div class="pp-sub closed' + (o.map ? '' : ' nomap') + (o.cls ? ' ' + o.cls : '') + '"' + (o.c ? ' style="--ac:' + o.c + '"' : '') + '><div class="pp-sub-h"><span class="pp-ic sm"><i class="fas fa-' + o.i + '"></i></span><h4>' + o.t + '</h4>' +
            (o.cal || '') + '<button type="button" class="pp-i-btn"><i class="fas fa-circle-info"></i> Расшифровка</button>' + helpBtn(o) + '</div>' +
            '<div class="pp-info"><div><b>Что это</b>' + f[0] + '</div><div><b>Зачем нужно</b>' + f[1] + '</div><div><b>Как рассчитывается</b>' + f[2] + '</div></div>' +
            '<div class="pp-mc">' + (o.map ? '<div class="pp-mcol">' + o.map + '</div>' : '') + '<div class="pp-dcol"' + (o.id ? ' id="' + o.id + '"' : '') + '>' + (o.body || '') + '</div></div></div>';
    }
    // экспорт карты одним меню: PDF, GeoTIFF (если есть), KML; выбор даты снимка остаётся рядом
    function dlMenu(key, extra) {
        var ex = extra || '', tifs = ex.match(/<button(?=[^>]*(?:data-(?:sat-)?tif=|\sdisabled))[^>]*>[\s\S]*?<\/button>/g) || [];   // GeoTIFF и заглушки векторного экспорта
        tifs.forEach(function (t) { ex = ex.replace(t, ''); });
        return ex + '<details class="pp-cadmenu pp-expm"><summary class="pp-btn pp-vcopy" title="Экспорт карты"><i class="fas fa-download"></i> Экспорт <i class="fas fa-chevron-down"></i></summary><div class="pp-cadmenu-l">' +
            '<button type="button" class="pp-btn pp-pdf" data-pdf="' + key + '"><i class="fas fa-file-pdf"></i> PDF</button>' + tifs.join('') +
            (/KML/.test(tifs.join('')) ? '' : '<button type="button" class="pp-btn" data-kml="' + key + '"><i class="fas fa-file-export"></i> KML</button>') + '</div></details>';
    }
    // страховка: любая кнопка GeoTIFF (или PDF карты), оказавшаяся в .pp-dl вне меню «Экспорт», переезжает в меню
    var expT = 0;
    // пока меню «Экспорт» открыто, все объемлющие блоки поднимаются над соседями (position не трогаем — иначе «липкая» карта дёргается)
    function zupSync() {
        Array.prototype.forEach.call(body.querySelectorAll('.pp-zup'), function (x) { x.classList.remove('pp-zup'); });
        Array.prototype.forEach.call(body.querySelectorAll('.pp-expm[open], .pp-cal.open'), function (d) {
            for (var n = d.parentNode; n && n !== body.parentNode; n = n.parentNode) { if (n.classList) n.classList.add('pp-zup'); }
        });
    }
    body.addEventListener('toggle', zupSync, true);
    if (window.MutationObserver) new MutationObserver(function (rs) {   // календарь выбора даты открывается классом .open
        for (var k = 0; k < rs.length; k++) if (rs[k].target.classList && rs[k].target.classList.contains('pp-cal')) { zupSync(); return; }
    }).observe(body, { attributes: true, attributeFilter: ['class'], subtree: true });
    function expMerge() {
        Array.prototype.forEach.call(body.querySelectorAll('.pp-dl'), function (dl) {
            var menu = dl.querySelector('.pp-expm .pp-cadmenu-l'); if (!menu) return;
            Array.prototype.forEach.call(dl.querySelectorAll('[data-tif], [data-sat-tif], [data-pdf]'), function (b) {
                if (!menu.contains(b)) menu.insertBefore(b, menu.querySelector('[data-kml]'));
            });
        });
    }
    if (window.MutationObserver) new MutationObserver(function () { clearTimeout(expT); expT = setTimeout(expMerge, 120); }).observe(body, { childList: true, subtree: true });
    // квадратная карта + легенда + кнопки скачивания (extra — дополнительные кнопки)
    function mapBox(key, extra, title) {
        return '<div class="pp-mapw">' + (title ? '<div class="pp-mt">' + title + '</div>' : '') + '<div class="pp-map" data-map="' + key + '"></div><div class="pp-leg2" id="ppLeg_' + key + '"></div>' +
            '<div class="pp-dl">' + dlMenu(key, extra) + '</div></div>';
    }
    function mapBox3(key, title) {
        return '<div class="pp-mapw"><div class="pp-mt">' + title + '</div><div class="pp-map" data-map3="' + key + '"></div>' +
            '<div class="pp-dl"><button type="button" class="pp-btn pp-pdf" data-pdf3="' + key + '"><i class="fas fa-file-pdf"></i> 3D в PDF</button></div></div>';
    }
    function kv(rows) { rows = rows.filter(function (r) { return r[1] !== '' && r[1] != null; }); return '<table class="pp-tbl">' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>'; }
    function dis(label, icon, why) { return '<button type="button" class="pp-btn" disabled title="' + esc(why) + '"><i class="fas fa-' + icon + '"></i> ' + label + '</button>'; }
    // плитки показателей: [подпись, значение, пояснение, цвет]
    function tiles(a) { return '<div class="pp-tiles">' + a.map(function (t) { return '<div class="pp-tile"' + (t[3] ? ' style="--c:' + t[3] + '"' : '') + '><span>' + t[0] + '</span><b>' + t[1] + '</b>' + (t[2] ? '<em>' + t[2] + '</em>' : '') + '</div>'; }).join('') + '</div>'; }
    function chart(t, inner, cap) { return '<div class="pp-ch"><h5>' + t + '</h5>' + inner + (cap ? '<div class="pp-cap">' + cap + '</div>' : '') + '</div>'; }
    var cl01 = function (x) { return Math.max(0, Math.min(1, x)); };
    var avg = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
    function mix(a, b, t) { var p = function (h, i) { return parseInt(h.substr(i, 2), 16); }; return 'rgb(' + [1, 3, 5].map(function (i) { return Math.round(p(a, i) + (p(b, i) - p(a, i)) * t); }).join(',') + ')'; }
    // шкала-«термометр»: z — [[верхняя граница, цвет]…], v — значение участка
    function meter(z, v, lo, hi, d) {
        var rg = (hi - lo) || 1, prev = lo, bars = '', pos = cl01((v - lo) / rg) * 100;
        z.forEach(function (q) { var t = Math.min(q[0], hi); if (t > prev) { bars += '<i style="width:' + ((t - prev) / rg * 100).toFixed(2) + '%;background:' + q[1] + '"></i>'; prev = t; } });
        return '<div class="pp-mt2"><div class="z">' + bars + '</div><div class="p" style="left:' + pos.toFixed(1) + '%"></div><div class="l"><span>' + nf(lo, d) + '</span><span>' + nf(hi, d) + '</span></div></div>';
    }
    // строки классов (как в калькуляторе индексов): цвет, название, площадь, доля, полоска
    function clsRows(it) {
        return '<div class="pp-cls">' + it.map(function (x) { return '<div class="r" style="--c:' + x.c + ';--w:' + (x.v * 100).toFixed(1) + '%"><i></i><span>' + x.l + (x.s ? '<em>' + x.s + '</em>' : '') + '</span><u>' + (x.t || '') + '</u><b>' + nf(x.v * 100, 1) + '%</b><s></s></div>'; }).join('') + '</div>';
    }
    function donut(sl, big, small) {
        var tot = sl.reduce(function (s, x) { return s + x.v; }, 0), C2 = 2 * Math.PI * 46, acc = 0, circ = '';
        if (tot > 0) sl.forEach(function (x) { var d = x.v / tot * C2; if (d > 0) circ += '<circle cx="70" cy="70" r="46" stroke="' + x.c + '" stroke-dasharray="' + d.toFixed(2) + ' ' + C2.toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"><title>' + esc(x.l) + ': ' + nf(x.v / tot * 100, 1) + '%</title></circle>'; acc += d; });
        else circ = '<circle cx="70" cy="70" r="46" stroke="#cbd5e1" stroke-dasharray="6 5"/>';
        return '<svg viewBox="0 0 140 140" class="pp-svg pp-donut"><g fill="none" stroke-width="22" transform="rotate(-90 70 70)">' + circ + '</g><text x="70" y="69" text-anchor="middle" class="big">' + (big == null ? '—' : big) + '</text><text x="70" y="84" text-anchor="middle" class="sm">' + (small || '') + '</text></svg>';
    }
    // гистограмма: столбцы окрашены цветом карты (colFn(0..1)), по оси Y — доля площади; marks — [{v, c, l}] вертикальные штрихи
    function hist2(h, colFn, lo, hi, d, unit, marks) {
        var n = h.length, tot = h.reduce(function (s, v) { return s + v; }, 0) || 1, W = 340, H = 168, L = 36, R = 8, T = 10, B = 34, cw = (W - L - R) / n, ph = H - T - B, i;
        var mx = Math.max.apply(null, h) / tot, st = [0.04, 0.08, 0.12, 0.16, 0.2, 0.3, 0.4, 0.5, 0.75, 1], yt = 1;
        for (i = 0; i < st.length; i++) if (st[i] >= mx) { yt = st[i]; break; }
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pp-svg">';
        [0, 0.5, 1].forEach(function (f) { var y = T + ph * (1 - f); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (L - 5) + '" y="' + (y + 3) + '" text-anchor="end">' + nf(yt * f * 100, 0) + '%</text>'; });
        h.forEach(function (v, k) { var bh = v / tot / yt * ph, x = L + k * cw; s += '<rect x="' + (x + 1).toFixed(1) + '" y="' + (T + ph - bh).toFixed(1) + '" width="' + (cw - 2).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2.5" fill="' + colFn((k + 0.5) / n) + '"><title>' + nf(lo + (hi - lo) * k / n, d) + ' – ' + nf(lo + (hi - lo) * (k + 1) / n, d) + ' ' + esc(unit) + ': ' + nf(v / tot * 100, 1) + '% площади</title></rect>'; });
        for (i = 0; i <= 4; i++) s += '<text x="' + (L + (W - L - R) * i / 4).toFixed(1) + '" y="' + (T + ph + 13) + '" text-anchor="' + (i === 0 ? 'start' : i === 4 ? 'end' : 'middle') + '">' + nf(lo + (hi - lo) * i / 4, d) + '</text>';
        s += '<text x="' + (L + (W - L - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(unit) + ' · доля площади участка</text>';
        (marks || []).forEach(function (m) { var x = L + cl01((m.v - lo) / ((hi - lo) || 1)) * (W - L - R); s += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (T - 2) + '" y2="' + (T + ph) + '" stroke="' + m.c + '" stroke-width="1.8" stroke-dasharray="4 3"/>'; });
        s += '</svg>';
        if (marks && marks.length) s += '<div class="pp-mk">' + marks.map(function (m) { return '<span style="--c:' + m.c + '">' + m.l + ' ' + nf(m.v, d) + '</span>'; }).join('') + '</div>';
        return s;
    }
    // роза экспозиций: 8 румбов
    function rose(v, labs, cols) {
        var mx = Math.max.apply(null, v.concat([1])), tot = v.reduce(function (s, x) { return s + x; }, 0) || 1, s = '<svg viewBox="0 0 200 200" class="pp-svg">', k;
        var p = function (r, a) { var t = (a - 90) * Math.PI / 180; return [100 + r * Math.cos(t), 100 + r * Math.sin(t)]; }, ps = function (r, a) { var q = p(r, a); return q[0].toFixed(1) + ',' + q[1].toFixed(1); };
        [28, 52, 76].forEach(function (r) { s += '<circle cx="100" cy="100" r="' + r + '" fill="none" class="gl"/>'; });
        for (k = 0; k < 8; k++) {
            var r1 = 14 + v[k] / mx * 62, a0 = k * 45 - 19, a1 = k * 45 + 19, lp = p(91, k * 45);
            s += '<path d="M' + ps(r1, a0) + ' A' + r1.toFixed(1) + ' ' + r1.toFixed(1) + ' 0 0 1 ' + ps(r1, a1) + ' L' + ps(14, a1) + ' A14 14 0 0 0 ' + ps(14, a0) + ' Z" fill="' + cols[k] + '" fill-opacity=".88"><title>' + labs[k] + ': ' + nf(v[k] / tot * 100, 1) + '%</title></path>';
            s += '<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 3).toFixed(1) + '" text-anchor="middle" class="rl">' + labs[k] + '</text>';
        }
        return s + '</svg>';
    }
    // гипсометрическая кривая: какая доля площади лежит выше заданной отметки (arr — отсортированные высоты)
    function hypso(arr, mn, mx, colF) {
        var W = 340, H = 168, L = 40, R = 8, T = 10, B = 34, ph = H - T - B, pw = W - L - R, n = arr.length, pts = [], q, i, sp = (mx - mn) || 1, s;
        for (q = 0; q <= 100; q += 4) pts.push([L + pw * q / 100, T + ph * (1 - (arr[Math.min(n - 1, Math.floor((1 - q / 100) * (n - 1)))] - mn) / sp)]);
        var pl = pts.map(function (a) { return a[0].toFixed(1) + ',' + a[1].toFixed(1); });
        s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pp-svg"><defs><linearGradient id="ppHg" x1="0" y1="1" x2="0" y2="0">' + [0, 0.25, 0.5, 0.75, 1].map(function (t) { return '<stop offset="' + t + '" stop-color="' + colF(t) + '"/>'; }).join('') + '</linearGradient></defs>';
        [0, 0.5, 1].forEach(function (f) { var y = T + ph * (1 - f); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (L - 5) + '" y="' + (y + 3) + '" text-anchor="end">' + nf(mn + sp * f, 0) + '</text>'; });
        s += '<path d="M' + L + ',' + (T + ph) + ' L' + pl.join(' L') + ' L' + (W - R) + ',' + (T + ph) + ' Z" fill="url(#ppHg)" fill-opacity=".88"/><polyline points="' + pl.join(' ') + '" fill="none" stroke="#0f172a" stroke-width="1.5"/>';
        for (i = 0; i <= 4; i++) s += '<text x="' + (L + pw * i / 4) + '" y="' + (T + ph + 13) + '" text-anchor="' + (i === 0 ? 'start' : i === 4 ? 'end' : 'middle') + '">' + (i * 25) + '%</text>';
        return s + '<text x="' + (L + pw / 2) + '" y="' + (H - 4) + '" text-anchor="middle">доля площади выше отметки (высота, м — слева)</text></svg>';
    }
    function scCol(v) { return v >= 75 ? '#16a34a' : v >= 55 ? '#84cc16' : v >= 40 ? '#eab308' : v >= 25 ? '#f97316' : '#dc2626'; }
    // радар пригодности: a — [{l, v 0..100 или null}]
    function radar(a) {
        var n = a.length, s = '<svg viewBox="-24 0 288 216" class="pp-svg pp-radar">', pt = function (r, i) { var t = (i * 360 / n - 90) * Math.PI / 180; return [120 + r * Math.cos(t), 108 + r * Math.sin(t)]; }, ptS = function (r, i) { return pt(r, i).map(function (x) { return x.toFixed(1); }).join(','); };
        [0.25, 0.5, 0.75, 1].forEach(function (f) { s += '<polygon points="' + a.map(function (_, i) { return ptS(72 * f, i); }).join(' ') + '" class="rg"/>'; });
        a.forEach(function (x, i) { var e = pt(72, i), l = pt(88, i); s += '<line x1="120" y1="108" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '" class="rg"/><text x="' + l[0].toFixed(1) + '" y="' + (l[1] + 3).toFixed(1) + '" text-anchor="middle">' + (x.r || x.l) + ' ' + (x.v == null ? 'н/д' : Math.round(x.v)) + '</text>'; });
        var ok = a.filter(function (x) { return x.v != null; }), av = ok.length ? avg(ok.map(function (x) { return x.v; })) : null, col = av == null ? '#64748b' : scCol(av);
        s += '<polygon points="' + a.map(function (x, i) { return ptS(72 * (x.v || 0) / 100, i); }).join(' ') + '" fill="' + col + '" fill-opacity=".35" stroke="' + col + '" stroke-width="2"/>';
        a.forEach(function (x, i) { if (x.v != null) { var q = pt(72 * x.v / 100, i); s += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3.6" fill="' + scCol(x.v) + '" stroke="#fff" stroke-width="1.2"/>'; } });
        return { svg: s + '</svg>', avg: av };
    }
    var MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    // климатограмма: столбцы — осадки по месяцам, линия — средняя температура
    function climo(tM, pM) {
        var W = 350, H = 190, L = 36, R = 36, T = 16, B = 28, pw = W - L - R, ph = H - T - B, bw = pw / 12, k;
        var tmn = Math.min(0, Math.floor(Math.min.apply(null, tM) / 5) * 5), tmx = Math.max(5, Math.ceil(Math.max.apply(null, tM) / 5) * 5), pmx = Math.max(20, Math.ceil(Math.max.apply(null, pM) / 20) * 20);
        var ty = function (t) { return T + ph * (1 - (t - tmn) / (tmx - tmn)); }, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pp-svg">';
        for (k = 0; k <= 4; k++) { var y = T + ph * k / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (L - 5) + '" y="' + (y + 3) + '" text-anchor="end" style="fill:#dc2626">' + nf(tmx - (tmx - tmn) * k / 4, 0) + '°</text><text x="' + (W - R + 5) + '" y="' + (y + 3) + '" style="fill:#0284c7">' + nf(pmx - pmx * k / 4, 0) + '</text>'; }
        s += '<text x="' + (W - R + 5) + '" y="' + (T - 5) + '" style="fill:#0284c7">мм</text>';
        pM.forEach(function (v, i) { var h = v / pmx * ph; s += '<rect x="' + (L + i * bw + 4).toFixed(1) + '" y="' + (T + ph - h).toFixed(1) + '" width="' + (bw - 8).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="#38bdf8" fill-opacity=".8"><title>' + MON[i] + ': ' + nf(v, 0) + ' мм</title></rect>'; });
        if (tmn < 0) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ty(0).toFixed(1) + '" y2="' + ty(0).toFixed(1) + '" stroke="#64748b" stroke-dasharray="4 3"/>';
        var pl = tM.map(function (t, i) { return (L + (i + 0.5) * bw).toFixed(1) + ',' + ty(t).toFixed(1); });
        s += '<polyline points="' + pl.join(' ') + '" fill="none" stroke="#ef4444" stroke-width="2.4" stroke-linejoin="round"/>';
        tM.forEach(function (t, i) { s += '<circle cx="' + (L + (i + 0.5) * bw).toFixed(1) + '" cy="' + ty(t).toFixed(1) + '" r="3.2" fill="#ef4444" stroke="#fff"><title>' + MON[i] + ': ' + nf(t, 1) + ' °C</title></circle><text x="' + (L + (i + 0.5) * bw).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + MON[i] + '</text>'; });
        return s + '</svg><div class="pp-mk"><span style="--c:#38bdf8">осадки, мм (столбцы)</span><span style="--c:#ef4444">средняя температура, °C (линия)</span></div>';
    }
    function dayLen(lat, N) { var d = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + N) / 365), p = lat * Math.PI / 180, x = cl01((-Math.tan(p) * Math.tan(d) + 1) / 2) * 2 - 1; return 24 / Math.PI * Math.acos(x); }
    function dayChart(dl) {   // площадная диаграмма: ось в часах, подписи у каждой точки, макс/мин выделены
        var W = 380, H = 210, L = 36, R = 12, T = 26, B = 28, pw = W - L - R, ph = H - T - B, bw = pw / 12, mn = Math.min.apply(null, dl), mx = Math.max.apply(null, dl),
            lo = Math.max(0, Math.floor(mn - 1)), hi = Math.min(24, Math.ceil(mx + 1)), stp = (hi - lo) > 10 ? 4 : 2, i, v;
        var X = function (k) { return L + (k + 0.5) * bw; }, Y = function (z) { return T + ph * (1 - (z - lo) / ((hi - lo) || 1)); };
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pp-svg"><defs><linearGradient id="ppDg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity=".55"/><stop offset="1" stop-color="#3b82f6" stop-opacity=".12"/></linearGradient></defs>';
        for (v = lo; v <= hi; v += stp) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="gl"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" style="font-size:11px">' + v + ' ч</text>';
        var pts = dl.map(function (z, k) { return X(k).toFixed(1) + ',' + Y(z).toFixed(1); });
        s += '<polygon points="' + X(0).toFixed(1) + ',' + (T + ph) + ' ' + pts.join(' ') + ' ' + X(11).toFixed(1) + ',' + (T + ph) + '" fill="url(#ppDg)"/><polyline points="' + pts.join(' ') + '" fill="none" stroke="#f59e0b" stroke-width="2.6" stroke-linejoin="round"/>';
        dl.forEach(function (z, k) {
            var ext = z === mx || z === mn, hh = Math.floor(z), mm = Math.round((z - hh) * 60); if (mm === 60) { hh++; mm = 0; }
            s += '<circle cx="' + X(k).toFixed(1) + '" cy="' + Y(z).toFixed(1) + '" r="' + (ext ? 5 : 3.4) + '" fill="' + mix('#3b82f6', '#f59e0b', (z - mn) / ((mx - mn) || 1)) + '" stroke="#fff" stroke-width="1.5"><title>' + MON[k] + ': ' + hh + ' ч ' + mm + ' мин</title></circle>' +
                '<text x="' + X(k).toFixed(1) + '" y="' + (Y(z) - 9).toFixed(1) + '" text-anchor="middle" style="font-size:' + (ext ? 11.5 : 10) + 'px;font-weight:' + (ext ? 800 : 600) + ';fill:' + (ext ? '#0f172a' : '#475569') + '">' + nf(z, 1) + '</text>' +
                '<text x="' + X(k).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" style="font-size:11px">' + MON[k] + '</text>';
        });
        return s + '</svg>';
    }
    function gtkCl(g) { return g < 0.4 ? ['сухо', '#dc2626'] : g < 0.7 ? ['очень засушливо', '#f97316'] : g < 1.0 ? ['засушливо', '#eab308'] : g < 1.3 ? ['слабо засушливо', '#84cc16'] : g < 1.6 ? ['достаточно влажно', '#22c55e'] : ['избыточно влажно', '#0ea5e9']; }
    function agroT(s) { return s < 1600 ? ['холодный: ранние и холодостойкие культуры', '#3b82f6'] : s < 2200 ? ['умеренный: яровая пшеница, ячмень, картофель', '#06b6d4'] : s < 3000 ? ['тёплый: кукуруза, подсолнечник, сахарная свёкла', '#f59e0b'] : ['жаркий: соя, рис, виноград, бахчевые', '#ef4444']; }
    function usda(sa, si, cl) {
        if (si + 1.5 * cl < 15) return 'песок (sand)';
        if (si + 1.5 * cl >= 15 && si + 2 * cl < 30) return 'песчаная супесь (loamy sand)';
        if ((cl >= 7 && cl < 20 && sa > 52 && si + 2 * cl >= 30) || (cl < 7 && si < 50 && si + 2 * cl >= 30)) return 'супесь (sandy loam)';
        if (cl >= 7 && cl < 27 && si >= 28 && si < 50 && sa <= 52) return 'суглинок (loam)';
        if ((si >= 50 && cl >= 12 && cl < 27) || (si >= 50 && si < 80 && cl < 12)) return 'пылеватый суглинок (silt loam)';
        if (si >= 80 && cl < 12) return 'пыль (silt)';
        if (cl >= 20 && cl < 35 && si < 28 && sa > 45) return 'песчанисто-глинистый суглинок (sandy clay loam)';
        if (cl >= 27 && cl < 40 && sa > 20 && sa <= 45) return 'глинистый суглинок (clay loam)';
        if (cl >= 27 && cl < 40 && sa <= 20) return 'пылеватый глинистый суглинок (silty clay loam)';
        if (cl >= 35 && sa > 45) return 'песчанистая глина (sandy clay)';
        if (cl >= 40 && si >= 40) return 'пылеватая глина (silty clay)';
        if (cl >= 40 && sa <= 45 && si < 40) return 'глина (clay)';
        return 'суглинок (loam)';
    }
    function emptyChart(t) { return '<svg viewBox="0 0 300 120" class="pp-hist"><line x1="10" y1="100" x2="295" y2="100"/><line x1="10" y1="10" x2="10" y2="100"/><text x="150" y="58" font-size="11" text-anchor="middle" style="opacity:.55">' + esc(t) + '</text></svg>'; }
    function legHtml(cols, lo, hi, unit) { return '<div class="pp-legbar" style="background:linear-gradient(90deg,' + cols.join(',') + ')"></div><div class="pp-legl"><span>' + lo + '</span><span>' + hi + ' ' + esc(unit || '') + '</span></div>'; }

    // ---------- мини-карты (перетаскиваются мышью, колесо — масштаб), снимок, PDF ----------
    function mini(key, gj, title) {
        var el = body.querySelector('[data-map="' + key + '"]'); if (!el) return null;
        var m = L.map(el, { zoomControl: true, attributionControl: false, dragging: true, scrollWheelZoom: true, doubleClickZoom: true, boxZoom: false, keyboard: false, touchZoom: true, zoomSnap: 0.25, fadeAnimation: false });
        L.tileLayer(ESRI, { crossOrigin: true, maxZoom: 19 }).addTo(m);
        var poly = L.geoJSON(gj, { style: { color: '#ffffff', weight: 2.5, fillOpacity: 0 }, interactive: false }).addTo(m);
        m.invalidateSize(); m.fitBounds(poly.getBounds(), { padding: [18, 18] });
        if (window.ResizeObserver) { var lw = el.clientWidth, lh = el.clientHeight; new ResizeObserver(function () { try { m.invalidateSize(); var w = el.clientWidth, h = el.clientHeight; if (w && (Math.abs(w - lw) > 40 || Math.abs(h - lh) > 40)) { lw = w; lh = h; m.fitBounds(poly.getBounds(), { padding: [18, 18] }); } } catch (e) { /* карта удалена */ } }).observe(el); }
        return (minis[key] = { map: m, el: el, gj: gj, title: title, leg: null });
    }
    function legSrc(key) {   // краткое описание источника под легендой
        var s = /^soil_/.test(key) ? 'ISRIC SoilGrids, 250 м' : /^(ndvi|ndmi|nbr|gndvi|ndre|savi|ndwi|ndti|s2rgb|s2cir)$/.test(key) ? 'Sentinel-2 L2A (ESA Copernicus), 10 м' + (D.sat && D.sat[key] && D.sat[key].day ? ', снимок от ' + satDay(D.sat[key].day) : '') : /^el[hs]$/.test(key) ? 'цифровая модель рельефа Terrarium (Mapzen / AWS)' : '';
        return s ? '<div class="pp-legsrc">Источник: ' + s + '</div>' : '';
    }
    function setLeg(key, cols, lo, hi, unit) {
        var o = minis[key]; if (o) o.leg = { cols: cols, lo: lo, hi: hi, unit: unit };
        var el = document.getElementById('ppLeg_' + key); if (el) el.innerHTML = legHtml(cols, lo, hi, unit) + legSrc(key);
    }
    function addImg(key, url, bounds, op) { var o = minis[key]; if (!o) return null; return L.imageOverlay(url, bounds, { pane: 'tilePane', zIndex: 12, opacity: op || 0.85, interactive: false }).addTo(o.map); }
    // векторные слои Leaflet (дороги, водоёмы, маршруты, населённые пункты) → на холст снимка; тайлы в снимок попадают отдельно
    function drawVec(g, m) {
        var pt = function (ll) { return m.latLngToContainerPoint(ll); }, tips = [];
        var rings = function (ls) { if (!ls || !ls.length) return []; return (ls[0] && typeof ls[0].lat === 'number') ? [ls] : ls.reduce(function (a, x) { return a.concat(rings(x)); }, []); };
        var trace = function (rs, close) { rs.forEach(function (r) { r.forEach(function (ll, i) { var q = pt(ll); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); if (close) g.closePath(); }); };
        var stroke = function (o) { g.globalAlpha = o.opacity == null ? 1 : o.opacity; g.strokeStyle = o.color || '#3388ff'; g.lineWidth = o.weight == null ? 3 : o.weight; g.setLineDash(o.dashArray ? String(o.dashArray).split(/[ ,]+/).map(Number) : []); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); };
        m.eachLayer(function (l) {
            if (!(l instanceof L.Path)) return;
            var o = l.options || {}, tt = l.getTooltip && l.getTooltip(), c = null;
            g.save(); g.beginPath();
            if (l instanceof L.CircleMarker) {
                c = pt(l.getLatLng()); g.arc(c.x, c.y, l.getRadius ? l.getRadius() : 6, 0, Math.PI * 2);
                if (o.fill !== false) { g.globalAlpha = o.fillOpacity == null ? 0.2 : o.fillOpacity; g.fillStyle = o.fillColor || o.color; g.fill(); }
                if (o.stroke !== false) stroke(o);
            } else if (l instanceof L.Polygon) {
                var rs = rings(l.getLatLngs()); trace(rs, true);
                if (o.fill !== false) { g.globalAlpha = o.fillOpacity == null ? 0.2 : o.fillOpacity; g.fillStyle = o.fillColor || o.color; g.fill('evenodd'); }
                if (o.stroke !== false) stroke(o);
                try { c = pt(l.getBounds().getCenter()); } catch (e) { /* без подписи */ }
            } else if (l instanceof L.Polyline) {
                trace(rings(l.getLatLngs()), false); if (o.stroke !== false) stroke(o);
            }
            g.restore();
            if (tt && tt.options && tt.options.permanent && c) { var cn = tt.getContent && tt.getContent(); if (typeof cn === 'string') tips.push([c, cn.replace(/<[^>]*>/g, '')]); }
        });
        g.save(); g.font = '600 11px sans-serif'; g.textAlign = 'center';
        tips.forEach(function (t) { var w = g.measureText(t[1]).width + 10, x = t[0].x, y = t[0].y - 14; g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(x - w / 2, y - 12, w, 16); g.fillStyle = '#0f172a'; g.fillText(t[1], x, y); });
        g.restore();
    }
    function snap(o, noLeg) {
        var r0 = o.el.getBoundingClientRect(), S = 2, c = document.createElement('canvas'); c.width = Math.round(r0.width * S); c.height = Math.round(r0.height * S);
        var g = c.getContext('2d'); g.scale(S, S); g.fillStyle = '#e5e7eb'; g.fillRect(0, 0, r0.width, r0.height);
        ['img.leaflet-tile', 'img.leaflet-image-layer'].forEach(function (sel) {
            o.el.querySelectorAll(sel).forEach(function (im) {
                if (!im.complete || !im.naturalWidth) return;
                var r = im.getBoundingClientRect(); g.globalAlpha = +getComputedStyle(im).opacity || 1;
                try { g.drawImage(im, r.left - r0.left, r.top - r0.top, r.width, r.height); } catch (e) { /* пропуск */ }
            });
        });
        g.globalAlpha = 1; g.lineJoin = 'round';
        if (o.vec) { try { drawVec(g, o.map); } catch (e) { /* без векторных слоёв */ } }
        if (o.draw) { try { o.draw(g, o.map); } catch (e) { /* без доп. слоя */ } }
        [['rgba(0,0,0,.55)', 5], ['#ffffff', 2.5]].forEach(function (s) {
            g.strokeStyle = s[0]; g.lineWidth = s[1];
            polysOf(o.gj).forEach(function (p) { p.forEach(function (ring) { g.beginPath(); ring.forEach(function (pt, i) { var q = o.map.latLngToContainerPoint([pt[1], pt[0]]); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); g.closePath(); g.stroke(); }); });
        });
        g.font = '600 13px sans-serif'; var tw = g.measureText(o.title).width + 18;
        g.fillStyle = 'rgba(15,23,42,.78)'; g.fillRect(8, 8, tw, 26); g.fillStyle = '#fff'; g.fillText(o.title, 17, 26);
        if (o.leg && !noLeg) {
            var lg = o.leg, x = 8, y = r0.height - 50, w = Math.min(190, r0.width - 40), grd = g.createLinearGradient(x + 8, 0, x + 8 + w, 0);
            lg.cols.forEach(function (cl, i) { grd.addColorStop(i / (lg.cols.length - 1), cl); });
            g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x, y, w + 16, 42); g.fillStyle = grd; g.fillRect(x + 8, y + 7, w, 10);
            g.fillStyle = '#0f172a'; g.font = '11px sans-serif'; g.fillText(lg.lo, x + 8, y + 34); g.textAlign = 'right'; g.fillText(lg.hi + ' ' + (lg.unit || ''), x + 8 + w, y + 34); g.textAlign = 'left';
        }
        g.font = '10px sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText('TerraClass · Esri World Imagery', 10, r0.height - 6);
        try { return { url: c.toDataURL('image/jpeg', 0.92), w: c.width, h: c.height }; } catch (e) { return null; }
    }
    function pdfJpeg(url, w, h) {
        var bin = atob(url.split(',')[1]), jpg = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
        var PW = 595, PH = Math.round(PW * h / w), enc = new TextEncoder(), parts = [], off = [], len = 0;
        var add = function (x) { var u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
        var obj = function (n, s) { off[n] = len; add(n + ' 0 obj\n' + s + '\nendobj\n'); };
        add('%PDF-1.4\n');
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
        obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>');
        off[4] = len; add('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n'); add(jpg); add('\nendstream\nendobj\n');
        var cs = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im Do Q'; obj(5, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
        var x = len; add('xref\n0 6\n0000000000 65535 f \n'); for (i = 1; i <= 5; i++) add(String(off[i]).padStart(10, '0') + ' 00000 n \n');
        add('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF');
        return new Blob(parts, { type: 'application/pdf' });
    }
    function save(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function tifF32(a, w, h, x0, y1, dx, dy, name) {
        var n = w * h, px = new Float32Array(n), i;
        for (i = 0; i < n; i++) px[i] = a[i] === a[i] ? a[i] : -9999;
        var sO = 8 + n * 4, tO = sO + 24, gO = tO + 48, dO = gO + 32, ifd = dO + 8, NE = 14, buf = new ArrayBuffer(ifd + 2 + NE * 12 + 4), dv = new DataView(buf);
        dv.setUint8(0, 73); dv.setUint8(1, 73); dv.setUint16(2, 42, true); dv.setUint32(4, ifd, true);
        new Uint8Array(buf, 8, n * 4).set(new Uint8Array(px.buffer));
        [dx, dy, 0].forEach(function (v, k) { dv.setFloat64(sO + k * 8, v, true); });
        [0, 0, 0, x0, y1, 0].forEach(function (v, k) { dv.setFloat64(tO + k * 8, v, true); });
        [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326].forEach(function (v, k) { dv.setUint16(gO + k * 2, v, true); });
        '-9999'.split('').forEach(function (ch, k) { dv.setUint8(dO + k, ch.charCodeAt(0)); });
        dv.setUint16(ifd, NE, true);
        [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 1, 32], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, 1, 8], [277, 3, 1, 1], [278, 4, 1, h], [279, 4, 1, n * 4],
            [339, 3, 1, 3], [33550, 12, 3, sO], [33922, 12, 6, tO], [34735, 3, 16, gO], [42113, 2, 6, dO]].forEach(function (e, k) {
            var o = ifd + 2 + k * 12;
            dv.setUint16(o, e[0], true); dv.setUint16(o + 2, e[1], true); dv.setUint32(o + 4, e[2], true);
            if (e[1] === 3) dv.setUint16(o + 8, e[3], true); else dv.setUint32(o + 8, e[3], true);
        });
        save(new Blob([buf], { type: 'image/tiff' }), name);
    }
    body.addEventListener('click', function (e) {
        var km = e.target.closest('[data-kml]'); if (km) {   // контур участка в KML
            var ko = minis[km.dataset.kml], kp = ko && ko.gj ? polysOf(ko.gj) : [];
            var kx = kp.map(function (pl, i) {
                return '<Placemark><name>' + esc('Участок ' + (i + 1)) + '</name><Polygon>' + pl.map(function (r, j) {
                    return '<' + (j ? 'inner' : 'outer') + 'BoundaryIs><LinearRing><coordinates>' + r.map(function (c) { return c[0] + ',' + c[1] + ',0'; }).join(' ') + '</coordinates></LinearRing></' + (j ? 'inner' : 'outer') + 'BoundaryIs>';
                }).join('') + '</Polygon></Placemark>';
            }).join('');
            if (!kx) { updateStatus('⚠️ Нет контура для KML', true); return; }
            save(new Blob(['<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Участок</name>' + kx + '</Document></kml>'], { type: 'application/vnd.google-earth.kml+xml' }), 'karta_' + km.dataset.kml + '.kml');
            updateStatus('✅ Контур сохранён в KML');
        }
        var xm = e.target.closest('.pp-expm .pp-cadmenu-l button'); if (xm) { var xd = xm.closest('details'); if (xd) setTimeout(function () { xd.removeAttribute('open'); }, 0); }
        var b = e.target.closest('[data-pdf]'); if (b) {
            var o = minis[b.dataset.pdf]; if (!o) return;
            var s = snap(o);
            if (!s) { updateStatus('⚠️ Не удалось собрать карту для PDF: подложка не отдаёт изображение (CORS)', true); return; }
            save(pdfJpeg(s.url, s.w, s.h), 'karta_' + b.dataset.pdf + '.pdf'); updateStatus('✅ Карта сохранена в PDF');
            return;
        }
        b = e.target.closest('[data-pdf3]'); if (b) {
            var m = m3s[b.dataset.pdf3]; if (!m) return;
            try { var cv = m.getCanvas(); m.triggerRepaint(); save(pdfJpeg(cv.toDataURL('image/jpeg', 0.92), cv.width, cv.height), 'karta_3d_' + b.dataset.pdf3 + '.pdf'); updateStatus('✅ 3D-вид сохранён в PDF'); }
            catch (err) { updateStatus('⚠️ Не удалось сохранить 3D-вид', true); }
            return;
        }
        b = e.target.closest('[data-tif]'); if (b && D.tifs && D.tifs[b.dataset.tif]) { var TF = D.tifs[b.dataset.tif]; tifF32(TF.a, TF.w, TF.h, TF.x0, TF.y1, TF.dx, TF.dy, TF.name); return; }
        b = e.target.closest('[data-soil-tif]'); if (b && D.soil) {
            var p = b.getAttribute('data-soil-tif'); if (D.soil.cov[p]) ppSoil.tif(D.soil.cov[p], p, '0-5cm', D.soil.bb);
        }
    });
    body.addEventListener('click', function (e) {
        var b = e.target.closest('.pp-i-btn'); if (b) { b.closest('.pp-sub').classList.toggle('closed'); return; }
        b = e.target.closest('.pp-h-btn'); if (b) { if (window.gcOpenHelp) window.gcOpenHelp(b.getAttribute('data-help')); return; }
        b = e.target.closest('[data-pp-all]'); if (b) { var on = body.classList.toggle('pp-none'); b.innerHTML = on ? '<i class="fas fa-eye"></i> Показать все' : '<i class="fas fa-eye-slash"></i> Скрыть все'; }
    });

    body.addEventListener('click', function (e) {   // копирование таблицы вершин
        var b = e.target.closest('[data-vcopy]'); if (!b || !D.vtxt) return; copyText(b, D.vtxt);
    });
    // ---------- 3D-карта (MapLibre): рельеф + снимок, при наличии heat — тепловая карта высот поверх ----------
    function mk3d(key, gj, heat) {
        var el = body.querySelector('[data-map3="' + key + '"]'); if (!el) return;
        if (typeof maplibregl === 'undefined') { el.innerHTML = '<div class="pp-ph3">MapLibre не загрузился — 3D недоступно</div>'; return; }
        var bb = turf.bbox(gj), m;
        if (m3s[key]) { try { m3s[key].remove(); } catch (e) { /* уже удалена */ } delete m3s[key]; el.innerHTML = ''; }   // повторный расчёт раздела: не плодим карты
        try {
            m = new maplibregl.Map({ container: el, attributionControl: false, preserveDrawingBuffer: true, maxPitch: 80,
                style: { version: 8, sources: { img: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19 }, dem: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15 } }, layers: [{ id: 'img', type: 'raster', source: 'img' }] },
                center: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], zoom: 12 });
        } catch (err) { el.innerHTML = '<div class="pp-ph3">3D недоступно (WebGL)</div>'; return; }
        m3s[key] = m;
        var kicks = 0, heatSpec = { id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } };
        var kick = function () {   // слой поверх рельефа дорисовывается не целиком, пока подгружаются тайлы высот: пересоздаём слой и «толкаем» зум, как при ручном масштабировании
            try {
                if (m.isMoving() || !el.clientWidth) return;
                if (m.getLayer('heat')) { m.removeLayer('heat'); m.addLayer(heatSpec, m.getLayer('plot') ? 'plot' : undefined); }
                m.setTerrain({ source: 'dem', exaggeration: 1.5 });
                var z0 = m.getZoom(); m.jumpTo({ zoom: z0 + 0.25 });
                setTimeout(function () { try { m.jumpTo({ zoom: z0 }); m.triggerRepaint(); } catch (e) { /* карта удалена */ } }, 150);
            } catch (e) { /* карта удалена */ }
        };
        var fit = function () { try { m.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 30, pitch: 60, bearing: -20, duration: 0 }); kicks = 0; } catch (e) { /* карта удалена */ } };
        if (window.IntersectionObserver) {   // карта стала видимой (раздел развернули / доскроллили) — подгруженные «вслепую» слои перерисовываем
            var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { setTimeout(kick, 500); setTimeout(kick, 2000); } }, { threshold: 0.2 });
            io.observe(el); var rm2 = m.remove.bind(m); m.remove = function () { io.disconnect(); rm2(); };
        }
        var lw = 0, ro = window.ResizeObserver ? new ResizeObserver(function () {   // контейнер меняет размер после загрузки данных выше по странице — подстраиваем холст и кадр
            var w = el.clientWidth; if (!w) return; try { m.resize(); } catch (e) { return; }
            if (Math.abs(w - lw) > 40) { lw = w; fit(); }
        }) : null;
        if (ro) { ro.observe(el); var rm = m.remove.bind(m); m.remove = function () { ro.disconnect(); rm(); }; }
        m.on('error', function (ev) { console.warn('Паспорт: 3D-карта', ev && ev.error && ev.error.message || ev); });
        m.on('load', function () {
            try { m.setTerrain({ source: 'dem', exaggeration: 1.5 }); } catch (e) { console.warn('Паспорт: рельеф 3D', e); }
            try {
                if (heat && heat._url && heat._bounds) {
                    var b = heat._bounds;
                    m.addSource('heat', { type: 'image', url: heat._url, coordinates: [[b.getWest(), b.getNorth()], [b.getEast(), b.getNorth()], [b.getEast(), b.getSouth()], [b.getWest(), b.getSouth()]] });
                    m.addLayer(heatSpec);
                }
            } catch (e) { console.warn('Паспорт: слой 3D', e); }
            try { m.addSource('plot', { type: 'geojson', data: gj }); m.addLayer({ id: 'plot', type: 'line', source: 'plot', paint: { 'line-color': '#ffffff', 'line-width': 2.5 } }); } catch (e) { console.warn('Паспорт: контур 3D', e); }
            m.resize(); lw = el.clientWidth; fit();
            [1500, 3500, 6000, 10000].forEach(function (t) { setTimeout(kick, t); });
        });
    }

    // мини-таблица координат вершин полигона (внешние кольца, WGS-84) + кнопка копирования
    function vtab(gj) {
        var rows = [], txt = ['№\tШирота\tДолгота'], np = polysOf(gj).length;
        polysOf(gj).forEach(function (p, k) { p[0].slice(0, -1).forEach(function (pt, i) { var n = (np > 1 ? (k + 1) + '.' : '') + (i + 1); rows.push('<tr><td>' + n + '</td><td>' + pt[1].toFixed(6) + '</td><td>' + pt[0].toFixed(6) + '</td></tr>'); txt.push(n + '\t' + pt[1].toFixed(6) + '\t' + pt[0].toFixed(6)); }); });
        D.vtxt = txt.join('\n');
        return '<div class="pp-ch pp-vtw"><h5>Координаты вершин полигона <button type="button" class="pp-btn pp-vcopy" data-vcopy title="Скопировать таблицу (столбцы через табуляцию — вставляется в Excel)"><i class="fas fa-copy"></i> Копировать</button></h5><div class="pp-vt"><table><thead><tr><th>№</th><th>Широта</th><th>Долгота</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div><div class="pp-cap">WGS-84, градусы; внешний контур' + (np > 1 ? ' каждой части участка' : '') + '.</div></div>';
    }
    // атрибуты кадастра: из выписки Росреестра (props.source = rosreestr) или из слоя НСПД (props.attrs = [[название, значение]…])
    function cadRows(p, a) {
        if (!p) return [];
        var r = [], add = function (k, v) { if (v !== '' && v != null) r.push([k, v]); }, am = p.area_m2, dt = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : esc(s || ''); };
        if (p.source === 'rosreestr') {
            add('Тип объекта', esc([p.object_type, p.subtype].filter(Boolean).join(', ')));
            add('Категория земель', esc(p.category || ''));
            add('Разрешённое использование', esc(p.permitted_use || ''));
            if (am != null) {
                add('Площадь по выписке', nf(am, 2) + ' м² (' + nf(am / 1e4, 4) + ' га)' + (p.area_inaccuracy_m2 ? ' ± ' + nf(p.area_inaccuracy_m2, 2) : '') + (p.area_type ? ', ' + esc(String(p.area_type).toLowerCase()) : ''));
                if (am > 0) { var dd = a - am; add('Расхождение с контуром', (dd < 0 ? '−' : '+') + nf(Math.abs(dd), 0) + ' м² (' + nf(Math.abs(dd) / am * 100, 1) + ' %)'); }
            }
            if (p.contour_count > 1) add('Контур ' + p.contour + ' из ' + p.contour_count, nf(p.contour_area_m2, 2) + ' м²');
            if (p.cost_rub != null) add('Кадастровая стоимость', nf(p.cost_rub, 2) + ' ₽' + (am > 0 ? ' (' + nf(p.cost_rub / (am / 1e4), 0) + ' ₽/га)' : ''));
            add('Кадастровый квартал', esc(p.quarter || ''));
            add('Дата постановки на учёт', dt(p.reg_date));
            if (p.use_cls && p.use_cls !== p.permitted_use) add('Вид использования по классификатору', esc(p.use_cls));
            add('Кадастровая стоимость определена', dt(p.cost_date));
            add('Стоимость внесена в ЕГРН', dt(p.cost_reg));
            add('Родительский участок', esc(p.parent_cad || ''));
            add('Ранее присвоенные номера', esc((p.prev_cad || []).join(', ')));
            add('Объекты на участке', esc((p.included || []).join(', ')));
            add('Права (без правообладателей)', esc((p.rights || []).join('; ')));
            add('Особые отметки', esc(p.special || ''));
            add('Орган регистрации', esc(p.organ || ''));
            add('Адрес по выписке', esc(p.address || ''));
            add('Обременения', esc((p.encumbrances || []).join('; ')));
            add('Статус', esc(p.status || ''));
            add('Выписка', esc([p.extract_number, p.extract_date].filter(Boolean).join(' от ')));
        } else if (Array.isArray(p.attrs)) p.attrs.forEach(function (x) { add(esc(x[0]), esc(x[1])); });
        return r;
    }
    // ---------- общие блоки «Общей информации»: используются и в паспорте участка, и в блоке «Фигура» ----------
    function sizeFmt(m) { return m < 1000 ? nf(m, 0) + ' м' : nf(m / 1000, 2) + ' км'; }
    function compactionK(a, per) { return 4 * Math.PI * a / Math.pow(per * 1000, 2); }   // компактность K = 4π·S / P²
    function sizeTiles(a, per, nv, c, bb, K) {
        var w = hav(c[1], bb[0], c[1], bb[2]), h = hav(bb[1], c[0], bb[3], c[0]);
        var kl = K >= 0.6 ? ['компактная', '#16a34a'] : K >= 0.3 ? ['умеренно вытянутая', '#eab308'] : ['сильно вытянутая', '#dc2626'];
        return tiles([['Площадь', nf(a / 1e4, 2) + ' га', nf(a, 0) + ' м²', CC.gen], ['Периметр', nf(per * 1000, 0) + ' м', nf(per, 2) + ' км', '#0ea5e9'], ['Габариты В–З × С–Ю', sizeFmt(w) + ' × ' + sizeFmt(h), '', '#14b8a6'], ['Вершин контура', nf(nv, 0), '', '#a855f7'], ['Компактность K', nf(K, 2), kl[0], kl[1]]]);
    }
    function compactChart(K, note) { return chart('Форма участка на шкале компактности', meter([[0.3, '#ef4444'], [0.6, '#facc15'], [0.8, '#22c55e']], K, 0, 0.8, 1), 'Красная зона — вытянутые и изрезанные контуры (больше холостых проходов техники), зелёная — компактные участки, удобные для обработки.' + note); }
    function centerKv(c, cad, a, addrId) { return kv([['Центр (широта, долгота)', c[1].toFixed(6) + ', ' + c[0].toFixed(6)], ['Адрес', '<span id="' + addrId + '">определяется…</span>'], ['Кадастровый номер', cad ? esc(cad) : ''], ['Площадь в других единицах', nf(a / 100, 1) + ' сот. · ' + nf(a / 4046.86, 2) + ' акра'], ['Зона UTM', (Math.floor((c[0] + 180) / 6) + 1) + (c[1] >= 0 ? ' N' : ' S')]]); }
    function cadChart(cp, cr) { return (cr.length ? chart(cp.source === 'rosreestr' ? 'Кадастровые сведения · выписка ЕГРН' : 'Сведения об объекте', kv(cr), cp.source === 'rosreestr' ? 'Атрибуты объекта из кадастра; площадь по контуру считается по границам на карте и может немного отличаться от кадастровой.' : 'Атрибуты объекта; площадь по контуру считается по границам на карте и может немного отличаться от указанной в источнике.') : ''); }
    function reverseGeocode(c) { return fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&lat=' + c[1] + '&lon=' + c[0]).then(function (r) { return r.json(); }); }
    // копирование текста в буфер обмена с подменой подписи на кнопке b (запасной путь — через скрытое textarea)
    function copyText(b, text) {
        var ok = function () { b.innerHTML = '<i class="fas fa-check"></i> Скопировано'; setTimeout(function () { b.innerHTML = '<i class="fas fa-copy"></i> Копировать'; }, 1800); };
        var fb = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (er) { updateStatus('⚠️ Не удалось скопировать', true); } document.body.removeChild(ta); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
    }

    // ---------- 1. общая информация ----------
    function general(l, gj) {
        var a = turf.area(gj), per = 0, c = turf.centroid(gj).geometry.coordinates, cad = l.feature && l.feature.properties && l.feature.properties.cad_number, bb = turf.bbox(gj), nv = 0;
        polysOf(gj).forEach(function (p) { p.forEach(function (r) { per += turf.length(turf.lineString(r), { units: 'kilometers' }); nv += Math.max(0, r.length - 1); }); });
        var K = compactionK(a, per);
        D.area = a; D.per = per; D.c = c; D.cad = cad; D.comp = K; D.nv = nv;
        var cp = l.feature && l.feature.properties, cr = cadRows(cp, a);
        return sec(1, 'circle-info', 'Общая информация об участке', 'Размеры, форма, положение и адрес', CC.gen, blk({
            t: 'Границы, размеры и форма', i: 'draw-polygon', map: mapBox('gen'),
            info: ['Базовые геометрические характеристики контура участка: площадь, периметр, габариты, форма, положение и адрес.',
                'Площадь и периметр — основа расчёта норм семян и удобрений, затрат на обработку и ограждение. Форма влияет на эффективность техники: чем более вытянут и изрезан контур, тем больше поворотов и холостых проходов.',
                'Площадь — геодезическая (turf.area, эллипсоид WGS-84); периметр — сумма длин всех колец контура; компактность K = 4π·S / P² (1 — круг, ≈0,78 — квадрат, меньше 0,3 — сильно вытянутый); габариты — стороны описанного прямоугольника по С–Ю и В–З; адрес — обратное геокодирование OpenStreetMap Nominatim по центру участка; зона UTM = ⌊(долгота + 180) / 6⌋ + 1.'],
            body: sizeTiles(a, per, nv, c, bb, K) + compactChart(K, '') + centerKv(c, cad, a, 'ppAddr') + cadChart(cp, cr) +
                vtab(gj)
        }) + blk({
            t: 'Пересечения с кадастровыми участками', i: 'layer-group', map: mapBox('cadx'), id: 'ppCadBody', cls: 'pp-cadsub',
            info: ['Список земельных участков из кадастра (слой «Земельные участки из ЕГРН» НСПД), границы которых пересекаются с контуром участка, с площадью пересечения, площадью по ЕГРН, видом разрешённого использования, категорией земель и сведениями о правах. На карте слева кадастровые участки показаны с подписями, пересечения — красным.',
                'Показывает, на каких кадастровых участках фактически расположен контур, какая его часть не имеет кадастровых границ, и помогает найти наложения, чересполосицу и несовпадение вида использования с фактическим.',
                'Слой кадастра опрашивается по сетке точек внутри контура и вдоль его границы (шаг подбирается по размеру участка); найденные контуры пересекаются с границей участка (Turf), площадь пересечения — геодезическая. Узкие участки уже шага сетки могут быть пропущены.']
        }));
    }
    // ---------- статусы загрузки блоков (в шапке паспорта) ----------
    var RETRY_WAIT = [3000, 7000, 15000];   // автоповтор неудавшихся блоков: паузы перед 1-й, 2-й и 3-й попыткой, мс
    var STL = { cls: 'Классификация', sat: 'Снимки', soil: 'Почва', elev: 'Рельеф', log: 'Логистика', clim: 'Климат', wx: 'Погода', addr: 'Адрес', cad: 'Кадастр' };
    var ST_CSS = [
        '#passportPane .pp-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}#ppSt.pp-stbar{position:relative;display:flex;align-items:center;gap:10px;flex:1 1 100%;order:10;min-width:0;margin:0;padding:7px 12px 9px;border-radius:12px;background:linear-gradient(180deg,#fff,#f8fafc);border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.08);overflow:hidden}',
        '#ppSt .pp-stp{font:800 15px/1 system-ui,sans-serif;color:#0f172a;min-width:42px;text-align:right}',
        '#ppSt .pp-sts{display:flex;flex:1;flex-wrap:nowrap;gap:4px;min-width:0}',
        '#ppSt .pp-stc{flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;height:26px;margin:0;padding:0 8px;border:0;border-radius:6px;box-shadow:none;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;transition:background .3s,color .3s}',
        '#ppSt .pp-stc i{font-size:10px}',
        '#ppSt .pp-stc.load{background:repeating-linear-gradient(-45deg,#dbeafe 0 7px,#c7ddfb 7px 14px);background-size:20px 20px;animation:ppStrip .9s linear infinite;color:#1d4ed8}',
        '#ppSt .pp-stc.ok{background:#dcfce7;color:#166534}#ppSt .pp-stc.err{background:#fee2e2;color:#b91c1c}#ppSt .pp-stc.off{background:#f1f5f9;color:#94a3b8}',
        '#ppSt .pp-stx{font-size:11px;color:#475569;white-space:nowrap}',
        '#ppSt .pp-stf{position:absolute;left:0;bottom:0;height:3px;width:0;background:linear-gradient(90deg,#3b82f6,#22c55e);transition:width .4s}',
        '#ppSt.done .pp-stf{background:#22c55e}#ppSt.hasErr .pp-stf{background:linear-gradient(90deg,#3b82f6,#ef4444)}',
        '@keyframes ppStrip{to{background-position:20px 0}}',
        '@media(max-width:900px){#ppSt .pp-stx{display:none}}',
        '#ppBody .pp-sub:not(.nomap) .pp-mcol{position:sticky;top:10px;align-self:flex-start}',
        '#ppBody .pp-zup{z-index:1100!important}#ppBody .pp-zup:not(.pp-mcol){position:relative}#ppBody .pp-zup:not(.mb-slide){overflow:visible!important}#ppBody .pp-expm[open] .pp-cadmenu-l{z-index:1110}',
        '#ppBody .pp-map .leaflet-control-zoom,#ppBody .pp-map .leaflet-control:not(.leaflet-control-attribution),#ppBody .pp-map [class*="north"],#ppBody .pp-map [class*="compass"]{display:none!important}',
        '#ppBody .pp-expm{margin-left:0}#ppBody .pp-expm .pp-cadmenu-l{white-space:nowrap}',
        '@media print{#ppBody .pp-mcol{position:static}}',
        '#ppBody .pp-cadsub > .pp-mc{align-items:stretch}#ppBody .pp-cadsub .pp-dcol{display:flex;flex-direction:column}#ppBody .pp-cadsub .pp-tiles{flex:0 0 auto}',
        '#ppBody .pp-cadtbl,#ppBody .pp-cadtbl>.pp-ch{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}#ppBody .pp-cadtbl .pp-vt{flex:1 1 0;min-height:190px;max-height:none}',
        '#ppBody .pp-pack.on .pp-cadsub .pp-cadtbl .pp-vt{flex:0 0 auto;min-height:0;max-height:420px}',
        '#ppBody .pp-cadtbl td,#ppBody .pp-cadtbl th{white-space:nowrap}#ppBody .pp-cadtbl td:nth-child(n+7),#ppBody .pp-cadtbl th:nth-child(n+7){white-space:normal;min-width:150px;text-align:left}#ppBody .pp-cadtbl td:nth-child(2),#ppBody .pp-cadtbl th:nth-child(2){text-align:left}',
        '#ppBody .pp-cadtbl tbody tr{cursor:pointer}#ppBody .pp-cadtbl tbody tr:hover td{background:#fffbeb}#ppBody .pp-cadtbl tbody tr.pp-cadsel td{background:#fde68a;color:#78350f;font-weight:600}',
        '[data-bp-pane="shape"] .pp-cadtbl .pp-vt{max-height:260px}[data-bp-pane="shape"] .pp-cadtbl td,[data-bp-pane="shape"] .pp-cadtbl th{white-space:nowrap}[data-bp-pane="shape"] .pp-cadtbl td:nth-child(n+7),[data-bp-pane="shape"] .pp-cadtbl th:nth-child(n+7){white-space:normal;min-width:150px;text-align:left}[data-bp-pane="shape"] .pp-cadtbl td:nth-child(2),[data-bp-pane="shape"] .pp-cadtbl th:nth-child(2){text-align:left}[data-bp-pane="shape"] .pp-cadtbl tbody tr{cursor:pointer}[data-bp-pane="shape"] .pp-cadtbl tbody tr:hover td{background:#fffbeb}[data-bp-pane="shape"] .pp-cadtbl tbody tr.pp-cadsel td{background:#fde68a;color:#78350f;font-weight:600}',
        '[data-bp-pane="shape"] .pp-cadtbl tbody tr.pp-cadsel td{background:#dbeafe!important;color:#1e3a8a!important;font-weight:700;box-shadow:inset 0 1px 0 #93c5fd,inset 0 -1px 0 #93c5fd}[data-bp-pane="shape"] .pp-cadtbl tbody tr.pp-cadsel td:first-child{box-shadow:inset 3px 0 0 #2563eb,inset 0 1px 0 #93c5fd,inset 0 -1px 0 #93c5fd}[data-bp-pane="shape"] .pp-cadtbl tr.pp-cadd td{width:auto;text-align:left;white-space:normal;padding:5px 10px;font-weight:400}[data-bp-pane="shape"] .pp-cadtbl tbody tr.pp-cadd.pp-cadsel td{background:#eff6ff!important;color:#1e3a8a!important;font-weight:400;box-shadow:none}.pp-cadg{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;font-size:11px;line-height:1.35}.pp-cadg span{color:#64748b}.pp-cadg b{font-weight:600;text-align:left}[data-bp-pane="shape"] .pp-cadchev{width:1%;color:#94a3b8}.pp-cadchev i{transition:transform .15s}tr.pp-cadr.pp-cadsel .pp-cadchev i{transform:rotate(180deg)}.pp-cadmenu{position:relative;display:inline-block;margin-left:8px;vertical-align:middle}.pp-cadmenu summary{list-style:none;cursor:pointer;height:28px;padding:0 10px;font-size:11px}.pp-cadmenu summary::-webkit-details-marker{display:none}.pp-cadmenu-l{position:absolute;z-index:60;top:100%;left:0;margin-top:4px;min-width:150px;display:flex;flex-direction:column;background:var(--card,#fff);border:1px solid var(--line,#e2e8f0);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px}.pp-cadmenu-l button{justify-content:flex-start;border:0;background:none;width:100%;height:28px;font-size:11px}.pp-cadmenu-l button:hover{background:rgba(0,0,0,.06)}',
        '#ppBody .pp-pack:not(.on){display:flex;flex-direction:column;gap:14px}#ppBody .pp-pack .pp-sub{margin:0}',
        '#ppBody .pp-pack.on{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:stretch}',
        '#ppBody .pp-pack.on .pp-pc{display:flex;flex-direction:column;gap:14px;min-width:0}#ppBody .pp-pack.on.pk-m .pp-pc{align-self:start}',
        '#ppBody .pp-pack.on .pp-sub:not(.pk-g) .pp-mc{display:block}',
        '#ppBody .pp-pack.on .pp-sub.pk-g{flex:1 1 auto;display:flex;flex-direction:column}#ppBody .pp-pack.on.pk-m .pp-sub.pk-g{flex-grow:0}',
        '#ppBody .pp-pack.on .pk-g .pp-mc{flex:1 1 auto;display:flex;flex-direction:column}',
        '#ppBody .pp-pack.on .pk-g .pp-mcol{flex:1 1 auto;display:flex;flex-direction:column;position:static;width:auto;max-width:none;margin:0 0 10px}',
        '#ppBody .pp-pack.on .pk-g .pp-dcol{flex:0 0 auto;width:auto}#ppBody .pp-pack.on .pp-mapcard .pp-dcol{flex:1 1 auto;display:flex;flex-direction:column}',
        '#ppBody .pp-pack.on .pk-g .pp-mapw{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}',
        '#ppBody .pp-pack.on .pk-g .pp-map{flex:1 1 auto;width:100%;height:auto;min-height:260px;aspect-ratio:auto}',
        '#passportPane .pp-top .pp-tb{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;margin:0;padding:0 9px;border:1px solid transparent;border-radius:8px;font:600 12px/1 system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 1px 3px rgba(15,23,42,.15);transition:transform .15s,box-shadow .15s,filter .15s}',
        '#passportPane .pp-top .pp-tb:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(15,23,42,.2);filter:brightness(1.06)}#passportPane .pp-top .pp-tb:active{transform:none}',
        '#passportPane .pp-top .pp-tb.pri{background:linear-gradient(135deg,#6366f1,#2563eb);color:#fff}#passportPane .pp-top .pp-tb.pdf{background:linear-gradient(135deg,#f97316,#dc2626);color:#fff}',
        '#passportPane .pp-top .pp-tb.sec{background:#fff;color:#334155;border-color:#cbd5e1}#passportPane .pp-top .pp-tb.sec i{color:#2563eb}',
        '#passportPane .pp-top .pp-tbs{display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;gap:5px;order:5;margin-left:auto}#passportPane .pp-top .pp-tbs .pp-tb{width:auto;height:26px;flex:0 0 auto}#passportPane .pp-top .pp-tb i{font-size:11px}',
        '#passportPane .pp-top .pp-tb.xls{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff}#passportPane .pp-top .pp-tb.htm{background:linear-gradient(135deg,#0ea5e9,#0369a1);color:#fff}#passportPane .pp-top .pp-tb:disabled{opacity:.7;cursor:progress;transform:none}',
        '#ppBody .pp-pack > .pp-sub.pp-wide{grid-column:1/-1}',
        '#ppBody .pp-sub.pp-wide > .pp-mc,#ppBody .pp-pack > .pp-sub.pp-wide > .pp-mc{display:grid!important;grid-template-columns:minmax(0,500px) minmax(0,500px) minmax(240px,1fr)!important;gap:22px;align-items:start}',
        '#ppBody .pp-sub.pp-wide .pp-mcol,#ppBody .pp-sub.pp-wide .pp-mpair{display:contents}#ppBody .pp-sub.pp-wide .pp-mapw{max-width:none;min-width:0}',
        '@media(max-width:1250px){#ppBody .pp-sub.pp-wide > .pp-mc,#ppBody .pp-pack > .pp-sub.pp-wide > .pp-mc{grid-template-columns:minmax(0,420px) minmax(0,420px) minmax(200px,1fr)!important;gap:14px}}',
        '@media(max-width:1100px){#ppBody .pp-sub.pp-wide > .pp-mc,#ppBody .pp-pack > .pp-sub.pp-wide > .pp-mc{grid-template-columns:repeat(2,minmax(0,1fr))!important}#ppBody .pp-sub.pp-wide .pp-dcol{grid-column:1/-1}}',
        '@media(max-width:700px){#ppBody .pp-sub.pp-wide > .pp-mc,#ppBody .pp-pack > .pp-sub.pp-wide > .pp-mc{grid-template-columns:minmax(0,1fr)!important}}',
        '#ppNav.pp-nav:not(.rdy){display:none!important}',
        '#ppNav.pp-nav{order:11;flex:1 1 100%;min-width:0;display:flex;flex-direction:column;gap:6px;padding:2px 0 0}',
        '#ppNav .nv-s{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:5px}',
        '#ppNav .nv-b{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 8px;border:1px solid #e2e8f0;border-radius:9px;background:linear-gradient(180deg,#fff,#f1f5f9);color:#334155;font:600 12px/1 system-ui,sans-serif;cursor:pointer;overflow:hidden;transition:transform .15s,box-shadow .15s,background .15s,color .15s,border-color .15s}',
        '#ppNav .nv-b i{font-size:12px;color:var(--ac,#2563eb);flex:none}#ppNav .nv-b span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '#ppNav .nv-b:hover{border-color:var(--ac,#2563eb);transform:translateY(-1px);box-shadow:0 3px 8px rgba(15,23,42,.14)}',
        '#ppNav .nv-b.on{background:var(--ac,#2563eb);border-color:var(--ac,#2563eb);color:#fff;box-shadow:0 3px 10px rgba(15,23,42,.18)}#ppNav .nv-b.on i{color:#fff}',
        '#ppNav .nv-u{display:flex;flex-wrap:wrap;gap:5px;padding:6px 8px;border-radius:10px;background:color-mix(in srgb,var(--ac,#2563eb) 8%,#fff);border:1px solid color-mix(in srgb,var(--ac,#2563eb) 28%,#e2e8f0);max-height:66px;overflow-y:auto;scrollbar-width:thin}#ppNav .nv-u[hidden]{display:none}',
        '#ppNav .nv-c{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:99px;border:1px solid #dbe3ec;background:#fff;color:#475569;font:500 12px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}',
        '#ppNav .nv-c i{font-size:10.5px;color:var(--ac,#2563eb)}#ppNav .nv-c:hover{border-color:var(--ac,#2563eb);color:#0f172a}#ppNav .nv-c.on{background:var(--ac,#2563eb);border-color:var(--ac,#2563eb);color:#fff}#ppNav .nv-c.on i{color:#fff}',
        '#ppSt.pp-stbar{padding:5px 12px 8px;margin-bottom:4px}#ppSt .pp-sts{display:none}',
        '#ppSt.pp-stbar + #ppNav.pp-nav{margin-top:2px;padding:7px 6px;background:linear-gradient(180deg,#f8fafc,#fff);border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,.08)}',
        '#passportPane .pp-top{z-index:1200!important}#ppBody .pp-mapw,#ppBody .pp-map,#ppBody .pp-mcol{isolation:isolate;z-index:0}',
        '#ppNav .nv-si{font-size:10.5px;flex:none;margin-left:1px}#ppNav .nv-si:not(.fas){display:none}#ppNav .nv-si.fa-circle-check{color:#16a34a}#ppNav .nv-si.fa-spinner{color:#2563eb}#ppNav .nv-si.fa-triangle-exclamation{color:#dc2626;cursor:pointer}#ppNav .nv-si.fa-circle-pause{color:#94a3b8}',
        '#ppNav .nv-b.on .nv-si{color:#fff!important}',
        '#ppNav .nv-b.st-load:not(.on){background:repeating-linear-gradient(-45deg,#dbeafe 0 7px,#c7ddfb 7px 14px);background-size:20px 20px;animation:nvStrip .9s linear infinite;color:#1d4ed8}',
        '#ppNav .nv-b.st-ok:not(.on){background:linear-gradient(180deg,#f0fdf4,#dcfce7);border-color:#bbf7d0}#ppNav .nv-b.st-err:not(.on){background:#fee2e2;border-color:#fecaca;color:#b91c1c}#ppNav .nv-b.st-off:not(.on){background:#f1f5f9;color:#94a3b8}',
        '#ppNav .nv-b.st-err.on{box-shadow:0 0 0 2px #fca5a5}#ppNav .nv-b.st-load.on{animation:nvPulse 1.2s ease-in-out infinite}',
        '#ppNav .nv-c::after{content:"";width:7px;height:7px;border-radius:50%;background:transparent;margin-left:2px}#ppNav .nv-c.st-ok::after{background:#22c55e}#ppNav .nv-c.st-load::after{background:#3b82f6;animation:nvPulse 1s ease-in-out infinite}#ppNav .nv-c.st-err::after{background:#ef4444}#ppNav .nv-c.st-off::after{background:#cbd5e1}#ppNav .nv-c.on::after{box-shadow:0 0 0 2px rgba(255,255,255,.7)}',
        '@keyframes nvStrip{to{background-position:20px 0}}@keyframes nvPulse{50%{opacity:.55}}',
        '#ppBody .pp-sec,#ppBody .pp-sub{scroll-margin-top:var(--ppTopH,130px)}',
        '@media print{#ppSt,#ppNav{display:none}}html.pp-printing #ppNav{display:none!important}'
    ].join('');
    function ppCss() { if (!document.getElementById('ppStCss')) { var cs = document.createElement('style'); cs.id = 'ppStCss'; cs.textContent = ST_CSS; document.head.appendChild(cs); } }
    // ---------- «пакет» блоков: два столбца равной высоты, остаток высоты поглощают карты ----------
    var packs = [];
    function packOne(h) {
        return;   // раскладка блоков теперь на CSS-сетке (site.css, «ПАСПОРТ: сетка блоков»)
        return;   // раскладка блоков теперь целиком на CSS-сетке (см. site.css, «ПАСПОРТ: сетка блоков»)
        var bl = h._b || (h._b = Array.prototype.slice.call(h.children)), w = h.clientWidth, n = bl.length;
        if (!w) return;   // раздел свёрнут
        if (w < 900) { if (h._c) { bl.forEach(function (b) { h.appendChild(b); }); h._c.forEach(function (c) { if (c.parentNode) h.removeChild(c); }); h._c = null; h.classList.remove('on'); } return; }
        if (!h._c) { h._c = [0, 1].map(function () { var c = document.createElement('div'); c.className = 'pp-pc'; h.appendChild(c); return c; }); h.classList.add('on'); bl.forEach(function (b) { h._c[0].appendChild(b); }); }
        var hm = bl.map(function (b) { var g = !!b.querySelector('.pp-map'); b.classList.toggle('pk-g', g); return g; });
        h.classList.add('pk-m'); var H = bl.map(function (b) { return b.offsetHeight + 14; }); h.classList.remove('pk-m');   // естественная высота блоков (карты — минимальной)
        var best = 0, bd = 1e12, m, k;
        for (m = 0; m < (1 << n); m += 2) {   // блок 0 всегда в левом столбце
            var s = [0, 0], g = [false, false];
            for (k = 0; k < n; k++) { var c = (m >> k) & 1; s[c] += H[k]; if (hm[k]) g[c] = true; }
            if (!s[0] || !s[1]) continue;
            var d = Math.abs(s[0] - s[1]) + (g[s[0] < s[1] ? 0 : 1] ? 0 : 1e6);   // разницу высот должна поглотить карта в более низком столбце
            if (d < bd) { bd = d; best = m; }
        }
        var want = [[], []]; bl.forEach(function (b, i) { want[(best >> i) & 1].push(b); });
        want.forEach(function (a, j) { var c = h._c[j]; if (a.length !== c.children.length || a.some(function (b, i) { return c.children[i] !== b; })) a.forEach(function (b) { c.appendChild(b); }); });
    }
    function packInit() {
        packs.forEach(function (o) { o.mo.disconnect(); }); packs = []; ppCss();
        body.querySelectorAll('.pp-pack').forEach(function (h) {
            var o = { t: 0 }; o.run = function () { clearTimeout(o.t); o.t = setTimeout(function () { if (document.body.contains(h)) packOne(h); }, 150); };
            packOne(h);
            o.mo = new MutationObserver(function (rs) { if (rs.some(function (r) { var e = r.target.nodeType === 1 ? r.target : r.target.parentNode; return e && e !== h && !(e.closest && e.closest('.leaflet-container')); })) o.run(); });
            o.mo.observe(h, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
            packs.push(o);
        });
    }
    window.addEventListener('resize', function () { packs.forEach(function (o) { o.run(); }); });
    // кнопки шапки: «Обновить по фигуре» и «Весь паспорт в PDF» — столбиком сбоку; «К карте» и «Свернуть все» — со значками
    function stTop(top) {
        var q = function (id) { return document.getElementById(id); }, set = function (el, cls, ic, tx) { if (!el) return; el.classList.add('pp-tb', cls); if (tx) el.innerHTML = '<i class="fas fa-' + ic + '"></i> ' + tx; };
        var rf = q('ppRefresh'), pr = q('ppPrint');
        var px = q('ppExcel'); if (!px && pr) { px = document.createElement('button'); px.type = 'button'; px.id = 'ppExcel'; px.className = 'pp-btn'; pr.parentNode.insertBefore(px, pr.nextSibling); }
        var ph = q('ppHtml'); if (!ph && px) { ph = document.createElement('button'); ph.type = 'button'; ph.id = 'ppHtml'; ph.className = 'pp-btn'; px.parentNode.insertBefore(ph, px.nextSibling); }
        if (ph && !ph.disabled) set(ph, 'htm', 'file-code', 'HTML'); if (ph) ph.title = 'Паспорт в HTML — отдельная страница в том же оформлении';
        set(rf, 'pri', 'rotate', 'Обновить'); set(pr, 'pdf', 'file-pdf', 'PDF'); if (px && !px.disabled) set(px, 'xls', 'file-excel', 'Excel');
        if (rf) rf.title = 'Обновить паспорт по фигуре'; if (pr) pr.title = 'Весь паспорт в PDF'; if (px) px.title = 'Паспорт в Excel';
        var ca = q('ppCollapseAll'); set(ca, 'sec');   // значок и подпись меняет ux-extras.js
        Array.prototype.forEach.call(top.querySelectorAll('button, a'), function (e) { if (!e.classList.contains('pp-tb') && e.textContent.trim().length < 20 && /К карте/.test(e.textContent)) set(e, 'sec', 'map-location-dot', 'К карте'); });
        if (rf && !q('ppSide')) { var w = document.createElement('div'); w.id = 'ppSide'; w.className = 'pp-tbs'; rf.parentNode.insertBefore(w, rf); if (ca) w.appendChild(ca); w.appendChild(rf); if (pr) w.appendChild(pr); if (px) w.appendChild(px); if (ph) w.appendChild(ph); }
        var sd = q('ppSide'); if (sd && ca && ca.parentNode !== sd) sd.insertBefore(ca, sd.firstChild); if (sd && px && px.parentNode !== sd) sd.appendChild(px); if (sd && ph && ph.parentNode !== sd) sd.appendChild(ph);
    }
    function stInit() {
        var top = document.querySelector('#passportPane .pp-top'); if (!top) return;
        ppCss();
        stTop(top);
        var h = document.getElementById('ppSt');
        if (!h) { h = document.createElement('div'); h.id = 'ppSt'; top.insertBefore(h, document.getElementById('ppSide') || document.getElementById('ppRefresh')); }
        h.className = 'pp-st pp-stbar';
        h.innerHTML = '<b class="pp-stp" id="ppStPct">0%</b><div class="pp-sts">' + Object.keys(STL).map(function (k) { return '<span class="pp-stc load" data-st="' + k + '"></span>'; }).join('') + '</div><span class="pp-stx" id="ppStTxt"></span><i class="pp-stf" id="ppStFill"></i>';
        Object.keys(STL).forEach(function (k) { stSet(k, k === 'cls' || k === 'sat' ? 'off' : 'load'); });
        stNav(top, h);
    }
    // ---------- панель быстрых переходов по разделам: одна строка под статусами загрузки, закреплена вместе с шапкой ----------
    var NAV = ['Общее', 'Классы земли', 'Снимки', 'Почва', 'Рельеф', 'Логистика', 'Климат', 'Итог'], navCtx = null, navSig = '', navT = 0, navG = [], NKEYS = [['addr', 'cad'], ['cls'], ['sat'], ['soil'], ['elev'], ['log'], ['clim', 'wx'], []], navA = 0, navS = -1, navLock = 0, navRaf = 0;
    function navGroups() {   // разделы и все блоки внутри них (каждый индекс, почвенный показатель, климатический блок…)
        var g = [];
        Array.prototype.forEach.call(body.querySelectorAll('.pp-sec'), function (sc, i) {
            var ic = sc.querySelector('.pp-ic i'), h3 = sc.querySelector('h3'), subs = [];
            Array.prototype.forEach.call(sc.querySelectorAll('.pp-sub'), function (b) {
                if (b.parentNode.closest && b.parentNode.closest('.pp-sub')) return;
                var h4 = b.querySelector('.pp-sub-h h4'), bi = b.querySelector('.pp-sub-h .pp-ic i'), t = h4 ? h4.textContent.replace(/^Sentinel-2\s*·\s*/, '').trim() : '';
                if (t) subs.push({ t: t, full: h4.textContent.trim(), ic: bi ? bi.className : 'fas fa-circle', el: b });
            });
            g.push({ keys: NKEYS[i] || [], t: NAV[i] || (h3 && h3.textContent) || ('Раздел ' + (i + 1)), full: h3 ? h3.textContent : '', ic: ic ? ic.className : 'fas fa-circle', ac: sc.style.getPropertyValue('--ac') || '#2563eb', el: sc, subs: subs });
        });
        return g;
    }
    function navSubs() {   // ряд блоков активного раздела
        var u = document.querySelector('#ppNav .nv-u'); if (!u) return;
        var g = navG[navA]; navS = -1;
        if (!g || g.subs.length < 2) { u.hidden = true; u.innerHTML = ''; return; }
        u.hidden = false; u.style.setProperty('--ac', g.ac);
        u.innerHTML = g.subs.map(function (x, j) { return '<button type="button" class="nv-c" data-s="' + j + '" title="' + esc(x.full) + '"><i class="' + x.ic + '"></i>' + esc(x.t) + '</button>'; }).join('');
        navStat();
    }
    function navStat() {   // статусы загрузки показываются прямо на кнопках меню (данные берутся из скрытых меток #ppSt)
        var nv = document.getElementById('ppNav'), h = document.getElementById('ppSt'); if (!nv || !h) return;
        var rank = { err: 3, load: 2, ok: 1, off: 0 }, IC = { load: 'spinner fa-spin', ok: 'circle-check', err: 'triangle-exclamation', off: 'circle-pause' };
        var cls = function (k) { var el = h.querySelector('[data-st="' + k + '"]'), m = el && /\b(load|ok|err|off)\b/.exec(el.className); return m ? m[1] : ''; };
        var secSt = navG.map(function (g) { var r = '', best = -1; g.keys.forEach(function (k) { var c = cls(k); if (c && rank[c] > best) { best = rank[c]; r = c; } }); return r; });
        Array.prototype.forEach.call(nv.querySelectorAll('.nv-b'), function (b, i) {
            var st = secSt[i] || '', si = b.querySelector('.nv-si'), g = navG[i];
            b.className = b.className.replace(/\s*\bst-\w+\b/g, '') + (st ? ' st-' + st : '');
            if (si) si.className = 'nv-si' + (st ? ' fas fa-' + IC[st] : '') + (st === 'err' ? ' err' : '');
            if (g) b.setAttribute('data-k', g.keys.filter(function (k) { return cls(k) === 'err'; }).join(','));
            b.title = (g ? (g.full || g.t) : '') + (st === 'load' ? ' — загружается…' : st === 'ok' ? ' — данные получены' : st === 'err' ? ' — ошибка, нажмите на значок ⚠, чтобы обновить раздел' : st === 'off' ? ' — отключено / нет данных' : '');
        });
        var g2 = navG[navA];
        if (g2) Array.prototype.forEach.call(nv.querySelectorAll('.nv-c'), function (c, j) {
            var sub = g2.subs[j], st = secSt[navA] || '', r;
            if (!sub) return;
            r = sub.el.querySelector('.fa-spin') ? 'load' : st === 'off' ? 'off' : st === 'load' ? 'ok' : st;
            c.className = c.className.replace(/\s*\bst-\w+\b/g, '') + (r ? ' st-' + r : '');
        });
    }
    function navSpy() {
        navRaf = 0; var c = navCtx; if (!c || !navG.length || Date.now() < navLock) return;
        var lim = c.top.getBoundingClientRect().bottom + 30, a = 0, s2 = -1;
        navG.forEach(function (g, i) { if (g.el.isConnected && g.el.getBoundingClientRect().top <= lim) a = i; });
        navG[a].subs.forEach(function (x, j) { if (x.el.getBoundingClientRect().top <= lim) s2 = j; });
        if (a !== navA) { navA = a; navMark(); navSubs(); }
        if (s2 !== navS || a !== navA) navMarkSub(s2);
        navS = s2;
    }
    function navMark() { Array.prototype.forEach.call(document.querySelectorAll('#ppNav .nv-b'), function (b, i) { b.classList.toggle('on', i === navA); }); }
    function navMarkSub(j) { Array.prototype.forEach.call(document.querySelectorAll('#ppNav .nv-c'), function (b, i) { b.classList.toggle('on', i === j); }); }
    function navBuild() {
        var c = navCtx; if (!c || !c.h.parentNode) return;
        var g = navGroups(), sig = g.map(function (x) { return x.t + ':' + x.subs.map(function (y) { return y.t; }).join(','); }).join('|');
        if (!g.length || (sig === navSig && document.getElementById('ppNav'))) { navG = g.length ? g : navG; return; }
        navSig = sig; navG = g; if (navA >= g.length) navA = 0;
        var old = document.getElementById('ppNav'); if (old) old.remove();
        var nv = document.createElement('div'); nv.id = 'ppNav'; nv.className = 'pp-nav';
        nv.innerHTML = '<div class="nv-s">' + g.map(function (x, i) { return '<button type="button" class="nv-b" data-g="' + i + '" style="--ac:' + x.ac + '" title="' + esc(x.full || x.t) + '"><i class="' + x.ic + '"></i><span>' + esc(x.t) + '</span><i class="nv-si"></i></button>'; }).join('') + '</div><div class="nv-u" hidden></div>';
        nv.addEventListener('click', function (e) {
            var b = e.target.closest('[data-g],[data-s]'); var tgt; if (!b) return;
            var si = e.target.closest('.nv-si.err');
            if (si) { var ek = (b.getAttribute('data-k') || '').split(',')[0], chip = ek && document.querySelector('#ppSt [data-st="' + ek + '"]'); if (chip) chip.click(); return; }
            if (b.hasAttribute('data-g')) { var gi = +b.getAttribute('data-g'); if (gi !== navA) { navA = gi; navMark(); navSubs(); } tgt = navG[gi] && navG[gi].el; }
            else { var sj = +b.getAttribute('data-s'); tgt = navG[navA] && navG[navA].subs[sj] && navG[navA].subs[sj].el; navMarkSub(sj); navS = sj; }
            if (!tgt || !tgt.isConnected) return;
            navLock = Date.now() + 900;
            body.style.setProperty('--ppTopH', (c.top.offsetHeight + 10) + 'px');
            tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(function () { navLock = 0; navSpy(); }, 950);
        });
        c.h.parentNode.insertBefore(nv, c.h.nextSibling); navMark(); navSubs(); navStat(); navSpy();
        // пока панель паспорта разворачивается (и ещё узкая), меню скрыто — иначе на долю секунды видно «сплюснутое» меню
        var fr = 0, rdy = function () {
            if (!nv.isConnected) return;
            var w = c.top.offsetWidth, open = !!document.querySelector('.app-container.passport-open');
            if ((open && w >= 440) || ++fr > 100) { nv.classList.add('rdy'); navSpy(); return; }
            requestAnimationFrame(rdy);
        };
        if (old && old.classList.contains('rdy')) nv.classList.add('rdy'); else rdy();
    }
    function stNav(top, h) {
        navCtx = { top: top, h: h }; navSig = ''; navBuild();
        if (!body._ppNavMo) {   // блоки могут дорисовываться позже — обновляем меню, только если изменился список заголовков
            body._ppNavMo = new MutationObserver(function () { clearTimeout(navT); navT = setTimeout(function () { navBuild(); navStat(); }, 300); });
            body._ppNavMo.observe(body, { childList: true, subtree: true });
            document.addEventListener('scroll', function () { if (!navRaf) navRaf = requestAnimationFrame(navSpy); }, true);
        }
    }
    // сводка полосы: доля загруженных блоков среди подключённых (отключённые не считаются)
    function stSum() {
        var h = document.getElementById('ppSt'); if (!h) return;
        var on = 0, ok = 0, er = 0;
        Object.keys(STL).forEach(function (k) { var el = h.querySelector('[data-st="' + k + '"]'); if (!el || /\boff\b/.test(el.className)) return; on++; if (/\bok\b/.test(el.className)) ok++; else if (/\berr\b/.test(el.className)) er++; });
        var pct = on ? Math.round(ok / on * 100) : 100, a = document.getElementById('ppStPct'), t = document.getElementById('ppStTxt'), f = document.getElementById('ppStFill');
        if (a) a.textContent = pct + '%'; if (f) f.style.width = pct + '%';
        if (t) t.textContent = er ? 'ошибок: ' + er + ' (нажмите на блок)' : ok >= on ? 'всё загружено' : 'загружено ' + ok + ' из ' + on;
        h.classList.toggle('done', on > 0 && ok >= on); h.classList.toggle('hasErr', er > 0);
        navStat();
    }
    function stSet(k, st, msg) {
        var el = document.querySelector('#ppSt [data-st="' + k + '"]'); if (!el) return;
        el.className = 'pp-stc ' + st; el.style.cursor = st === 'err' ? 'pointer' : ''; el.title = (st === 'err' ? (msg || 'Ошибка') + ' — нажмите, чтобы обновить только этот раздел' : '') || msg || (st === 'off' ? (k === 'sat' ? 'Дата снимка не выбрана: выберите её на вкладке «Анализ» и запустите анализ' : 'Блок пока не работает: данные будут подключены позже') : st === 'load' ? 'Загружается…' : st === 'ok' ? 'Данные получены' : 'Ошибка');
        el.innerHTML = '<i class="fas fa-' + (st === 'load' ? 'spinner fa-spin' : st === 'off' ? 'circle-pause' : st === 'ok' ? 'circle-check' : 'triangle-exclamation') + '"></i>' + STL[k] + (st === 'err' ? ' <i class="fas fa-rotate-right"></i>' : '');
        stSum();
    }
    function address(c, tok, n) {
        n = n || 0;
        reverseGeocode(c).then(function (j) {
            if (tok !== seq) return; var el = document.getElementById('ppAddr'); if (el) el.textContent = j.display_name || 'адрес не найден'; stSet('addr', j.display_name ? 'ok' : 'err', j.display_name ? '' : 'адрес не найден');
        }).catch(function () { if (tok === seq) { stSet('addr', 'err', 'нет связи с геокодером'); if (n < RETRY_WAIT.length) setTimeout(function () { if (tok === seq) { stSet('addr', 'load'); address(c, tok, n + 1); } }, RETRY_WAIT[n]); } var el = document.getElementById('ppAddr'); if (el) el.textContent = 'не удалось определить (нет связи с геокодером)'; });
    }

    // ---------- пересечения с кадастровыми участками (слой «Земельные участки из ЕГРН» НСПД; опрос — window.gcCadIntersect из ux-extras.js) ----------
    // полоса загрузки на время опроса НСПД: d из t точек (t = 0 — ход неизвестен, полоса бегает)
    function cadBar(label, d, t) {
        var k = t ? Math.min(100, Math.round(d / t * 100)) : 0;
        return '<div class="pp-note pp-load"><div class="pp-load-t"><span><i class="fas fa-spinner fa-spin"></i> ' + label + '</span><b>' + (t ? k + ' % · ' + d + ' из ' + t : '…') + '</b></div><div class="pp-bar' + (t ? '' : ' ind') + '"><i style="width:' + (t ? k : 38) + '%"></i></div></div>';
    }
    function cadCalc(gj, alive, onProgress, layer) {
        if (!window.gcCadIntersect) return Promise.reject(new Error('модуль кадастра (ux-extras.js) не загружен'));
        return window.gcCadIntersect(gj, { alive: alive, onProgress: onProgress, layer: layer, max: layer ? 120 : 0 }).then(function (r) {
            if (!alive()) return null;
            var plots = polysOf(gj).map(function (p) { return turf.polygon(p); }), tot = turf.area(gj), items = [], cover = 0;
            r.items.forEach(function (it) {
                var parts = [], ia = 0;
                (it.geometry.type === 'Polygon' ? [it.geometry.coordinates] : it.geometry.coordinates).forEach(function (pc) {
                    plots.forEach(function (pl) { try { var x = turf.intersect(pl, turf.polygon(pc)), sq = x ? turf.area(x) : 0; if (sq > 0) { ia += sq; parts.push(x); } } catch (e) { /* вырожденная геометрия */ } });
                });
                if (ia >= 1) { it.ia = ia; it.parts = parts; items.push(it); cover += ia; }
            });
            items.sort(function (a, b) { return b.ia - a.ia; });
            return { items: items, cover: cover, tot: tot, req: r.req, bad: r.bad, step: r.step };
        });
    }
    function cadRun(gj, tok) {
        return cadCalc(gj, function () { return tok === seq; }, function (d, t) { var e = tok === seq && !D.cadx && document.getElementById('ppCadBody'); if (e) e.innerHTML = cadBar('Опрос слоя кадастра НСПД', d, t); }).then(function (x) {
            if (!x) return;
            D.cadx = x; cadShow();
        });
    }
    // картинка с тремя диаграммами (вид права, категория земель, вид использования) для листа Excel «Кадастр»: рисуется на холсте, три колонки в строку
    function cadDiaPng(its) {
        try {
            var PAL = ['#f59e0b', '#6366f1', '#16a34a', '#0ea5e9', '#ec4899', '#14b8a6', '#94a3b8'], FONT = "'Segoe UI', system-ui, Arial, sans-serif";
            var defs = [['Вид права', function (it) { return it.rights && it.rights.length ? it.rights.map(function (r) { return r[1]; }).join(' / ') : (it.own || ''); }],
                ['Категория земель', function (it) { return it.cat || ''; }], ['Вид использования', function (it) { return it.use || ''; }]];
            var cols = defs.map(function (df) {
                var g = {}, ord = [], sum = 0;
                its.forEach(function (it) { var k = String(df[1](it) || '').trim() || 'Нет данных'; if (!(k in g)) { g[k] = 0; ord.push(k); } g[k] += it.ia || 0; sum += it.ia || 0; });
                ord.sort(function (a, b) { return (a === 'Нет данных') - (b === 'Нет данных') || g[b] - g[a]; });
                var rows = ord.slice(0, 6).map(function (k) { return [k, g[k]]; }), rest = 0;
                ord.slice(6).forEach(function (k) { rest += g[k]; }); if (rest > 0) rows.push(['Прочее (' + (ord.length - 6) + ')', rest]);
                return { t: df[0], rows: rows, sum: sum };
            });
            var W = 1200, SC = 2, gap = 28, cw = (W - gap * 2) / 3, RH = 40, mr = Math.max.apply(null, cols.map(function (c) { return c.rows.length; })), H = 34 + mr * RH + 30;
            var cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
            var g = cv.getContext('2d'); g.scale(SC, SC); g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.textBaseline = 'alphabetic';
            var fit = function (s, mw) { if (g.measureText(s).width <= mw) return s; while (s.length > 1 && g.measureText(s + '…').width > mw) s = s.slice(0, -1); return s + '…'; };
            cols.forEach(function (c, ci) {
                var x0 = ci * (cw + gap), mx = c.rows.reduce(function (m, r) { return Math.max(m, r[1]); }, 0) || 1, vw = 110, bw = cw - vw - 8;
                g.fillStyle = '#0f172a'; g.font = 'bold 15px ' + FONT; g.fillText(c.t, x0, 18);
                c.rows.forEach(function (r, i) {
                    var y = 34 + i * RH, pc = c.sum ? r[1] / c.sum * 100 : 0, w = Math.max(3, r[1] / mx * bw);
                    g.fillStyle = '#334155'; g.font = '12px ' + FONT; g.fillText(fit(r[0], cw), x0, y + 12);
                    g.fillStyle = '#e2e8f0'; g.fillRect(x0, y + 18, bw, 10);
                    g.fillStyle = PAL[i % PAL.length]; g.fillRect(x0, y + 18, w, 10);
                    g.fillStyle = '#0f172a'; g.font = 'bold 11.5px ' + FONT; g.fillText(nf(r[1] / 1e4, 2) + ' га · ' + nf(pc, 0) + ' %', x0 + bw + 8, y + 27);
                });
            });
            g.fillStyle = '#64748b'; g.font = 'italic 11px ' + FONT; g.fillText('Суммарная площадь пересечения контура с кадастровыми участками, га и доля от суммы', 0, H - 8);
            return { url: cv.toDataURL('image/png'), w: W, h: H };
        } catch (e) { return null; }
    }
    // лист Excel «Кадастр»: сводка, карта (если есть снимок) и таблица участков; используется и в кнопке «Excel» блока, и в выгрузке всего паспорта
    function cadSheet(ST, snaps, dd) {
        var d = dd || D.cadx, sh = new Sheet('Кадастр', 'F59E0B'), t = document.getElementById('ppTitle'), sum = 0, pc = Math.min(100, d.cover / d.tot * 100), im = snaps && snaps.map && snaps.map.cadx;
        sh.colw = [5, 24, 16, 13, 11, 16, 13, 38, 30, 34]; sh.imgCol = 0;
        var hd = ST.get({ b: 1, color: 'FFFFFF', fill: '334155', border: 1, wrap: 1, v: 'center', h: 'center' }), tx = ST.get({ border: 1, wrap: 1 }), tb = ST.get({ border: 1, wrap: 1, b: 1 }),
            n0 = ST.get({ border: 1, h: 'right', nf: '#,##0' }), n1 = ST.get({ border: 1, h: 'right', nf: '0.0' }), n3 = ST.get({ border: 1, h: 'right', nf: '0.000' }),
            t0 = ST.get({ border: 1, b: 1, h: 'right', nf: '#,##0.0', fill: 'F1F5F9' }), t3 = ST.get({ border: 1, b: 1, h: 'right', nf: '0.000', fill: 'F1F5F9' }), tl = ST.get({ border: 1, b: 1, fill: 'F1F5F9' }),
            kl = ST.get({ b: 1, border: 1, fill: 'F1F5F9' }), kv = ST.get({ border: 1, h: 'right' }), nt = ST.get({ i: 1, color: '64748B', wrap: 1 });
        sh.add([{ v: 'Пересечения контура с кадастровыми участками', s: ST.get({ b: 1, sz: 16, color: 'B45309' }), span: 10 }], 26);
        sh.add([{ v: (dd ? 'Границы, форма и кадастр' : t ? norm(t.textContent) : 'Паспорт участка') + ' · площадь контура ' + nf(d.tot / 1e4, 2) + ' га · ' + new Date().toLocaleString('ru-RU'), s: ST.get({ i: 1, color: '64748B' }), span: 10 }]);
        sh.add([]);
        [['Участков пересекает контур', d.items.length], ['Покрыто кадастровыми границами', nf(pc, 1) + ' % (' + nf(d.cover / 1e4, 2) + ' га)'], ['Вне кадастровых границ', nf(100 - pc, 1) + ' % (' + nf(Math.max(0, d.tot - d.cover) / 1e4, 2) + ' га)']].forEach(function (r) { sh.add([{ v: r[0], s: kl, span: 3 }, { v: r[1], s: kv, span: 2 }]); });
        sh.add([]);
        if (im) { addImgs(sh, sh.rows.length, [imgOf(im, 520)]); sh.add([]); }
        var cdi = d.items.length ? cadDiaPng(d.items) : null; if (cdi) { addImgs(sh, sh.rows.length, [imgOf(cdi, 1250)]); sh.add([]); }   // диаграммы по виду права, категории земель и виду использования
        sh.af = 'A' + (sh.rows.length + 1) + ':J' + (sh.rows.length + 1 + d.items.length);
        sh.add(['№', 'Кадастровый номер', 'Пересечение, м²', 'Пересечение, га', '% контура', 'Площадь по ЕГРН, м²', '% кадастрового участка', 'Вид разрешённого использования', 'Категория земель', 'Права (форма собственности)'].map(function (h) { return { v: h, s: hd }; }), 32);
        d.items.forEach(function (it, i) {
            var rt = it.rights.length ? it.rights.map(function (r) { return r[0] + ': ' + r[1]; }).join('; ') : (it.own || ''), ln = Math.max(1, Math.ceil((it.use || '').length / 38), Math.ceil(rt.length / 34), Math.ceil((it.cat || '').length / 30));
            sum += it.ia;
            sh.add([{ v: i + 1, s: n0 }, { v: it.num || '', s: tb }, { v: Math.round(it.ia * 10) / 10, s: n1 }, { v: Math.round(it.ia / 10) / 1000, s: n3 }, { v: Math.round(it.ia / d.tot * 1000) / 10, s: n1 },
                { v: it.area ? Math.round(it.area) : '', s: n0 }, { v: it.area ? Math.round(Math.min(100, it.ia / it.area * 100) * 10) / 10 : '', s: n1 }, { v: it.use || '', s: tx }, { v: it.cat || '', s: tx }, { v: rt, s: tx }], ln * 14 + 3);
        });
        sh.add([{ v: '', s: tl }, { v: 'Итого', s: tl }, { v: Math.round(sum * 10) / 10, s: t0 }, { v: Math.round(sum / 10) / 1000, s: t3 }, { v: Math.round(sum / d.tot * 1000) / 10, s: t0 }, { v: '', s: tl }, { v: '', s: tl }, { v: '', s: tl }, { v: '', s: tl }, { v: '', s: tl }]);
        sh.add([]);
        sh.add([{ v: 'Источник — слой «Земельные участки из ЕГРН» НСПД (Росреестр). «Права» — форма собственности и иные сведения о правах, которые отдаёт публичная карта (правообладатели не раскрываются). Опрошено ' + d.req + ' точек' + (d.step ? ' (шаг ≈ ' + d.step + ' м)' : '') + '; участки уже шага сетки могут быть пропущены.', s: nt, span: 10 }], 30);
        return sh;
    }
    // кнопка «Excel» в шапке таблицы: отдельный файл с одним листом
    function cadXlsx() {
        var d = D.cadx; if (!d || !d.items.length) return;
        var ST = new Styles(), im = null; try { im = minis.cadx ? snap(minis.cadx, true) : null; } catch (e) { /* карта без снимка */ }
        save(buildXlsx([cadSheet(ST, { map: { cadx: im } })], ST), fileStem() + '_kadastr.xlsx');
        say('✅ Таблица пересечений с кадастром сохранена в Excel');
    }
    // выбор участка: строка таблицы и контур на мини-карте подсвечиваются (повторный клик снимает выбор)
    var CAD_ST = { n: [{ color: '#f59e0b', weight: 1.8, fillColor: '#f59e0b', fillOpacity: 0.12 }, { color: '#ef4444', weight: 1, fillColor: '#ef4444', fillOpacity: 0.45 }], s: [{ color: '#2563eb', weight: 3.5, fillColor: '#3b82f6', fillOpacity: 0.3 }, { color: '#1e3a8a', weight: 1.5, fillColor: '#1d4ed8', fillOpacity: 0.65 }] };
    function cadSel(i) {
        var d = D.cadx, el = document.getElementById('ppCadBody'); if (!d) return;
        d.sel = d.sel === i ? -1 : i;
        if (el) Array.prototype.forEach.call(el.querySelectorAll('tr[data-ci]'), function (tr) { tr.classList.toggle('pp-cadsel', +tr.getAttribute('data-ci') === d.sel); });
        (d.lay || []).forEach(function (l, k) {
            var on = k === d.sel, c = CAD_ST[on ? 's' : 'n'];
            l.base.setStyle(c[0]); l.parts.forEach(function (x) { x.setStyle(c[1]); });
            if (on) { l.base.bringToFront(); l.parts.forEach(function (x) { x.bringToFront(); }); }
        });
    }
    // ---- диаграммы по пересечениям с кадастром: суммарная площадь пересечения по виду права, категории земель и виду использования ----
    // mode: 'row' — три в строку (паспорт), 'col' — в столбик (панель анализа)
    function cadDia(its, tot, mode) {
        var PAL = ['#f59e0b', '#6366f1', '#16a34a', '#0ea5e9', '#ec4899', '#14b8a6', '#94a3b8'];
        var defs = [
            ['Вид права', function (it) { return it.rights && it.rights.length ? it.rights.map(function (r) { return r[1]; }).join(' / ') : (it.own || ''); }],
            ['Категория земель', function (it) { return it.cat || ''; }],
            ['Вид использования', function (it) { return it.use || ''; }]];
        return '<div class="pp-cadcharts pp-cc-' + mode + '">' + defs.map(function (df) {
            var g = {}, ord = [], sum = 0;
            its.forEach(function (it) { var k = String(df[1](it) || '').trim() || 'Нет данных'; if (!(k in g)) { g[k] = 0; ord.push(k); } g[k] += it.ia || 0; sum += it.ia || 0; });
            ord.sort(function (a, b) { return (a === 'Нет данных') - (b === 'Нет данных') || g[b] - g[a]; });
            var rows = ord.slice(0, 6).map(function (k) { return [k, g[k]]; }), rest = 0;
            ord.slice(6).forEach(function (k) { rest += g[k]; }); if (rest > 0) rows.push(['Прочее (' + (ord.length - 6) + ')', rest]);
            var mx = rows.reduce(function (m, r) { return Math.max(m, r[1]); }, 0) || 1;
            return chart(df[0], rows.map(function (r, i) {
                var pc = sum ? r[1] / sum * 100 : 0;
                return '<div class="pp-cdr"><span class="pp-cdl" title="' + esc(r[0]) + '">' + esc(r[0]) + '</span><span class="pp-cdv"><span class="pp-cdbar"><i style="width:' + Math.max(2, r[1] / mx * 100).toFixed(1) + '%;background:' + PAL[i % PAL.length] + '"></i></span><b>' + nf(r[1] / 1e4, 2) + ' га · ' + nf(pc, 0) + ' %</b></span></div>';
            }).join(''), 'Суммарная площадь пересечения контура с участками, га и доля от суммы');
        }).join('') + '</div>';
    }
    function cadShow() {
        var d = D.cadx, el = document.getElementById('ppCadBody'); if (!el || !d) return;
        var its = d.items, pc = Math.min(100, d.cover / d.tot * 100); d.sel = -1;
        var rows = its.map(function (it, i) {
            return '<tr data-ci="' + i + '"><td>' + (i + 1) + '</td><td><b>' + esc(it.num || '—') + '</b></td><td>' + nf(it.ia, 0) + ' м² (' + nf(it.ia / 1e4, 3) + ' га)</td><td>' + nf(it.ia / d.tot * 100, 1) + ' %</td><td>' + (it.area ? nf(it.area, 0) + ' м²' : '—') + '</td><td>' + (it.area ? nf(Math.min(100, it.ia / it.area * 100), 1) + ' %' : '—') + '</td><td>' + esc(it.use || '—') + '</td><td>' + esc(it.cat || '—') + '</td><td>' + (it.rights.length ? it.rights.map(function (r) { return esc(r[0]) + ': ' + esc(r[1]); }).join('<br>') : esc(it.own || '—')) + '</td></tr>';
        }).join('');
        var cap = 'Источник — слой «Земельные участки из ЕГРН» НСПД (Росреестр). «Права» — форма собственности и иные сведения о правах, которые отдаёт публичная карта (правообладатели не раскрываются). Опрошено ' + d.req + ' точек' + (d.step ? ' (шаг ≈ ' + d.step + ' м)' : '') + (d.bad ? ', без ответа — ' + d.bad : '') + '; участки уже шага сетки могут быть пропущены. Нажмите на строку — участок выделится на карте.';
        el.innerHTML = tiles([['Участков пересекает контур', nf(its.length, 0), '', CC.gen], ['Покрыто кадастром', nf(pc, 1) + ' %', nf(d.cover / 1e4, 2) + ' га', '#f59e0b'], ['Вне кадастровых границ', nf(100 - pc, 1) + ' %', nf(Math.max(0, d.tot - d.cover) / 1e4, 2) + ' га', '#64748b']]) +
            (its.length ? '<div class="pp-cadtbl">' + chart('Список пересекаемых кадастровых участков <span class="pp-cadbt" style="display:inline-flex;margin-left:8px;vertical-align:middle"><details class="pp-cadmenu pp-expm"><summary class="pp-btn pp-vcopy" title="Экспорт участков"><i class="fas fa-download"></i> Экспорт <i class="fas fa-chevron-down"></i></summary><div class="pp-cadmenu-l">' + [['xlsx', 'file-excel', 'Excel', 'Таблица пересечений в Excel'], ['kml', 'file-export', 'KML', 'Границы участков целиком с атрибутами — KML'], ['geojson', 'file-export', 'GeoJSON', 'Границы участков целиком с атрибутами — GeoJSON'], ['shp', 'file-export', 'SHP', 'Границы участков целиком с атрибутами — Shapefile (ZIP)'], ['dxf', 'file-export', 'DXF', 'Границы участков целиком — DXF (AutoCAD, UTM)']].map(function (x) { return '<button type="button" class="pp-btn" data-cadx="' + x[0] + '" title="' + x[3] + '"><i class="fas fa-' + x[1] + '"></i> ' + x[2] + '</button>'; }).join('') + '</div></details></span>', '<div class="pp-vt"><table><thead><tr><th>№</th><th>Кадастровый номер</th><th>Пересечение</th><th>% контура</th><th>Площадь по ЕГРН</th><th>% участка</th><th>Вид использования</th><th>Категория земель</th><th>Права</th></tr></thead><tbody>' + rows + '</tbody></table></div>', cap) + '</div>' + cadDia(its, d.tot, 'row') : '<div class="pp-note">Кадастровых участков в пределах контура не найдено (опрошено ' + d.req + ' точек). ' + esc(cap) + '</div>');
        Array.prototype.forEach.call(el.querySelectorAll('[data-cadx]'), function (b) {
            b.onclick = function (ev) {
                ev.stopPropagation();
                var f = b.getAttribute('data-cadx');
                if (f === 'xlsx') cadXlsx();
                else if (window.gcCadExport) window.gcCadExport(f, d.items);
                else say('Экспорт недоступен: не загружен модуль кадастра (ux-extras.js)', true);
            };
        });
        Array.prototype.forEach.call(el.querySelectorAll('tr[data-ci]'), function (tr) { tr.onclick = function () { cadSel(+tr.getAttribute('data-ci')); }; });
        var o = minis.cadx; if (!o) return;
        d.lay = [];
        its.forEach(function (it, i) {
            var base = L.geoJSON({ type: 'Feature', geometry: it.geometry, properties: {} }, { style: CAD_ST.n[0] }).addTo(o.map), parts = it.parts.map(function (x) { return L.geoJSON(x, { style: CAD_ST.n[1], interactive: false }).addTo(o.map); });
            base.on('click', function () { cadSel(i); var tr = el.querySelector('tr[data-ci="' + i + '"]'); if (tr && d.sel === i) { try { tr.scrollIntoView({ block: 'nearest' }); } catch (e) { /* без прокрутки */ } } });
            d.lay.push({ base: base, parts: parts });
        });
        // отрисовка поверх тайлов в снимке карты (PDF, HTML, Excel): контуры участков и пересечения, легенда
        o.draw = function (g, m) {
            var path = function (geom) { (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).forEach(function (pl) { pl.forEach(function (r) { r.forEach(function (pt, k) { var q = m.latLngToContainerPoint([pt[1], pt[0]]); if (k) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); g.closePath(); }); }); };
            g.lineJoin = 'round';
            its.forEach(function (it) { g.beginPath(); path(it.geometry); g.fillStyle = 'rgba(245,158,11,.14)'; g.fill('evenodd'); g.strokeStyle = '#f59e0b'; g.lineWidth = 1.8; g.stroke(); });
            its.forEach(function (it) { it.parts.forEach(function (x) { g.beginPath(); path(x.geometry); g.fillStyle = 'rgba(239,68,68,.45)'; g.fill('evenodd'); g.strokeStyle = '#ef4444'; g.lineWidth = 1; g.stroke(); }); });
            var y = m.getSize().y - 62;
            g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(8, y, 196, 42);
            [['#f59e0b', 'кадастровые участки'], ['#ef4444', 'пересечение с контуром']].forEach(function (x, k) { g.fillStyle = x[0]; g.globalAlpha = 0.6; g.fillRect(16, y + 8 + k * 16, 12, 10); g.globalAlpha = 1; g.strokeStyle = x[0]; g.lineWidth = 1; g.strokeRect(16, y + 8 + k * 16, 12, 10); g.fillStyle = '#0f172a'; g.font = '11px sans-serif'; g.fillText(x[1], 34, y + 17 + k * 16); });
        };
        var lg = document.getElementById('ppLeg_cadx'), sw = function (c, t) { return '<i style="display:inline-block;width:10px;height:10px;background:' + c + ';opacity:.6;border:1px solid ' + c + ';margin:0 4px 0 8px;vertical-align:-1px"></i>' + t; };
        if (lg) lg.innerHTML = '<div class="pp-legsrc">' + sw('#f59e0b', 'кадастровые участки') + sw('#ef4444', 'пересечение с контуром') + sw('#2563eb', 'выбранный в таблице') + '<br>Источник: НСПД (Росреестр)</div>';
    }
    // ---------- 2. классификация ----------
    var CLS = [['Пашня', '#f59e0b', 'обрабатываемые поля, посевы'], ['Луга и пастбища', '#10b981', 'травянистая растительность'], ['Лес', '#166534', 'древесная растительность'], ['Вода', '#0ea5e9', 'реки, озёра, пруды'], ['Застройка', '#64748b', 'здания, дороги, твёрдые покрытия'], ['Прочее', '#a8a29e', 'голая почва, кустарники, болота']];
    function classification() {
        var why = 'Появится после подключения слоя классификации';
        return sec(2, 'seedling', 'Классификация земли', 'Из чего состоит участок: пашня, луга, лес, вода, застройка', CC.cls, blk({
            t: 'Структура землепользования', i: 'chart-pie',
            info: ['Разделение территории участка на классы земельного покрова: пашня, луга и пастбища, лес, вода, застройка, прочее.',
                'Показывает, какая часть участка реально пригодна под пашню, а какая занята лесом, водой или застройкой; помогает сверить кадастровые данные с фактическим использованием и найти нецелевое использование.',
                'Каждому пикселю космоснимка (10 м) присваивается класс по слою классификации земного покрова (Sentinel-2 / Esri Land Cover); площадь класса = число пикселей класса внутри контура × 100 м², доля = площадь класса / площадь участка.'],
            map: mapBox('cls', dis('KML', 'file-code', why) + dis('GeoJSON', 'file-code', why) + dis('SHP', 'file-zipper', why)),
            body: '<div class="pp-note">Слой классификации пока не подключён — расчёт будет выполнен автоматически позже.</div><div class="pp-dn">' + donut(CLS.map(function (c) { return { l: c[0], c: c[1], v: 0 }; }), '—', 'нет данных') +
                clsRows(CLS.map(function (c) { return { l: c[0], c: c[1], v: 0, t: '— га', s: c[2] }; })) + '</div>' + chart('Площади по классам, га', emptyChart('появится после подключения слоя'))
        }));
    }

    // ---------- 3. спутниковые снимки ----------
    var SATS = [
        { k: 's2rgb', t: 'Sentinel-2 · естественные и ложные цвета', i: 'image', c: '#0ea5e9', l: 'яркости каналов',
            f: ['Снимок участка в естественных цветах (так его видит глаз) и рядом — в ложных цветах (CIR), где растительность выглядит красной.', 'Визуальный контроль посевов, границ полей, застройки и воды; в ложных цветах легко отличить здоровую растительность от угнетённой, голой почвы и воды; подложка для проверки всех индексов.', 'Композит Sentinel-2 L2A (10 м): красный B04 (665 нм), зелёный B03 (560 нм), синий B02 (490 нм); ложные цвета (CIR): ближний ИК B08 (842 нм) → красный канал, B04 → зелёный, B03 → синий; облака и тени маскируются по слою SCL, выбирается наименее облачная сцена.'] },
        { k: 'ndvi', t: 'NDVI — вегетация', i: 'leaf', c: '#16a34a', l: 'NDVI',
            f: ['Нормализованный вегетационный индекс — показатель количества и «зелёности» растительной массы.', 'Выявляет неоднородность посевов и угнетённые зоны, позволяет планировать дифференцированное внесение удобрений, оценивать фазы развития и потенциал урожайности.', 'NDVI = (NIR − Red) / (NIR + Red) = (B08 − B04) / (B08 + B04) по Sentinel-2 L2A (10 м); значения от −1 до 1; статистика — по пикселям внутри контура.'],
            sc: [['> 0,7 · очень густая растительность', '#15803d'], ['0,5–0,7 · густая', '#22c55e'], ['0,3–0,5 · умеренная', '#a3e635'], ['0,1–0,3 · разреженная, всходы', '#facc15'], ['< 0,1 · голая почва, вода, застройка', '#a8a29e']] },
        { k: 'ndmi', t: 'NDMI — влажность растительности', i: 'cloud-rain', c: '#0ea5e9', l: 'NDMI',
            f: ['Индекс влажности растительного покрова (содержание воды в листьях).', 'Раннее выявление водного стресса и засухи — до появления видимых признаков; планирование полива и сроков уборки.', 'NDMI = (NIR − SWIR1) / (NIR + SWIR1) = (B08 − B11) / (B08 + B11); канал B11 (20 м) приводится к 10 м.'],
            sc: [['> 0,4 · высокая влагообеспеченность', '#0ea5e9'], ['0,2–0,4 · хорошая', '#4ade80'], ['0–0,2 · умеренная', '#facc15'], ['−0,2–0 · водный стресс', '#f97316'], ['< −0,2 · сильный стресс, сухая почва', '#dc2626']] },
        { k: 'nbr', t: 'NBR — состояние растительного покрова', i: 'wheat-awn', c: '#ea580c', l: 'NBR',
            f: ['Нормализованный индекс по ближнему и коротковолновому ИК (SWIR2) — чувствителен к сухой биомассе, влажности покрова и голой почве.', 'Показывает угнетение и усыхание посевов, созревание культур, стерню и обнажённую почву; сравнение дат — динамику состояния участка.', 'NBR = (NIR − SWIR2) / (NIR + SWIR2) = (B08 − B12) / (B08 + B12); для сравнения дат считают ΔNBR = NBR до − NBR после.'],
            sc: [['> 0,3 · здоровая густая растительность', '#16a34a'], ['0,1–0,3 · умеренный покров', '#facc15'], ['−0,1–0,1 · слабый или сухой покров', '#f97316'], ['< −0,1 · голая почва, сухая биомасса', '#dc2626']] },
        { k: 'gndvi', t: 'GNDVI — хлорофилл (зелёный канал)', i: 'spa', c: '#14b8a6', l: 'GNDVI',
        f: ['Зелёный NDVI: показатель содержания хлорофилла в растительном покрове; меньше насыщается на густых посевах.', 'Оценка азотного питания и состояния густых посевов, где NDVI уже не растёт; выявляет неоднородность поля.', 'GNDVI = (NIR − Green) / (NIR + Green) = (B08 − B03) / (B08 + B03) по Sentinel-2 L2A (10 м); статистика — по пикселям внутри контура.'],
        sc: [['> 0,7 · густые здоровые посевы', '#15803d'], ['0,5–0,7 · активная вегетация', '#22c55e'], ['0,3–0,5 · умеренная', '#a3e635'], ['0,15–0,3 · слабая', '#facc15'], ['< 0,15 · почва, вода', '#a8a29e']] },
        { k: 'ndre', t: 'NDRE — азот и хлорофилл (Red Edge)', i: 'vial', c: '#a855f7', l: 'NDRE',
        f: ['Индекс по краю красного (Red Edge) — чувствителен к содержанию хлорофилла и азота в листьях.', 'Раннее выявление нехватки азота и хлороза на густых посевах; планирование подкормок.', 'NDRE = (NIR − RedEdge1) / (NIR + RedEdge1) = (B08 − B05) / (B08 + B05); канал B05 (20 м) приводится к 10 м.'],
        sc: [['> 0,5 · высокое содержание хлорофилла', '#15803d'], ['0,35–0,5 · хорошее', '#22c55e'], ['0,2–0,35 · умеренное', '#a3e635'], ['0,1–0,2 · слабое', '#facc15'], ['< 0,1 · почва, вода, нет вегетации', '#a8a29e']] },
        { k: 'savi', t: 'SAVI — вегетация с поправкой на почву', i: 'tree', c: '#eab308', l: 'SAVI',
        f: ['NDVI с поправкой на яркость почвы (L = 0,5): меньше искажается фоном при редком покрове.', 'Оценка всходов и начала сезона, когда почва просвечивает между растениями.', 'SAVI = 1,5 · (NIR − Red) / (NIR + Red + 0,5) = 1,5 · (B08 − B04) / (B08 + B04 + 0,5) по Sentinel-2 L2A (10 м).'],
        sc: [['> 0,65 · плотная растительность', '#15803d'], ['0,45–0,65 · густая', '#22c55e'], ['0,25–0,45 · умеренная', '#a3e635'], ['0,1–0,25 · редкая', '#facc15'], ['< 0,1 · голая почва, вода', '#a8a29e']] },
        { k: 'ndwi', t: 'NDWI — вода и переувлажнение', i: 'water', c: '#06b6d4', l: 'NDWI',
        f: ['Индекс по зелёному и ближнему ИК каналам — выделяет открытую воду и избыток влаги на поверхности.', 'Поиск водоёмов, подтоплений, переувлажнённых низин и мокрой почвы.', 'NDWI = (Green − NIR) / (Green + NIR) = (B03 − B08) / (B03 + B08) по Sentinel-2 L2A (10 м).'],
        sc: [['> 0,3 · открытая вода', '#01665e'], ['0–0,3 · переувлажнение, мокрая почва', '#5ab4ac'], ['−0,3–0 · умеренная сухость', '#f6e8c3'], ['< −0,3 · сухая почва, растительность', '#8c510a']] },
        { k: 'ndti', t: 'NDTI — растительные остатки', i: 'bars-staggered', c: '#92400e', l: 'NDTI',
        f: ['Индекс по двум каналам SWIR — показывает долю пожнивных остатков на поверхности почвы.', 'Контроль стерни и системы обработки (no-till, минимальная обработка), оценка защиты почвы от эрозии.', 'NDTI = (SWIR1 − SWIR2) / (SWIR1 + SWIR2) = (B11 − B12) / (B11 + B12); каналы 20 м приводятся к 10 м.'],
        sc: [['> 0,1 · много остатков', '#8c510a'], ['0,05–0,1 · умеренно', '#e6963c'], ['0–0,05 · мало остатков', '#d9ef8b'], ['< 0 · вегетация, чистая почва', '#1a9850']] }
    ];
    // ---------- 3. спутниковые снимки Sentinel-2: расчёт по дате, выбранной в «Анализе» ----------
    var SATCLS = {
        ndvi: [[-9, 0.1, 'Вода, голая почва, застройка', '#c2a878'], [0.1, 0.2, 'Очень редкая растительность', '#e8d98a'], [0.2, 0.4, 'Редкая, всходы, травы', '#b5d66b'], [0.4, 0.6, 'Густая растительность, посевы', '#5cb85c'], [0.6, 9, 'Плотная, пик вегетации', '#1e7d34']],
        ndmi: [[-9, -0.2, 'Сухая растительность, почва', '#8c510a'], [-0.2, 0.1, 'Низкая влажность', '#f6e8c3'], [0.1, 0.4, 'Умеренная влажность', '#5ab4ac'], [0.4, 9, 'Высокая влажность', '#01665e']],
        nbr: [[-9, 0.1, 'Гари, голая почва', '#f46d43'], [0.1, 0.3, 'Редкая растительность', '#fee08b'], [0.3, 0.5, 'Травы, кустарники, посевы', '#a6d96a'], [0.5, 9, 'Густая растительность', '#1a9850']],
        gndvi: [[-9, 0.15, 'Почва, вода', '#c2a878'], [0.15, 0.3, 'Слабая вегетация', '#e8d98a'], [0.3, 0.5, 'Умеренная вегетация', '#b5d66b'], [0.5, 0.7, 'Активная вегетация', '#5cb85c'], [0.7, 9, 'Густая, пик вегетации', '#1e7d34']],
        ndre: [[-9, 0.1, 'Почва, вода, нет вегетации', '#c2a878'], [0.1, 0.2, 'Низкое содержание хлорофилла', '#e8d98a'], [0.2, 0.35, 'Умеренное', '#b5d66b'], [0.35, 0.5, 'Хорошее', '#5cb85c'], [0.5, 9, 'Высокое', '#1e7d34']],
        savi: [[-9, 0.1, 'Голая почва, вода', '#c2a878'], [0.1, 0.25, 'Редкая растительность', '#e8d98a'], [0.25, 0.45, 'Умеренная', '#b5d66b'], [0.45, 0.65, 'Густая', '#5cb85c'], [0.65, 9, 'Плотная, пик вегетации', '#1e7d34']],
        ndwi: [[-9, -0.3, 'Сухая почва, растительность', '#8c510a'], [-0.3, 0, 'Умеренная сухость', '#f6e8c3'], [0, 0.3, 'Переувлажнение, мокрая почва', '#5ab4ac'], [0.3, 9, 'Открытая вода', '#01665e']],
        ndti: [[-9, 0, 'Вегетация, чистая почва', '#1a9850'], [0, 0.05, 'Мало остатков', '#d9ef8b'], [0.05, 0.1, 'Умеренно остатков', '#e6963c'], [0.1, 9, 'Много остатков (no-till, стерня)', '#8c510a']]
    };
    function satSel() { var m = forced && forced.meta; return (m && m.sat) || window.gcSatSel || null; }
    function satDay(d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    function satLLB(epsg, x0, y0, x1, y1) {   // границы растра в UTM → [[юг, запад], [север, восток]]
        var f = snProj(epsg), c = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(function (q) { return f.inverse(q); }), lo = c.map(function (q) { return q[0]; }), la = c.map(function (q) { return q[1]; });
        return [[Math.min.apply(null, la), Math.min.apply(null, lo)], [Math.max.apply(null, la), Math.max.apply(null, lo)]];
    }
    function satStats(r, k) {
        var v = r.values, m = r.mask, n = v.length, i, j = 0, valid = 0, total = 0, sum = 0;
        for (i = 0; i < n; i++) if (m[i]) { total++; if (v[i] === v[i]) valid++; }
        if (!valid) throw new Error('в контуре нет данных на эту дату — выберите другую дату');
        var a = new Float32Array(valid);
        for (i = 0; i < n; i++) if (m[i] && v[i] === v[i]) { a[j++] = v[i]; sum += v[i]; }
        a.sort();
        var mean = sum / valid, sq = 0, R = snRamp(k), bins = 16, hist = new Array(bins).fill(0), span = R.max - R.min, cls = (SATCLS[k] || []).map(function (c) { return { lo: c[0], hi: c[1], l: c[2], c: c[3], n: 0 }; });
        for (i = 0; i < valid; i++) { var d = a[i] - mean, x = a[i]; sq += d * d; hist[Math.max(0, Math.min(bins - 1, Math.floor((x - R.min) / span * bins)))]++; for (j = 0; j < cls.length; j++) if (x >= cls[j].lo && x < cls[j].hi) { cls[j].n++; break; } }
        var pc = function (q) { return a[Math.min(valid - 1, Math.floor(q * (valid - 1)))]; };
        return { total: total, valid: valid, ha: valid * 0.01, mean: mean, std: Math.sqrt(sq / valid), min: a[0], max: a[valid - 1], median: pc(0.5), hist: hist, cls: cls, R: R };
    }
    function satImg(r, k) {
        var cv = document.createElement('canvas'); cv.width = r.W; cv.height = r.H;
        var g = cv.getContext('2d'), im = g.createImageData(r.W, r.H), d = im.data, R = snRamp(k), span = R.max - R.min, i, li;
        for (i = 0; i < r.values.length; i++) if (r.mask[i] && r.values[i] === r.values[i]) { li = Math.round(cl01((r.values[i] - R.min) / span) * 255) * 3; d[i * 4] = R.lut[li]; d[i * 4 + 1] = R.lut[li + 1]; d[i * 4 + 2] = R.lut[li + 2]; d[i * 4 + 3] = 255; }
        g.putImageData(im, 0, 0); return cv.toDataURL('image/png');
    }
    function satOn(k, title) { var b = body.querySelector('[data-sat-tif="' + k + '"]'); if (b) { b.disabled = false; b.title = 'Скачать GeoTIFF с привязкой'; } var o = minis[k], day = D.sat && D.sat[k] && D.sat[k].day; if (!o) return;
        o.title = title + (day ? ' · ' + day.split('-').reverse().join('.') : '');
        if (o.badge) { try { o.badge.remove(); } catch (e) { /* уже снят */ } o.badge = null; }
        if (!day) return;
        var c = L.control({ position: 'topright' });
        c.onAdd = function () { var d = L.DomUtil.create('div', 'pp-satdate'); d.innerHTML = '<i class="fas fa-calendar-day"></i> ' + satDay(day); d.style.cssText = 'background:rgba(15,23,42,.8);color:#fff;font:600 11px/1 system-ui,sans-serif;padding:5px 8px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.3)'; return d; };
        c.addTo(o.map); o.badge = c;
    }
    async function satOne(s, st, gj, tok, sat) {
        var k = s.k, box = document.getElementById('ppSatB_' + k), f3 = function (v) { return nf(v, 3); };
        var pr = function (f, t) { if (box && tok === seq && box.querySelector('.fa-spin')) box.innerHTML = '<div class="pp-note"><i class="fas fa-spinner fa-spin"></i> ' + esc(t || 'Загрузка') + '</div>'; };
        var args = { key: k === 's2rgb' ? 'sentinel2' : k, st: st, gj: gj, onProgress: pr, isAborted: function () { return tok !== seq; } };
        if (k === 's2rgb') {
            var mb = minis[k] && minis[k].map.getBounds();   // обычный снимок — на весь экстент мини-карты, а не только по контуру
            if (mb) args.gj = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[mb.getWest(), mb.getSouth()], [mb.getEast(), mb.getSouth()], [mb.getEast(), mb.getNorth()], [mb.getWest(), mb.getNorth()], [mb.getWest(), mb.getSouth()]]] } };
            var res = await snExportGeoTiff(args); if (tok !== seq) return;
            var im = await (await GeoTIFF.fromBlob(res.blob)).getImage(), w = im.getWidth(), h = im.getHeight(), ras = await im.readRasters({ interleave: true }), spp = Math.round(ras.length / (w * h)), bx = im.getBoundingBox();
            var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            var g = cv.getContext('2d'), id = g.createImageData(w, h), i;
            for (i = 0; i < w * h; i++) { id.data[i * 4] = ras[i * spp]; id.data[i * 4 + 1] = ras[i * spp + 1]; id.data[i * 4 + 2] = ras[i * spp + 2]; id.data[i * 4 + 3] = spp > 3 ? ras[i * spp + 3] : 255; }
            g.putImageData(id, 0, 0);
            if (tok !== seq) return;
            D.sat[k] = { blob: res.blob, name: res.name, day: sat.day };
            if (minis[k]) { var rgbU = cv.toDataURL('image/png'), rgbB = satLLB(res.epsg, bx[0], bx[1], bx[2], bx[3]); satOv[k] = addImg(k, rgbU, rgbB, 1); D.satRgb = { url: rgbU, bounds: rgbB, day: sat.day }; }
            if (box) box.innerHTML = tiles([['Дата съёмки', st.date.split('-').reverse().join('.'), '', s.c], ['Облачность сцены', sat.cc == null ? '—' : nf(sat.cc, 0) + ' %', '', '#64748b'], ['Сцен в контуре', nf(sat.scenes.length, 0), '', '#0ea5e9'], ['Разрешение', '10 м', 'Sentinel-2 L2A', '#14b8a6']]) + '<div class="pp-cap">Естественные цвета (B04 · B03 · B02) на весь экстент карты. Источник: Sentinel-2 L2A (ESA Copernicus), 10 м.</div>';
            satOn(k, s.t);
            try {   // ложные цвета (CIR: NIR · Red · Green) — рядом, на тот же экстент
                var rc = await snExportGeoTiff({ key: 'falsecolor', st: st, gj: args.gj, onProgress: function () { }, isAborted: args.isAborted }); if (tok !== seq) return;
                var im2 = await (await GeoTIFF.fromBlob(rc.blob)).getImage(), w2 = im2.getWidth(), h2 = im2.getHeight(), ras2 = await im2.readRasters({ interleave: true }), spp2 = Math.round(ras2.length / (w2 * h2)), bx2 = im2.getBoundingBox();
                var cv2 = document.createElement('canvas'); cv2.width = w2; cv2.height = h2;
                var g2 = cv2.getContext('2d'), id2 = g2.createImageData(w2, h2), i2;
                for (i2 = 0; i2 < w2 * h2; i2++) { id2.data[i2 * 4] = ras2[i2 * spp2]; id2.data[i2 * 4 + 1] = ras2[i2 * spp2 + 1]; id2.data[i2 * 4 + 2] = ras2[i2 * spp2 + 2]; id2.data[i2 * 4 + 3] = spp2 > 3 ? ras2[i2 * spp2 + 3] : 255; }
                g2.putImageData(id2, 0, 0);
                if (tok !== seq) return;
                D.sat.s2cir = { blob: rc.blob, name: rc.name, day: sat.day };
                if (minis.s2cir) satOv.s2cir = addImg('s2cir', cv2.toDataURL('image/png'), satLLB(rc.epsg, bx2[0], bx2[1], bx2[2], bx2[3]), 1);
                var lg2 = document.getElementById('ppLeg_s2cir'); if (lg2) lg2.innerHTML = '<div class="pp-legsrc">Ложные цвета (NIR · Red · Green → R · G · B): красный — растительность, тёмный — вода, голубоватый и серый — голая почва и застройка. Источник: Sentinel-2 L2A (ESA Copernicus), 10 м, снимок от ' + satDay(sat.day) + '.</div>';
                satOn('s2cir', 'Sentinel-2 · ложные цвета');
            } catch (e2) { if (tok !== seq) return; console.warn('Паспорт: ложные цвета', e2); var lg3 = document.getElementById('ppLeg_s2cir'); if (lg3) lg3.innerHTML = '<div class="pp-legsrc">Не удалось получить снимок в ложных цветах: ' + esc(e2 && e2.message || e2) + '</div>'; }
            return;
        }
        args.raw = true;
        var r = await snExportGeoTiff(args); if (tok !== seq) return;
        var S = satStats(r, k), R = S.R, ccol = function (t) { var li = Math.round(cl01(t) * 255) * 3; return 'rgb(' + R.lut[li] + ',' + R.lut[li + 1] + ',' + R.lut[li + 2] + ')'; };
        D.sat[k] = { r: r, stats: S, day: sat.day };
        if (minis[k]) {
            if (D.satRgb && D.satRgb.day === sat.day) satOv[k + '_u'] = addImg(k, D.satRgb.url, D.satRgb.bounds, 1);   // снизу — обычный снимок на весь экстент
            satOv[k] = addImg(k, satImg(r, k), satLLB(r.epsg, r.minE, r.maxN - r.H * SN_RES, r.minE + r.W * SN_RES, r.maxN), 0.9);
            setLeg(k, [0, 0.2, 0.4, 0.6, 0.8, 1].map(ccol), nf(R.min, 1), nf(R.max, 1), '');
        }
        if (box) box.innerHTML = tiles([['Дата съёмки', sat.day.split('-').reverse().join('.'), sat.cc == null ? '' : 'облачность ' + nf(sat.cc, 0) + ' %', '#64748b'], ['Среднее', f3(S.mean), '', s.c], ['Медиана', f3(S.median)], ['Минимум', f3(S.min)], ['Максимум', f3(S.max)], ['Станд. отклонение', f3(S.std)], ['Площадь анализа', nf(S.ha, 2) + ' га']]) +
            '<div class="pp-chs">' + chart('Распределение по классам', clsRows(S.cls.map(function (c) { return { l: c.l, c: c.c, v: c.n / S.valid, t: nf(c.n * 0.01, 2) + ' га' }; })), 'Доля площади участка, попавшая в диапазон значений индекса.') +
            chart('Гистограмма значений', hist2(S.hist, ccol, R.min, R.max, 2, '', [{ v: S.mean, c: '#0f172a', l: 'среднее' }]), 'Цвет столбца — цвет на карте. Без данных (вне снимка): ' + nf((S.total - S.valid) / S.total * 100, 1) + ' % площади контура.') + '</div>' +
            (s.sc ? chart('Как читать значения', '<div class="pp-sc">' + s.sc.map(function (x) { return '<span style="--c:' + x[1] + '">' + x[0] + '</span>'; }).join('') + '</div>') : '');
        satOn(k, s.t);
    }
    var satOv = {}, satCal = {}, satCache = {}, satBusy = {};
    async function satBlock(s, sat, gj, tok) {
        if (!D.sat) D.sat = {};
        await satOne(s, { date: sat.day, scenes: sat.scenes.map(function (x) { return { id: x.id }; }) }, gj, tok, sat);
    }
    // ---- компактный календарь Sentinel-2 внутри каждого блока: своя дата для каждого индекса ----
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    function calHtml(k) {
        return '<div class="pp-cal" data-cal="' + k + '"><button type="button" class="pp-cal-t" title="Выбрать дату снимка"><i class="fas fa-calendar-days"></i> <span>' + (D.satSel ? satDay(D.satSel.day) : 'Выбрать дату') + '</span></button>' +
            '<div class="pp-cal-p"><div class="pp-cal-h"><button type="button" data-cal-nav="-1"><i class="fas fa-chevron-left"></i></button><b></b><button type="button" data-cal-nav="1"><i class="fas fa-chevron-right"></i></button></div>' +
            '<div class="pp-cal-w"><span>пн</span><span>вт</span><span>ср</span><span>чт</span><span>пт</span><span>сб</span><span>вс</span></div><div class="pp-cal-g sn-cal"></div><div class="pp-cal-i"></div></div></div>';
    }
    function calDraw(k) {
        var c = satCal[k], root = body.querySelector('[data-cal="' + k + '"]'); if (!c || !root) return;
        var y = c.month.getUTCFullYear(), m = c.month.getUTCMonth(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), lead = (c.month.getUTCDay() + 6) % 7, by = {}, h = '', i, d, day, g;
        c.groups.forEach(function (x) { by[x.day] = x; });
        for (i = 0; i < lead; i++) h += '<span class="sn-cd empty"></span>';
        for (d = 1; d <= dim; d++) {
            day = y + '-' + p2(m + 1) + '-' + p2(d); g = by[day];
            if (!g) { h += '<span class="sn-cd off">' + d + '</span>'; continue; }
            var col = g.cc == null ? '#94a3b8' : g.cc <= 10 ? '#10b981' : g.cc <= 30 ? '#84cc16' : g.cc <= 60 ? '#f59e0b' : '#ef4444';
            h += '<button type="button" class="sn-cd has' + (c.day === day ? ' sel' : '') + '" data-cal-day="' + day + '" style="--c:' + col + '" title="облачность ' + (g.cc == null ? 'нет данных' : g.cc + ' %') + ' · снимков: ' + g.scenes.length + '">' + d + '<i></i></button>';
        }
        root.querySelector('.pp-cal-g').innerHTML = h; root.querySelector('.pp-cal-g').classList.remove('busy');
        root.querySelector('.pp-cal-h b').textContent = c.month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        var now = new Date(); root.querySelector('[data-cal-nav="1"]').disabled = c.month >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        root.querySelector('.pp-cal-i').textContent = c.note || '';
    }
    function calLoad(k) {
        var c = satCal[k], root = body.querySelector('[data-cal="' + k + '"]'); if (!c || !root || !D.gj) return;
        var t = turf.bbox(D.gj), bb = [t[0] - 0.0005, t[1] - 0.0005, t[2] + 0.0005, t[3] + 0.0005].map(function (v) { return +v.toFixed(3); });
        var y = c.month.getUTCFullYear(), m = c.month.getUTCMonth(), ck = bb.join(',') + '|' + y + '-' + m, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), my = ++c.req;
        if (satCache[ck]) { c.groups = satCache[ck]; c.note = c.groups.length ? '' : 'В этом месяце снимков нет.'; calDraw(k); return; }
        root.querySelector('.pp-cal-g').classList.add('busy'); root.querySelector('.pp-cal-i').textContent = 'Поиск снимков…';
        var url = (typeof SENTINEL !== 'undefined' && SENTINEL.stacUrl) || 'https://earth-search.aws.element84.com/v1';
        fetch(url + '/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: bb, limit: 200, datetime: y + '-' + p2(m + 1) + '-01T00:00:00Z/' + y + '-' + p2(m + 1) + '-' + p2(last) + 'T23:59:59Z', fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover'] } }) })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (data) {
                if (my !== c.req) return;
                var by = {};
                (data.features || []).forEach(function (f) { var p = f.properties || {}; if (!p.datetime) return; var d = p.datetime.slice(0, 10), cc = p['eo:cloud_cover'] != null ? Math.round(p['eo:cloud_cover']) : null; (by[d] = by[d] || { day: d, scenes: [] }).scenes.push({ id: f.id, cc: cc }); });
                c.groups = Object.keys(by).map(function (d) {
                    var g = by[d]; g.scenes.sort(function (a, b) { return (a.cc == null ? 101 : a.cc) - (b.cc == null ? 101 : b.cc); });
                    var v = g.scenes.filter(function (z) { return z.cc != null; }); g.cc = v.length ? Math.round(v.reduce(function (q, z) { return q + z.cc; }, 0) / v.length) : null; return g;
                });
                satCache[ck] = c.groups; c.note = c.groups.length ? '' : 'В этом месяце снимков нет.'; calDraw(k);
            })
            .catch(function (e) { if (my !== c.req) return; console.warn('Sentinel STAC', e); c.groups = []; c.note = 'Не удалось получить список снимков (' + (e && e.message || 'нет связи') + ').'; calDraw(k); });
    }
    async function calPick(k, g) {   // пересчёт одного блока на выбранную дату
        var s = SATS.filter(function (x) { return x.k === k; })[0], tok = seq, box = document.getElementById('ppSatB_' + k), root = body.querySelector('[data-cal="' + k + '"]');
        var sat = { day: g.day, cc: g.cc, scenes: g.scenes.map(function (x) { return { id: x.id, cc: x.cc }; }) };
        satCal[k].day = g.day; calDraw(k); root.querySelector('.pp-cal-t span').textContent = satDay(g.day); root.classList.remove('open');
        if (satOv[k]) { try { satOv[k].remove(); } catch (e) { /* нет */ } satOv[k] = null; }
        if (satOv[k + '_u']) { try { satOv[k + '_u'].remove(); } catch (e) { /* нет */ } satOv[k + '_u'] = null; }
        if (D.sat) delete D.sat[k];
        if (k === 's2rgb') {
            if (satOv.s2cir) { try { satOv.s2cir.remove(); } catch (e) { /* нет */ } satOv.s2cir = null; }
            if (D.sat) delete D.sat.s2cir;
            var b2 = body.querySelector('[data-sat-tif="s2cir"]'); if (b2) { b2.disabled = true; b2.title = 'GeoTIFF станет доступен после расчёта'; }
            var lg = document.getElementById('ppLeg_s2cir'); if (lg) lg.innerHTML = '';
        }
        var b = body.querySelector('[data-sat-tif="' + k + '"]'); if (b) { b.disabled = true; b.title = 'GeoTIFF станет доступен после расчёта'; }
        if (box) box.innerHTML = SPIN;
        try { await satBlock(s, sat, D.gj, tok); if (tok === seq) summary(); }
        catch (e) { if (tok !== seq) return; console.warn('Паспорт: снимки', e); if (box) box.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>'; }
    }
    body.addEventListener('click', function (e) {
        var root = e.target.closest('.pp-cal'); if (!root) return;
        var k = root.getAttribute('data-cal'), c = satCal[k];
        if (e.target.closest('.pp-cal-t')) {
            var on = !root.classList.contains('open');
            body.querySelectorAll('.pp-cal.open').forEach(function (x) { x.classList.remove('open'); });
            if (on) { root.classList.add('open'); if (!c) { var d0 = D.satSel ? new Date(D.satSel.day + 'T00:00:00Z') : new Date(); c = satCal[k] = { month: new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1)), groups: [], day: D.satSel ? D.satSel.day : null, note: '', req: 0 }; calLoad(k); } else calDraw(k); }
            return;
        }
        var nv = e.target.closest('[data-cal-nav]'); if (nv && c) { c.month = new Date(Date.UTC(c.month.getUTCFullYear(), c.month.getUTCMonth() + (+nv.getAttribute('data-cal-nav')), 1)); calLoad(k); return; }
        var dy = e.target.closest('[data-cal-day]'); if (dy && c) { var g = c.groups.filter(function (x) { return x.day === dy.getAttribute('data-cal-day'); })[0]; if (g) calPick(k, g); }
    });
    async function satRun(gj, tok) {
        var sat = D.satSel; if (!sat) return;
        var q;
        D.sat = {};
        for (q = 0; q < SATS.length; q++) {
            if (tok !== seq) return;
            try { await satBlock(SATS[q], sat, gj, tok); }
            catch (e) { if (tok !== seq) return; console.warn('Паспорт: снимки', e); var bx = document.getElementById('ppSatB_' + SATS[q].k); if (bx) bx.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>'; }
        }
    }
    body.addEventListener('click', function (e) {   // GeoTIFF по снимку (UTM, 10 м)
        var b = e.target.closest('[data-sat-tif]'); if (!b) return;
        var k = b.getAttribute('data-sat-tif'), X = D.sat && D.sat[k]; if (!X) return;
        b.disabled = true;
        (async function () {
            try {
                var blob, name;
                if (X.blob) { blob = X.blob; name = X.name; }
                else { var enc = await snEncodeTiff({ data: X.r.values, W: X.r.W, H: X.r.H, spp: 1, float: true, ox: X.r.minE, oy: X.r.maxN, epsg: X.r.epsg }, null, function () { }); blob = enc.blob; name = 'S2_' + k.toUpperCase() + '_' + (X.day || '') + '_EPSG' + X.r.epsg + '_10m_float32.tif'; }
                var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
                setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); updateStatus('✅ GeoTIFF сохранён');
            } catch (er) { updateStatus('⚠️ Не удалось сохранить GeoTIFF: ' + (er && er.message || er), true); }
            b.disabled = false;
        })();
    });
    function satellites() {
        var sat = satSel(); D.satSel = sat; satCal = {}; satOv = {};
        return sec(3, 'satellite', 'Спутниковые снимки и индексы', 'Sentinel-2: вегетация, влажность, вода, нарушения покрова', CC.sat,
            '<div class="pp-note">' + (sat ? 'Снимок Sentinel-2 L2A от <b>' + satDay(sat.day) + '</b>' + (sat.cc != null ? ' · облачность ' + nf(sat.cc, 0) + ' %' : '') + ' · сцен: ' + sat.scenes.length + '. Дату каждого блока можно сменить кнопкой календаря под картой. Облака и тени не исключаются — выбирайте дату с малой облачностью.' : 'Дата снимка не выбрана: выберите её кнопкой календаря под картой нужного блока (или во вкладке «Анализ»).') + '</div>' +
            SATS.map(function (s) {
                var tifBtn = function (q) { return '<button type="button" class="pp-btn" data-sat-tif="' + q + '" disabled title="' + (sat ? 'GeoTIFF станет доступен после расчёта' : 'Нет даты снимка') + '"><i class="fas fa-download"></i> GeoTIFF</button>'; };
                var two = s.k === 's2rgb';
                return blk({
                    t: s.t, i: s.i, c: s.c, info: s.f, id: 'ppSatB_' + s.k, body: sat ? SPIN : '<div class="pp-note">Дата не выбрана — выберите её кнопкой с календарём под картой.</div>',
                    cls: two ? 'pp-wide' : '',
                    map: two ? '<div class="pp-mpair">' + mapBox(s.k, calHtml(s.k) + tifBtn(s.k), 'Естественные цвета (R · G · B)') + mapBox('s2cir', tifBtn('s2cir'), 'Ложные цвета (NIR · R · G)') + '</div>'
                        : mapBox(s.k, calHtml(s.k) + tifBtn(s.k))
                });
            }).join(''));
    }

    // ---------- границы и форма участка: раздел «Анализ» (панель shape) — свои инструменты рисования, тот же расчёт, что в «Общей информации» паспорта ----------
    var dp = document.querySelector('[data-bp-pane="shape"]'), shpSeq = 0, shpTxt = '', SHP_HINT = 'Нарисуйте полигон, прямоугольник или круг (или импортируйте контур) — анализ границ, формы и пересечений с кадастром запустится сам.';
    var shp = { shape: null, gj: null, handler: null, tool: null, editing: false }, shpGrp = dp ? L.featureGroup().addTo(map) : null, shpCadGrp = dp ? L.featureGroup().addTo(map) : null, shpOoptGrp = dp ? L.featureGroup().addTo(map) : null;
    var SHP_ST = { color: '#6366f1', weight: 2, fillColor: '#6366f1', fillOpacity: 0.08 };
    function shpMark() {
        if (!dp) return;
        dp.querySelectorAll('[data-shp-tool]').forEach(function (b) { b.classList.toggle('active', b.dataset.shpTool === shp.tool); });
        dp.querySelectorAll('[data-shp-act="edit"]').forEach(function (b) { b.classList.toggle('active', shp.editing); });
    }
    function shpCancel() {
        if (shp.handler) { try { shp.handler.disable(); } catch (e) { /* уже выключен */ } shp.handler = null; }
        shp.tool = null; shpMark();
    }
    function shpEdit(on) {
        shp.editing = !!(on && shp.shape);
        if (shp.editing) gcSelect(shp.shape); else if (shp.shape && shp.shape === gcSel) gcDeselect();
        shpMark();
    }
    // подпись «Запрос к слою НСПД» внутри полигона на карте, пока идёт опрос кадастра и ООПТ
    var shpLoadMk = null;
    function shpLoadOff() { if (shpLoadMk) { try { map.removeLayer(shpLoadMk); } catch (e) { /* уже снят */ } shpLoadMk = null; } }
    function shpLoad(gj, text, k) {
        if (!dp || !gj) return;
        var ic = L.divIcon({ className: 'shp-ld', html: '<span><i class="fas fa-spinner fa-spin"></i> ' + text + (k != null ? ' · ' + k + ' %' : '') + '</span>', iconSize: [0, 0] });
        if (!shpLoadMk) {
            var c; try { c = turf.pointOnFeature(gj).geometry.coordinates; } catch (e) { c = turf.centroid(gj).geometry.coordinates; }
            shpLoadMk = L.marker([c[1], c[0]], { icon: ic, interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(map);
        } else shpLoadMk.setIcon(ic);
    }
    function shpInfo() {
        var el = dp && dp.querySelector('[data-shp-info]'); if (!el) return;
        var a = shp.gj ? turf.area(shp.gj) : 0;
        el.innerHTML = shp.gj ? 'Область: <b>' + (a < 1e7 ? nf(a / 1e4, 2) + ' га' : nf(a / 1e6, 1) + ' км²') + '</b>' : 'Нарисуйте полигон, прямоугольник или круг — анализ пройдёт по этой фигуре. Значок «рука» берёт фигуру, выбранную на карте.';
    }
    function shpSet(layer) {
        shpEdit(false); shpGrp.clearLayers(); shp.shape = layer; shpGrp.addLayer(layer);
        gcShape(layer, { name: 'uchastok', onChange: function (l, fin) { shp.gj = toGJ(l); if (fin) shpRun(); else shpInfo(); }, onDelete: shpDel });
        shp.gj = toGJ(layer); shpRun();
    }
    function shpDel() {
        shpLoadOff(); shpCancel(); shpEdit(false); shpGrp.clearLayers(); shpCadGrp.clearLayers(); shpOoptGrp.clearLayers(); shp.cadx = null; shp.oopt = null; shp.shape = null; shp.gj = null; shpSeq++; shpTxt = '';
        var out = document.getElementById('ppShpOut'); if (out) { out.className = 'pp-note'; out.innerHTML = SHP_HINT; }
        shpInfo();
    }
    function shpTool(t) {
        if (typeof m3d !== 'undefined' && m3d.active) { updateStatus('ℹ️ Рисование работает в 2D — выключите 3D кнопкой «2D» на карте', true); return; }
        var same = shp.tool === t;
        shpCancel(); shpEdit(false);
        if (same) return;
        if (typeof deactivateAllTools === 'function') deactivateAllTools();
        shp.tool = t; shpMark();
        shp.handler = t === 'polygon' ? new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: SHP_ST })
            : t === 'rectangle' ? new L.Draw.Rectangle(map, { shapeOptions: SHP_ST, showArea: false })
            : new L.Draw.Circle(map, { shapeOptions: SHP_ST, showRadius: true });
        shp.handler.enable();
        updateStatus('✏️ Рисуйте участок для анализа границ и формы — будет создана одна фигура (прежняя заменится)');
    }
    window.shpCancelTool = shpCancel;
    window.shpClearAll = function () { if (dp) shpDel(); };   // кнопка «Очистить» на карте
    window.shpOnCreated = function (e) {
        if (!shp.handler || !e.layer) return false;
        var layer = e.layer;
        shpCancel(); shpSet(layer);
        layer.on('edit', function () { shp.gj = toGJ(layer); shpRun(); });
        return true;
    };
    if (dp) gcShapeIO.shp = {
        name: 'uchastok',
        get: function () { return gcFC(shp.gj ? [shp.gj] : []); },
        put: function (fc) {
            var f = fc.features.find(function (x) { return /Polygon/.test(x.geometry.type); });
            if (!f) { updateStatus('⚠️ В файле нет полигона', true); return; }
            shpCancel();
            var l = L.geoJSON(f, { style: SHP_ST }).getLayers()[0];
            shpSet(l); map.fitBounds(l.getBounds());
        }
    };
    function shpInit() {
        if (!dp) return;
        dp.innerHTML = '<div class="dw-block"><div class="dw-title">Область на карте</div><div class="an-draw">' +
            '<button type="button" class="map-btn" data-shp-tool="polygon" title="Полигон"><i class="gc-pent"></i></button>' +
            '<button type="button" class="map-btn" data-shp-tool="rectangle" title="Прямоугольник"><i class="fas fa-vector-square"></i></button>' +
            '<button type="button" class="map-btn" data-shp-tool="circle" title="Круг / Овал"><i class="fas fa-circle"></i></button>' +
            '<button type="button" class="map-btn" data-shp-act="edit" title="Редактировать фигуру"><i class="fas fa-edit"></i></button>' +
            '<button type="button" class="map-btn" data-shp-act="sel" title="Взять фигуру, выбранную на карте"><i class="fas fa-hand-pointer"></i></button>' +
            '<button type="button" class="map-btn" data-shp-act="del" title="Удалить фигуру"><i class="fas fa-trash"></i></button>' +
            '<button type="button" class="map-btn" data-gc-io="import" data-gc-for="shp" title="Импорт полигона (KML, GeoJSON, Excel, XML Росреестра)"><i class="fas fa-file-import"></i></button>' +
            '<button type="button" class="map-btn" data-gc-io="export" data-gc-for="shp" title="Экспорт фигуры (KML, GeoJSON)"><i class="fas fa-file-export"></i></button></div>' +
            '<div class="an-hint" data-shp-info></div></div>' +
            '<div class="dw-block"><div class="dw-title">Границы, размеры, форма и кадастр</div><div id="ppShpOut" class="pp-note">' + SHP_HINT + '</div></div>';
        shpInfo();
    }
    function shpRun() {
        var out = document.getElementById('ppShpOut'); if (!out) return;
        var gj = shp.gj, tok = ++shpSeq; shpLoadOff(); shpInfo(); shp.cadx = null; shp.oopt = null; if (shpCadGrp) shpCadGrp.clearLayers(); if (shpOoptGrp) shpOoptGrp.clearLayers();
        if (!gj) { out.className = 'pp-note'; out.innerHTML = SHP_HINT; return; }
        var a = turf.area(gj), per = 0, nv = 0, c = turf.centroid(gj).geometry.coordinates, bb = turf.bbox(gj), cp = shp.shape && shp.shape.feature && shp.shape.feature.properties, cad = cp && cp.cad_number, cr = cadRows(cp, a);
        var polys = polysOf(gj), np = polys.length, rows = [], txt = ['№\tШирота\tДолгота'];
        polys.forEach(function (p, k) {
            p.forEach(function (r) { per += turf.length(turf.lineString(r), { units: 'kilometers' }); nv += Math.max(0, r.length - 1); });
            p[0].slice(0, -1).forEach(function (pt, i) { var n = (np > 1 ? (k + 1) + '.' : '') + (i + 1); rows.push('<tr><td>' + n + '</td><td>' + pt[1].toFixed(6) + '</td><td>' + pt[0].toFixed(6) + '</td></tr>'); txt.push(n + '\t' + pt[1].toFixed(6) + '\t' + pt[0].toFixed(6)); });
        });
        shpTxt = txt.join('\n');
        var K = compactionK(a, per);
        out.className = '';
        out.innerHTML = sizeTiles(a, per, nv, c, bb, K).replace(/<\/div>$/, '<div id="ppShpCadT" style="display:contents"></div></div>') + compactChart(K, ' K = 4π·S / P²: 1 — круг, ≈0,78 — квадрат, меньше 0,3 — сильно вытянутый.') + centerKv(c, cad, a, 'ppShpAddr') + cadChart(cp, cr) +
            '<div id="ppShpCad">' + cadBar('Опрос слоя кадастра НСПД', 0, 0) + '</div><div id="ppShpOopt"><div class="pp-note"><i class="fas fa-hourglass-half"></i> Пересечения с ООПТ: ожидание окончания опроса кадастра…</div></div>' +
            '<div class="pp-ch pp-vtw"><h5>Координаты вершин полигона <button type="button" class="pp-btn pp-vcopy" data-shp-copy title="Скопировать таблицу (столбцы через табуляцию — вставляется в Excel)"><i class="fas fa-copy"></i> Копировать</button></h5><div class="pp-vt"><table><thead><tr><th>№</th><th>Широта</th><th>Долгота</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div><div class="pp-cap">WGS-84, градусы; внешний контур' + (np > 1 ? ' каждой части участка' : '') + '.</div></div>';
        shpCadRun(gj, tok);
        reverseGeocode(c).then(function (j) {
            var el = tok === shpSeq && document.getElementById('ppShpAddr'); if (el) el.textContent = j.display_name || 'адрес не найден';
        }).catch(function () { var el = tok === shpSeq && document.getElementById('ppShpAddr'); if (el) el.textContent = 'не удалось определить (нет связи с геокодером)'; });
    }
    // ---- кадастр в разделе «Границы, форма и кадастр»: тот же расчёт и выгрузки, что в паспорте; контуры участков рисуются на основной карте ----
    function shpCadSel(i) {
        var d = shp.cadx, el = document.getElementById('ppShpCad'); if (!d) return;
        d.sel = d.sel === i ? -1 : i;
        if (el) Array.prototype.forEach.call(el.querySelectorAll('tr[data-ci],tr[data-cd]'), function (tr) { var dc = tr.hasAttribute('data-cd'), on = +tr.getAttribute(dc ? 'data-cd' : 'data-ci') === d.sel; tr.classList.toggle('pp-cadsel', on); if (dc) tr.hidden = !on; });
        (d.lay || []).forEach(function (l, k) {
            var on = k === d.sel, c = CAD_ST[on ? 's' : 'n'];
            l.base.setStyle(c[0]); l.parts.forEach(function (x) { x.setStyle(c[1]); });
            if (on) { l.base.bringToFront(); l.parts.forEach(function (x) { x.bringToFront(); }); }
        });
        if (d.sel >= 0) { try { map.fitBounds(d.lay[d.sel].base.getBounds().pad(0.3)); } catch (e) { /* без перехода */ } }
    }
    function shpCadXlsx() {
        var d = shp.cadx; if (!d || !d.items.length) return;
        var ST = new Styles(), t = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        save(buildXlsx([cadSheet(ST, null, d)], ST), 'kadastr_' + t.getFullYear() + p2(t.getMonth() + 1) + p2(t.getDate()) + '.xlsx');
        updateStatus('✅ Таблица пересечений с кадастром сохранена в Excel');
    }
    function shpCadShow() {
        var d = shp.cadx, el = document.getElementById('ppShpCad'); if (!el || !d) return;
        var its = d.items, pc = Math.min(100, d.cover / d.tot * 100); d.sel = -1; d.lay = [];
        shpCadGrp.clearLayers();
        its.forEach(function (it) {
            d.lay.push({ base: L.geoJSON({ type: 'Feature', geometry: it.geometry, properties: {} }, { style: CAD_ST.n[0], interactive: false }).addTo(shpCadGrp), parts: it.parts.map(function (x) { return L.geoJSON(x, { style: CAD_ST.n[1], interactive: false }).addTo(shpCadGrp); }) });
        });
        var g = function (k, v) { return '<span>' + k + '</span><b>' + v + '</b>'; };
        var rows = its.map(function (it, i) {
            var rt = it.rights.length ? it.rights.map(function (r) { return esc(r[0]) + ': ' + esc(r[1]); }).join('; ') : esc(it.own || '—');
            return '<tr class="pp-cadr" data-ci="' + i + '"><td>' + (i + 1) + '</td><td><b>' + esc(it.num || '—') + '</b></td><td class="pp-cadchev"><i class="fas fa-chevron-down"></i></td></tr>' +
                '<tr class="pp-cadd" data-cd="' + i + '" hidden><td colspan="3"><div class="pp-cadg">' + g('Пересечение', nf(it.ia, 0) + ' м² (' + nf(it.ia / 1e4, 3) + ' га) · ' + nf(it.ia / d.tot * 100, 1) + ' % контура') +
                g('Площадь по ЕГРН', it.area ? nf(it.area, 0) + ' м² · пересечено ' + nf(Math.min(100, it.ia / it.area * 100), 1) + ' %' : '—') + g('Вид использования', esc(it.use || '—')) + g('Категория земель', esc(it.cat || '—')) + g('Права', rt) + '</div></td></tr>';
        }).join('');
        var cap = 'Источник — слой «Земельные участки из ЕГРН» НСПД (Росреестр). «Права» — форма собственности и иные сведения о правах, которые отдаёт публичная карта (правообладатели не раскрываются). Опрошено ' + d.req + ' точек' + (d.step ? ' (шаг ≈ ' + d.step + ' м)' : '') + (d.bad ? ', без ответа — ' + d.bad : '') + '; участки уже шага сетки могут быть пропущены. На карте участки показаны оранжевым, пересечения с контуром — красным; нажмите на номер, чтобы выделить участок и раскрыть сведения о нём. В Excel выгружается полная таблица.';
        var bt = '<details class="pp-cadmenu pp-expm"><summary class="pp-btn pp-vcopy" title="Экспорт участков"><i class="fas fa-download"></i> Экспорт <i class="fas fa-chevron-down"></i></summary><div class="pp-cadmenu-l">' + [['xlsx', 'file-excel', 'Excel', 'Таблица пересечений в Excel'], ['kml', 'file-export', 'KML', 'Границы участков целиком с атрибутами — KML'], ['geojson', 'file-export', 'GeoJSON', 'Границы участков целиком с атрибутами — GeoJSON'], ['shp', 'file-export', 'SHP', 'Границы участков целиком с атрибутами — Shapefile (ZIP)'], ['dxf', 'file-export', 'DXF', 'Границы участков целиком — DXF (AutoCAD, UTM)']].map(function (x) { return '<button type="button" class="pp-btn" data-cadx="' + x[0] + '" title="' + x[3] + '"><i class="fas fa-' + x[1] + '"></i> ' + x[2] + '</button>'; }).join('') + '</div></details>';
        var ct = document.getElementById('ppShpCadT');
        if (ct) ct.innerHTML = tiles([['Участков пересекает контур', nf(its.length, 0), '', CC.gen], ['Покрыто кадастром', nf(pc, 1) + ' %', nf(d.cover / 1e4, 2) + ' га', '#f59e0b'], ['Вне кадастровых границ', nf(100 - pc, 1) + ' %', nf(Math.max(0, d.tot - d.cover) / 1e4, 2) + ' га', '#64748b']]).replace(/^<div class="pp-tiles">|<\/div>$/g, '');
        el.innerHTML = '<div class="pp-ch"><h5>Пересечения с кадастровыми участками</h5>' +
            (its.length ? '<div class="pp-cadtbl">' + chart('Список участков ' + bt, '<div class="pp-vt"><table><thead><tr><th>№</th><th>Кадастровый номер</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>', cap) + '</div>' + cadDia(its, d.tot, 'col') : '<div class="pp-note">Кадастровых участков в пределах контура не найдено (опрошено ' + d.req + ' точек). ' + esc(cap) + '</div>') + '</div>';
        Array.prototype.forEach.call(el.querySelectorAll('[data-cadx]'), function (b) {
            b.onclick = function (ev) {
                ev.stopPropagation();
                var f = b.getAttribute('data-cadx');
                var mn = b.closest('details'); if (mn) mn.removeAttribute('open');
                if (f === 'xlsx') shpCadXlsx();
                else if (window.gcCadExport) window.gcCadExport(f, d.items);
                else updateStatus('⚠️ Экспорт недоступен: не загружен модуль кадастра (ux-extras.js)', true);
            };
        });
        Array.prototype.forEach.call(el.querySelectorAll('tr[data-ci]'), function (tr) { tr.onclick = function () { shpCadSel(+tr.getAttribute('data-ci')); }; });
    }
    // ---- пересечения с ООПТ (слой «ООПТ» НСПД): тот же опрос, что для кадастра, но по слою особо охраняемых природных территорий ----
    var OOPT_ST = { n: [{ color: '#16a34a', weight: 1.8, fillColor: '#16a34a', fillOpacity: 0.1 }, { color: '#dc2626', weight: 1, fillColor: '#dc2626', fillOpacity: 0.45 }] };
    function shpOoptSel(i) {
        var d = shp.oopt, el = document.getElementById('ppShpOopt'); if (!d) return;
        d.sel = d.sel === i ? -1 : i;
        if (el) Array.prototype.forEach.call(el.querySelectorAll('tr[data-oi],tr[data-od]'), function (tr) { var dc = tr.hasAttribute('data-od'), on = +tr.getAttribute(dc ? 'data-od' : 'data-oi') === d.sel; tr.classList.toggle('pp-cadsel', on); if (dc) tr.hidden = !on; });
        (d.lay || []).forEach(function (l, k) {
            var on = k === d.sel, c = on ? CAD_ST.s : OOPT_ST.n;
            l.base.setStyle(c[0]); l.parts.forEach(function (x) { x.setStyle(c[1]); });
            if (on) { l.base.bringToFront(); l.parts.forEach(function (x) { x.bringToFront(); }); }
        });
        if (d.sel >= 0) { try { map.fitBounds(d.lay[d.sel].base.getBounds().pad(0.3)); } catch (e) { /* без перехода */ } }
    }
    function shpOoptShow() {
        var d = shp.oopt, el = document.getElementById('ppShpOopt'); if (!el || !d) return;
        var its = d.items, pc = Math.min(100, d.cover / d.tot * 100); d.sel = -1; d.lay = [];
        shpOoptGrp.clearLayers();
        its.forEach(function (it) {
            d.lay.push({ base: L.geoJSON({ type: 'Feature', geometry: it.geometry, properties: {} }, { style: OOPT_ST.n[0], interactive: false }).addTo(shpOoptGrp), parts: it.parts.map(function (x) { return L.geoJSON(x, { style: OOPT_ST.n[1], interactive: false }).addTo(shpOoptGrp); }) });
        });
        var g = function (k, v) { return '<span>' + k + '</span><b>' + v + '</b>'; };
        var rows = its.map(function (it, i) {
            var nm = it.name || it.num || 'ООПТ без названия';
            return '<tr class="pp-cadr" data-oi="' + i + '"><td>' + (i + 1) + '</td><td><b>' + esc(nm) + '</b></td><td class="pp-cadchev"><i class="fas fa-chevron-down"></i></td></tr>' +
                '<tr class="pp-cadd" data-od="' + i + '" hidden><td colspan="3"><div class="pp-cadg">' + g('Пересечение', nf(it.ia, 0) + ' м² (' + nf(it.ia / 1e4, 3) + ' га) · ' + nf(it.ia / d.tot * 100, 1) + ' % контура') +
                g('Вид территории', esc(it.zone || it.kind || '—')) + g('Статус', esc(it.stat || '—')) + (it.num ? g('Номер', esc(it.num)) : '') + '</div></td></tr>';
        }).join('');
        var cap = 'Источник — слой «ООПТ» НСПД (Росреестр). Показаны особо охраняемые природные территории, границы которых пересекают контур; охранные зоны и неучтённые в публичной карте региональные и местные ООПТ могут отсутствовать, поэтому для юридически значимых выводов запрашивайте сведения у уполномоченных органов. Опрошено ' + d.req + ' точек' + (d.step ? ' (шаг ≈ ' + d.step + ' м)' : '') + (d.bad ? ', без ответа — ' + d.bad : '') + '. На карте ООПТ показаны зелёным, пересечения с контуром — красным; нажмите на название, чтобы выделить территорию и раскрыть сведения о ней.';
        var bt = '<details class="pp-cadmenu pp-expm"><summary class="pp-btn pp-vcopy" title="Экспорт ООПТ"><i class="fas fa-download"></i> Экспорт <i class="fas fa-chevron-down"></i></summary><div class="pp-cadmenu-l">' + [['kml', 'KML'], ['geojson', 'GeoJSON'], ['shp', 'SHP'], ['dxf', 'DXF']].map(function (x) { return '<button type="button" class="pp-btn" data-ooptx="' + x[0] + '" title="Границы ООПТ целиком — ' + x[1] + '"><i class="fas fa-file-export"></i> ' + x[1] + '</button>'; }).join('') + '</div></details>';
        el.innerHTML = '<div class="pp-ch"><h5>Пересечения с ООПТ</h5>' +
            (its.length ? tiles([['ООПТ пересекает контур', nf(its.length, 0), '', '#16a34a'], ['Покрыто ООПТ', nf(pc, 1) + ' %', nf(d.cover / 1e4, 2) + ' га', '#dc2626']]) + '<div class="pp-cadtbl">' + chart('Список ООПТ ' + bt, '<div class="pp-vt"><table><thead><tr><th>№</th><th>Название</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>', cap) + '</div>' : '<div class="pp-note"><i class="fas fa-circle-check"></i> Пересечений с ООПТ не найдено (опрошено ' + d.req + ' точек). ' + esc(cap) + '</div>') + '</div>';
        Array.prototype.forEach.call(el.querySelectorAll('[data-ooptx]'), function (b) {
            b.onclick = function (ev) {
                ev.stopPropagation();
                var mn = b.closest('details'); if (mn) mn.removeAttribute('open');
                if (window.gcCadExport) window.gcCadExport(b.getAttribute('data-ooptx'), d.items, 'p');
                else updateStatus('⚠️ Экспорт недоступен: не загружен модуль кадастра (ux-extras.js)', true);
            };
        });
        Array.prototype.forEach.call(el.querySelectorAll('tr[data-oi]'), function (tr) { tr.onclick = function () { shpOoptSel(+tr.getAttribute('data-oi')); }; });
    }
    function shpOoptRun(gj, tok) {
        var alive = function () { return tok === shpSeq; }, box = function () { return alive() && document.getElementById('ppShpOopt'); };
        if (!alive()) return;
        var e0 = box(); if (e0) e0.innerHTML = cadBar('Опрос слоя ООПТ НСПД', 0, 0);
        cadCalc(gj, alive, function (n, t) { var e = box(); if (e) e.innerHTML = cadBar('Опрос слоя ООПТ НСПД', n, t); if (alive()) shpLoad(gj, 'Запрос к слою ООПТ НСПД…', t ? Math.min(100, Math.round(n / t * 100)) : null); }, 'p').then(function (x) {
            if (alive()) shpLoadOff();
            if (!x || !alive()) return;
            shp.oopt = x; shpOoptShow();
        }).catch(function (e) { if (alive()) shpLoadOff(); var el = box(); if (el) el.innerHTML = '<div class="pp-note">Не удалось получить данные об ООПТ: ' + esc(e && e.message || e) + '</div>'; });
    }
    function shpCadRun(gj, tok) {
        var alive = function () { return tok === shpSeq; }, box = function () { return alive() && document.getElementById('ppShpCad'); };
        shpLoad(gj, 'Запрос к слою НСПД…');
        setTimeout(function () {   // небольшая пауза: при перетаскивании вершин не опрашиваем НСПД на каждом шаге
            if (!alive()) return;
            cadCalc(gj, alive, function (n, t) { var e = box(); if (e) e.innerHTML = cadBar('Опрос слоя кадастра НСПД', n, t); if (alive()) shpLoad(gj, 'Запрос к слою НСПД…', t ? Math.min(100, Math.round(n / t * 100)) : null); }).then(function (x) {
                if (!x || !alive()) return;
                shp.cadx = x; shpCadShow(); shpOoptRun(gj, tok);
            }).catch(function (e) { var el = box(); if (el) el.innerHTML = '<div class="pp-note">Не удалось получить кадастровые участки: ' + esc(e && e.message || e) + '</div>'; shpOoptRun(gj, tok); });
        }, 700);
    }
    if (dp) {
        dp.addEventListener('click', function (e) {
            var t = e.target.closest('[data-shp-tool]'), ac = e.target.closest('[data-shp-act]');
            if (t) { shpTool(t.dataset.shpTool); return; }
            if (ac) {
                var act = ac.dataset.shpAct;
                if (act === 'del') shpDel();
                else if (act === 'edit') { if (shp.shape) shpEdit(!shp.editing); }
                else if (act === 'sel') {
                    var g = typeof gcSel !== 'undefined' && gcSel instanceof L.Path ? toGJ(gcSel) : null;
                    if (!g) { updateStatus('ℹ️ Выберите на карте полигон, прямоугольник или круг (клик по фигуре)', true); return; }
                    shpCancel(); shpSet(L.geoJSON(g, { style: SHP_ST }).getLayers()[0]);
                }
                return;
            }
            var b = e.target.closest('[data-shp-copy]'); if (!b || !shpTxt) return; copyText(b, shpTxt);
        });
        document.addEventListener('click', function (e) {
            Array.prototype.forEach.call(document.querySelectorAll('.pp-cadmenu[open]'), function (m) { if (!m.contains(e.target)) m.removeAttribute('open'); });
            var t = e.target.closest && e.target.closest('.bp-tab, .panel-tab');
            if (t && !(t.classList.contains('bp-tab') && t.dataset.bpTab === 'shape')) shpCancel();
        });
    }
    shpInit();

    // ---------- 4. почвенный анализ: карта и диаграммы по каждому показателю ----------
    var SOILS = ['phh2o', 'soc', 'nitrogen', 'cec', 'clay', 'sand', 'silt', 'bdod'];
    var SC = {   // агрономические классы: [верхняя граница, название, цвет, комментарий]; r — диапазон шкалы
        phh2o: { r: [3.5, 9.5], c: [[5, 'Сильнокислая', '#ef4444', 'нужно известкование'], [5.5, 'Кислая', '#f97316', 'известкование желательно'], [6.5, 'Слабокислая', '#facc15', 'допустима для большинства культур'], [7.5, 'Нейтральная', '#22c55e', 'оптимум для большинства культур'], [8.5, 'Щелочная', '#38bdf8', 'возможен дефицит Fe, Zn, P'], [99, 'Сильнощелочная', '#6366f1', 'нужна мелиорация']] },
        soc: { r: [0, 60], c: [[10, 'Низкое', '#ef4444', 'мало органики'], [20, 'Среднее', '#facc15', ''], [35, 'Повышенное', '#84cc16', 'хорошая гумусированность'], [9999, 'Высокое', '#15803d', 'уровень чернозёмов']] },
        nitrogen: { r: [0, 6], c: [[1, 'Низкий', '#ef4444', 'нужны азотные удобрения'], [2, 'Средний', '#facc15', ''], [3.5, 'Повышенный', '#84cc16', ''], [99, 'Высокий', '#15803d', 'большой запас азота']] },
        cec: { r: [0, 50], c: [[10, 'Низкая', '#ef4444', 'слабо удерживает питание'], [20, 'Средняя', '#facc15', ''], [30, 'Высокая', '#84cc16', 'хорошая буферность'], [999, 'Очень высокая', '#15803d', 'гумусные и глинистые почвы']] },
        clay: { r: [0, 60], c: [[10, 'Мало', '#fde68a', 'лёгкая почва'], [25, 'Умеренно', '#fbbf24', 'средняя почва'], [40, 'Много', '#d97706', 'тяжёлая почва'], [999, 'Очень много', '#92400e', 'склонна к заплыванию']] },
        sand: { r: [0, 100], c: [[20, 'Мало', '#bae6fd', 'почва связная'], [50, 'Умеренно', '#7dd3fc', ''], [70, 'Много', '#0ea5e9', 'быстро сохнет'], [999, 'Преобладает', '#0369a1', 'вымывание, низкая влагоёмкость']] },
        silt: { r: [0, 100], c: [[20, 'Мало', '#e9d5ff', ''], [40, 'Умеренно', '#c084fc', ''], [60, 'Много', '#9333ea', 'склонна к заплыванию'], [999, 'Преобладает', '#6b21a8', 'высокий риск эрозии']] },
        bdod: { r: [0.8, 1.8], c: [[1.1, 'Рыхлая', '#38bdf8', 'хорошая аэрация'], [1.4, 'Оптимальная', '#22c55e', ''], [1.6, 'Уплотнённая', '#f97316', 'затруднён рост корней'], [999, 'Сильно уплотнена', '#dc2626', 'нужно рыхление']] }
    };
    var SI = {   // что это / зачем / особенность расчёта
        phh2o: ['Активная кислотность почвенного раствора (pH в воде).', 'Определяет доступность элементов питания и необходимость известкования; для большинства культур оптимум pH 6–7,5.', 'pH = −lg[H⁺]; в SoilGrids хранится как pH × 10, значения пересчитаны (÷ 10).'],
        soc: ['Содержание органического углерода — основа гумуса почвы.', 'Главный показатель плодородия: влияет на структуру, влагоёмкость и обеспеченность элементами питания. Гумус ≈ C × 1,724.', 'В SoilGrids хранится в дг/кг, пересчитано в г/кг (÷ 10).'],
        nitrogen: ['Общий азот, связанный в органическом веществе почвы.', 'Показывает потенциал азотного питания и помогает рассчитывать дозы удобрений; вместе с углеродом даёт отношение C:N.', 'В SoilGrids хранится в сг/кг, пересчитано в г/кг (÷ 100).'],
        cec: ['Ёмкость катионного обмена — сколько Ca, Mg, K и NH₄ почва способна удерживать.', 'Высокая ёмкость — почва буферна и слабо теряет удобрения; низкая — удобрения лучше вносить дробно.', 'В SoilGrids хранится в ммоль(+)/кг, пересчитано в смоль(+)/кг (÷ 10).'],
        clay: ['Доля тончайших частиц (менее 2 мкм) в мелкоземе.', 'Определяет влагоёмкость, структуру и трудность обработки: чем больше глины, тем тяжелее почва и позже она «спеет» весной.', 'В SoilGrids хранится в г/кг, пересчитано в % (÷ 10).'],
        sand: ['Доля песчаных частиц (0,05–2 мм).', 'Отвечает за водопроницаемость и прогреваемость; при избытке песка почва быстро иссушается и теряет питание.', 'В SoilGrids хранится в г/кг, пересчитано в % (÷ 10).'],
        silt: ['Доля пылеватых частиц (2–50 мкм).', 'Даёт капиллярную влагоёмкость; пылеватые почвы склонны к заплыванию, коркообразованию и эрозии.', 'В SoilGrids хранится в г/кг, пересчитано в % (÷ 10).'],
        bdod: ['Плотность сложения — масса сухой почвы в единице объёма.', 'Индикатор уплотнения почвы и условий для корней; нужна для расчёта запасов углерода и питательных веществ.', 'В SoilGrids хранится в сг/см³, пересчитано в г/см³ (÷ 100).']
    };
    var SHOW = 'Источник — ISRIC SoilGrids 250 м (модель машинного обучения по десяткам тысяч почвенных профилей и спутниковым данным), глубина 0–5 см. Берутся ячейки 250 м, центры которых лежат внутри контура; мин/среднее/макс/σ — по этим ячейкам; доля класса (га) = доля ячеек × площадь участка. ';
    function soilSec() {
        return sec(4, 'flask', 'Почвенный анализ', 'ISRIC SoilGrids 250 м · глубина 0–5 см · карта, шкала, гистограмма и классы по каждому показателю', CC.soil,
            blk({
                t: 'Сводные расчётные показатели', i: 'wand-magic-sparkles', id: 'ppSoilSum', body: SPIN,
                info: ['Показатели, которые считаются из нескольких слоёв почвы сразу: гумус, механический состав (тип почвы), запас углерода, отношение C:N.',
                    'Переводят «сырые» слои в понятные агроному величины: гумусированность, тип почвы по составу (лёгкая, средняя, тяжёлая), углеродный запас (важен для углеродных проектов) и скорость разложения органики.',
                    'Гумус ≈ C орг × 1,724; C:N = C орг / N общий; запас C, т/га = C (г/кг) × плотность (г/см³) × мощность слоя (см) / 10 для слоя 0–5 см; класс текстуры — по треугольнику USDA из средних долей песка, пыли и глины.']
            }) +
            SOILS.map(function (p) {
                var P = ppSoil.props[p], I = SI[p];
                return blk({ t: P.n + ', ' + P.u, i: 'vial', id: 'ppSB_' + p, body: SPIN, info: [I[0], I[1], SHOW + I[2]],
                    map: mapBox('soil_' + p, '<button type="button" class="pp-btn" data-soil-tif="' + p + '" disabled><i class="fas fa-download"></i> GeoTIFF</button>') });
            }).join(''));
    }
    async function soilRun(gj, tok) {
        var bb = turf.bbox(gj), cen = turf.centroid(gj).geometry.coordinates, S0 = D.soil = { cov: {}, bb: bb, vals: {}, S: {}, err: '' };
        if ((bb[2] - bb[0]) > 1.5 || (bb[3] - bb[1]) > 1.5) S0.err = 'участок слишком большой для почвенного анализа';
        else await Promise.all(SOILS.map(function (p) { return ppSoil.cov(p, '0-5cm', bb).then(function (c) { S0.cov[p] = c; }).catch(function (e) { S0.err = e.message; }); }));
        if (tok !== seq) return;
        SOILS.forEach(function (p) { soilOne(p, gj, S0, cen); }); soilSum(S0);
    }
    function soilOne(p, gj, S0, cen) {
        var box = document.getElementById('ppSB_' + p), c = S0.cov[p], P = ppSoil.props[p], bb = S0.bb; if (!box) return;
        if (!c) { box.innerHTML = '<div class="pp-note">Данные SoilGrids недоступны' + (S0.err ? ': ' + esc(S0.err) : '') + '</div>'; return; }
        var dx = (c.x1 - c.x0) / c.W, dy = (c.y1 - c.y0) / c.H, a = [], polys = polysOf(gj), x, y;
        for (y = Math.max(0, Math.floor((c.y1 - bb[3]) / dy)); y < Math.min(c.H, Math.ceil((c.y1 - bb[1]) / dy)); y++)
            for (x = Math.max(0, Math.floor((bb[0] - c.x0) / dx)); x < Math.min(c.W, Math.ceil((bb[2] - c.x0) / dx)); x++) {
                var v = c.v[y * c.W + x]; if (v !== v) continue;
                if (inPolys(c.x0 + (x + 0.5) * dx, c.y1 - (y + 0.5) * dy, polys)) a.push(v);
            }
        if (!a.length) { var cx = Math.floor((cen[0] - c.x0) / dx), cy = Math.floor((c.y1 - cen[1]) / dy), v0 = c.v[cy * c.W + cx]; if (v0 === v0) a.push(v0); }
        if (!a.length) { box.innerHTML = '<div class="pp-note">В этой области нет данных SoilGrids (вода, город или застройка).</div>'; return; }
        var s = 0, i; for (i = 0; i < a.length; i++) s += a[i];
        var m = s / a.length, q = 0; for (i = 0; i < a.length; i++) q += (a[i] - m) * (a[i] - m);
        var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), sd = Math.sqrt(q / a.length), sp = (mx - mn) || 1, nb = 14, hh = new Array(nb).fill(0), th = [0, 0, 0];
        a.forEach(function (x2) { hh[Math.min(nb - 1, Math.floor((x2 - mn) / sp * nb))]++; th[Math.min(2, Math.floor((x2 - mn) / sp * 3))]++; });
        S0.vals[p] = a; S0.S[p] = { mean: m, min: mn, max: mx, sd: sd, n: a.length };
        var pal = ppSoil.pal[p] || ppSoil.pal.def, f = function (v) { return nf(v, P.d); }, lo = pal.rng ? pal.rng[0] : mn, hi = pal.rng ? pal.rng[1] : mx, sc = SC[p], cc = sc.c.map(function () { return 0; }), ar = D.area / 1e4;
        if (!(hi - lo > 1e-9)) { lo -= 0.5; hi += 0.5; }
        var sa = a.slice().sort(function (u, v) { return u - v; }), qf = function (z) { return sa[Math.min(sa.length - 1, Math.floor(z * (sa.length - 1)))]; }, med = qf(0.5);
        var clOf = function (v) { for (var k = 0; k < sc.c.length; k++) if (v <= sc.c[k][0] || k === sc.c.length - 1) return k; return 0; };
        a.forEach(function (v) { cc[clOf(v)]++; });
        var km = sc.c[clOf(m)], colFn = function (z) { return ppSoil.palCol(pal.c, (mn + sp * z - lo) / (hi - lo)); };
        box.innerHTML = tiles([['Среднее', f(m), P.u, km[2]], ['Медиана', f(med)], ['Минимум', f(mn)], ['Максимум', f(mx)], ['Разброс σ', f(sd)], ['Ячеек 250 м', a.length]]) +
            chart('Где участок на агрономической шкале', meter(sc.c.map(function (k) { return [k[0], k[2]]; }), m, sc.r[0], sc.r[1], P.d), '<b style="color:' + km[2] + '">' + km[1] + '</b>' + (km[3] ? ' — ' + km[3] : '') + '. Чёрный маркер — среднее по участку.') +
            '<div class="pp-chs">' + chart('Гистограмма значений', hist2(hh, colFn, mn, mx, P.d, P.u, [{ v: m, c: '#0f172a', l: 'среднее' }, { v: med, c: '#dc2626', l: 'медиана' }]), 'Цвет столбцов — как на карте слева. Узкий пик — однородный участок, широкий — неоднородный (зоны требуют разной агротехники).') +
            chart('Классы по агрономической шкале', clsRows(sc.c.map(function (k, q2) { return { l: k[1], c: k[2], v: cc[q2] / a.length, t: nf(cc[q2] / a.length * ar, 2) + ' га', s: k[3] }; })), 'Площадь класса = доля ячеек SoilGrids × площадь участка.') + '</div>';
        soilShow(p, gj, c, bb, a, pal);
        var btn = body.querySelector('[data-soil-tif="' + p + '"]'); if (btn) btn.disabled = false;
    }
    function soilSum(S0) {
        var box = document.getElementById('ppSoilSum'); if (!box) return;
        var S = S0.S, g = function (p) { return S[p] ? S[p].mean : null; }, soc = g('soc'), nn = g('nitrogen'), bd = g('bdod'), sa = g('sand'), si = g('silt'), cl = g('clay'), ar = D.area / 1e4, t = [], out = '';
        if (!Object.keys(S).length) { box.innerHTML = '<div class="pp-note">Данные SoilGrids недоступны для этого участка.</div>'; return; }
        if (soc != null) {
            var hum = soc * 0.1724, hc = hum < 2 ? ['очень низкое', '#ef4444'] : hum < 4 ? ['низкое', '#f97316'] : hum < 6 ? ['среднее', '#facc15'] : hum < 9 ? ['повышенное', '#84cc16'] : ['высокое', '#15803d'];
            D.hum = hum; t.push(['Гумус (оценка)', nf(hum, 1) + ' %', hc[0], hc[1]]);
            if (nn) { var cn = soc / nn, cc2 = cn < 10 ? ['быстрая минерализация', '#f97316'] : cn <= 15 ? ['оптимально', '#22c55e'] : ['медленное разложение', '#facc15']; t.push(['Отношение C:N', nf(cn, 1), cc2[0], cc2[1]]); }
            if (bd != null) { var stk = soc * bd * 5 / 10; t.push(['Запас C, слой 0–5 см', nf(stk, 1) + ' т/га', 'всего ≈ ' + nf(stk * ar, 0) + ' т', '#0d9488']); }
        }
        if (bd != null) t.push(['Плотность сложения', nf(bd, 2) + ' г/см³', '', '#64748b']);
        out += tiles(t);
        if (sa != null && si != null && cl != null) {
            var sm = (sa + si + cl) || 1, a1 = sa / sm * 100, b1 = si / sm * 100, c1 = cl / sm * 100, tx = usda(a1, b1, c1);
            D.tex = tx;
            out += chart('Механический состав (средний по участку)', '<div class="pp-stk"><i style="--c:#f59e0b;width:' + a1.toFixed(1) + '%">' + (a1 > 8 ? 'песок ' + nf(a1, 0) + '%' : '') + '</i><i style="--c:#a78bfa;width:' + b1.toFixed(1) + '%">' + (b1 > 8 ? 'пыль ' + nf(b1, 0) + '%' : '') + '</i><i style="--c:#b45309;width:' + c1.toFixed(1) + '%">' + (c1 > 8 ? 'глина ' + nf(c1, 0) + '%' : '') + '</i></div>',
                '<b>Класс по USDA: ' + tx + '.</b> ' + (c1 < 15 ? 'Лёгкая почва: быстро прогревается и просыхает, слабо удерживает влагу и питание.' : c1 < 35 ? 'Средняя почва: наиболее удачное сочетание воздуха, влаги и питательных веществ.' : 'Тяжёлая почва: влагоёмкая, холодная и плотная, поздно созревает физически.'));
        }
        box.innerHTML = out || '<div class="pp-note">Для расчёта сводных показателей не хватает слоёв SoilGrids.</div>';
    }
    function soilShow(p, gj, c, bb, a, pal) {
        var o = minis['soil_' + p], P = ppSoil.props[p]; if (!o) return;
        var dx = (c.x1 - c.x0) / c.W, dy = (c.y1 - c.y0) / c.H, ix0 = Math.max(0, Math.floor((bb[0] - c.x0) / dx)), ix1 = Math.min(c.W, Math.ceil((bb[2] - c.x0) / dx)), iy0 = Math.max(0, Math.floor((c.y1 - bb[3]) / dy)), iy1 = Math.min(c.H, Math.ceil((c.y1 - bb[1]) / dy)), w = ix1 - ix0, h = iy1 - iy0;
        if (w <= 0 || h <= 0) return;
        var lo = pal.rng ? pal.rng[0] : Math.min.apply(null, a), hi = pal.rng ? pal.rng[1] : Math.max.apply(null, a); if (!(hi - lo > 1e-9)) { lo -= 0.5; hi += 0.5; }
        var S = Math.max(1, Math.min(64, Math.floor(1200 / Math.max(w, h)))), cv = document.createElement('canvas'); cv.width = w * S; cv.height = h * S; var g = cv.getContext('2d');
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var v = c.v[(iy0 + y) * c.W + ix0 + x]; if (v !== v) continue; g.fillStyle = ppSoil.palCol(pal.c, (v - lo) / (hi - lo)); g.fillRect(x * S, y * S, S, S); }
        g.globalCompositeOperation = 'destination-in'; g.beginPath(); var ox = c.x0 + ix0 * dx, oy = c.y1 - iy0 * dy;
        polysOf(gj).forEach(function (pl) { pl.forEach(function (ring) { ring.forEach(function (pt, i) { var px = (pt[0] - ox) / dx * S, py = (oy - pt[1]) / dy * S; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); }); }); g.fillStyle = '#000'; g.fill('evenodd');
        addImg('soil_' + p, cv.toDataURL('image/png'), [[c.y1 - iy1 * dy, ox], [oy, c.x0 + ix1 * dx]], 0.9);
        o.title = 'Почва: ' + P.n + ' (0–5 см)'; setLeg('soil_' + p, pal.c, nf(lo, P.d), nf(hi, P.d), P.u);
    }

    // ---------- 5. рельеф: высоты, уклоны, экспозиция, 3D ----------
    function elevSec() {
        return sec(5, 'mountain', 'Рельеф: высоты, уклоны и экспозиция', 'Цифровая модель рельефа: перепады, склоны, стекание воды, 3D', CC.rel,
            blk({
                t: 'Высоты над уровнем моря', i: 'mountain', id: 'ppElBody', body: SPIN, map: mapBox('elh', '<button type="button" class="pp-btn" data-tif="elh" disabled><i class="fas fa-download"></i> GeoTIFF</button>', 'Высоты — тепловая карта'),
                info: ['Абсолютные высоты поверхности над уровнем моря в пределах участка.', 'Показывают общий характер рельефа, направление стока воды, возможные западины и риск застоя воды и подтопления. Гипсометрическая кривая показывает, какая доля площади лежит выше или ниже заданной отметки.',
                    'Цифровая модель рельефа (плитки Terrarium / AWS, разрешение порядка 30 м). По ячейкам внутри контура считаются минимум, среднее, максимум, медиана и перцентили; гистограмма — доли площади в 16 равных интервалах высот; гипсометрическая кривая — отметка высоты в зависимости от доли площади выше неё.']
            }) +
            blk({
                t: 'Уклоны (крутизна склонов)', i: 'angle-right', id: 'ppElB2', body: SPIN, map: mapBox('els', '<button type="button" class="pp-btn" data-tif="els" disabled><i class="fas fa-download"></i> GeoTIFF</button>', 'Уклоны — тепловая карта'),
                info: ['Крутизна склона — угол наклона поверхности в градусах.', 'Определяет выбор техники и севооборота, опасность водной эрозии, требования к дренажу и дорогам. На уклонах больше 5° начинается риск смыва почвы, больше 10–15° — ограничения для техники.',
                    'Для каждой ячейки по центральным разностям высот соседних ячеек: уклон = arctan(√((dz/dx)² + (dz/dy)²)). Классы: < 2°, 2–5°, 5–10°, 10–15°, > 15°; площадь класса (га) = доля ячеек класса × площадь участка.']
            }) +
            blk({
                t: 'Экспозиция склонов', i: 'compass', id: 'ppElB3', body: SPIN,
                map: '<div class="pp-mapw"><div class="pp-mt">Роза экспозиций</div><div id="ppRose" class="pp-rosew"><div class="pp-note">Считаем…</div></div></div>',
                info: ['Экспозиция — азимут, в сторону которого «смотрит» склон.', 'Южные склоны получают больше тепла, раньше прогреваются и быстрее сохнут; северные дольше хранят влагу и снег. Влияет на сроки сева, выбор культур, снегозадержание и ветровой режим.',
                    'Направление спуска по горизонтали: atan2 по градиенту высот, округление до 8 румбов; учитываются ячейки с уклоном ≥ 1° (более плоские считаются безэкспозиционными). Длина лепестка розы пропорциональна доле площади.']
            }));
    }
    async function elevRun(gj, tok) {
        var r = await ppDem.grid(gj, function () { return tok === seq; }), el = document.getElementById('ppElBody');
        if (tok !== seq) return;
        if (!r) { ['ppElBody', 'ppElB2', 'ppElB3', 'ppRose'].forEach(function (id) { var x = document.getElementById(id); if (x) x.innerHTML = '<div class="pp-note">Данные рельефа для участка недоступны.</div>'; }); return; }
        var grid = r[0], rows = r[1], cols = r[2], bw = r[3], bn = r[4], dLat = r[5], dLng = r[6], mn = r[7], mx = r[8], step = dLat * 111320, sum = 0, n = 0, i, j;
        for (i = 0; i < grid.length; i++) if (grid[i] === grid[i]) { sum += grid[i]; n++; }
        var sl = new Float32Array(rows * cols).fill(NaN), ss = 0, sn = 0, smax = 0, cl = [0, 0, 0, 0, 0], asp = new Array(8).fill(0), D8 = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'], BR = [2, 5, 10, 15];
        for (j = 1; j < rows - 1; j++) for (i = 1; i < cols - 1; i++) {
            var k = j * cols + i, W = grid[k - 1], E = grid[k + 1], N = grid[k - cols], Sx = grid[k + cols];
            if (grid[k] !== grid[k] || W !== W || E !== E || N !== N || Sx !== Sx) continue;
            var dzx = (E - W) / (2 * step), dzy = (N - Sx) / (2 * step), d = Math.atan(Math.hypot(dzx, dzy)) * 180 / Math.PI;
            sl[k] = d; ss += d; sn++; if (d > smax) smax = d; var b = 0; while (b < 4 && d >= BR[b]) b++; cl[b]++;
            if (d >= 1) asp[Math.round(((Math.atan2(-dzx, -dzy) * 180 / Math.PI + 360) % 360) / 45) % 8]++;
        }
        var mean = sum / n, ms = sn ? ss / sn : null, ai = asp.indexOf(Math.max.apply(null, asp)), CL = [['< 2° (плоско)', '#16a34a'], ['2–5°', '#84cc16'], ['5–10°', '#facc15'], ['10–15°', '#f97316'], ['> 15° (круто)', '#dc2626']];
        D.elev = { mn: mn, mx: mx, mean: mean, ms: ms, steep: sn ? cl[4] / sn : null, asp: Math.max.apply(null, asp) > 0 ? D8[ai] : null };
        var hcol = function (t) { var c = ppDem.col(t); return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; };
        var ar = D.area / 1e4, sv = [], sv2 = [], nb = 16, hh = new Array(nb).fill(0), sp = (mx - mn) || 1, hs = new Array(15).fill(0), den = sn || 1;
        for (i = 0; i < grid.length; i++) if (grid[i] === grid[i]) sv.push(grid[i]);
        for (i = 0; i < sl.length; i++) if (sl[i] === sl[i]) sv2.push(sl[i]);
        sv.sort(function (u, v) { return u - v; }); sv2.sort(function (u, v) { return u - v; });
        var qe = function (z) { return sv[Math.min(sv.length - 1, Math.floor(z * (sv.length - 1)))]; }, qs = function (z) { return sv2.length ? sv2[Math.min(sv2.length - 1, Math.floor(z * (sv2.length - 1)))] : null; };
        sv.forEach(function (v) { hh[Math.min(nb - 1, Math.floor((v - mn) / sp * nb))]++; });
        sv2.forEach(function (v) { hs[Math.min(14, Math.floor(v))]++; });
        var scol = ['#16a34a', '#84cc16', '#facc15', '#f97316', '#dc2626'], slCol = function (z) { var t = Math.min(1, z) * 4, q3 = Math.min(3, Math.floor(t)), fr = t - q3, A = parseInt(scol[q3].substr(1), 16), B2 = parseInt(scol[q3 + 1].substr(1), 16), ch = function (sh) { return Math.round(((A >> sh) & 255) + (((B2 >> sh) & 255) - ((A >> sh) & 255)) * fr); }; return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')'; };
        el.innerHTML = tiles([['Минимум', nf(mn, 0) + ' м', '', '#3b82f6'], ['Средняя', nf(mean, 0) + ' м', '', '#10b981'], ['Максимум', nf(mx, 0) + ' м', '', '#dc2626'], ['Перепад высот', nf(mx - mn, 0) + ' м', mx - mn < 5 ? 'почти плоский' : mx - mn < 20 ? 'небольшой' : mx - mn < 60 ? 'заметный' : 'значительный', '#0d9488'], ['Медиана', nf(qe(0.5), 0) + ' м'], ['80 % площади в диапазоне', nf(qe(0.1), 0) + '–' + nf(qe(0.9), 0) + ' м']]) +
            '<div class="pp-chs">' + chart('Гистограмма высот', hist2(hh, hcol, mn, mx, 0, 'м', [{ v: mean, c: '#0f172a', l: 'среднее' }, { v: qe(0.5), c: '#dc2626', l: 'медиана' }]), 'Цвет столбцов — как на тепловой карте. Несколько пиков — на участке есть террасы или разные элементы рельефа.') +
            chart('Гипсометрическая кривая', hypso(sv, mn, mx, hcol), 'Крутой участок кривой — склон, пологий — ровная площадка. Резкий излом — уступ или терраса.') + '</div>';
        var bx2 = document.getElementById('ppElB2'), b3 = document.getElementById('ppElB3'), ro = document.getElementById('ppRose'), HINT = ['любая механизированная обработка', 'обработка без ограничений, следить за стоком', 'риск эрозии: контурная обработка, полосное земледелие', 'ограничения для техники; залужение, залесение', 'распашка не рекомендуется'];
        if (!sn) { var nt = '<div class="pp-note">Участок слишком мал для расчёта уклонов и экспозиции (меньше нескольких ячеек модели рельефа).</div>'; if (bx2) bx2.innerHTML = nt; if (b3) b3.innerHTML = nt; if (ro) ro.innerHTML = ''; }
        else {
            if (bx2) bx2.innerHTML = tiles([['Средний уклон', nf(ms, 1) + '°', '', slCol(ms / 15)], ['Медиана', nf(qs(0.5), 1) + '°'], ['90 % площади меньше', nf(qs(0.9), 1) + '°'], ['Максимальный', nf(smax, 1) + '°', '', '#dc2626'], ['Ровные < 2°', nf(cl[0] / den * 100, 0) + ' %', nf(cl[0] / den * ar, 1) + ' га', '#16a34a'], ['Круче 5°', nf((cl[2] + cl[3] + cl[4]) / den * 100, 0) + ' %', nf((cl[2] + cl[3] + cl[4]) / den * ar, 1) + ' га', '#f97316']]) +
                '<div class="pp-chs">' + chart('Гистограмма уклонов', hist2(hs, function (z) { return slCol(z); }, 0, 15, 0, '°', [{ v: ms, c: '#0f172a', l: 'средний' }]), 'Последний столбец включает все уклоны от 14° и круче. Цвет — как на карте уклонов.') +
                chart('Классы уклонов', '<div class="pp-dn">' + donut(CL.map(function (c, q4) { return { l: c[0], c: c[1], v: cl[q4] }; }), nf(ms, 1) + '°', 'средний') + clsRows(CL.map(function (c, q4) { return { l: c[0], c: c[1], v: cl[q4] / den, t: nf(cl[q4] / den * ar, 2) + ' га', s: HINT[q4] }; })) + '</div>', 'Площадь класса (га) = доля ячеек × площадь участка.') + '</div>';
            var at = asp.reduce(function (u, v) { return u + v; }, 0), AF = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'], AC = ['#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#6366f1'];
            if (ro) ro.innerHTML = rose(asp, D8, AC);
            if (b3) b3.innerHTML = !at ? '<div class="pp-note">Склоны слишком пологие (< 1°) — экспозиция не определяется: участок почти плоский.</div>' :
                tiles([['Преобладает', AF[ai], nf(asp[ai] / at * 100, 0) + ' % склонов', AC[ai]], ['Южные склоны (ЮВ–ЮЗ)', nf((asp[3] + asp[4] + asp[5]) / at * 100, 0) + ' %', 'тёплые, сухие', '#f97316'], ['Северные склоны (СЗ–СВ)', nf((asp[7] + asp[0] + asp[1]) / at * 100, 0) + ' %', 'прохладные, влажные', '#3b82f6'], ['Безэкспозиционные < 1°', nf((sn - at) / den * 100, 0) + ' %', '', '#94a3b8']]) +
                '<div class="pp-rl">' + D8.map(function (d, k) { return '<span style="--c:' + AC[k] + '">' + d + ' <b>' + nf(asp[k] / at * 100, 0) + '%</b></span>'; }).join('') + '</div>' + '<div class="pp-cap">Красно-оранжевые лепестки — склоны, обращённые на юг (больше солнца); сине-голубые — на север (дольше лежит снег, больше влаги).</div>';
        }
        var hc = [0, 0.2, 0.4, 0.6, 0.8, 1].map(function (t) { var c = ppDem.col(t); return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; });
        D.tifs = { elh: { a: grid, w: cols, h: rows, x0: bw, y1: bn, dx: dLng, dy: dLat, name: 'Relief_height_m.tif' }, els: { a: sl, w: cols, h: rows, x0: bw, y1: bn, dx: dLng, dy: dLat, name: 'Relief_slope_deg.tif' } };
        body.querySelectorAll('[data-tif]').forEach(function (x) { x.disabled = false; });
        var ov = ppDem.heat(r);
        if (minis.elh) { ov.addTo(minis.elh.map); minis.elh.title = 'Высоты, м'; setLeg('elh', hc, nf(mn, 0), nf(mx, 0), 'м'); }
        var cv = document.createElement('canvas'); cv.width = cols; cv.height = rows; var g = cv.getContext('2d'), im = g.createImageData(cols, rows), sc = ['#16a34a', '#84cc16', '#facc15', '#f97316', '#dc2626'];
        for (i = 0; i < sl.length; i++) if (sl[i] === sl[i]) { var t = Math.min(1, sl[i] / 15) * 4, q = Math.min(3, Math.floor(t)), f = t - q, a = parseInt(sc[q].substr(1), 16), b2 = parseInt(sc[q + 1].substr(1), 16), o4 = i * 4;
            im.data[o4] = (a >> 16) + (((b2 >> 16) - (a >> 16)) * f); im.data[o4 + 1] = ((a >> 8) & 255) + ((((b2 >> 8) & 255) - ((a >> 8) & 255)) * f); im.data[o4 + 2] = (a & 255) + (((b2 & 255) - (a & 255)) * f); im.data[o4 + 3] = 255; }
        g.putImageData(im, 0, 0);
        if (minis.els) { addImg('els', cv.toDataURL('image/png'), [[bn - rows * dLat, bw], [bn, bw + cols * dLng]], 0.8); minis.els.title = 'Уклоны, °'; setLeg('els', sc, '0', '15+', '°'); }
    }

    // ---------- 6. логистика: дороги и водоёмы выделяются на карте ----------
    function logSec() {
        return sec(6, 'truck', 'Логистика', 'Дороги, вода и населённые пункты рядом с участком (OpenStreetMap)', CC.log,
            '<div class="pp-cols"><div class="pp-colw"><div class="pp-sub nomap pp-mapcard"><div class="pp-mc"><div class="pp-dcol">' + mapBox('lg', '', 'Дороги и водоёмы') + '</div></div></div>' +
            blk({
                t: 'Ближайшие населённые пункты', i: 'city', id: 'ppLgSet', body: SPIN,
                info: ['Шесть ближайших к участку населённых пунктов и расстояния до них.', 'Оценка доступности рабочей силы, жилья, сервисов и точек сбыта; логистическое плечо до ближайшего города.', 'Узлы place=city/town/village/hamlet из OpenStreetMap в радиусе 20 км; расстояние до границы населённого пункта (или до точки, если контура в OSM нет) — по прямой и по дорогам; выбранные пункты и их границы выделены на карте.']
            }) +
            '</div><div class="pp-colw">' + blk({
                t: 'Расстояния до инфраструктуры', i: 'route', id: 'ppLgBody', body: SPIN,
                info: ['Расстояния от границы участка (ближайшей к объекту точки) до ближайших дорог, железной дороги, воды и населённых пунктов; до населённых пунктов — ещё и по дорогам.', 'Позволяют оценить затраты на подвоз ресурсов и вывоз урожая, проезжесть в распутицу (дорога с твёрдым покрытием), наличие источника воды и рабочей силы поблизости.',
                    'Данные OpenStreetMap через Overpass API: дороги, ж/д и водные объекты в радиусе 6 км, населённые пункты — до 20 км. Расстояние по прямой — между ближайшими точками контура участка и объекта (если объект пересекает участок или лежит внутри него — 0). Для населённых пунктов берётся полигональная граница из OSM (если она есть), а также маршрут по дорогам (OSRM, данные OpenStreetMap): сначала по прямой до ближайшей дороги, затем по дороге. На карте пунктиром показаны линии до ближайших объектов; цвета линий совпадают с цветами строк.']
            }) +
            blk({
                t: 'Дорожная сеть вокруг участка', i: 'road', id: 'ppLgNet', body: SPIN,
                info: ['Состав и плотность дорожной сети в радиусе 6 км вокруг центра участка.', 'Показывает, насколько развита транспортная инфраструктура и какие дороги преобладают — асфальт или грунтовки, которые могут стать непроезжими в распутицу.',
                    'Суммируются длины линий OpenStreetMap по классам highway; плотность = общая длина дорог / площадь круга радиуса 6 км (113 км²). В расчёт попадает вся длина дорог, пересекающих круг, поэтому значения приблизительные.']
            }) + '</div></div>');
    }
    async function logRun(gj, tok) {
        var c = D.c, la = c[1], lo = c[0], ar = '(around:%R,' + la + ',' + lo + ')';
        var q = '[out:json][timeout:25];(way' + ar.replace('%R', 6000) + '[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"];way' + ar.replace('%R', 6000) + '[railway=rail];way' + ar.replace('%R', 6000) + '[waterway~"^(river|stream|canal|drain)$"];way' + ar.replace('%R', 6000) + '[natural=water];node' + ar.replace('%R', 20000) + '[place~"^(city|town|village|hamlet)$"];);out geom qt;';
        var els = await ppOverpass(q), el = document.getElementById('ppLgBody'); if (tok !== seq) return;
        // --- геометрия: ближайшие точки границы участка и объекта (локальная проекция, метры) ---
        var k0 = Math.cos(la * Math.PI / 180), MM = 111320, P = function (a, b) { return [(b - lo) * k0 * MM, (a - la) * MM]; }, U = function (p) { return [la + p[1] / MM, lo + p[0] / (k0 * MM)]; };
        var RM = [], PE = [], bb0 = [1e18, 1e18, -1e18, -1e18];
        polysOf(gj).forEach(function (pl) { var r = pl[0].map(function (q2) { return P(q2[1], q2[0]); }); RM.push(r); r.forEach(function (p) { bb0 = [Math.min(bb0[0], p[0]), Math.min(bb0[1], p[1]), Math.max(bb0[2], p[0]), Math.max(bb0[3], p[1])]; }); for (var i = 1; i < r.length; i++) PE.push([r[i - 1], r[i]]); });
        var inside = function (p) { return RM.some(function (r) { var ins = false, i, j; for (i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins; } return ins; }); };
        var inLL = function (r, a, b) { var ins = false, i, j; for (i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][0] > a) !== (r[j][0] > a) && b < (r[j][1] - r[i][1]) * (a - r[i][0]) / (r[j][0] - r[i][0]) + r[i][1]) ins = !ins; } return ins; };
        var sd = function (p, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0, x = a[0] + t * dx, y = a[1] + t * dy; return [Math.hypot(p[0] - x, p[1] - y), x, y]; };
        var o3 = function (p, q2, r) { return (q2[0] - p[0]) * (r[1] - p[1]) - (q2[1] - p[1]) * (r[0] - p[0]); };
        var segs = function (a, b, c2, d2) {   // [расстояние, точка на отрезке объекта ab, точка на отрезке участка cd]
            var s1 = o3(a, b, c2), s2 = o3(a, b, d2), s3 = o3(c2, d2, a), s4 = o3(c2, d2, b);
            if (s1 * s2 < 0 && s3 * s4 < 0) { var t = s3 / (s3 - s4), ip = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; return [0, ip, ip]; }
            var r1 = sd(a, c2, d2), r2 = sd(b, c2, d2), r3 = sd(c2, a, b), r4 = sd(d2, a, b), m = [r1[0], a, [r1[1], r1[2]]];
            if (r2[0] < m[0]) m = [r2[0], b, [r2[1], r2[2]]];
            if (r3[0] < m[0]) m = [r3[0], [r3[1], r3[2]], c2];
            if (r4[0] < m[0]) m = [r4[0], [r4[1], r4[2]], d2];
            return m;
        };
        var nearPair = function (pts) {   // pts — вершины объекта в метрах; результат: d, a (точка на участке), b (точка на объекте)
            if (!pts.length) return null;
            if (inside(pts[0])) return { d: 0, a: U(pts[0]), b: U(pts[0]) };
            var bst = null, i, k, s2;
            for (i = 0; i < Math.max(1, pts.length - 1); i++) {
                var p0 = pts[i], p1 = pts[i + 1] || pts[i];
                if (bst) { var gx = Math.max(bb0[0] - Math.max(p0[0], p1[0]), Math.min(p0[0], p1[0]) - bb0[2], 0), gy = Math.max(bb0[1] - Math.max(p0[1], p1[1]), Math.min(p0[1], p1[1]) - bb0[3], 0); if (Math.hypot(gx, gy) >= bst[0]) continue; }
                for (k = 0; k < PE.length; k++) { s2 = segs(p0, p1, PE[k][0], PE[k][1]); if (!bst || s2[0] < bst[0]) bst = s2; if (bst[0] === 0) return { d: 0, a: U(bst[2]), b: U(bst[1]) }; }
            }
            return bst ? { d: bst[0], a: U(bst[2]), b: U(bst[1]) } : null;
        };
        var hard = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$/, T = function (e) { return e.tags || {}; };
        var near = function (f) { var best = null; els.forEach(function (e) { if (!f(e)) return; var m = nearPair((e.geometry || (e.lat != null ? [{ lat: e.lat, lon: e.lon }] : [])).map(function (p) { return P(p.lat, p.lon); })); if (m && (!best || m.d < best.d)) { m.name = T(e).name; best = m; } }); return best; };
        var R = [['Ближайшая дорога (любая)', near(function (e) { return T(e).highway; }), '#f97316'], ['Дорога с твёрдым покрытием', near(function (e) { return hard.test(T(e).highway || ''); }), '#ef4444'], ['Железная дорога', near(function (e) { return T(e).railway; }), '#6b7280'],
            ['Водоток / водоём', near(function (e) { return T(e).waterway || T(e).natural === 'water'; }), '#0ea5e9'], ['Населённый пункт', near(function (e) { return T(e).place; }), '#a855f7']];
        var fmd = function (d) { return d < 1000 ? nf(d, 0) + ' м' : nf(d / 1000, 2) + ' км'; };
        D.lg = { road: R[1][1] || R[0][1], settl: R[4][1] };
        var db = function (a, mxd) { return '<div class="pp-db">' + a.map(function (r) { return '<div class="r" style="--c:' + r.c + '"><span><i></i>' + r.l + (r.n ? '<em>' + esc(r.n) + '</em>' : '') + '</span><div class="t"><i style="width:' + (r.d == null ? 0 : Math.max(3, Math.sqrt(r.d / mxd) * 100)).toFixed(0) + '%"></i></div><b>' + (r.d == null ? 'не найдено' : fmd(r.d)) + '</b></div>'; }).join('') + '</div>'; };
        var drawRows = function () {
            var rows = R.map(function (r, k) { var x = r[1], rc = k === 4 && x && x.route ? (x.route.same ? '' : ' · по дорогам ' + fmd(x.route.tot)) : ''; return { l: r[0], c: r[2], d: x ? x.d : null, n: x ? ((x.name || '') + rc).replace(/^ · /, '') : '' }; });
            el.innerHTML = db(rows, Math.max.apply(null, rows.map(function (r) { return r.d || 0; }).concat([1]))) + '<div class="pp-cap">Расстояния по прямой — от ближайшей к объекту точки границы участка до ближайшей точки объекта (0 — объект пересекает участок или лежит внутри). Длина полосы — расстояние (шкала корневая, чтобы близкие объекты были различимы). Для населённых пунктов по дорогам — в таблице ниже.</div>';
        };
        drawRows();
        var len = function (e) { var s = 0, g2 = e.geometry, k; for (k = 1; k < g2.length; k++) s += hav(g2[k - 1].lat, g2[k - 1].lon, g2[k].lat, g2[k].lon); return s; };
        var NC = [['Магистральные и областные дороги', '#ef4444', /^(motorway|trunk|primary|secondary)$/, 'асфальт, высокая пропускная способность'], ['Местные дороги', '#f97316', /^(tertiary|unclassified|residential)$/, 'как правило, твёрдое покрытие'], ['Проезды, грунтовки, полевые дороги', '#a16207', /^(service|track)$/, 'в распутицу могут быть непроезжими'], ['Железные дороги', '#6b7280', null, ''], ['Водотоки (реки, ручьи, каналы)', '#0ea5e9', null, '']], km = [0, 0, 0, 0, 0], lakes = 0;
        els.forEach(function (e) {
            if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) return; var t = T(e), k = -1;
            if (t.highway) k = NC[0][2].test(t.highway) ? 0 : NC[1][2].test(t.highway) ? 1 : NC[2][2].test(t.highway) ? 2 : -1;
            else if (t.railway) k = 3; else if (t.waterway) k = 4; else if (t.natural === 'water') lakes++;
            if (k >= 0) km[k] += len(e) / 1000;
        });
        var rd = km[0] + km[1] + km[2], tk = rd + km[3] + km[4], net = document.getElementById('ppLgNet'), stl = document.getElementById('ppLgSet');
        if (net) net.innerHTML = tiles([['Дорог всего', nf(rd, 1) + ' км', '', '#ea580c'], ['Плотность сети', nf(rd / 113.1, 2) + ' км/км²', rd / 113.1 > 1 ? 'густая' : rd / 113.1 > 0.4 ? 'средняя' : 'редкая', '#f97316'], ['Твёрдое покрытие', rd ? nf((km[0] + km[1]) / rd * 100, 0) + ' %' : '—', 'магистрали и местные', '#ef4444'], ['Водоёмов (озёр, прудов)', nf(lakes, 0) + ' шт.', '', '#38bdf8'], ['Водотоков', nf(km[4], 1) + ' км', '', '#0ea5e9']]) +
            chart('Состав сети в радиусе 6 км', clsRows(NC.map(function (c, k) { return { l: c[0], c: c[1], v: km[k] / (tk || 1), t: nf(km[k], 1) + ' км', s: c[3] }; })), 'Доля — от суммарной длины дорог, железных дорог и водотоков в выборке.');
        var PT = { city: 'город', town: 'город, посёлок', village: 'село, деревня', hamlet: 'хутор' };
        var cand = els.filter(function (e) { return e.type === 'node' && T(e).place; }).map(function (e) { var m = nearPair([P(e.lat, e.lon)]); return m && { n: T(e).name || 'без названия', name: T(e).name || 'без названия', p: PT[T(e).place] || '', d: m.d, a: m.a, b: [e.lat, e.lon], node: [e.lat, e.lon], rings: null, route: undefined }; }).filter(Boolean).sort(function (u, v) { return u.d - v.d; }).slice(0, 6);
        R[4][1] = cand[0] || null; D.lg.settl = R[4][1]; drawRows();
        var fmr = function (r) { return r.same ? 'участок граничит с пунктом' : (r.g1 >= 30 ? fmd(r.g1) + ' по прямой до дороги + ' : '') + fmd(r.road) + ' по дороге' + (r.g2 >= 30 ? ' + ' + fmd(r.g2) + ' по прямой до пункта' : ''); };
        var drawSet = function () {
            if (!stl) return;
            if (!cand.length) { stl.innerHTML = '<div class="pp-note">Населённых пунктов в радиусе 20 км не найдено.</div>'; return; }
            stl.innerHTML = '<table class="pp-lgt"><thead><tr><th>Населённый пункт</th><th>По прямой</th><th>По дорогам</th></tr></thead><tbody>' + cand.map(function (x, k) {
                var r = x.route, rc = r === undefined ? '<span class="pp-lgw"><i class="fas fa-spinner fa-spin"></i> считаем…</span>' : r ? '<b>' + (r.same ? '—' : fmd(r.tot)) + '</b><small>' + fmr(r) + '</small>' : '<span class="pp-lgw">маршрут не построен</span>';
                return '<tr><td><span class="pp-lgn">' + (k + 1) + '</span>' + esc(x.n) + '<em>' + x.p + (x.rings ? '' : ' · контур в OSM не найден, показана точка') + '</em></td><td>' + fmd(x.d) + '</td><td>' + rc + '</td></tr>';
            }).join('') + '</tbody></table><div class="pp-cap">Расстояния — от ближайшей к пункту точки границы участка до ближайшей точки границы пункта (если контура нет — до точки). «По дорогам» — маршрут OSRM по сети OpenStreetMap: если дорога начинается не у границы участка, сначала считается путь по прямой до неё, затем по дороге. Пункты, участвующие в расчёте, и маршруты показаны на карте.</div>';
        };
        drawSet();
        // --- границы населённых пунктов (полигоны OSM), если есть ---
        var ringsOf = function (e) {
            var key = function (p) { return p[0].toFixed(6) + ',' + p[1].toFixed(6); }, g;
            if (e.type === 'way') { g = (e.geometry || []).map(function (p) { return [p.lat, p.lon]; }); return g.length > 3 && key(g[0]) === key(g[g.length - 1]) ? [g] : []; }
            var sg = (e.members || []).filter(function (m) { return m.type === 'way' && m.role !== 'inner' && m.geometry && m.geometry.length > 1; }).map(function (m) { return m.geometry.map(function (p) { return [p.lat, p.lon]; }); }), out = [];
            while (sg.length) {
                var cur = sg.shift(), grown = true;
                while (grown && key(cur[0]) !== key(cur[cur.length - 1])) {
                    grown = false;
                    for (var i = 0; i < sg.length; i++) {
                        var s2 = sg[i];
                        if (key(s2[0]) === key(cur[cur.length - 1])) cur = cur.concat(s2.slice(1));
                        else if (key(s2[s2.length - 1]) === key(cur[cur.length - 1])) cur = cur.concat(s2.slice(0, -1).reverse());
                        else if (key(s2[s2.length - 1]) === key(cur[0])) cur = s2.slice(0, -1).concat(cur);
                        else if (key(s2[0]) === key(cur[0])) cur = s2.slice(1).reverse().concat(cur);
                        else continue;
                        sg.splice(i, 1); grown = true; break;
                    }
                }
                if (cur.length > 3 && key(cur[0]) === key(cur[cur.length - 1])) out.push(cur);
            }
            return out;
        };
        var named = cand.filter(function (x) { return x.n !== 'без названия'; });
        if (named.length) {
            try {
                var qe = function (v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }, PL = '[place~"^(city|town|village|hamlet|suburb)$"]';
                var e2 = await ppOverpass('[out:json][timeout:40];(' + named.map(function (x) { var f = '(around:25000,' + la + ',' + lo + ')["name"="' + qe(x.n) + '"]'; return 'rel' + f + PL + ';rel' + f + '[boundary=administrative];way' + f + PL + ';way' + f + '[landuse=residential];'; }).join('') + ');out geom;');
                if (tok !== seq) return;
                var pv = polysOf(gj)[0][0][0];
                named.forEach(function (x) {
                    var best = null;
                    e2.forEach(function (e) {
                        if (T(e).name !== x.n) return;
                        var rs = ringsOf(e); if (!rs.length) return;
                        var hit = rs.some(function (r) { return inLL(r, x.node[0], x.node[1]); }), ar = 0;
                        rs.forEach(function (r) { ar += turf.area(turf.polygon([r.map(function (p) { return [p[1], p[0]]; })])); });
                        if (ar > 2e8) return;
                        var dn = hit ? 0 : Math.min.apply(null, rs.map(function (r) { return Math.min.apply(null, r.map(function (p) { return hav(p[0], p[1], x.node[0], x.node[1]); })); }));
                        if (!hit && dn > 1500) return;
                        var sc = [hit ? 0 : 1, hit ? ar : dn];
                        if (!best || sc[0] < best.s[0] || (sc[0] === best.s[0] && sc[1] < best.s[1])) best = { rs: rs, s: sc };
                    });
                    if (!best) return;
                    x.rings = best.rs;
                    var bm = null; x.rings.forEach(function (r) { var m = nearPair(r.map(function (p) { return P(p[0], p[1]); })); if (m && (!bm || m.d < bm.d)) bm = m; });
                    if (x.rings.some(function (r) { return inLL(r, pv[1], pv[0]); })) { x.d = 0; x.a = [pv[1], pv[0]]; x.b = [pv[1], pv[0]]; }
                    else if (bm) { x.d = bm.d; x.a = bm.a; x.b = bm.b; }
                });
                cand.sort(function (u, v) { return u.d - v.d; });
                R[4][1] = cand[0] || null; D.lg.settl = R[4][1]; drawRows(); drawSet();
            } catch (err) { if (tok !== seq) return; console.warn('Паспорт: границы населённых пунктов', err); }
        }
        var o = minis.lg; if (!o) return;
        o.vec = true;   // в снимках карты (Excel, PDF, HTML) рисуем дороги, водоёмы и маршруты
        var SC = '#7e22ce';
        cand.forEach(function (x, k) {
            var lyr = x.rings ? L.polygon(x.rings, { color: SC, weight: 2, fillColor: '#a855f7', fillOpacity: 0.22, interactive: false }) : L.circleMarker(x.node, { radius: 6, color: '#fff', weight: 2, fillColor: SC, fillOpacity: 1, interactive: false });
            lyr.addTo(o.map).bindTooltip((k + 1) + '. ' + x.n, { permanent: true, direction: 'top', className: 'pp-lgtt' });
        });
        // сами дороги и водоёмы (сначала вода и магистрали, не более 1500 объектов)
        var pri = function (t) { return t.waterway || t.natural ? 0 : /motorway|trunk|primary|secondary/.test(t.highway || '') ? 1 : t.railway ? 2 : 3; };
        els.filter(function (e) { return e.type === 'way' && e.geometry && e.geometry.length > 1; }).sort(function (a, b) { return pri(T(a)) - pri(T(b)); }).slice(0, 1500).forEach(function (e) {
            var t = T(e), ll = e.geometry.map(function (p) { return [p.lat, p.lon]; });
            if (t.natural === 'water') L.polygon(ll, { color: '#0284c7', weight: 1.5, fillColor: '#38bdf8', fillOpacity: 0.55, interactive: false }).addTo(o.map);
            else if (t.waterway) L.polyline(ll, { color: '#0ea5e9', weight: 3, opacity: 0.95, interactive: false }).addTo(o.map);
            else if (t.railway) L.polyline(ll, { color: '#6b7280', weight: 2.5, dashArray: '6 3', interactive: false }).addTo(o.map);
            else L.polyline(ll, { color: /motorway|trunk|primary|secondary/.test(t.highway) ? '#ef4444' : '#f97316', weight: /motorway|trunk|primary/.test(t.highway) ? 3.5 : 2, opacity: 0.95, interactive: false }).addTo(o.map);
        });
        R.forEach(function (r) { if (r[1]) L.polyline([r[1].a, r[1].b], { color: r[2], weight: 2.5, dashArray: '5 4', interactive: false }).addTo(o.map); });
        L.geoJSON(gj, { style: { color: '#ffffff', weight: 3, fillColor: '#10b981', fillOpacity: 0.25 }, interactive: false }).addTo(o.map);
        var pts = [[la, lo]]; R.forEach(function (r) { if (r[1]) pts.push(r[1].a, r[1].b); }); cand.forEach(function (x) { pts.push(x.a, x.b); }); o.map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 }); o.title = 'Логистика: дороги, водоёмы и населённые пункты';
        // --- маршруты по дорогам (OSRM): путь по прямой до дороги, затем по дороге; считаются по очереди, не блокируя паспорт ---
        var route = async function (x) {
            var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 15000);
            try {
                var r = await fetch('https://router.project-osrm.org/route/v1/driving/' + x.a[1].toFixed(6) + ',' + x.a[0].toFixed(6) + ';' + x.b[1].toFixed(6) + ',' + x.b[0].toFixed(6) + '?overview=full&geometries=geojson', { signal: ctl.signal });
                if (!r.ok) return null; var j = await r.json(); if (j.code !== 'Ok' || !j.routes || !j.routes.length) return null;
                var w = j.waypoints, rt = j.routes[0];
                return { road: rt.distance, g1: w[0].distance, g2: w[1].distance, tot: rt.distance + w[0].distance + w[1].distance, line: rt.geometry.coordinates.map(function (p) { return [p[1], p[0]]; }), s: [w[0].location[1], w[0].location[0]], e: [w[1].location[1], w[1].location[0]] };
            } catch (er) { return null; } finally { clearTimeout(tm); }
        };
        (async function () {
            for (var k = 0; k < cand.length; k++) {
                if (tok !== seq) return;
                var x = cand[k], r = x.d < 1 ? { same: true, tot: 0 } : await route(x);
                if (tok !== seq) return;
                x.route = r;
                if (r && r.line) {
                    L.polyline(r.line, { color: SC, weight: 3.5, opacity: 0.9, interactive: false }).addTo(o.map);
                    if (r.g1 >= 30) L.polyline([x.a, r.s], { color: SC, weight: 2.5, dashArray: '5 4', interactive: false }).addTo(o.map);
                    if (r.g2 >= 30) L.polyline([r.e, x.b], { color: SC, weight: 2.5, dashArray: '5 4', interactive: false }).addTo(o.map);
                }
                drawSet(); drawRows();
            }
        })().catch(function (er) { console.warn('Паспорт: маршруты', er); });
    }

    // ---------- 7. климат и солнечный режим ----------
    function weatherSec() {
        var la = D.c[1], dec = 23.44, noon = function (dc) { return 90 - Math.abs(la - dc); }, N = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349], dl = N.map(function (n) { return dayLen(la, n); });
        var fh = function (h) { var m = Math.round(h * 60); return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'; };
        var solar = blk({
                t: 'Солнечный режим', i: 'sun', c: '#f59e0b',
                info: ['Продолжительность светового дня по месяцам и высота солнца над горизонтом в разные сезоны для широты участка.', 'Учитывается при выборе культур по фотопериоду (длиннодневные и короткодневные), планировании теплиц и размещении солнечных панелей.',
                    'Астрономический расчёт по широте центра участка: склонение солнца δ = 23,44° · sin(2π(284 + N) / 365), длина дня = 24/π · arccos(−tg φ · tg δ); полуденная высота солнца = 90° − |φ − δ|. От погоды не зависит.'],
                body: '<div class="pp-solar">' + tiles([['Самый длинный день (22 июн)', fh(dayLen(la, 172)), '', '#f59e0b'], ['Самый короткий день (22 дек)', fh(dayLen(la, 355)), '', '#3b82f6'], ['Равноденствие (21 мар)', fh(dayLen(la, 80)), '', '#22c55e'], ['Солнце в полдень, 22 июн', nf(noon(dec), 0) + '°', '', '#f59e0b'], ['Солнце в полдень, 22 дек', nf(noon(-dec), 0) + '°', '', '#3b82f6']]) +
                    chart('Продолжительность дня по месяцам, ч', dayChart(dl), 'Над точками — часы светового дня (десятичные), крупно выделены максимум и минимум; при наведении — часы и минуты. Рассчитано по широте участка.') + '</div>'
        });
        return sec(7, 'cloud-sun', 'Климат и погода', 'Климат и теплообеспеченность, солнечный режим, прогноз, ветер и заморозки', CC.clim,
            '<div class="pp-wxs">' + wxBlk('f') + wxBlk('w') + wxBlk('c') + wxBlk('b') + solar + '</div>').replace('<section class="pp-sec"', '<section class="pp-sec pp-compact"');
    }

    // ---------- 7б. погода и агроклимат: те же разделы, что на вкладках «Погода» (мост window.ppWx из script.js) ----------
        var WXG = [   // блоки без мини-карт: прогноз, ветер, заморозки, климат + тепло
        { id: 'w', keys: ['windwork'], t: 'Ветер и окна работ', i: 'wind', c: '#0ea5e9',
            info: ['Роза ветров и статистика ветра за 10 лет, окна для опрыскивания и полевых работ. На карте — стрелки текущего ветра на участке.', 'Помогает выбрать время обработки без сноса препарата и спланировать полевые работы.', 'Ветер за 10 лет — ERA5. Окна: опрыскивание при ветре ≤ 5 м/с без осадков и t 8…27 °C. Стрелки — текущий ветер прогноза Open-Meteo (резерв MET Norway), интерполированный по точкам внутри контура.'] },
        { id: 'f', keys: ['weather'], t: 'Прогноз погоды', i: 'cloud-sun-rain', c: '#0ea5e9',
            info: ['Текущая погода и прогноз на 7 дней в точках внутри участка: температура, влажность, облачность, ветер, осадки.', 'Помогает планировать сев, опрыскивание и полевые работы, заранее видеть заморозки, ливни и порывистый ветер.', 'Open-Meteo (резерв MET Norway): 1–9 точек сетки внутри контура, значения усреднены, в скобках минимум и максимум.'] },
        { id: 'b', keys: ['frost'], t: 'Заморозки', i: 'snowflake', c: '#06b6d4',
            info: ['Безморозный период, даты последнего весеннего и первого осеннего заморозков, риск заморозков по датам, число дней с заморозком по месяцам. На карте — температура в точках прогноза.', 'Нужен для выбора сроков сева теплолюбивых культур и сортов с подходящей скороспелостью, оценки риска для цветения и уборки.', 'Заморозок — минимальная суточная температура ниже 0 °C (ERA5, 10 лет); риск — доля лет с заморозком позже / раньше указанной даты. Карта: прогноз Open-Meteo на текущий момент по точкам внутри контура.'] },
        { id: 'c', keys: ['climate', 'gdd'], t: 'Климат и теплообеспеченность', i: 'chart-line', c: '#6366f1',
            info: ['Климатическая норма за последние 10 полных лет: температура и осадки по месяцам, суммы активных температур, период вегетации, ГТК и пригодность культур по теплу.', 'Показывает типичный ход тепла и влаги, риск засухи, помогает подобрать культуры и группы спелости.', 'Суточные данные ERA5 через Open-Meteo Archive (ячейка ≈ 10–25 км). Σ t > 5 и > 10 °C; период вегетации — по 5-суточному скользящему среднему; ГТК Селянинова = 10 · Σ осадков / Σ t за период с t > 10 °C.'] }
    ];
    function wxBlk(id) {   // блок раздела 7 по id из WXG
        var g = WXG.filter(function (x) { return x.id === id; })[0];
        return blk({ t: g.t, i: g.i, c: g.c, info: g.info, id: 'ppWx_' + g.id, body: SPIN, map: g.map ? mapBox(g.map, '', g.mt) : '' });
    }
    async function wxRun(gj, tok) {
        var d;
        try { if (!window.ppWx) throw new Error('модуль погоды недоступен'); d = await ppWx.get(gj); }
        catch (e) { if (tok !== seq) return; WXG.forEach(function (g) { var el = document.getElementById('ppWx_' + g.id); if (el) el.innerHTML = '<div class="pp-note">Не удалось получить данные погоды: ' + esc(e && e.message || e) + '</div>'; }); throw e; }
        if (tok !== seq) return;
        D.wx = d;
        WXG.forEach(function (g) { var el = document.getElementById('ppWx_' + g.id); if (el) el.innerHTML = '<div class="pp-wxg pp-wxg-' + g.id + '">' + g.keys.map(function (k) { return ppWx.render(k, d); }).join('') + '</div>'; });
    }
    async function climRun(gj, tok) {
        var c = D.c, el = document.getElementById('ppClBody'), y1 = new Date().getFullYear() - 1, y0 = y1 - 9, yrs = 10, ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 25000), j, r;
        try {
            r = await fetch('https://archive-api.open-meteo.com/v1/archive?latitude=' + c[1].toFixed(4) + '&longitude=' + c[0].toFixed(4) + '&start_date=' + y0 + '-01-01&end_date=' + y1 + '-12-31&daily=temperature_2m_mean,temperature_2m_min,precipitation_sum&timezone=auto', { signal: ctl.signal });
            if (!r.ok) throw new Error('Open-Meteo: HTTP ' + r.status);
            j = await r.json();
        } finally { clearTimeout(tm); }
        if (tok !== seq) return;
        var d = j.daily; if (!d || !d.time || !d.time.length) throw new Error('нет данных Open-Meteo');
        var mT = new Array(12).fill(0), mN = new Array(12).fill(0), mP = new Array(12).fill(0), sP = 0, sT = 0, nT = 0, s10 = 0, p10 = 0, ff = {}, i, y;
        for (i = 0; i < d.time.length; i++) {
            var t = d.temperature_2m_mean[i], tn = d.temperature_2m_min[i], p = d.precipitation_sum[i], mo = +d.time[i].substr(5, 2) - 1, yr = d.time[i].substr(0, 4);
            if (p != null) { mP[mo] += p; sP += p; }
            if (t != null) { mT[mo] += t; mN[mo]++; sT += t; nT++; if (t > 10) { s10 += t; if (p != null) p10 += p; } }
            if (tn != null && tn < 0) { var doy = (Date.UTC(+yr, mo, +d.time[i].substr(8, 2)) - Date.UTC(+yr, 0, 1)) / 864e5, fz = ff[yr] || (ff[yr] = { a: -1, b: 999 }); if (mo < 6 && doy > fz.a) fz.a = doy; if (mo >= 6 && doy < fz.b) fz.b = doy; }
        }
        var tM = mT.map(function (v, k) { return mN[k] ? v / mN[k] : 0; }), pM = mP.map(function (v) { return v / yrs; }), fsum = 0;
        for (y = y0; y <= y1; y++) { var fz2 = ff[y] || { a: -1, b: 999 }; fsum += (fz2.b === 999 ? 365 : fz2.b) - (fz2.a < 0 ? 0 : fz2.a); }
        var k = D.clim = { tm: nT ? sT / nT : null, pr: sP / yrs, sat: s10 / yrs, gtk: s10 > 0 ? p10 * 10 / s10 : null, ff: fsum / yrs };
        var gk = k.gtk != null ? gtkCl(k.gtk) : null, at = agroT(k.sat), wm = tM.indexOf(Math.max.apply(null, tM)), cm = tM.indexOf(Math.min.apply(null, tM)), wp = pM.indexOf(Math.max.apply(null, pM));
        if (el) el.innerHTML = tiles([['Средняя t° года', nf(k.tm, 1) + ' °C', '', '#ef4444'], ['Осадки за год', nf(k.pr, 0) + ' мм', 'макс. в ' + MON[wp], '#0ea5e9'], ['Σ t > 10 °C за год', nf(k.sat, 0) + ' °', '', at[1]], ['ГТК Селянинова', k.gtk != null ? nf(k.gtk, 2) : '—', gk ? gk[0] : '', gk ? gk[1] : '#94a3b8'], ['Безморозный период', nf(k.ff, 0) + ' дн.', '', '#22c55e'], ['Тепло / холод', nf(tM[wm], 0) + '° / ' + nf(tM[cm], 0) + '°', MON[wm] + ' / ' + MON[cm], '#f97316']]) +
            '<div class="pp-chs">' + chart('Климатограмма по месяцам', climo(tM, pM), 'Среднее за ' + y0 + '–' + y1 + ' гг. (ERA5, Open-Meteo). Месяцы, где столбцы осадков низкие, а температура высокая, — риск засухи.') +
            chart('Теплообеспеченность', meter([[1600, '#3b82f6'], [2200, '#06b6d4'], [3000, '#f59e0b'], [9999, '#ef4444']], k.sat, 0, 4000, 0), '<b style="color:' + at[1] + '">Σt > 10 °C = ' + nf(k.sat, 0) + ' °: ' + at[0] + '.</b> Границы зон: 1600, 2200 и 3000 °.') + '</div>';
    }

    // ---------- 8. итог, индекс пригодности ----------
    function sumSec() {
        return sec(8, 'clipboard-check', 'Итог и рекомендации', 'Выводы по всем разделам и индекс пригодности участка', CC.sum,
            blk({
                t: 'Автоматические выводы', i: 'list-check',
                info: ['Краткие текстовые выводы и рекомендации, собранные из результатов всех разделов паспорта.', 'Помогают быстро увидеть главное: ограничения рельефа, реакцию почвы, климатический риск, удалённость от дорог — без чтения всех блоков.', 'Правила «если — то» по порогам показателей: средний уклон ≥ 5°, pH < 5,5 или > 8, ГТК < 0,9, расстояние до дороги > 2 км, компактность < 0,3. Выводы предварительные, не заменяют обследование на месте.'],
                body: '<div id="ppSum" class="pp-note">Формируется после расчёта разделов…</div>'
            }) +
            blk({
                t: 'Индекс пригодности участка', i: 'gauge-high', id: 'ppScore', body: SPIN,
                info: ['Сводная ориентировочная оценка пригодности участка для сельскохозяйственного использования по семи факторам, 0–100 баллов.', 'Позволяет сравнивать участки между собой и сразу видеть слабое место — фактор, который тянет оценку вниз.',
                    'Рельеф: 100 при среднем уклоне ≤ 1°, линейно до 0 при ≥ 12°. Хим. анализ: среднее оценок pH (идеал 6,8; 0 при отклонении ≥ 1,8), органического C (100 при ≥ 35 г/кг), общего азота (100 при ≥ 3,5 г/кг) и CEC (100 при ≥ 30 смоль/кг). Климат: ГТК (100 при 1,1–1,6) и безморозный период (100 при ≥ 180 дней, 0 при ≤ 100). Логистика: 100 при дороге с твёрдым покрытием ≤ 500 м, 0 при ≥ 10 км (логарифмическая шкала). Форма: компактность K / 0,7. Вегетация (по снимку выбранной даты): среднее оценок NDVI (100 при ≥ 0,6, 0 при ≤ 0,1), NDMI (100 при ≥ 0,3, 0 при ≤ −0,2), NBR (100 при ≥ 0,5, 0 при ≤ 0,1) и однородности NDVI (100 при вариации ≤ 10 %, 0 при ≥ 50 %); оценка зависит от сезона и облачности выбранной даты. Классификация: доля пашни в площади участка (100 при 100 %); слой пока не подключён — фактор показан как «н/д» и в среднее не входит. Итог — среднее по доступным факторам.']
            }));
    }
    function scores() {
        var e = D.elev, s = D.soil && D.soil.S, g = D.lg, k = D.clim, so = [], cm = [], ph = s && s.phh2o, oc = s && s.soc, ce = s && s.cec, nn = s && s.nitrogen, rd = g && g.road, cl = D.cls, ar = D.area / 1e4;
        if (ph) so.push(100 * (1 - cl01(Math.abs(ph.mean - 6.8) / 1.8)));
        if (oc) so.push(100 * cl01(oc.mean / 35));
        if (ce) so.push(100 * cl01(ce.mean / 30));
        if (nn) so.push(100 * cl01(nn.mean / 3.5));
        if (k && k.gtk != null) cm.push(k.gtk <= 1.6 ? 100 * cl01(k.gtk / 1.1) : 100 * cl01(1 - (k.gtk - 1.6) / 1.5));
        if (k && k.ff != null) cm.push(100 * cl01((k.ff - 100) / 80));
        var sv = [], sT = D.sat || {}, sf = function (q) { return sT[q] && sT[q].stats; }, n1 = sf('ndvi'), n2 = sf('ndmi'), n4 = sf('nbr');   // вегетация по снимку выбранной даты
        if (n1) { sv.push(100 * cl01((n1.mean - 0.1) / 0.5)); sv.push(100 * (1 - cl01((n1.std / Math.max(0.05, Math.abs(n1.mean)) - 0.1) / 0.4))); }
        if (n2) sv.push(100 * cl01((n2.mean + 0.2) / 0.5));
        if (n4) sv.push(100 * cl01((n4.mean - 0.1) / 0.4));
        var svb = sv.length ? [n1 ? 'NDVI ' + nf(n1.mean, 2) : '', n2 ? 'NDMI ' + nf(n2.mean, 2) : '', n4 ? 'NBR ' + nf(n4.mean, 2) : ''].filter(Boolean).join(', ') + (D.satSel ? ' · ' + satDay(D.satSel.day) : '') : 'нет данных — выберите дату снимка';
        return [
            { l: 'Рельеф', v: e && e.ms != null ? 100 * (1 - cl01((e.ms - 1) / 11)) : null, b: e && e.ms != null ? 'средний уклон ' + nf(e.ms, 1) + '°' : 'нет данных' },
            { l: 'Хим. анализ', v: so.length ? avg(so) : null, b: ph || oc || ce || nn ? [ph ? 'pH ' + nf(ph.mean, 1) : '', oc ? 'C ' + nf(oc.mean, 1) + ' г/кг' : '', nn ? 'N ' + nf(nn.mean, 2) + ' г/кг' : '', ce ? 'CEC ' + nf(ce.mean, 1) : ''].filter(Boolean).join(', ') : 'нет данных' },
            { l: 'Климат', v: cm.length ? avg(cm) : null, b: k ? (k.gtk != null ? 'ГТК ' + nf(k.gtk, 2) + ', ' : '') + 'безморозный период ' + nf(k.ff, 0) + ' дн.' : 'нет данных' },
            { l: 'Логистика', v: g ? (rd ? 100 * (1 - cl01(Math.log(Math.max(rd.d, 500) / 500) / Math.log(20))) : 0) : null, b: g ? (rd ? 'твёрдая дорога в ' + (rd.d < 1000 ? nf(rd.d, 0) + ' м' : nf(rd.d / 1000, 1) + ' км') : 'дорог в радиусе 6 км не найдено') : 'нет данных' },
            { l: 'Форма', v: D.comp != null ? 100 * cl01(D.comp / 0.7) : null, b: D.comp != null ? 'компактность K = ' + nf(D.comp, 2) : 'нет данных' },
            { l: 'Вегетация', v: sv.length ? avg(sv) : null, b: svb },
            // классификация: D.cls = { arable: площадь пашни, га } появится после подключения слоя; пока пусто и в итоговую оценку не входит
            { l: 'Классификация', r: 'Классиф.', v: cl && cl.arable != null && ar > 0 ? 100 * cl01(cl.arable / ar) : null, b: cl && cl.arable != null ? 'пашня ' + nf(cl.arable, 1) + ' га' + (ar > 0 ? ' (' + nf(cl.arable / ar * 100, 0) + ' % участка)' : '') : 'нет данных — слой классификации не подключён (здесь будет площадь пашни)' }
        ];
    }
    function scoreTbl() {
        var sc = scores(), r = radar(sc);
        return '<div class="pp-dn pp-dn2"><div class="pp-score pp-score-in"><div class="big" style="color:' + (r.avg == null ? '#94a3b8' : scCol(r.avg)) + '">' + (r.avg == null ? '…' : Math.round(r.avg)) + '<span>/100</span></div>' + r.svg + '</div><div class="pp-db">' +
            sc.map(function (x) { return '<div class="r" style="--c:' + (x.v == null ? '#cbd5e1' : scCol(x.v)) + '"><span><i></i>' + x.l + '<em>' + x.b + '</em></span><div class="t"><i style="width:' + (x.v == null ? 0 : x.v.toFixed(0)) + '%"></i></div><b>' + (x.v == null ? 'н/д' : Math.round(x.v) + ' / 100') + '</b></div>'; }).join('') + '</div></div>' +
            '<div class="pp-cap">Шкала цвета: зелёный — благоприятно (≥ 75), салатовый — хорошо, жёлтый — удовлетворительно, оранжевый и красный — ограничивающий фактор. Оценка ориентировочная.</div>';
    }
    function kpiHtml() {
        var s = D.soil && D.soil.S, e = D.elev, g = D.lg, k = D.clim, ph = s && s.phh2o, so = s && s.soc, r = radar(scores()), fd = function (d) { return d < 1000 ? nf(d, 0) + ' м' : nf(d / 1000, 1) + ' км'; };
        var K = [['Площадь', nf(D.area / 1e4, 2) + ' га', 'ruler-combined', CC.gen, 'геодезическая площадь контура на эллипсоиде WGS-84 (Turf)'], ['Перепад высот', e ? nf(e.mx - e.mn, 0) + ' м' : '…', 'mountain', CC.rel, 'максимум минус минимум высоты по цифровой модели рельефа внутри контура'], ['Средний уклон', e && e.ms != null ? nf(e.ms, 1) + '°' : '…', 'chart-line', CC.rel, 'среднее по ячейкам модели рельефа внутри контура, по разнице высот соседних ячеек'], ['pH почвы', ph ? nf(ph.mean, 1) : '…', 'flask', CC.soil, 'SoilGrids 250 м, слой 0–5 см: среднее по ячейкам внутри контура'],
            ['Гумус (оценка)', so ? nf(so.mean * 0.1724, 1) + ' %' : '…', 'leaf', CC.soil, 'органический углерод SoilGrids (г/кг) × 0,1724 → % гумуса'], ['До дороги', g && g.road ? fd(g.road.d) : '…', 'road', CC.log, 'по прямой от границы участка до ближайшей дороги с твёрдым покрытием (OSM, радиус 6 км)'], ['ГТК', k && k.gtk != null ? nf(k.gtk, 2) : '…', 'cloud-rain', CC.clim, '10 · Σосадков / Σt за дни теплее 10 °C; ERA5, среднее за 10 лет'], ['Σ t > 10 °C', k ? nf(k.sat, 0) + ' °' : '…', 'temperature-half', CC.clim, 'сумма средних суточных температур в дни теплее 10 °C за год; ERA5, 10 лет']];
        return '<div class="pp-score"><small>Индекс пригодности</small><div class="big" style="color:' + (r.avg == null ? '#94a3b8' : scCol(r.avg)) + '">' + (r.avg == null ? '…' : Math.round(r.avg)) + '<span>/100</span></div>' + r.svg + '<div class="pp-cap2">Как считается: среднее семи оценок 0–100 — рельеф, хим. анализ почвы, климат, логистика, форма, вегетация по снимку выбранной даты, классификация (доля пашни; пока нет данных) — по доступным. Формулы — в разделе 8.</div></div>' +
            '<div class="pp-kgrid">' + K.map(function (q) { return '<div class="pp-kpi" style="--c:' + q[3] + '"><small><i class="fas fa-' + q[2] + '"></i>' + q[0] + '</small><b>' + q[1] + '</b><span class="how">' + q[4] + '</span></div>'; }).join('') + '</div>';
    }
    function summary() {
        var out = [], s = D.soil && D.soil.S, e = D.elev, g = D.lg;
        out.push('Площадь участка — ' + nf(D.area / 1e4, 2) + ' га' + (D.cad ? ', кадастровый номер ' + esc(D.cad) : '') + '.');
        if (D.cadx && D.cadx.items.length) out.push('Контур пересекает кадастровых участков: ' + D.cadx.items.length + '; покрыто кадастровыми границами ≈ ' + nf(Math.min(100, D.cadx.cover / D.cadx.tot * 100), 1) + ' % площади.');
        if (e) { out.push('Рельеф: перепад высот ' + nf(e.mx - e.mn, 0) + ' м' + (e.ms != null ? ', средний уклон ' + nf(e.ms, 1) + '°' : '') + (e.asp ? ', экспозиция преимущественно ' + e.asp : '') + '.');
            if (e.ms != null && e.ms >= 5) out.push('<b>Рекомендация:</b> уклон заметный — обработку вести поперёк склона, учесть риск водной эрозии.'); else if (e.ms != null) out.push('Рельеф не ограничивает механизированные работы.'); }
        if (s && s.phh2o) { var ph = s.phh2o.mean; out.push('Почва: pH ≈ ' + nf(ph, 1) + (ph < 5.5 ? ' — кислая; <b>рекомендация:</b> рассмотреть известкование.' : ph > 8 ? ' — щелочная; <b>рекомендация:</b> подобрать культуры, устойчивые к щелочности.' : ' — в благоприятном диапазоне.')); }
        if (s && s.soc) out.push('Органический углерод ≈ ' + nf(s.soc.mean, 1) + ' г/кг (SoilGrids, 250 м).');
        if (g && g.road) out.push('До ближайшей дороги с твёрдым покрытием — ' + (g.road.d < 1000 ? nf(g.road.d, 0) + ' м' : nf(g.road.d / 1000, 1) + ' км') + (g.road.d > 2000 ? '; <b>рекомендация:</b> заложить затраты на подъездные пути.' : '.'));
        var sn = D.sat && D.sat.ndvi && D.sat.ndvi.stats; if (sn) out.push('Спутник (Sentinel-2, ' + satDay(D.satSel.day) + '): средний NDVI ' + nf(sn.mean, 2) + ' (' + (sn.mean >= 0.6 ? 'плотная вегетация' : sn.mean >= 0.4 ? 'густая растительность' : sn.mean >= 0.2 ? 'редкая растительность или всходы' : 'голая почва, вода или застройка') + '), неоднородность ' + nf(sn.std / Math.max(0.01, Math.abs(sn.mean)) * 100, 0) + ' %.');
        var kc = D.clim; if (kc && kc.gtk != null) out.push('Климат: Σt>10 °C ≈ ' + nf(kc.sat, 0) + '°, осадки ≈ ' + nf(kc.pr, 0) + ' мм/год, безморозный период ≈ ' + nf(kc.ff, 0) + ' дн., ГТК ' + nf(kc.gtk, 2) + ' (' + gtkCl(kc.gtk)[0] + ')' + (kc.gtk < 0.9 ? '; <b>рекомендация:</b> подбирать засухоустойчивые культуры, предусмотреть влагосберегающую обработку или орошение.' : '.'));
        if (D.tex) out.push('Механический состав почвы (0–5 см): ' + D.tex + '.');
        if (D.comp != null && D.comp < 0.3) out.push('Контур сильно вытянут (компактность ' + nf(D.comp, 2) + ') — больше поворотов и холостых проходов техники.');
        out.push('<i>Выводы предварительные, сформированы автоматически по открытым данным; классификация земли и спутниковая статистика будут добавлены позже.</i>');
        var el = document.getElementById('ppSum'); if (el) { el.className = 'pp-sum'; el.innerHTML = '<ul>' + out.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
        var sb = document.getElementById('ppScore'); if (sb) sb.innerHTML = scoreTbl();
        var kp = document.getElementById('ppKpi'); if (kp) kp.innerHTML = kpiHtml();
    }

    // ---------- сборка ----------
    function invalidateMinis() { Object.keys(minis).forEach(function (k) { try { minis[k].map.invalidateSize(); } catch (e) { /* карта удалена */ } }); }
    function clearMinis() {
        Object.keys(minis).forEach(function (k) { try { minis[k].map.remove(); } catch (e) { /* уже удалена */ } delete minis[k]; });
        Object.keys(m3s).forEach(function (k) { try { m3s[k].remove(); } catch (e) { /* уже удалена */ } delete m3s[k]; });
    }
    function render() {
        var tok = ++seq; clearMinis(); D = {}; retry = null;
        setTimeout(unwait, 40);
        var l = forced ? { feature: { properties: { cad_number: forced.meta.cad || '' } } } : pick(), t = document.getElementById('ppTitle');
        if (!l) { if (t) t.textContent = 'Паспорт участка'; body.innerHTML = '<div class="pp-sec"><div class="pp-sec-b"><div class="pp-note">Нет фигуры для паспорта. Нарисуйте участок (или загрузите контур / выписку Росреестра), выделите его на карте и нажмите «Обновить по фигуре».</div></div></div>'; return; }
        var gj = forced ? forced.gj : toGJ(l); D.gj = gj;
        var head = general(l, gj);
        body.innerHTML = '<div class="pp-kpis" id="ppKpi"></div>' + head + classification() + satellites() + soilSec() + elevSec() + logSec().replace('<section class="pp-sec"', '<section class="pp-sec pp-compact"') + weatherSec() + sumSec();
        document.getElementById('ppKpi').innerHTML = kpiHtml(); packInit();
        // имя фигуры (стандартное или своё из «Списка объектов») + площадь — если это не кадастровый участок и не выписка
        D.name = D.cad ? '' : (forced ? (forced.meta.name || '') : (l._gcName || l._gcDef || (function () { var n = ''; if (typeof drawnItems !== 'undefined') drawnItems.eachLayer(function (g) { if (!n && g !== l && g.hasLayer && g.hasLayer(l)) n = g._gcName || g._gcDef || ''; }); return n; })()));
        if (t) t.textContent = 'Паспорт участка' + (D.cad ? ' № ' + D.cad : D.name ? ' «' + D.name + '» · ' + nf(D.area / 1e4, 2) + ' га' : '');
        var T = { gen: 'Участок', cadx: 'Кадастр: пересечения', cls: 'Классификация земли', s2rgb: 'Sentinel-2 · RGB', s2cir: 'Sentinel-2 · ложные цвета', ndvi: 'NDVI', ndmi: 'NDMI', nbr: 'NBR', gndvi: 'GNDVI', ndre: 'NDRE', savi: 'SAVI', ndwi: 'NDWI', ndti: 'NDTI', elh: 'Высоты', els: 'Уклоны', lg: 'Логистика' };
        SOILS.forEach(function (p) { T['soil_' + p] = 'Почва'; });
        Object.keys(T).forEach(function (k) { mini(k, gj, T[k]); });
        stInit(); address(D.c, tok); if (D.satSel) stSet('sat', 'load');
        var soilFail = function (e) { SOILS.forEach(function (p) { var b = document.getElementById('ppSB_' + p); if (b && b.querySelector('.fa-spin')) b.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>'; }); };
        var lastErr = {}, tries = {};
        var wrap = function (k, p, chk) { return p.then(function () { if (tok === seq) { var m = chk(); lastErr[k] = m; stSet(k, m ? 'err' : 'ok', m); } }, function (e) { lastErr[k] = e && e.message || 'ошибка'; if (tok === seq) stSet(k, 'err', lastErr[k]); throw e; }); };
        var defs = {   // раздел: [функция расчёта, блоки на странице, проверка результата, ключ в D]
            soil: [soilRun, SOILS.map(function (p) { return 'ppSB_' + p; }), function () { var d = D.soil, S = d && d.S; if (!S || !Object.keys(S).length) return (d && d.err) || 'нет данных SoilGrids'; var miss = SOILS.filter(function (p) { return !d.cov[p]; }); return miss.length ? 'не загрузились слои: ' + miss.join(', ') : ''; }, 'soil'],
            elev: [elevRun, ['ppElBody', 'ppElB2', 'ppElB3', 'ppRose'], function () { return D.elev ? '' : 'данные рельефа недоступны'; }, 'elev'],
            log: [logRun, ['ppLgBody'], function () { return D.lg ? '' : 'нет данных OSM'; }, 'lg'],
            clim: [climRun, ['ppClBody'], function () { return D.clim ? '' : 'нет данных климата'; }, 'clim'],
            wx: [wxRun, WXG.map(function (g) { return 'ppWx_' + g.id; }), function () { return D.wx ? '' : 'нет данных погоды'; }, 'wx'],
            cad: [cadRun, ['ppCadBody'], function () { return D.cadx ? '' : 'нет данных НСПД'; }, 'cadx'],
            sat: [satRun, SATS.map(function (x) { return 'ppSatB_' + x.k; }), function () { return D.sat && Object.keys(D.sat).length ? '' : 'не удалось получить данные снимка'; }, 'sat']
        };
        var launch = function (k, again) {
            var d = defs[k];
            if (again) { delete D[d[3]]; d[1].forEach(function (id) { var el = document.getElementById(id); if (el) el.innerHTML = SPIN; }); stSet(k, 'load'); }
            return wrap(k, d[0](gj, tok), d[2]).catch(function (e) {
                if (k === 'soil') { soilFail(e); return; }
                console.warn('Паспорт:', e); var el = document.getElementById(d[1][0]); if (el) el.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>';
            });
        };
        var auto = function (k) {   // вместо ручного «обновить»: после паузы раздел с ошибкой загружается заново (до трёх попыток)
            var el = document.querySelector('#ppSt [data-st="' + k + '"]');
            if (tok !== seq || !el || !/\berr\b/.test(el.className) || /слишком большой/.test(lastErr[k] || '')) return;
            var n = tries[k] || 0; if (n >= RETRY_WAIT.length) return;
            tries[k] = n + 1;
            setTimeout(function () {
                if (tok !== seq) return;
                var el2 = document.querySelector('#ppSt [data-st="' + k + '"]'); if (!el2 || !/\berr\b/.test(el2.className)) return;   // уже обновили вручную
                launch(k, true).then(function () { if (tok === seq) { summary(); auto(k); } });
            }, RETRY_WAIT[n]);
        };
        var jobs = ['soil', 'elev', 'log', 'clim', 'wx', 'cad'].concat(D.satSel ? ['sat'] : []).map(function (k) { return launch(k).then(function () { auto(k); }); });
        retry = function (k) {   // повтор одного раздела по клику на его плашку статуса
            if (tok !== seq) return;
            if (k === 'addr') { stSet('addr', 'load'); var ad = document.getElementById('ppAddr'); if (ad) ad.textContent = 'определяется…'; address(D.c, tok); return; }
            if (!defs[k] || (k === 'sat' && !D.satSel)) return;
            tries[k] = 0; launch(k, true).then(function () { if (tok === seq) { summary(); auto(k); } });
        };
        Promise.all(jobs).then(function () { if (tok === seq) summary(); });
    }
    window.ppShow = function (gj, meta) {   // открыть паспорт для заданного контура (сохранённый отчёт)
        forced = { gj: gj, meta: meta || {} }; keep = true;
        var app = document.querySelector('#map-section .app-container');
        app.classList.add('passport-open'); document.dispatchEvent(new Event('passport-open'));
    };
    // пока панель раскрывается (анимация клипа с боковой колонки на всю область), старое содержимое паспорта было видно «сплюснутым» — прячем его до готовности нового
    var waitT = 0, waitEl = function () { return body.closest('.pp') || body; };
    function unwait() { clearTimeout(waitT); waitEl().style.visibility = ''; }
    document.addEventListener('passport-open', function () { waitEl().style.visibility = 'hidden'; clearTimeout(waitT); waitT = setTimeout(unwait, 2500); if (!keep) forced = null; keep = false; setTimeout(render, 380); });   // после анимации раскрытия панели
    document.addEventListener('click', function (e) {   // плашка раздела с ошибкой: обновляется только он
        var c = e.target.closest && e.target.closest('#ppSt .pp-stc.err');
        if (c && retry) retry(c.getAttribute('data-st'));
    });
    var bR = document.getElementById('ppRefresh'); if (bR) bR.addEventListener('click', render);
    // ---------- «Весь паспорт в PDF»: печатается ровно то, что видно на сайте ----------
    // Паспорт на время печати переносится в отдельный контейнер той же ширины, размер страницы = размер паспорта на экране
    // (одна длинная страница), цвета и фон сохраняются, свёрнутые/развёрнутые блоки остаются как на экране. В окне печати — «Сохранить как PDF».
    // Медиазапросы по ширине в режиме печати считаются по ширине бумаги, а не экрана, и сломали бы раскладку:
    // на время печати фиксируем, какие из них сработали на экране (сработавшие — «всегда», остальные — «никогда»).
    function freezeMedia() {
        var saved = [];
        Array.prototype.forEach.call(document.styleSheets, function (ss) {
            var rules; try { rules = ss.cssRules; } catch (e) { return; }   // чужие таблицы стилей (CDN) недоступны
            (function walk(list) {
                Array.prototype.forEach.call(list, function (r) {
                    if (r.media && r.conditionText !== undefined && !/print/.test(r.media.mediaText)) {
                        var txt = r.media.mediaText;
                        if (/width|height|aspect-ratio|orientation|screen/.test(txt)) {
                            try { var on = window.matchMedia(txt).matches; saved.push([r, txt]); r.media.mediaText = on ? 'all' : 'not all'; } catch (e) { /* пропуск */ }
                        }
                    }
                    if (r.cssRules && !r.media) walk(r.cssRules);
                });
            })(rules);
        });
        return function () { saved.forEach(function (s) { try { s[0].media.mediaText = s[1]; } catch (e) { /* правило удалено */ } }); };
    }
    function ppPdfPrint() {   // запасной вариант: печать через окно браузера (если не загрузилась библиотека для автоматического PDF)
        var pane = document.getElementById('passportPane');
        if (!pane || !pane.parentNode || document.getElementById('ppPrintHost')) return;
        var unfreeze = freezeMedia();
        var W = Math.round(pane.getBoundingClientRect().width), top = pane.scrollTop, done = false;
        var ph = document.createComment('pp-print'), host = document.createElement('div'), pg = document.createElement('style');
        host.id = 'ppPrintHost'; host.className = 'passport-open'; host.style.width = W + 'px';
        pane.parentNode.insertBefore(ph, pane); host.appendChild(pane); document.body.appendChild(host);
        document.documentElement.classList.add('pp-printing');
        pg.id = 'ppPrintPage'; document.head.appendChild(pg);
        function undo() {
            if (done) return; done = true;
            window.removeEventListener('afterprint', undo);
            if (ph.parentNode) { ph.parentNode.insertBefore(pane, ph); ph.parentNode.removeChild(ph); }
            if (host.parentNode) host.parentNode.removeChild(host);
            if (pg.parentNode) pg.parentNode.removeChild(pg);
            unfreeze();
            document.documentElement.classList.remove('pp-printing', 'pp-onepage');
            pane.scrollTop = top;
            invalidateMinis();
        }
        window.addEventListener('afterprint', undo);
        setTimeout(undo, 600000);   // страховка: браузер не прислал afterprint
        setTimeout(function () {
            invalidateMinis();
            setTimeout(function () {
                var H0 = Math.ceil(Math.max(pane.scrollHeight, host.scrollHeight) * 1.06) + 160, H = Math.min(H0, 19000);   // с запасом: при печати колонки раскладываются чуть выше, чем на экране
                  // предел размера страницы в PDF — около 200 дюймов
                if (H0 <= 19000) document.documentElement.classList.add('pp-onepage');   // всё помещается на одной странице — блоки не переносим
                pg.textContent = '@page{size:' + W + 'px ' + H + 'px;margin:0}';
                if (typeof updateStatus === 'function') updateStatus('🖨️ В окне печати выберите «Сохранить как PDF» — паспорт сохранится в том же виде, что на сайте');
                try { window.print(); } catch (e) { undo(); }
            }, 350);
        }, 120);
    }
    var bP = document.getElementById('ppPrint'); if (bP) bP.addEventListener('click', ppPdf);

    // ---------- выгрузка паспорта: PDF сразу файлом (без окна печати) и Excel (цифры, текст, карты, диаграммы) ----------
    // PDF: паспорт рисуется на холсте (html2canvas) в той же раскладке, что и на сайте (мини-карты подставляются готовыми снимками),
    // режется на страницы A4 по границам блоков и собирается в PDF прямо в браузере; файл скачивается автоматически.
    // Если библиотека не загрузилась (нет доступа к CDN) — запасной вариант: прежняя печать через окно браузера.
    var ppBusy = false;
    var H2C_URLS = ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'];
    function loadScripts(urls, ok) {
        return new Promise(function (res, rej) {
            var i = 0;
            (function next() {
                if (ok()) return res();
                if (i >= urls.length) return rej(new Error('не удалось загрузить библиотеку html2canvas'));
                var s = document.createElement('script'); s.src = urls[i++]; s.async = true;
                s.onload = function () { if (ok()) res(); else next(); };
                s.onerror = function () { s.remove(); next(); };
                document.head.appendChild(s);
            })();
        });
    }
    function needH2C() { return loadScripts(H2C_URLS, function () { return typeof window.html2canvas === 'function'; }); }
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    // текст этапов выгрузки в шапке паспорта: kind — 'busy' (крутится), 'ok' (готово), 'err' (ошибка)
    var progT = 0;
    function prog(m, kind) {
        var top = document.querySelector('#passportPane .pp-top'); if (!top) return;
        var el = document.getElementById('ppProg');
        if (!el) { el = document.createElement('span'); el.id = 'ppProg'; var h = document.getElementById('ppTitle'); if (h && h.parentNode === top) top.insertBefore(el, h.nextSibling); else top.appendChild(el); }
        clearTimeout(progT); kind = kind || 'busy';
        el.className = 'pp-prog ' + kind; el.hidden = false;
        el.innerHTML = '<i class="fas fa-' + (kind === 'ok' ? 'circle-check' : kind === 'err' ? 'triangle-exclamation' : 'spinner fa-spin') + '"></i> ' + esc(String(m).replace(/^(⏳|✅|⚠️)\s*/, ''));
        if (kind !== 'busy') progT = setTimeout(function () { el.hidden = true; }, kind === 'ok' ? 6000 : 10000);
    }
    var say = function (m, err) {
        if (typeof updateStatus === 'function') updateStatus(m, err);
        var s = String(m == null ? '' : m);
        if (/^⏳/.test(s)) prog(s, 'busy'); else if (/^✅/.test(s)) prog(s, 'ok'); else if (/^⚠️/.test(s)) prog(s, 'err');
    };
    function waitIdle(maxMs) {   // ждём, пока завершатся расчёты разделов (крутилки загрузки в блоках)
        var t0 = Date.now();
        return (function poll() {
            if (!body.querySelector('.fa-spin') || Date.now() - t0 > maxMs) return Promise.resolve();
            return sleep(400).then(poll);
        })();
    }
    function busy(btn, on, txt) {
        if (!btn) return;
        if (on) { btn._h = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + txt; }
        else { btn.disabled = false; if (btn._h != null) btn.innerHTML = btn._h; btn._h = null; }
    }
    function fileStem() {
        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        return 'pasport_' + (D.cad ? String(D.cad).replace(/[^0-9A-Za-zА-Яа-яЁё]+/g, '-') : 'uchastka') + '_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    }
    function dataBytes(url) { var bin = atob(url.split(',')[1]), u = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

    // снимок 3D-вида (MapLibre) — делается в момент отрисовки кадра
    function shot3(m) {
        return new Promise(function (res) {
            var done = false, fin = function () {
                if (done) return; done = true;
                try { var cv = m.getCanvas(); res(cv.width ? { url: cv.toDataURL('image/jpeg', 0.92), w: cv.width, h: cv.height } : null); } catch (e) { res(null); }
            };
            try { m.once('render', fin); m.triggerRepaint(); } catch (e) { fin(); }
            setTimeout(fin, 1500);
        });
    }
    // снимки всех видимых мини-карт (Leaflet) и 3D-видов
    function snapAll() {
        var out = { map: {}, m3: {} }, ps = [];
        Object.keys(minis).forEach(function (k) {
            var o = minis[k];
            try { if (o.el.clientWidth > 20 && o.el.clientHeight > 20) { var s = snap(o, true); if (s) out.map[k] = s; } } catch (e) { /* карта недоступна */ }
        });
        Object.keys(m3s).forEach(function (k) {
            var el = body.querySelector('[data-map3="' + k + '"]'); if (!el || el.clientWidth < 20) return;
            ps.push(shot3(m3s[k]).then(function (s) { if (s) out.m3[k] = s; }));
        });
        return Promise.all(ps).then(function () { return out; });
    }
    // SVG-диаграммы: вне страницы CSS-классы не действуют, поэтому вычисленные стили переносятся прямо в элементы
    var SVG_PROPS = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'paint-order', 'visibility'];
    function inlineSvg(src, dst, root) {
        var win = (src.ownerDocument && src.ownerDocument.defaultView) || window, cs = win.getComputedStyle(src), i, p, v, vals = [];
        if (!/^(title|desc|defs|stop|lineargradient|radialgradient|clippath|pattern|style)$/i.test(src.nodeName)) {
            for (i = 0; i < SVG_PROPS.length; i++) { p = SVG_PROPS[i]; if (root && p === 'opacity') continue; v = cs.getPropertyValue(p); if (v) vals.push([p, v]); }
            vals.forEach(function (x) { dst.style.setProperty(x[0], x[1]); });
        }
        for (i = 0; i < src.children.length; i++) if (dst.children[i]) inlineSvg(src.children[i], dst.children[i], false);
    }
    function svgPng(svg) {
        return new Promise(function (res) {
            try {
                var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number), r = svg.getBoundingClientRect();
                var w = vb.length === 4 && vb[2] > 0 ? vb[2] : r.width, h = vb.length === 4 && vb[3] > 0 ? vb[3] : r.height;
                if (!(w > 80 && h > 40)) return res(null);
                var cp = svg.cloneNode(true); inlineSvg(svg, cp, true);
                cp.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); cp.setAttribute('width', w); cp.setAttribute('height', h);
                if (!cp.getAttribute('viewBox')) cp.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
                var xml = new XMLSerializer().serializeToString(cp), SC = 2, im = new Image();
                im.onload = function () {
                    var c = document.createElement('canvas'); c.width = Math.round(w * SC); c.height = Math.round(h * SC);
                    var g = c.getContext('2d'); g.fillStyle = svg.classList && svg.classList.contains('pp-radar') ? '#eef2f7' : '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);   // график пригодности — на заметном фоне
                    try { res({ url: c.toDataURL('image/png'), w: w, h: h }); } catch (e) { res(null); }
                };
                im.onerror = function () { res(null); };
                im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
            } catch (e) { res(null); }
        });
    }
    var svgOk = function (s) { return !(s.closest && s.closest('.leaflet-container, button, .pp-map, .pp-i-btn')); };

    // ----- PDF: сборка многостраничного файла из JPEG-страниц -----
    function pdfPages(pages, PW, PH, title) {
        var enc = new TextEncoder(), parts = [], off = [], len = 0, n = pages.length, i;
        var add = function (x) { var u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
        var obj = function (k, s) { off[k] = len; add(k + ' 0 obj\n' + s + '\nendobj\n'); };
        var hex = ''; for (i = 0; i < title.length; i++) hex += ('000' + title.charCodeAt(i).toString(16)).slice(-4);
        add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        var kids = []; for (i = 0; i < n; i++) kids.push((4 + 3 * i) + ' 0 R');
        obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
        obj(3, '<< /Title <FEFF' + hex + '> /Producer (TerraClass) /Creator (TerraClass) >>');
        pages.forEach(function (p, k) {
            var pg = 4 + 3 * k, im = pg + 1, ct = pg + 2, cs = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im Do Q';
            obj(pg, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>');
            off[im] = len; add(im + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpg.length + ' >>\nstream\n'); add(p.jpg); add('\nendstream\nendobj\n');
            obj(ct, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
        });
        var N = 4 + 3 * n, x = len; add('xref\n0 ' + N + '\n0000000000 65535 f \n');
        for (i = 1; i < N; i++) add(String(off[i]).padStart(10, '0') + ' 00000 n \n');
        add('trailer\n<< /Size ' + N + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + x + '\n%%EOF');
        return new Blob(parts, { type: 'application/pdf' });
    }
    // границы страниц: блоки не разрезаются; spans — непрерывные «неделимые» участки [верх, низ] в px, H — полная высота, PHc — высота страницы
    function pageBreaks(spans, H, PHc) {
        var sp = spans.slice().sort(function (a, b) { return a[0] - b[0]; }), mg = [], out = [], y = 0, g = 0, k;
        sp.forEach(function (s) { var l = mg[mg.length - 1]; if (l && s[0] < l[1]) l[1] = Math.max(l[1], s[1]); else mg.push([s[0], s[1]]); });
        while (y < H - 1 && g++ < 400) {
            var lim = y + PHc;
            if (lim >= H) { out.push([y, H]); break; }
            var e = lim;
            for (k = 0; k < mg.length; k++) if (mg[k][0] < lim && mg[k][1] > lim) { if (mg[k][0] > y + PHc * 0.25) e = mg[k][0]; break; }
            out.push([y, e]); y = e;
        }
        return out;
    }
    // подготовка копии страницы для html2canvas: та же раскладка, что при печати (site.css, html.pp-printing), карты — готовыми снимками
    function prepClone(doc, W, snaps, plan) {
        var cp = doc.getElementById('passportPane'); if (!cp) return;
        var host = doc.createElement('div'), st = doc.createElement('style');
        host.id = 'ppPrintHost'; host.className = 'passport-open'; host.style.width = W + 'px';
        doc.body.appendChild(host); host.appendChild(cp);
        doc.documentElement.classList.add('pp-printing');
        st.textContent = '#passportPane .pp-cadbt{display:none!important}#passportPane .pp-cadtbl .pp-vt{max-height:none!important;overflow:visible!important;flex:0 0 auto!important}#passportPane tr.pp-cadsel td{background:inherit!important;color:inherit!important;font-weight:inherit!important}#ppBody .pp-mcol{position:static!important}#passportPane .pp-top{position:static!important;box-shadow:none!important}#passportPane .pp-dl,#passportPane .pp-bar .pp-btn,#passportPane .leaflet-control-container,#passportPane .pp-cal{display:none!important}#passportPane *{animation:none!important;transition:none!important}';
        doc.head.appendChild(st);
        var put = function (sel, s) {
            var el = cp.querySelector(sel); if (!el || !s) return;
            el.innerHTML = ''; el.style.position = 'relative'; el.style.overflow = 'hidden';
            var im = doc.createElement('img'); im.src = s.url; im.style.cssText = 'display:block;position:absolute;left:0;top:0;width:100%;height:100%';
            el.appendChild(im);
        };
        Object.keys(snaps.map).forEach(function (k) { put('[data-map="' + k + '"]', snaps.map[k]); });
        Object.keys(snaps.m3).forEach(function (k) { put('[data-map3="' + k + '"]', snaps.m3[k]); });
        Array.prototype.forEach.call(cp.querySelectorAll('svg'), function (s) { if (svgOk(s)) { try { inlineSvg(s, s, true); } catch (e) { /* пропуск */ } } });
        // участки, которые нельзя разрезать границей страницы
        var top0 = cp.getBoundingClientRect().top, spans = [], add = function (a, b) { if (b - a > 1) spans.push([a - top0, b - top0]); };
        Array.prototype.forEach.call(cp.querySelectorAll('.pp-sub, .pp-kpis, .pp-top, .pp-bar'), function (e) { var r = e.getBoundingClientRect(); add(r.top, r.bottom); });
        Array.prototype.forEach.call(cp.querySelectorAll('.pp-sec'), function (s) {   // заголовок раздела не отрывается от первого блока
            var h = s.querySelector('.pp-sec-h'), f = s.querySelector('.pp-sub'); if (!h) return;
            var a = h.getBoundingClientRect(), b = f ? f.getBoundingClientRect() : a; if (b.bottom > a.top) add(a.top, b.bottom);
        });
        plan.spans = spans; plan.H = Math.ceil(cp.getBoundingClientRect().height); plan.W = W;
    }
    function ppPdf() {
        if (ppBusy) return;
        var pane = document.getElementById('passportPane'), btn = document.getElementById('ppPrint');
        if (!pane || !body.children.length) return;
        ppBusy = true; busy(btn, true, 'PDF…');
        var top = pane.scrollTop, plan = {}, snaps = null;
        var finish = function () { ppBusy = false; busy(btn, false); try { pane.scrollTop = top; } catch (e) { /* нет */ } };
        say('⏳ Формируем PDF: паспорт собирается в файл…');
        waitIdle(60000).then(function () { return needH2C(); }).then(function () {
            pane.scrollTop = 0; return sleep(100);
        }).then(snapAll).then(function (sn) {
            snaps = sn;
            var W = Math.round(pane.getBoundingClientRect().width), He = Math.max(pane.scrollHeight, 1) * 1.12;
            var sc = Math.max(0.6, Math.min(2, Math.sqrt(36e6 / (W * He)), 30000 / He));
            var bg = '#f8fafc'; try { var c = getComputedStyle(pane).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') bg = c; } catch (e) { /* по умолчанию */ }
            return window.html2canvas(pane, {
                scale: sc, useCORS: true, allowTaint: false, backgroundColor: bg, logging: false, imageTimeout: 20000,
                windowWidth: window.innerWidth, windowHeight: window.innerHeight, scrollX: 0, scrollY: 0,
                onclone: function (doc) { try { prepClone(doc, W, snaps, plan); } catch (e) { console.warn('Паспорт PDF: подготовка копии', e); } }
            }).then(function (big) { return { big: big, W: W, bg: bg }; });
        }).then(function (r) {
            var big = r.big, W = plan.W || r.W, H = plan.H || Math.round(big.height / (big.width / W)), k = big.width / W;
            var PWp = 595.28, PHp = 841.89, padT = 12, foot = 26, pageH = Math.round(W * PHp / PWp), PHc = pageH - padT - foot;
            var br = pageBreaks(plan.spans || [], H, PHc), pages = [], d = new Date();
            br.forEach(function (b, i) {
                var cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(pageH * k);
                var g = cv.getContext('2d'); g.fillStyle = r.bg; g.fillRect(0, 0, cv.width, cv.height);
                var sy = Math.round(b[0] * k), sh = Math.min(Math.round((b[1] - b[0]) * k), big.height - sy);
                if (sh > 0) g.drawImage(big, 0, sy, big.width, sh, 0, Math.round(padT * k), big.width, sh);
                g.fillStyle = '#64748b'; g.font = Math.round(11 * k) + 'px sans-serif'; g.textBaseline = 'middle';
                g.fillText('Паспорт участка' + (D.cad ? ' № ' + D.cad : '') + ' · TerraClass · ' + d.toLocaleDateString('ru-RU'), Math.round(26 * k), Math.round((pageH - foot / 2) * k));
                g.textAlign = 'right'; g.fillText('стр. ' + (i + 1) + ' из ' + br.length, Math.round((W - 26) * k), Math.round((pageH - foot / 2) * k));
                pages.push({ jpg: dataBytes(cv.toDataURL('image/jpeg', 0.9)), w: cv.width, h: cv.height });
                cv.width = cv.height = 0;
            });
            big.width = big.height = 0;
            save(pdfPages(pages, PWp, PHp, 'Паспорт участка' + (D.cad ? ' № ' + D.cad : '')), fileStem() + '.pdf');
            say('✅ PDF сформирован и скачан (страниц: ' + pages.length + ')');
            finish();
        }).catch(function (e) {
            console.warn('Паспорт PDF:', e); finish();
            say('⚠️ Не удалось собрать PDF автоматически (' + (e && e.message || e) + ') — открываю окно печати: выберите «Сохранить как PDF»', true);
            ppPdfPrint();
        });
    }

    // ----- Excel: собственный упаковщик XLSX (zip без сжатия), листы по разделам, карты и диаграммы — картинками -----
    var CRC_T = null;
    function crc32(u) {
        if (!CRC_T) { CRC_T = []; for (var n = 0, c, k; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
        var c2 = 0xFFFFFFFF, i; for (i = 0; i < u.length; i++) c2 = CRC_T[(c2 ^ u[i]) & 255] ^ (c2 >>> 8); return (c2 ^ 0xFFFFFFFF) >>> 0;
    }
    function zipStore(files) {
        var enc = new TextEncoder(), parts = [], cen = [], off = 0, dt = new Date();
        var dd = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate(), tt = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1);
        files.forEach(function (f) {
            var nm = enc.encode(f.n), d = typeof f.d === 'string' ? enc.encode(f.d) : f.d, crc = crc32(d);
            var h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
            h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, tt, true); h.setUint16(12, dd, true);
            h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
            c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, tt, true); c.setUint16(14, dd, true);
            c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
            parts.push(new Uint8Array(h.buffer), nm, d); cen.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + d.length;
        });
        var cl = 0, e = new DataView(new ArrayBuffer(22)); cen.forEach(function (u) { cl += u.length; });
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cl, true); e.setUint32(16, off, true);
        return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
    var xcol = function (i) { var s = '', m; i++; while (i > 0) { m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    var xe = function (s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var XNS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', RNS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    var XHD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    function Styles() {
        var fonts = ['<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
        var borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], nfs = [], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], cache = {};
        var reg = function (list, x) { var i = list.indexOf(x); if (i < 0) { list.push(x); i = list.length - 1; } return i; };
        var LN = function (t) { return '<' + t + ' style="thin"><color rgb="FFCBD5E1"/></' + t + '>'; };
        this.get = function (o) {   // o: b, i, sz, color, fill, border, wrap, h (выравнивание), nf (формат числа)
            var key = JSON.stringify(o); if (cache[key] != null) return cache[key];
            var f = reg(fonts, '<font>' + (o.b ? '<b/>' : '') + (o.i ? '<i/>' : '') + '<sz val="' + (o.sz || 10) + '"/>' + (o.color ? '<color rgb="FF' + o.color + '"/>' : '') + '<name val="Calibri"/><family val="2"/></font>');
            var fl = o.fill ? reg(fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + o.fill + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
            var bd = o.border ? reg(borders, '<border>' + LN('left') + LN('right') + LN('top') + LN('bottom') + '<diagonal/></border>') : 0;
            var nf = 0; if (o.nf) { var ni = nfs.indexOf(o.nf); if (ni < 0) { nfs.push(o.nf); ni = nfs.length - 1; } nf = 164 + ni; }
            xfs.push('<xf numFmtId="' + nf + '" fontId="' + f + '" fillId="' + fl + '" borderId="' + bd + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="' + (o.v || 'top') + '"' + (o.h ? ' horizontal="' + o.h + '"' : '') + (o.wrap ? ' wrapText="1"' : '') + '/></xf>');
            return (cache[key] = xfs.length - 1);
        };
        this.xml = function () {
            return XHD + '<styleSheet ' + XNS + '>' + (nfs.length ? '<numFmts count="' + nfs.length + '">' + nfs.map(function (c, i) { return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xe(c) + '"/>'; }).join('') + '</numFmts>' : '') +
                '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="' + fills.length + '">' + fills.join('') + '</fills><borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
                '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
                '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
        };
    }
    var COLW = [38, 17, 17, 17, 17, 2];   // A–E — данные, F — отступ, дальше (G…) — картинки
    var IMG_COL = 6;
    function Sheet(name, tab) { this.name = name; this.tab = tab; this.rows = []; this.hts = []; this.merges = []; this.imgs = []; }
    Sheet.prototype.add = function (cells, ht) {   // cells: [{v, s, span}] → номер строки (с 0)
        var r = this.rows.length; this.rows.push(cells); this.hts.push(ht || 15);
        var c = 0; cells.forEach(function (x) { if (x.span > 1) this.merges.push(xcol(c) + (r + 1) + ':' + xcol(c + x.span - 1) + (r + 1)); c += x.span || 1; }, this);
        return r;
    };
    var shiftRef = function (ref) { return String(ref).replace(/([A-Z]+)(\d+)/g, function (m, l, n) { var k = 0, i; for (i = 0; i < l.length; i++) k = k * 26 + l.charCodeAt(i) - 64; return xcol(k) + n; }); };   // сдвиг ссылки на один столбец вправо
    Sheet.prototype.xml = function (drawRid) {
        var self = this, mx = 0, rowsX = this.rows.map(function (cells, r) {
            var c = 1, cx = '';   // столбец A — пустой узкий отступ
            cells.forEach(function (x) {
                var sp = x.span || 1, i, ref = xcol(c) + (r + 1);
                if (x.v == null || x.v === '') cx += '<c r="' + ref + '" s="' + x.s + '"/>';
                else if (typeof x.v === 'number') cx += '<c r="' + ref + '" s="' + x.s + '"><v>' + x.v + '</v></c>';
                else cx += '<c r="' + ref + '" s="' + x.s + '" t="inlineStr"><is><t xml:space="preserve">' + xe(String(x.v).slice(0, 32000)) + '</t></is></c>';
                for (i = 1; i < sp; i++) cx += '<c r="' + xcol(c + i) + (r + 1) + '" s="' + x.s + '"/>';
                c += sp;
            });
            mx = Math.max(mx, c);
            return '<row r="' + (r + 1) + '" ht="' + self.hts[r] + '" customHeight="1">' + cx + '</row>';
        }).join('');
        return XHD + '<worksheet ' + XNS + ' ' + RNS + '><sheetPr>' + (this.tab ? '<tabColor rgb="FF' + this.tab + '"/>' : '') + '<pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + xcol(Math.max(mx, 1) - 1) + Math.max(this.rows.length, 1) + '"/>' +
            '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
            '<cols>' + [2].concat(this.colw || COLW).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' +
            '<sheetData>' + rowsX + '</sheetData>' + (this.af ? '<autoFilter ref="' + shiftRef(this.af) + '"/>' : '') + (this.merges.length ? '<mergeCells count="' + this.merges.length + '">' + this.merges.map(function (m) { return '<mergeCell ref="' + shiftRef(m) + '"/>'; }).join('') + '</mergeCells>' : '') +
            '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' + (drawRid ? '<drawing r:id="' + drawRid + '"/>' : '') + '</worksheet>';
    };
    function buildXlsx(sheets, ST) {
        var files = [], ct = '', wbS = '', wbR = '', media = 0, dn = 0;
        sheets.forEach(function (sh, i) {
            var n = i + 1, drawRid = null;
            if (sh.imgs.length) {
                dn++; drawRid = 'rId1';
                var dx = '', dr = '';
                sh.imgs.forEach(function (im, k) {
                    media++; var ext = im.ext, nm = 'image' + media + '.' + ext, cx = Math.round(im.w * 9525), cy = Math.round(im.h * 9525);
                    files.push({ n: 'xl/media/' + nm, d: im.bytes });
                    dr += '<Relationship Id="rId' + (k + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + nm + '"/>';
                    dx += '<xdr:oneCellAnchor><xdr:from><xdr:col>' + ((im.col != null ? im.col : sh.imgCol != null ? sh.imgCol : IMG_COL) + 1) + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + im.row + '</xdr:row><xdr:rowOff>' + Math.round(im.off * 9525) + '</xdr:rowOff></xdr:from><xdr:ext cx="' + cx + '" cy="' + cy + '"/>' +
                        '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (k + 2) + '" name="Рисунок ' + (k + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + (k + 1) + '"/>' + (im.crop ? '<a:srcRect l="' + im.crop[0] + '" t="' + im.crop[1] + '" r="' + im.crop[2] + '" b="' + im.crop[3] + '"/>' : '') + '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
                        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
                });
                files.push({ n: 'xl/drawings/drawing' + dn + '.xml', d: XHD + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' + RNS + '>' + dx + '</xdr:wsDr>' });
                files.push({ n: 'xl/drawings/_rels/drawing' + dn + '.xml.rels', d: XHD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + dr + '</Relationships>' });
                files.push({ n: 'xl/worksheets/_rels/sheet' + n + '.xml.rels', d: XHD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + dn + '.xml"/></Relationships>' });
                ct += '<Override PartName="/xl/drawings/drawing' + dn + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
            }
            files.push({ n: 'xl/worksheets/sheet' + n + '.xml', d: sh.xml(drawRid) });
            ct += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
            wbS += '<sheet name="' + xe(sh.name) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
            wbR += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
        });
        var ns = sheets.length;
        wbR += '<Relationship Id="rId' + (ns + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
        files.unshift({ n: 'xl/_rels/workbook.xml.rels', d: XHD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbR + '</Relationships>' });
        files.unshift({ n: 'xl/workbook.xml', d: XHD + '<workbook ' + XNS + ' ' + RNS + '><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>' + wbS + '</sheets></workbook>' });
        files.unshift({ n: '_rels/.rels', d: XHD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
        files.unshift({ n: '[Content_Types].xml', d: XHD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ct + '</Types>' });
        files.push({ n: 'xl/styles.xml', d: ST.xml() });
        return zipStore(files);
    }

    // ----- Excel: разбор разметки паспорта на строки таблицы -----
    var WS = /[\s\u00A0\u202F]+/g, norm = function (s) { return String(s == null ? '' : s).replace(WS, ' ').trim(); };
    var SKIP_N = /^(script|style|title|svg|button|i|canvas|img|template|noscript)$/i;
    var SKIP_S = '.pp-cadtbl, .pp-cadcharts, .pp-dl, .pp-legbar, .pp-legsrc, .pp-cal, .leaflet-container, .pp-i-btn, .pp-h-btn, [data-pp-all], .pp-mapw .pp-map';
    function tx(e) {   // текст одной строкой; вложенное em — в скобках
        var s = '';
        (function w(n) {
            if (n.nodeType === 3) { s += n.nodeValue; return; }
            if (n.nodeType !== 1 || SKIP_N.test(n.nodeName)) return;
            var nm = n.nodeName.toLowerCase();
            if (nm === 'em') { var t = norm(n.textContent); if (t) s += ' (' + t + ') '; return; }
            var blk = /^(div|p|li|br|td|th|tr|small|b|u|s|h\d)$/.test(nm); if (blk) s += ' ';
            Array.prototype.forEach.call(n.childNodes, w); if (blk) s += ' ';
        })(e);
        return norm(s).replace(/ \)/g, ')').replace(/\( /g, '(');
    }
    var BLOCKQ = 'div,p,ul,ol,table,svg,section,h3,h4,h5,li';
    function kidsOf(n) { return Array.prototype.filter.call(n.children, function (c) { return !SKIP_N.test(c.nodeName) && !(c.matches && c.matches(SKIP_S)); }); }
    function rowsOf(root, out) {
        (function walk(n) {
            if (n.nodeType !== 1) return;
            var nm = n.nodeName.toLowerCase();
            if (SKIP_N.test(nm) || n.matches(SKIP_S)) return;
            if (n.matches('.pp-leg2')) { var ls = Array.prototype.map.call(n.querySelectorAll('.pp-legl span'), tx).filter(Boolean); if (ls.length) out.push({ c: ['Шкала карты', ls.join(' … ')], kv: true }); return; }
            if (n.matches('.pp-tiles')) { Array.prototype.forEach.call(n.children, function (t) { var a = Array.prototype.map.call(t.children, tx); if (a.filter(Boolean).length) out.push({ c: a.filter(function (x, i) { return x || i < 2; }), kv: true }); }); return; }
            if (nm === 'table') { Array.prototype.forEach.call(n.rows || n.querySelectorAll('tr'), function (tr) { var a = Array.prototype.map.call(tr.cells || tr.children, tx); if (a.some(Boolean)) out.push({ c: a, head: !!tr.querySelector('th'), kv: a.length <= 3 }); }); return; }
            if (nm === 'ul' || nm === 'ol') { Array.prototype.forEach.call(n.children, function (li) { var t = tx(li); if (t) out.push({ c: [t] }); }); return; }
            if (n.matches('.pp-mt2')) { var lo = Array.prototype.map.call(n.querySelectorAll('.l span'), tx); if (lo.length) out.push({ c: ['Шкала', lo.join(' … ')], kv: true }); return; }
            if (n.matches('.pp-ch')) {
                var h = n.querySelector('h5'), cap = n.querySelector('.pp-cap'), sv = n.querySelectorAll('svg'), tt = [], tl = [];
                if (h) out.push({ c: [tx(h)], sub: true });
                kidsOf(n).forEach(function (c) { if (c !== h && c !== cap && !/^svg$/i.test(c.nodeName)) walk(c); });
                Array.prototype.forEach.call(sv, function (s) {
                    var ti = Array.prototype.map.call(s.querySelectorAll('title'), function (t) { return norm(t.textContent); }).filter(Boolean);
                    if (ti.length) tt = tt.concat(ti); else tl = tl.concat(Array.prototype.map.call(s.querySelectorAll('text'), function (t) { return norm(t.textContent); }).filter(Boolean));
                });
                tt.forEach(function (t) { var k = t.lastIndexOf(': '); out.push({ c: k > 0 ? [t.slice(0, k), t.slice(k + 2)] : [t], kv: true }); });
                if (!tt.length && tl.length) out.push({ c: ['Подписи диаграммы', tl.join('; ').slice(0, 400)], kv: true });
                if (cap) { var ct = tx(cap); if (ct) out.push({ c: [ct], note: true }); }
                return;
            }
            var ec = kidsOf(n), direct = Array.prototype.some.call(n.childNodes, function (x) { return x.nodeType === 3 && norm(x.nodeValue); });
            if (!ec.length) { var t0 = tx(n); if (t0) out.push({ c: [t0] }); return; }
            var cellLike = ec.every(function (c) { return !c.querySelector(BLOCKQ) && !/^(table|ul|ol|svg)$/i.test(c.nodeName); });   // таблица/список внутри — не «ячейка»: строки идут по одной
            var asRows = ec.length > 1 && ec.every(function (c) { return kidsOf(c).filter(function (x) { return tx(x); }).length >= 2; });   // список строк: каждая — своя строка таблицы
            if (cellLike && !asRows) {
                var ne = ec.filter(function (c) { return tx(c); });
                if (direct || ne.length < 2) { var t1 = tx(n); if (t1) out.push({ c: [t1] }); }
                else out.push({ c: ne.map(tx), kv: ne.length <= 3 });
                return;
            }
            Array.prototype.forEach.call(n.childNodes, function (c) {
                if (c.nodeType === 3) { var t2 = norm(c.nodeValue); if (t2) out.push({ c: [t2] }); } else walk(c);
            });
        })(root);
        return out;
    }
    var NUMRE = /^([−\-+]?\d+(?:[\u00A0\u202F\s]\d{3})*(?:[.,]\d+)?)\s*([^\d\s][^\d]{0,22})?$/;
    function parseNum(s) {   // «12 345,6 га» → {n: 12345.6, u: 'га'}
        var m = NUMRE.exec(String(s).trim()); if (!m) return null;
        var raw = m[1].replace(/[\u00A0\u202F\s]/g, '').replace('−', '-').replace(',', '.');
        if (/^[-+]?0\d/.test(raw)) return null;
        var n = parseFloat(raw), u = (m[2] || '').trim(); if (!isFinite(n) || /["\\;]/.test(u)) return null;
        return { n: n, u: u };
    }
    var lineH = function (s, w) { var l = 0; String(s).split('\n').forEach(function (p) { l += Math.max(1, Math.ceil(p.length / (w * 1.1))); }); return Math.max(15, l * 13 + 3); };
    var AW = function (a, b) { var w = 0, i; for (i = a; i < b; i++) w += COLW[i]; return w; };
    function xlsxRows(sh, ST, rows, accent) {   // выводит строки блока в лист; возвращает число добавленных строк
        var st = {
            lab: ST.get({ b: 1, wrap: 1, border: 1 }), txt: ST.get({ wrap: 1, border: 1 }), head: ST.get({ b: 1, wrap: 1, border: 1, fill: 'E2E8F0' }),
            note: ST.get({ i: 1, wrap: 1, color: '64748B' }), sub: ST.get({ b: 1, color: accent || '334155', sz: 10 })
        };
        var cnt = 0;
        rows.forEach(function (r) {
            var c = r.c.slice(0, 5);
            if (r.c.length > 5) c[4] = r.c.slice(4).join(' · ');
            if (r.sub) { sh.add([{ v: c[0], s: st.sub, span: 5 }]); cnt++; return; }
            if (r.note) { sh.add([{ v: c[0], s: st.note, span: 5 }], lineH(c[0], AW(0, 5))); cnt++; return; }
            var cells = [], ht = 15, n = c.length, col = 0;
            c.forEach(function (v, i) {
                var pn = i > 0 && !r.head ? parseNum(v) : null, last = i === n - 1, span = last && !pn ? Math.max(1, 5 - col) : 1, s = st.txt, val = v;
                if (pn) { val = pn.n; s = ST.get({ border: 1, h: 'right', nf: pn.u ? 'General"' + (/^[%°′″‰]/.test(pn.u) ? '' : ' ') + pn.u + '"' : undefined }); }
                else if (r.head) s = st.head;
                else if (i === 0 && r.kv && n > 1) s = st.lab;
                cells.push({ v: val, s: s, span: span });
                ht = Math.max(ht, lineH(typeof val === 'number' ? '' : val, AW(col, col + span)));
                col += span;
            });
            sh.add(cells, ht); cnt++;
        });
        return cnt;
    }
    function bannerRow(sh, ST, text, color, sz) { return sh.add([{ v: text, s: ST.get({ b: 1, color: 'FFFFFF', fill: color || '334155', sz: sz || 11, v: 'center', wrap: 1 }), span: 5 }], sz > 12 ? 24 : 20); }
    function addImgs(sh, startRow, list) {   // картинки столбиком справа от строк блока; при нехватке высоты добавляются пустые строки
        if (!list.length) return;
        var y = 0, gap = 8, need = 0; list.forEach(function (im) { need += im.h + gap; });
        var have = function () { var t = 0, r; for (r = startRow; r < sh.hts.length; r++) t += sh.hts[r] * 4 / 3; return t; };
        while (have() < need) sh.add([], 15);
        list.forEach(function (im) {
            var r = startRow, acc = 0, h;
            while (r < sh.hts.length) { h = sh.hts[r] * 4 / 3; if (acc + h > y) break; acc += h; r++; }
            im.row = r; im.off = y - acc; sh.imgs.push(im); y += im.h + gap;
        });
    }
    function imgSq(s, w) {   // квадратная картинка листа: широкая карта обрезается по центру средствами Excel (srcRect)
        var side = Math.min(s.w, s.h), dw = Math.round(Math.min(w, Math.max(side * 1.2, 260)));
        var cl = s.w > s.h ? Math.round((s.w - s.h) / 2 / s.w * 100000) : 0, ct = s.h > s.w ? Math.round((s.h - s.w) / 2 / s.h * 100000) : 0;
        return { bytes: dataBytes(s.url), ext: /^data:image\/png/.test(s.url) ? 'png' : 'jpeg', w: dw, h: dw, crop: [cl, ct, cl, ct] };
    }
    function imgOf(s, w) {   // {url, w, h} → картинка листа; w — предельная ширина на листе, px
        var dw = Math.min(w, Math.max(s.w * 1.2, 260));
        return { bytes: dataBytes(s.url), ext: /^data:image\/png/.test(s.url) ? 'png' : 'jpeg', w: Math.round(dw), h: Math.round(s.h * dw / s.w) };
    }
    function secColor(sec) { var m = /--ac:\s*(#[0-9a-fA-F]{6})/.exec(sec.getAttribute('style') || ''); return m ? m[1].slice(1).toUpperCase() : '334155'; }
    function buildSections(ST, snaps) {
        var sheets = [], used = {}, secs = body.querySelectorAll('section.pp-sec');
        var uniq = function (nm) { nm = nm.replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31); var b = nm, i = 2; while (used[nm.toLowerCase()]) nm = b.slice(0, 28) + ' ' + (i++); used[nm.toLowerCase()] = 1; return nm; };
        var imgW = 440, lgSheet = false;   // предельная ширина картинок листа, px; на листе «Логистика» карта крупная, квадратная и стоит слева
        var imgsFor = function (sub) {
            var out = [];
            Array.prototype.forEach.call(sub.querySelectorAll('[data-map], [data-map3], svg'), function (e) {
                var s = null;
                if (e.hasAttribute('data-map')) s = snaps.map[e.getAttribute('data-map')];
                else if (e.hasAttribute('data-map3')) s = snaps.m3[e.getAttribute('data-map3')];
                else if (e._ppImg && svgOk(e)) s = e._ppImg;
                if (s) out.push(lgSheet && e.hasAttribute('data-map') ? imgSq(s, imgW) : imgOf(s, imgW));
            });
            return out;
        };
        Array.prototype.forEach.call(secs, function (sec, idx) {
            var h3 = sec.querySelector('.pp-sec-h h3'), p = sec.querySelector('.pp-sec-h p'), nn = sec.querySelector('.pp-n'), color = secColor(sec);
            var num = nn ? norm(nn.textContent) : String(idx + 1), title = h3 ? tx(h3) : 'Раздел ' + num;
            lgSheet = /Логистик/i.test(title); imgW = 440;
            var sh = new Sheet(uniq(num + ' ' + title), color);
            sh.add([{ v: num + '. ' + title, s: ST.get({ b: 1, sz: 16, color: color }), span: 5 }], 26);
            if (p && tx(p)) sh.add([{ v: tx(p), s: ST.get({ i: 1, color: '64748B', wrap: 1 }), span: 5 }], lineH(tx(p), AW(0, 5)));
            sh.add([]);
            var emit = function (blk, loose) {
                var ttl = '', info = [];
                if (!loose) {
                    var hh = blk.querySelector('.pp-sub-h h4'); ttl = hh ? tx(hh) : '';
                    Array.prototype.forEach.call(blk.querySelectorAll('.pp-info > div'), function (d) { var b = d.querySelector('b'), l = b ? tx(b) : '', t = tx(d); if (l && t.indexOf(l) === 0) t = t.slice(l.length).trim(); if (t) info.push([l, t]); });
                }
                if (ttl) bannerRow(sh, ST, ttl, color, 11);
                var imgs = imgsFor(blk);
                if (lgSheet && imgs.length) { imgs.forEach(function (im) { im.col = 0; }); addImgs(sh, sh.rows.length, imgs); }   // карта — слева, в первом столбце, текст ниже
                var start = sh.rows.length;
                var rr = rowsOf(loose ? blk : (blk.querySelector('.pp-mc') || blk), []);
                // расшифровка — серым курсивом, данные — таблицей
                info.forEach(function (x) { sh.add([{ v: x[0], s: ST.get({ b: 1, color: '64748B', wrap: 1 }) }, { v: x[1], s: ST.get({ i: 1, color: '64748B', wrap: 1 }), span: 4 }], lineH(x[1], AW(1, 5))); });
                xlsxRows(sh, ST, rr, color);
                if (!loose && blk.querySelector('.pp-cadtbl')) sh.add([{ v: 'Список участков с площадями, видом использования и правами — на листе «Кадастр».', s: ST.get({ i: 1, color: '64748B', wrap: 1 }), span: 5 }], 30);
                if (!(lgSheet && imgs.length)) addImgs(sh, start, imgs);
                sh.add([]);
            };
            (function walkSec(n) {
                Array.prototype.forEach.call(n.children, function (c) {
                    if (c.matches('.pp-sub')) emit(c, false);
                    else if (c.querySelector('.pp-sub')) walkSec(c);
                    else if (tx(c) && !c.matches('.pp-sec-h')) emit(c, true);
                });
            })(sec.querySelector('.pp-sec-b') || sec);
            sheets.push(sh);
        });
        if (D.cadx && D.cadx.items.length) sheets.splice(1, 0, cadSheet(ST, snaps));
        return sheets;
    }
    function buildCover(ST, secSheets, snaps) {
        var sh = new Sheet('Паспорт', '1E293B'), t = document.getElementById('ppTitle'), ad = document.getElementById('ppAddr'), d = new Date();
        var lab = ST.get({ b: 1, border: 1, wrap: 1 }), val = ST.get({ border: 1, wrap: 1 }), num = ST.get({ border: 1, h: 'right' });
        sh.add([{ v: t ? norm(t.textContent) : 'Паспорт участка', s: ST.get({ b: 1, sz: 18, color: '1E293B' }), span: 5 }], 30);
        sh.add([{ v: 'Выгрузка сформирована ' + d.toLocaleString('ru-RU') + ' · TerraClass', s: ST.get({ i: 1, color: '64748B' }), span: 5 }]);
        sh.add([]);
        var kv = function (k, v, unit) {
            if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return;
            if (typeof v === 'number') sh.add([{ v: k, s: lab }, { v: v, s: ST.get({ border: 1, h: 'right', nf: unit ? 'General"' + (unit === '°' ? '' : ' ') + unit + '"' : undefined }) }]);
            else sh.add([{ v: k, s: lab }, { v: v, s: val, span: 4 }], lineH(v, AW(1, 5)));
        };
        var i0 = sh.rows.length;
        bannerRow(sh, ST, 'Общие сведения', '334155', 11);
        kv('Кадастровый номер', D.cad || '');
        kv('Адрес (определён по центру)', ad ? norm(ad.textContent) : '');
        kv('Площадь', D.area ? D.area / 1e4 : null, 'га');
        if (D.c) { kv('Центр, широта', D.c[1], '°'); kv('Центр, долгота', D.c[0], '°'); }
        if (D.satSel && D.satSel.day) kv('Дата снимка Sentinel-2', satDay(D.satSel.day));
        sh.add([]);
        var covImgs = [], gm = snaps && snaps.map.gen, rs = document.querySelector('#ppKpi .pp-score svg');
        if (gm) covImgs.push(imgOf(gm, 360));
        if (rs && rs._ppImg) covImgs.push(imgOf(rs._ppImg, 300));
        var sc = null; try { sc = scores(); } catch (e) { /* нет данных */ }
        if (sc) {
            bannerRow(sh, ST, 'Индекс пригодности участка (0–100)', '059669', 11);
            sh.add([{ v: 'Фактор', s: ST.get({ b: 1, border: 1, fill: 'E2E8F0' }) }, { v: 'Оценка', s: ST.get({ b: 1, border: 1, fill: 'E2E8F0', h: 'right' }) }, { v: 'Основание', s: ST.get({ b: 1, border: 1, fill: 'E2E8F0' }), span: 3 }]);
            var ok = sc.filter(function (x) { return x.v != null; });
            sc.forEach(function (x) { sh.add([{ v: x.l, s: lab }, { v: x.v == null ? 'н/д' : Math.round(x.v), s: num }, { v: x.b, s: val, span: 3 }], lineH(x.b, AW(2, 5))); });
            if (ok.length) sh.add([{ v: 'Итоговый индекс', s: ST.get({ b: 1, border: 1, fill: 'DCFCE7' }) }, { v: Math.round(avg(ok.map(function (x) { return x.v; }))), s: ST.get({ b: 1, border: 1, fill: 'DCFCE7', h: 'right' }) }, { v: 'среднее по доступным факторам', s: ST.get({ i: 1, border: 1, fill: 'DCFCE7' }), span: 3 }]);
            sh.add([]);
        }
        var kp = document.getElementById('ppKpi');
        if (kp) {
            var kr = []; Array.prototype.forEach.call(kp.querySelectorAll('.pp-kpi'), function (k) { var a = Array.prototype.map.call(k.children, tx); if (a[1]) kr.push({ c: [a[0], a[1], a[2] || ''], kv: true }); });
            if (kr.length) { bannerRow(sh, ST, 'Ключевые показатели', '2563EB', 11); xlsxRows(sh, ST, kr, '2563EB'); sh.add([]); }
        }
        var sm = document.getElementById('ppSum');
        if (sm) { var sr = rowsOf(sm, []); if (sr.length) { bannerRow(sh, ST, 'Автоматические выводы', 'EA580C', 11); xlsxRows(sh, ST, sr, 'EA580C'); sh.add([]); } }
        bannerRow(sh, ST, 'Листы книги', '334155', 11);
        secSheets.forEach(function (s) { sh.add([{ v: s.name, s: val, span: 5 }]); });
        sh.add([]);
        sh.add([{ v: 'Показатели предварительные, рассчитаны автоматически по открытым данным (SoilGrids, ERA5, OSM, Sentinel-2 и др.); карты и диаграммы вставлены картинками.', s: ST.get({ i: 1, color: '64748B', wrap: 1 }), span: 5 }], 30);
        addImgs(sh, i0, covImgs);
        return sh;
    }
    function ppExcel() {
        if (ppBusy) return;
        var pane = document.getElementById('passportPane'), btn = document.getElementById('ppExcel');
        if (!pane || !body.querySelector('section.pp-sec')) { say('⚠️ Нет данных паспорта для выгрузки', true); return; }
        ppBusy = true; busy(btn, true, 'Excel…');
        var top = pane.scrollTop, opened = [];
        var finish = function () {
            opened.forEach(function (s) { s.classList.remove('pp-xbg'); s.style.width = ''; s.classList.add('pp-col'); });
            if (opened.length) { invalidateMinis(); window.dispatchEvent(new Event('resize')); }
            ppBusy = false; busy(btn, false); try { pane.scrollTop = top; } catch (e) { /* нет */ }
        };
        say('⏳ Формируем Excel: собираем показатели, карты и диаграммы…');
        waitIdle(60000).then(function () {
            prog('Подготавливаем разделы и карты…');
            // свёрнутые разделы временно раскрываем: у скрытых карт нет размеров, снимок невозможен
            Array.prototype.forEach.call(body.querySelectorAll('.pp-sec.pp-col'), function (s) { var w = s.getBoundingClientRect().width; s.classList.remove('pp-col'); s.classList.add('pp-xbg'); if (w > 0) s.style.width = w + 'px'; opened.push(s); });   // раскрываем «за кадром»: экран не прыгает
            if (!opened.length) return null;
            invalidateMinis(); window.dispatchEvent(new Event('resize'));
            var t0 = Date.now();
            return sleep(900).then(function poll() {
                if (!body.querySelector('.leaflet-tile-loading') || Date.now() - t0 > 7000) return sleep(400);
                return sleep(300).then(poll);
            });
        }).then(function () { prog('Снимаем мини-карты участка…'); return sleep(40).then(snapAll); }).then(function (snaps) {
            prog('Преобразуем диаграммы в изображения…');
            var svgs = Array.prototype.filter.call(body.querySelectorAll('svg'), svgOk);
            return Promise.all(svgs.map(function (s) { return svgPng(s).then(function (r) { s._ppImg = r; }); })).then(function () { return snaps; });
        }).then(function (snaps) {
            prog('Собираем листы и таблицы…');
            return sleep(60).then(function () {
                var ST = new Styles(), secSheets = buildSections(ST, snaps), cover = buildCover(ST, secSheets, snaps);
                prog('Упаковываем файл Excel…');
                return sleep(60).then(function () {
                    save(buildXlsx([cover].concat(secSheets), ST), fileStem() + '.xlsx');
                    say('✅ Excel сформирован и скачан (листов: ' + (secSheets.length + 1) + ')');
                    finish();
                });
            });
        }).catch(function (e) {
            console.warn('Паспорт Excel:', e); finish();
            say('⚠️ Не удалось сформировать Excel: ' + (e && e.message || e), true);
        });
    }
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('#ppExcel'); if (b && !b.disabled) ppExcel(); });
    // ----- HTML: отдельная страница с тем же оформлением (стили сайта, мини-карты и 3D — снимками), скачивается файлом -----
    function ppCssText() {   // все стили страницы одним текстом; чужие таблицы (Font Awesome и др.) подключаются ссылками
        var css = [], links = [];
        Array.prototype.forEach.call(document.styleSheets, function (sh) {
            var rules, base = sh.href || location.href;
            try { rules = sh.cssRules; } catch (e) { rules = null; }
            if (!rules) { if (sh.href) links.push(sh.href); return; }
            var txt = Array.prototype.map.call(rules, function (r) { return r.cssText; }).join('\n');
            txt = txt.replace(/url\(\s*(['"]?)(?!data:|https?:|\/\/|#)([^)'"]+)\1\s*\)/g, function (m, q, u) { try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return m; } });
            css.push(txt);
        });
        return { css: css.join('\n'), links: links };
    }
    function ppHtmlBuild(pane, snaps) {
        var cp = pane.cloneNode(true), W = Math.round(pane.getBoundingClientRect().width) || 1200;
        var live = pane.querySelectorAll('svg'), dup = cp.querySelectorAll('svg');
        Array.prototype.forEach.call(live, function (s, i) { if (dup[i] && svgOk(s)) { try { inlineSvg(s, dup[i], true); } catch (e) { /* пропуск */ } } });
        var put = function (sel, s) {
            var el = cp.querySelector(sel); if (!el || !s) return;
            el.innerHTML = ''; el.style.position = 'relative'; el.style.overflow = 'hidden';
            var im = document.createElement('img'); im.src = s.url; im.style.cssText = 'display:block;position:absolute;left:0;top:0;width:100%;height:100%';
            el.appendChild(im);
        };
        Object.keys(snaps.map).forEach(function (k) { put('[data-map="' + k + '"]', snaps.map[k]); });
        Object.keys(snaps.m3).forEach(function (k) { put('[data-map3="' + k + '"]', snaps.m3[k]); });
        Array.prototype.forEach.call(cp.querySelectorAll('.leaflet-control-container, .pp-dl, .pp-cal, .pp-cadbt, #ppSt, #ppNav, .pp-top .pp-tbs, .pp-top button, [data-pp-all]'), function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
        Array.prototype.forEach.call(cp.querySelectorAll('.pp-cadsel'), function (e) { e.classList.remove('pp-cadsel'); });
        cp.removeAttribute('style');
        var cs = ppCssText(), d = new Date(), ttl = 'Паспорт участка' + (D.cad ? ' № ' + D.cad : '');
        var extra = '.pp-h-btn,.pp-prog{display:none!important}html.pp-printing,html.pp-printing body{overflow:auto!important}html.pp-printing body{padding:18px 0 30px}' +
            '#ppPrintHost .pp-cadtbl .pp-vt{max-height:none!important;overflow:visible!important;flex:0 0 auto!important}html.pp-printing #ppPrintHost{width:100%!important;max-width:' + W + 'px;margin:0 auto!important}' +
            '.pp-gen{max-width:' + W + 'px;margin:14px auto 0;padding:0 26px;color:#64748b;font:12px/1.4 system-ui,sans-serif;text-align:right}';
        var js = '(function(){document.addEventListener("click",function(e){var h=e.target.closest&&e.target.closest(".pp-sec-h");if(h){h.closest(".pp-sec").classList.toggle("pp-col");return}' +
            'var b=e.target.closest&&e.target.closest(".pp-i-btn");if(b){b.closest(".pp-sub").classList.toggle("closed")}})})();';
        return '<!DOCTYPE html>\n<html lang="ru" class="pp-printing"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>' + ttl.replace(/</g, '&lt;') + ' · TerraClass</title>' +
            cs.links.map(function (h) { return '<link rel="stylesheet" href="' + h + '">'; }).join('') +
            '<style>' + cs.css.replace(/<\/style/gi, '<\\/style') + '</style><style>' + extra + '</style></head><body>' +
            '<div id="ppPrintHost" class="passport-open">' + cp.outerHTML + '</div>' +
            '<div class="pp-gen">Сформировано в TerraClass · ' + d.toLocaleString('ru-RU') + '</div><script>' + js + '<\/script></body></html>';
    }
    function ppHtml() {
        if (ppBusy) return;
        var pane = document.getElementById('passportPane'), btn = document.getElementById('ppHtml');
        if (!pane || !body.querySelector('section.pp-sec')) { say('⚠️ Нет данных паспорта для выгрузки', true); return; }
        ppBusy = true; busy(btn, true, 'HTML…');
        var top = pane.scrollTop, opened = [];
        var finish = function () {
            opened.forEach(function (s) { s.classList.add('pp-col'); });
            if (opened.length) { invalidateMinis(); window.dispatchEvent(new Event('resize')); }
            ppBusy = false; busy(btn, false); try { pane.scrollTop = top; } catch (e) { /* нет */ }
        };
        say('⏳ Формируем HTML: собираем страницу паспорта…');
        waitIdle(60000).then(function () {
            Array.prototype.forEach.call(body.querySelectorAll('.pp-sec.pp-col'), function (s) { s.classList.remove('pp-col'); opened.push(s); });   // у скрытых карт нет размеров — снимок невозможен
            if (!opened.length) return null;
            invalidateMinis(); window.dispatchEvent(new Event('resize'));
            var t0 = Date.now();
            return sleep(900).then(function poll() {
                if (!body.querySelector('.leaflet-tile-loading') || Date.now() - t0 > 7000) return sleep(400);
                return sleep(300).then(poll);
            });
        }).then(function () { pane.scrollTop = 0; return sleep(100); }).then(snapAll).then(function (snaps) {
            var html = ppHtmlBuild(pane, snaps);
            save(new Blob([html], { type: 'text/html;charset=utf-8' }), fileStem() + '.html');
            say('✅ HTML сформирован и скачан');
            finish();
        }).catch(function (e) {
            console.warn('Паспорт HTML:', e); finish();
            say('⚠️ Не удалось сформировать HTML: ' + (e && e.message || e), true);
        });
    }
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('#ppHtml'); if (b && !b.disabled) ppHtml(); });
    document.addEventListener('passport-open', function () { setTimeout(function () { needH2C().catch(function () { /* без CDN — запасная печать */ }); }, 2500); });   // заранее подгружаем библиотеку для PDF

    // ---------- типографика: число с единицей, день с месяцем, однобуквенные предлоги и тире не разрываются переносом строки ----------
    var NB = '\u00A0', RE_UNIT = /(\d) (?=(?:°C|°|мм|см|км|м\/с|м²|м|га|дн\.|дн|ч|мин|г\/кг|кг|лет|т|ц|мг|л|₽)(?![A-Za-zА-Яа-яЁё°²]))/g,
        RE_MON = /(\d{1,2}) (?=(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/g,
        RE_DASH = / ([—–]) /g, RE_PREP = /(^|[\s(«])([ВвКкСсУуОоИиАа]) (?=\S)/g;
    function nbFix() {
        var w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
            var p = n.parentNode;
            return p && !/^(SCRIPT|STYLE|TEXTAREA|TITLE)$/i.test(p.nodeName) && !(p.closest && p.closest('svg, .leaflet-container')) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        } }), n, v, r;
        while ((n = w.nextNode())) {
            v = n.nodeValue; if (v.length < 3) continue;
            r = v.replace(RE_UNIT, '$1' + NB).replace(RE_MON, '$1' + NB).replace(RE_DASH, NB + '$1 ').replace(RE_PREP, '$1$2' + NB);
            if (r !== v) n.nodeValue = r;
        }
    }
    var nbT = 0;
    new MutationObserver(function () { clearTimeout(nbT); nbT = setTimeout(nbFix, 150); }).observe(body, { childList: true, subtree: true });
})();
