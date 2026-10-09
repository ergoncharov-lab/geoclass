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
    function sec(n, icon, title, inner) { return '<section class="pp-sec"><div class="pp-sec-h"><span class="pp-n">' + n + '</span><i class="fas fa-' + icon + '"></i><h3>' + title + '</h3></div><div class="pp-sec-b">' + inner + '</div></section>'; }
    // карта + легенда + кнопки скачивания под ней (extra — дополнительные кнопки)
    function mapBox(key, h, extra, title) {
        return '<div class="pp-mapw">' + (title ? '<div class="pp-mt">' + title + '</div>' : '') + '<div class="pp-map" data-map="' + key + '" style="height:' + (h || 200) + 'px"></div><div class="pp-leg2" id="ppLeg_' + key + '"></div>' +
            '<div class="pp-dl"><button type="button" class="pp-btn pp-pdf" data-pdf="' + key + '"><i class="fas fa-file-pdf"></i> Карта в PDF</button>' + (extra || '') + '</div></div>';
    }
    function mapBox3(key, title) {
        return '<div class="pp-mapw"><div class="pp-mt">' + title + '</div><div class="pp-map" data-map3="' + key + '" style="height:220px"></div>' +
            '<div class="pp-dl"><button type="button" class="pp-btn pp-pdf" data-pdf3="' + key + '"><i class="fas fa-file-pdf"></i> 3D в PDF</button></div></div>';
    }
    function kv(rows) { rows = rows.filter(function (r) { return r[1] !== '' && r[1] != null; }); return '<table class="pp-tbl">' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>'; }
    function dis(label, icon, why) { return '<button type="button" class="pp-btn" disabled title="' + esc(why) + '"><i class="fas fa-' + icon + '"></i> ' + label + '</button>'; }
    function donut(sl) {
        var tot = sl.reduce(function (s, x) { return s + x.v; }, 0), C = 251.3, acc = 0, circ = '';
        if (tot > 0) sl.forEach(function (x) { var d = x.v / tot * C; circ += '<circle cx="60" cy="60" r="40" stroke="' + x.c + '" stroke-dasharray="' + d.toFixed(2) + ' ' + C + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"/>'; acc += d; });
        else circ = '<circle cx="60" cy="60" r="40" stroke="#cbd5e1" stroke-dasharray="6 4"/>';
        return '<div class="pp-row"><svg viewBox="0 0 120 120"><g fill="none" stroke-width="22" transform="rotate(-90 60 60)">' + circ + '</g></svg><div class="pp-leg">' +
            sl.map(function (x) { return '<div><i style="background:' + x.c + '"></i>' + x.l + '<b>' + (tot > 0 ? nf(x.v / tot * 100, 1) + '%' : '—') + '</b></div>'; }).join('') + '</div></div>';
    }
    function hist(h, color, lo, hi, unit) {
        var mx = Math.max.apply(null, h.concat([1])), w = 300 / h.length;
        return '<svg viewBox="0 0 300 120" class="pp-hist"><g>' + h.map(function (v, i) { var bh = v / mx * 90; return '<rect x="' + (i * w + 1).toFixed(1) + '" y="' + (100 - bh).toFixed(1) + '" width="' + (w - 2).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2" fill="' + color + '"/>'; }).join('') +
            '</g><line x1="0" y1="100" x2="300" y2="100"/><text x="0" y="115" font-size="10">' + esc(lo) + '</text><text x="300" y="115" font-size="10" text-anchor="end">' + esc(hi) + ' ' + esc(unit || '') + '</text></svg>';
    }
    function emptyChart(t) { return '<svg viewBox="0 0 300 120" class="pp-hist"><line x1="10" y1="100" x2="295" y2="100"/><line x1="10" y1="10" x2="10" y2="100"/><text x="150" y="58" font-size="11" text-anchor="middle" style="opacity:.55">' + esc(t) + '</text></svg>'; }
    function statTbl(vals) { return kv([['Минимум', vals[0]], ['Среднее', vals[1]], ['Максимум', vals[2]], ['Станд. отклонение', vals[3]]]); }
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
        b = e.target.closest('[data-soil-tif]'); if (b && D.soil) {
            var p = b.getAttribute('data-soil-tif'); if (D.soil.cov[p]) ppSoil.tif(D.soil.cov[p], p, '0-5cm', D.soil.bb);
        }
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
        var a = turf.area(gj), per = 0, c = turf.centroid(gj).geometry.coordinates, cad = l.feature && l.feature.properties && l.feature.properties.cad_number;
        polysOf(gj).forEach(function (p) { p.forEach(function (r) { per += turf.length(turf.lineString(r), { units: 'kilometers' }); }); });
        D.area = a; D.per = per; D.c = c; D.cad = cad;
        return sec(1, 'circle-info', 'Общая информация об участке', '<div class="pp-2"><div>' + kv([
            ['Площадь', nf(a / 1e4, 2) + ' га (' + nf(a, 0) + ' м²)'], ['Периметр', nf(per * 1000, 0) + ' м (' + nf(per, 2) + ' км)'],
            ['Центр (широта, долгота)', c[1].toFixed(6) + ', ' + c[0].toFixed(6)], ['Адрес', '<span id="ppAddr">определяется…</span>'], ['Кадастровый номер', cad ? esc(cad) : '']]) + '</div>' + mapBox('gen', 220) + '</div>');
    }
    function address(c, tok) {
        fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&lat=' + c[1] + '&lon=' + c[0]).then(function (r) { return r.json(); }).then(function (j) {
            if (tok !== seq) return; var el = document.getElementById('ppAddr'); if (el) el.textContent = j.display_name || 'адрес не найден';
        }).catch(function () { var el = document.getElementById('ppAddr'); if (el) el.textContent = 'не удалось определить (нет связи с геокодером)'; });
    }

    // ---------- 2. классификация ----------
    function classification() {
        var cls = [['Пашня', '#f59e0b'], ['Луга и пастбища', '#10b981'], ['Лес', '#166534'], ['Вода', '#0ea5e9'], ['Застройка', '#64748b'], ['Прочее', '#a8a29e']];
        var why = 'Появится после подключения слоя классификации';
        return sec(2, 'seedling', 'Классификация земли', '<div class="pp-note">Слой классификации пока не подключён — расчёт будет выполнен автоматически позже.</div><div class="pp-2"><div>' +
            '<h5>Площади по классам</h5>' + kv(cls.map(function (c) { return ['<i class="pp-dot" style="background:' + c[1] + '"></i>' + c[0], '— га · —%']; })) + '<h5>Диаграмма</h5>' +
            donut(cls.map(function (c) { return { l: c[0], c: c[1], v: 0 }; })) + '</div>' +
            mapBox('cls', 220, dis('KML', 'file-code', why) + dis('GeoJSON', 'file-code', why) + dis('SHP', 'file-zipper', why)) + '</div>');
    }

    // ---------- 3. спутниковые снимки ----------
    var SATS = [['s2rgb', 'Sentinel-2 · естественные цвета', 'image', 'Яркость каналов'], ['ndvi', 'NDVI — вегетация', 'leaf', 'NDVI'], ['ndwi', 'NDWI — вода', 'droplet', 'NDWI'], ['ndmi', 'NDMI — влажность растительности', 'cloud-rain', 'NDMI'], ['nbr', 'NBR — гари и нарушения покрова', 'fire', 'NBR']];
    function satellites() {
        var why = 'Выгрузка будет подключена позже';
        return sec(3, 'satellite', 'Спутниковые снимки', '<div class="pp-note">Подблоки подготовлены; расчёт статистики по спектрам и выгрузка GeoTIFF будут подключены после настройки обработки снимков.</div>' +
            SATS.map(function (s) {
                return '<div class="pp-sub"><h4><i class="fas fa-' + s[2] + '"></i> ' + s[1] + '</h4><div class="pp-2"><div>' + statTbl(['—', '—', '—', '—']) + emptyChart('Динамика ' + s[3] + ' по датам — после обработки') + '</div>' +
                    mapBox(s[0], 190, dis('GeoTIFF с привязкой', 'download', why)) + '</div></div>';
            }).join(''));
    }

    // ---------- 4. почвенный анализ: карта и диаграммы по каждому показателю ----------
    var SOILS = ['phh2o', 'soc', 'nitrogen', 'cec', 'clay', 'sand', 'silt', 'bdod'];
    function soilSec() {
        return sec(4, 'flask', 'Почвенный анализ · SoilGrids 250 м, глубина 0–5 см', '<div class="pp-note">Для каждого показателя — карта (пиксели 250 м внутри участка), статистика и диаграммы. Для малых участков значение берётся по ближайшим пикселям.</div>' +
            SOILS.map(function (p) {
                var P = ppSoil.props[p];
                return '<div class="pp-sub"><h4><i class="fas fa-vial"></i> ' + P.n + ', ' + P.u + '</h4><div class="pp-2"><div id="ppSB_' + p + '"><div class="pp-note"><i class="fas fa-spinner fa-spin"></i> Загружаем данные SoilGrids…</div></div>' +
                    mapBox('soil_' + p, 190, '<button type="button" class="pp-btn" data-soil-tif="' + p + '" disabled><i class="fas fa-download"></i> GeoTIFF</button>') + '</div></div>';
            }).join(''));
    }
    async function soilRun(gj, tok) {
        var bb = turf.bbox(gj), cen = turf.centroid(gj).geometry.coordinates, S0 = D.soil = { cov: {}, bb: bb, vals: {}, S: {}, err: '' };
        if ((bb[2] - bb[0]) > 1.5 || (bb[3] - bb[1]) > 1.5) S0.err = 'участок слишком большой для почвенного анализа';
        else await Promise.all(SOILS.map(function (p) { return ppSoil.cov(p, '0-5cm', bb).then(function (c) { S0.cov[p] = c; }).catch(function (e) { S0.err = e.message; }); }));
        if (tok !== seq) return;
        SOILS.forEach(function (p) { soilOne(p, gj, S0, cen); });
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
        var pal = ppSoil.pal[p] || ppSoil.pal.def, f = function (v) { return nf(v, P.d); };
        box.innerHTML = kv([['Минимум', f(mn)], ['Среднее', '<b>' + f(m) + '</b> ' + esc(P.u)], ['Максимум', f(mx)], ['Станд. отклонение', f(sd)], ['Пикселей 250 м', a.length]]) +
            '<h5>Распределение значений</h5>' + hist(hh, pal.c[pal.c.length - 2] || '#10b981', f(mn), f(mx), P.u) +
            '<h5>Доли участка по уровню значений</h5>' + donut([{ l: 'Низкие', c: '#60a5fa', v: th[0] }, { l: 'Средние', c: '#34d399', v: th[1] }, { l: 'Высокие', c: '#f59e0b', v: th[2] }]);
        soilShow(p, gj, c, bb, a, pal);
        var btn = body.querySelector('[data-soil-tif="' + p + '"]'); if (btn) btn.disabled = false;
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

    // ---------- 5. высоты и уклоны (+ 3D) ----------
    function elevSec() {
        return sec(5, 'mountain', 'Анализ высот и уклонов', '<div class="pp-2"><div id="ppElBody"><div class="pp-note"><i class="fas fa-spinner fa-spin"></i> Загружаем данные рельефа…</div>' +
            '<div class="pp-note" style="margin-top:8px">Анализ водотоков будет добавлен отдельным подблоком.</div></div><div class="pp-mapcol">' +
            mapBox('elh', 190, '', 'Высоты — тепловая карта') + mapBox('els', 190, '', 'Уклоны — тепловая карта') +
            mapBox3('m3a', '3D-модель рельефа') + mapBox3('m3b', '3D + тепловая карта высот') + '</div></div>');
    }
    async function elevRun(gj, tok) {
        var r = await ppDem.grid(gj, function () { return tok === seq; }), el = document.getElementById('ppElBody');
        if (tok !== seq) return;
        if (!r) { el.innerHTML = '<div class="pp-note">Данные рельефа для участка недоступны.</div>'; return; }
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
        var nb = 16, hh = new Array(nb).fill(0), sp = (mx - mn) || 1; for (i = 0; i < grid.length; i++) if (grid[i] === grid[i]) hh[Math.min(nb - 1, Math.floor((grid[i] - mn) / sp * nb))]++;
        el.innerHTML = kv([['Высота мин / средняя / макс', nf(mn, 0) + ' / ' + nf(mean, 0) + ' / ' + nf(mx, 0) + ' м'], ['Перепад высот', nf(mx - mn, 0) + ' м'], ['Средний уклон', ms == null ? '—' : nf(ms, 1) + '°'], ['Максимальный уклон', sn ? nf(smax, 1) + '°' : '—'], ['Преобладающая экспозиция', D.elev.asp || '—']]) +
            '<h5>Распределение высот</h5>' + hist(hh, '#10b981', nf(mn, 0), nf(mx, 0), 'м') + '<h5>Классы уклонов (доля площади)</h5>' + donut(CL.map(function (c, q) { return { l: c[0], c: c[1], v: cl[q] }; })) +
            '<div class="pp-note" style="margin-top:8px">Анализ водотоков будет добавлен отдельным подблоком.</div>';
        var hc = [0, 0.2, 0.4, 0.6, 0.8, 1].map(function (t) { var c = ppDem.col(t); return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; });
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
        return sec(6, 'truck', 'Логистика', '<div class="pp-2"><div id="ppLgBody"><div class="pp-note"><i class="fas fa-spinner fa-spin"></i> Ищем дороги, воду и населённые пункты (OpenStreetMap)…</div></div>' + mapBox('lg', 240) + '</div>' +
            '<div class="pp-note" style="margin-top:10px">Расстояния считаются от центра участка по данным OpenStreetMap. На карте: <b style="color:#ef4444">красные</b> — магистрали, <b style="color:#f97316">оранжевые</b> — прочие дороги, <b style="color:#6b7280">серые</b> — железная дорога, <b style="color:#0ea5e9">синие</b> — водотоки и водоёмы.</div>');
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
        el.innerHTML = kv(R.map(function (r) { return ['<i class="pp-dot" style="background:' + r[2] + '"></i>' + r[0], fm(r[1])]; }));
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

    // ---------- 7. погода, 8. итог ----------
    function weatherSec() { return sec(7, 'cloud-sun', 'Погода', '<div class="pp-note">Раздел в разработке.</div>'); }
    function sumSec() { return sec(8, 'clipboard-check', 'Итог и рекомендации', '<div id="ppSum" class="pp-note">Формируется после расчёта разделов…</div>'); }
    function kpiHtml() {
        var s = D.soil && D.soil.S, e = D.elev, g = D.lg, ph = s && s.phh2o, so = s && s.soc;
        var K = [['Площадь', nf(D.area / 1e4, 2) + ' га'], ['Перепад высот', e ? nf(e.mx - e.mn, 0) + ' м' : '…'], ['Средний уклон', e && e.ms != null ? nf(e.ms, 1) + '°' : '…'], ['pH почвы', ph ? nf(ph.mean, 1) : '…'], ['Орг. углерод', so ? nf(so.mean, 1) + ' г/кг' : '…'], ['До дороги', g && g.road ? (g.road.d < 1000 ? nf(g.road.d, 0) + ' м' : nf(g.road.d / 1000, 1) + ' км') : '…']];
        return K.map(function (k) { return '<div class="pp-kpi"><small>' + k[0] + '</small><b>' + k[1] + '</b></div>'; }).join('');
    }
    function summary() {
        var out = [], s = D.soil && D.soil.S, e = D.elev, g = D.lg;
        out.push('Площадь участка — ' + nf(D.area / 1e4, 2) + ' га' + (D.cad ? ', кадастровый номер ' + esc(D.cad) : '') + '.');
        if (e) { out.push('Рельеф: перепад высот ' + nf(e.mx - e.mn, 0) + ' м' + (e.ms != null ? ', средний уклон ' + nf(e.ms, 1) + '°' : '') + (e.asp ? ', экспозиция преимущественно ' + e.asp : '') + '.');
            if (e.ms != null && e.ms >= 5) out.push('<b>Рекомендация:</b> уклон заметный — обработку вести поперёк склона, учесть риск водной эрозии.'); else if (e.ms != null) out.push('Рельеф не ограничивает механизированные работы.'); }
        if (s && s.phh2o) { var ph = s.phh2o.mean; out.push('Почва: pH ≈ ' + nf(ph, 1) + (ph < 5.5 ? ' — кислая; <b>рекомендация:</b> рассмотреть известкование.' : ph > 8 ? ' — щелочная; <b>рекомендация:</b> подобрать культуры, устойчивые к щелочности.' : ' — в благоприятном диапазоне.')); }
        if (s && s.soc) out.push('Органический углерод ≈ ' + nf(s.soc.mean, 1) + ' г/кг (SoilGrids, 250 м).');
        if (g && g.road) out.push('До ближайшей дороги с твёрдым покрытием — ' + (g.road.d < 1000 ? nf(g.road.d, 0) + ' м' : nf(g.road.d / 1000, 1) + ' км') + (g.road.d > 2000 ? '; <b>рекомендация:</b> заложить затраты на подъездные пути.' : '.'));
        out.push('<i>Выводы предварительные, сформированы автоматически по открытым данным; классификация земли, спутниковая статистика и погода будут добавлены позже.</i>');
        var el = document.getElementById('ppSum'); if (el) { el.className = 'pp-sum'; el.innerHTML = '<ul>' + out.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
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
        body.innerHTML = '<div class="pp-kpis" id="ppKpi"></div>' + head + classification() + satellites() + soilSec() + elevSec() + logSec() + weatherSec() + sumSec();
        document.getElementById('ppKpi').innerHTML = kpiHtml();
        if (t) t.textContent = 'Паспорт участка' + (D.cad ? ' № ' + D.cad : '');
        var T = { gen: 'Участок', cls: 'Классификация земли', s2rgb: 'Sentinel-2 · RGB', ndvi: 'NDVI', ndwi: 'NDWI', ndmi: 'NDMI', nbr: 'NBR', elh: 'Высоты', els: 'Уклоны', lg: 'Логистика' };
        SOILS.forEach(function (p) { T['soil_' + p] = 'Почва'; });
        Object.keys(T).forEach(function (k) { mini(k, gj, T[k]); });
        mk3d('m3a', gj, null);
        address(D.c, tok);
        var soilFail = function (e) { SOILS.forEach(function (p) { var b = document.getElementById('ppSB_' + p); if (b && b.querySelector('.fa-spin')) b.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>'; }); };
        var jobs = [soilRun(gj, tok).catch(soilFail), elevRun(gj, tok), logRun(gj, tok)].map(function (p, i) {
            return i === 0 ? p : p.catch(function (e) { console.warn('Паспорт:', e); var el = document.getElementById(['', 'ppElBody', 'ppLgBody'][i]); if (el) el.innerHTML = '<div class="pp-note">Не удалось рассчитать: ' + esc(e && e.message || e) + '</div>'; });
        });
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
