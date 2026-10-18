/* ============================================================
   АГРОКАЛЬКУЛЯТОР ПО ПЛОЩАДИ — нижняя панель → «Инструменты» → «Агрокалькулятор»
   Площадь — из нарисованной/импортированной фигуры или вводится вручную.
   Модули: семена · удобрения · СЗР · работы и топливо · прочие затраты · урожай и экономика.
   Все нормы и цены по умолчанию — ориентировочные справочные значения: замените своими.
   ============================================================ */
(function () {
    var pane = document.querySelector('[data-bp-pane="agro"]'); if (!pane) return;

    // ---------- утилиты ----------
    var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ESC_MAP[c]; }); };
    var nf = function (v, d) { return isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: d == null ? 0 : d }) : '—'; };
    var rub = function (v) { return nf(v, 0) + ' ₽'; };
    var sum = function (a, k) { return a.reduce(function (s, x) { return s + (+x[k] || 0); }, 0); };
    var q = function (sel) { return pane.querySelector(sel); };
    var qa = function (sel) { return pane.querySelectorAll(sel); };

    // ---------- справочники ----------
    // культура: [название, норма высева млн всх./га, МТС г, чистота %, всхожесть %, цена семян ₽/кг, урожайность ц/га, цена реализации ₽/т, N, P2O5, K2O кг д.в./га]
    var CROP_ROWS = [['Озимая пшеница', 4.5, 40, 98, 92, 28, 55, 15000, 100, 50, 50], ['Яровая пшеница', 5, 36, 98, 92, 28, 35, 14000, 80, 40, 40],
        ['Яровой ячмень', 4, 45, 98, 92, 22, 38, 12000, 70, 40, 40], ['Кукуруза на зерно', 0.065, 300, 99, 95, 450, 70, 11000, 120, 60, 60],
        ['Подсолнечник', 0.06, 60, 98, 92, 1000, 25, 28000, 60, 40, 40], ['Соя', 0.55, 170, 98, 90, 45, 20, 33000, 20, 40, 60],
        ['Яровой рапс', 1, 4.5, 98, 90, 700, 18, 30000, 90, 50, 60], ['Горох', 1, 200, 98, 92, 25, 28, 15000, 20, 40, 40],
        ['Сахарная свёкла', 0.11, 12, 99, 90, 9000, 450, 4000, 100, 80, 120], ['Картофель', 0.05, 70000, 100, 95, 28, 300, 15000, 100, 80, 140],
        ['Своя культура', 1, 50, 98, 90, 30, 30, 15000, 60, 40, 40]];
    // удобрение: [название, N %, P2O5 %, K2O %, цена ₽/т]
    var FERT_ROWS = [['Аммиачная селитра (34,4 % N)', 34.4, 0, 0, 30000], ['Карбамид (46 % N)', 46, 0, 0, 33000], ['КАС-32 (32 % N)', 32, 0, 0, 22000], ['Аммофос (12:52)', 12, 52, 0, 52000],
        ['Нитроаммофоска (16:16:16)', 16, 16, 16, 40000], ['Двойной суперфосфат (46 % P₂O₅)', 0, 46, 0, 42000], ['Хлористый калий (60 % K₂O)', 0, 0, 60, 36000], ['Сульфат аммония (21 % N)', 21, 0, 0, 16000]];

    var CROPS = CROP_ROWS.map(function (a) {
        return { name: a[0], seedRate: a[1], mtc: a[2], purity: a[3], germ: a[4], seedPrice: a[5], yield: a[6], price: a[7], n: a[8], p: a[9], k: a[10] };
    });
    var FERT = FERT_ROWS.map(function (a) { return { name: a[0], n: a[1], p: a[2], k: a[3], price: a[4] }; });
    var F_AMMOPHOS = 3, F_KCL = 6;   // индексы в FERT: источники P и K для автоподбора
    var NFORMS = [0, 1, 2, 7];       // допустимые азотные формы

    // ---------- состояние ----------
    function autoFert(t, ni) {   // P — из аммофоса (он даёт и азот), K — из хлористого калия, остаток азота — выбранной азотной формой
        var r = [], aa = t.p > 0 ? t.p / 0.52 : 0, kc = t.k > 0 ? t.k / 0.6 : 0, nr = Math.max(0, t.n - aa * 0.12) / (FERT[ni].n / 100);
        if (aa) r.push({ f: F_AMMOPHOS, rate: Math.round(aa), price: FERT[F_AMMOPHOS].price });
        if (kc) r.push({ f: F_KCL, rate: Math.round(kc), price: FERT[F_KCL].price });
        if (nr > 0) r.push({ f: ni, rate: Math.round(nr), price: FERT[ni].price });
        return r;
    }
    function defaultPests() {
        return [{ n: 'Гербицид', d: 1, k: 1, p: 1200 }, { n: 'Фунгицид', d: 0.8, k: 2, p: 2000 }, { n: 'Инсектицид', d: 0.15, k: 1, p: 3000 }];
    }
    function defaultOps() {   // [название, л/га, захват м, скорость км/ч, раз, включена]
        return [['Вспашка', 20, 2.5, 8, 1, 0], ['Дискование', 6, 8, 10, 1, 1], ['Предпосевная культивация', 5, 12, 10, 1, 1], ['Посев', 5, 12, 8, 1, 1], ['Внесение удобрений', 2, 24, 12, 1, 1],
            ['Опрыскивание', 0.8, 24, 12, 3, 1], ['Уборка', 15, 7.5, 5, 1, 1], ['Транспортировка урожая', 3, 0, 0, 1, 1]]
            .map(function (o) { return { n: o[0], fu: o[1], w: o[2], v: o[3], k: o[4], on: o[5] }; });
    }
    function defaultOther() {
        return [['Аренда земли', 3000], ['Оплата труда', 1500], ['Амортизация и ремонт техники', 2500], ['Страхование', 500], ['Прочие расходы', 500]]
            .map(function (o) { return { n: o[0], v: o[1] }; });
    }
    function fresh(ci, area) {
        var c = CROPS[ci], t = { n: c.n, p: c.p, k: c.k };
        return { crop: ci, area: area || 100, seed: { kn: c.seedRate, mtc: c.mtc, pur: c.purity, germ: c.germ, price: c.seedPrice, trt: 1.5, trtp: 1500 }, yld: c.yield, price: c.price, loss: 3,
            tgt: t, nform: 0, fert: autoFert(t, 0), fuelPrice: 62, eff: 0.8, pest: defaultPests(), ops: defaultOps(), other: defaultOther() };
    }
    var KEY = 'gc_agro_v1', S = null;
    try { var j = JSON.parse(localStorage.getItem(KEY)); if (j && j.seed && j.tgt && Array.isArray(j.fert) && Array.isArray(j.pest) && Array.isArray(j.ops) && Array.isArray(j.other)) S = j; } catch (e) { /* нет сохранённых данных */ }
    S = S || fresh(0, 100);
    var save = function () { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* хранилище недоступно */ } };
    var pget = function (p) { return p.split('.').reduce(function (o, k) { return o[k]; }, S); };
    var pset = function (p, v) { var a = p.split('.'), l = a.pop(); a.reduce(function (o, k) { return o[k]; }, S)[l] = v; };
    var NEW_ROW = { fert: function () { return { f: 0, rate: 100, price: FERT[0].price }; }, pest: function () { return { n: 'Препарат', d: 1, k: 1, p: 1000 }; },
        ops: function () { return { n: 'Операция', fu: 5, w: 10, v: 10, k: 1, on: 1 }; }, other: function () { return { n: 'Статья затрат', v: 0 }; } };

    // ---------- интерфейс: примитивы ----------
    var inp = function (p, label, unit, step) { return '<div class="dw-row"><label>' + label + '</label><input type="number" min="0" step="' + (step || 'any') + '" data-ag="' + p + '" value="' + pget(p) + '"><span class="ag-u">' + unit + '</span></div>'; };
    var sec = function (t, icon, body) { return '<details class="dw-block ag-sec" open><summary class="dw-title"><i class="fas fa-' + icon + '"></i> ' + t + '</summary>' + body + '</details>'; };
    var num = function (k, i, f, v) { return '<input type="number" min="0" step="any" data-ag-a="' + k + '" data-i="' + i + '" data-k="' + f + '" value="' + v + '">'; };
    var txt = function (k, i, f, v) { return '<input type="text" data-ag-a="' + k + '" data-i="' + i + '" data-k="' + f + '" value="' + esc(v) + '">'; };
    var xb = function (k, i) { return '<button type="button" class="ag-x" data-ag-del="' + k + '" data-i="' + i + '" title="Убрать строку">×</button>'; };
    var row = function (g, inner, h) { return '<div class="ag-r' + (h ? ' ag-h' : '') + '" style="--g:' + g + '">' + inner + '</div>'; };
    var fopts = function (sel, only) { return FERT.map(function (f, i) { return !only || only.indexOf(i) >= 0 ? '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + f.name + '</option>' : ''; }).join(''); };
    var tileH = function (t) { return '<div class="pp-tile" style="--c:' + t[3] + '"><span>' + t[0] + '</span><b>' + t[1] + '</b>' + (t[2] ? '<em>' + t[2] + '</em>' : '') + '</div>'; };
    var chartH = function (t, inner, cap) { return '<div class="pp-ch"><h5>' + t + '</h5>' + inner + (cap ? '<div class="pp-cap">' + cap + '</div>' : '') + '</div>'; };
    var mapBtn = function (attrs, title, icon) { return '<button type="button" class="map-btn" ' + attrs + ' title="' + title + '"><i class="' + icon + '"></i></button>'; };
    var goBtn = function (act, icon, label, cls) { return '<button type="button" class="ag-go' + (cls ? ' ' + cls : '') + '" data-ag-act="' + act + '"><i class="fas fa-' + icon + '"></i><span>' + label + '</span></button>'; };

    // ---------- интерфейс: редактируемые списки ----------
    // Каждый список: сетка колонок, заголовки и функция отрисовки ячеек строки.
    var LISTS = {
        fert: { grid: '1fr 62px 62px 22px', head: ['Удобрение', 'кг/га', '₽/т', ''],
            cells: function (k, r, i) { return '<select data-ag-a="fert" data-i="' + i + '" data-k="f">' + fopts(+r.f) + '</select>' + num(k, i, 'rate', r.rate) + num(k, i, 'price', r.price) + xb(k, i); } },
        pest: { grid: '1fr 54px 40px 62px 22px', head: ['Препарат', 'л/га', 'раз', '₽/л', ''],
            cells: function (k, r, i) { return txt(k, i, 'n', r.n) + num(k, i, 'd', r.d) + num(k, i, 'k', r.k) + num(k, i, 'p', r.p) + xb(k, i); } },
        ops: { grid: '18px 1fr 48px 48px 46px 38px 22px', head: ['', 'Операция', 'л/га', 'захват, м', 'км/ч', 'раз', ''],
            cells: function (k, r, i) {
                return '<input type="checkbox" data-ag-a="ops" data-i="' + i + '" data-k="on"' + (r.on ? ' checked' : '') + '>' + txt(k, i, 'n', r.n) +
                    num(k, i, 'fu', r.fu) + num(k, i, 'w', r.w) + num(k, i, 'v', r.v) + num(k, i, 'k', r.k) + xb(k, i);
            } },
        other: { grid: '1fr 84px 22px', head: ['Статья', '₽/га', ''],
            cells: function (k, r, i) { return txt(k, i, 'n', r.n) + num(k, i, 'v', r.v) + xb(k, i); } }
    };
    function listHtml(k) {
        var L = LISTS[k], h = row(L.grid, L.head.map(function (t) { return '<span>' + t + '</span>'; }).join(''), 1);
        S[k].forEach(function (r, i) { h += row(L.grid, L.cells(k, r, i)); });
        return h + '<button type="button" class="ag-add" data-ag-add="' + k + '"><i class="fas fa-plus"></i> Добавить строку</button>';
    }
    function list(k) { var el = q('[data-ag-list="' + k + '"]'); if (el) el.innerHTML = listHtml(k); }
    var listBox = function (k) { return '<div data-ag-list="' + k + '">' + listHtml(k) + '</div>'; };
    var hintBox = function (k) { return '<div class="an-hint" data-ag-hint="' + k + '"></div>'; };

    // ---------- интерфейс: разделы панели ----------
    function body() {
        q('[data-ag-body]').innerHTML =
            sec('Семена', 'seedling', inp('seed.kn', 'Норма высева', 'млн всх./га', 0.001) + inp('seed.mtc', 'Масса 1000 семян', 'г') + inp('seed.pur', 'Чистота', '%') + inp('seed.germ', 'Всхожесть', '%') +
                inp('seed.price', 'Цена семян', '₽/кг') + inp('seed.trt', 'Протравитель', 'л/т') + inp('seed.trtp', 'Цена протравителя', '₽/л') + hintBox('seed')) +
            sec('Удобрения', 'flask', '<div class="m3-hint">Целевые нормы действующего вещества (д.в.) — по культуре; замените своими.</div>' + inp('tgt.n', 'Азот N', 'кг д.в./га') + inp('tgt.p', 'Фосфор P₂O₅', 'кг д.в./га') + inp('tgt.k', 'Калий K₂O', 'кг д.в./га') +
                '<div class="dw-row"><label>Азотная форма</label><select data-ag="nform">' + fopts(S.nform, NFORMS) + '</select></div>' +
                goBtn('auto', 'wand-magic-sparkles', 'Подобрать удобрения под целевые д.в.') + listBox('fert') + hintBox('fert')) +
            sec('Средства защиты растений', 'bug', listBox('pest')) +
            sec('Работы и топливо', 'tractor', inp('fuelPrice', 'Цена дизельного топлива', '₽/л') + inp('eff', 'Коэффициент использования времени', '0–1', 0.01) + listBox('ops') + hintBox('ops')) +
            sec('Прочие затраты', 'coins', listBox('other')) +
            sec('Урожай и реализация', 'wheat-awn', inp('yld', 'Урожайность', 'ц/га') + inp('price', 'Цена реализации', '₽/т') + inp('loss', 'Потери и подработка', '%'));
    }
    function areaBlockHtml() {
        return '<div class="dw-block"><div class="dw-title">Площадь и культура</div><div class="an-draw">' +
            mapBtn('data-ag-tool="polygon"', 'Полигон', 'gc-pent') +
            mapBtn('data-ag-tool="rectangle"', 'Прямоугольник', 'fas fa-vector-square') +
            mapBtn('data-ag-tool="circle"', 'Круг / Овал', 'fas fa-circle') +
            mapBtn('data-ag-act="edit"', 'Редактировать фигуру', 'fas fa-edit') +
            mapBtn('data-ag-act="sel"', 'Взять фигуру, выбранную на карте', 'fas fa-hand-pointer') +
            mapBtn('data-ag-act="del"', 'Удалить фигуру', 'fas fa-trash') +
            mapBtn('data-gc-io="import" data-gc-for="ag"', 'Импорт полигона (KML, GeoJSON, Excel, XML Росреестра)', 'fas fa-file-import') +
            mapBtn('data-gc-io="export" data-gc-for="ag"', 'Экспорт фигуры (KML, GeoJSON)', 'fas fa-file-export') + '</div>' +
            '<div class="an-hint" data-ag-info></div>' + inp('area', 'Площадь', 'га', 0.01) +
            '<div class="dw-row"><label>Культура</label><select data-ag="crop">' + CROPS.map(function (c, i) { return '<option value="' + i + '"' + (i === S.crop ? ' selected' : '') + '>' + c.name + '</option>'; }).join('') + '</select></div>' +
            '<div class="m3-hint">Нормы, цены и расход по умолчанию — ориентировочные. Выбор культуры подставляет типовые значения; все поля можно менять, введённое сохраняется в браузере.</div></div>';
    }
    function actionsBlockHtml() {
        return '<div class="dw-block"><div class="ag-btns">' + goBtn('copy', 'copy', 'Копировать смету') + goBtn('csv', 'file-csv', 'Скачать CSV') +
            goBtn('reset', 'rotate-left', 'Значения культуры по умолчанию', 'ag-lt') + '</div></div>';
    }
    pane.innerHTML = areaBlockHtml() + '<div class="dw-block"><div class="dw-title">Итоги расчёта</div><div data-ag-out></div></div><div data-ag-body></div>' + actionsBlockHtml();
    body();

    // ---------- расчёт ----------
    function calcSeeds(R, A) {
        var s = S.seed, pg = (s.pur * s.germ) / 1e4;
        R.seedKgHa = pg > 0 ? s.kn * s.mtc / pg : 0; R.seedKg = R.seedKgHa * A;   // млн шт/га × г/1000 шт = кг/га; делим на посевную годность
        R.cSeed = R.seedKg * s.price; R.trtL = R.seedKg / 1000 * s.trt; R.cTrt = R.trtL * s.trtp;
    }
    function calcFert(R, A) {
        var sup = { n: 0, p: 0, k: 0 };
        R.fert = S.fert.map(function (r) {
            var f = FERT[r.f] || FERT[0], kg = +r.rate || 0, t = kg * A / 1000;
            sup.n += kg * f.n / 100; sup.p += kg * f.p / 100; sup.k += kg * f.k / 100;
            return { n: f.name, t: t, c: t * (+r.price || 0) };
        });
        R.sup = sup; R.cFert = sum(R.fert, 'c'); R.tFert = sum(R.fert, 't');
    }
    function calcPest(R, A) {
        R.pest = S.pest.map(function (r) { var qty = (+r.d || 0) * (+r.k || 0) * A; return { n: r.n, q: qty, c: qty * (+r.p || 0) }; });
        R.cPest = sum(R.pest, 'c');
    }
    function calcOps(R, A) {
        R.fuelL = 0; R.hours = 0;
        S.ops.forEach(function (o) {
            if (!o.on) return;
            var k = +o.k || 0, pr = (+o.w || 0) * (+o.v || 0) * (+S.eff || 0) / 10;
            R.fuelL += (+o.fu || 0) * k * A;
            if (pr > 0) R.hours += A * k / pr;   // производительность, га/ч = захват × скорость × КИВ / 10
        });
        R.cFuel = R.fuelL * (+S.fuelPrice || 0);
    }
    function calcEconomy(R, A) {
        R.other = S.other.map(function (o) { return { n: o.n, c: (+o.v || 0) * A }; }); R.cOther = sum(R.other, 'c');
        R.cost = R.cSeed + R.cTrt + R.cFert + R.cPest + R.cFuel + R.cOther;
        R.gross = S.yld / 10 * A; R.net = R.gross * (1 - S.loss / 100); R.rev = R.net * S.price;
        R.profit = R.rev - R.cost; R.margin = R.cost > 0 ? R.profit / R.cost * 100 : NaN; R.costT = R.net > 0 ? R.cost / R.net : NaN;
        R.beY = S.price > 0 && A > 0 && S.loss < 100 ? R.cost / A / (S.price * (1 - S.loss / 100)) * 10 : NaN;   // урожайность безубыточности, ц/га
    }
    function calcRows(R) {
        R.rows = [['Семена', nf(R.seedKg, 0) + ' кг', R.cSeed], ['Протравитель семян', nf(R.trtL, 1) + ' л', R.cTrt]]
            .concat(R.fert.map(function (x) { return [x.n, nf(x.t, 2) + ' т', x.c]; }), R.pest.map(function (x) { return [x.n, nf(x.q, 1) + ' л/кг', x.c]; }),
                [['Топливо', nf(R.fuelL, 0) + ' л', R.cFuel]], R.other.map(function (x) { return [x.n, '', x.c]; })).filter(function (r) { return r[2] > 0; });
    }
    function calc() {
        var A = Math.max(0, +S.area || 0), R = { A: A };
        calcSeeds(R, A); calcFert(R, A); calcPest(R, A); calcOps(R, A); calcEconomy(R, A); calcRows(R);
        return R;
    }

    // ---------- вывод результатов ----------
    var last = null;
    var perHa = function (R, v) { return R.A > 0 ? v / R.A : NaN; };
    var pctLabel = function (f) { return f === 1 ? 'база' : (f > 1 ? '+' : '−') + Math.round(Math.abs(f - 1) * 100) + ' %'; };
    var tableWrap = function (head, rows) { return '<div class="pp-dyn-tw"><table class="ag-t"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>'; };

    function tilesHtml(R) {
        var ha = perHa.bind(null, R), good = R.profit >= 0 ? '#16a34a' : '#dc2626';
        return '<div class="pp-tiles">' + [['Площадь', nf(R.A, 2) + ' га', '', '#6366f1'], ['Затраты', rub(R.cost), nf(ha(R.cost), 0) + ' ₽/га', '#f59e0b'], ['Выручка', rub(R.rev), nf(R.net, 1) + ' т', '#0ea5e9'],
            ['Прибыль', rub(R.profit), nf(ha(R.profit), 0) + ' ₽/га', good], ['Рентабельность', nf(R.margin, 0) + ' %', '', good],
            ['Себестоимость', nf(R.costT, 0) + ' ₽/т', 'безубыточность ' + nf(R.beY, 1) + ' ц/га', '#8b5cf6']].map(tileH).join('') + '</div>';
    }
    function costStructureHtml(R) {
        var cats = [['Семена и протравливание', R.cSeed + R.cTrt, '#16a34a'], ['Удобрения', R.cFert, '#a855f7'], ['Средства защиты растений', R.cPest, '#ef4444'], ['Топливо', R.cFuel, '#f59e0b'], ['Прочие затраты', R.cOther, '#64748b']];
        return chartH('Структура затрат', cats.map(function (c) {
            var p = R.cost > 0 ? c[1] / R.cost * 100 : 0;
            return '<div class="ag-bar"><span>' + c[0] + '</span><div><i style="width:' + p.toFixed(1) + '%;background:' + c[2] + '"></i></div><b>' + nf(p, 0) + ' %</b></div>';
        }).join(''), 'Доля каждой статьи в общих затратах.');
    }
    function resourcesHtml(R) {
        var ha = perHa.bind(null, R);
        var chk = function (a, t) { return nf(a, 0) + ' / ' + nf(t, 0) + ' кг/га' + (t > 0 && a < t * 0.97 ? ' <b style="color:#dc2626">недобор</b>' : t > 0 && a > t * 1.1 ? ' <b style="color:#d97706">избыток</b>' : ''); };
        return chartH('Потребность в ресурсах', '<table class="pp-tbl">' + [['Семена', nf(R.seedKg, 0) + ' кг (' + nf(R.seedKgHa, 1) + ' кг/га)'], ['Протравитель', nf(R.trtL, 1) + ' л'],
            ['Азот N: внесено / цель', chk(R.sup.n, S.tgt.n)], ['Фосфор P₂O₅: внесено / цель', chk(R.sup.p, S.tgt.p)], ['Калий K₂O: внесено / цель', chk(R.sup.k, S.tgt.k)], ['Удобрения (физ. масса)', nf(R.tFert, 2) + ' т'],
            ['Топливо', nf(R.fuelL, 0) + ' л (' + nf(ha(R.fuelL), 1) + ' л/га)'], ['Машинное время', nf(R.hours, 0) + ' ч ≈ ' + nf(R.hours / 8, 1) + ' смен по 8 ч'], ['Сбор: валовой / после потерь', nf(R.gross, 1) + ' / ' + nf(R.net, 1) + ' т']]
            .map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>');
    }
    function estimateHtml(R) {
        var ha = perHa.bind(null, R);
        return chartH('Смета затрат', tableWrap('<th>Статья</th><th>Кол-во</th><th>Сумма, ₽</th><th>₽/га</th>',
            R.rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td><td class="n">' + nf(r[2], 0) + '</td><td class="n">' + nf(ha(r[2]), 0) + '</td></tr>'; }).join('') +
            '<tr class="t"><td>Итого затрат</td><td></td><td class="n">' + nf(R.cost, 0) + '</td><td class="n">' + nf(ha(R.cost), 0) + '</td></tr>'));
    }
    function sensitivityHtml(R) {
        var F = [0.8, 0.9, 1, 1.1, 1.2], cost = perHa(R, R.cost);
        return chartH('Чувствительность прибыли, ₽/га', tableWrap('<th>Урожай ↓ / цена →</th>' + F.map(function (f) { return '<th>' + pctLabel(f) + '</th>'; }).join(''),
            F.map(function (fy) {
                return '<tr><td>' + pctLabel(fy) + '</td>' + F.map(function (fp) {
                    var v = S.yld * fy / 10 * (1 - S.loss / 100) * S.price * fp - cost;
                    return '<td class="n" style="color:' + (v >= 0 ? '#16a34a' : '#dc2626') + '">' + nf(v, 0) + '</td>';
                }).join('') + '</tr>';
            }).join('')),
            'Как меняется прибыль на гектар при отклонении урожайности и цены реализации; затраты не меняются.');
    }
    function setHint(k, t) { var el = q('[data-ag-hint="' + k + '"]'); if (el) el.innerHTML = t; }
    function updateHints(R) {
        setHint('seed', 'Расчётная норма высева: <b>' + nf(R.seedKgHa, 1) + ' кг/га</b> (с учётом посевной годности ' + nf(S.seed.pur * S.seed.germ / 100, 1) + ' %), всего <b>' + nf(R.seedKg, 0) + ' кг</b>.');
        setHint('fert', 'Внесено д.в.: N <b>' + nf(R.sup.n, 0) + '</b> · P₂O₅ <b>' + nf(R.sup.p, 0) + '</b> · K₂O <b>' + nf(R.sup.k, 0) + '</b> кг/га; всего удобрений <b>' + nf(R.tFert, 2) + ' т</b>.');
        setHint('ops', 'Топливо: <b>' + nf(R.fuelL, 0) + ' л</b>, машинное время: <b>' + nf(R.hours, 0) + ' ч</b> (производительность = захват × скорость × коэффициент / 10, га/ч). Строки без захвата и скорости в расчёт времени не входят.');
    }
    function render() {
        var R = last = calc();
        q('[data-ag-out]').innerHTML = tilesHtml(R) + costStructureHtml(R) + resourcesHtml(R) + estimateHtml(R) + sensitivityHtml(R);
        updateHints(R);
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
        var fb = function () {
            var ta = document.createElement('textarea'); ta.value = tx; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); ok(); } catch (er) { updateStatus('⚠️ Не удалось скопировать', true); }
            document.body.removeChild(ta);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tx).then(ok, fb); else fb();
    }
    function csvText() {
        return '\ufeff' + tableRows().map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    }
    function saveCsv() {
        gcSave(new Blob([csvText()], { type: 'text/csv;charset=utf-8' }), 'agro_smeta_' + CROPS[S.crop].name.toLowerCase().replace(/\s+/g, '_') + '.csv');
        updateStatus('💾 Смета сохранена в CSV');
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
        qa('[data-ag-tool]').forEach(function (b) { b.classList.toggle('active', b.dataset.agTool === st.tool); });
        qa('[data-ag-act="edit"]').forEach(function (b) { b.classList.toggle('active', st.editing); });
    }
    function info() {
        q('[data-ag-info]').innerHTML = st.gj ? 'Площадь взята из фигуры на карте — её можно поправить вручную.' : 'Нарисуйте участок, импортируйте контур или возьмите выбранную фигуру («рука») — либо просто введите площадь.';
    }
    function takeArea() {
        if (!st.gj) return;
        S.area = Math.round(turf.area(st.gj) / 100) / 100;
        var el = q('[data-ag="area"]'); if (el) el.value = S.area;
        changed();
    }
    function syncShape(layer) { st.gj = toGJ(layer); takeArea(); }
    function cancel() { if (st.handler) { try { st.handler.disable(); } catch (e) { /* уже выключен */ } st.handler = null; } st.tool = null; mark(); }
    function setEditing(on) {
        st.editing = !!(on && st.shape);
        if (st.editing) gcSelect(st.shape); else if (st.shape && st.shape === gcSel) gcDeselect();
        mark();
    }
    function setShape(layer) {
        setEditing(false); grp.clearLayers(); st.shape = layer; grp.addLayer(layer);
        gcShape(layer, { name: 'agro', onChange: syncShape, onDelete: del });
        st.gj = toGJ(layer); info(); takeArea();
    }
    function del() { cancel(); setEditing(false); grp.clearLayers(); st.shape = null; st.gj = null; info(); }
    function createDrawHandler(t) {
        if (t === 'polygon') return new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: SO });
        if (t === 'rectangle') return new L.Draw.Rectangle(map, { shapeOptions: SO, showArea: false });
        return new L.Draw.Circle(map, { shapeOptions: SO, showRadius: true });
    }
    function startTool(t) {
        if (typeof m3d !== 'undefined' && m3d.active) { updateStatus('ℹ️ Рисование работает в 2D — выключите 3D кнопкой «2D» на карте', true); return; }
        var same = st.tool === t;
        cancel(); setEditing(false);
        if (same) return;
        if (typeof deactivateAllTools === 'function') deactivateAllTools();
        st.tool = t; mark();
        st.handler = createDrawHandler(t);
        st.handler.enable();
        updateStatus('✏️ Рисуйте участок для агрокалькулятора — будет создана одна фигура (прежняя заменится)');
    }
    function takeSelectedShape() {
        var g = typeof gcSel !== 'undefined' && gcSel instanceof L.Path ? toGJ(gcSel) : null;
        if (!g) { updateStatus('ℹ️ Выберите на карте полигон, прямоугольник или круг (клик по фигуре)', true); return; }
        cancel(); setShape(L.geoJSON(g, { style: SO }).getLayers()[0]);
    }
    window.agCancelTool = cancel;
    window.agClearAll = del;   // кнопка «Очистить» на карте
    window.agOnCreated = function (e) {
        if (!st.handler || !e.layer) return false;
        var layer = e.layer; cancel(); setShape(layer);
        layer.on('edit', function () { syncShape(layer); });
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
    var ACTIONS = {
        del: del,
        edit: function () { if (st.shape) setEditing(!st.editing); },
        sel: takeSelectedShape,
        auto: function () { S.fert = autoFert(S.tgt, S.nform); list('fert'); changed(); },
        reset: function () { var f = fresh(S.crop, S.area); f.fuelPrice = S.fuelPrice; S = f; body(); changed(); },
        copy: function (btn) { copyText(tableRows().map(function (r) { return r.join('\t'); }).join('\n'), btn); },
        csv: saveCsv
    };
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
        else if (k === 'fert' && t.dataset.k === 'f') { var r = S.fert[+t.dataset.i]; r.f = +t.value; r.price = FERT[r.f].price; list('fert'); changed(); }
    });
    pane.addEventListener('click', function (e) {
        var t = e.target.closest('[data-ag-tool]'), a = e.target.closest('[data-ag-act]'), d = e.target.closest('[data-ag-del]'), ad = e.target.closest('[data-ag-add]');
        if (t) { startTool(t.dataset.agTool); return; }
        if (d) { S[d.dataset.agDel].splice(+d.dataset.i, 1); list(d.dataset.agDel); changed(); return; }
        if (ad) { S[ad.dataset.agAdd].push(NEW_ROW[ad.dataset.agAdd]()); list(ad.dataset.agAdd); changed(); return; }
        if (!a) return;
        var act = ACTIONS[a.dataset.agAct];
        if (act) act(a);
    });
    document.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('.bp-tab, .panel-tab');
        if (t && !(t.classList.contains('bp-tab') && t.dataset.bpTab === 'agro')) cancel();
    });
    info(); render();
})();
