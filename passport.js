/* Паспорт участка: разделы-блоки, мини-карты, расчёты. Данные берутся из выбранной (или последней нарисованной) фигуры либо из сохранённого отчёта.
   Использует глобальные объекты карты: map, GC_SHAPES, gcSel, turf, а также мосты ppDem / ppOverpass / ppSoil из script.js. */
(function () {
    var body = document.getElementById('ppBody');
    if (!body) return;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var nf = function (v, d) { return isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: d == null ? 1 : d }) : '—'; };
    var minis = {}, m3s = {}, seq = 0, D = {}, forced = null, keep = false;   // forced — контур из сохранённого отчёта
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
    function blk(o) {
        var f = o.info;
        return '<div class="pp-sub' + (o.map ? '' : ' nomap') + '"' + (o.c ? ' style="--ac:' + o.c + '"' : '') + '><div class="pp-sub-h"><span class="pp-ic sm"><i class="fas fa-' + o.i + '"></i></span><h4>' + o.t + '</h4>' +
            '<button type="button" class="pp-i-btn"><i class="fas fa-circle-info"></i> Расшифровка</button></div>' +
            '<div class="pp-info"><div><b>Что это</b>' + f[0] + '</div><div><b>Зачем нужно</b>' + f[1] + '</div><div><b>Как рассчитывается</b>' + f[2] + '</div></div>' +
            '<div class="pp-mc">' + (o.map ? '<div class="pp-mcol">' + o.map + '</div>' : '') + '<div class="pp-dcol"' + (o.id ? ' id="' + o.id + '"' : '') + '>' + (o.body || '') + '</div></div></div>';
    }
    // квадратная карта + легенда + кнопки скачивания (extra — дополнительные кнопки)
    function mapBox(key, extra, title) {
        return '<div class="pp-mapw">' + (title ? '<div class="pp-mt">' + title + '</div>' : '') + '<div class="pp-map" data-map="' + key + '"></div><div class="pp-leg2" id="ppLeg_' + key + '"></div>' +
            '<div class="pp-dl"><button type="button" class="pp-btn pp-pdf" data-pdf="' + key + '"><i class="fas fa-file-pdf"></i> Карта в PDF</button>' + (extra || '') + '</div></div>';
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
        var n = a.length, s = '<svg viewBox="0 0 240 216" class="pp-svg pp-radar">', pt = function (r, i) { var t = (i * 360 / n - 90) * Math.PI / 180; return [120 + r * Math.cos(t), 108 + r * Math.sin(t)]; }, ptS = function (r, i) { return pt(r, i).map(function (x) { return x.toFixed(1); }).join(','); };
        [0.25, 0.5, 0.75, 1].forEach(function (f) { s += '<polygon points="' + a.map(function (_, i) { return ptS(72 * f, i); }).join(' ') + '" class="rg"/>'; });
        a.forEach(function (x, i) { var e = pt(72, i), l = pt(88, i); s += '<line x1="120" y1="108" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '" class="rg"/><text x="' + l[0].toFixed(1) + '" y="' + (l[1] + 3).toFixed(1) + '" text-anchor="middle">' + x.l + ' ' + (x.v == null ? 'н/д' : Math.round(x.v)) + '</text>'; });
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
    function dayChart(dl) {
        var W = 350, H = 150, L = 8, R = 8, T = 18, B = 22, pw = W - L - R, ph = H - T - B, bw = pw / 12, mn = Math.min.apply(null, dl), mx = Math.max.apply(null, dl), s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pp-svg">';
        dl.forEach(function (v, i) { var h = v / 24 * ph, x = L + i * bw; s += '<rect x="' + (x + 3).toFixed(1) + '" y="' + (T + ph - h).toFixed(1) + '" width="' + (bw - 6).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + mix('#3b82f6', '#f59e0b', (v - mn) / ((mx - mn) || 1)) + '"/><text x="' + (x + bw / 2).toFixed(1) + '" y="' + (T + ph - h - 4).toFixed(1) + '" text-anchor="middle">' + nf(v, 1) + '</text><text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + MON[i] + '</text>'; });
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
        return (minis[key] = { map: m, el: el, gj: gj, title: title, leg: null });
    }
    function setLeg(key, cols, lo, hi, unit) {
        var o = minis[key]; if (o) o.leg = { cols: cols, lo: lo, hi: hi, unit: unit };
        var el = document.getElementById('ppLeg_' + key); if (el) el.innerHTML = legHtml(cols, lo, hi, unit);
    }
    function addImg(key, url, bounds, op) { var o = minis[key]; if (!o) return null; return L.imageOverlay(url, bounds, { pane: 'tilePane', zIndex: 12, opacity: op || 0.85, interactive: false }).addTo(o.map); }
    function snap(o) {
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
        [['rgba(0,0,0,.55)', 5], ['#ffffff', 2.5]].forEach(function (s) {
            g.strokeStyle = s[0]; g.lineWidth = s[1];
            polysOf(o.gj).forEach(function (p) { p.forEach(function (ring) { g.beginPath(); ring.forEach(function (pt, i) { var q = o.map.latLngToContainerPoint([pt[1], pt[0]]); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); g.closePath(); g.stroke(); }); });
        });
        g.font = '600 13px sans-serif'; var tw = g.measureText(o.title).width + 18;
        g.fillStyle = 'rgba(15,23,42,.78)'; g.fillRect(8, 8, tw, 26); g.fillStyle = '#fff'; g.fillText(o.title, 17, 26);
        if (o.leg) {
            var lg = o.leg, x = 8, y = r0.height - 50, w = Math.min(190, r0.width - 40), grd = g.createLinearGradient(x + 8, 0, x + 8 + w, 0);
            lg.cols.forEach(function (cl, i) { grd.addColorStop(i / (lg.cols.length - 1), cl); });
            g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x, y, w + 16, 42); g.fillStyle = grd; g.fillRect(x + 8, y + 7, w, 10);
            g.fillStyle = '#0f172a'; g.font = '11px sans-serif'; g.fillText(lg.lo, x + 8, y + 34); g.textAlign = 'right'; g.fillText(lg.hi + ' ' + (lg.unit || ''), x + 8 + w, y + 34); g.textAlign = 'left';
        }
        g.font = '10px sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText('GeoClass · Esri World Imagery', 10, r0.height - 6);
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
        b = e.target.closest('[data-pp-all]'); if (b) { var on = body.classList.toggle('pp-none'); b.innerHTML = on ? '<i class="fas fa-eye"></i> Показать все' : '<i class="fas fa-eye-slash"></i> Скрыть все'; }
    });

    // ---------- 3D-карта (MapLibre): рельеф + снимок, при наличии heat — тепловая карта высот поверх ----------
    function mk3d(key, gj, heat) {
        var el = body.querySelector('[data-map3="' + key + '"]'); if (!el) return;
        if (typeof maplibregl === 'undefined') { el.innerHTML = '<div class="pp-ph3">MapLibre не загрузился — 3D недоступно</div>'; return; }
        var bb = turf.bbox(gj), m;
        try {
            m = new maplibregl.Map({ container: el, attributionControl: false, preserveDrawingBuffer: true, maxPitch: 80,
                style: { version: 8, sources: { img: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19 }, dem: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15 } }, layers: [{ id: 'img', type: 'raster', source: 'img' }] },
                center: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], zoom: 12 });
        } catch (err) { el.innerHTML = '<div class="pp-ph3">3D недоступно (WebGL)</div>'; return; }
        m3s[key] = m;
        m.on('load', function () {
            m.setTerrain({ source: 'dem', exaggeration: 1.5 });
            if (heat && heat._url && heat._bounds) {
                var b = heat._bounds;
                m.addSource('heat', { type: 'image', url: heat._url, coordinates: [[b.getWest(), b.getNorth()], [b.getEast(), b.getNorth()], [b.getEast(), b.getSouth()], [b.getWest(), b.getSouth()]] });
                m.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } });
            }
            m.addSource('plot', { type: 'geojson', data: gj });
            m.addLayer({ id: 'plot', type: 'line', source: 'plot', paint: { 'line-color': '#ffffff', 'line-width': 2.5 } });
            m.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 30, pitch: 60, bearing: -20, duration: 0 });
        });
    }

    // ---------- 1. общая информация ----------
    function general(l, gj) {
        var a = turf.area(gj), per = 0, c = turf.centroid(gj).geometry.coordinates, cad = l.feature && l.feature.properties && l.feature.properties.cad_number, bb = turf.bbox(gj), nv = 0;
        polysOf(gj).forEach(function (p) { p.forEach(function (r) { per += turf.length(turf.lineString(r), { units: 'kilometers' }); nv += Math.max(0, r.length - 1); }); });
        var w = hav(c[1], bb[0], c[1], bb[2]), h = hav(bb[1], c[0], bb[3], c[0]), K = 4 * Math.PI * a / Math.pow(per * 1000, 2), fm2 = function (m) { return m < 1000 ? nf(m, 0) + ' м' : nf(m / 1000, 2) + ' км'; };
        D.area = a; D.per = per; D.c = c; D.cad = cad; D.comp = K; D.nv = nv;
        var kl = K >= 0.6 ? ['компактная', '#16a34a'] : K >= 0.3 ? ['умеренно вытянутая', '#eab308'] : ['сильно вытянутая', '#dc2626'];
        return sec(1, 'circle-info', 'Общая информация об участке', 'Размеры, форма, положение и адрес', CC.gen, blk({
            t: 'Границы, размеры и форма', i: 'draw-polygon', map: mapBox('gen'),
            info: ['Базовые геометрические характеристики контура участка: площадь, периметр, габариты, форма, положение и адрес.',
                'Площадь и периметр — основа расчёта норм семян и удобрений, затрат на обработку и ограждение. Форма влияет на эффективность техники: чем более вытянут и изрезан контур, тем больше поворотов и холостых проходов.',
                'Площадь — геодезическая (turf.area, эллипсоид WGS-84); периметр — сумма длин всех колец контура; компактность K = 4π·S / P² (1 — круг, ≈0,78 — квадрат, меньше 0,3 — сильно вытянутый); габариты — стороны описанного прямоугольника по С–Ю и В–З; адрес — обратное геокодирование OpenStreetMap Nominatim по центру участка; зона UTM = ⌊(долгота + 180) / 6⌋ + 1.'],
            body: tiles([['Площадь', nf(a / 1e4, 2) + ' га', nf(a, 0) + ' м²', CC.gen], ['Периметр', nf(per * 1000, 0) + ' м', nf(per, 2) + ' км', '#0ea5e9'], ['Габариты В–З × С–Ю', fm2(w) + ' × ' + fm2(h), '', '#14b8a6'], ['Вершин контура', nf(nv, 0), '', '#a855f7'], ['Компактность K', nf(K, 2), kl[0], kl[1]]]) +
                chart('Форма участка на шкале компактности', meter([[0.3, '#ef4444'], [0.6, '#facc15'], [0.8, '#22c55e']], K, 0, 0.8, 1), 'Красная зона — вытянутые и изрезанные контуры (больше холостых проходов техники), зелёная — компактные участки, удобные для обработки.') +
                kv([['Центр (широта, долгота)', c[1].toFixed(6) + ', ' + c[0].toFixed(6)], ['Адрес', '<span id="ppAddr">определяется…</span>'], ['Кадастровый номер', cad ? esc(cad) : ''], ['Площадь в других единицах', nf(a / 100, 1) + ' сот. · ' + nf(a / 4046.86, 2) + ' акра'], ['Зона UTM', (Math.floor((c[0] + 180) / 6) + 1) + (c[1] >= 0 ? ' N' : ' S')]])
        }));
    }
    function address(c, tok) {
        fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&lat=' + c[1] + '&lon=' + c[0]).then(function (r) { return r.json(); }).then(function (j) {
            if (tok !== seq) return; var el = document.getElementById('ppAddr'); if (el) el.textContent = j.display_name || 'адрес не найден';
        }).catch(function () { var el = document.getElementById('ppAddr'); if (el) el.textContent = 'не удалось определить (нет связи с геокодером)'; });
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
        { k: 's2rgb', t: 'Sentinel-2 · естественные цвета', i: 'image', c: '#0ea5e9', l: 'яркости каналов',
            f: ['Снимок участка в естественных цветах — так его видит глаз.', 'Визуальный контроль посевов, границ полей, застройки и воды; подложка для проверки всех индексов.', 'Композит Sentinel-2 L2A (10 м): красный B04 (665 нм), зелёный B03 (560 нм), синий B02 (490 нм); облака и тени маскируются по слою SCL, выбирается наименее облачная сцена.'] },
        { k: 'ndvi', t: 'NDVI — вегетация', i: 'leaf', c: '#16a34a', l: 'NDVI',
            f: ['Нормализованный вегетационный индекс — показатель количества и «зелёности» растительной массы.', 'Выявляет неоднородность посевов и угнетённые зоны, позволяет планировать дифференцированное внесение удобрений, оценивать фазы развития и потенциал урожайности.', 'NDVI = (NIR − Red) / (NIR + Red) = (B08 − B04) / (B08 + B04) по Sentinel-2 L2A (10 м); значения от −1 до 1; статистика — по пикселям внутри контура.'],
            sc: [['> 0,7 · очень густая растительность', '#15803d'], ['0,5–0,7 · густая', '#22c55e'], ['0,3–0,5 · умеренная', '#a3e635'], ['0,1–0,3 · разреженная, всходы', '#facc15'], ['< 0,1 · голая почва, вода, застройка', '#a8a29e']] },
        { k: 'ndwi', t: 'NDWI — вода', i: 'droplet', c: '#0284c7', l: 'NDWI',
            f: ['Индекс открытой воды и переувлажнения поверхности.', 'Находит водоёмы и переувлажнённые западины, контролирует разливы и подтопление, помогает планировать мелиорацию.', 'NDWI = (Green − NIR) / (Green + NIR) = (B03 − B08) / (B03 + B08) (по McFeeters); значения выше 0 соответствуют открытой воде.'],
            sc: [['> 0,2 · открытая вода', '#0369a1'], ['0–0,2 · переувлажнение, мелководье', '#38bdf8'], ['−0,3–0 · влажная почва, растительность', '#a3e635'], ['< −0,3 · сухая почва и суша', '#d6d3d1']] },
        { k: 'ndmi', t: 'NDMI — влажность растительности', i: 'cloud-rain', c: '#0ea5e9', l: 'NDMI',
            f: ['Индекс влажности растительного покрова (содержание воды в листьях).', 'Раннее выявление водного стресса и засухи — до появления видимых признаков; планирование полива и сроков уборки.', 'NDMI = (NIR − SWIR1) / (NIR + SWIR1) = (B08 − B11) / (B08 + B11); канал B11 (20 м) приводится к 10 м.'],
            sc: [['> 0,4 · высокая влагообеспеченность', '#0ea5e9'], ['0,2–0,4 · хорошая', '#4ade80'], ['0–0,2 · умеренная', '#facc15'], ['−0,2–0 · водный стресс', '#f97316'], ['< −0,2 · сильный стресс, сухая почва', '#dc2626']] },
        { k: 'nbr', t: 'NBR — гари и нарушения покрова', i: 'fire', c: '#ea580c', l: 'NBR',
            f: ['Нормализованный индекс гарей — чувствителен к повреждению и удалению растительности.', 'Выявляет гари, вырубки и сильные нарушения покрова, позволяет оценить скорость восстановления.', 'NBR = (NIR − SWIR2) / (NIR + SWIR2) = (B08 − B12) / (B08 + B12); для оценки события считают dNBR = NBR до − NBR после.'],
            sc: [['> 0,3 · здоровая растительность', '#16a34a'], ['0,1–0,3 · восстановление', '#facc15'], ['−0,1–0,1 · слабое нарушение', '#f97316'], ['< −0,1 · свежая гарь, вырубка', '#dc2626']] }
    ];
    function satellites() {
        var why = 'Выгрузка будет подключена позже';
        return sec(3, 'satellite', 'Спутниковые снимки и индексы', 'Sentinel-2: вегетация, влажность, вода, нарушения покрова', CC.sat,
            '<div class="pp-note">Подблоки подготовлены; статистика, динамика по датам и выгрузка GeoTIFF будут подключены после настройки обработки снимков. Ниже — что покажет каждый индекс и как читать значения.</div>' +
            SATS.map(function (s) {
                return blk({
                    t: s.t, i: s.i, c: s.c, info: s.f, map: mapBox(s.k, dis('GeoTIFF с привязкой', 'download', why)),
                    body: tiles([['Минимум', '—'], ['Среднее', '—'], ['Максимум', '—'], ['Станд. отклонение', '—'], ['Медиана', '—']]) +
                        '<div class="pp-chs">' + chart('Динамика ' + s.l + ' по датам', emptyChart('появится после обработки снимков')) + chart('Гистограмма значений', emptyChart('появится после обработки снимков')) + '</div>' +
                        (s.sc ? chart('Как читать значения', '<div class="pp-sc">' + s.sc.map(function (x) { return '<span style="--c:' + x[1] + '">' + x[0] + '</span>'; }).join('') + '</div>') : '')
                });
            }).join(''));
    }

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
            }) +
            blk({
                t: '3D-модели рельефа', i: 'cube',
                info: ['Объёмные модели рельефа участка поверх спутникового снимка; правая — с тепловой картой высот.', 'Наглядно показывают перепады, западины и водосборы; помогают объяснить рельеф без чтения изолиний.', 'MapLibre GL + DEM Terrarium, вертикальное преувеличение ×1,5. Вращение — правая кнопка мыши или два пальца, масштаб — колесо.'],
                body: '<div class="pp-maps">' + mapBox3('m3a', '3D-модель рельефа') + mapBox3('m3b', '3D + тепловая карта высот') + '</div>'
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
        mk3d('m3b', gj, ov);
        var cv = document.createElement('canvas'); cv.width = cols; cv.height = rows; var g = cv.getContext('2d'), im = g.createImageData(cols, rows), sc = ['#16a34a', '#84cc16', '#facc15', '#f97316', '#dc2626'];
        for (i = 0; i < sl.length; i++) if (sl[i] === sl[i]) { var t = Math.min(1, sl[i] / 15) * 4, q = Math.min(3, Math.floor(t)), f = t - q, a = parseInt(sc[q].substr(1), 16), b2 = parseInt(sc[q + 1].substr(1), 16), o4 = i * 4;
            im.data[o4] = (a >> 16) + (((b2 >> 16) - (a >> 16)) * f); im.data[o4 + 1] = ((a >> 8) & 255) + ((((b2 >> 8) & 255) - ((a >> 8) & 255)) * f); im.data[o4 + 2] = (a & 255) + (((b2 & 255) - (a & 255)) * f); im.data[o4 + 3] = 255; }
        g.putImageData(im, 0, 0);
        if (minis.els) { addImg('els', cv.toDataURL('image/png'), [[bn - rows * dLat, bw], [bn, bw + cols * dLng]], 0.8); minis.els.title = 'Уклоны, °'; setLeg('els', sc, '0', '15+', '°'); }
    }

    // ---------- 6. логистика: дороги и водоёмы выделяются на карте ----------
    function logSec() {
        return sec(6, 'truck', 'Логистика', 'Дороги, вода и населённые пункты рядом с участком (OpenStreetMap)', CC.log,
            blk({
                t: 'Расстояния до инфраструктуры', i: 'route', id: 'ppLgBody', body: SPIN, map: mapBox('lg', '', 'Дороги и водоёмы'),
                info: ['Расстояния от центра участка до ближайших дорог, железной дороги, воды и населённых пунктов.', 'Позволяют оценить затраты на подвоз ресурсов и вывоз урожая, проезжесть в распутицу (дорога с твёрдым покрытием), наличие источника воды и рабочей силы поблизости.',
                    'Данные OpenStreetMap через Overpass API: дороги, ж/д и водные объекты в радиусе 6 км, населённые пункты — до 20 км. Расстояние — по прямой (формула гаверсинусов) от центра участка до ближайшей точки объекта. На карте пунктиром показаны линии до ближайших объектов; цвета линий совпадают с цветами строк.']
            }) +
            blk({
                t: 'Дорожная сеть вокруг участка', i: 'road', id: 'ppLgNet', body: SPIN,
                info: ['Состав и плотность дорожной сети в радиусе 6 км вокруг центра участка.', 'Показывает, насколько развита транспортная инфраструктура и какие дороги преобладают — асфальт или грунтовки, которые могут стать непроезжими в распутицу.',
                    'Суммируются длины линий OpenStreetMap по классам highway; плотность = общая длина дорог / площадь круга радиуса 6 км (113 км²). В расчёт попадает вся длина дорог, пересекающих круг, поэтому значения приблизительные.']
            }) +
            blk({
                t: 'Ближайшие населённые пункты', i: 'city', id: 'ppLgSet', body: SPIN,
                info: ['Шесть ближайших к участку населённых пунктов и расстояния до них.', 'Оценка доступности рабочей силы, жилья, сервисов и точек сбыта; логистическое плечо до ближайшего города.', 'Узлы place=city/town/village/hamlet из OpenStreetMap в радиусе 20 км; расстояние по прямой от центра участка.']
            }));
    }
    async function logRun(gj, tok) {
        var c = D.c, la = c[1], lo = c[0], ar = '(around:%R,' + la + ',' + lo + ')';
        var q = '[out:json][timeout:25];(way' + ar.replace('%R', 6000) + '[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"];way' + ar.replace('%R', 6000) + '[railway=rail];way' + ar.replace('%R', 6000) + '[waterway~"^(river|stream|canal|drain)$"];way' + ar.replace('%R', 6000) + '[natural=water];node' + ar.replace('%R', 20000) + '[place~"^(city|town|village|hamlet)$"];);out geom qt;';
        var els = await ppOverpass(q), el = document.getElementById('ppLgBody'); if (tok !== seq) return;
        var near = function (f) { var best = null; els.forEach(function (e) { if (!f(e)) return; var pts = e.geometry || (e.lat != null ? [{ lat: e.lat, lon: e.lon }] : []); pts.forEach(function (p) { var d = hav(la, lo, p.lat, p.lon); if (!best || d < best.d) best = { d: d, lat: p.lat, lon: p.lon, name: (e.tags || {}).name }; }); }); return best; };
        var hard = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$/, T = function (e) { return e.tags || {}; };
        var R = [['Ближайшая дорога (любая)', near(function (e) { return T(e).highway; }), '#f97316'], ['Дорога с твёрдым покрытием', near(function (e) { return hard.test(T(e).highway || ''); }), '#ef4444'], ['Железная дорога', near(function (e) { return T(e).railway; }), '#6b7280'],
            ['Водоток / водоём', near(function (e) { return T(e).waterway || T(e).natural === 'water'; }), '#0ea5e9'], ['Населённый пункт', near(function (e) { return T(e).place; }), '#a855f7']];
        var fm = function (r) { return r ? (r.d < 1000 ? nf(r.d, 0) + ' м' : nf(r.d / 1000, 2) + ' км') + (r.name ? ' · ' + esc(r.name) : '') : 'не найдено в радиусе'; };
        D.lg = { road: R[1][1] || R[0][1], settl: R[4][1] };
        var rows = R.map(function (r) { return { l: r[0], c: r[2], d: r[1] ? r[1].d : null, n: r[1] && r[1].name }; }), mxd = Math.max.apply(null, rows.map(function (r) { return r.d || 0; }).concat([1]));
        var db = function (a) { return '<div class="pp-db">' + a.map(function (r) { return '<div class="r" style="--c:' + r.c + '"><span><i></i>' + r.l + (r.n ? '<em>' + esc(r.n) + '</em>' : '') + '</span><div class="t"><i style="width:' + (r.d == null ? 0 : Math.max(3, Math.sqrt(r.d / mxd) * 100)).toFixed(0) + '%"></i></div><b>' + (r.d == null ? 'не найдено' : r.d < 1000 ? nf(r.d, 0) + ' м' : nf(r.d / 1000, 2) + ' км') + '</b></div>'; }).join('') + '</div>'; };
        el.innerHTML = db(rows) + '<div class="pp-cap">Расстояния по прямой от центра участка. Длина полосы — расстояние (шкала корневая, чтобы близкие объекты были различимы).</div>';
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
        var st = els.filter(function (e) { return e.type === 'node' && T(e).place; }).map(function (e) { return { d: hav(la, lo, e.lat, e.lon), n: T(e).name || 'без названия', p: PT[T(e).place] || '' }; }).sort(function (u, v) { return u.d - v.d; }).slice(0, 6);
        if (stl) { var sm2 = Math.max.apply(null, st.map(function (x) { return x.d; }).concat([1])); stl.innerHTML = st.length ? '<div class="pp-db">' + st.map(function (x) { return '<div class="r" style="--c:#a855f7"><span><i></i>' + esc(x.n) + '<em>' + x.p + '</em></span><div class="t"><i style="width:' + Math.max(3, Math.sqrt(x.d / sm2) * 100).toFixed(0) + '%"></i></div><b>' + (x.d < 1000 ? nf(x.d, 0) + ' м' : nf(x.d / 1000, 1) + ' км') + '</b></div>'; }).join('') + '</div>' : '<div class="pp-note">Населённые пункты в радиусе 20 км в OpenStreetMap не найдены.</div>'; }
        var o = minis.lg; if (!o) return;
        // сами дороги и водоёмы (сначала вода и магистрали, не более 1500 объектов)
        var pri = function (t) { return t.waterway || t.natural ? 0 : /motorway|trunk|primary|secondary/.test(t.highway || '') ? 1 : t.railway ? 2 : 3; };
        els.filter(function (e) { return e.type === 'way' && e.geometry && e.geometry.length > 1; }).sort(function (a, b) { return pri(T(a)) - pri(T(b)); }).slice(0, 1500).forEach(function (e) {
            var t = T(e), ll = e.geometry.map(function (p) { return [p.lat, p.lon]; });
            if (t.natural === 'water') L.polygon(ll, { color: '#0284c7', weight: 1.5, fillColor: '#38bdf8', fillOpacity: 0.55, interactive: false }).addTo(o.map);
            else if (t.waterway) L.polyline(ll, { color: '#0ea5e9', weight: 3, opacity: 0.95, interactive: false }).addTo(o.map);
            else if (t.railway) L.polyline(ll, { color: '#6b7280', weight: 2.5, dashArray: '6 3', interactive: false }).addTo(o.map);
            else L.polyline(ll, { color: /motorway|trunk|primary|secondary/.test(t.highway) ? '#ef4444' : '#f97316', weight: /motorway|trunk|primary/.test(t.highway) ? 3.5 : 2, opacity: 0.95, interactive: false }).addTo(o.map);
        });
        R.forEach(function (r) { if (r[1]) L.polyline([[la, lo], [r[1].lat, r[1].lon]], { color: r[2], weight: 2.5, dashArray: '5 4', interactive: false }).addTo(o.map); });
        L.geoJSON(gj, { style: { color: '#ffffff', weight: 3, fillColor: '#10b981', fillOpacity: 0.25 }, interactive: false }).addTo(o.map);
        var pts = [[la, lo]]; R.forEach(function (r) { if (r[1]) pts.push([r[1].lat, r[1].lon]); }); o.map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 }); o.title = 'Логистика: дороги и водоёмы';
    }

    // ---------- 7. климат и солнечный режим ----------
    function weatherSec() {
        var la = D.c[1], dec = 23.44, noon = function (dc) { return 90 - Math.abs(la - dc); }, N = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349], dl = N.map(function (n) { return dayLen(la, n); });
        var fh = function (h) { var m = Math.round(h * 60); return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'; };
        return sec(7, 'cloud-sun', 'Климат и солнечный режим', 'Температура, осадки, влагообеспеченность и продолжительность дня', CC.clim,
            blk({
                t: 'Климат участка (норма за 10 лет)', i: 'temperature-half', id: 'ppClBody', body: SPIN,
                info: ['Типичный климат в точке участка за последние 10 полных лет: температура, осадки, теплообеспеченность и влагообеспеченность.', 'Нужен для подбора культур и сортов по теплу и влаге, выбора сроков сева и уборки, оценки риска засухи и заморозков, расчёта потребности в орошении.',
                    'Суточные данные реанализа ERA5 через Open-Meteo Archive API (ячейка сетки ≈ 10–25 км), усреднение по месяцам. Σ t > 10 °C — сумма средних суточных температур в дни теплее 10 °C за год. ГТК Селянинова = 10 · Σосадков / Σt за тот же период (меньше 1,0 — засушливо, больше 1,3 — влажно). Безморозный период — среднее число дней между последним весенним и первым осенним заморозком (минимум ниже 0 °C).']
            }) +
            blk({
                t: 'Солнечный режим', i: 'sun', c: '#f59e0b',
                info: ['Продолжительность светового дня по месяцам и высота солнца над горизонтом в разные сезоны для широты участка.', 'Учитывается при выборе культур по фотопериоду (длиннодневные и короткодневные), планировании теплиц и размещении солнечных панелей.',
                    'Астрономический расчёт по широте центра участка: склонение солнца δ = 23,44° · sin(2π(284 + N) / 365), длина дня = 24/π · arccos(−tg φ · tg δ); полуденная высота солнца = 90° − |φ − δ|. От погоды не зависит.'],
                body: tiles([['Самый длинный день (22 июн)', fh(dayLen(la, 172)), '', '#f59e0b'], ['Самый короткий день (22 дек)', fh(dayLen(la, 355)), '', '#3b82f6'], ['Равноденствие (21 мар)', fh(dayLen(la, 80)), '', '#22c55e'], ['Солнце в полдень, 22 июн', nf(noon(dec), 0) + '°', '', '#f59e0b'], ['Солнце в полдень, 22 дек', nf(noon(-dec), 0) + '°', '', '#3b82f6']]) +
                    chart('Продолжительность дня по месяцам, ч', '<div style="max-width:260px">' + dayChart(dl) + '</div>', 'Цвет столбца: синий — короткий день, оранжевый — длинный. Рассчитано по широте участка.')
            }));
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
        el.innerHTML = tiles([['Средняя t° года', nf(k.tm, 1) + ' °C', '', '#ef4444'], ['Осадки за год', nf(k.pr, 0) + ' мм', 'макс. в ' + MON[wp], '#0ea5e9'], ['Σ t > 10 °C за год', nf(k.sat, 0) + ' °', '', at[1]], ['ГТК Селянинова', k.gtk != null ? nf(k.gtk, 2) : '—', gk ? gk[0] : '', gk ? gk[1] : '#94a3b8'], ['Безморозный период', nf(k.ff, 0) + ' дн.', '', '#22c55e'], ['Тепло / холод', nf(tM[wm], 0) + '° / ' + nf(tM[cm], 0) + '°', MON[wm] + ' / ' + MON[cm], '#f97316']]) +
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
                info: ['Сводная ориентировочная оценка пригодности участка для сельскохозяйственного использования по пяти факторам, 0–100 баллов.', 'Позволяет сравнивать участки между собой и сразу видеть слабое место — фактор, который тянет оценку вниз.',
                    'Рельеф: 100 при среднем уклоне ≤ 1°, линейно до 0 при ≥ 12°. Почва: среднее оценок pH (идеал 6,8; 0 при отклонении ≥ 1,8), органического C (100 при ≥ 35 г/кг) и CEC (100 при ≥ 30 смоль/кг). Климат: ГТК (100 при 1,1–1,6) и безморозный период (100 при ≥ 180 дней, 0 при ≤ 100). Логистика: 100 при дороге с твёрдым покрытием ≤ 500 м, 0 при ≥ 10 км (логарифмическая шкала). Форма: компактность K / 0,7. Итог — среднее по доступным факторам.']
            }));
    }
    function scores() {
        var e = D.elev, s = D.soil && D.soil.S, g = D.lg, k = D.clim, so = [], cm = [], ph = s && s.phh2o, oc = s && s.soc, ce = s && s.cec, rd = g && g.road;
        if (ph) so.push(100 * (1 - cl01(Math.abs(ph.mean - 6.8) / 1.8)));
        if (oc) so.push(100 * cl01(oc.mean / 35));
        if (ce) so.push(100 * cl01(ce.mean / 30));
        if (k && k.gtk != null) cm.push(k.gtk <= 1.6 ? 100 * cl01(k.gtk / 1.1) : 100 * cl01(1 - (k.gtk - 1.6) / 1.5));
        if (k && k.ff != null) cm.push(100 * cl01((k.ff - 100) / 80));
        return [
            { l: 'Рельеф', v: e && e.ms != null ? 100 * (1 - cl01((e.ms - 1) / 11)) : null, b: e && e.ms != null ? 'средний уклон ' + nf(e.ms, 1) + '°' : 'нет данных' },
            { l: 'Почва', v: so.length ? avg(so) : null, b: ph || oc || ce ? [ph ? 'pH ' + nf(ph.mean, 1) : '', oc ? 'C ' + nf(oc.mean, 1) + ' г/кг' : '', ce ? 'CEC ' + nf(ce.mean, 1) : ''].filter(Boolean).join(', ') : 'нет данных' },
            { l: 'Климат', v: cm.length ? avg(cm) : null, b: k ? (k.gtk != null ? 'ГТК ' + nf(k.gtk, 2) + ', ' : '') + 'безморозный период ' + nf(k.ff, 0) + ' дн.' : 'нет данных' },
            { l: 'Логистика', v: g ? (rd ? 100 * (1 - cl01(Math.log(Math.max(rd.d, 500) / 500) / Math.log(20))) : 0) : null, b: g ? (rd ? 'твёрдая дорога в ' + (rd.d < 1000 ? nf(rd.d, 0) + ' м' : nf(rd.d / 1000, 1) + ' км') : 'дорог в радиусе 6 км не найдено') : 'нет данных' },
            { l: 'Форма', v: D.comp != null ? 100 * cl01(D.comp / 0.7) : null, b: D.comp != null ? 'компактность K = ' + nf(D.comp, 2) : 'нет данных' }
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
        var K = [['Площадь', nf(D.area / 1e4, 2) + ' га', 'ruler-combined', CC.gen], ['Перепад высот', e ? nf(e.mx - e.mn, 0) + ' м' : '…', 'mountain', CC.rel], ['Средний уклон', e && e.ms != null ? nf(e.ms, 1) + '°' : '…', 'chart-line', CC.rel], ['pH почвы', ph ? nf(ph.mean, 1) : '…', 'flask', CC.soil],
            ['Гумус (оценка)', so ? nf(so.mean * 0.1724, 1) + ' %' : '…', 'leaf', CC.soil], ['До дороги', g && g.road ? fd(g.road.d) : '…', 'road', CC.log], ['ГТК', k && k.gtk != null ? nf(k.gtk, 2) : '…', 'cloud-rain', CC.clim], ['Σ t > 10 °C', k ? nf(k.sat, 0) + ' °' : '…', 'temperature-half', CC.clim]];
        return '<div class="pp-score"><small>Индекс пригодности</small><div class="big" style="color:' + (r.avg == null ? '#94a3b8' : scCol(r.avg)) + '">' + (r.avg == null ? '…' : Math.round(r.avg)) + '<span>/100</span></div>' + r.svg + '<div class="pp-cap2">Рельеф · почва · климат · логистика · форма. Подробности — в разделе 8.</div></div>' +
            '<div class="pp-kgrid">' + K.map(function (q) { return '<div class="pp-kpi" style="--c:' + q[3] + '"><small><i class="fas fa-' + q[2] + '"></i>' + q[0] + '</small><b>' + q[1] + '</b></div>'; }).join('') + '</div>';
    }
    function summary() {
        var out = [], s = D.soil && D.soil.S, e = D.elev, g = D.lg;
        out.push('Площадь участка — ' + nf(D.area / 1e4, 2) + ' га' + (D.cad ? ', кадастровый номер ' + esc(D.cad) : '') + '.');
        if (e) { out.push('Рельеф: перепад высот ' + nf(e.mx - e.mn, 0) + ' м' + (e.ms != null ? ', средний уклон ' + nf(e.ms, 1) + '°' : '') + (e.asp ? ', экспозиция преимущественно ' + e.asp : '') + '.');
            if (e.ms != null && e.ms >= 5) out.push('<b>Рекомендация:</b> уклон заметный — обработку вести поперёк склона, учесть риск водной эрозии.'); else if (e.ms != null) out.push('Рельеф не ограничивает механизированные работы.'); }
        if (s && s.phh2o) { var ph = s.phh2o.mean; out.push('Почва: pH ≈ ' + nf(ph, 1) + (ph < 5.5 ? ' — кислая; <b>рекомендация:</b> рассмотреть известкование.' : ph > 8 ? ' — щелочная; <b>рекомендация:</b> подобрать культуры, устойчивые к щелочности.' : ' — в благоприятном диапазоне.')); }
        if (s && s.soc) out.push('Органический углерод ≈ ' + nf(s.soc.mean, 1) + ' г/кг (SoilGrids, 250 м).');
        if (g && g.road) out.push('До ближайшей дороги с твёрдым покрытием — ' + (g.road.d < 1000 ? nf(g.road.d, 0) + ' м' : nf(g.road.d / 1000, 1) + ' км') + (g.road.d > 2000 ? '; <b>рекомендация:</b> заложить затраты на подъездные пути.' : '.'));
        var kc = D.clim; if (kc && kc.gtk != null) out.push('Климат: Σt>10 °C ≈ ' + nf(kc.sat, 0) + '°, осадки ≈ ' + nf(kc.pr, 0) + ' мм/год, безморозный период ≈ ' + nf(kc.ff, 0) + ' дн., ГТК ' + nf(kc.gtk, 2) + ' (' + gtkCl(kc.gtk)[0] + ')' + (kc.gtk < 0.9 ? '; <b>рекомендация:</b> подбирать засухоустойчивые культуры, предусмотреть влагосберегающую обработку или орошение.' : '.'));
        if (D.tex) out.push('Механический состав почвы (0–5 см): ' + D.tex + '.');
        if (D.comp != null && D.comp < 0.3) out.push('Контур сильно вытянут (компактность ' + nf(D.comp, 2) + ') — больше поворотов и холостых проходов техники.');
        out.push('<i>Выводы предварительные, сформированы автоматически по открытым данным; классификация земли и спутниковая статистика будут добавлены позже.</i>');
        var el = document.getElementById('ppSum'); if (el) { el.className = 'pp-sum'; el.innerHTML = '<ul>' + out.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
        var sb = document.getElementById('ppScore'); if (sb) sb.innerHTML = scoreTbl();
        var kp = document.getElementById('ppKpi'); if (kp) kp.innerHTML = kpiHtml();
    }

    // ---------- сборка ----------
    function clearMinis() {
        Object.keys(minis).forEach(function (k) { try { minis[k].map.remove(); } catch (e) { /* уже удалена */ } delete minis[k]; });
        Object.keys(m3s).forEach(function (k) { try { m3s[k].remove(); } catch (e) { /* уже удалена */ } delete m3s[k]; });
    }
    function render() {
        var tok = ++seq; clearMinis(); D = {};
        var l = forced ? { feature: { properties: { cad_number: forced.meta.cad || '' } } } : pick(), t = document.getElementById('ppTitle');
        if (!l) { if (t) t.textContent = 'Паспорт участка'; body.innerHTML = '<div class="pp-sec"><div class="pp-sec-b"><div class="pp-note">Нет фигуры для паспорта. Нарисуйте участок (или загрузите контур / выписку Росреестра), выделите его на карте и нажмите «Обновить по фигуре».</div></div></div>'; return; }
        var gj = forced ? forced.gj : toGJ(l);
        var head = general(l, gj);
        body.innerHTML = '<div class="pp-bar"><span><i class="fas fa-circle-info"></i> У каждого блока есть кнопка «Расшифровка»: что показывает, зачем нужен и как рассчитывается.</span><button type="button" class="pp-btn" data-pp-all><i class="fas fa-eye-slash"></i> Скрыть все</button></div><div class="pp-kpis" id="ppKpi"></div>' + head + classification() + satellites() + soilSec() + elevSec() + logSec() + weatherSec() + sumSec();
        document.getElementById('ppKpi').innerHTML = kpiHtml();
        if (t) t.textContent = 'Паспорт участка' + (D.cad ? ' № ' + D.cad : '');
        var T = { gen: 'Участок', cls: 'Классификация земли', s2rgb: 'Sentinel-2 · RGB', ndvi: 'NDVI', ndwi: 'NDWI', ndmi: 'NDMI', nbr: 'NBR', elh: 'Высоты', els: 'Уклоны', lg: 'Логистика' };
        SOILS.forEach(function (p) { T['soil_' + p] = 'Почва'; });
        Object.keys(T).forEach(function (k) { mini(k, gj, T[k]); });
        mk3d('m3a', gj, null);
        address(D.c, tok);
        var soilFail = function (e) { SOILS.forEach(function (p) { var b = document.getElementById('ppSB_' + p); if (b && b.querySelector('.fa-spin')) b.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>'; }); };
        var jobs = [soilRun(gj, tok).catch(soilFail)].concat([[elevRun, 'ppElBody'], [logRun, 'ppLgBody'], [climRun, 'ppClBody']].map(function (x) {
            return x[0](gj, tok).catch(function (e) { console.warn('Паспорт:', e); var el = document.getElementById(x[1]); if (el) el.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>'; });
        }));
        Promise.all(jobs).then(function () { if (tok === seq) summary(); });
    }
    window.ppShow = function (gj, meta) {   // открыть паспорт для заданного контура (сохранённый отчёт)
        forced = { gj: gj, meta: meta || {} }; keep = true;
        var app = document.querySelector('#map-section .app-container');
        app.classList.add('passport-open'); document.dispatchEvent(new Event('passport-open'));
    };
    document.addEventListener('passport-open', function () { if (!keep) forced = null; keep = false; setTimeout(render, 380); });   // после анимации раскрытия панели
    var bR = document.getElementById('ppRefresh'); if (bR) bR.addEventListener('click', render);
    var bP = document.getElementById('ppPrint'); if (bP) bP.addEventListener('click', function () { window.print(); });
})();
