/* ============================================================
   АГРОКАЛЬКУЛЯТОР ПО ПЛОЩАДИ — нижняя панель → «Инструменты» → «Агрокалькулятор»
   Площадь — из нарисованной/импортированной фигуры или вводится вручную.
   Модули: семена · удобрения · СЗР · работы и топливо · прочие затраты · урожай и экономика.
   Все нормы и цены по умолчанию — ориентировочные справочные значения: замените своими.
   ============================================================ */
(function () {
    var pane = document.querySelector('[data-bp-pane="agro"]'); if (!pane) return;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var nf = function (v, d) { return isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: d == null ? 0 : d }) : '—'; };
    var rub = function (v) { return nf(v, 0) + ' ₽'; };
    var sum = function (a, k) { return a.reduce(function (s, x) { return s + (+x[k] || 0); }, 0); };

    // культура: [название, норма высева млн всх./га, МТС г, чистота %, всхожесть %, цена семян ₽/кг, урожайность ц/га, цена реализации ₽/т, N, P2O5, K2O кг д.в./га]
    var CROPS = [['Озимая пшеница', 4.5, 40, 98, 92, 28, 55, 15000, 100, 50, 50], ['Яровая пшеница', 5, 36, 98, 92, 28, 35, 14000, 80, 40, 40],
        ['Яровой ячмень', 4, 45, 98, 92, 22, 38, 12000, 70, 40, 40], ['Кукуруза на зерно', 0.065, 300, 99, 95, 450, 70, 11000, 120, 60, 60],
        ['Подсолнечник', 0.06, 60, 98, 92, 1000, 25, 28000, 60, 40, 40], ['Соя', 0.55, 170, 98, 90, 45, 20, 33000, 20, 40, 60],
        ['Яровой рапс', 1, 4.5, 98, 90, 700, 18, 30000, 90, 50, 60], ['Горох', 1, 200, 98, 92, 25, 28, 15000, 20, 40, 40],
        ['Сахарная свёкла', 0.11, 12, 99, 90, 9000, 450, 4000, 100, 80, 120], ['Картофель', 0.05, 70000, 100, 95, 28, 300, 15000, 100, 80, 140],
        ['Своя культура', 1, 50, 98, 90, 30, 30, 15000, 60, 40, 40]];
    // удобрение: [название, N %, P2O5 %, K2O %, цена ₽/т]
    var FERT = [['Аммиачная селитра (34,4 % N)', 34.4, 0, 0, 30000], ['Карбамид (46 % N)', 46, 0, 0, 33000], ['КАС-32 (32 % N)', 32, 0, 0, 22000], ['Аммофос (12:52)', 12, 52, 0, 52000],
        ['Нитроаммофоска (16:16:16)', 16, 16, 16, 40000], ['Двойной суперфосфат (46 % P₂O₅)', 0, 46, 0, 42000], ['Хлористый калий (60 % K₂O)', 0, 0, 60, 36000], ['Сульфат аммония (21 % N)', 21, 0, 0, 16000]];
    var NFORMS = [0, 1, 2, 7];

    function autoFert(t, ni) {   // P — из аммофоса (он даёт и азот), K — из хлористого калия, остаток азота — выбранной азотной формой
        var r = [], aa = t.p > 0 ? t.p / 0.52 : 0, kc = t.k > 0 ? t.k / 0.6 : 0, nr = Math.max(0, t.n - aa * 0.12) / (FERT[ni][1] / 100);
        if (aa) r.push({ f: 3, rate: Math.round(aa), price: FERT[3][4] });
        if (kc) r.push({ f: 6, rate: Math.round(kc), price: FERT[6][4] });
        if (nr > 0) r.push({ f: ni, rate: Math.round(nr), price: FERT[ni][4] });
        return r;
    }
    function fresh(ci, area) {
        var c = CROPS[ci], t = { n: c[8], p: c[9], k: c[10] };
        return { crop: ci, area: area || 100, seed: { kn: c[1], mtc: c[2], pur: c[3], germ: c[4], price: c[5], trt: 1.5, trtp: 1500 }, yld: c[6], price: c[7], loss: 3,
            tgt: t, nform: 0, fert: autoFert(t, 0), fuelPrice: 62, eff: 0.8,
            pest: [{ n: 'Гербицид', d: 1, k: 1, p: 1200 }, { n: 'Фунгицид', d: 0.8, k: 2, p: 2000 }, { n: 'Инсектицид', d: 0.15, k: 1, p: 3000 }],
            ops: [['Вспашка', 20, 2.5, 8, 1, 0], ['Дискование', 6, 8, 10, 1, 1], ['Предпосевная культивация', 5, 12, 10, 1, 1], ['Посев', 5, 12, 8, 1, 1], ['Внесение удобрений', 2, 24, 12, 1, 1],
                ['Опрыскивание', 0.8, 24, 12, 3, 1], ['Уборка', 15, 7.5, 5, 1, 1], ['Транспортировка урожая', 3, 0, 0, 1, 1]].map(function (o) { return { n: o[0], fu: o[1], w: o[2], v: o[3], k: o[4], on: o[5] }; }),
            other: [['Аренда земли', 3000], ['Оплата труда', 1500], ['Амортизация и ремонт техники', 2500], ['Страхование', 500], ['Прочие расходы', 500]].map(function (o) { return { n: o[0], v: o[1] }; }) };
    }
    var KEY = 'gc_agro_v1', S = null;
    try { var j = JSON.parse(localStorage.getItem(KEY)); if (j && j.seed && j.tgt && Array.isArray(j.fert) && Array.isArray(j.pest) && Array.isArray(j.ops) && Array.isArray(j.other)) S = j; } catch (e) { /* нет сохранённых данных */ }
    S = S || fresh(0, 100);
    var save = function () { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* хранилище недоступно */ } };
    var pget = function (p) { return p.split('.').reduce(function (o, k) { return o[k]; }, S); };
    var pset = function (p, v) { var a = p.split('.'), l = a.pop(); a.reduce(function (o, k) { return o[k]; }, S)[l] = v; };
    var NEW = { fert: function () { return { f: 0, rate: 100, price: FERT[0][4] }; }, pest: function () { return { n: 'Препарат', d: 1, k: 1, p: 1000 }; },
        ops: function () { return { n: 'Операция', fu: 5, w: 10, v: 10, k: 1, on: 1 }; }, other: function () { return { n: 'Статья затрат', v: 0 }; } };

    // ---------- интерфейс ----------
    var inp = function (p, label, unit, step) { return '<div class="dw-row"><label>' + label + '</label><input type="number" min="0" step="' + (step || 'any') + '" data-ag="' + p + '" value="' + pget(p) + '"><span class="ag-u">' + unit + '</span></div>'; };
    var sec = function (t, icon, body) { return '<details class="dw-block ag-sec" open><summary class="dw-title"><i class="fas fa-' + icon + '"></i> ' + t + '</summary>' + body + '</details>'; };
    var num = function (k, i, f, v) { return '<input type="number" min="0" step="any" data-ag-a="' + k + '" data-i="' + i + '" data-k="' + f + '" value="' + v + '">'; };
    var txt = function (k, i, f, v) { return '<input type="text" data-ag-a="' + k + '" data-i="' + i + '" data-k="' + f + '" value="' + esc(v) + '">'; };
    var xb = function (k, i) { return '<button type="button" class="ag-x" data-ag-del="' + k + '" data-i="' + i + '" title="Убрать строку">×</button>'; };
    var row = function (g, inner, h) { return '<div class="ag-r' + (h ? ' ag-h' : '') + '" style="--g:' + g + '">' + inner + '</div>'; };
    var fopts = function (sel, only) { return FERT.map(function (f, i) { return !only || only.indexOf(i) >= 0 ? '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + f[0] + '</option>' : ''; }).join(''); };
    function listHtml(k) {
        var a = S[k], h = '';
        if (k === 'fert') { h = row('1fr 62px 62px 22px', '<span>Удобрение</span><span>кг/га</span><span>₽/т</span><span></span>', 1);
            a.forEach(function (r, i) { h += row('1fr 62px 62px 22px', '<select data-ag-a="fert" data-i="' + i + '" data-k="f">' + fopts(+r.f) + '</select>' + num(k, i, 'rate', r.rate) + num(k, i, 'price', r.price) + xb(k, i)); }); }
        else if (k === 'pest') { h = row('1fr 54px 40px 62px 22px', '<span>Препарат</span><span>л/га</span><span>раз</span><span>₽/л</span><span></span>', 1);
            a.forEach(function (r, i) { h += row('1fr 54px 40px 62px 22px', txt(k, i, 'n', r.n) + num(k, i, 'd', r.d) + num(k, i, 'k', r.k) + num(k, i, 'p', r.p) + xb(k, i)); }); }
        else if (k === 'ops') { h = row('18px 1fr 48px 48px 46px 38px 22px', '<span></span><span>Операция</span><span>л/га</span><span>захват, м</span><span>км/ч</span><span>раз</span><span></span>', 1);
            a.forEach(function (r, i) { h += row('18px 1fr 48px 48px 46px 38px 22px', '<input type="checkbox" data-ag-a="ops" data-i="' + i + '" data-k="on"' + (r.on ? ' checked' : '') + '>' + txt(k, i, 'n', r.n) + num(k, i, 'fu', r.fu) + num(k, i, 'w', r.w) + num(k, i, 'v', r.v) + num(k, i, 'k', r.k) + xb(k, i)); }); }
        else { h = row('1fr 84px 22px', '<span>Статья</span><span>₽/га</span><span></span>', 1);
            a.forEach(function (r, i) { h += row('1fr 84px 22px', txt(k, i, 'n', r.n) + num(k, i, 'v', r.v) + xb(k, i)); }); }
        return h + '<button type="button" class="ag-add" data-ag-add="' + k + '"><i class="fas fa-plus"></i> Добавить строку</button>';
    }
    function list(k) { var el = pane.querySelector('[data-ag-list="' + k + '"]'); if (el) el.innerHTML = listHtml(k); }
    function body() {
        var el = pane.querySelector('[data-ag-body]');
        el.innerHTML =
            sec('Семена', 'seedling', inp('seed.kn', 'Норма высева', 'млн всх./га', 0.001) + inp('seed.mtc', 'Масса 1000 семян', 'г') + inp('seed.pur', 'Чистота', '%') + inp('seed.germ', 'Всхожесть', '%') +
                inp('seed.price', 'Цена семян', '₽/кг') + inp('seed.trt', 'Протравитель', 'л/т') + inp('seed.trtp', 'Цена протравителя', '₽/л') + '<div class="an-hint" data-ag-hint="seed"></div>') +
            sec('Удобрения', 'flask', '<div class="m3-hint">Целевые нормы действующего вещества (д.в.) — по культуре; замените своими.</div>' + inp('tgt.n', 'Азот N', 'кг д.в./га') + inp('tgt.p', 'Фосфор P₂O₅', 'кг д.в./га') + inp('tgt.k', 'Калий K₂O', 'кг д.в./га') +
                '<div class="dw-row"><label>Азотная форма</label><select data-ag="nform">' + fopts(S.nform, NFORMS) + '</select></div>' +
                '<button type="button" class="ag-go" data-ag-act="auto"><i class="fas fa-wand-magic-sparkles"></i><span>Подобрать удобрения под целевые д.в.</span></button>' +
                '<div data-ag-list="fert">' + listHtml('fert') + '</div><div class="an-hint" data-ag-hint="fert"></div>') +
            sec('Средства защиты растений', 'bug', '<div data-ag-list="pest">' + listHtml('pest') + '</div>') +
            sec('Работы и топливо', 'tractor', inp('fuelPrice', 'Цена дизельного топлива', '₽/л') + inp('eff', 'Коэффициент использования времени', '0–1', 0.01) + '<div data-ag-list="ops">' + listHtml('ops') + '</div><div class="an-hint" data-ag-hint="ops"></div>') +
            sec('Прочие затраты', 'coins', '<div data-ag-list="other">' + listHtml('other') + '</div>') +
            sec('Урожай и реализация', 'wheat-awn', inp('yld', 'Урожайность', 'ц/га') + inp('price', 'Цена реализации', '₽/т') + inp('loss', 'Потери и подработка', '%'));
    }
    pane.innerHTML =
        '<div class="dw-block"><div class="dw-title">Площадь и культура</div><div class="an-draw">' +
        '<button type="button" class="map-btn" data-ag-tool="polygon" title="Полигон"><i class="gc-pent"></i></button>' +
        '<button type="button" class="map-btn" data-ag-tool="rectangle" title="Прямоугольник"><i class="fas fa-vector-square"></i></button>' +
        '<button type="button" class="map-btn" data-ag-tool="circle" title="Круг / Овал"><i class="fas fa-circle"></i></button>' +
        '<button type="button" class="map-btn" data-ag-act="edit" title="Редактировать фигуру"><i class="fas fa-edit"></i></button>' +
        '<button type="button" class="map-btn" data-ag-act="sel" title="Взять фигуру, выбранную на карте"><i class="fas fa-hand-pointer"></i></button>' +
        '<button type="button" class="map-btn" data-ag-act="del" title="Удалить фигуру"><i class="fas fa-trash"></i></button>' +
        '<button type="button" class="map-btn" data-gc-io="import" data-gc-for="ag" title="Импорт полигона (KML, GeoJSON, Excel, XML Росреестра)"><i class="fas fa-file-import"></i></button>' +
        '<button type="button" class="map-btn" data-gc-io="export" data-gc-for="ag" title="Экспорт фигуры (KML, GeoJSON)"><i class="fas fa-file-export"></i></button></div>' +
        '<div class="an-hint" data-ag-info></div>' + inp('area', 'Площадь', 'га', 0.01) +
        '<div class="dw-row"><label>Культура</label><select data-ag="crop">' + CROPS.map(function (c, i) { return '<option value="' + i + '"' + (i === S.crop ? ' selected' : '') + '>' + c[0] + '</option>'; }).join('') + '</select></div>' +
        '<div class="m3-hint">Нормы, цены и расход по умолчанию — ориентировочные. Выбор культуры подставляет типовые значения; все поля можно менять, введённое сохраняется в браузере.</div></div>' +
        '<div class="dw-block"><div class="dw-title">Итоги расчёта</div><div data-ag-out></div></div><div data-ag-body></div>' +
        '<div class="dw-block"><div class="ag-btns"><button type="button" class="ag-go" data-ag-act="copy"><i class="fas fa-copy"></i><span>Копировать смету</span></button>' +
        '<button type="button" class="ag-go" data-ag-act="csv"><i class="fas fa-file-csv"></i><span>Скачать CSV</span></button>' +
        '<button type="button" class="ag-go ag-lt" data-ag-act="reset"><i class="fas fa-rotate-left"></i><span>Значения культуры по умолчанию</span></button></div></div>';
    body();

    // ---------- расчёт ----------
    function calc() {
        var A = Math.max(0, +S.area || 0), s = S.seed, R = { A: A }, pg = (s.pur * s.germ) / 1e4, sup = { n: 0, p: 0, k: 0 };
        R.seedKgHa = pg > 0 ? s.kn * s.mtc / pg : 0; R.seedKg = R.seedKgHa * A;   // млн шт/га × г/1000 шт = кг/га; делим на посевную годность
        R.cSeed = R.seedKg * s.price; R.trtL = R.seedKg / 1000 * s.trt; R.cTrt = R.trtL * s.trtp;
        R.fert = S.fert.map(function (r) { var f = FERT[r.f] || FERT[0], kg = +r.rate || 0, t = kg * A / 1000; sup.n += kg * f[1] / 100; sup.p += kg * f[2] / 100; sup.k += kg * f[3] / 100; return { n: f[0], t: t, c: t * (+r.price || 0) }; });
        R.sup = sup; R.cFert = sum(R.fert, 'c'); R.tFert = sum(R.fert, 't');
        R.pest = S.pest.map(function (r) { var q = (+r.d || 0) * (+r.k || 0) * A; return { n: r.n, q: q, c: q * (+r.p || 0) }; }); R.cPest = sum(R.pest, 'c');
        R.fuelL = 0; R.hours = 0;
        S.ops.forEach(function (o) { if (!o.on) return; var k = +o.k || 0, pr = (+o.w || 0) * (+o.v || 0) * (+S.eff || 0) / 10; R.fuelL += (+o.fu || 0) * k * A; if (pr > 0) R.hours += A * k / pr; });   // производительность, га/ч = захват × скорость × КИВ / 10
        R.cFuel = R.fuelL * (+S.fuelPrice || 0);
        R.other = S.other.map(function (o) { return { n: o.n, c: (+o.v || 0) * A }; }); R.cOther = sum(R.other, 'c');
        R.cost = R.cSeed + R.cTrt + R.cFert + R.cPest + R.cFuel + R.cOther;
        R.gross = S.yld / 10 * A; R.net = R.gross * (1 - S.loss / 100); R.rev = R.net * S.price;
        R.profit = R.rev - R.cost; R.margin = R.cost > 0 ? R.profit / R.cost * 100 : NaN; R.costT = R.net > 0 ? R.cost / R.net : NaN;
        R.beY = S.price > 0 && A > 0 && S.loss < 100 ? R.cost / A / (S.price * (1 - S.loss / 100)) * 10 : NaN;   // урожайность безубыточности, ц/га
        R.rows = [['Семена', nf(R.seedKg, 0) + ' кг', R.cSeed], ['Протравитель семян', nf(R.trtL, 1) + ' л', R.cTrt]]
            .concat(R.fert.map(function (x) { return [x.n, nf(x.t, 2) + ' т', x.c]; }), R.pest.map(function (x) { return [x.n, nf(x.q, 1) + ' л/кг', x.c]; }),
                [['Топливо', nf(R.fuelL, 0) + ' л', R.cFuel]], R.other.map(function (x) { return [x.n, '', x.c]; })).filter(function (r) { return r[2] > 0; });
        return R;
    }
    var tileH = function (t) { return '<div class="pp-tile" style="--c:' + t[3] + '"><span>' + t[0] + '</span><b>' + t[1] + '</b>' + (t[2] ? '<em>' + t[2] + '</em>' : '') + '</div>'; };
    var chartH = function (t, inner, cap) { return '<div class="pp-ch"><h5>' + t + '</h5>' + inner + (cap ? '<div class="pp-cap">' + cap + '</div>' : '') + '</div>'; };
    var last = null;
    function render() {
        var R = last = calc(), A = R.A, ha = function (v) { return A > 0 ? v / A : NaN; }, out = pane.querySelector('[data-ag-out]'), h;
        var chk = function (a, t) { return nf(a, 0) + ' / ' + nf(t, 0) + ' кг/га' + (t > 0 && a < t * 0.97 ? ' <b style="color:#dc2626">недобор</b>' : t > 0 && a > t * 1.1 ? ' <b style="color:#d97706">избыток</b>' : ''); };
        h = '<div class="pp-tiles">' + [['Площадь', nf(A, 2) + ' га', '', '#6366f1'], ['Затраты', rub(R.cost), nf(ha(R.cost), 0) + ' ₽/га', '#f59e0b'], ['Выручка', rub(R.rev), nf(R.net, 1) + ' т', '#0ea5e9'],
            ['Прибыль', rub(R.profit), nf(ha(R.profit), 0) + ' ₽/га', R.profit >= 0 ? '#16a34a' : '#dc2626'], ['Рентабельность', nf(R.margin, 0) + ' %', '', R.profit >= 0 ? '#16a34a' : '#dc2626'],
            ['Себестоимость', nf(R.costT, 0) + ' ₽/т', 'безубыточность ' + nf(R.beY, 1) + ' ц/га', '#8b5cf6']].map(tileH).join('') + '</div>';
        var cats = [['Семена и протравливание', R.cSeed + R.cTrt, '#16a34a'], ['Удобрения', R.cFert, '#a855f7'], ['Средства защиты растений', R.cPest, '#ef4444'], ['Топливо', R.cFuel, '#f59e0b'], ['Прочие затраты', R.cOther, '#64748b']];
        h += chartH('Структура затрат', cats.map(function (c) { var p = R.cost > 0 ? c[1] / R.cost * 100 : 0; return '<div class="ag-bar"><span>' + c[0] + '</span><div><i style="width:' + p.toFixed(1) + '%;background:' + c[2] + '"></i></div><b>' + nf(p, 0) + ' %</b></div>'; }).join(''), 'Доля каждой статьи в общих затратах.');
        h += chartH('Потребность в ресурсах', '<table class="pp-tbl">' + [['Семена', nf(R.seedKg, 0) + ' кг (' + nf(R.seedKgHa, 1) + ' кг/га)'], ['Протравитель', nf(R.trtL, 1) + ' л'],
            ['Азот N: внесено / цель', chk(R.sup.n, S.tgt.n)], ['Фосфор P₂O₅: внесено / цель', chk(R.sup.p, S.tgt.p)], ['Калий K₂O: внесено / цель', chk(R.sup.k, S.tgt.k)], ['Удобрения (физ. масса)', nf(R.tFert, 2) + ' т'],
            ['Топливо', nf(R.fuelL, 0) + ' л (' + nf(ha(R.fuelL), 1) + ' л/га)'], ['Машинное время', nf(R.hours, 0) + ' ч ≈ ' + nf(R.hours / 8, 1) + ' смен по 8 ч'], ['Сбор: валовой / после потерь', nf(R.gross, 1) + ' / ' + nf(R.net, 1) + ' т']]
            .map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>');
        h += chartH('Смета затрат', '<div class="pp-dyn-tw"><table class="ag-t"><thead><tr><th>Статья</th><th>Кол-во</th><th>Сумма, ₽</th><th>₽/га</th></tr></thead><tbody>' +
            R.rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td><td class="n">' + nf(r[2], 0) + '</td><td class="n">' + nf(ha(r[2]), 0) + '</td></tr>'; }).join('') +
            '<tr class="t"><td>Итого затрат</td><td></td><td class="n">' + nf(R.cost, 0) + '</td><td class="n">' + nf(ha(R.cost), 0) + '</td></tr></tbody></table></div>');
        var F = [0.8, 0.9, 1, 1.1, 1.2], cost = ha(R.cost);
        h += chartH('Чувствительность прибыли, ₽/га', '<div class="pp-dyn-tw"><table class="ag-t"><thead><tr><th>Урожай ↓ / цена →</th>' + F.map(function (f) { return '<th>' + (f === 1 ? 'база' : (f > 1 ? '+' : '−') + Math.round(Math.abs(f - 1) * 100) + ' %') + '</th>'; }).join('') + '</tr></thead><tbody>' +
            F.map(function (fy) { return '<tr><td>' + (fy === 1 ? 'база' : (fy > 1 ? '+' : '−') + Math.round(Math.abs(fy - 1) * 100) + ' %') + '</td>' + F.map(function (fp) { var v = S.yld * fy / 10 * (1 - S.loss / 100) * S.price * fp - cost; return '<td class="n" style="color:' + (v >= 0 ? '#16a34a' : '#dc2626') + '">' + nf(v, 0) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>',
            'Как меняется прибыль на гектар при отклонении урожайности и цены реализации; затраты не меняются.');
        out.innerHTML = h;
        var hint = function (k, t) { var el = pane.querySelector('[data-ag-hint="' + k + '"]'); if (el) el.innerHTML = t; };
        hint('seed', 'Расчётная норма высева: <b>' + nf(R.seedKgHa, 1) + ' кг/га</b> (с учётом посевной годности ' + nf(S.seed.pur * S.seed.germ / 100, 1) + ' %), всего <b>' + nf(R.seedKg, 0) + ' кг</b>.');
        hint('fert', 'Внесено д.в.: N <b>' + nf(R.sup.n, 0) + '</b> · P₂O₅ <b>' + nf(R.sup.p, 0) + '</b> · K₂O <b>' + nf(R.sup.k, 0) + '</b> кг/га; всего удобрений <b>' + nf(R.tFert, 2) + ' т</b>.');
        hint('ops', 'Топливо: <b>' + nf(R.fuelL, 0) + ' л</b>, машинное время: <b>' + nf(R.hours, 0) + ' ч</b> (производительность = захват × скорость × коэффициент / 10, га/ч). Строки без захвата и скорости в расчёт времени не входят.');
    }
    var changed = function () { render(); save(); };

    // ---------- экспорт сметы ----------
    function tableRows() {
        var R = last || calc(), ha = function (v) { return R.A > 0 ? Math.round(v / R.A) : ''; };
        return [['Статья', 'Количество', 'Сумма, ₽', '₽/га']].concat(R.rows.map(function (r) { return [r[0], r[1], Math.round(r[2]), ha(r[2])]; }),
            [['Итого затрат', '', Math.round(R.cost), ha(R.cost)], ['Выручка', nf(R.net, 1) + ' т', Math.round(R.rev), ha(R.rev)], ['Прибыль', '', Math.round(R.profit), ha(R.profit)]]);
    }
    function copyText(tx, b) {
        var ok = function () { var o = b.innerHTML; b.innerHTML = '<i class="fas fa-check"></i><span>Скопировано</span>'; setTimeout(function () { b.innerHTML = o; }, 1800); };
        var fb = function () { var ta = document.createElement('textarea'); ta.value = tx; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (er) { updateStatus('⚠️ Не удалось скопировать', true); } document.body.removeChild(ta); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tx).then(ok, fb); else fb();
    }

    // ---------- фигура: площадь берётся с карты ----------
    var st = { shape: null, gj: null, handler: null, tool: null, editing: false }, grp = L.featureGroup().addTo(map);
    var SO = { color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.08 };
    function toGJ(layer) {
        try {
            if (layer instanceof L.Circle) { var c = layer.getLatLng(); return turf.circle([c.lng, c.lat], layer.getRadius() / 1000, { steps: 64, units: 'kilometers' }); }
            var g = layer.toGeoJSON(), f = g.type === 'FeatureCollection' ? g.features[0] : g;
            if (f && f.geometry && /Polygon/.test(f.geometry.type)) return f;
        } catch (e) { /* не полигон */ }
        return null;
    }
    function mark() {
        pane.querySelectorAll('[data-ag-tool]').forEach(function (b) { b.classList.toggle('active', b.dataset.agTool === st.tool); });
        pane.querySelectorAll('[data-ag-act="edit"]').forEach(function (b) { b.classList.toggle('active', st.editing); });
    }
    function info() {
        var el = pane.querySelector('[data-ag-info]');
        el.innerHTML = st.gj ? 'Площадь взята из фигуры на карте — её можно поправить вручную.' : 'Нарисуйте участок, импортируйте контур или возьмите выбранную фигуру («рука») — либо просто введите площадь.';
    }
    function takeArea() {
        if (!st.gj) return;
        S.area = Math.round(turf.area(st.gj) / 100) / 100;
        var el = pane.querySelector('[data-ag="area"]'); if (el) el.value = S.area;
        changed();
    }
    function cancel() { if (st.handler) { try { st.handler.disable(); } catch (e) { /* уже выключен */ } st.handler = null; } st.tool = null; mark(); }
    function setEditing(on) {
        st.editing = !!(on && st.shape);
        if (st.editing) gcSelect(st.shape); else if (st.shape && st.shape === gcSel) gcDeselect();
        mark();
    }
    function setShape(layer) {
        setEditing(false); grp.clearLayers(); st.shape = layer; grp.addLayer(layer);
        gcShape(layer, { name: 'agro', onChange: function (l) { st.gj = toGJ(l); takeArea(); }, onDelete: del });
        st.gj = toGJ(layer); info(); takeArea();
    }
    function del() { cancel(); setEditing(false); grp.clearLayers(); st.shape = null; st.gj = null; info(); }
    function startTool(t) {
        if (typeof m3d !== 'undefined' && m3d.active) { updateStatus('ℹ️ Рисование работает в 2D — выключите 3D кнопкой «2D» на карте', true); return; }
        var same = st.tool === t;
        cancel(); setEditing(false);
        if (same) return;
        if (typeof deactivateAllTools === 'function') deactivateAllTools();
        st.tool = t; mark();
        st.handler = t === 'polygon' ? new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: SO })
            : t === 'rectangle' ? new L.Draw.Rectangle(map, { shapeOptions: SO, showArea: false }) : new L.Draw.Circle(map, { shapeOptions: SO, showRadius: true });
        st.handler.enable();
        updateStatus('✏️ Рисуйте участок для агрокалькулятора — будет создана одна фигура (прежняя заменится)');
    }
    window.agCancelTool = cancel;
    window.agClearAll = del;   // кнопка «Очистить» на карте
    window.agOnCreated = function (e) {
        if (!st.handler || !e.layer) return false;
        var layer = e.layer; cancel(); setShape(layer);
        layer.on('edit', function () { st.gj = toGJ(layer); takeArea(); });
        return true;
    };
    gcShapeIO.ag = {
        name: 'agro',
        get: function () { return gcFC(st.gj ? [st.gj] : []); },
        put: function (fc) {
            var f = fc.features.find(function (x) { return /Polygon/.test(x.geometry.type); });
            if (!f) { updateStatus('⚠️ В файле нет полигона', true); return; }
            cancel(); var l = L.geoJSON(f, { style: SO }).getLayers()[0]; setShape(l); map.fitBounds(l.getBounds());
        }
    };

    // ---------- события ----------
    pane.addEventListener('input', function (e) {
        var t = e.target, p = t.getAttribute('data-ag'), k = t.getAttribute('data-ag-a');
        if (t.tagName === 'SELECT') return;
        if (p) { pset(p, parseFloat(t.value) || 0); changed(); }
        else if (k) {
            var r = S[k][+t.dataset.i]; if (!r) return;
            r[t.dataset.k] = t.type === 'checkbox' ? (t.checked ? 1 : 0) : t.type === 'number' ? (parseFloat(t.value) || 0) : t.value;
            changed();
        }
    });
    pane.addEventListener('change', function (e) {
        var t = e.target, p = t.getAttribute('data-ag'), k = t.getAttribute('data-ag-a');
        if (p === 'crop') { var f = fresh(+t.value, S.area); S.crop = f.crop; S.seed = f.seed; S.yld = f.yld; S.price = f.price; S.tgt = f.tgt; S.fert = f.fert; body(); changed(); }
        else if (p === 'nform') { S.nform = +t.value; save(); }
        else if (k === 'fert' && t.dataset.k === 'f') { var r = S.fert[+t.dataset.i]; r.f = +t.value; r.price = FERT[r.f][4]; list('fert'); changed(); }
    });
    pane.addEventListener('click', function (e) {
        var t = e.target.closest('[data-ag-tool]'), a = e.target.closest('[data-ag-act]'), d = e.target.closest('[data-ag-del]'), ad = e.target.closest('[data-ag-add]');
        if (t) { startTool(t.dataset.agTool); return; }
        if (d) { S[d.dataset.agDel].splice(+d.dataset.i, 1); list(d.dataset.agDel); changed(); return; }
        if (ad) { S[ad.dataset.agAdd].push(NEW[ad.dataset.agAdd]()); list(ad.dataset.agAdd); changed(); return; }
        if (!a) return;
        var act = a.dataset.agAct;
        if (act === 'del') del();
        else if (act === 'edit') { if (st.shape) setEditing(!st.editing); }
        else if (act === 'sel') {
            var g = typeof gcSel !== 'undefined' && gcSel instanceof L.Path ? toGJ(gcSel) : null;
            if (!g) { updateStatus('ℹ️ Выберите на карте полигон, прямоугольник или круг (клик по фигуре)', true); return; }
            cancel(); setShape(L.geoJSON(g, { style: SO }).getLayers()[0]);
        } else if (act === 'auto') { S.fert = autoFert(S.tgt, S.nform); list('fert'); changed(); }
        else if (act === 'reset') { var f = fresh(S.crop, S.area); f.fuelPrice = S.fuelPrice; S = f; body(); changed(); }
        else if (act === 'copy') copyText(tableRows().map(function (r) { return r.join('\t'); }).join('\n'), a);
        else if (act === 'csv') {
            var csv = '\ufeff' + tableRows().map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
            gcSave(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'agro_smeta_' + CROPS[S.crop][0].toLowerCase().replace(/\s+/g, '_') + '.csv');
            updateStatus('💾 Смета сохранена в CSV');
        }
    });
    document.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('.bp-tab, .panel-tab');
        if (t && !(t.classList.contains('bp-tab') && t.dataset.bpTab === 'agro')) cancel();
    });
    info(); render();
})();
