// ============================================================
//  ЛОКАЛИЗАЦИЯ LEAFLET DRAW НА РУССКИЙ
// ============================================================

L.drawLocal = {
    draw: {
        toolbar: {
            actions: {
                title: 'Отменить рисование',
                text: 'Отмена'
            },
            finish: {
                title: 'Завершить рисование',
                text: 'Готово'
            },
            undo: {
                title: 'Удалить последнюю точку',
                text: 'Удалить точку'
            },
            buttons: {
                polyline: 'Рисовать линию',
                polygon: 'Рисовать полигон',
                rectangle: 'Рисовать прямоугольник',
                circle: 'Рисовать круг',
                marker: 'Поставить маркер',
                circlemarker: 'Поставить круговой маркер'
            }
        },
        handlers: {
            circle: {
                tooltip: {
                    start: 'Нажмите и перетащите, чтобы нарисовать круг.'
                },
                radius: 'Радиус'
            },
            circlemarker: {
                tooltip: {
                    start: 'Нажмите на карту, чтобы поставить маркер.'
                }
            },
            marker: {
                tooltip: {
                    start: 'Нажмите на карту, чтобы поставить маркер.'
                }
            },
            polygon: {
                tooltip: {
                    start: 'Нажмите, чтобы начать рисование полигона.',
                    cont: 'Нажмите, чтобы продолжить рисование полигона.',
                    end: 'Нажмите на первую точку, чтобы завершить полигон.'
                }
            },
            polyline: {
                tooltip: {
                    start: 'Нажмите, чтобы начать рисование линии.',
                    cont: 'Нажмите, чтобы продолжить рисование линии.',
                    end: 'Двойной клик для завершения линии.'
                }
            },
            rectangle: {
                tooltip: {
                    start: 'Нажмите и перетащите, чтобы нарисовать прямоугольник.'
                }
            },
            simpleshape: {
                tooltip: {
                    end: 'Отпустите, чтобы завершить рисование.'
                }
            }
        }
    },
    edit: {
        toolbar: {
            actions: {
                save: {
                    title: 'Сохранить изменения',
                    text: 'Сохранить'
                },
                cancel: {
                    title: 'Отменить изменения',
                    text: 'Отмена'
                },
                clearAll: {
                    title: 'Очистить все слои',
                    text: 'Очистить всё'
                }
            },
            buttons: {
                edit: 'Редактировать слои',
                editDisabled: 'Нет слоёв для редактирования',
                remove: 'Удалить слои',
                removeDisabled: 'Нет слоёв для удаления'
            }
        },
        handlers: {
            edit: {
                tooltip: {
                    text: 'Перетащите маркеры или вершины для редактирования.',
                    subtext: 'Нажмите "Отмена" для отмены изменений.'
                }
            },
            remove: {
                tooltip: {
                    text: 'Нажмите на объект, чтобы удалить его.'
                }
            }
        }
    }
};

// ============================================================
//  script.js — GeoClass: Карта + рисование + интерфейс ArcGIS
// ============================================================

// ---------- ИНИЦИАЛИЗАЦИЯ КАРТЫ ----------
// rotate: true — вращение карты обеспечивает плагин leaflet-rotate.
// Если плагин не загрузился, карта работает как раньше (без поворота).
const map = L.map('map', {
    zoomControl: false,
    rotate: true,
    bearing: 0,
    rotateControl: false,   // свою кнопку «Стрелка севера» делаем в левой панели
    touchRotate: true,
    shiftKeyRotate: true    // Shift + колесо мыши тоже вращает карту
}).setView([55.76, 37.62], 10);

// ---------- ПОДЛОЖКИ ----------
const GOOGLE_SUBDOMAINS = ['mt0', 'mt1', 'mt2', 'mt3'];
const ESRI_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// lyrs: m — схема, s — спутник, y — гибрид
function googleTiles(lyrs, options = {}) {
    return L.tileLayer(`https://{s}.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`, Object.assign({
        attribution: '&copy; Google',
        maxZoom: 20,
        subdomains: GOOGLE_SUBDOMAINS
    }, options));
}

function esriTiles(attribution) {
    return L.tileLayer(ESRI_IMAGERY_URL, { attribution, maxZoom: 19 });
}

// Esri Sentinel-2 10m Land Cover (Impact Observatory / Microsoft / Esri) — классификация земной поверхности.
// Это ImageServer без готового тайлового кэша, поэтому каждый тайл запрашивается через exportImage
// по границам тайла (EPSG:3857). По умолчанию сервис отдаёт самый свежий год.
const ESRI_LANDCOVER_EXPORT_URL = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage';

function esriLandCoverUrl(bbox, px) {
    const rule = encodeURIComponent(JSON.stringify({
        rasterFunction: 'Cartographic Renderer for Visualization and Analysis'
    }));
    return `${ESRI_LANDCOVER_EXPORT_URL}?f=image&bbox=${bbox.join(',')}&bboxSR=3857&imageSR=3857` +
           `&size=${px},${px}&format=png32&transparent=true&renderingRule=${rule}`;
}

const EsriLandCoverLayer = L.TileLayer.extend({
    getTileUrl: function (coords) {
        const b = this._tileCoordsToBounds(coords);
        const nw = L.CRS.EPSG3857.project(b.getNorthWest());
        const se = L.CRS.EPSG3857.project(b.getSouthEast());
        return esriLandCoverUrl([nw.x, se.y, se.x, nw.y], this.getTileSize().x);
    }
});

// Фабрики подложек. Каждый вызов создаёт НОВЫЙ слой: один экземпляр L.TileLayer нельзя держать
// сразу на двух картах, а в режиме «Шторка» слева и справа работают отдельные карты.
const ESRI_SERVICES = 'https://server.arcgisonline.com/ArcGIS/rest/services';

// Кэшированные (тайловые) сервисы Esri — публичные, ключ не нужен.
function esriCached(path, attribution, maxNativeZoom, options = {}) {
    return L.tileLayer(`${ESRI_SERVICES}/${path}/MapServer/tile/{z}/{y}/{x}`, Object.assign({
        attribution, maxZoom: 19, maxNativeZoom
    }, options));
}

// Составной слой (основа + данные + подписи) с методом redraw(), как у обычного тайлового слоя
const CompositeTileLayer = L.LayerGroup.extend({
    redraw: function () {
        this.eachLayer(l => { if (l.redraw) l.redraw(); });
        return this;
    }
});

// ISRIC SoilGrids 250 м — глобальные цифровые карты свойств почв (CC BY 4.0).
// Это те же данные, что лежат в Esri Living Atlas «World Soils 250m», но отдаются публичным WMS без токена.
// Показываем среднее прогнозное значение для верхнего слоя почвы 0–5 см.
const SOILGRIDS_WMS_URL = 'https://maps.isric.org/mapserv?map=/map/';
function soilGridsLayer(property, depth = '0-5cm') {
    const base = esriCached('Canvas/World_Light_Gray_Base', '&copy; Esri', 16, { zIndex: 1 });
    const data = L.tileLayer.wms(`${SOILGRIDS_WMS_URL}${property}.map`, {
        layers: `${property}_${depth}_mean`,
        version: '1.3.0',
        format: 'image/png',
        transparent: true,
        opacity: 0.8,
        maxZoom: 19,
        zIndex: 2,
        attribution: '&copy; ISRIC SoilGrids (CC BY 4.0)'
    });
    const labels = esriCached('Canvas/World_Light_Gray_Reference', '', 16, { zIndex: 3 });
    return new CompositeTileLayer([base, data, labels]);
}

// Bing Maps (quadkey-схема): a — снимки, h — снимки с подписями
function bingQuadKey(x, y, z) {
    let q = '';
    for (let i = z; i > 0; i--) {
        const m = 1 << (i - 1);
        q += (x & m ? 1 : 0) + (y & m ? 2 : 0);
    }
    return q;
}
const BingLayer = L.TileLayer.extend({
    getTileUrl: function (coords) {
        const z = this._getZoomForUrl();
        return `https://ecn.t${this._getSubdomain(coords)}.tiles.virtualearth.net/tiles/${this.options.bingType}` +
               `${bingQuadKey(coords.x, coords.y, z)}.jpeg?g=1`;
    }
});
function bingTiles(type) {
    return new BingLayer('', {
        bingType: type, subdomains: '0123', attribution: '&copy; Microsoft Bing', maxZoom: 19, maxNativeZoom: 19
    });
}

// NASA GIBS VIIRS True Color: берём дату «2 дня назад», чтобы снимок уже был обработан
function nasaViirsDate() {
    const d = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
}

// Основа + слой поверх (дороги, подписи, ж/д, морские знаки и т.д.)
function overlayLayer(base, ...overlays) {
    return new CompositeTileLayer([base].concat(overlays));
}

// ============================================================
//  SENTINEL-2: реальные снимки по датам.
//  Каталог (даты, облачность): AWS Earth Search. Сами снимки читаются прямо в браузере
//  из облачных GeoTIFF (COG) на AWS S3 — без ключей и без сторонних серверов тайлов.
//  Подложки sentinel2 / ndvi / ndwi / modified_ndwi рисуются по выбранной дате;
//  панель выбора даты и облачности открывается при выборе такой подложки.
// ============================================================
const SENTINEL = {
    stacUrl: 'https://earth-search.aws.element84.com/v1',
    renderer: 'cog',
    maxCC: 30,
    state: {},     // key -> { date, scenes, scene, cc }
    live: [],      // созданные слои Sentinel (основная карта, шторка)
    items: {}, files: {}, projs: {},
    queue: [], running: 0, warned: false, hostIdx: 0,
    contrast: { min: 0.2, max: 0.9 },   // диапазон шкалы «Контрастного NDVI»
    maxJobs: 6,                       // одновременных расчётов тайлов (лимит браузера — 6 соединений на хост)
    tileMem: new Map(), tileMemMax: 300,   // кэш готовых тайлов в памяти
    pool: undefined, proxyOk: undefined, lastDay: ''
};

// какие каналы нужны подложке
const SN_ASSETS = { sentinel2: ['visual'], ndvi: ['red', 'nir'], ndwi: ['green', 'nir'], modified_ndwi: ['green', 'swir16'], ndmi: ['nir', 'swir16'], nbr: ['nir', 'swir22'],
    falsecolor: ['nir', 'red', 'green'], ndvi_c: ['red', 'nir'] };
const SN_INDEX = {
    ndvi: (a, b) => (b - a) / (b + a),
    ndvi_c: (a, b) => (b - a) / (b + a),   // «Контрастный NDVI»: тот же индекс, шкала растянута на выбранный диапазон
    ndwi: (a, b) => (a - b) / (a + b),
    modified_ndwi: (a, b) => (a - b) / (a + b),
    ndmi: (a, b) => (a - b) / (a + b),   // (NIR − SWIR1) / (NIR + SWIR1)
    nbr: (a, b) => (a - b) / (a + b)     // (NIR − SWIR2) / (NIR + SWIR2)
};
const SN_RAMPS = {
    ndvi:  { min: -0.2, max: 0.9, stops: [[0, 165, 0, 38], [0.25, 244, 109, 67], [0.45, 254, 224, 139], [0.6, 166, 217, 106], [0.8, 26, 152, 80], [1, 0, 104, 55]] },
    ndvic: { min: 0.2, max: 0.9, stops: [[0, 165, 0, 38], [0.2, 215, 48, 39], [0.35, 244, 109, 67], [0.45, 253, 174, 97], [0.55, 254, 224, 139], [0.65, 217, 239, 139], [0.75, 166, 217, 106], [0.88, 26, 152, 80], [1, 0, 104, 55]] },
    water: { min: -0.6, max: 0.6, stops: [[0, 140, 81, 10], [0.4, 246, 232, 195], [0.5, 199, 234, 229], [0.7, 90, 180, 172], [1, 1, 102, 94]] }
};
function snRamp(key) {
    const R = SN_RAMPS[key === 'ndvi_c' ? 'ndvic' : (key === 'ndvi' || key === 'nbr') ? 'ndvi' : 'water'];
    if (!R.lut) {
        R.lut = new Uint8Array(256 * 3);
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            let s = 0;
            while (s < R.stops.length - 2 && t > R.stops[s + 1][0]) s++;
            const a = R.stops[s], b = R.stops[s + 1];
            const f = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
            for (let c = 0; c < 3; c++) R.lut[i * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
        }
    }
    if (key === 'ndvi_c') { R.min = SENTINEL.contrast.min; R.max = SENTINEL.contrast.max; }   // диапазон задаёт пользователь
    return R;
}

// ложные цвета (NIR · Red · Green → R · G · B): растяжка отражательной способности по каналам
const SN_FC_MAX = [0.5, 0.3, 0.25];
function snFcVal(r, k) {
    const t = r / SN_FC_MAX[k];
    return Math.round(255 * Math.pow(t < 0 ? 0 : t > 1 ? 1 : t, 0.8));
}
function snMeta(item, names) {
    const p = item.properties || {};
    return names.map(nm => {
        const rb = ((item.assets[nm]['raster:bands'] || [])[0]) || {};
        const old = (p.datetime || '') < '2022-01-25';
        return { sc: rb.scale != null ? rb.scale : 1e-4, of: rb.offset != null ? rb.offset : (old ? 0 : -0.1) };
    });
}

// ограничение числа одновременных расчётов тайлов (новые тайлы — в приоритете, ушедшие с экрана — пропускаются)
function snRun(fn, dead) {
    return new Promise((res, rej) => { SENTINEL.queue.push({ fn, res, rej, dead }); snPump(); });
}
function snPump() {
    while (SENTINEL.running < SENTINEL.maxJobs && SENTINEL.queue.length) {
        const j = SENTINEL.queue.pop();
        if (j.dead && j.dead()) { j.res(); continue; }   // тайл уже убран с карты — не тратим на него трафик
        SENTINEL.running++;
        j.fn().then(j.res, j.rej).finally(() => { SENTINEL.running--; snPump(); });
    }
}

// фоновые потоки для распаковки блоков GeoTIFF: основной поток не «подвисает», чтение заметно быстрее
function snPool() {
    if (SENTINEL.pool === undefined) {
        try {
            SENTINEL.pool = (typeof GeoTIFF !== 'undefined' && GeoTIFF.Pool && /^https?:$/.test(location.protocol))
                ? new GeoTIFF.Pool(Math.max(2, Math.min(4, navigator.hardwareConcurrency || 2))) : null;
        } catch (e) { SENTINEL.pool = null; }
    }
    return SENTINEL.pool || undefined;
}
function snPoolFail(e) {
    if (SENTINEL.pool && /worker|decod|unsupported|compression/i.test(String(e && e.message || e))) {
        try { SENTINEL.pool.destroy(); } catch (x) { }
        SENTINEL.pool = null;   // потоки недоступны — дальше распаковываем в основном потоке
    }
}

// Кэш готовых тайлов: в памяти (мгновенно) и в IndexedDB браузера (сохраняется между сеансами)
function snSig(key, z, x, y) {
    const st = SENTINEL.state[key];
    const ctr = key === 'ndvi_c' ? ':' + SENTINEL.contrast.min + '_' + SENTINEL.contrast.max : '';
    return key + ctr + '|' + st.scenes.map(s => s.id).join(',') + '|' + z + '/' + x + '/' + y;
}
function snMemGet(sig) {
    const m = SENTINEL.tileMem, v = m.get(sig);
    if (v) { m.delete(sig); m.set(sig, v); }
    return v;
}
function snMemPut(sig, img) {
    const m = SENTINEL.tileMem;
    m.set(sig, img);
    while (m.size > SENTINEL.tileMemMax) m.delete(m.keys().next().value);
}
let snIdbP = null;
function snIdb() {
    if (!snIdbP) snIdbP = new Promise(res => {
        try {
            const rq = indexedDB.open('geoclass-sentinel', 1);
            rq.onupgradeneeded = () => { rq.result.createObjectStore('tiles').createIndex('t', 't'); };
            rq.onsuccess = () => {
                res(rq.result);
                setTimeout(() => snIdbTrim(rq.result), 6000);
            };
            rq.onerror = rq.onblocked = () => res(null);
        } catch (e) { res(null); }
    });
    return snIdbP;
}
// держим в базе не больше ~3000 тайлов: самые старые удаляются
function snIdbTrim(db) {
    try {
        const st = db.transaction('tiles', 'readwrite').objectStore('tiles'), c = st.count();
        c.onsuccess = () => {
            let del = c.result - 3000;
            if (del <= 0) return;
            st.index('t').openCursor().onsuccess = e => {
                const cur = e.target.result;
                if (cur && del-- > 0) { cur.delete(); cur.continue(); }
            };
        };
    } catch (e) { }
}
async function snIdbGet(k) {
    const db = await snIdb();
    if (!db) return null;
    return new Promise(res => {
        try {
            const r = db.transaction('tiles').objectStore('tiles').get(k);
            r.onsuccess = () => res(r.result ? r.result.b : null);
            r.onerror = () => res(null);
        } catch (e) { res(null); }
    });
}
function snIdbPut(k, canvas) {
    snIdb().then(db => {
        if (!db) return;
        canvas.toBlob(b => {
            if (!b) return;
            try { db.transaction('tiles', 'readwrite').objectStore('tiles').put({ b: b, t: Date.now() }, k); } catch (e) { }
        }, 'image/webp', 0.92);
    });
}
// пробует взять уже готовый тайл из кэша; true — тайл нарисован
async function snFromCache(key, z, x, y, canvas) {
    const st = SENTINEL.state[key];
    if (!st || !st.date || !st.scenes || !st.scenes.length) return false;
    const n = Math.pow(2, z), sig = snSig(key, z, ((x % n) + n) % n, y), ctx = canvas.getContext('2d');
    const mem = snMemGet(sig);
    if (mem) { ctx.putImageData(mem, 0, 0); return true; }
    const blob = await snIdbGet(sig);
    if (!blob) return false;
    try {
        const bmp = await createImageBitmap(blob);
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
        snMemPut(sig, ctx.getImageData(0, 0, 256, 256));
        return true;
    } catch (e) { return false; }
}

function snWarn(e) {
    console.warn('Sentinel:', e);
    if (!SENTINEL.warned) {
        SENTINEL.warned = true;
        updateStatus('⚠️ Sentinel: ' + (e && e.message ? e.message : e), true);
        setTimeout(() => { SENTINEL.warned = false; }, 8000);
    }
}

function snItem(id) {
    if (!SENTINEL.items[id]) {
        SENTINEL.items[id] = fetch(`${SENTINEL.stacUrl}/collections/sentinel-2-l2a/items/${id}`)
            .then(r => { if (!r.ok) throw new Error('каталог снимков: HTTP ' + r.status); return r.json(); })
            .catch(e => { delete SENTINEL.items[id]; throw e; });
    }
    return SENTINEL.items[id];
}

function snHref(h) {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(h);
    return m ? `https://${m[1]}.s3.us-west-2.amazonaws.com/${m[2]}` : h;
}

const snDelay = ms => new Promise(r => setTimeout(r, ms));
// если сервер молчит (запрос завис, а не оборвался), через ms миллисекунд считаем это ошибкой
function snRace(p, ms, msg) {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })])
        .finally(() => clearTimeout(t));
}

// варианты адреса одного и того же файла на S3 (если один хост сбрасывает соединение — пробуем другой)
function snHosts(href) {
    const m = /^https:\/\/([^.]+)\.s3\.([a-z0-9-]+)\.amazonaws\.com\/(.+)$/.exec(href);
    if (!m) return [href];
    return [href,
        `https://s3.${m[2]}.amazonaws.com/${m[1]}/${m[3]}`,
        `https://${m[1]}.s3.dualstack.${m[2]}.amazonaws.com/${m[3]}`];
}

// Локальный прокси (serve_site.py): если сайт открыт через него, снимки идут через /s3/... — тот же источник, без CORS
let snProxyProbe = null;
function snProxyAvailable() {
    if (!snProxyProbe) {
        snProxyProbe = /^https?:$/.test(location.protocol)
            ? fetch('/s3/ping', { cache: 'no-store' }).then(r => r.ok && r.headers.get('X-GeoClass-Proxy') === '1').catch(() => false)
            : Promise.resolve(false);
        snProxyProbe = snProxyProbe.then(ok => { SENTINEL.proxyOk = ok; return ok; });
    }
    return snProxyProbe;
}
async function snCandidates(href) {
    const list = snHosts(href);
    const m = /^https:\/\/sentinel-cogs\.s3\.[a-z0-9-]+\.amazonaws\.com\/(.+)$/.exec(href);
    if (m && await snProxyAvailable()) list.unshift('/s3/' + m[1]);
    return list;
}
const snHostOf = u => { try { return new URL(u, location.href).host + (u.charAt(0) === '/' ? ' (локальный прокси)' : ''); } catch (e) { return u; } };

// открывает COG один раз: заголовки, обзорные уровни (overviews), привязка; с повторами и сменой хоста
function snOpen(href) {
    if (!SENTINEL.files[href]) {
        SENTINEL.files[href] = (async () => {
            const cands = await snCandidates(href);
            let lastErr;
            for (let attempt = 0; attempt < cands.length; attempt++) {
                const ci = (SENTINEL.hostIdx + attempt) % cands.length;
                try {
                    const imgs = [];
                    await snRace((async () => {
                        const tiff = await GeoTIFF.fromUrl(cands[ci], { blockSize: 512 * 1024, cacheSize: 200 });
                        const n = await tiff.getImageCount();
                        for (let i = 0; i < n; i++) {
                            const im = await tiff.getImage(i);
                            const sub = im.fileDirectory && im.fileDirectory.NewSubfileType;
                            if (i > 0 && (sub & 4)) continue;   // маски пропускаем
                            imgs.push({ im: im, w: im.getWidth(), h: im.getHeight() });
                        }
                    })(), 12000, 'нет ответа от ' + snHostOf(cands[ci]) + ' (таймаут 12 с)');
                    const full = imgs[0].im, o = full.getOrigin(), r = full.getResolution();
                    const keys = full.getGeoKeys() || {};
                    SENTINEL.hostIdx = ci;
                    return { key: href, imgs: imgs, ox: o[0], oy: o[1], rx: Math.abs(r[0]), ry: Math.abs(r[1]),
                             W: imgs[0].w, H: imgs[0].h, epsg: keys.ProjectedCSTypeGeoKey || 0 };
                } catch (e) {
                    lastErr = e;
                    await snDelay(400 * (attempt + 1));
                }
            }
            throw lastErr;
        })().catch(e => { delete SENTINEL.files[href]; throw e; });
    }
    return SENTINEL.files[href];
}

function snProj(epsg) {
    if (!SENTINEL.projs[epsg]) {
        if (!(epsg >= 32601 && epsg <= 32760)) throw new Error('неподдерживаемая проекция EPSG:' + epsg);
        SENTINEL.projs[epsg] = proj4('EPSG:4326',
            `+proj=utm +zone=${epsg % 100}${epsg >= 32700 ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`);
    }
    return SENTINEL.projs[epsg];
}

// читает из COG нужное окно с подходящим уровнем детализации
async function snRead(f, minE, minN, maxE, maxN, g, rgb) {
    let lv = 0;
    for (let i = f.imgs.length - 1; i >= 0; i--) {
        if (f.rx * f.W / f.imgs[i].w <= g * 1.0001) { lv = i; break; }
    }
    const L = f.imgs[lv];
    const rx = f.rx * f.W / L.w, ry = f.ry * f.H / L.h;
    const x0 = Math.max(0, Math.floor((minE - f.ox) / rx) - 1), x1 = Math.min(L.w, Math.ceil((maxE - f.ox) / rx) + 1);
    const y0 = Math.max(0, Math.floor((f.oy - maxN) / ry) - 1), y1 = Math.min(L.h, Math.ceil((f.oy - minN) / ry) + 1);
    if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) > 4e6) return null;
    let bands, lastErr;
    for (let attempt = 0; attempt < 3 && !bands; attempt++) {
        try {
            bands = await snRace(L.im.readRasters({ window: [x0, y0, x1, y1], samples: rgb ? [0, 1, 2] : [0], pool: snPool() }),
                20000, 'чтение снимка: нет ответа от S3 (таймаут 20 с)');
        } catch (e) {
            lastErr = e; snPoolFail(e);
            await snDelay(500 * (attempt + 1));
        }
    }
    if (!bands) {   // файл недоступен: забываем его, при следующем тайле откроем через другой хост
        delete SENTINEL.files[f.key];
        SENTINEL.hostIdx = (SENTINEL.hostIdx + 1) % 4;
        throw lastErr;
    }
    return { bands: bands, w: x1 - x0, h: y1 - y0, x0: x0, y0: y0, rx: rx, ry: ry, ox: f.ox, oy: f.oy };
}

const SN_NODES = 9, SN_STEP = 32;

// шаг 1: открывает файлы сцены и читает нужные окна (для нескольких сцен тайла вызывается параллельно)
async function snLoadScene(key, item, lon, lat) {
    const names = SN_ASSETS[key];
    const files = await Promise.all(names.map(nm => {
        const a = item.assets && item.assets[nm];
        if (!a) throw new Error('в снимке нет канала ' + nm);
        return snOpen(snHref(a.href));
    }));
    const f0 = files[0];
    const p = item.properties || {};
    const epsg = f0.epsg || +(p['proj:epsg'] || String(p['proj:code'] || '').replace('EPSG:', ''));
    const fwd = snProj(epsg);
    const E = [], N = [];
    let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
    for (let b = 0; b < SN_NODES; b++) {
        E[b] = []; N[b] = [];
        for (let a = 0; a < SN_NODES; a++) {
            const q = fwd.forward([lon[b][a], lat[b][a]]);
            E[b][a] = q[0]; N[b][a] = q[1];
            if (q[0] < minE) minE = q[0]; if (q[0] > maxE) maxE = q[0];
            if (q[1] < minN) minN = q[1]; if (q[1] > maxN) maxN = q[1];
        }
    }
    if (minE > f0.ox + f0.W * f0.rx || maxE < f0.ox || maxN < f0.oy - f0.H * f0.ry || minN > f0.oy) return null;   // тайл вне сцены
    const g = Math.hypot(E[0][SN_NODES - 1] - E[0][0], N[0][SN_NODES - 1] - N[0][0]) / 256;
    const rd = await Promise.all(files.map((f, k) => snRead(f, minE, minN, maxE, maxN, g, names[k] === 'visual')));
    if (rd.some(r => !r)) return null;
    return { item: item, E: E, N: N, rd: rd };
}

// шаг 2: дорисовывает в буфер out (256×256 RGBA) пиксели одной загруженной сцены
function snPaintScene(key, S, out) {
    const names = SN_ASSETS[key], item = S.item, p = item.properties || {}, E = S.E, N = S.N, rd = S.rd;
    const idx = SN_INDEX[key], fc = key === 'falsecolor';
    const ramp = idx ? snRamp(key) : null;
    const meta = snMeta(item, names);
    const span = ramp ? ramp.max - ramp.min : 1;

    for (let py = 0; py < 256; py++) {
        const v = (py + 0.5) / SN_STEP, b = Math.min(SN_NODES - 2, Math.floor(v)), fb = v - b;
        for (let px = 0; px < 256; px++) {
            const o = (py * 256 + px) * 4;
            if (out[o + 3]) continue;
            const u = (px + 0.5) / SN_STEP, a = Math.min(SN_NODES - 2, Math.floor(u)), fa = u - a;
            const e = (E[b][a] * (1 - fa) + E[b][a + 1] * fa) * (1 - fb) + (E[b + 1][a] * (1 - fa) + E[b + 1][a + 1] * fa) * fb;
            const n = (N[b][a] * (1 - fa) + N[b][a + 1] * fa) * (1 - fb) + (N[b + 1][a] * (1 - fa) + N[b + 1][a + 1] * fa) * fb;
            if (fc) {
                let ok = true;
                const v3 = [0, 0, 0];
                for (let k = 0; k < 3 && ok; k++) {
                    const r = rd[k];
                    const col = Math.floor((e - r.ox) / r.rx) - r.x0, row = Math.floor((r.oy - n) / r.ry) - r.y0;
                    if (col < 0 || row < 0 || col >= r.w || row >= r.h) { ok = false; break; }
                    const d = r.bands[0][row * r.w + col];
                    if (!d) { ok = false; break; }
                    v3[k] = snFcVal(Math.max(0, d * meta[k].sc + meta[k].of), k);
                }
                if (!ok) continue;
                out[o] = v3[0]; out[o + 1] = v3[1]; out[o + 2] = v3[2]; out[o + 3] = 255;
            } else if (!idx) {
                const r = rd[0];
                const col = Math.floor((e - r.ox) / r.rx) - r.x0, row = Math.floor((r.oy - n) / r.ry) - r.y0;
                if (col < 0 || row < 0 || col >= r.w || row >= r.h) continue;
                const pos = row * r.w + col;
                const R = r.bands[0][pos], G = r.bands[1][pos], B = r.bands[2][pos];
                if (!(R | G | B)) continue;
                out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = 255;
            } else {
                const r0 = rd[0], r1 = rd[1];
                const c0 = Math.floor((e - r0.ox) / r0.rx) - r0.x0, w0 = Math.floor((r0.oy - n) / r0.ry) - r0.y0;
                const c1 = Math.floor((e - r1.ox) / r1.rx) - r1.x0, w1 = Math.floor((r1.oy - n) / r1.ry) - r1.y0;
                if (c0 < 0 || w0 < 0 || c0 >= r0.w || w0 >= r0.h || c1 < 0 || w1 < 0 || c1 >= r1.w || w1 >= r1.h) continue;
                const d0 = r0.bands[0][w0 * r0.w + c0], d1 = r1.bands[0][w1 * r1.w + c1];
                if (!d0 || !d1) continue;
                const A = Math.max(0, d0 * meta[0].sc + meta[0].of), B = Math.max(0, d1 * meta[1].sc + meta[1].of);
                if (A + B <= 0) continue;
                let t = (idx(A, B) - ramp.min) / span;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                const li = Math.round(t * 255) * 3;
                out[o] = ramp.lut[li]; out[o + 1] = ramp.lut[li + 1]; out[o + 2] = ramp.lut[li + 2]; out[o + 3] = 255;
            }
        }
    }
}

// рисует тайл z/x/y в canvas 256×256 по выбранной дате (мозаика всех сцен этого дня).
// Сначала смотрит в кэш (память → IndexedDB); все сцены дня читаются параллельно.
// dead() — функция «тайл уже не нужен»; skipCache — кэш уже проверен снаружи
async function snRenderTile(key, z, x, y, canvas, dead, skipCache) {
    const st = SENTINEL.state[key];
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    if (!st || !st.date || !st.scenes || !st.scenes.length) return;
    if (typeof GeoTIFF === 'undefined' || typeof proj4 === 'undefined') throw new Error('не загрузились библиотеки geotiff / proj4');
    const n = Math.pow(2, z);
    x = ((x % n) + n) % n;
    if (!skipCache && await snFromCache(key, z, x, y, canvas)) return;
    if (dead && dead()) return;
    const sig = snSig(key, z, x, y);
    const size = 40075016.686 / n, x0 = -20037508.343 + x * size, y0 = 20037508.343 - y * size;
    const R = 6378137, D = 180 / Math.PI;
    const lon = [], lat = [];
    for (let b = 0; b < SN_NODES; b++) {
        lon[b] = []; lat[b] = [];
        const my = y0 - b * SN_STEP / 256 * size;
        const la = (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * D;
        for (let a = 0; a < SN_NODES; a++) {
            lon[b][a] = (x0 + a * SN_STEP / 256 * size) / R * D;
            lat[b][a] = la;
        }
    }
    const lonMin = lon[0][0], lonMax = lon[0][SN_NODES - 1], latMax = lat[0][0], latMin = lat[SN_NODES - 1][0];
    const img = ctx.createImageData(256, 256);
    const dayAtStart = st.date;
    let ok = true;
    const loaded = await Promise.all(st.scenes.map(async sc => {
        try {
            const item = await snItem(sc.id);
            const bb = item.bbox;
            if (bb && (bb[0] > lonMax || bb[2] < lonMin || bb[1] > latMax || bb[3] < latMin)) return null;
            return await snLoadScene(key, item, lon, lat);
        } catch (e) { ok = false; snWarn(e); return null; }
    }));
    for (const S of loaded) if (S) snPaintScene(key, S, img.data);   // порядок сцен сохраняется: сначала самые чистые
    if (SENTINEL.state[key] && SENTINEL.state[key].date === dayAtStart) {
        ctx.putImageData(img, 0, 0);
        if (ok) { snMemPut(sig, img); snIdbPut(sig, canvas); }
    }
}

// Диагностика: в консоли браузера (F12) выполните  snTest()  — проверит доступ к файлам снимка с этой страницы
window.snTest = async function (key) {
    key = key || 'ndvi';
    const st = SENTINEL.state[key];
    if (!st || !st.scenes || !st.scenes.length) { console.log('Сначала выберите подложку и дату снимка'); return; }
    const item = await snItem(st.scenes[0].id);
    const href = snHref(item.assets[SN_ASSETS[key][0]].href);
    console.log('Страница открыта как:', location.origin, '| файл:', href);
    const rows = [];
    for (const url of await snCandidates(href)) {
        for (const withRange of [true, false]) {
            const t0 = performance.now();
            const row = { host: snHostOf(url), range: withRange };
            try {
                const ctrl = new AbortController();
                const r = await fetch(url, { headers: withRange ? { Range: 'bytes=0-1023' } : {}, signal: ctrl.signal });
                row.status = r.status; row.contentRange = r.headers.get('content-range') || '-';
                ctrl.abort();
            } catch (e) { row.status = 'ОШИБКА'; row.error = e.name + ': ' + e.message; }
            row.ms = Math.round(performance.now() - t0);
            rows.push(row);
        }
    }
    console.table(rows);
    return rows;
};

const SentinelLayer = L.GridLayer.extend({
    initialize: function (key, options) {
        this._snKey = key;
        L.GridLayer.prototype.initialize.call(this, options);
        this.on('load', () => {
            const st = SENTINEL.state[this._snKey];
            if (st && st.date && this._map) updateStatus('🛰️ Снимок Sentinel-2 загружен');
            if (window.snLoadingSet) window.snLoadingSet('tiles', false);
        });
        this.on('loading', () => { if (window.snLoadingSet) window.snLoadingSet('tiles', true); });
        // тайл, ушедший с экрана, больше не рассчитывается
        this.on('tileunload', e => { if (e.tile) e.tile._snDead = true; });
    },
    createTile: function (coords, done) {
        const st = SENTINEL.state[this._snKey];
        if (!st || !st.date) {   // дата ещё не выбрана — пустой тайл (другая подложка не подставляется), на карте надпись «Загрузка снимков»
            const e0 = document.createElement('canvas');
            e0.width = e0.height = 256;
            setTimeout(() => done(null, e0), 0);
            return e0;
        }
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const key = this._snKey, dead = () => c._snDead;
        // готовые тайлы берутся из кэша сразу, минуя очередь загрузки
        snFromCache(key, coords.z, coords.x, coords.y, c)
            .then(hit => hit || snRun(() => snRenderTile(key, coords.z, coords.x, coords.y, c, dead, true), dead))
            .catch(snWarn).then(() => done(null, c));
        return c;
    }
});

function sentinelTiles(key) {
    const layer = new SentinelLayer(key, {
        attribution: 'Contains modified Copernicus Sentinel data, AWS Earth Search',
        tileSize: 256, maxZoom: 19, maxNativeZoom: 14, keepBuffer: 3
    });
    SENTINEL.live.push(layer);
    return layer;
}

// заранее открывает файлы выбранных сцен, чтобы первые тайлы не ждали заголовки
function snPrewarm(key) {
    const st = SENTINEL.state[key];
    if (!st || !st.scenes) return;
    st.scenes.forEach(sc => snItem(sc.id).then(item => {
        (SN_ASSETS[key] || []).forEach(nm => {
            const a = item.assets && item.assets[nm];
            if (a) snOpen(snHref(a.href)).catch(() => { });
        });
    }).catch(() => { }));
}

// Применяет выбранную дату ко всем живым слоям этой подложки (основная карта, шторка, 3D)
function sentinelApply(key) {
    snPrewarm(key);
    SENTINEL.live.forEach(l => { if (l._snKey === key && l._map) l.redraw(); });
    updateStatus('🛰️ Загрузка снимка Sentinel-2…');
    if (typeof m3d !== 'undefined' && m3d.active) m3RebuildBasemap();
}

// ============================================================
//  ЭКСПОРТ СНИМКА SENTINEL-2 В GeoTIFF по нарисованной фигуре.
//  Масштаб максимальный для спутника: 10 м/пиксель (каналы visual / red / green / nir),
//  более грубые каналы (SWIR, 20 м) приводятся к сетке 10 м. Файл — в проекции UTM снимка (EPSG:326xx / 327xx),
//  пиксели вне фигуры прозрачны. Сжатие Deflate, если его поддерживает браузер.
// ============================================================
const SN_RES = 10;              // м/пиксель — лучшее разрешение Sentinel-2
const SN_EXPORT_MAX_PX = 25e6;  // предел размера выгрузки (≈ 50 × 50 км при 10 м)
const SN_FILE_TAG = { sentinel2: 'S2_TrueColor', ndvi: 'NDVI', ndwi: 'NDWI', modified_ndwi: 'MNDWI', ndmi: 'NDMI', nbr: 'NBR', falsecolor: 'S2_FalseColor', ndvi_c: 'NDVI_contrast' };

function snRingsOf(gj) {
    const g = gj.geometry || gj, out = [];
    if (g.type === 'Polygon') g.coordinates.forEach(r => out.push(r));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(r => out.push(r)));
    return out;
}

// читает окно из файла в полном разрешении (с повторами при сбоях сети)
async function snReadFull(f, x0, y0, x1, y1, rgb) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await snRace(f.imgs[0].im.readRasters({ window: [x0, y0, x1, y1], samples: rgb ? [0, 1, 2] : [0], pool: snPool() }),
                90000, 'чтение снимка: нет ответа от S3 (таймаут 90 с)');
        } catch (e) {
            lastErr = e; snPoolFail(e);
            await snDelay(700 * (attempt + 1));
        }
    }
    delete SENTINEL.files[f.key];
    throw lastErr;
}

async function snDeflate(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// собирает GeoTIFF: полосы (strips), Deflate, привязка UTM
async function snEncodeTiff(p, onProgress, stop) {
    const W = p.W, H = p.H, spp = p.spp, isF = !!p.float, bpp = isF ? 4 : 1;
    const rps = Math.max(1, Math.min(H, Math.floor(1e6 / (W * spp * bpp))));
    const nStrips = Math.ceil(H / rps);
    let comp = typeof CompressionStream !== 'undefined', strips;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            strips = [];
            for (let s = 0; s < nStrips; s++) {
                stop();
                const r0 = s * rps, r1 = Math.min(H, r0 + rps);
                let raw;
                if (isF) raw = new Uint8Array(p.data.buffer, p.data.byteOffset + r0 * W * 4, (r1 - r0) * W * 4);
                else {
                    raw = p.data.slice(r0 * W * spp, r1 * W * spp);
                    if (comp) {   // предиктор 2: разности соседних пикселей — Deflate сжимает лучше
                        const rl = W * spp;
                        for (let r = 0; r < r1 - r0; r++) {
                            const o = r * rl;
                            for (let i = rl - 1; i >= spp; i--) raw[o + i] = (raw[o + i] - raw[o + i - spp]) & 255;
                        }
                    }
                }
                strips.push(comp ? await snDeflate(raw) : raw);
                if (onProgress) onProgress((s + 1) / nStrips);
            }
            break;
        } catch (e) {
            if (!comp || /отменено/.test(e.message)) throw e;
            comp = false;   // Deflate не получился — пишем без сжатия
        }
    }
    const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 };
    const tags = [];
    const add = (tag, t, v) => tags.push({ tag: tag, t: t, v: v });
    add(256, 4, [W]); add(257, 4, [H]);
    add(258, 3, new Array(spp).fill(isF ? 32 : 8));
    add(259, 3, [comp ? 8 : 1]);
    add(262, 3, [spp === 1 ? 1 : 2]);
    add(273, 4, new Array(nStrips).fill(0));
    add(277, 3, [spp]);
    add(278, 4, [rps]);
    add(279, 4, strips.map(s => s.length));
    add(284, 3, [1]);
    if (comp && !isF) add(317, 3, [2]);
    if (spp === 4) add(338, 3, [2]);
    if (isF) add(339, 3, [3]);
    add(33550, 12, [SN_RES, SN_RES, 0]);
    add(33922, 12, [0, 0, 0, p.ox, p.oy, 0]);
    add(34735, 3, [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, p.epsg, 3076, 0, 1, 9001]);
    if (isF) add(42113, 2, Array.from('nan\0').map(ch => ch.charCodeAt(0)));
    let extra = 0;
    tags.forEach(t => { t.len = t.v.length * SIZE[t.t]; if (t.len > 4) { t.eo = extra; extra += t.len + (t.len & 1); } });
    const ifdSize = 2 + tags.length * 12 + 4, dataStart = 8 + ifdSize + extra;
    let acc = dataStart;
    tags.find(t => t.tag === 273).v = strips.map(s => { const o = acc; acc += s.length; return o; });
    const head = new ArrayBuffer(dataStart), dv = new DataView(head);
    dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true); dv.setUint16(8, tags.length, true);
    tags.forEach((t, i) => {
        const q = 10 + i * 12;
        dv.setUint16(q, t.tag, true); dv.setUint16(q + 2, t.t, true); dv.setUint32(q + 4, t.v.length, true);
        let wp = q + 8;
        if (t.len > 4) { wp = 8 + ifdSize + t.eo; dv.setUint32(q + 8, wp, true); }
        t.v.forEach((val, k) => {
            if (t.t === 3) dv.setUint16(wp + k * 2, val, true);
            else if (t.t === 4) dv.setUint32(wp + k * 4, val, true);
            else if (t.t === 12) dv.setFloat64(wp + k * 8, val, true);
            else dv.setUint8(wp + k, val);
        });
    });
    dv.setUint32(10 + tags.length * 12, 0, true);
    return { blob: new Blob([head].concat(strips), { type: 'image/tiff' }), compressed: comp };
}

// o: { key, st, gj, color, onProgress(доля, текст), isAborted() } → { blob, name, W, H, epsg, compressed }
async function snExportGeoTiff(o) {
    const key = o.key, st = o.st, names = SN_ASSETS[key], idx = SN_INDEX[key], fc = key === 'falsecolor', raw = !!o.raw;
    const prog = (f, t) => { if (o.onProgress) o.onProgress(f, t); };
    const stop = () => { if (o.isAborted && o.isAborted()) throw new Error('Скачивание отменено'); };
    if (typeof GeoTIFF === 'undefined' || typeof proj4 === 'undefined') throw new Error('не загрузились библиотеки geotiff / proj4');
    const rings = snRingsOf(o.gj);
    if (!rings.length) throw new Error('у фигуры нет контура');
    const bb = turf.bbox(o.gj);   // [запад, юг, восток, север]

    // сцены выбранного дня, которые пересекают фигуру
    prog(0.01, 'Загрузка описаний снимков…');
    const scenes = [];
    for (const sc of st.scenes) {
        const it = await snItem(sc.id);
        stop();
        const b = it.bbox;
        if (b && (b[0] > bb[2] || b[2] < bb[0] || b[1] > bb[3] || b[3] < bb[1])) continue;
        const fs = await Promise.all(names.map(nm => {
            const a = it.assets && it.assets[nm];
            if (!a) throw new Error('в снимке нет канала ' + nm);
            return snOpen(snHref(a.href));
        }));
        const p = it.properties || {};
        const epsg = fs[0].epsg || +(p['proj:epsg'] || String(p['proj:code'] || '').replace('EPSG:', ''));
        const meta = snMeta(it, names);
        scenes.push({ it: it, fs: fs, epsg: epsg, meta: meta });
        prog(0.02 + 0.03 * scenes.length / st.scenes.length, 'Открытие снимков…');
    }
    if (!scenes.length) throw new Error('на выбранную дату в этой области нет снимков — выберите другую дату');

    // системы координат: UTM-зона центра фигуры (если есть такие снимки), иначе зона первого снимка
    const cLat = (bb[1] + bb[3]) / 2, cLon = (bb[0] + bb[2]) / 2;
    const epsgC = (cLat >= 0 ? 32600 : 32700) + Math.floor((cLon + 180) / 6) + 1;
    const tEpsg = (scenes.find(s => s.epsg === epsgC) || scenes[0]).epsg;
    const fwdT = snProj(tEpsg);

    // контур фигуры в метрах UTM (стороны разбиваются, чтобы учесть кривизну проекции)
    const ringsU = rings.map(r => {
        const out = [];
        for (let i = 0; i < r.length - 1; i++) {
            const a = r[i], b = r[i + 1];
            const n = Math.max(1, Math.min(200, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 0.004)));
            for (let k = 0; k < n; k++) out.push(fwdT.forward([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]));
        }
        return out;
    });
    let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    ringsU.forEach(r => r.forEach(q => { if (q[0] < e0) e0 = q[0]; if (q[0] > e1) e1 = q[0]; if (q[1] < n0) n0 = q[1]; if (q[1] > n1) n1 = q[1]; }));
    // сетка выравнивается по 10 м — пиксели совпадают с пикселями исходных каналов
    const minE = Math.floor(e0 / SN_RES) * SN_RES, maxE = Math.ceil(e1 / SN_RES) * SN_RES;
    const minN = Math.floor(n0 / SN_RES) * SN_RES, maxN = Math.ceil(n1 / SN_RES) * SN_RES;
    const W = Math.round((maxE - minE) / SN_RES), H = Math.round((maxN - minN) / SN_RES);
    if (W * H > SN_EXPORT_MAX_PX) throw new Error(`область слишком большая: ${(W * H / 1e6).toFixed(1)} млн пикс. при 10 м (максимум ${SN_EXPORT_MAX_PX / 1e6} млн, примерно 50 × 50 км) — уменьшите фигуру`);

    // маска фигуры (чётно-нечётная заливка по строкам) и границы заполненных столбцов в каждой строке
    prog(0.06, 'Подготовка области…');
    const mask = new Uint8Array(W * H), rowA = new Int32Array(H).fill(-1), rowB = new Int32Array(H).fill(-1);
    for (let y = 0; y < H; y++) {
        const n = maxN - (y + 0.5) * SN_RES, xs = [];
        for (const ring of ringsU) {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const a = ring[j], b = ring[i];
                if ((a[1] > n) !== (b[1] > n)) xs.push(a[0] + (n - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
            }
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const c0 = Math.max(0, Math.ceil((xs[k] - minE) / SN_RES - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - minE) / SN_RES - 0.5));
            for (let c = c0; c <= c1; c++) mask[y * W + c] = 1;
            if (c1 >= c0) { if (rowA[y] < 0 || c0 < rowA[y]) rowA[y] = c0; if (c1 > rowB[y]) rowB[y] = c1; }
        }
    }

    const color = !raw && (!idx || !!o.color), spp = color ? 4 : 1;
    const out = color ? new Uint8Array(W * H * 4) : new Float32Array(W * H).fill(NaN);
    const ramp = idx && color ? snRamp(key) : null, span = ramp ? ramp.max - ramp.min : 1;
    const STRIP = Math.max(32, Math.min(512, Math.floor(4e6 / W)));
    const nStr = Math.ceil(H / STRIP);
    let step = 0;

    for (const sc of scenes) {
        const same = sc.epsg === tEpsg, fwdS = same ? null : snProj(sc.epsg), f0 = sc.fs[0];
        for (let r0 = 0; r0 < H; r0 += STRIP) {
            stop();
            const r1 = Math.min(H, r0 + STRIP);
            prog(0.1 + 0.7 * (step++ / (scenes.length * nStr)), 'Чтение снимка с S3: ' + Math.round(100 * r0 / H) + '%');
            let cA = Infinity, cB = -1;
            for (let y = r0; y < r1; y++) if (rowA[y] >= 0) { if (rowA[y] < cA) cA = rowA[y]; if (rowB[y] > cB) cB = rowB[y]; }
            if (cB < 0) continue;
            // для сцен из соседней UTM-зоны координаты пересчитываются по сетке узлов (шаг 16 пикс.) с интерполяцией
            const GS = 16, gw = Math.ceil((cB - cA + 1) / GS) + 1, gh = Math.ceil((r1 - r0) / GS) + 1;
            let gE, gN, sMinE, sMaxE, sMinN, sMaxN;
            if (same) {
                sMinE = minE + cA * SN_RES; sMaxE = minE + (cB + 1) * SN_RES;
                sMaxN = maxN - r0 * SN_RES; sMinN = maxN - r1 * SN_RES;
            } else {
                gE = new Float64Array(gw * gh); gN = new Float64Array(gw * gh);
                sMinE = Infinity; sMaxE = -Infinity; sMinN = Infinity; sMaxN = -Infinity;
                for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
                    const e = minE + (cA + i * GS + 0.5) * SN_RES, n = maxN - (r0 + j * GS + 0.5) * SN_RES;
                    const q = fwdS.forward(fwdT.inverse([e, n]));
                    gE[j * gw + i] = q[0]; gN[j * gw + i] = q[1];
                    if (q[0] < sMinE) sMinE = q[0]; if (q[0] > sMaxE) sMaxE = q[0];
                    if (q[1] < sMinN) sMinN = q[1]; if (q[1] > sMaxN) sMaxN = q[1];
                }
                sMinE -= GS * SN_RES; sMaxE += GS * SN_RES; sMinN -= GS * SN_RES; sMaxN += GS * SN_RES;
            }
            if (sMinE > f0.ox + f0.W * f0.rx || sMaxE < f0.ox || sMaxN < f0.oy - f0.H * f0.ry || sMinN > f0.oy) continue;   // полоса вне сцены
            const rd = [];
            let empty = false;
            await Promise.all(sc.fs.map(async (f, k) => {
                const x0 = Math.max(0, Math.floor((sMinE - f.ox) / f.rx) - 1), x1 = Math.min(f.W, Math.ceil((sMaxE - f.ox) / f.rx) + 1);
                const y0 = Math.max(0, Math.floor((f.oy - sMaxN) / f.ry) - 1), y1 = Math.min(f.H, Math.ceil((f.oy - sMinN) / f.ry) + 1);
                if (x1 <= x0 || y1 <= y0) { empty = true; return; }
                const bands = await snReadFull(f, x0, y0, x1, y1, names[k] === 'visual');
                rd[k] = { bands: bands, x0: x0, y0: y0, w: x1 - x0, h: y1 - y0, f: f };
            }));
            if (empty) continue;
            stop();
            for (let y = r0; y < r1; y++) {
                if (rowA[y] < 0) continue;
                for (let c = rowA[y]; c <= rowB[y]; c++) {
                    const pi = y * W + c;
                    if (!mask[pi]) continue;
                    if (color ? out[pi * 4 + 3] : out[pi] === out[pi]) continue;   // уже заполнено более чистой сценой
                    let e, n;
                    if (same) { e = minE + (c + 0.5) * SN_RES; n = maxN - (y + 0.5) * SN_RES; }
                    else {
                        const u = (c - cA) / GS, v = (y - r0) / GS, i = Math.min(gw - 2, Math.floor(u)), j = Math.min(gh - 2, Math.floor(v)), fu = u - i, fv = v - j;
                        const a = j * gw + i, b = a + 1, d = a + gw, g = d + 1;
                        e = (gE[a] * (1 - fu) + gE[b] * fu) * (1 - fv) + (gE[d] * (1 - fu) + gE[g] * fu) * fv;
                        n = (gN[a] * (1 - fu) + gN[b] * fu) * (1 - fv) + (gN[d] * (1 - fu) + gN[g] * fu) * fv;
                    }
                    if (fc) {
                        const o4 = pi * 4, v3 = [0, 0, 0];
                        let ok = true;
                        for (let k = 0; k < 3; k++) {
                            const qk = rd[k], fk = qk.f;
                            const col = Math.floor((e - fk.ox) / fk.rx) - qk.x0, row = Math.floor((fk.oy - n) / fk.ry) - qk.y0;
                            if (col < 0 || row < 0 || col >= qk.w || row >= qk.h) { ok = false; break; }
                            const d = qk.bands[0][row * qk.w + col];
                            if (!d) { ok = false; break; }
                            v3[k] = snFcVal(Math.max(0, d * sc.meta[k].sc + sc.meta[k].of), k);
                        }
                        if (!ok) continue;
                        out[o4] = v3[0]; out[o4 + 1] = v3[1]; out[o4 + 2] = v3[2]; out[o4 + 3] = 255;
                    } else if (!idx) {
                        const q = rd[0], f = q.f;
                        const col = Math.floor((e - f.ox) / f.rx) - q.x0, row = Math.floor((f.oy - n) / f.ry) - q.y0;
                        if (col < 0 || row < 0 || col >= q.w || row >= q.h) continue;
                        const pos = row * q.w + col, R = q.bands[0][pos], G = q.bands[1][pos], B = q.bands[2][pos];
                        if (!(R | G | B)) continue;
                        const o4 = pi * 4;
                        out[o4] = R; out[o4 + 1] = G; out[o4 + 2] = B; out[o4 + 3] = 255;
                    } else {
                        const q0 = rd[0], q1 = rd[1], fa = q0.f, fb = q1.f;
                        const c0 = Math.floor((e - fa.ox) / fa.rx) - q0.x0, w0 = Math.floor((fa.oy - n) / fa.ry) - q0.y0;
                        const c1 = Math.floor((e - fb.ox) / fb.rx) - q1.x0, w1 = Math.floor((fb.oy - n) / fb.ry) - q1.y0;
                        if (c0 < 0 || w0 < 0 || c0 >= q0.w || w0 >= q0.h || c1 < 0 || w1 < 0 || c1 >= q1.w || w1 >= q1.h) continue;
                        const d0 = q0.bands[0][w0 * q0.w + c0], d1 = q1.bands[0][w1 * q1.w + c1];
                        if (!d0 || !d1) continue;
                        const A = Math.max(0, d0 * sc.meta[0].sc + sc.meta[0].of), B = Math.max(0, d1 * sc.meta[1].sc + sc.meta[1].of);
                        if (A + B <= 0) continue;
                        const val = idx(A, B);
                        if (!color) out[pi] = val;
                        else {
                            let t = (val - ramp.min) / span;
                            t = t < 0 ? 0 : t > 1 ? 1 : t;
                            const li = Math.round(t * 255) * 3, o4 = pi * 4;
                            out[o4] = ramp.lut[li]; out[o4 + 1] = ramp.lut[li + 1]; out[o4 + 2] = ramp.lut[li + 2]; out[o4 + 3] = 255;
                        }
                    }
                }
            }
        }
    }

    if (raw) { prog(1, 'Готово'); return { values: out, mask: mask, W: W, H: H, epsg: tEpsg, minE: minE, maxN: maxN }; }   // для калькулятора: значения индекса без упаковки
    prog(0.82, 'Упаковка GeoTIFF…');
    const enc = await snEncodeTiff({ data: out, W: W, H: H, spp: spp, float: !color, ox: minE, oy: maxN, epsg: tEpsg },
        f => prog(0.82 + 0.17 * f, 'Упаковка GeoTIFF: ' + Math.round(100 * f) + '%'), stop);
    const name = `${SN_FILE_TAG[key] || key}_${st.date}_EPSG${tEpsg}_${SN_RES}m${color || !idx ? '' : '_float32'}.tif`;
    prog(1, 'Готово');
    return { blob: enc.blob, name: name, W: W, H: H, epsg: tEpsg, compressed: enc.compressed };
}

// «Авто» для контрастного NDVI: диапазон по данным области (5–98 процентили NDVI растительных пикселей)
async function snAutoRange(st, bb) {
    const names = SN_ASSETS.ndvi, vals = [];
    for (const sc of st.scenes.slice(0, 4)) {
        const item = await snItem(sc.id), b = item.bbox;
        if (b && (b[0] > bb[2] || b[2] < bb[0] || b[1] > bb[3] || b[3] < bb[1])) continue;
        const files = await Promise.all(names.map(nm => snOpen(snHref(item.assets[nm].href))));
        const p = item.properties || {}, f0 = files[0];
        const fwd = snProj(f0.epsg || +(p['proj:epsg'] || String(p['proj:code'] || '').replace('EPSG:', '')));
        const c = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]].map(q => fwd.forward(q));
        const minE = Math.min(...c.map(q => q[0])), maxE = Math.max(...c.map(q => q[0])), minN = Math.min(...c.map(q => q[1])), maxN = Math.max(...c.map(q => q[1]));
        const g = Math.max(10, Math.sqrt((maxE - minE) * (maxN - minN) / 1e6));
        const rd = await Promise.all(files.map(f => snRead(f, minE, minN, maxE, maxN, g, false)));
        if (rd.some(r => !r)) continue;
        const r0 = rd[0], r1 = rd[1];
        if (r0.w !== r1.w || r0.h !== r1.h || r0.x0 !== r1.x0 || r0.y0 !== r1.y0) continue;
        const mt = snMeta(item, names);
        for (let i = 0; i < r0.w * r0.h; i++) {
            const d0 = r0.bands[0][i], d1 = r1.bands[0][i];
            if (!d0 || !d1) continue;
            const A = Math.max(0, d0 * mt[0].sc + mt[0].of), B = Math.max(0, d1 * mt[1].sc + mt[1].of);
            if (A + B <= 0) continue;
            const v = (B - A) / (B + A);
            if (v > 0.1) vals.push(v);
        }
    }
    if (vals.length < 50) throw new Error('в этой области мало растительности для подбора диапазона');
    const a = Float32Array.from(vals).sort();
    let lo = Math.floor(a[Math.floor(a.length * 0.05)] * 20) / 20, hi = Math.ceil(a[Math.min(a.length - 1, Math.floor(a.length * 0.98))] * 20) / 20;
    lo = Math.max(-0.2, Math.min(lo, 0.8)); hi = Math.min(1, Math.max(hi, lo + 0.15));
    return { min: +lo.toFixed(2), max: +hi.toFixed(2) };
}

// Превью снимка в «спектре» раздела (NDVI, NDWI… или ложные цвета): читается самый грубый уровень COG (≈340 пикс.), результат кэшируется
const SN_PV = { cache: new Map(), q: [], run: 0 };
function snPvLimit(fn) {
    return new Promise((res, rej) => { SN_PV.q.push({ fn, res, rej }); snPvPump(); });
}
function snPvPump() {
    while (SN_PV.run < 2 && SN_PV.q.length) {
        const j = SN_PV.q.shift();
        SN_PV.run++;
        j.fn().then(j.res, j.rej).finally(() => { SN_PV.run--; snPvPump(); });
    }
}
function snIdbPutBlob(k, blob) {
    snIdb().then(db => { if (db) try { db.transaction('tiles', 'readwrite').objectStore('tiles').put({ b: blob, t: Date.now() }, k); } catch (e) { } });
}
// превью в естественных цветах рисуется из готового 8-битного RGB-канала сцены (запасной вариант, если картинка-превью каталога не загрузилась)
async function snPreviewRgb(sig, id) {
    const item = await snItem(id), a = item.assets && item.assets.visual;
    if (!a) throw new Error('в снимке нет канала visual');
    const f = await snOpen(snHref(a.href));
    let l = 0;
    for (let i = 0; i < f.imgs.length; i++) if (f.imgs[i].w >= 300) l = i;
    const Lv = f.imgs[l];
    const d = await snRace(Lv.im.readRasters({ samples: [0, 1, 2], pool: snPool() }), 30000, 'превью: нет ответа от S3');
    const w = Lv.w, h = Lv.h, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), out = img.data;
    for (let i = 0, n = w * h; i < n; i++) {
        const r = d[0][i], g = d[1][i], b = d[2][i];
        if (!r && !g && !b) continue;
        out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/webp', 0.9));
    if (!blob) throw new Error('превью: не удалось сохранить изображение');
    snIdbPutBlob(sig, blob);
    const u = URL.createObjectURL(blob);
    SN_PV.cache.set(sig, u);
    return u;
}
async function snPreview(key, id) {
    const sig = 'pv|' + key + (key === 'ndvi_c' ? ':' + SENTINEL.contrast.min + '_' + SENTINEL.contrast.max : '') + '|' + id;
    const mem = SN_PV.cache.get(sig);
    if (mem) return mem;
    const stored = await snIdbGet(sig);
    if (stored) { const u = URL.createObjectURL(stored); SN_PV.cache.set(sig, u); return u; }
    if (key === 'sentinel2') return snPreviewRgb(sig, id);
    const names = SN_ASSETS[key], idx = SN_INDEX[key], fc = key === 'falsecolor';
    const item = await snItem(id);
    const files = await Promise.all(names.map(nm => {
        const a = item.assets && item.assets[nm];
        if (!a) throw new Error('в снимке нет канала ' + nm);
        return snOpen(snHref(a.href));
    }));
    const lv = files.map(f => { let l = 0; for (let i = 0; i < f.imgs.length; i++) if (f.imgs[i].w >= 300) l = i; return f.imgs[l]; });
    const data = await Promise.all(lv.map(L => snRace(L.im.readRasters({ samples: [0], pool: snPool() }), 30000, 'превью: нет ответа от S3')));
    const w = lv[0].w, h = lv[0].h, mt = snMeta(item, names);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), out = img.data;
    const ramp = idx ? snRamp(key) : null, span = ramp ? ramp.max - ramp.min : 1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = [];
            let ok = true;
            for (let k = 0; k < names.length; k++) {
                const L = lv[k], v = data[k][Math.min(L.h - 1, (y * L.h / h) | 0) * L.w + Math.min(L.w - 1, (x * L.w / w) | 0)];
                if (!v) { ok = false; break; }
                d[k] = Math.max(0, v * mt[k].sc + mt[k].of);
            }
            if (!ok) continue;
            const o = (y * w + x) * 4;
            if (fc) { out[o] = snFcVal(d[0], 0); out[o + 1] = snFcVal(d[1], 1); out[o + 2] = snFcVal(d[2], 2); }
            else {
                if (d[0] + d[1] <= 0) continue;
                let t = (idx(d[0], d[1]) - ramp.min) / span;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                const li = Math.round(t * 255) * 3;
                out[o] = ramp.lut[li]; out[o + 1] = ramp.lut[li + 1]; out[o + 2] = ramp.lut[li + 2];
            }
            out[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/webp', 0.9));
    if (!blob) throw new Error('превью: не удалось сохранить изображение');
    snIdbPutBlob(sig, blob);
    const u = URL.createObjectURL(blob);
    SN_PV.cache.set(sig, u);
    return u;
}

const layerFactories = {
    osm: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
    }),
    google: () => googleTiles('m'),
    google_sat: () => googleTiles('s'),
    google_hybrid: () => googleTiles('y'),
    '2gis': () => L.tileLayer('https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', {
        attribution: '&copy; 2ГИС',
        maxZoom: 18
    }),
    opentopo: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenTopoMap',
        maxZoom: 17
    }),
    esri_sat: () => esriTiles('&copy; Esri'),
    esri_imagery: () => esriTiles('&copy; Esri'),
    sentinel2: () => sentinelTiles('sentinel2'),
    landsat8: () => esriTiles('&copy; Esri / Landsat'),
    ndvi: () => sentinelTiles('ndvi'),
    ndwi: () => sentinelTiles('ndwi'),
    modified_ndwi: () => sentinelTiles('modified_ndwi'),
    ndmi: () => sentinelTiles('ndmi'),
    nbr: () => sentinelTiles('nbr'),
    falsecolor: () => sentinelTiles('falsecolor'),
    ndvi_c: () => sentinelTiles('ndvi_c'),
    esri_landcover: () => new EsriLandCoverLayer('', {
        attribution: '&copy; Esri, Impact Observatory, Microsoft',
        maxZoom: 19,
        maxNativeZoom: 16
    }),

    // --- Дополнительные аналитические подложки Esri ---
    esri_topo:      () => esriCached('World_Topo_Map', '&copy; Esri', 19),
    esri_natgeo:    () => esriCached('NatGeo_World_Map', '&copy; Esri, National Geographic', 16),
    esri_hillshade: () => esriCached('Elevation/World_Hillshade', '&copy; Esri', 16),
    esri_terrain:   () => esriCached('World_Terrain_Base', '&copy; Esri, USGS, NOAA', 13),
    esri_gray:      () => esriCached('Canvas/World_Light_Gray_Base', '&copy; Esri', 16),

    // --- Свойства почв (химический состав), ISRIC SoilGrids ---
    soil_ph:       () => soilGridsLayer('phh2o'),
    soil_soc:      () => soilGridsLayer('soc'),
    soil_nitrogen: () => soilGridsLayer('nitrogen'),
    soil_cec:      () => soilGridsLayer('cec'),
    soil_clay:     () => soilGridsLayer('clay'),
    soil_sand:     () => soilGridsLayer('sand'),

    // --- Новые базовые карты ---
    esri_street:   () => esriCached('World_Street_Map', '&copy; Esri', 19),
    esri_dark:     () => overlayLayer(
        esriCached('Canvas/World_Dark_Gray_Base', '&copy; Esri', 16, { zIndex: 1 }),
        esriCached('Canvas/World_Dark_Gray_Reference', '', 16, { zIndex: 2 })),
    osm_hot: () => L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap, Tiles: Humanitarian OSM Team', subdomains: 'abc', maxZoom: 19
    }),
    cyclosm: () => L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap, CyclOSM', subdomains: 'abc', maxZoom: 20
    }),

    // --- Логистика и навигация ---
    esri_transport: () => overlayLayer(
        esriCached('Canvas/World_Light_Gray_Base', '&copy; Esri', 16, { zIndex: 1 }),
        esriCached('Reference/World_Transportation', '', 16, { zIndex: 2 }),
        esriCached('Reference/World_Boundaries_and_Places', '', 16, { zIndex: 3 })),

    // --- Новые спутниковые подложки ---
    esri_hybrid: () => overlayLayer(
        esriCached('World_Imagery', '&copy; Esri', 19, { zIndex: 1 }),
        esriCached('Reference/World_Transportation', '', 16, { zIndex: 2 }),
        esriCached('Reference/World_Boundaries_and_Places', '', 16, { zIndex: 3 })),
    esri_clarity: () => L.tileLayer('https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19, maxNativeZoom: 19
    }),
    esri_firefly: () => L.tileLayer('https://fly.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Firefly/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19, maxNativeZoom: 19
    }),
    eox_s2: () => L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg', {
        attribution: 'Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2023)',
        maxZoom: 19, maxNativeZoom: 14
    }),
    nasa_viirs: () => L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${nasaViirsDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, {
        attribution: '&copy; NASA EOSDIS GIBS / VIIRS', maxZoom: 19, maxNativeZoom: 9
    }),
    bing_sat:    () => bingTiles('a'),
    bing_hybrid: () => bingTiles('h')
};

const baseLayers = {};
Object.keys(layerFactories).forEach(key => { baseLayers[key] = layerFactories[key](); });

const LAYER_NAMES = {
    osm: 'OSM', google: 'Google', google_sat: 'Спутник', google_hybrid: 'Гибрид',
    '2gis': '2ГИС', opentopo: 'Topo', esri_sat: 'Esri', esri_imagery: 'Esri Imagery',
    sentinel2: 'Sentinel-2', landsat8: 'Landsat', ndvi: 'NDVI', ndwi: 'NDWI',
    modified_ndwi: 'MNDWI', ndmi: 'NDMI', nbr: 'NBR', falsecolor: 'Ложные цвета', ndvi_c: 'Контрастный NDVI', esri_landcover: 'Esri Land Cover',
    esri_topo: 'Esri Topo', esri_natgeo: 'Esri NatGeo', esri_hillshade: 'Esri Рельеф',
    esri_terrain: 'Esri Terrain', esri_gray: 'Esri Gray',
    soil_ph: 'pH почв', soil_soc: 'Орг. углерод', soil_nitrogen: 'Азот почв',
    soil_cec: 'ЕКО почв', soil_clay: 'Глина', soil_sand: 'Песок',
    esri_street: 'Esri Street', esri_dark: 'Esri Dark',
    osm_hot: 'OSM Humanitarian', cyclosm: 'CyclOSM',
    esri_transport: 'Esri Транспорт',
    esri_hybrid: 'Esri Гибрид', esri_clarity: 'Esri Clarity', esri_firefly: 'Esri Firefly',
    eox_s2: 'Sentinel-2 Cloudless', nasa_viirs: 'NASA VIIRS', bing_sat: 'Bing Спутник',
    bing_hybrid: 'Bing Гибрид'
};

// Превью-тайлы для чипов (z=3, x=4, y=2 — над Европой/Россией)
const esriThumb = path => `${ESRI_SERVICES}/${path}/MapServer/tile/3/2/4`;
const soilThumb = property => [
    `${SOILGRIDS_WMS_URL}${property}.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${property}_0-5cm_mean` +
        `&STYLES=&CRS=EPSG:3857&BBOX=0,5009377.085,5009377.085,10018754.171&WIDTH=72&HEIGHT=72&FORMAT=image/png&TRANSPARENT=TRUE`,
    esriThumb('Canvas/World_Light_Gray_Base')
];
const LAYER_THUMBS = {
    osm:            'https://tile.openstreetmap.org/3/4/2.png',
    google:         'https://mt1.google.com/vt/lyrs=m&x=4&y=2&z=3',
    google_sat:     'https://mt1.google.com/vt/lyrs=s&x=4&y=2&z=3',
    google_hybrid:  'https://mt1.google.com/vt/lyrs=y&x=4&y=2&z=3',
    '2gis':         'https://tile2.maps.2gis.com/tiles?x=4&y=2&z=3&v=1',
    opentopo:       'https://a.tile.opentopomap.org/3/4/2.png',
    esri_sat:       'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4',
    sentinel2:      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4',
    landsat8:       'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4',
    ndvi:           'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4',
    ndwi:           'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4',
    modified_ndwi:  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4',
    // тот же участок мира, что и у остальных превью (z=3, x=4, y=2), но в метрах EPSG:3857
    esri_landcover: esriLandCoverUrl([0, 5009377.085, 5009377.085, 10018754.171], 72),
    esri_topo:      esriThumb('World_Topo_Map'),
    esri_natgeo:    esriThumb('NatGeo_World_Map'),
    esri_hillshade: esriThumb('Elevation/World_Hillshade'),
    esri_terrain:   esriThumb('World_Terrain_Base'),
    esri_gray:      esriThumb('Canvas/World_Light_Gray_Base'),
    // почвы: данные SoilGrids поверх светло-серой основы (первый url — верхний слой)
    soil_ph:        soilThumb('phh2o'),
    soil_soc:       soilThumb('soc'),
    soil_nitrogen:  soilThumb('nitrogen'),
    soil_cec:       soilThumb('cec'),
    soil_clay:      soilThumb('clay'),
    soil_sand:      soilThumb('sand'),
    // новые базовые карты
    esri_street:    esriThumb('World_Street_Map'),
    esri_dark:      [esriThumb('Canvas/World_Dark_Gray_Reference'), esriThumb('Canvas/World_Dark_Gray_Base')],
    osm_hot:        'https://a.tile.openstreetmap.fr/hot/3/4/2.png',
    cyclosm:        'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/3/4/2.png',
    // логистика и навигация
    esri_transport: [esriThumb('Reference/World_Transportation'), esriThumb('Canvas/World_Light_Gray_Base')],
    // новые спутниковые подложки
    esri_hybrid:    [esriThumb('Reference/World_Boundaries_and_Places'), esriThumb('World_Imagery')],
    esri_clarity:   'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/3/2/4',
    esri_firefly:   'https://fly.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Firefly/MapServer/tile/3/2/4',
    eox_s2:         'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/3/2/4.jpg',
    nasa_viirs:     `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${nasaViirsDate()}/GoogleMapsCompatible_Level9/3/2/4.jpg`,
    bing_sat:       `https://ecn.t0.tiles.virtualearth.net/tiles/a${bingQuadKey(4, 2, 3)}.jpeg?g=1`,
    bing_hybrid:    `https://ecn.t0.tiles.virtualearth.net/tiles/h${bingQuadKey(4, 2, 3)}.jpeg?g=1`
};

function fillLayerThumbs() {
    document.querySelectorAll('.layer-thumb').forEach(el => {
        const key = el.dataset.thumb;
        const url = LAYER_THUMBS[key];
        // url может быть строкой или массивом (несколько изображений друг на друге)
        if (url) el.style.backgroundImage = [].concat(url).map(u => `url("${u}")`).join(', ');
    });
}

// ---------- ЛЕГЕНДА АНАЛИТИЧЕСКИХ СЛОЁВ ----------
// Показывается в нижней панели («Главная» → «Легенда») для активной аналитической подложки.
// В режиме «Шторка» показываются легенды обеих половин.
const LAYER_LEGENDS = {
    esri_landcover: {
        title: 'Земельный покров (Sentinel-2, 10 м)',
        items: [
            ['#1A5BAB', 'Вода'],
            ['#358221', 'Деревья (леса)'],
            ['#87D19E', 'Заболоченная растительность'],
            ['#FFDB5C', 'Сельхозугодья (посевы)'],
            ['#ED022A', 'Застройка'],
            ['#EDE9E4', 'Открытый грунт'],
            ['#F2FAFF', 'Снег и лёд'],
            ['#C8C8C8', 'Облака'],
            ['#C6AD8D', 'Луга, пастбища, кустарники']
        ]
    },
    ndvi: {
        title: 'NDVI — индекс растительности',
        note: 'Стандартная шкала индекса: чем зеленее, тем гуще растительность',
        items: [
            ['#8a8a8a', 'Меньше 0 — вода, снег, облака'],
            ['#c2a878', '0 – 0,1 — голая почва, камни, застройка'],
            ['#e8d98a', '0,1 – 0,2 — редкая, угнетённая растительность'],
            ['#b5d66b', '0,2 – 0,4 — травы, кустарники, всходы'],
            ['#5cb85c', '0,4 – 0,6 — густая растительность, посевы'],
            ['#1e7d34', 'Больше 0,6 — плотные леса, пик вегетации']
        ]
    },
    ndmi: {
        title: 'NDMI — влажность растительности',
        note: 'Чем синее — тем больше влаги в растениях; коричневый — засуха и водный стресс',
        items: [
            ['#01665e', 'Больше 0,4 — высокая влажность растительности'],
            ['#5ab4ac', '0,1 – 0,4 — умеренная влажность'],
            ['#f6e8c3', '−0,2 – 0,1 — низкая влажность'],
            ['#8c510a', 'Меньше −0,2 — сухая растительность, голая почва']
        ]
    },
    nbr: {
        title: 'NBR — индекс гарей',
        note: 'Низкие значения — гари и голая почва, высокие — здоровая густая растительность',
        items: [
            ['#a50026', 'Меньше 0 — свежие гари, голая почва'],
            ['#f46d43', '0 – 0,1 — слабая растительность, старые гари'],
            ['#fee08b', '0,1 – 0,3 — редкая растительность'],
            ['#a6d96a', '0,3 – 0,5 — травы, кустарники, посевы'],
            ['#1a9850', '0,5 – 0,7 — густая растительность'],
            ['#006837', 'Больше 0,7 — плотные леса, пик вегетации']
        ]
    },
    ndwi: {
        title: 'NDWI — индекс водных объектов',
        note: 'Стандартная шкала индекса: чем синее, тем больше воды',
        items: [
            ['#0b3d91', 'Больше 0,3 — открытая вода'],
            ['#4fa3e0', '0 – 0,3 — переувлажнение, заболоченность'],
            ['#e6d5a8', '−0,3 – 0 — суша, умеренная сухость'],
            ['#b08b4f', 'Меньше −0,3 — сухие поверхности, застройка']
        ]
    },
    modified_ndwi: {
        title: 'MNDWI — модифицированный индекс воды',
        note: 'Стандартная шкала индекса: положительные значения — вода',
        items: [
            ['#0b3d91', 'Больше 0,5 — открытая вода'],
            ['#4fa3e0', '0 – 0,5 — мелководье, влажные участки'],
            ['#d9c9a0', '−0,5 – 0 — суша, влажная почва'],
            ['#8f7a4f', 'Меньше −0,5 — застройка, сухая почва, растительность']
        ]
    }
};
// Почвенные слои: шкала строится прямо в интерфейсе (градиент + подписи значений).
// Диапазоны и палитры ориентировочные (типичные значения верхнего слоя почвы).
[
    ['soil_ph', 'Кислотность почвы (pH), 0–5 см',
        'Ниже 5,5 — кислые почвы, 6,5–7,5 — нейтральные, выше 7,5 — щелочные',
        { min: 4, max: 9, ticks: [4, 5, 6, 7, 8, 9], unit: 'pH', low: 'кислая', high: 'щелочная',
          colors: ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac'] }],
    ['soil_soc', 'Органический углерод почвы, 0–5 см',
        'Единицы: дг/кг. Больше углерода — больше гумуса и плодороднее почва',
        { min: 0, max: 500, ticks: [0, 100, 200, 300, 400, 500], unit: 'дг/кг', low: 'меньше', high: 'больше',
          colors: ['#f7f4e9', '#d9c99a', '#a8894f', '#6b4f2a', '#2f1f10'] }],
    ['soil_nitrogen', 'Общий азот в почве, 0–5 см',
        'Единицы: сг/кг. Больше азота — выше природное плодородие',
        { min: 0, max: 800, ticks: [0, 200, 400, 600, 800], unit: 'сг/кг', low: 'меньше', high: 'больше',
          colors: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'] }],
    ['soil_cec', 'Ёмкость катионного обмена (ЕКО), 0–5 см',
        'Единицы: ммоль(экв)/кг. Больше ЕКО — почва лучше удерживает питательные вещества',
        { min: 0, max: 400, ticks: [0, 100, 200, 300, 400], unit: 'ммоль(экв)/кг', low: 'меньше', high: 'больше',
          colors: ['#fff7ec', '#fdd49e', '#fc8d59', '#d7301f', '#7f0000'] }],
    ['soil_clay', 'Содержание глины, 0–5 см',
        'Единицы: г/кг. Больше глины — тяжелее почва, лучше держит влагу',
        { min: 0, max: 600, ticks: [0, 200, 400, 600], unit: 'г/кг', low: 'меньше', high: 'больше',
          colors: ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'] }],
    ['soil_sand', 'Содержание песка, 0–5 см',
        'Единицы: г/кг. Больше песка — легче почва, быстрее дренирует',
        { min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000], unit: 'г/кг', low: 'меньше', high: 'больше',
          colors: ['#ffffe5', '#fff7bc', '#fee391', '#fec44f', '#d9a520'] }]
].forEach(([key, title, note, gradient]) => {
    LAYER_LEGENDS[key] = {
        title: title,
        note: note + '. Шкала ориентировочная (данные ISRIC SoilGrids)',
        gradient: gradient
    };
});

// Градиентная полоса с подписями значений
function renderGradientLegend(g) {
    const span = g.max - g.min;
    const last = g.ticks.length - 1;
    const ticks = g.ticks.map((t, i) => {
        const pct = ((t - g.min) / span) * 100;
        const cls = i === 0 ? ' first' : (i === last ? ' last' : '');
        return `<span class="ll-tick${cls}" style="left:${pct}%"><i></i><b>${t}</b></span>`;
    }).join('');
    return `
        <div class="ll-grad">
            <div class="ll-grad-bar" style="background:linear-gradient(to right, ${g.colors.join(', ')});"></div>
            <div class="ll-grad-scale">${ticks}</div>
            <div class="ll-grad-cap"><span>${g.low}</span><span>${g.unit}</span><span>${g.high}</span></div>
        </div>`;
}

function renderLayerLegendBlock(key) {
    const def = LAYER_LEGENDS[key];
    if (!def) return '';
    const rows = (def.items || []).map(it => `
        <div class="ll-item"><span class="ll-swatch" style="background:${it[0]};"></span><span class="ll-label">${it[1]}</span></div>`).join('');
    const grad = def.gradient ? renderGradientLegend(def.gradient) : '';
    const img = def.image
        ? `<img class="ll-img" src="${def.image}" alt="Шкала значений" onerror="this.outerHTML='<div class=&quot;ll-note&quot;>Шкала цветов сервера временно недоступна</div>'">`
        : '';
    return `
        <div class="ll-block">
            <div class="ll-title">${def.title}</div>
            ${def.note ? `<div class="ll-note">${def.note}</div>` : ''}
            ${rows ? `<div class="ll-items">${rows}</div>` : ''}
            ${grad}
            ${img}
        </div>`;
}

function updateLayerLegend() {
    const box = document.getElementById('layerLegend');
    if (!box) return;
    let keys;
    if (swipeState.active) {
        keys = ['left', 'right'].map(side => swipeState.sides[side] && swipeState.sides[side].layerKey).filter(Boolean);
    } else {
        keys = [currentLayer];
    }
    keys = keys.filter((k, i) => keys.indexOf(k) === i && LAYER_LEGENDS[k]);
    box.innerHTML = keys.map(renderLayerLegendBlock).join('');
    box.hidden = keys.length === 0;
    const emptyNote = document.getElementById('layerLegendEmpty');
    if (emptyNote) emptyNote.hidden = keys.length > 0;
    const parent = box.closest('.bp-legend');
    if (parent) parent.classList.toggle('has-layer', keys.length > 0);
}

// Подложка по умолчанию — Google
const DEFAULT_LAYER = 'google';
let currentLayer = DEFAULT_LAYER;
let currentTileLayer = baseLayers[DEFAULT_LAYER].addTo(map);

// Подсветка активного чипа в панелях «Базовые карты», «Спутниковые снимки» и «Аналитические подложки»
function updateActiveChips(layerKey) {
    document.querySelectorAll('#baseLayersPanel .layer-chip, #satellitePanel .layer-chip, #analyticsPanel .layer-chip').forEach(el => {
        el.classList.toggle('active', el.dataset.layer === layerKey);
    });
    rememberWidgetLayer(layerKey);
    if (window.snPanelSync) window.snPanelSync(layerKey);   // панель дат Sentinel
}

// Кнопки виджетов подложек показывают миниатюру активной подложки своей группы
// или (если сейчас активна подложка другой группы) последней активной из этой группы.
// До первого выбора показывается первая подложка из списка группы.
const WIDGET_BTN_GROUPS = [
    { btn: 'baseLayersBtn', panel: 'baseLayersPanel', group: 'base' },
    { btn: 'satelliteBtn',  panel: 'satellitePanel',  group: 'sat' },
    { btn: 'analyticsBtn',  panel: 'analyticsPanel',  group: 'analytics' }
];
const lastLayerByWidget = {};

function rememberWidgetLayer(layerKey) {
    WIDGET_BTN_GROUPS.forEach(g => {
        if (document.querySelector(`#${g.panel} .layer-chip[data-layer="${layerKey}"]`)) {
            lastLayerByWidget[g.btn] = layerKey;
        }
    });
    updateWidgetButtons();
}

// Ставит на кнопку миниатюру подложки key (общая функция для правых виджетов и кнопок шторки)
function setBtnThumb(btn, key) {
    const url = key && LAYER_THUMBS[key];
    if (!btn || !url) return;
    let thumb = btn.querySelector('.widget-btn-thumb');
    if (!thumb) {
        thumb = document.createElement('span');
        thumb.className = 'widget-btn-thumb';
        btn.appendChild(thumb);
    }
    thumb.style.backgroundImage = [].concat(url).map(u => `url("${u}")`).join(', ');
    btn.classList.add('has-thumb');
}

function firstLayerOfPanel(panelId) {
    const chip = document.querySelector(`#${panelId} .layer-chip`);
    return chip ? chip.dataset.layer : null;
}

function updateWidgetButtons() {
    WIDGET_BTN_GROUPS.forEach(g => {
        setBtnThumb(document.getElementById(g.btn), lastLayerByWidget[g.btn] || firstLayerOfPanel(g.panel));
    });
}

// Состояние виджета «Шторка» (подробности — в разделе «ВИДЖЕТ «ШТОРКА»» ниже)
const swipeState = { active: false, sides: {}, sideEls: {}, lastByGroup: { left: {}, right: {} }, ui: null, frac: 0.5, holdUntil: 0, lastKey: '', raf: 0, prevMaxZoom: undefined, mode: 'swipe' };

function switchLayer(layerKey) {
    // При включённой шторке подложку основной карты выбирают виджеты половин, а не эта функция
    if (swipeState.active) { setSwipeLayer('left', layerKey); return; }
    if (currentLayer === layerKey || !baseLayers[layerKey]) return;
    map.removeLayer(currentTileLayer);
    baseLayers[layerKey].addTo(map);
    currentTileLayer = baseLayers[layerKey];
    currentLayer = layerKey;
    updateActiveChips(layerKey);
    updateLayerLegend();
    updateStatus(`🗺️ Подложка: ${LAYER_NAMES[layerKey] || layerKey}`);
}

// ============================================================
//  РЕДАКТОР ВЕРШИН (общий для «Снимков / NDVI…» и виджета «Рисование»)
//  Работает так же, как правка в «Анализе участка»: зелёные вершины тянутся мышью,
//  серые точки на рёбрах добавляют вершину (клик), клик по вершине → ✕ → второй клик удаляет её.
//  Круг: центр и радиус; прямоугольник: углы.
// ============================================================
function gcVx(layer, opts) {
    opts = opts || {};
    const isCircle = layer instanceof L.Circle, isRect = !isCircle && layer instanceof L.Rectangle;
    const isPoly = !isCircle && !isRect && layer instanceof L.Polygon;
    const mk = [], mids = [];
    let armed = null;
    const fire = fin => { if (opts.onChange) opts.onChange(layer, fin); };
    const icon = (c, s) => L.divIcon({
        className: 'gc-vx',
        html: '<div style="background:' + c + ';width:' + s + 'px;height:' + s + 'px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font:700 10px/1 sans-serif;transition:transform .12s"></div>',
        iconSize: [s + 4, s + 4], iconAnchor: [(s + 4) / 2, (s + 4) / 2]
    });
    const mkr = (ll, c, s, z) => L.marker(ll, { draggable: true, keyboard: false, zIndexOffset: z || 1000, icon: icon(c, s) }).addTo(map);
    const flat = () => { const a = layer.getLatLngs(); return isPoly ? (Array.isArray(a[0]) ? a[0] : a) : a; };
    const setFlat = a => layer.setLatLngs(isPoly ? [a] : a);
    const clear = () => { mk.splice(0).concat(mids.splice(0)).forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); }); armed = null; };
    const dotOf = m => m && m._icon ? m._icon.firstChild : null;
    const disarm = () => {
        const d = dotOf(armed);
        if (d) { d.style.background = '#059669'; d.style.transform = 'scale(1)'; d.textContent = ''; }
        armed = null;
    };
    const arm = m => {
        armed = m;
        const d = dotOf(m);
        if (d) { d.style.background = '#ef4444'; d.style.transform = 'scale(1.6)'; d.textContent = '✕'; }
        if (typeof updateStatus === 'function') updateStatus('🗑️ Кликните ещё раз, чтобы удалить вершину');
    };
    const mid = (p, q2) => L.latLng((p.lat + q2.lat) / 2, (p.lng + q2.lng) / 2);

    function placeMids() {
        const a = flat(), n = a.length;
        mids.forEach((m, i) => m.setLatLng(mid(a[i], a[(i + 1) % n])));
    }
    function buildMids() {
        mids.splice(0).forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
        const a = flat(), n = a.length, cnt = isPoly ? n : n - 1;
        for (let i = 0; i < cnt; i++) {
            const m = L.marker(mid(a[i], a[(i + 1) % n]), { keyboard: false, zIndexOffset: 900, icon: icon('#94a3b8', 8) }).addTo(map);
            m._i = i;
            m.on('mouseover', () => { const d = dotOf(m); if (d) { d.style.background = '#059669'; d.style.transform = 'scale(1.5)'; } });
            m.on('mouseout', () => { const d = dotOf(m); if (d) { d.style.background = '#94a3b8'; d.style.transform = 'scale(1)'; } });
            m.on('click', () => {
                const b = flat().slice();
                b.splice(m._i + 1, 0, m.getLatLng());
                setFlat(b); build(); fire(true);
                if (typeof updateStatus === 'function') updateStatus('✅ Добавлена вершина (всего: ' + b.length + ')');
            });
            mids.push(m);
        }
    }
    function buildPath() {
        const pts = flat().map(p => L.latLng(p.lat, p.lng)), min = isPoly ? 3 : 2;
        pts.forEach((p, i) => {
            const m = mkr(p, '#059669', 12);
            m._i = i;
            m.on('drag', ev => { const a = flat().slice(); a[m._i] = ev.target.getLatLng(); setFlat(a); placeMids(); fire(false); });
            m.on('dragend', () => { m._dt = Date.now(); fire(true); });
            m.on('mouseover', () => { const d = dotOf(m); if (d && armed !== m) d.style.transform = 'scale(1.4)'; });
            m.on('mouseout', () => { const d = dotOf(m); if (d && armed !== m) d.style.transform = 'scale(1)'; });
            m.on('click', () => {
                if (m._dt && Date.now() - m._dt < 300) return;   // клик после перетаскивания не считается
                if (flat().length <= min) { if (typeof updateStatus === 'function') updateStatus('⚠️ Нельзя удалить: минимум ' + min + ' вершины', true); return; }
                if (armed === m) {
                    const a = flat().slice();
                    a.splice(m._i, 1);
                    setFlat(a); build(); fire(true);
                    if (typeof updateStatus === 'function') updateStatus('✅ Вершина удалена (осталось: ' + a.length + ')');
                } else { disarm(); arm(m); }
            });
            mk.push(m);
        });
        buildMids();
    }
    function buildCircle() {
        const cen = () => layer.getLatLng();
        const rp = () => {
            const c = cen(), d = turf.destination([c.lng, c.lat], layer.getRadius() / 1000, 90, { units: 'kilometers' }).geometry.coordinates;
            return L.latLng(d[1], d[0]);
        };
        const cm = mkr(cen(), '#3b82f6', 12), rm = mkr(rp(), '#f59e0b', 12);
        cm.on('drag', ev => { layer.setLatLng(ev.target.getLatLng()); rm.setLatLng(rp()); fire(false); });
        rm.on('drag', ev => { layer.setRadius(Math.max(1, cen().distanceTo(ev.target.getLatLng()))); fire(false); });
        cm.on('dragend', () => fire(true));
        rm.on('dragend', () => fire(true));
        mk.push(cm, rm);
    }
    function buildRect() {
        const cor = b => [b.getSouthWest(), b.getSouthEast(), b.getNorthEast(), b.getNorthWest()];
        cor(layer.getBounds()).forEach((c, i) => {
            const m = mkr(c, '#8b5cf6', 12);
            m.on('dragstart', () => { m._opp = cor(layer.getBounds())[(i + 2) % 4]; });
            m.on('drag', ev => {
                const nb = L.latLngBounds([m._opp, ev.target.getLatLng()]), cs = cor(nb);
                layer.setBounds(nb);
                mk.forEach((o, j) => { if (o !== m) o.setLatLng(cs[j]); });
                fire(false);
            });
            m.on('dragend', () => { fire(true); setTimeout(build, 0); });
            mk.push(m);
        });
    }
    function build() {
        clear();
        if (isCircle) buildCircle(); else if (isRect) buildRect(); else buildPath();
    }
    build();
    return { layer: layer, refresh: build, destroy: clear };
}

// ============================================================
//  ЗОНЫ ДЛЯ ДИФФЕРЕНЦИРОВАННОГО ВНЕСЕНИЯ УДОБРЕНИЙ И АНОМАЛЬНЫЕ ТОЧКИ NDVI
//  Исходные данные — растр NDVI внутри фигуры (10 м), см. snExportGeoTiff({ raw: true }).
// ============================================================
function snZoneColors(k) {
    const st = [[215, 48, 39], [254, 224, 139], [26, 152, 80]], out = [];
    for (let i = 0; i < k; i++) {
        const s = (k === 1 ? 0.5 : i / (k - 1)) * 2, a = s < 1 ? 0 : 1, f = s < 1 ? s : s - 1, p = st[a], q2 = st[a + 1];
        out.push('#' + [0, 1, 2].map(j => Math.round(p[j] + (q2[j] - p[j]) * f).toString(16).padStart(2, '0')).join(''));
    }
    return out;
}
function snChaikin(p, it) {
    for (let k = 0; k < it; k++) {
        const o = [], n = p.length;
        for (let i = 0; i < n; i++) {
            const a = p[i], b = p[(i + 1) % n];
            o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        p = o;
    }
    return p;
}
function snRingArea(r) {
    let s = 0;
    for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
}
function snPip(x, y, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
}
// границы клеток одного класса → кольца (в координатах пикселей; внешние > 0, дыры < 0)
function snTraceClass(cl, W, H, c) {
    const W1 = W + 1, fv = [], tv = [], dr = [], out = new Map();
    const add = (x0, y0, x1, y1, d) => {
        const a = y0 * W1 + x0, e = fv.length;
        fv.push(a); tv.push(y1 * W1 + x1); dr.push(d);
        const l = out.get(a);
        if (l) l.push(e); else out.set(a, [e]);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (cl[y * W + x] !== c) continue;
        if (y === 0 || cl[(y - 1) * W + x] !== c) add(x, y, x + 1, y, 0);
        if (x === W - 1 || cl[y * W + x + 1] !== c) add(x + 1, y, x + 1, y + 1, 1);
        if (y === H - 1 || cl[(y + 1) * W + x] !== c) add(x + 1, y + 1, x, y + 1, 2);
        if (x === 0 || cl[y * W + x - 1] !== c) add(x, y + 1, x, y, 3);
    }
    const used = new Uint8Array(fv.length), rings = [];
    for (let s = 0; s < fv.length; s++) {
        if (used[s]) continue;
        const pts = [];
        let e = s, pd = -1, guard = 0;
        for (;;) {
            used[e] = 1;
            if (dr[e] !== pd) { const v = fv[e]; pts.push([v % W1, (v / W1) | 0]); pd = dr[e]; }
            const cand = (out.get(tv[e]) || []).filter(j => !used[j] || j === s);
            if (!cand.length || ++guard > 5e6) break;
            let nx = cand[0];
            if (cand.length > 1) {   // в «седловой» вершине поворачиваем направо — области связны по 4 соседям
                const want = [(dr[e] + 1) % 4, dr[e], (dr[e] + 3) % 4];
                for (const w of want) { const f = cand.find(j => dr[j] === w); if (f !== undefined) { nx = f; break; } }
            }
            if (nx === s) break;
            e = nx;
        }
        if (pts.length >= 4) rings.push({ pts: pts, a: snRingArea(pts) });
    }
    return rings;
}
async function snMakeZones(r, k, method, shapeGJ) {
    const W = r.W, H = r.H, v = r.values, m = r.mask, N = W * H;
    if (N > 8e6) throw new Error('область слишком большая для построения зон — уменьшите фигуру');
    let nv = 0;
    for (let i = 0; i < N; i++) if (m[i] && v[i] === v[i]) nv++;
    if (nv < 20) throw new Error('в фигуре слишком мало данных для зон');
    const a = new Float32Array(nv);
    for (let i = 0, j = 0; i < N; i++) if (m[i] && v[i] === v[i]) a[j++] = v[i];
    a.sort();
    const pq = p => a[Math.min(nv - 1, Math.max(0, Math.floor(p * (nv - 1))))];
    if (!(a[nv - 1] - a[0] > 1e-4)) throw new Error('NDVI в фигуре почти не меняется — зоны выделить нельзя');
    const th = [];
    if (method === 'e') { const lo = pq(0.02), hi = pq(0.98); for (let i = 1; i < k; i++) th.push(lo + (hi - lo) * i / k); }
    else for (let i = 1; i < k; i++) th.push(pq(i / k));
    for (let i = 1; i < th.length; i++) if (!(th[i] > th[i - 1])) th[i] = th[i - 1] + 1e-6;

    // 1. классы по порогам
    const cls = new Int8Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (m[i] && v[i] === v[i]) { let c = 0; while (c < th.length && v[i] >= th[c]) c++; cls[i] = c; }
    await snDelay(0);
    // 2. сглаживание «модой» 3×3 (убирает пиксельный шум)
    const cnt = new Int32Array(k);
    for (let pass = 0; pass < 2; pass++) {
        const src = cls.slice();
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (src[i] < 0) continue;
            cnt.fill(0);
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= H) continue;
                for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const c = src[yy * W + xx]; if (c >= 0) cnt[c]++; }
            }
            let best = src[i], bc = cnt[best];
            for (let c = 0; c < k; c++) if (cnt[c] > bc) { bc = cnt[c]; best = c; }
            cls[i] = best;
        }
    }
    await snDelay(0);
    // 3. мелкие островки (< 0,5 % площади) вливаются в соседний класс
    const minPx = Math.max(6, Math.round(nv * 0.005));
    const stack = new Int32Array(N), buf = new Int32Array(N);
    for (let it = 0; it < 2; it++) {
        const lab = new Uint8Array(N);
        for (let s = 0; s < N; s++) {
            if (cls[s] < 0 || lab[s]) continue;
            const cc = cls[s];
            let sp = 0, n = 0;
            stack[sp++] = s; lab[s] = 1;
            while (sp) {
                const p = stack[--sp], x = p % W;
                buf[n++] = p;
                if (x > 0 && !lab[p - 1] && cls[p - 1] === cc) { lab[p - 1] = 1; stack[sp++] = p - 1; }
                if (x < W - 1 && !lab[p + 1] && cls[p + 1] === cc) { lab[p + 1] = 1; stack[sp++] = p + 1; }
                if (p >= W && !lab[p - W] && cls[p - W] === cc) { lab[p - W] = 1; stack[sp++] = p - W; }
                if (p < N - W && !lab[p + W] && cls[p + W] === cc) { lab[p + W] = 1; stack[sp++] = p + W; }
            }
            if (n >= minPx) continue;
            cnt.fill(0);
            for (let i = 0; i < n; i++) {
                const p = buf[i], x = p % W;
                [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p >= W ? p - W : -1, p < N - W ? p + W : -1].forEach(q2 => { if (q2 >= 0 && cls[q2] >= 0 && cls[q2] !== cc) cnt[cls[q2]]++; });
            }
            let best = -1, bc = 0;
            for (let c = 0; c < k; c++) if (cnt[c] > bc) { bc = cnt[c]; best = c; }
            if (best >= 0) for (let i = 0; i < n; i++) cls[buf[i]] = best;
        }
    }
    await snDelay(0);
    // 4. по краю фигуры класс продлевается на 2 пикселя наружу — потом зоны обрезаются точным контуром
    const cl2 = cls.slice();
    for (let pass = 0; pass < 2; pass++) {
        const src = cl2.slice();
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (m[i] || src[i] >= 0) continue;
            let f = -1;
            for (let dy = -1; dy <= 1 && f < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                if (src[yy * W + xx] >= 0) { f = src[yy * W + xx]; break; }
            }
            if (f >= 0) cl2[i] = f;
        }
    }
    // 5. статистика по итоговым классам
    const sum = new Float64Array(k), num = new Int32Array(k), mn = new Float32Array(k).fill(Infinity), mx = new Float32Array(k).fill(-Infinity);
    for (let i = 0; i < N; i++) {
        const c = cls[i];
        if (c < 0) continue;
        sum[c] += v[i]; num[c]++;
        if (v[i] < mn[c]) mn[c] = v[i];
        if (v[i] > mx[c]) mx[c] = v[i];
    }
    // 6. векторизация, сглаживание, перевод в координаты, обрезка по фигуре
    const fwd = snProj(r.epsg), colors = snZoneColors(k), zones = [];
    const toLL = p => fwd.inverse([r.minE + p[0] * SN_RES, r.maxN - p[1] * SN_RES]);
    const closeRing = rg => { rg.push(rg[0]); return rg; };
    for (let c = 0; c < k; c++) {
        await snDelay(0);
        const rings = snTraceClass(cl2, W, H, c);
        const outers = rings.filter(x => x.a > 0).map(o => ({ o: o, h: [] }));
        rings.filter(x => x.a < 0).forEach(h => {
            const p0 = h.pts[0], p1 = h.pts[1], dx = p1[0] - p0[0], dy = p1[1] - p0[1];
            const lv = dx > 0 ? [0, -1] : dx < 0 ? [0, 1] : dy > 0 ? [1, 0] : [-1, 0];   // слева от хода — внутри дыры
            const tx = (p0[0] + p1[0]) / 2 + lv[0] * 0.5, ty = (p0[1] + p1[1]) / 2 + lv[1] * 0.5;
            let own = null;
            outers.forEach(o => { if (snPip(tx, ty, o.o.pts) && (!own || o.o.a < own.o.a)) own = o; });
            if (own) own.h.push(h);
        });
        const coords = [];
        outers.forEach(o => {
            const rg = [o.o].concat(o.h).map(x => closeRing(snChaikin(x.pts, 2).map(toLL)));
            let f = turf.polygon(rg);
            try { const cut = turf.intersect(f, shapeGJ); if (cut) f = cut; else return; } catch (e) { /* оставляем без обрезки */ }
            if (f.geometry.type === 'Polygon') coords.push(f.geometry.coordinates); else f.geometry.coordinates.forEach(pl => coords.push(pl));
        });
        let feat = null, ha = 0;
        if (coords.length) {
            feat = turf.multiPolygon(coords);
            try { feat = turf.simplify(feat, { tolerance: 0.000006, highQuality: false }); } catch (e) { }
            ha = turf.area(feat) / 10000;
        }
        zones.push({ i: c, name: 'Зона ' + (c + 1), color: colors[c], feat: feat, ha: ha, n: num[c], mean: num[c] ? sum[c] / num[c] : NaN, min: mn[c], max: mx[c] });
    }
    return { k: k, th: th, zones: zones, rates: new Array(k).fill(0) };
}
// аномальные точки: пиксели, сильно отличающиеся от медианы поля (устойчивая оценка по MAD)
function snFindAnoms(r, sig) {
    const W = r.W, H = r.H, v = r.values, m = r.mask, N = W * H;
    if (N > 8e6) throw new Error('область слишком большая для поиска аномалий — уменьшите фигуру');
    let nv = 0;
    for (let i = 0; i < N; i++) if (m[i] && v[i] === v[i]) nv++;
    if (nv < 30) throw new Error('в фигуре слишком мало данных');
    const a = new Float32Array(nv);
    for (let i = 0, j = 0; i < N; i++) if (m[i] && v[i] === v[i]) a[j++] = v[i];
    a.sort();
    const med = a[nv >> 1], dv = new Float32Array(nv);
    for (let i = 0; i < nv; i++) dv[i] = Math.abs(a[i] - med);
    dv.sort();
    const sc = Math.max(1.4826 * dv[nv >> 1], 0.02), lim = Math.max(sig * sc, 0.08);
    const ok = i => m[i] && v[i] === v[i];
    const flag = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {   // у границы фигуры (смешанные пиксели) аномалии не ищем
        const i = y * W + x;
        if (!ok(i) || !m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W]) continue;
        if (Math.abs(v[i] - med) > lim) flag[i] = 1;
    }
    const fwd = snProj(r.epsg), seen = new Uint8Array(N), stack = new Int32Array(N), pts = [];
    for (let s = 0; s < N; s++) {
        if (!flag[s] || seen[s]) continue;
        let sp = 0, n = 0, best = s;
        stack[sp++] = s; seen[s] = 1;
        while (sp) {
            const p = stack[--sp];
            n++;
            if (Math.abs(v[p] - med) > Math.abs(v[best] - med)) best = p;
            const x = p % W, y = (p / W) | 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                const q2 = yy * W + xx;
                if (flag[q2] && !seen[q2]) { seen[q2] = 1; stack[sp++] = q2; }
            }
        }
        if (n < 2) continue;   // одиночные пиксели — шум
        const bx = best % W, by = (best / W) | 0, ll = fwd.inverse([r.minE + (bx + 0.5) * SN_RES, r.maxN - (by + 0.5) * SN_RES]);
        pts.push({ lng: ll[0], lat: ll[1], v: v[best], z: (v[best] - med) / sc, n: n, ha: n * 0.01 });
    }
    pts.sort((p, q2) => Math.abs(q2.z) * Math.sqrt(q2.n) - Math.abs(p.z) * Math.sqrt(p.n));
    const all = pts.length, top = pts.slice(0, 200);
    return { pts: top, total: all, med: med, scale: sc, sigma: sig, nLow: top.filter(p => p.z < 0).length, nHigh: top.filter(p => p.z > 0).length };
}

// ---------- экспорт векторного слоя: KML и Shapefile (ZIP) ----------
function snKml(feats, title) {
    const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const ring = rg => rg.map(p => p[0].toFixed(7) + ',' + p[1].toFixed(7) + ',0').join(' ');
    const kc = hex => 'a0' + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
    const pm = feats.map(f => {
        const p = f.properties, polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        return '<Placemark><name>' + x(p.name) + '</name><Style><LineStyle><color>ffffffff</color><width>1.5</width></LineStyle><PolyStyle><color>' + kc(p.color || '#10b981') + '</color></PolyStyle></Style><ExtendedData>' +
            ['zone', 'ndvi_min', 'ndvi_max', 'ndvi_mean', 'area_ha', 'rate_kgha', 'total_kg', 'date'].map(k => '<Data name="' + k + '"><value>' + x(p[k]) + '</value></Data>').join('') +
            '</ExtendedData><MultiGeometry>' + polys.map(pl => '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + ring(pl[0]) + '</coordinates></LinearRing></outerBoundaryIs>' +
                pl.slice(1).map(h => '<innerBoundaryIs><LinearRing><coordinates>' + ring(h) + '</coordinates></LinearRing></innerBoundaryIs>').join('') + '</Polygon>').join('') + '</MultiGeometry></Placemark>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + x(title) + '</name>' + pm + '</Document></kml>';
}
function snCrc32(u8) {
    if (!snCrc32.t) {
        snCrc32.t = new Int32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; snCrc32.t[n] = c; }
    }
    let crc = -1;
    for (let i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ snCrc32.t[(crc ^ u8[i]) & 255];
    return (crc ^ -1) >>> 0;
}
function snZip(files) {   // ZIP без сжатия
    const enc = new TextEncoder(), parts = [], cd = [];
    let off = 0, cdSize = 0;
    files.forEach(f => {
        const nm = enc.encode(f.name), crc = snCrc32(f.data), len = f.data.length;
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 33, true);
        h.setUint32(14, crc, true); h.setUint32(18, len, true); h.setUint32(22, len, true); h.setUint16(26, nm.length, true);
        parts.push(h.buffer, nm, f.data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true);
        c.setUint32(16, crc, true); c.setUint32(20, len, true); c.setUint32(24, len, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
        cd.push(c.buffer, nm);
        cdSize += 46 + nm.length;
        off += 30 + nm.length + len;
    });
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cd, [e.buffer]), { type: 'application/zip' });
}
function snShpZip(feats, base) {
    const recs = feats.map(f => {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates, rings = [];
        polys.forEach(pl => pl.forEach((rg, ri) => {
            const ar = snRingArea(rg);
            rings.push((ri === 0 && ar > 0) || (ri > 0 && ar < 0) ? rg.slice().reverse() : rg);   // внешние — по часовой, дыры — против
        }));
        let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        rings.forEach(rg => rg.forEach(p => { n++; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }));
        return { rings: rings, n: n, bb: [x0, y0, x1, y1], len: 44 + 4 * rings.length + 16 * n };
    });
    const bb = recs.reduce((b, r) => [Math.min(b[0], r.bb[0]), Math.min(b[1], r.bb[1]), Math.max(b[2], r.bb[2]), Math.max(b[3], r.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const shpLen = 100 + recs.reduce((s, r) => s + 8 + r.len, 0), shxLen = 100 + 8 * recs.length;
    const head = (dv, bytes) => {
        dv.setInt32(0, 9994, false); dv.setInt32(24, bytes / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, 5, true);
        for (let i = 0; i < 4; i++) dv.setFloat64(36 + 8 * i, bb[i], true);
    };
    const shp = new DataView(new ArrayBuffer(shpLen)), shx = new DataView(new ArrayBuffer(shxLen));
    head(shp, shpLen); head(shx, shxLen);
    let o = 100;
    recs.forEach((r, i) => {
        shx.setInt32(100 + 8 * i, o / 2, false); shx.setInt32(104 + 8 * i, r.len / 2, false);
        shp.setInt32(o, i + 1, false); shp.setInt32(o + 4, r.len / 2, false);
        shp.setInt32(o + 8, 5, true);
        for (let k = 0; k < 4; k++) shp.setFloat64(o + 12 + 8 * k, r.bb[k], true);
        shp.setInt32(o + 44, r.rings.length, true); shp.setInt32(o + 48, r.n, true);
        let pi = 0, po = o + 52 + 4 * r.rings.length;
        r.rings.forEach((rg, j) => {
            shp.setInt32(o + 52 + 4 * j, pi, true);
            rg.forEach(p => { shp.setFloat64(po, p[0], true); shp.setFloat64(po + 8, p[1], true); po += 16; });
            pi += rg.length;
        });
        o += 8 + r.len;
    });
    const defs = [['ZONE', 'N', 3, 0, 'zone'], ['NDVI_MIN', 'N', 9, 4, 'ndvi_min'], ['NDVI_MAX', 'N', 9, 4, 'ndvi_max'], ['NDVI_MEAN', 'N', 9, 4, 'ndvi_mean'],
        ['AREA_HA', 'N', 12, 3, 'area_ha'], ['RATE_KGHA', 'N', 10, 1, 'rate_kgha'], ['TOTAL_KG', 'N', 13, 1, 'total_kg'], ['DATE', 'C', 10, 0, 'date']];
    const recLen = 1 + defs.reduce((s, d) => s + d[2], 0), hdrLen = 33 + 32 * defs.length;
    const dbf = new Uint8Array(hdrLen + recLen * feats.length + 1), dd = new DataView(dbf.buffer), now = new Date();
    dbf[0] = 3; dbf[1] = now.getFullYear() - 1900; dbf[2] = now.getMonth() + 1; dbf[3] = now.getDate();
    dd.setUint32(4, feats.length, true); dd.setUint16(8, hdrLen, true); dd.setUint16(10, recLen, true);
    const put = (p, s) => { for (let i = 0; i < s.length; i++) dbf[p + i] = s.charCodeAt(i) & 127; };
    defs.forEach((d, i) => { const p = 32 + 32 * i; put(p, d[0]); dbf[p + 11] = d[1].charCodeAt(0); dbf[p + 16] = d[2]; dbf[p + 17] = d[3]; });
    dbf[32 + 32 * defs.length] = 13;
    feats.forEach((f, i) => {
        let p = hdrLen + recLen * i;
        dbf[p++] = 32;
        defs.forEach(d => {
            const val = f.properties[d[4]];
            const s = d[1] === 'N' ? (Number.isFinite(+val) ? (+val).toFixed(d[3]) : '').padStart(d[2]).slice(-d[2]) : String(val == null ? '' : val).padEnd(d[2]).slice(0, d[2]);
            put(p, s); p += d[2];
        });
    });
    dbf[dbf.length - 1] = 26;
    const prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    return snZip([
        { name: base + '.shp', data: new Uint8Array(shp.buffer) }, { name: base + '.shx', data: new Uint8Array(shx.buffer) },
        { name: base + '.dbf', data: dbf }, { name: base + '.prj', data: new TextEncoder().encode(prj) }
    ]);
}

// ============================================================
//  РАЗДЕЛЫ БОКОВОЙ ПАНЕЛИ: «Снимки» · NDVI · NDWI (и MNDWI) · NDMI · NBR  (спутник Sentinel-2)
//  Каждый раздел — это вкладка бывшей нижней панели, показанная в боковой панели (см. site.js).
//  В разделе: инструменты рисования области (как в «Анализе участка»), календарь дат, облачность,
//  «скрины» снимков выбранной даты и список дат с превью, скачивание GeoTIFF по нарисованной фигуре.
// ============================================================
(function () {
    const SEC = {
        dates: { name: 'Снимки', sub: 'Sentinel-2 L2A · снимки по датам', icon: 'fa-calendar-days', kind: 'rgb',
                 vars: [{ l: 'sentinel2', t: 'Естественные', h: 'Естественные цвета (RGB)' }, { l: 'falsecolor', t: 'Ложные цвета', h: 'Ложные цвета CIR: NIR · Red · Green' }] },
        ndvi:  { name: 'NDVI', sub: 'Индекс растительности: густота и состояние посевов', icon: 'fa-leaf', kind: 'idx',
                 vars: [{ l: 'ndvi', t: 'NDVI', h: 'Стандартная шкала NDVI' }, { l: 'ndvi_c', t: 'Контрастный NDVI', h: 'Шкала растянута на выбранный диапазон — виден разброс внутри поля' }] },
        ndwi:  { name: 'NDWI', sub: 'Индекс воды и переувлажнения', icon: 'fa-droplet', kind: 'idx',
                 vars: [{ l: 'ndwi', t: 'NDWI', h: 'NDWI (Green, NIR)' }, { l: 'modified_ndwi', t: 'MNDWI', h: 'MNDWI (Green, SWIR)' }] },
        ndmi:  { name: 'NDMI', sub: 'Влажность растительности: засуха и водный стресс', icon: 'fa-cloud-rain', kind: 'idx', vars: [{ l: 'ndmi', t: 'NDMI', h: '' }] },
        nbr:   { name: 'NBR', sub: 'Гари и повреждение растительности', icon: 'fa-fire', kind: 'idx', vars: [{ l: 'nbr', t: 'NBR', h: '' }] }
    };
    const LAYER_SEC = { sentinel2: 'dates', falsecolor: 'dates', ndvi: 'ndvi', ndvi_c: 'ndvi', ndwi: 'ndwi', modified_ndwi: 'ndwi', ndmi: 'ndmi', nbr: 'nbr' };
    const LAYER_NOTE = {
        sentinel2: 'Снимок в естественных цветах (канал TCI, 10 м)',
        falsecolor: 'Ложные цвета: NIR · Red · Green → R · G · B, каналы 10 м',
        ndvi: 'NDVI = (NIR − Red) / (NIR + Red), каналы 10 м',
        ndvi_c: 'NDVI = (NIR − Red) / (NIR + Red); цвета — по выбранному диапазону контраста',
        ndwi: 'NDWI = (Green − NIR) / (Green + NIR), каналы 10 м',
        modified_ndwi: 'MNDWI = (Green − SWIR1) / (Green + SWIR1); SWIR (20 м) приводится к сетке 10 м',
        ndmi: 'NDMI = (NIR − SWIR1) / (NIR + SWIR1); SWIR (20 м) приводится к сетке 10 м',
        nbr: 'NBR = (NIR − SWIR2) / (NIR + SWIR2); SWIR (20 м) приводится к сетке 10 м'
    };
    const LEG_TXT = { ndvi: ['голая почва, вода', 'густая растительность'], ndvi_c: ['слабая', 'густая растительность'], ndwi: ['суша', 'вода'], modified_ndwi: ['суша', 'вода'], ndmi: ['сухо', 'влажно'], nbr: ['гарь, голая почва', 'густая растительность'] };
    // классы для калькулятора: [от, до, подпись, цвет]
    const CLS = {
        ndvi: [[-9, 0.1, 'Вода, голая почва, застройка', '#c2a878'], [0.1, 0.2, 'Очень редкая растительность', '#e8d98a'], [0.2, 0.4, 'Редкая, всходы, травы', '#b5d66b'], [0.4, 0.6, 'Густая растительность, посевы', '#5cb85c'], [0.6, 9, 'Плотная, пик вегетации', '#1e7d34']],
        ndwi: [[-9, 0, 'Суша', '#d9c9a0'], [0, 0.3, 'Переувлажнение', '#4fa3e0'], [0.3, 9, 'Открытая вода', '#0b3d91']],
        modified_ndwi: [[-9, 0, 'Суша', '#d9c9a0'], [0, 0.5, 'Мелководье, влажные участки', '#4fa3e0'], [0.5, 9, 'Открытая вода', '#0b3d91']],
        ndmi: [[-9, -0.2, 'Сухая растительность, почва', '#8c510a'], [-0.2, 0.1, 'Низкая влажность', '#f6e8c3'], [0.1, 0.4, 'Умеренная влажность', '#5ab4ac'], [0.4, 9, 'Высокая влажность', '#01665e']],
        nbr: [[-9, 0.1, 'Гари, голая почва', '#f46d43'], [0.1, 0.3, 'Редкая растительность', '#fee08b'], [0.3, 0.5, 'Травы, кустарники, посевы', '#a6d96a'], [0.5, 9, 'Густая растительность', '#1a9850']]
    };
    const ui = {};
    let searching = 0, lastCalc = null, ctrT = 0;
    let sec = null, month = null, groups = [], seq = 0, timer = 0, note = '', entering = false, busy = false, abort = false;
    const stacCache = {};
    // надпись «Загрузка снимков» на карте: пока идёт поиск снимков или рисуются тайлы (другая подложка не показывается)
    const lo = document.createElement('div');
    lo.className = 'sn-loading'; lo.hidden = true;
    lo.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Загрузка снимков…</span>';
    (document.getElementById('mapStage') || document.querySelector('.map-stage') || document.body).appendChild(lo);
    const lf = { search: false, tiles: false };
    window.snLoadingSet = (k, v) => { lf[k] = v; lo.hidden = !(sec && (lf.search || lf.tiles)); };
    const setSearch = d => { searching = Math.max(0, searching + d); window.snLoadingSet('search', searching > 0); };
    const grp = L.featureGroup();
    let shape = null, shapeGJ = null, handler = null, tool = null, editing = false, shapeTimer = 0;
    let vx = null, lastRaster = null, zoneRes = null, anomRes = null, zoneVis = true, anomVis = true;   // редактор вершин, растр NDVI, зоны и аномалии
    const zoneGrp = L.featureGroup(), anomGrp = L.featureGroup();

    const p2 = n => String(n).padStart(2, '0');
    const monthStart = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const dayDate = s => new Date(s + 'T00:00:00Z');
    const fmtDay = s => dayDate(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const ccColor = c => c == null ? '#94a3b8' : c <= 10 ? '#10b981' : c <= 30 ? '#84cc16' : c <= 60 ? '#f59e0b' : '#ef4444';
    const ccText = c => c == null ? '—' : c + '%';
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const tileOf = id => ((/_(\d{2}[A-Z]{3})_/.exec(id || '')) || [])[1] || '';
    const variant = { dates: 'sentinel2', ndvi: 'ndvi', ndwi: 'ndwi', ndmi: 'ndmi', nbr: 'nbr' };   // выбранный вариант слоя в каждом разделе
    const layerOf = s => variant[s];
    const q = (s, n) => ui[s].pane.querySelector('[data-sn="' + n + '"]');
    const eachPane = fn => Object.keys(ui).forEach(s => fn(s, ui[s].pane));
    const thumbUrl = href => {
        const m = /^https:\/\/sentinel-cogs\.s3\.[a-z0-9-]+\.amazonaws\.com\/(.+)$/.exec(href || '');
        return (m && SENTINEL.proxyOk) ? '/s3/' + m[1] : href;   // через локальный прокси картинки кэшируются на диске
    };

    // ---------- разметка раздела ----------
    function tpl(s) {
        const d = SEC[s], isIdx = d.kind === 'idx';
        const vars = d.vars.length > 1
            ? '<div class="sn-seg" role="group">' + d.vars.map(v => '<button type="button" data-sn-var="' + v.l + '" title="' + v.h + '">' + v.t + '</button>').join('') + '</div>' : '';
        const fmt = isIdx
            ? '<div class="dw-row"><label>Формат</label><select data-sn="fmt"><option value="rgb" selected>Цветной (как на карте)</option><option value="val">Значения индекса (Float32)</option></select></div>' : '';
        const contrast = s !== 'ndvi' ? '' :
            '<div class="dw-block sn-ctr" data-sn="ctr" hidden><div class="dw-title">Контраст NDVI</div>' +
            '<div class="m3-hint">Шкала растянута на выбранный диапазон — так лучше видна разница внутри поля. «Авто» подбирает диапазон по данным области (фигура или видимая карта).</div>' +
            '<div class="dw-row"><label>От</label><input type="range" data-sn="cMin" min="-0.2" max="0.8" step="0.05"><span class="dw-val" data-sn="cMinV"></span></div>' +
            '<div class="dw-row"><label>До</label><input type="range" data-sn="cMax" min="0.3" max="1" step="0.05"><span class="dw-val" data-sn="cMaxV"></span></div>' +
            '<button type="button" class="dw-act" data-sn-act="auto"><i class="fas fa-wand-magic-sparkles"></i><span>Авто по области</span></button></div>';
        const zset = s !== 'ndvi' ? '' :
            '<div class="sn-zset"><div class="sn-zt-t">Зоны внесения и аномалии</div>' +
            '<div class="m3-hint">При расчёте дополнительно строятся зоны для дифференцированного внесения удобрений и точки с аномальными значениями NDVI — они появятся на карте внутри фигуры.</div>' +
            '<div class="dw-row"><label>Число зон</label><input type="number" data-sn="zN" min="2" max="10" step="1" value="3"></div>' +
            '<div class="dw-row"><label>Разбиение</label><select data-sn="zM"><option value="q" selected>Равные по площади</option><option value="e">Равные интервалы NDVI</option></select></div>' +
            '<div class="dw-row"><label>Норма, кг/га</label><input type="number" data-sn="zBase" min="0" step="1" value="100"></div>' +
            '<div class="dw-row"><label>Нормы по зонам</label><select data-sn="zS"><option value="eq" selected>Одинаковые (правка вручную)</option><option value="low">Больше там, где NDVI ниже (±20%)</option><option value="high">Больше там, где NDVI выше (±20%)</option></select></div>' +
            '<div class="dw-row"><label>Порог аномалий, σ</label><input type="number" data-sn="aS" min="1.5" max="8" step="0.5" value="3"></div></div>';
        const calc = !isIdx ? '' :
            '<div class="dw-block sn-calc"><div class="dw-title">Калькулятор · ' + d.name + '</div>' +
            '<div class="m3-hint">Статистика индекса по пикселям внутри нарисованной фигуры (10 м) на выбранную дату: среднее, разброс, классы и площади.</div>' +
            zset +
            '<button type="button" class="dw-act" data-sn-act="calc"><i class="fas fa-calculator"></i><span>Рассчитать по фигуре</span></button>' +
            '<div data-sn="calcOut"></div><div data-sn="zoneOut"></div><div data-sn="anomOut"></div></div>';
        return '' +
            '<div class="dw-block sn-hd"><div class="sn-hd-row"><i class="fas ' + d.icon + '"></i><div><b>' + d.name + '</b><span>' + d.sub + '</span></div></div><div class="sn-leg" data-sn="leg"></div></div>' +
            '<div class="dw-block sn-tools"><div class="dw-title">Область на карте</div>' +
            '<div class="an-draw">' +
            '<button type="button" class="map-btn" data-sn-tool="polygon" title="Полигон"><i class="fas fa-draw-polygon"></i></button>' +
            '<button type="button" class="map-btn" data-sn-tool="rectangle" title="Прямоугольник"><i class="fas fa-vector-square"></i></button>' +
            '<button type="button" class="map-btn" data-sn-tool="circle" title="Круг / Овал"><i class="fas fa-circle"></i></button>' +
            '<button type="button" class="map-btn" data-sn-act="edit" title="Редактировать фигуру"><i class="fas fa-edit"></i></button>' +
            '<button type="button" class="map-btn" data-sn-act="sel" title="Взять фигуру, выбранную на карте (из «Анализа участка» или «Рисования»)"><i class="fas fa-hand-pointer"></i></button>' +
            '<button type="button" class="map-btn" data-sn-act="del" title="Удалить фигуру"><i class="fas fa-trash"></i></button></div>' +
            '<div class="an-hint" data-sn="shapeInfo"></div></div>' +
            '<div class="dw-block sn-calblock"><div class="dw-title">Дата съёмки</div>' + vars +
            '<div class="sn-month"><button type="button" class="sn-nav" data-sn-nav="-1" title="Предыдущий месяц"><i class="fa-solid fa-chevron-left"></i></button>' +
            '<span class="sn-month-lbl" data-sn="month"></span>' +
            '<button type="button" class="sn-nav" data-sn-nav="1" title="Следующий месяц"><i class="fa-solid fa-chevron-right"></i></button>' +
            '<button type="button" class="sn-find" data-sn-act="find" title="Найти снимки для текущей области карты"><i class="fa-solid fa-rotate"></i></button></div>' +
            '<div class="sn-wd-row"><span>пн</span><span>вт</span><span>ср</span><span>чт</span><span>пт</span><span>сб</span><span>вс</span></div>' +
            '<div class="sn-cal" data-sn="cal"></div>' +
            '<label class="sn-cc" title="Дни с облачностью выше порога затемняются">Облачность ≤ <b data-sn="ccVal">30</b>%<input type="range" data-sn="cc" min="0" max="100" step="5" value="30"></label>' +
            '<div class="sn-key"><span style="--c:#10b981">≤10%</span><span style="--c:#84cc16">≤30%</span><span style="--c:#f59e0b">≤60%</span><span style="--c:#ef4444">&gt;60%</span></div></div>' +
            contrast +
            '<div class="dw-block sn-shotblock"><div class="dw-title">Скрин выбранной даты</div><div class="sn-shots" data-sn="shots"></div><div class="sn-foot" data-sn="foot"></div></div>' +
            '<div class="dw-block sn-listblock"><div class="dw-title">Снимки за месяц <span class="badge" data-sn="count">0</span></div><div class="sn-cards" data-sn="cards"></div></div>' +
            calc +
            '<div class="dw-block sn-dl"><div class="dw-title">Скачать GeoTIFF</div>' + fmt +
            '<div class="m3-hint" data-sn="dlInfo"></div>' +
            '<button type="button" class="dw-act ex-go" data-sn-act="dl"><i class="fas fa-download"></i><span>Скачать GeoTIFF по фигуре</span></button>' +
            '<div class="sn-prog" data-sn="prog" hidden><div class="sn-bar"><u data-sn="bar"></u></div><div class="sn-prog-row"><span data-sn="progTxt"></span><button type="button" class="sn-stop" data-sn-act="stop">Отмена</button></div></div></div>';
    }

    // ---------- рисование области ----------
    function layerToGJ(layer) {
        try {
            if (layer instanceof L.Circle) {
                const c = layer.getLatLng();
                return turf.circle([c.lng, c.lat], layer.getRadius() / 1000, { steps: 64, units: 'kilometers' });
            }
            if (layer && layer.toGeoJSON) {
                const g = layer.toGeoJSON(), f = g.type === 'FeatureCollection' ? g.features[0] : g;
                if (f && f.geometry && /Polygon/.test(f.geometry.type)) return f;
            }
        } catch (e) { }
        return null;
    }
    function markTool() {
        eachPane((s, pane) => pane.querySelectorAll('[data-sn-tool]').forEach(b => b.classList.toggle('active', b.dataset.snTool === tool)));
        eachPane((s, pane) => pane.querySelectorAll('[data-sn-act="edit"]').forEach(b => b.classList.toggle('active', editing)));
    }
    function cancelTool() {
        if (handler) { try { handler.disable(); } catch (e) { } handler = null; }
        tool = null; markTool();
    }
    window.snCancelTool = cancelTool;
    function setEditing(on) {
        if (vx) { vx.destroy(); vx = null; }
        editing = !!(on && shape);
        if (editing) vx = gcVx(shape, { onChange: (l, fin) => { if (fin) shapeChanged(); else { shapeGJ = layerToGJ(l); renderShapeInfo(); } } });
        markTool();
    }
    function startTool(t) {
        if (typeof m3d !== 'undefined' && m3d.active) { updateStatus('ℹ️ Рисование работает в 2D — выключите 3D кнопкой «2D» на карте', true); return; }
        const same = tool === t;
        cancelTool(); setEditing(false);
        if (same) return;
        if (typeof deactivateAllTools === 'function') deactivateAllTools();
        tool = t; markTool();
        const so = { color: '#ec4899', weight: 2, fillColor: '#ec4899', fillOpacity: 0.12 };
        handler = t === 'polygon' ? new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: so })
            : t === 'rectangle' ? new L.Draw.Rectangle(map, { shapeOptions: so, showArea: false })
            : new L.Draw.Circle(map, { shapeOptions: so, showRadius: true });
        handler.enable();
        updateStatus('✏️ Рисуйте область на карте — будет создана одна фигура (прежняя заменится)');
    }
    window.snOnCreated = e => {
        if (!handler || !e.layer) return false;
        const layer = e.layer;
        cancelTool();
        setShape(layer);
        layer.on('edit', () => shapeChanged());
        bindShapeClick(layer);   // после рисования вершин нет — они появляются при повторном выборе фигуры (клик по ней)
        return true;
    };
    let shapeClickT = 0;
    function bindShapeClick(layer) {
        layer.on('click', () => {
            shapeClickT = Date.now();
            if (!tool && !editing && shape === layer) { setEditing(true); updateStatus('✏️ Вершины включены: тяните их, серые точки на рёбрах добавляют вершину; клик по пустому месту карты — скрыть'); }
        });
    }
    map.on('click', () => { if (Date.now() - shapeClickT < 120) return; if (editing && !tool) setEditing(false); });   // клик мимо фигуры — вершины скрываются
    function setShape(layer) {
        setEditing(false);
        if (layer !== shape) {
            grp.clearLayers(); shape = null;
            if (layer) { grp.addLayer(layer); shape = layer; }
        }
        shapeChanged();
    }
    function shapeChanged() {
        shapeGJ = shape ? layerToGJ(shape) : null;
        clearCalc();
        renderShapeInfo(); renderDl();
        clearTimeout(shapeTimer);
        shapeTimer = setTimeout(() => { if (sec) load(0); }, 500);   // список дат — для новой области
    }
    // оценка размера выгрузки при 10 м (в UTM будет чуть иначе)
    function estimate() {
        if (!shapeGJ) return null;
        const b = turf.bbox(shapeGJ), mid = (b[1] + b[3]) / 2;
        const w = Math.ceil((b[2] - b[0]) * 111320 * Math.cos(mid * Math.PI / 180) / SN_RES), h = Math.ceil((b[3] - b[1]) * 110574 / SN_RES);
        return { w: w, h: h, px: w * h, km2: turf.area(shapeGJ) / 1e6 };
    }
    function renderShapeInfo() {
        const est = estimate();
        eachPane((s, pane) => {
            const el = q(s, 'shapeInfo');
            if (!est) { el.classList.remove('warn'); el.innerHTML = 'Нарисуйте полигон, прямоугольник или круг — по этой фигуре будет вырезан и скачан снимок. Значок «рука» берёт фигуру, выбранную на карте.'; return; }
            const big = est.px > SN_EXPORT_MAX_PX;
            el.classList.toggle('warn', big);
            el.innerHTML = 'Область: <b>' + est.km2.toFixed(est.km2 < 10 ? 2 : 1).replace('.', ',') + ' км²</b> · ≈ ' + est.w.toLocaleString('ru-RU') + ' × ' + est.h.toLocaleString('ru-RU') + ' пикс. при ' + SN_RES + ' м' +
                (big ? '<br>Слишком большая область (максимум ' + (SN_EXPORT_MAX_PX / 1e6) + ' млн пикс., примерно 50 × 50 км) — уменьшите фигуру.' : '');
        });
    }

    // ---------- поиск снимков ----------
    function groupScenes(features) {
        const by = {};
        features.forEach(f => {
            const p = f.properties || {};
            if (!p.datetime) return;
            const day = p.datetime.slice(0, 10);
            const cc = p['eo:cloud_cover'] != null ? Math.round(p['eo:cloud_cover']) : null;
            const th = f.assets && f.assets.thumbnail && f.assets.thumbnail.href ? snHref(f.assets.thumbnail.href) : '';
            (by[day] = by[day] || { day: day, scenes: [] }).scenes.push({ id: f.id, time: p.datetime.slice(11, 16), cc: cc, thumb: th });
        });
        return Object.keys(by).map(k => {
            const g = by[k];
            g.scenes.sort((a, b) => (a.cc == null ? 101 : a.cc) - (b.cc == null ? 101 : b.cc));
            const vv = g.scenes.filter(s => s.cc != null);
            g.cc = vv.length ? Math.round(vv.reduce((t, s) => t + s.cc, 0) / vv.length) : null;
            g.thumb = (g.scenes.find(s => s.thumb) || {}).thumb || '';
            return g;
        }).sort((a, b) => a.day < b.day ? 1 : -1);
    }
    // область поиска: фигура (если нарисована) или видимая часть карты
    function searchBBox() {
        let b;
        if (shapeGJ) { const t = turf.bbox(shapeGJ); b = [t[0] - 0.0005, t[1] - 0.0005, t[2] + 0.0005, t[3] + 0.0005]; }
        else {
            if (map.getZoom() < 7) return null;
            const v = map.getBounds();
            b = [v.getWest(), v.getSouth(), v.getEast(), v.getNorth()];
        }
        return [clamp(b[0], -180, 180), clamp(b[1], -85, 85), clamp(b[2], -180, 180), clamp(b[3], -85, 85)].map(v => +v.toFixed(3));
    }
    // retries — сколько раз можно шагнуть на месяц назад, если за месяц нет подходящих снимков
    async function load(retries) {
        setSearch(1);
        try { await loadInner(retries); } finally { setSearch(-1); }
    }
    async function loadInner(retries) {
        if (!sec) return;
        const my = ++seq;
        renderMonth();
        const bbox = searchBBox();
        if (!bbox) {
            groups = []; note = 'Приблизьте карту (масштаб 7 и крупнее) или нарисуйте область, чтобы найти снимки';
            renderAll(); return;
        }
        note = '';
        const y = month.getUTCFullYear(), m = month.getUTCMonth();
        const ck = bbox.join(',') + '|' + y + '-' + m;
        const hit = stacCache[ck];
        if (hit && Date.now() - hit.t < 600000) groups = hit.groups;   // тот же месяц и область — без нового запроса
        else {
            showLoading();
            const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
            try {
                await snProxyAvailable();
                const r = await fetch(SENTINEL.stacUrl + '/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        collections: ['sentinel-2-l2a'], bbox: bbox, limit: 200,
                        datetime: `${y}-${p2(m + 1)}-01T00:00:00Z/${y}-${p2(m + 1)}-${p2(last)}T23:59:59Z`,
                        fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover', 'assets.thumbnail'] }
                    })
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const data = await r.json();
                if (my !== seq) return;
                groups = groupScenes(data.features || []);
                stacCache[ck] = { t: Date.now(), groups: groups };
            } catch (e) {
                if (my !== seq) return;
                console.warn('Sentinel: ошибка поиска снимков', e);
                groups = []; note = 'Не удалось получить список снимков (нет связи с каталогом)';
                renderAll(); return;
            }
        }
        if (my !== seq) return;
        const lay = layerOf(sec), st = SENTINEL.state[lay], max = +q(sec, 'cc').value;
        if (st && st.date && groups.some(g => g.day === st.date)) {
            select(st.date, true);   // та же дата в новой области — обновим список сцен
        } else if (!(st && st.date)) {
            const g = (SENTINEL.lastDay && groups.find(x => x.day === SENTINEL.lastDay)) || groups.find(x => x.cc != null && x.cc <= max);
            if (g) { select(g.day); return; }
            if (retries > 0) { month = new Date(Date.UTC(y, m - 1, 1)); load(retries - 1); return; }
            if (groups.length) note = `Нет снимков с облачностью ≤ ${max}% — увеличьте порог или смените месяц`;
        }
        renderAll();
    }

    function select(day, quiet) {
        const g = groups.find(x => x.day === day);
        if (!g || !sec) return;
        const lay = layerOf(sec);
        const st = SENTINEL.state[lay] || (SENTINEL.state[lay] = {});
        // тайлы перерисовываются, только если изменилась дата или состав сцен (иначе при каждом сдвиге карты всё грузилось бы заново)
        const same = st.date === day && st.scenes && st.scenes.map(s => s.id).join() === g.scenes.map(s => s.id).join();
        if (!same) clearCalc();
        st.date = day; st.scenes = g.scenes; st.scene = g.scenes[0]; st.cc = g.cc;
        SENTINEL.lastDay = day;
        if (currentLayer !== lay) { entering = true; try { switchLayer(lay); } finally { entering = false; } }
        if (!same) sentinelApply(lay);
        renderAll();
        if (!quiet) updateStatus(`🛰️ Sentinel-2: ${fmtDay(day)}, облачность ${ccText(g.cc)}`);
    }

    // ---------- отрисовка ----------
    function renderMonth() {
        if (!sec) return;
        q(sec, 'month').textContent = month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        q(sec, 'month').parentNode.querySelector('[data-sn-nav="1"]').disabled = month >= monthStart(new Date());
    }
    function showLoading() {
        if (!sec) return;
        q(sec, 'cards').innerHTML = '<div class="sn-empty"><i class="fa-solid fa-spinner fa-spin"></i> Поиск снимков…</div>';
        q(sec, 'cal').classList.add('busy');
    }
    function renderCal() {
        const el = q(sec, 'cal'), st = SENTINEL.state[layerOf(sec)] || {}, max = +q(sec, 'cc').value;
        el.classList.remove('busy');
        const y = month.getUTCFullYear(), m = month.getUTCMonth(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const lead = (month.getUTCDay() + 6) % 7, by = {};
        groups.forEach(g => { by[g.day] = g; });
        let h = '';
        for (let i = 0; i < lead; i++) h += '<span class="sn-cd empty"></span>';
        for (let d = 1; d <= dim; d++) {
            const day = `${y}-${p2(m + 1)}-${p2(d)}`, g = by[day];
            if (!g) { h += '<span class="sn-cd off">' + d + '</span>'; continue; }
            const over = g.cc != null && g.cc > max;
            h += `<button type="button" class="sn-cd has${day === st.date ? ' sel' : ''}${over ? ' dim' : ''}" data-day="${day}" style="--c:${ccColor(g.cc)}" title="${fmtDay(day)} · облачность ${ccText(g.cc)} · снимков: ${g.scenes.length}">${d}<i></i></button>`;
        }
        el.innerHTML = h;
    }
    // превью: для естественных цветов — готовый снимок-превью каталога; для индексов и ложных цветов — рисуется в нужном спектре
    function thumbHtml(scene, lay) {
        if (lay === 'sentinel2') {
            if (!scene.thumb) return `<span class="sn-th" data-pv="${esc(scene.id)}" data-lay="sentinel2"><i class="fa-solid fa-image"></i></span>`;
        return `<span class="sn-th" data-tid="${esc(scene.id)}"><img decoding="async" referrerpolicy="no-referrer" alt="" data-href="${esc(scene.thumb)}" src="${esc(thumbUrl(scene.thumb))}"><i class="fa-solid fa-image"></i></span>`;
        }
        return `<span class="sn-th" data-pv="${esc(scene.id)}" data-lay="${lay}"><i class="fa-solid fa-image"></i></span>`;
    }
    function hydratePv(el, retry) {
        const id = el.dataset.pv, lay = el.dataset.lay;
        snPvLimit(() => el.isConnected ? snPreview(lay, id) : Promise.resolve(null)).then(url => {
            if (!url || !el.isConnected) return;
            const im = document.createElement('img');
            im.alt = ''; im.src = url;
            el.appendChild(im); el.classList.add('ok');
        }).catch(e => {
            console.warn('Sentinel: превью', e);
            if (!retry && el.isConnected) { setTimeout(() => { if (el.isConnected) hydratePv(el, true); }, 2000); return; }   // одна повторная попытка
            el.classList.add('err');
        });
    }
    // картинка-превью каталога не загрузилась: пробуем прямой адрес и другие хосты S3, затем рисуем превью из снимка
    function thumbFail(im) {
        const sp = im.closest('.sn-th'), step = +(im.dataset.fs || 0), alts = snHosts(im.dataset.href || '');
        im.dataset.fs = step + 1;
        if (step < alts.length && sp) { if (im.src !== alts[step]) { im.src = alts[step]; return; } }
        if (step + 1 < alts.length) { im.src = alts[step + 1]; im.dataset.fs = step + 2; return; }
        if (!sp || sp.dataset.pv) return;
        im.remove();
        sp.dataset.pv = sp.dataset.tid; sp.dataset.lay = 'sentinel2';
        hydratePv(sp);
    }
    const pvObs = window.IntersectionObserver
        ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { pvObs.unobserve(e.target); hydratePv(e.target); } }), { rootMargin: '150px' }) : null;
    function watchPv(root) {
        root.querySelectorAll('[data-pv]').forEach(el => pvObs ? pvObs.observe(el) : hydratePv(el));
        root.querySelectorAll('img[data-href]').forEach(im => {
            im.addEventListener('error', () => thumbFail(im));
            if (im.complete && im.naturalWidth === 0 && im.getAttribute('src')) thumbFail(im);
        });
    }
    function renderCards() {
        const el = q(sec, 'cards'), lay = layerOf(sec), st = SENTINEL.state[lay] || {}, max = +q(sec, 'cc').value;
        q(sec, 'count').textContent = groups.length;
        if (!groups.length) { el.innerHTML = '<div class="sn-empty">' + esc(note || 'В этой области за месяц снимков нет') + '</div>'; return; }
        el.innerHTML = groups.map(g => {
            const d = dayDate(g.day);
            const wd = d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' });
            const mo = d.toLocaleDateString('ru-RU', { month: 'short', timeZone: 'UTC' }).replace('.', '');
            const over = g.cc != null && g.cc > max;
            return `<button type="button" class="sn-card${g.day === st.date ? ' sel' : ''}${over ? ' dim' : ''}" data-day="${g.day}" style="--c:${ccColor(g.cc)}" title="${fmtDay(g.day)} · облачность ${ccText(g.cc)} · снимков: ${g.scenes.length}">` +
                thumbHtml(g.scenes[0], lay) +
                `<span class="sn-ci"><b>${d.getUTCDate()} ${mo}</b><em>☁ ${ccText(g.cc)}</em></span><small>${wd}${g.scenes.length > 1 ? ' · сцен: ' + g.scenes.length : ''}</small></button>`;
        }).join('');
        watchPv(el);
    }
    // «скрины» сцен выбранной даты (превью с облаками) — чтобы оценить снимок до загрузки на карту
    function renderShots() {
        const el = q(sec, 'shots'), lay = layerOf(sec), st = SENTINEL.state[lay];
        if (!st || !st.date) { el.className = 'sn-shots'; el.innerHTML = '<div class="sn-empty">Выберите дату в календаре или в списке ниже</div>'; return; }
        const g = groups.find(x => x.day === st.date);
        const list = (g ? g.scenes : st.scenes || []).slice(0, 6);
        el.className = 'sn-shots' + (list.length === 1 ? ' one' : '');
        el.innerHTML = list.map(s => `<figure class="sn-shot" style="--c:${ccColor(s.cc)}">${thumbHtml(s, lay)}` +
            `<figcaption><b>${esc(tileOf(s.id) || 'сцена')}</b> ${esc(s.time)} UTC<em>☁ ${ccText(s.cc)}</em></figcaption></figure>`).join('');
        watchPv(el);
    }
    function renderFoot() {
        const st = SENTINEL.state[layerOf(sec)], el = q(sec, 'foot');
        const src = '<span class="sn-src">Sentinel-2 L2A · AWS</span>';
        if (!st || !st.date) { el.innerHTML = `<span>${esc(note || 'Выберите дату съёмки — снимок появится на карте')}</span>${src}`; return; }
        el.innerHTML = `<span><b>${fmtDay(st.date)}</b> · облачность ~${ccText(st.cc)} · сцен за день: ${st.scenes.length}</span>${src}`;
    }
    function renderDl() {
        if (!sec) return;
        const lay = layerOf(sec), st = SENTINEL.state[lay], est = estimate(), info = q(sec, 'dlInfo'), btn = q(sec, 'dlInfo').parentNode.querySelector('[data-sn-act="dl"]');
        let txt = '', ok = false;
        if (!shapeGJ) txt = 'Сначала нарисуйте фигуру вверху раздела — снимок будет вырезан по ней.';
        else if (!st || !st.date) txt = 'Выберите дату снимка.';
        else if (est.px > SN_EXPORT_MAX_PX) txt = 'Область слишком большая — уменьшите фигуру.';
        else {
            ok = true;
            txt = '<b>' + fmtDay(st.date) + '</b> · масштаб <b>' + SN_RES + ' м/пикс</b> — максимальный для Sentinel-2 · проекция UTM · вне фигуры пиксели прозрачны.<br>' + LAYER_NOTE[lay];
        }
        info.innerHTML = txt;
        btn.disabled = busy || !ok;
        const cb = ui[sec].pane.querySelector('[data-sn-act="calc"]');
        if (cb) cb.disabled = busy || !ok;
    }
    // ---------- легенда (вверху раздела, под названием) ----------
    const fmtN = v => (Math.round(v * 100) / 100).toString().replace('.', ',').replace('-', '−');
    function renderLegend() {
        const lay = layerOf(sec), el = q(sec, 'leg');
        if (lay === 'sentinel2') { el.innerHTML = '<span class="sn-lg-txt">Естественные цвета, как видит глаз (Red · Green · Blue)</span>'; return; }
        if (lay === 'falsecolor') {
            el.innerHTML = '<div class="sn-lg-chips"><span style="--c:#e11d48">растительность</span><span style="--c:#1e3a8a">вода</span><span style="--c:#94a3b8">застройка, почва</span></div><span class="sn-lg-txt">Ложные цвета: NIR · Red · Green → R · G · B</span>';
            return;
        }
        const R = snRamp(lay), t = LEG_TXT[lay] || ['', ''];
        const grad = R.stops.map(x => 'rgb(' + x[1] + ',' + x[2] + ',' + x[3] + ') ' + Math.round(x[0] * 100) + '%').join(',');
        el.innerHTML = '<div class="sn-lg-bar" style="background:linear-gradient(90deg,' + grad + ')"></div>' +
            '<div class="sn-lg-lab"><span>' + fmtN(R.min) + '</span><span>' + fmtN((R.min + R.max) / 2) + '</span><span>' + fmtN(R.max) + '</span></div>' +
            '<div class="sn-lg-lab sn-lg-cap"><span>' + t[0] + '</span><span>' + t[1] + '</span></div>';
    }
    function syncContrast() {
        const c = SENTINEL.contrast;
        const a = q(sec, 'cMin'), b = q(sec, 'cMax');
        if (!a || !b) return;
        a.value = c.min; b.value = c.max;
        q(sec, 'cMinV').textContent = fmtN(c.min); q(sec, 'cMaxV').textContent = fmtN(c.max);
    }
    function ctrApply() { sentinelApply('ndvi_c'); }
    function renderHead() {
        if (!sec) return;
        const lay = layerOf(sec);
        q(sec, 'ccVal').textContent = q(sec, 'cc').value;
        ui[sec].pane.querySelectorAll('[data-sn-var]').forEach(b => b.classList.toggle('on', b.dataset.snVar === lay));
        const ctr = q(sec, 'ctr');
        if (ctr) { ctr.hidden = lay !== 'ndvi_c'; syncContrast(); }
        renderLegend();
    }

    // ---------- калькулятор: статистика индекса в фигуре ----------
    function clearCalc() {
        lastCalc = null; lastRaster = null; zoneRes = null; anomRes = null;
        zoneGrp.clearLayers(); anomGrp.clearLayers();
        eachPane((s, pane) => ['calcOut', 'zoneOut', 'anomOut'].forEach(n => { const o = pane.querySelector('[data-sn="' + n + '"]'); if (o) o.innerHTML = ''; }));
    }
    function snCalcStats(r, key) {
        const v = r.values, m = r.mask, n = v.length;
        let total = 0, valid = 0;
        for (let i = 0; i < n; i++) if (m[i]) { total++; if (v[i] === v[i]) valid++; }
        if (!valid) throw new Error('в фигуре нет данных на эту дату — выберите другую дату');
        const a = new Float32Array(valid);
        let k = 0, sum = 0;
        for (let i = 0; i < n; i++) if (m[i] && v[i] === v[i]) { a[k++] = v[i]; sum += v[i]; }
        a.sort();
        const mean = sum / valid;
        let sq = 0;
        for (let i = 0; i < valid; i++) { const d = a[i] - mean; sq += d * d; }
        const std = Math.sqrt(sq / valid), pct = p => a[Math.min(valid - 1, Math.floor(p * (valid - 1)))];
        const classes = (CLS[key] || []).map(c => ({ lo: c[0], hi: c[1], name: c[2], color: c[3], n: 0 }));
        const R = snRamp(key), bins = 20, hist = new Array(bins).fill(0), span = R.max - R.min;
        for (let i = 0; i < valid; i++) {
            const x = a[i];
            for (const c of classes) if (x >= c.lo && x < c.hi) { c.n++; break; }
            hist[Math.max(0, Math.min(bins - 1, Math.floor((x - R.min) / span * bins)))]++;
        }
        return { key: key, total: total, valid: valid, ha: valid * 0.01, mean: mean, std: std, min: a[0], max: a[valid - 1],
            median: pct(0.5), p10: pct(0.1), p90: pct(0.9), cv: Math.abs(mean) > 1e-6 ? std / Math.abs(mean) * 100 : 0,
            classes: classes, hist: hist, rmin: R.min, rmax: R.max };
    }
    const f3 = v => v.toFixed(3).replace('.', ',').replace('-', '−');
    const fHa = v => v.toLocaleString('ru-RU', { maximumFractionDigits: v < 10 ? 2 : 1 });
    function renderCalc(res, date, name) {
        const out = q(sec, 'calcOut');
        if (!res) { out.innerHTML = ''; return; }
        const st = (l, v) => '<div class="sn-st"><span>' + l + '</span><b>' + v + '</b></div>';
        const hmax = Math.max.apply(null, res.hist);
        out.innerHTML = '<div class="sn-res"><div class="sn-res-hd">' + esc(name) + ' · ' + fmtDay(date) + '</div>' +
            '<div class="sn-st-grid">' +
            st('Среднее', f3(res.mean)) + st('Медиана', f3(res.median)) + st('Минимум', f3(res.min)) + st('Максимум', f3(res.max)) +
            st('Ст. отклонение', f3(res.std)) + st('Неоднородность', res.cv.toFixed(1).replace('.', ',') + ' %') +
            st('P10 – P90', f3(res.p10) + ' … ' + f3(res.p90)) + st('Площадь анализа', fHa(res.ha) + ' га') + '</div>' +
            (res.classes.length ? '<div class="sn-cls-t">Распределение по классам</div>' + res.classes.map(c => {
                const p = c.n / res.valid * 100;
                return '<div class="sn-cls"><i style="background:' + c.color + '"></i><span>' + esc(c.name) + '</span><b>' + p.toFixed(1).replace('.', ',') + ' %</b><em>' + fHa(c.n * 0.01) + ' га</em>' +
                    '<u style="--w:' + p.toFixed(1) + '%;--c:' + c.color + '"></u></div>';
            }).join('') : '') +
            '<div class="sn-cls-t">Гистограмма · ' + fmtN(res.rmin) + ' … ' + fmtN(res.rmax) + '</div>' +
            '<div class="sn-hist">' + res.hist.map(h => '<i style="height:' + Math.max(2, Math.round(h / hmax * 100)) + '%"></i>').join('') + '</div>' +
            '<div class="m3-hint">Без данных (вне снимка): ' + ((res.total - res.valid) / res.total * 100).toFixed(1).replace('.', ',') + ' % площади фигуры. Облака и тени не исключены — для надёжных цифр берите дату с малой облачностью.</div>' +
            '<button type="button" class="dw-act" data-sn-act="csv"><i class="fas fa-file-csv"></i><span>Скачать результаты (CSV)</span></button></div>';
    }
    async function calc() {
        if (busy) return;
        const lay = layerOf(sec), base = lay === 'ndvi_c' ? 'ndvi' : lay, st = SENTINEL.state[lay];
        if (!shapeGJ) { updateStatus('⚠️ Сначала нарисуйте фигуру в разделе', true); return; }
        if (!st || !st.date) { updateStatus('⚠️ Сначала выберите дату снимка', true); return; }
        busy = true; abort = false; renderDl(); showProg(0, 'Подготовка…');
        updateStatus('🧮 Считаем статистику по фигуре…');
        try {
            const r = await snExportGeoTiff({ key: base, st: st, gj: shapeGJ, raw: true, onProgress: showProg, isAborted: () => abort });
            showProg(1, 'Подсчёт…');
            await snDelay(30);
            const res = snCalcStats(r, base);
            const name = SEC[sec].vars.find(v => v.l === base) ? SEC[sec].vars.find(v => v.l === base).t : SEC[sec].name;
            lastCalc = { res: res, date: st.date, name: name };
            renderCalc(res, st.date, name);
            if (base === 'ndvi') { lastRaster = { r: r, date: st.date }; showProg(1, 'Зоны и аномалии…'); await buildZones(); buildAnoms(); if (zoneRes) showTrueColor(); }
            updateStatus(`✅ ${name}: среднее ${f3(res.mean)}, площадь ${fHa(res.ha)} га`);
        } catch (e) {
            console.warn('Sentinel: калькулятор', e);
            updateStatus('⚠️ ' + (/отменено/.test(e.message) ? e.message : 'Не удалось рассчитать: ' + e.message), true);
        } finally {
            busy = false;
            if (sec) q(sec, 'prog').hidden = true;
            renderDl();
        }
    }
    function csv() {
        if (!lastCalc) return;
        const r = lastCalc.res, nm = x => String(x).replace('.', ',');
        const rows = [['Показатель', 'Значение'], ['Индекс', lastCalc.name], ['Дата снимка', lastCalc.date], ['Площадь анализа, га', nm(r.ha.toFixed(2))],
            ['Среднее', nm(r.mean.toFixed(4))], ['Медиана', nm(r.median.toFixed(4))], ['Минимум', nm(r.min.toFixed(4))], ['Максимум', nm(r.max.toFixed(4))],
            ['Ст. отклонение', nm(r.std.toFixed(4))], ['Неоднородность, %', nm(r.cv.toFixed(2))], ['P10', nm(r.p10.toFixed(4))], ['P90', nm(r.p90.toFixed(4))], [], ['Класс', 'Доля, %', 'Площадь, га']]
            .concat(r.classes.map(c => [c.name, nm((c.n / r.valid * 100).toFixed(2)), nm((c.n * 0.01).toFixed(2))]));
        const blob = new Blob(['\ufeff' + rows.map(x => x.join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${lastCalc.name}_${lastCalc.date}_статистика.csv`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    }
    // ---------- зоны внесения удобрений и аномальные точки (NDVI) ----------
    const zInt = () => clamp(Math.round(+(q('ndvi', 'zN') || {}).value || 3), 2, 10);
    const r1 = v => Math.round(v * 10) / 10;
    function applyRates() {
        if (!zoneRes) return;
        const k = zoneRes.k, base = Math.max(0, +q('ndvi', 'zBase').value || 0), s = q('ndvi', 'zS').value;
        zoneRes.rates = zoneRes.zones.map(z => {
            const t = k > 1 ? 1 - 2 * z.i / (k - 1) : 0;   // +1 у самой слабой зоны, −1 у самой густой
            return r1(s === 'low' ? base * (1 + 0.2 * t) : s === 'high' ? base * (1 - 0.2 * t) : base);
        });
    }
    function zoneTotals() {
        if (!zoneRes) return { kg: 0, ha: 0 };
        return zoneRes.zones.reduce((t, z) => { t.ha += z.ha; t.kg += z.ha * (zoneRes.rates[z.i] || 0); return t; }, { kg: 0, ha: 0 });
    }
    function renderZoneTotal() {
        const el = q('ndvi', 'zTot');
        if (!el || !zoneRes) return;
        const t = zoneTotals();
        el.innerHTML = 'Всего: <b>' + Math.round(t.kg).toLocaleString('ru-RU') + ' кг</b> (' + fHa(t.kg / 1000) + ' т) на ' + fHa(t.ha) + ' га · в среднем ' + (t.ha ? fHa(t.kg / t.ha) : '0') + ' кг/га';
    }
    function drawZones() {
        zoneGrp.clearLayers();
        if (!zoneRes) return;
        zoneRes.zones.forEach(z => {
            if (!z.feat) return;
            L.geoJSON(z.feat, { style: { color: '#ffffff', weight: 1.5, opacity: 0.95, fillColor: z.color, fillOpacity: 0.6 } })
                .bindTooltip(() => z.name + ' · NDVI ' + fmtN(z.min) + ' … ' + fmtN(z.max) + ' · ' + fHa(z.ha) + ' га · ' + (zoneRes.rates[z.i] || 0) + ' кг/га', { sticky: true })
                .addTo(zoneGrp);
        });
        if (sec && zoneVis && !map.hasLayer(zoneGrp)) zoneGrp.addTo(map);
        raiseOverlays();
    }
    function raiseOverlays() {
        if (shape && shape.bringToFront) shape.bringToFront();
        anomGrp.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
    }
    function renderZones() {
        const out = q('ndvi', 'zoneOut');
        if (!out) return;
        if (!zoneRes) { out.innerHTML = ''; return; }
        const rows = zoneRes.zones.map(z => '<div class="sn-zr"><i style="background:' + z.color + '"></i>' +
            '<span><b>' + esc(z.name) + '</b><em>NDVI ' + (z.n ? fmtN(z.min) + ' … ' + fmtN(z.max) + ' · ср. ' + fmtN(z.mean) : '—') + '</em></span>' +
            '<u>' + fHa(z.ha) + ' га</u><input type="number" min="0" step="1" data-sn="zr" data-z="' + z.i + '" value="' + (zoneRes.rates[z.i] || 0) + '"><s>кг/га</s></div>').join('');
        out.innerHTML = '<div class="sn-res"><div class="sn-res-hd">Зоны внесения · ' + zoneRes.k + ' · ' + fmtDay(zoneRes.date) + '</div>' +
            '<div class="m3-hint">Зона 1 — самый низкий NDVI, зона ' + zoneRes.k + ' — самый высокий. Нормы внесения можно править прямо в списке — они попадут в файл.</div>' +
            rows + '<div class="sn-ztot" data-sn="zTot"></div>' +
            '<label class="dw-check"><input type="checkbox" data-sn="zvis"' + (zoneVis ? ' checked' : '') + '> Показывать зоны на карте</label>' +
            '<div class="sn-dlrow"><button type="button" class="dw-act" data-sn-act="zgj" title="Векторный слой GeoJSON"><i class="fas fa-download"></i><span>GeoJSON</span></button>' +
            '<button type="button" class="dw-act" data-sn-act="zshp" title="Shapefile (ZIP: shp, shx, dbf, prj) — для терминалов и ГИС"><i class="fas fa-download"></i><span>Shapefile</span></button>' +
            '<button type="button" class="dw-act" data-sn-act="zkml" title="KML для Google Earth"><i class="fas fa-download"></i><span>KML</span></button></div></div>';
        renderZoneTotal();
    }
    async function buildZones() {
        const out = q('ndvi', 'zoneOut');
        if (!lastRaster || !shapeGJ) return;
        const k = zInt();
        q('ndvi', 'zN').value = k;
        out.innerHTML = '<div class="m3-hint">Строим зоны…</div>';
        try {
            zoneRes = await snMakeZones(lastRaster.r, k, q('ndvi', 'zM').value, shapeGJ);
        } catch (e) {
            console.warn('Sentinel: зоны', e);
            zoneRes = null; zoneGrp.clearLayers();
            out.innerHTML = '<div class="m3-hint">Зоны не построены: ' + esc(e.message) + '</div>';
            return;
        }
        zoneRes.date = lastRaster.date;
        applyRates();
        drawZones();
        renderZones();
    }
    // после расчёта зон подложка меняется на обычный (естественные цвета) снимок Sentinel той же даты — цвета зон не сливаются с цветами NDVI
    function showTrueColor() {
        const src = SENTINEL.state[layerOf('ndvi')];
        if (!src || !src.date || !src.scenes) return;
        const st = SENTINEL.state.sentinel2 || (SENTINEL.state.sentinel2 = {});
        const same = st.date === src.date && st.scenes && st.scenes.map(s => s.id).join() === src.scenes.map(s => s.id).join();
        st.date = src.date; st.scenes = src.scenes; st.scene = src.scene; st.cc = src.cc;
        entering = true;
        try { if (currentLayer !== 'sentinel2') switchLayer('sentinel2'); } finally { entering = false; }
        if (!same) sentinelApply('sentinel2');
        raiseOverlays();
        updateStatus('🛰️ Подложка переключена на обычный снимок Sentinel-2 — зоны и точки хорошо видны. Выбор даты вернёт NDVI');
    }
    function buildAnoms() {
        const out = q('ndvi', 'anomOut');
        anomGrp.clearLayers(); anomRes = null;
        if (!lastRaster) { out.innerHTML = ''; return; }
        const sg = clamp(+q('ndvi', 'aS').value || 3, 1.5, 8);
        try { anomRes = snFindAnoms(lastRaster.r, sg); } catch (e) {
            console.warn('Sentinel: аномалии', e);
            out.innerHTML = '<div class="m3-hint">Аномальные точки не найдены: ' + esc(e.message) + '</div>';
            return;
        }
        anomRes.pts.forEach(p => {
            L.circleMarker([p.lat, p.lng], { radius: 7, color: '#ffffff', weight: 2, fillColor: p.z < 0 ? '#dc2626' : '#2563eb', fillOpacity: 0.95 })
                .bindTooltip('NDVI ' + fmtN(p.v) + ' · ' + (p.z < 0 ? '−' : '+') + Math.abs(p.z).toFixed(1).replace('.', ',') + 'σ · ≈' + fHa(p.ha) + ' га', { sticky: true })
                .addTo(anomGrp);
        });
        if (sec && anomVis && !map.hasLayer(anomGrp)) anomGrp.addTo(map);
        raiseOverlays();
        const st = (l, v) => '<div class="sn-st"><span>' + l + '</span><b>' + v + '</b></div>', a = anomRes;
        out.innerHTML = '<div class="sn-res"><div class="sn-res-hd">Аномальные точки NDVI</div>' +
            (a.pts.length
                ? '<div class="sn-st-grid">' + st('Найдено', a.total + (a.total > a.pts.length ? ' (показано ' + a.pts.length + ')' : '')) + st('Медиана NDVI', f3(a.med)) +
                  st('Ниже нормы', a.nLow) + st('Выше нормы', a.nHigh) + '</div>' +
                  '<div class="m3-hint"><span class="sn-dot" style="--c:#dc2626"></span> ниже нормы · <span class="sn-dot" style="--c:#2563eb"></span> выше нормы. Точка — пиксель с отклонением от медианы поля больше ' + String(a.sigma).replace('.', ',') + 'σ (устойчивая оценка, пятно от 2 пикселей, полоса 10 м у границы фигуры не учитывается).</div>' +
                  '<label class="dw-check"><input type="checkbox" data-sn="avis"' + (anomVis ? ' checked' : '') + '> Показывать точки на карте</label>' +
                  '<button type="button" class="dw-act" data-sn-act="agj"><i class="fas fa-download"></i><span>Скачать точки (GeoJSON)</span></button>'
                : '<div class="m3-hint">Аномальных точек при пороге ' + String(a.sigma).replace('.', ',') + 'σ не найдено — поле однородно. Можно уменьшить порог.</div>') + '</div>';
    }
    function saveBlob(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    }
    function zoneFeatures() {
        const r4 = v => Math.round(v * 10000) / 10000;
        return zoneRes.zones.filter(z => z.feat).map(z => {
            const rate = zoneRes.rates[z.i] || 0;
            return { type: 'Feature', properties: { zone: z.i + 1, name: z.name, ndvi_min: r4(z.min), ndvi_max: r4(z.max), ndvi_mean: r4(z.mean),
                area_ha: Math.round(z.ha * 1000) / 1000, rate_kgha: rate, total_kg: r1(z.ha * rate), date: zoneRes.date, color: z.color }, geometry: z.feat.geometry };
        });
    }
    function zoneDownload(kind) {
        if (!zoneRes) return;
        const fs = zoneFeatures(), base = 'NDVI_zones_' + zoneRes.date + '_' + zoneRes.k;
        if (!fs.length) { updateStatus('⚠️ Нет зон для сохранения', true); return; }
        if (kind === 'zgj') saveBlob(new Blob([JSON.stringify({ type: 'FeatureCollection', features: fs })], { type: 'application/geo+json' }), base + '.geojson');
        else if (kind === 'zkml') saveBlob(new Blob([snKml(fs, 'Зоны внесения NDVI ' + zoneRes.date)], { type: 'application/vnd.google-earth.kml+xml' }), base + '.kml');
        else saveBlob(snShpZip(fs, base), base + '_shp.zip');
        updateStatus('✅ Слой зон сохранён: ' + base);
    }
    function anomDownload() {
        if (!anomRes || !anomRes.pts.length) return;
        const fs = anomRes.pts.map(p => ({ type: 'Feature', properties: { ndvi: Math.round(p.v * 10000) / 10000, sigma: Math.round(p.z * 100) / 100, type: p.z < 0 ? 'ниже нормы' : 'выше нормы', area_ha: Math.round(p.ha * 100) / 100 },
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
        saveBlob(new Blob([JSON.stringify({ type: 'FeatureCollection', features: fs })], { type: 'application/geo+json' }), 'NDVI_anomalies_' + (lastRaster ? lastRaster.date : '') + '.geojson');
    }
    function onChange(e) {
        const n = e.target.getAttribute && e.target.getAttribute('data-sn');
        if (!n) return;
        if (n === 'zN' || n === 'zM') { if (lastRaster) buildZones(); }
        else if (n === 'zS' || n === 'zBase') { if (zoneRes) { applyRates(); renderZones(); } }
        else if (n === 'aS') { if (lastRaster) buildAnoms(); }
        else if (n === 'zvis') { zoneVis = e.target.checked; if (zoneVis) zoneGrp.addTo(map); else map.removeLayer(zoneGrp); }
        else if (n === 'avis') { anomVis = e.target.checked; if (anomVis) anomGrp.addTo(map); else map.removeLayer(anomGrp); }
    }
    function onInput(e) {
        if (e.target.getAttribute && e.target.getAttribute('data-sn') === 'zr' && zoneRes) {
            zoneRes.rates[+e.target.getAttribute('data-z')] = Math.max(0, +e.target.value || 0);
            renderZoneTotal();
        }
    }
    // кнопка «Очистить» на карте: убирает фигуру раздела вместе с результатами
    window.snClearAll = function () { cancelTool(); setEditing(false); grp.clearLayers(); shape = null; shapeChanged(); };

    async function autoRange() {
        const st = SENTINEL.state.ndvi_c;
        if (!st || !st.date) { updateStatus('⚠️ Сначала выберите дату снимка', true); return; }
        let bb;
        if (shapeGJ) bb = turf.bbox(shapeGJ);
        else { const v = map.getBounds(); bb = [v.getWest(), v.getSouth(), v.getEast(), v.getNorth()]; }
        updateStatus('🎚️ Подбор диапазона контраста…');
        try {
            const r = await snAutoRange(st, bb);
            SENTINEL.contrast.min = r.min; SENTINEL.contrast.max = r.max;
            syncContrast(); renderLegend(); ctrApply(); renderCards(); renderShots();
            updateStatus(`🎚️ Контраст NDVI: ${fmtN(r.min)} … ${fmtN(r.max)}`);
        } catch (e) {
            console.warn('Sentinel: автоконтраст', e);
            updateStatus('⚠️ ' + e.message, true);
        }
    }

    function renderAll() {
        if (!sec) return;
        renderHead(); renderMonth(); renderCal(); renderCards(); renderShots(); renderFoot(); renderDl(); renderShapeInfo();
    }

    // ---------- скачивание ----------
    function showProg(f, txt) {
        if (!sec) return;
        q(sec, 'prog').hidden = false;
        q(sec, 'bar').style.width = Math.round(clamp(f, 0, 1) * 100) + '%';
        q(sec, 'progTxt').textContent = txt || '';
    }
    async function exportTiff() {
        if (busy) return;
        const lay = layerOf(sec), st = SENTINEL.state[lay];
        if (!shapeGJ) { updateStatus('⚠️ Сначала нарисуйте фигуру в разделе', true); return; }
        if (!st || !st.date) { updateStatus('⚠️ Сначала выберите дату снимка', true); return; }
        busy = true; abort = false; renderDl(); showProg(0, 'Подготовка…');
        updateStatus('⬇️ Готовим GeoTIFF…');
        const fmt = q(sec, 'fmt');
        try {
            const res = await snExportGeoTiff({
                key: lay, st: st, gj: shapeGJ, color: !!fmt && fmt.value === 'rgb',
                onProgress: showProg, isAborted: () => abort
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(res.blob); a.download = res.name;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
            updateStatus(`✅ GeoTIFF сохранён: ${res.name} · ${res.W}×${res.H} пикс., ${(res.blob.size / 1048576).toFixed(1)} МБ`);
        } catch (e) {
            console.warn('Sentinel: экспорт', e);
            updateStatus('⚠️ ' + (/отменено/.test(e.message) ? e.message : 'Не удалось скачать снимок: ' + e.message), true);
        } finally {
            busy = false;
            if (sec) q(sec, 'prog').hidden = true;
            renderDl();
        }
    }

    // ---------- события ----------
    function act(a) {
        if (a === 'edit') {
            if (!shape) { updateStatus('⚠️ Сначала нарисуйте фигуру', true); return; }
            cancelTool(); setEditing(!editing);
            updateStatus(editing ? '✏️ Тяните вершины фигуры; повторное нажатие — завершить' : '');
        } else if (a === 'del') {
            cancelTool(); setEditing(false); grp.clearLayers(); shape = null; shapeChanged();
        } else if (a === 'sel') {
            cancelTool();
            const gj = (typeof selectedLayer !== 'undefined' && selectedLayer) ? layerToGJ(selectedLayer) : null;
            if (!gj) { updateStatus('⚠️ Выберите на карте полигон, прямоугольник или круг (клик по фигуре)', true); return; }
            const g = gj.geometry;
            const poly = L.polygon(L.GeoJSON.coordsToLatLngs(g.coordinates, g.type === 'Polygon' ? 1 : 2), { color: '#ec4899', weight: 2, fillColor: '#ec4899', fillOpacity: 0.12 });
            poly.on('edit', () => shapeChanged());
            bindShapeClick(poly);
            setShape(poly);
        } else if (a === 'find') {
            delete stacCache[searchBBox() + '|' + month.getUTCFullYear() + '-' + month.getUTCMonth()];
            load(0);
        } else if (a === 'calc') calc();
        else if (a === 'auto') autoRange();
        else if (a === 'csv') csv();
        else if (a === 'zgj' || a === 'zkml' || a === 'zshp') zoneDownload(a);
        else if (a === 'agj') anomDownload();
        else if (a === 'dl') exportTiff();
        else if (a === 'stop') abort = true;
    }
    function onClick(e) {
        const t = e.target;
        let b;
        if ((b = t.closest('[data-sn-tool]'))) startTool(b.dataset.snTool);
        else if ((b = t.closest('[data-sn-act]'))) { if (!b.disabled) act(b.dataset.snAct); }
        else if ((b = t.closest('[data-day]'))) select(b.dataset.day);
        else if ((b = t.closest('[data-sn-nav]'))) {
            month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + (+b.dataset.snNav), 1));
            load(0);
        } else if ((b = t.closest('[data-sn-var]'))) {
            variant[sec] = b.dataset.snVar;
            enter(sec);
        }
    }
    function enter(s) {
        if (!ui[s]) return;
        sec = s;
        if (!map.hasLayer(grp)) grp.addTo(map);
        if (zoneVis && !map.hasLayer(zoneGrp)) zoneGrp.addTo(map);
        if (anomVis && !map.hasLayer(anomGrp)) anomGrp.addTo(map);
        const lay = layerOf(s);
        entering = true;
        try { if (currentLayer !== lay) switchLayer(lay); } finally { entering = false; }
        const st = SENTINEL.state[lay], ref = (st && st.date) || SENTINEL.lastDay;
        month = monthStart(ref ? dayDate(ref) : new Date());
        renderAll();
        load(ref ? 0 : 2);
    }
    function leave() {
        if (!sec && !map.hasLayer(grp)) return;
        cancelTool(); setEditing(false);
        sec = null; searching = 0;
        window.snLoadingSet('search', false); window.snLoadingSet('tiles', false);
        if (map.hasLayer(grp)) map.removeLayer(grp);
        if (map.hasLayer(zoneGrp)) map.removeLayer(zoneGrp);
        if (map.hasLayer(anomGrp)) map.removeLayer(anomGrp);
    }

    Object.keys(SEC).forEach(s => {
        const pane = document.querySelector('[data-bp-pane="' + s + '"]');
        if (!pane) return;
        pane.classList.add('bp-sat');
        pane.innerHTML = tpl(s);
        ui[s] = { pane: pane };
        const cc = pane.querySelector('[data-sn="cc"]');
        cc.value = SENTINEL.maxCC;
        cc.addEventListener('input', () => {
            SENTINEL.maxCC = +cc.value;
            eachPane((x, pn) => { const c = pn.querySelector('[data-sn="cc"]'); c.value = cc.value; pn.querySelector('[data-sn="ccVal"]').textContent = cc.value; });
            if (sec) { renderCal(); renderCards(); }
        });
        pane.addEventListener('click', onClick);
        pane.addEventListener('change', onChange);
        pane.addEventListener('input', onInput);
        // ползунки диапазона «Контрастного NDVI»
        const cMin = pane.querySelector('[data-sn="cMin"]'), cMax = pane.querySelector('[data-sn="cMax"]');
        if (cMin && cMax) {
            const upd = e => {
                let a = +cMin.value, b = +cMax.value;
                if (b - a < 0.1) { if (e.target === cMin) a = b - 0.1; else b = a + 0.1; }
                SENTINEL.contrast.min = +a.toFixed(2); SENTINEL.contrast.max = +b.toFixed(2);
                if (sec) { syncContrast(); renderLegend(); }
                clearTimeout(ctrT); ctrT = setTimeout(ctrApply, 350);
            };
            cMin.addEventListener('input', upd); cMax.addEventListener('input', upd);
            const done = () => { if (sec) { renderCards(); renderShots(); } };
            cMin.addEventListener('change', done); cMax.addEventListener('change', done);
        }
        pane.addEventListener('error', e => {   // превью не загрузилось — остаётся значок
            if (e.target && e.target.tagName === 'IMG') { const th = e.target.parentNode; th.classList.add('err'); e.target.remove(); }
        }, true);
    });

    // открытие раздела (плитка меню, вкладка или выбор подложки Sentinel) и выход из него
    document.addEventListener('click', e => {
        const t = e.target.closest && e.target.closest('.bp-tab, .panel-tab');
        if (!t) return;
        const s = t.classList.contains('bp-tab') ? t.getAttribute('data-bp-tab') : null;
        setTimeout(() => { if (s && SEC[s]) enter(s); else leave(); }, 0);   // после переключения вкладок в script.js / site.js
    });
    map.on('moveend', () => {
        if (!sec || shape) return;   // с нарисованной фигурой список дат привязан к ней, а не к виду карты
        clearTimeout(timer);
        timer = setTimeout(() => load(0), 900);
    });

    // вызывается из updateActiveChips при любой смене подложки: выбор слоя Sentinel открывает его раздел в боковой панели
    window.snPanelSync = function (layerKey) {
        const s = LAYER_SEC[layerKey];
        if (!s || entering || !ui[s]) return;
        variant[s] = layerKey;
        const tab = document.querySelector('.bp-tab[data-bp-tab="' + s + '"]');
        if (sec === s) { enter(s); return; }
        if (tab) tab.click();
    };
    window.snOnRendererChange = function () { if (sec) renderFoot(); };
})();

// ---------- ПЕРЕМЕННЫЕ ----------
// Переменные для измерений (нужны для новых виджетов)
let measureMode = null;
let measureLayerGroup = new L.FeatureGroup();
map.addLayer(measureLayerGroup);
let measurePointsArr = [];

const measureInfoEl = document.createElement('div');
measureInfoEl.className = 'measure-info';
measureInfoEl.id = 'measureInfo';
document.querySelector('.map-stage').appendChild(measureInfoEl);
let drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

let drawControl = null;
let currentTool = null;
let activeDrawHandler = null;
let isEditing = false;
let selectedLayer = null;
let highlightLayer = null;

let areaHa = 0;
let estimatedCost = 0;
let objectsCount = 0;
let objectLabels = [];

// Переменные для редактирования
let activeLayer = null;
let activeTransformer = null;
let editMarkers = [];
let midPointMarkers = [];

// ============================================================
//  ЗАПРЕТ ПЕРЕСЕЧЕНИЙ ПРИ РИСОВАНИИ (БЕЗ ЛОМКИ РЕДАКТИРОВАНИЯ)
// ============================================================

// Вспомогательная функция для преобразования круга в полигон (без создания слоя)
function circleToPolygonPoints(circleLayer) {
    const center = circleLayer.getLatLng();
    const radius = circleLayer.getRadius();
    const points = [];
    const steps = 36;
    for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const lat = center.lat + (radius / 111320) * Math.cos(angle);
        const lng = center.lng + (radius / (111320 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
        points.push([lng, lat]);
    }
    points.push(points[0]);
    return points;
}

// Функция для получения GeoJSON для проверки (без создания новых слоёв)
function getCheckGeoJSON(layer) {
    if (layer instanceof L.Circle) {
        // Для круга создаём GeoJSON полигона напрямую
        const points = circleToPolygonPoints(layer);
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [points]
            }
        };
    }
    return layer.toGeoJSON();
}

function checkIntersections(newLayer) {
    // Проверяем самопересечение (только для полигонов, не для кругов)
    if (newLayer instanceof L.Polygon && !(newLayer instanceof L.Rectangle)) {
        try {
            const geojson = newLayer.toGeoJSON();
            if (geojson && geojson.geometry && geojson.geometry.type === 'Polygon') {
                const isValid = turf.booleanValid(geojson);
                if (!isValid) {
                    showError('❌ Фигура имеет самопересечения!');
                    return false;
                }
            }
        } catch(e) {
            console.warn('Ошибка проверки самопересечения:', e);
        }
    }
    
    // Проверяем пересечение с существующими фигурами
    const existingLayers = drawnItems.getLayers();
    if (existingLayers.length === 0) return true;
    
    try {
        // Получаем GeoJSON для нового слоя (без создания нового слоя)
        const newGeojson = getCheckGeoJSON(newLayer);
        if (!newGeojson || !newGeojson.geometry) return true;
        
        for (const existing of existingLayers) {
            if (existing === newLayer) continue;
            
            try {
                // Получаем GeoJSON для существующего слоя (без создания нового слоя)
                const existingGeojson = getCheckGeoJSON(existing);
                if (!existingGeojson || !existingGeojson.geometry) continue;
                
                const intersect = turf.intersect(newGeojson, existingGeojson);
                if (intersect) {
                    showError('❌ Фигура пересекается с существующими объектами!');
                    return false;
                }
            } catch(e) {
                continue;
            }
        }
        return true;
    } catch(e) {
        console.warn('Ошибка проверки пересечений:', e);
        return true;
    }
}

// Отдельная функция для показа ошибки
function showError(message) {
    updateStatus(message, true);
    
    // Создаём всплывающее уведомление
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-toast';
    errorDiv.innerHTML = `
        <div class="error-toast-content">
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
        </div>
    `;
    (document.fullscreenElement || document.webkitFullscreenElement || document.body).appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.classList.add('fade-out');
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 400);
    }, 3000);
}

// ---------- ПОЛУЧЕНИЕ ЦЕНТРА И ПЛОЩАДИ (в гектарах) ----------
function getObjectCenterAndArea(layer) {
    let center, area = 0;
    if (layer instanceof L.Circle) {
        const latLng = layer.getLatLng();
        const radius = layer.getRadius();
        center = [latLng.lng, latLng.lat];
        area = Math.PI * radius * radius; // площадь в м²
        return { center, area: area / 10000 }; // переводим в гектары
    }
    try {
        const geojson = layer.toGeoJSON();
        const geom = geojson.geometry;
        if (!geom) return null;
        if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
            const turfPoly = geom.type === 'Polygon' 
                ? turf.polygon(geom.coordinates)
                : turf.multiPolygon(geom.coordinates);
            const centroid = turf.centroid(turfPoly);
            center = centroid.geometry.coordinates;
            area = turf.area(turfPoly); // площадь в м²
            return { center, area: area / 10000 }; // переводим в гектары
        }
        return null;
    } catch(e) {
        return null;
    }
}

// ---------- LABELS (в гектарах) ----------
function addLabelToLayer(layer) {
    const data = getObjectCenterAndArea(layer);
    if (!data) return;
    const { center, area } = data;
    const labelText = area.toFixed(2) + ' га';
    const label = L.marker([center[1], center[0]], {
        icon: L.divIcon({
            className: 'area-label',
            html: `<div class="area-label-text">${labelText}</div>`,
            iconSize: [80, 20],
            iconAnchor: [40, 10]
        }),
        interactive: false
    }).addTo(map);
    layer._label = label;
    label._parentLayer = layer;
    objectLabels.push(label);
}

function updateAllLabels() {
    objectLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    objectLabels = [];
    drawnItems.eachLayer(layer => {
        addLabelToLayer(layer);
    });
}

// ---------- СПИСОК ОБЪЕКТОВ (в гектарах) ----------
function updateObjectList() {
    const container = document.getElementById('objectListContainer');
    if (!container) return;
    const layers = drawnItems.getLayers();
    let totalArea = 0;
    let html = '';
    objectsCount = layers.length;
    layers.forEach((layer, index) => {
        const data = getObjectCenterAndArea(layer);
        if (data) {
            totalArea += data.area;
            let type = 'Полигон';
            if (layer instanceof L.Circle) type = 'Круг';
            else if (layer instanceof L.Rectangle) type = 'Прямоугольник';
            const isSelected = selectedLayer === layer;
            html += `
                <div class="object-item ${isSelected ? 'selected' : ''}" onclick="selectObject(${index})">
                    <span class="obj-type">${type}</span>
                    <span class="obj-area">${data.area.toFixed(3)} га</span>
                    <button class="obj-delete" onclick="event.stopPropagation(); deleteObject(${index})">×</button>
                </div>
            `;
        }
    });
    document.getElementById('objectsCountBadge').textContent = layers.length;
    html += `
        <div class="object-total">
            <span>📊 Всего объектов: ${layers.length}</span>
            <span>📐 Общая площадь: ${totalArea.toFixed(3)} га</span>
        </div>
    `;
    container.innerHTML = html;
    areaHa = totalArea;
}

window.selectObject = function(index) {
    const layers = drawnItems.getLayers();
    if (layers[index]) {
        selectLayer(layers[index]);
        updateObjectList();
    }
};

window.deleteObject = function(index) {
    const layers = drawnItems.getLayers();
    if (layers[index]) {
        const layer = layers[index];
        if (layer._label && map.hasLayer(layer._label)) {
            map.removeLayer(layer._label);
        }
        drawnItems.removeLayer(layer);
        if (selectedLayer === layer) {
            selectedLayer = null;
            if (highlightLayer) {
                map.removeLayer(highlightLayer);
                highlightLayer = null;
            }
            document.getElementById('infoSection').style.display = 'none';
        }
        if (activeLayer === layer) {
            disableEditForAll();
        }
        updateAllLabels();
        updateObjectList();
        updateStatus('🗑️ Объект удалён');
    }
};

// ---------- DRAW CONTROL ----------
const SHAPE_STYLE = {
    color: '#059669',
    weight: 2.5,
    opacity: 0.8,
    fillColor: '#059669',
    fillOpacity: 0.15
};

function createDrawControl() {
    if (drawControl) {
        map.removeControl(drawControl);
    }
    drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                shapeOptions: { ...SHAPE_STYLE }
            },
            rectangle: { shapeOptions: { ...SHAPE_STYLE } },
            circle: { shapeOptions: { ...SHAPE_STYLE } },
            polyline: false,
            marker: false,
            circlemarker: false,
        },
        edit: {
            featureGroup: drawnItems,
            remove: true,
        },
    });
    map.addControl(drawControl);
    return drawControl;
}

// ---------- АКТИВАЦИЯ ИНСТРУМЕНТОВ ----------
function activateTool(tool) {
    if (measureMode) {
        deactivateMeasureMode();
    }
    if (currentTool === tool) {
        deactivateAllTools();
        return;
    }
    deactivateAllTools();
    currentTool = tool;
    if (!drawControl) {
        createDrawControl();
    }
    const toolbar = document.querySelector('.leaflet-draw-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
    }
    switch(tool) {
        case 'polygon':
            activeDrawHandler = new L.Draw.Polygon(map, drawControl.options.draw.polygon);
            activeDrawHandler.enable();
            break;
        case 'rectangle':
            activeDrawHandler = new L.Draw.Rectangle(map, drawControl.options.draw.rectangle);
            activeDrawHandler.enable();
            break;
        case 'circle':
            activeDrawHandler = new L.Draw.Circle(map, drawControl.options.draw.circle);
            activeDrawHandler.enable();
            break;
        default:
            return;
    }
    document.querySelectorAll('.draw-tool-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === tool);
    });
    const toolNames = { polygon: 'Полигон', rectangle: 'Прямоугольник', circle: 'Круг / Овал' };
    updateStatus(`🔧 Инструмент: ${toolNames[tool] || tool} — рисуйте на карте`);
}

function deactivateAllTools() {
    if (typeof skCancelTool === 'function') skCancelTool();   // инструмент виджета «Рисование»
    if (typeof lgCancelTool === 'function') lgCancelTool();   // инструмент вкладки «Логистика»
    if (typeof snCancelTool === 'function') snCancelTool();   // инструмент разделов со снимками
    if (activeDrawHandler) {
        activeDrawHandler.disable();
        activeDrawHandler = null;
    }
    const toolbar = document.querySelector('.leaflet-draw-toolbar');
    if (toolbar) {
        toolbar.style.display = '';
    }
    document.querySelectorAll('.draw-tool-btn').forEach(b => b.classList.remove('active'));
    if (isEditing) {
        isEditing = false;
        document.getElementById('editMapBtn').classList.remove('active');
        if (window._editControl) {
            map.removeControl(window._editControl);
            window._editControl = null;
        }
    }
    disableEditForAll();
    currentTool = null;
    updateStatus('🔧 Инструмент отключён');
}

// ============================================================
//  РЕДАКТИРОВАНИЕ ФИГУР С УДАЛЕНИЕМ ВЕРШИН (крестик при клике)
// ============================================================

// ---------- ВКЛЮЧЕНИЕ РЕДАКТИРОВАНИЯ ----------
function enableEditForLayer(layer) {
    disableEditForAll();
    if (!layer) return;
    
    try {
        // ============================================================
        // 1. ДЛЯ ПОЛИГОНОВ (с вершинами и серединными точками)
        // ============================================================
        if (layer instanceof L.Polygon && !(layer instanceof L.Rectangle)) {
            layer.enableEdit = function() {
                const latlngs = layer.getLatLngs();
                const flatLatLngs = latlngs[0] || latlngs;
                if (flatLatLngs && flatLatLngs.length > 0) {
                    const markers = [];
                    const midMarkers = [];
                    
                    // Создаём вершины
                    flatLatLngs.forEach((latlng, index) => {
                        // Состояние: normal | delete_mode
                        let isDeleteMode = false;
                        
                        const marker = L.marker(latlng, {
                            draggable: true,
                            icon: L.divIcon({
                                className: 'edit-vertex',
                                html: `<div class="vertex-dot" style="background:#059669; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab; transition: all 0.15s;"></div>`,
                                iconSize: [12, 12],
                                iconAnchor: [6, 6]
                            })
                        }).addTo(map);
                        
                        marker._vertexIndex = index;
                        marker._parentLayer = layer;
                        
                        // При наведении — увеличиваем
                        marker.on('mouseover', function() {
                            if (this._icon) {
                                this._icon.style.cursor = 'grab';
                                const dot = this._icon.querySelector('.vertex-dot');
                                if (dot && !isDeleteMode) {
                                    dot.style.transform = 'scale(1.4)';
                                }
                            }
                        });
                        marker.on('mouseout', function() {
                            if (this._icon) {
                                this._icon.style.cursor = 'default';
                                const dot = this._icon.querySelector('.vertex-dot');
                                if (dot && !isDeleteMode) {
                                    dot.style.transform = 'scale(1)';
                                }
                            }
                        });
                        
                        // ===== УДАЛЕНИЕ ВЕРШИНЫ: клик по вершине, потом клик по крестику =====
                        marker.on('click', function(e) {
                            // Если перетаскивали — игнорируем
                            if (this._wasDragged) {
                                this._wasDragged = false;
                                return;
                            }
                            
                            const layer = this._parentLayer;
                            const idx = this._vertexIndex;
                            const latlngs = layer.getLatLngs();
                            const flat = latlngs[0] || latlngs;
                            
                            // Нельзя удалить, если останется меньше 3 вершин
                            if (flat.length <= 3) {
                                updateStatus('⚠️ Нельзя удалить: минимум 3 вершины', true);
                                return;
                            }
                            
                            // Переключаем режим удаления
                            isDeleteMode = !isDeleteMode;
                            
                            if (isDeleteMode) {
                                // Показываем крестик
                                const dot = this._icon.querySelector('.vertex-dot');
                                if (dot) {
                                    dot.style.background = '#ef4444';
                                    dot.style.transform = 'scale(1.6)';
                                    dot.style.cursor = 'pointer';
                                    dot.innerHTML = '✕';
                                    dot.style.display = 'flex';
                                    dot.style.alignItems = 'center';
                                    dot.style.justifyContent = 'center';
                                    dot.style.color = 'white';
                                    dot.style.fontSize = '12px';
                                    dot.style.fontWeight = 'bold';
                                    dot.style.lineHeight = '12px';
                                    dot.style.borderColor = '#ef4444';
                                }
                                this._icon.style.cursor = 'pointer';
                                updateStatus('🗑️ Кликните ещё раз, чтобы удалить вершину');
                            } else {
                                // Возвращаем обычный вид
                                const dot = this._icon.querySelector('.vertex-dot');
                                if (dot) {
                                    dot.style.background = '#059669';
                                    dot.style.transform = 'scale(1)';
                                    dot.style.cursor = 'grab';
                                    dot.innerHTML = '';
                                    dot.style.borderColor = 'white';
                                }
                                this._icon.style.cursor = 'grab';
                                updateStatus('✏️ Редактирование');
                            }
                        });
                        
                        // Второй клик (удаление)
                        marker.on('click', function(e) {
                            // Если не в режиме удаления — игнорируем
                            if (!isDeleteMode) return;
                            if (this._wasDragged) {
                                this._wasDragged = false;
                                return;
                            }
                            
                            const layer = this._parentLayer;
                            const idx = this._vertexIndex;
                            const latlngs = layer.getLatLngs();
                            const flat = latlngs[0] || latlngs;
                            
                            if (flat.length <= 3) {
                                updateStatus('⚠️ Нельзя удалить: минимум 3 вершины', true);
                                isDeleteMode = false;
                                const dot = this._icon.querySelector('.vertex-dot');
                                if (dot) {
                                    dot.style.background = '#059669';
                                    dot.style.transform = 'scale(1)';
                                    dot.style.cursor = 'grab';
                                    dot.innerHTML = '';
                                    dot.style.borderColor = 'white';
                                }
                                return;
                            }
                            
                            // Удаляем вершину
                            const newLatlngs = [...flat];
                            newLatlngs.splice(idx, 1);
                            layer.setLatLngs([newLatlngs]);
                            
                            updateAllLabels();
                            updateObjectList();
                            updateObjectInfo(layer);
                            
                            disableEditForAll();
                            setTimeout(() => {
                                enableEditForLayer(layer);
                                updateStatus(`🗑️ Вершина удалена (осталось: ${newLatlngs.length})`);
                            }, 50);
                        });
                        
                        // Отслеживаем перетаскивание
                        marker.on('dragstart', function() {
                            this._wasDragged = false;
                            // Если был режим удаления — выключаем
                            if (isDeleteMode) {
                                isDeleteMode = false;
                                const dot = this._icon.querySelector('.vertex-dot');
                                if (dot) {
                                    dot.style.background = '#059669';
                                    dot.style.transform = 'scale(1)';
                                    dot.style.cursor = 'grab';
                                    dot.innerHTML = '';
                                    dot.style.borderColor = 'white';
                                }
                                this._icon.style.cursor = 'grab';
                            }
                        });
                        
                        marker.on('drag', function(e) {
                            this._wasDragged = true;
                            const pos = e.target.getLatLng();
                            const idx = this._vertexIndex;
                            const latlngs = layer.getLatLngs();
                            const coords = latlngs[0] || latlngs;
                            if (Array.isArray(coords) && coords.length > idx) {
                                coords[idx] = pos;
                                layer.setLatLngs([coords]);
                                updateMidPoints(layer, midMarkers);
                            }
                            updateAllLabels();
                            updateObjectList();
                        });
                        
                        marker.on('dragend', function() {
                            updateAllLabels();
                            updateObjectList();
                            this._wasDragged = false;
                        });
                        
                        markers.push(marker);
                    });
                    
                    // Создаём серединные точки
                    const createMidPoints = () => {
                        midMarkers.forEach(m => {
                            if (map.hasLayer(m)) map.removeLayer(m);
                        });
                        midMarkers.length = 0;
                        
                        const currentLatlngs = layer.getLatLngs();
                        const currentFlat = currentLatlngs[0] || currentLatlngs;
                        
                        for (let i = 0; i < currentFlat.length; i++) {
                            const p1 = currentFlat[i];
                            const p2 = currentFlat[(i + 1) % currentFlat.length];
                            
                            const midLat = (p1.lat + p2.lat) / 2;
                            const midLng = (p1.lng + p2.lng) / 2;
                            const midPoint = L.latLng(midLat, midLng);
                            
                            const midMarker = L.marker(midPoint, {
                                icon: L.divIcon({
                                    className: 'midpoint-vertex',
                                    html: `<div style="background:#94a3b8; width:10px; height:10px; border-radius:50%; border:2px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.2); cursor:pointer; transition: all 0.15s;"></div>`,
                                    iconSize: [10, 10],
                                    iconAnchor: [5, 5]
                                })
                            }).addTo(map);
                            
                            midMarker._edgeIndex = i;
                            midMarker._parentLayer = layer;
                            
                            midMarker.on('mouseover', function() {
                                if (this._icon) {
                                    this._icon.style.cursor = 'pointer';
                                    const dot = this._icon.querySelector('div');
                                    if (dot) {
                                        dot.style.background = '#059669';
                                        dot.style.transform = 'scale(1.5)';
                                    }
                                }
                            });
                            midMarker.on('mouseout', function() {
                                if (this._icon) {
                                    this._icon.style.cursor = 'default';
                                    const dot = this._icon.querySelector('div');
                                    if (dot) {
                                        dot.style.background = '#94a3b8';
                                        dot.style.transform = 'scale(1)';
                                    }
                                }
                            });
                            
                            midMarker.on('click', function() {
                                const layer = this._parentLayer;
                                const idx = this._edgeIndex + 1;
                                const newPoint = this.getLatLng();
                                
                                const latlngs = layer.getLatLngs();
                                const flat = latlngs[0] || latlngs;
                                const newLatlngs = [...flat];
                                newLatlngs.splice(idx, 0, newPoint);
                                layer.setLatLngs([newLatlngs]);
                                
                                updateAllLabels();
                                updateObjectList();
                                updateObjectInfo(layer);
                                
                                disableEditForAll();
                                setTimeout(() => {
                                    enableEditForLayer(layer);
                                    updateStatus(`✅ Добавлена вершина (всего: ${newLatlngs.length})`);
                                }, 50);
                            });
                            
                            midMarkers.push(midMarker);
                        }
                    };
                    
                    const updateMidPoints = (layer, midMarkers) => {
                        const currentLatlngs = layer.getLatLngs();
                        const currentFlat = currentLatlngs[0] || currentLatlngs;
                        
                        midMarkers.forEach((m, i) => {
                            if (i < currentFlat.length) {
                                const p1 = currentFlat[i];
                                const p2 = currentFlat[(i + 1) % currentFlat.length];
                                const midLat = (p1.lat + p2.lat) / 2;
                                const midLng = (p1.lng + p2.lng) / 2;
                                m.setLatLng(L.latLng(midLat, midLng));
                            }
                        });
                    };
                    
                    editMarkers = markers;
                    midPointMarkers = midMarkers;
                    
                    setTimeout(createMidPoints, 50);
                    
                    layer._updateMidPoints = function() {
                        updateMidPoints(layer, midMarkers);
                    };
                }
            };
            
            layer.disableEdit = function() {
                editMarkers.forEach(m => {
                    if (map.hasLayer(m)) map.removeLayer(m);
                });
                editMarkers = [];
                midPointMarkers.forEach(m => {
                    if (map.hasLayer(m)) map.removeLayer(m);
                });
                midPointMarkers = [];
                if (layer._updateMidPoints) {
                    delete layer._updateMidPoints;
                }
            };
        }
        
        // ============================================================
        // 2. ДЛЯ КРУГА
        // ============================================================
        if (layer instanceof L.Circle) {
            layer.enableEdit = function() {
                const center = layer.getLatLng();
                const radius = layer.getRadius();
                
                const centerMarker = L.marker(center, {
                    draggable: true,
                    icon: L.divIcon({
                        className: 'edit-vertex',
                        html: `<div style="background:#3b82f6; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab;"></div>`,
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    })
                }).addTo(map);
                
                const radiusPoint = map.layerPointToLatLng(map.latLngToLayerPoint(center).add([radius, 0]));
                const radiusMarker = L.marker(radiusPoint, {
                    draggable: true,
                    icon: L.divIcon({
                        className: 'edit-vertex',
                        html: `<div style="background:#f59e0b; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab;"></div>`,
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    })
                }).addTo(map);
                
                [centerMarker, radiusMarker].forEach(m => {
                    m.on('mouseover', function() {
                        if (this._icon) {
                            this._icon.style.cursor = 'grab';
                            this._icon.querySelector('div').style.transform = 'scale(1.4)';
                        }
                    });
                    m.on('mouseout', function() {
                        if (this._icon) {
                            this._icon.style.cursor = 'default';
                            this._icon.querySelector('div').style.transform = 'scale(1)';
                        }
                    });
                });
                
                centerMarker.on('drag', function(e) {
                    const pos = e.target.getLatLng();
                    const oldRadius = layer.getRadius();
                    layer.setLatLng(pos);
                    const newRadiusPoint = map.layerPointToLatLng(map.latLngToLayerPoint(pos).add([oldRadius, 0]));
                    radiusMarker.setLatLng(newRadiusPoint);
                    updateAllLabels();
                    updateObjectList();
                });
                
                radiusMarker.on('drag', function(e) {
                    const pos = e.target.getLatLng();
                    const centerPos = layer.getLatLng();
                    const newRadius = map.distance(centerPos, pos);
                    layer.setRadius(newRadius);
                    updateAllLabels();
                    updateObjectList();
                });
                
                centerMarker.on('dragend', function() {
                    updateAllLabels();
                    updateObjectList();
                });
                
                radiusMarker.on('dragend', function() {
                    updateAllLabels();
                    updateObjectList();
                });
                
                editMarkers = [centerMarker, radiusMarker];
            };
            
            layer.disableEdit = function() {
                editMarkers.forEach(m => {
                    if (map.hasLayer(m)) map.removeLayer(m);
                });
                editMarkers = [];
            };
        }
        
        // ============================================================
        // 3. ДЛЯ ПРЯМОУГОЛЬНИКА (ИСПРАВЛЕННЫЙ)
        // ============================================================
        if (layer instanceof L.Rectangle) {
            layer.enableEdit = function() {
                const bounds = layer.getBounds();
                const corners = [
                    bounds.getSouthWest(),
                    bounds.getSouthEast(),
                    bounds.getNorthEast(),
                    bounds.getNorthWest()
                ];
                
                const markers = [];
                
                corners.forEach((corner, index) => {
                    const marker = L.marker(corner, {
                        draggable: true,
                        icon: L.divIcon({
                            className: 'edit-vertex',
                            html: `<div style="background:#8b5cf6; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab;"></div>`,
                            iconSize: [12, 12],
                            iconAnchor: [6, 6]
                        })
                    }).addTo(map);
                    
                    marker.on('mouseover', function() {
                        if (this._icon) {
                            this._icon.style.cursor = 'grab';
                            this._icon.querySelector('div').style.transform = 'scale(1.4)';
                        }
                    });
                    marker.on('mouseout', function() {
                        if (this._icon) {
                            this._icon.style.cursor = 'default';
                            this._icon.querySelector('div').style.transform = 'scale(1)';
                        }
                    });
                    
                    marker._cornerIndex = index;
                    marker._parentLayer = layer;
                    
                    marker.on('drag', function(e) {
                        const pos = e.target.getLatLng();
                        const idx = this._cornerIndex;
                        const oppositeIdx = (idx + 2) % 4;
                        const opposite = corners[oppositeIdx];
                        
                        const newBounds = L.latLngBounds([opposite, pos]);
                        layer.setBounds(newBounds);
                        
                        const newCorners = [
                            newBounds.getSouthWest(),
                            newBounds.getSouthEast(),
                            newBounds.getNorthEast(),
                            newBounds.getNorthWest()
                        ];
                        
                        markers.forEach((m, i) => {
                            m.setLatLng(newCorners[i]);
                            corners[i] = newCorners[i];
                        });
                        
                        updateAllLabels();
                        updateObjectList();
                    });
                    
                    marker.on('dragend', function() {
                        updateAllLabels();
                        updateObjectList();
                    });
                    
                    markers.push(marker);
                });
                editMarkers = markers;
            };
            
            layer.disableEdit = function() {
                editMarkers.forEach(m => {
                    if (map.hasLayer(m)) map.removeLayer(m);
                });
                editMarkers = [];
            };
        }
    } catch(e) {
        console.warn('Ошибка включения редактирования:', e);
    }
    
    if (typeof layer.enableEdit === 'function') {
        layer.enableEdit();
        activeLayer = layer;
        updateStatus(`✏️ Редактирование: ${layer instanceof L.Circle ? 'Круг' : layer instanceof L.Rectangle ? 'Прямоугольник' : 'Полигон'}`);
    }
}

function disableEditForAll() {
    if (activeLayer && typeof activeLayer.disableEdit === 'function') {
        activeLayer.disableEdit();
    }
    editMarkers.forEach(m => {
        if (map.hasLayer(m)) map.removeLayer(m);
    });
    editMarkers = [];
    midPointMarkers.forEach(m => {
        if (map.hasLayer(m)) map.removeLayer(m);
    });
    midPointMarkers = [];
    activeLayer = null;
}

// ---------- КНОПКИ РИСОВАНИЯ НА КАРТЕ ----------
document.querySelectorAll('.draw-tool-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const tool = this.dataset.tool;
        if (this.classList.contains('active')) {
            this.classList.remove('active');
            deactivateAllTools();
            return;
        }
        activateTool(tool);
    });
});

// ---------- РЕДАКТИРОВАНИЕ НА КАРТЕ (скрыта) ----------
document.getElementById('editMapBtn').style.display = 'none';

// ---------- УДАЛЕНИЕ НА КАРТЕ ----------
document.getElementById('deleteMapBtn').addEventListener('click', function() {
    if (selectedLayer) {
        if (selectedLayer._label && map.hasLayer(selectedLayer._label)) {
            map.removeLayer(selectedLayer._label);
        }
        drawnItems.removeLayer(selectedLayer);
        if (activeLayer === selectedLayer) {
            disableEditForAll();
        }
        selectedLayer = null;
        if (highlightLayer) {
            map.removeLayer(highlightLayer);
            highlightLayer = null;
        }
        document.getElementById('infoSection').style.display = 'none';
        updateAllLabels();
        updateObjectList();
        updateStatus('🗑️ Объект удалён');
    } else {
        updateStatus('Выберите объект для удаления', true);
    }
});

// ---------- ОЧИСТИТЬ НА КАРТЕ ----------
document.getElementById('clearMapBtn').addEventListener('click', function() {
    drawnItems.clearLayers();
    objectLabels.forEach(label => {
        if (map.hasLayer(label)) map.removeLayer(label);
    });
    objectLabels = [];
    disableEditForAll();
    selectedLayer = null;
    if (highlightLayer) {
        map.removeLayer(highlightLayer);
        highlightLayer = null;
    }
    document.getElementById('infoSection').style.display = 'none';
    areaHa = 0;
    estimatedCost = 0;
    objectsCount = 0;
    updateObjectList();
    updateStatus('🧹 Все объекты очищены');
});

// ---------- СОБЫТИЯ РИСОВАНИЯ ----------
map.on(L.Draw.Event.CREATED, function(event) {
    // Фигуры виджета «Рисование» обрабатываются отдельно (блок «ВИДЖЕТ РИСОВАНИЯ»)
    if (typeof skOnCreated === 'function' && skOnCreated(event)) return;
    if (typeof snOnCreated === 'function' && snOnCreated(event)) return;   // разделы «Снимки / NDVI / NDWI / NDMI / NBR»
    if (typeof lgOnCreated === 'function' && lgOnCreated(event)) return;   // вкладка «Логистика»
    if (typeof hyOnCreated === 'function' && hyOnCreated(event)) return;   // вкладка «Профиль» → «По площади»
    const layer = event.layer;
    
    // ===== ПРОВЕРКА ПЕРЕСЕЧЕНИЙ =====
    if (!checkIntersections(layer)) {
        if (drawnItems.hasLayer(layer)) {
            drawnItems.removeLayer(layer);
        }
        if (activeDrawHandler) {
            activeDrawHandler.disable();
            activeDrawHandler = null;
        }
        document.querySelectorAll('.draw-tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
        currentTool = null;
        const toolbar = document.querySelector('.leaflet-draw-toolbar');
        if (toolbar) {
            toolbar.style.display = '';
        }
        updateStatus('❌ Рисование отменено: пересечение с существующими объектами', true);
        return;
    }
    
    drawnItems.addLayer(layer);
    
    if (layer instanceof L.Circle) {
        layer.on('move', function() { updateAllLabels(); updateObjectList(); });
        layer.on('resize', function() { updateAllLabels(); updateObjectList(); });
    }
    
    addLabelToLayer(layer);
    disableEditForAll();
    selectLayer(layer);
    updateAllLabels();
    updateObjectList();
    
    if (activeDrawHandler) {
        activeDrawHandler.disable();
        activeDrawHandler = null;
    }
    document.querySelectorAll('.draw-tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
    currentTool = null;
    
    const toolbar = document.querySelector('.leaflet-draw-toolbar');
    if (toolbar) {
        toolbar.style.display = '';
    }
    
    updateStatus('✅ Объект создан. Кликните на него для редактирования.');
});

// ===== ВАЖНО: ОБРАБОТЧИК РЕДАКТИРОВАНИЯ (был удалён!) =====
map.on(L.Draw.Event.EDITED, function(event) {
    const layers = event.layers;
    let hasError = false;
    
    layers.eachLayer(function(layer) {
        if (!checkIntersections(layer)) {
            hasError = true;
        }
    });
    
    if (hasError) {
        updateStatus('❌ Изменения отменены: пересечение с существующими объектами', true);
        if (selectedLayer) {
            disableEditForAll();
            setTimeout(() => {
                selectLayer(selectedLayer);
            }, 100);
        }
        return;
    }
    
    updateAllLabels();
    updateObjectList();
    if (selectedLayer) {
        updateObjectInfo(selectedLayer);
    }
    updateStatus('✅ Изменения сохранены');
});

// ===== ВАЖНО: ОБРАБОТЧИК УДАЛЕНИЯ =====
map.on(L.Draw.Event.DELETED, function() {
    if (selectedLayer && !drawnItems.hasLayer(selectedLayer)) {
        selectedLayer = null;
        if (highlightLayer) {
            map.removeLayer(highlightLayer);
            highlightLayer = null;
        }
        document.getElementById('infoSection').style.display = 'none';
    }
    updateAllLabels();
    updateObjectList();
});

// ---------- ВЫБОР ОБЪЕКТА ----------
map.on('click', function(e) {
    // клик по графике виджета «Рисование» не должен выделять территорию под ней
    if (typeof sketchIsBusy === 'function' && sketchIsBusy()) return;
    let found = false;
    drawnItems.eachLayer(layer => {
        const bounds = layer.getBounds ? layer.getBounds() : null;
        if (bounds && bounds.contains(e.latlng)) {
            selectLayer(layer);
            found = true;
        } else if (layer.getLatLng && layer.getLatLng().distanceTo(e.latlng) < 15) {
            selectLayer(layer);
            found = true;
        }
    });
    
    if (!found) {
        disableEditForAll();
        if (highlightLayer) {
            map.removeLayer(highlightLayer);
            highlightLayer = null;
        }
        selectedLayer = null;
        document.getElementById('infoSection').style.display = 'none';
        updateObjectList();
        updateStatus('🔧 Редактирование отключено');
    }
});

const originalSelectLayer = function(layer) {
    if (highlightLayer) {
        map.removeLayer(highlightLayer);
        highlightLayer = null;
    }
    selectedLayer = layer;
    const geojson = layer.toGeoJSON();
    highlightLayer = L.geoJSON(geojson, {
        style: { color: '#f59e0b', weight: 3, opacity: 0.9, fillColor: '#f59e0b', fillOpacity: 0.08 }
    }).addTo(map);
    updateObjectInfo(layer);
    document.getElementById('infoSection').style.display = 'block';
    updateObjectList();
};

function selectLayer(layer) {
    if (activeLayer === layer) {
        disableEditForAll();
        if (highlightLayer) {
            map.removeLayer(highlightLayer);
            highlightLayer = null;
        }
        selectedLayer = null;
        document.getElementById('infoSection').style.display = 'none';
        updateObjectList();
        updateStatus('🔧 Редактирование отключено');
        return;
    }
    
    disableEditForAll();
    originalSelectLayer(layer);
    
    if (layer) {
        setTimeout(() => {
            enableEditForLayer(layer);
        }, 100);
    }
}

function updateObjectInfo(layer) {
    const data = getObjectCenterAndArea(layer);
    if (!data) return;
    let type = 'Полигон';
    if (layer instanceof L.Circle) type = 'Круг';
    else if (layer instanceof L.Rectangle) type = 'Прямоугольник';
    let vertices = 0;
    try {
        const geojson = layer.toGeoJSON();
        const geom = geojson.geometry;
        if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
            const coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
            vertices = coords.length;
        }
    } catch(e) {}
    document.getElementById('objectType').textContent = type;
    document.getElementById('objectArea').textContent = data.area.toFixed(4) + ' га';
    document.getElementById('objectPerimeter').textContent = '—';
    document.getElementById('objectVertices').textContent = vertices || '—';
}

// ============================================================
//  ИМПОРТ ВЫПИСКИ ИЗ РОСРЕЕСТРА (XML) → GeoJSON (WGS84)
// ============================================================
//  Координаты в выписке ЕГРН даны в местной системе координат (МСК-XX):
//  X — на север, Y — на восток (в метрах). Для карты они пересчитываются
//  в WGS84: проекция Гаусса–Крюгера на эллипсоиде Красовского (обратная задача),
//  затем 7-параметрический переход к WGS84 по ГОСТ 51794-2008.
//  Персональные данные (правообладатели, ИНН, получатель выписки) не читаются.
//
//  Поддержаны местные системы МСК большинства субъектов РФ (таблица RR_MSK).
//  Чтобы добавить недостающий регион, допишите запись в RR_MSK:
//  ключ — номер региона, fn — ложный сдвиг по X, zones — rrZ(...) или {номер зоны: {lon0, fe}};
//  при необходимости: helmert — свои параметры перехода к WGS84, bbox — рамка региона.
// ============================================================

const RR_ELLIPSOIDS = {
    krass: { a: 6378245, f: 1 / 298.3 },
    wgs84: { a: 6378137, f: 1 / 298.257223563 }
};

// Параметры перехода к WGS84: сдвиги в метрах, вращения в секундах дуги, масштаб в ppm
// (запись в соглашении PROJ +towgs84, «position vector»)
const RR_HELMERT = { dx: 23.57, dy: -140.95, dz: -79.8, rx: 0, ry: 0.35, rz: 0.79, ds: -0.22 };
// Для систем на базе СК-95 (МСК-33 «от СК-95», МСК-71.1): знак вращения rz — как в PROJ (в справочниках MapInfo он обратный)
const RR_HELMERT_SK95 = { dx: 24.47, dy: -130.89, dz: -81.56, rx: 0, ry: 0, rz: 0.13, ds: -0.22 };
const RR_HELMERT_SK95_71 = { dx: 24.83, dy: -130.97, dz: -81.74, rx: 0, ry: 0, rz: 0.13, ds: -0.22 };

// Зоны МСК: rrZ(номер первой зоны, lon0 первой зоны, шаг зон по долготе, число зон, ложный сдвиг Y первой зоны).
// Каждая следующая зона: lon0 + шаг, ложный сдвиг Y + 1 000 000 (первая цифра Y — номер зоны).
function rrZ(first, lon0, step, count, fe) {
    const z = {};
    for (let i = 0; i < count; i++) z[first + i] = { lon0: lon0 + step * i, fe: fe + 1000000 * i };
    return z;
}

// Общая рамка России — ловит неверный регион/зону/сдвиг, когда у региона нет своей рамки bbox
const RR_RU_BBOX = [18, 40, 190, 83];

const RR_MSK = {
    '31': {
        name: 'МСК-31 (Белгородская область)',
        fn: -5212900.56,
        zones: {
            1: { lon0: 35.48333333333, fe: 1250000 },
            2: { lon0: 38.48333333333, fe: 2250000 }
        },
        // защитная рамка региона [lonMin, latMin, lonMax, latMax] — ловит неверную зону
        bbox: [34.5, 48.9, 39.6, 51.9]
    },
    '01': { name: 'МСК-01 (Республика Адыгея)', fn: -4511057.628, zones: rrZ(1, 37.98333333333, 3, 2, 1300000) },
    '02': { name: 'МСК-02 (Республика Башкортостан)', fn: -5409414.7, zones: rrZ(1, 55.03333333333, 3, 2, 1300000) },
    '03': { name: 'МСК-03 (Республика Бурятия)', fn: -5211057.63, zones: rrZ(1, 100.03333333333, 3, 7, 1250000) },
    '04': { name: 'МСК-04 (Республика Алтай)', fn: -5112900.56, zones: rrZ(1, 85.46666666666, 3, 2, 1300000) },
    '05': { name: 'МСК-05 (Республика Дагестан)', fn: -11057.628, zones: rrZ(1, 46.98333333333, 3, 1, 4300000) },
    '06': { name: 'МСК-06 (Республика Ингушетия)', fn: -4311057.63, zones: rrZ(1, 43.98333333333, 3, 1, 1300000) },
    '07': { name: 'МСК-07 (Кабардино-Балкарская Республика)', fn: -4311057.63, zones: rrZ(1, 43.98333333333, 3, 1, 1300000) },
    '08': { name: 'МСК-08 (Республика Калмыкия)', fn: -4711057.63, zones: rrZ(1, 40.98333333333, 3, 3, 1300000) },
    '09': { name: 'МСК-09 (Карачаево-Черкесская Республика)', fn: -4311057.63, zones: rrZ(1, 40.98333333333, 3, 1, 1300000) },
    '10': { name: 'МСК-10 (Республика Карелия, зоны 6°)', fn: -6511057.63, zones: rrZ(1, 32.03333333333, 6, 2, 1400000) },
    '11': { name: 'МСК-11 (Республика Коми)', fn: -6211057.628, zones: rrZ(1, 41.03333333333, 3, 9, 1400000) },
    '12': { name: 'МСК-12 (Республика Марий Эл)', fn: -5914743.504, zones: rrZ(1, 47.55, 3, 2, 1250000) },
    '13': { name: 'МСК-13 (Республика Мордовия)', fn: -5614743.504, zones: rrZ(1, 44.55, 3, 2, 1250000) },
    '14': { name: 'МСК-14 (Республика Саха (Якутия), зоны 6°)', fn: -5912900.566, zones: rrZ(1, 108.45, 6, 9, 1400000) },
    '15': { name: 'МСК-15 (Республика Северная Осетия — Алания)', fn: -4311057.63, zones: rrZ(1, 43.98333333333, 3, 1, 1300000) },
    '16': { name: 'МСК-16 (Республика Татарстан)', fn: -5709414.7, zones: rrZ(1, 49.033333333333, 3, 3, 1300000) },
    '18': { name: 'МСК-18 (Удмуртская Республика)', fn: -5914743.504, zones: rrZ(1, 50.55, 3, 2, 1250000) },
    '20': { name: 'МСК-20 (Чеченская Республика)', fn: -4311057.63, zones: rrZ(1, 43.98333333333, 3, 2, 1300000) },
    '21': { name: 'МСК-21 (Чувашская Республика)', fn: -5814743.504, zones: rrZ(1, 47.55, 3, 2, 1250000) },
    '22': { name: 'МСК-22 (Алтайский край)', fn: -5312900.56, zones: rrZ(1, 79.46666666666, 3, 3, 1300000) },
    '23': { name: 'МСК-23 (Краснодарский край)', fn: -4511057.628, zones: rrZ(1, 37.98333333333, 3, 2, 1300000) },
    '24': { name: 'МСК-24 (Красноярский край, зоны 6°)', fn: -5416586.442, zones: rrZ(1, 81.51666666666, 6, 6, 1500000) },
    '25': { name: 'МСК-25 (Приморский край)', fn: -4416586.44, zones: rrZ(1, 130.71666666666, 3, 4, 1300000) },
    '26': { name: 'МСК-26 (Ставропольский край)', fn: -4511057.63, zones: rrZ(1, 40.98333333333, 3, 2, 1300000) },
    '27': { name: 'МСК-27 (Хабаровский край)', fn: -4916586.44, zones: rrZ(1, 130.71666666666, 3, 6, 1300000) },
    '28': { name: 'МСК-28 (Амурская область)', fn: -5116586.44, zones: rrZ(1, 121.71666666666, 3, 5, 1300000) },
    '29': { name: 'МСК-29 (Архангельская область, зоны 6°)', fn: -6511057.628, zones: rrZ(1, 32.03333333333, 6, 5, 1400000) },
    '30': { name: 'МСК-30 (Астраханская область)', fn: -4714743.504, zones: rrZ(1, 46.05, 3, 2, 1300000) },
    '32': { name: 'МСК-32 (Брянская область)', fn: -5412900.56, zones: rrZ(1, 32.48333333333, 3, 2, 1250000) },
    '33': { name: 'МСК-33 (Владимирская область, от СК-63)', fn: -5814743.504, zones: rrZ(1, 38.55, 3, 3, 1250000) },
    '34': { name: 'МСК-34 (Волгоградская область)', fn: -4914743.504, zones: rrZ(1, 43.05, 3, 2, 1300000) },
    '35': { name: 'МСК-35 (Вологодская область)', fn: -6214743.504, zones: rrZ(1, 35.55, 3, 4, 1250000) },
    '36': { name: 'МСК-36 (Воронежская область)', fn: -5212900.566, zones: rrZ(1, 38.48333333333, 3, 2, 1250000) },
    '37': { name: 'МСК-37 (Ивановская область)', fn: -6014743.504, zones: rrZ(1, 38.55, 3, 2, 1250000) },
    '38': { name: 'МСК-38 (Иркутская область)', fn: -5411057.63, zones: rrZ(1, 97.03333333333, 3, 8, 1250000) },
    '39': { name: 'МСК-39 (Калининградская область)', fn: -5711057.628, zones: rrZ(1, 21.45, 3, 1, 1250000) },
    '40': { name: 'МСК-40 (Калужская область)', fn: -5612900.566, zones: rrZ(1, 35.48333333333, 3, 1, 1250000) },
    '41': { name: 'МСК-41 (Камчатский край, зоны 6°)', fn: -5316586.442, zones: rrZ(1, 158.46666666667, 6, 3, 1400000) },
    '42': { name: 'МСК-42 (Кемеровская область)', fn: -5512900.56, zones: rrZ(1, 85.46666666666, 3, 2, 1300000) },
    '43': { name: 'МСК-43 (Кировская область)', fn: -5914743.504, zones: rrZ(1, 47.55, 3, 3, 1250000) },
    '44': { name: 'МСК-44 (Костромская область)', fn: -6114743.504, zones: rrZ(1, 41.55, 3, 3, 1250000) },
    '45': { name: 'МСК-45 (Курганская область)', fn: -5709414.7, zones: rrZ(1, 61.03333333333, 3, 3, 1300000) },
    '46': { name: 'МСК-46 (Курская область)', fn: -5312900.566, zones: rrZ(1, 35.48333333333, 3, 2, 1250000) },
    '47': { name: 'МСК-47 (Ленинградская область)', fn: -6211057.628, zones: rrZ(1, 27.95, 3, 3, 1250000) },
    '48': { name: 'МСК-48 (Липецкая область)', fn: -5412900.566, zones: rrZ(1, 38.48333333333, 3, 2, 1250000) },
    '49': { name: 'МСК-49 (Магаданская область, зоны 6°)', fn: -6212900.566, zones: rrZ(1, 144.45, 6, 4, 1400000) },
    '50': { name: 'МСК-50 (Московская область)', fn: -5712900.566, zones: rrZ(1, 35.48333333333, 3, 2, 1250000) },
    '51': { name: 'МСК-51 (Мурманская область, зоны 6°)', fn: -7011057.628, zones: rrZ(1, 32.03333333333, 6, 2, 1400000) },
    '52': { name: 'МСК-52 (Нижегородская область)', fn: -5714743.504, zones: rrZ(1, 41.55, 3, 3, 1250000) },
    '53': { name: 'МСК-53 (Новгородская область)', fn: -5912900.56, zones: rrZ(1, 29.48333333333, 3, 3, 1250000) },
    '54': { name: 'МСК-54 (Новосибирская область)', fn: -5612900.566, zones: rrZ(1, 74.73333333333, 3, 4, 1250000) },
    '55': { name: 'МСК-55 (Омская область)', fn: -5612900.563, zones: rrZ(1, 71.73333333333, 3, 2, 1250000) },
    '56': { name: 'МСК-56 (Оренбургская область)', fn: -5309414.7, zones: rrZ(1, 52.03333333333, 3, 4, 1300000) },
    '57': { name: 'МСК-57 (Орловская область)', fn: -12900.566, zones: rrZ(1, 32.48333333333, 3, 3, 1250000), fnAlt: -5412900.566 },
    '58': { name: 'МСК-58 (Пензенская область)', fn: -5514743.504, zones: rrZ(1, 43.05, 3, 2, 1300000) },
    '59': { name: 'МСК-59 (Пермский край)', fn: -5914743.504, zones: rrZ(1, 53.55, 3, 3, 1250000) },
    '60': { name: 'МСК-60 (Псковская область)', fn: -5911057.63, zones: rrZ(1, 27.95, 3, 3, 1250000) },
    '61': { name: 'МСК-61 (Ростовская область)', fn: -4811057.628, zones: rrZ(1, 37.98333333333, 3, 3, 1300000) },
    '62': { name: 'МСК-62 (Рязанская область)', fn: -5612900.56, zones: rrZ(1, 38.48333333333, 3, 3, 1250000) },
    '63': { name: 'МСК-63 (Самарская область)', fn: -5509414.7, zones: rrZ(1, 49.03333333333, 3, 2, 1300000) },
    '64': { name: 'МСК-64 (Саратовская область)', fn: -5214743.504, zones: rrZ(1, 43.05, 3, 3, 1300000) },
    '65': { name: 'МСК-65 (Сахалинская область)', fn: -4516586.439, zones: rrZ(1, 142.71666666667, 3, 1, 1300000) },
    '67': { name: 'МСК-67 (Смоленская область)', fn: -5612900.56, zones: rrZ(1, 32.48333333333, 3, 3, 1250000) },
    '68': { name: 'МСК-68 (Тамбовская область)', fn: -5412900.56, zones: rrZ(1, 41.48333333333, 3, 3, 1250000) },
    '69': { name: 'МСК-69 (Тверская область)', fn: -6012900.566, zones: rrZ(1, 32.48333333333, 3, 3, 1250000) },
    '70': { name: 'МСК-70 (Томская область)', fn: -5912900.566, zones: rrZ(1, 74.73333333333, 3, 6, 1250000) },
    '71': { name: 'МСК-71 (Тульская область)', fn: -5612900.563, zones: rrZ(1, 35.48333333333, 3, 2, 1250000) },
    '73': { name: 'МСК-73 (Ульяновская область)', fn: -5514743.504, zones: rrZ(1, 46.05, 3, 2, 1300000) },
    '74': { name: 'МСК-74 (Челябинская область)', fn: -5509414.7, zones: rrZ(1, 58.03333333333, 3, 3, 1300000) },
    '75': { name: 'МСК-75 (Забайкальский край)', fn: -5111057.628, zones: rrZ(1, 109.03333333333, 3, 5, 1250000) },
    '76': { name: 'МСК-76 (Ярославская область)', fn: -6014743.504, zones: rrZ(1, 38.55, 3, 2, 1250000) },
    '83': { name: 'МСК-83 (Ненецкий автономный округ, зоны 6°)', fn: -6511057.628, zones: rrZ(3, 44.03333333333, 6, 5, 3400000) },
    '86': { name: 'МСК-86 (Ханты-Мансийский автономный округ — Югра, зоны 6°)', fn: -5811057.63, zones: rrZ(1, 60.05, 6, 5, 1500000) },
    '87': { name: 'МСК-87 (Чукотский автономный округ, зоны 6°)', fn: -6212900.566, zones: rrZ(3, 156.45, 6, 6, 3400000) },
    '90': { name: 'МСК-90 (Республика Крым и г. Севастополь)', fn: -9214.692, zones: rrZ(1, 32.5, 3, 2, 4300000) },
    // --- варианты и нестандартные системы (параметры — по справочнику МСК Росреестра) ---
    // ключ «код/вариант» выбирается по тексту СК в выписке («6 градусная», «от СК-95»)
    '33/95': { name: 'МСК-33 (Владимирская область, от СК-95)', fn: -6032524.376, zones: rrZ(0, 39, 3, 1, 134156.988), helmert: RR_HELMERT_SK95 },
    '66': { name: 'МСК-66 (Свердловская область, зоны 6°)', fn: -5911057.63, zones: rrZ(1, 60.05, 6, 2, 1500000), assume: 'размер зоны 6°' },
    '66/3': { name: 'МСК-66 (Свердловская область, зоны 3°)', fn: -5911057.63, zones: rrZ(1, 60.05, 3, 3, 1500000) },
    '72': { name: 'МСК-72 (Тюменская область, зоны 1,5°)', fn: -6000000, zones: rrZ(1, 66.08333333, 1.5, 6, 1500000), assume: 'размер зоны 1,5°' },
    '72/3': { name: 'МСК-72 (Тюменская область, зоны 3°)', fn: -5811057.63, zones: rrZ(1, 63.05, 3, 5, 1500000) },
    '72/6': { name: 'МСК-72 (Тюменская область, зоны 6°)', fn: -5811057.63, zones: rrZ(1, 63.05, 6, 3, 1500000) },
    '71.1': { name: 'МСК-71.1 (Тульская область, на базе СК-95)', fn: -5263444.764, zones: rrZ(0, 37.427222222222, 3, 1, 250000), helmert: RR_HELMERT_SK95_71 },
    '1964': { name: 'МСК-1964 (Санкт-Петербург)', fn: -6552810.0, zones: rrZ(0, 30, 3, 1, 95942.17), bbox: [29.0, 59.5, 31.0, 60.4] },
    // Красноярский край: МСК-163…170 — общая ось на любой номер зоны, номер зоны — первая цифра Y
    '163': { name: 'МСК-163 (Красноярский край)', fn: -7434483.2, axis: { lon0: 81, fe: 65425.7 } },
    '164': { name: 'МСК-164 (Красноярский край)', fn: -6542783.5, axis: { lon0: 84, fe: 86209.8 } },
    '165': { name: 'МСК-165 (Красноярский край)', fn: -5652185, axis: { lon0: 87, fe: 105295.8 } },
    '166': { name: 'МСК-166 (Красноярский край)', fn: -5540944.5, axis: { lon0: 90, fe: 107543.3 } },
    '167': { name: 'МСК-167 (Красноярский край)', fn: -5578022.5, axis: { lon0: 93, fe: 106797.8 } },
    '168': { name: 'МСК-168 (Красноярский край)', fn: -5503868.6, axis: { lon0: 96, fe: 108285.2 } },
    '169': { name: 'МСК-169 (Красноярский край)', fn: -5503868.6, axis: { lon0: 99, fe: 117308.6 } },
    '170': { name: 'МСК-170 (Красноярский край)', fn: -6357146.1, axis: { lon0: 102, fe: 90338.9 } },
    // Республика Хакасия работает в системе МСК-166
    '19': { name: 'МСК-19 (Республика Хакасия, МСК-166)', fn: -5540944.5, axis: { lon0: 90, fe: 107543.3 } }
};
RR_MSK['66/6'] = RR_MSK['66'];
RR_MSK['72/1.5'] = RR_MSK['72'];
// Крым и Севастополь — одна система (коды 82/90/91/92 встречаются в разных документах), Санкт-Петербург — МСК-1964
['82', '91', '92'].forEach(c => { RR_MSK[c] = RR_MSK['90']; });
RR_MSK['78'] = RR_MSK['1964'];
// Москва: в справочнике Росреестра — в составе МСК-50; рамка города не даёт молча принять чужую систему
RR_MSK['77'] = Object.assign({}, RR_MSK['50'], { name: 'МСК-77 (Москва, зоны МСК-50)', bbox: [36.6, 55.0, 38.4, 56.2] });

// Обратная проекция Гаусса–Крюгера (k0 = 1, lat0 = 0): плоские E, N → широта/долгота (радианы)
function rrTmInverse(E, N, ell, lon0Deg, fe, fn) {
    const a = ell.a;
    const e2 = ell.f * (2 - ell.f);
    const ep2 = e2 / (1 - e2);
    const e4 = e2 * e2, e6 = e4 * e2;
    const mu = (N - fn) / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
    const s = Math.sqrt(1 - e2);
    const e1 = (1 - s) / (1 + s);
    const phi1 = mu
        + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
        + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
        + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
        + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
    const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1);
    const C1 = ep2 * cos1 * cos1;
    const T1 = tan1 * tan1;
    const w = 1 - e2 * sin1 * sin1;
    const N1 = a / Math.sqrt(w);
    const R1 = a * (1 - e2) / Math.pow(w, 1.5);
    const D = (E - fe) / N1;
    const lat = phi1 - (N1 * tan1 / R1) * (
        D * D / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720
    );
    const lon = lon0Deg * Math.PI / 180 + (
        D
        - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120
    ) / cos1;
    return { lat, lon };
}

// Геодезические координаты (радианы, h = 0) → геоцентрические XYZ
function rrGeodeticToXyz(lat, lon, ell) {
    const e2 = ell.f * (2 - ell.f);
    const sl = Math.sin(lat);
    const n = ell.a / Math.sqrt(1 - e2 * sl * sl);
    return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - e2) * sl];
}

// Геоцентрические XYZ → геодезические (радианы), итерационно
function rrXyzToGeodetic(X, Y, Z, ell) {
    const e2 = ell.f * (2 - ell.f);
    const p = Math.sqrt(X * X + Y * Y);
    let lat = Math.atan2(Z, p * (1 - e2));
    for (let i = 0; i < 8; i++) {
        const sl = Math.sin(lat);
        const n = ell.a / Math.sqrt(1 - e2 * sl * sl);
        lat = Math.atan2(Z + e2 * n * sl, p);
    }
    return { lat, lon: Math.atan2(Y, X) };
}

// МСК (X — север, Y — восток) → [долгота, широта] в WGS84, градусы; zone — {lon0, fe} (см. rrZoneFor)
function rrMskToWgs84(x, y, region, zone) {
    const z = zone;
    const g = rrTmInverse(y, x, RR_ELLIPSOIDS.krass, z.lon0, z.fe, region.fn);
    const as = Math.PI / 180 / 3600;
    const h = region.helmert || RR_HELMERT;
    const rx = h.rx * as, ry = h.ry * as, rz = h.rz * as, s = 1 + h.ds * 1e-6;
    const p = rrGeodeticToXyz(g.lat, g.lon, RR_ELLIPSOIDS.krass);
    const X = h.dx + s * (p[0] - rz * p[1] + ry * p[2]);
    const Y = h.dy + s * (rz * p[0] + p[1] - rx * p[2]);
    const Z = h.dz + s * (-ry * p[0] + rx * p[1] + p[2]);
    const w = rrXyzToGeodetic(X, Y, Z, RR_ELLIPSOIDS.wgs84);
    return [w.lon * 180 / Math.PI, w.lat * 180 / Math.PI];
}

// ---------- разбор XML ----------
function rrKids(el, name) {
    return Array.from(el.children).filter(c => c.localName.toLowerCase() === name);
}
function rrAll(el, name) {
    return Array.from(el.getElementsByTagName('*')).filter(c => c.localName.toLowerCase() === name);
}
function rrText(el, path) {
    if (!el) return '';
    let cur = [el];
    path.split('/').forEach(n => { cur = cur.flatMap(e => rrKids(e, n)); });
    return cur[0] ? cur[0].textContent.trim() : '';
}
function rrNum(s) {
    const v = parseFloat(String(s).replace(',', '.'));
    return isNaN(v) ? null : v;
}
// площадь плоского кольца по формуле Гаусса (м²)
function rrRingArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) s += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
    return Math.abs(s) / 2;
}
// Название СК из выписки → код региона и (если указана) зона; кириллические и латинские М/С/К равнозначны
// Код может быть трёх-четырёхзначным (МСК-167, МСК-1964) или с точкой (МСК-71.1)
function rrParseSk(skText) {
    const m = /[МM][СC][КK][\s\-–—]*(\d{2,4}(?:[.,]\d)?)/i.exec(skText || '');
    if (!m) return null;
    const zm = /зона\s*[№#]?\s*(\d{1,2})/i.exec(skText);
    return { code: m[1].replace(',', '.'), zone: zm ? parseInt(zm[1], 10) : null };
}

// Параметры региона по названию СК; если у региона несколько вариантов (МСК-72: зоны 1,5°/3°/6°; МСК-33: от СК-63/СК-95),
// вариант берётся из текста выписки, иначе — основной (guessed = true, если он принят «по умолчанию» у неоднозначного региона)
function rrFindRegion(sk, skText) {
    const t = skText || '';
    let key = sk.code;
    let stated = false;
    const am = /(\d+(?:[.,]\d+)?)\s*[-–—]?\s*градус/i.exec(t);
    if (am && RR_MSK[key + '/' + am[1].replace(',', '.')]) {
        key = key + '/' + am[1].replace(',', '.');
        stated = true;
    } else if (/СК[\s\-–—]*95/i.test(t) && RR_MSK[key + '/95']) {
        key = key + '/95';
        stated = true;
    }
    const region = RR_MSK[key];
    return region ? { region: region, guessed: !!region.assume && !stated } : null;
}

// Зона точки: сначала из названия СК в выписке, затем по первой цифре Y, затем по ближайшему ложному сдвигу Y.
// У регионов с общей осью (axis) номер зоны — только первая цифра Y, ложный сдвиг = номер зоны · 10⁶ + базовый.
function rrZoneFor(region, label, y) {
    if (region.axis) {
        const zn = Math.floor(y / 1000000);
        return { zone: zn, lon0: region.axis.lon0, fe: zn * 1000000 + region.axis.fe };
    }
    const zs = region.zones;
    let zn = label;
    if (!zn || !zs[zn]) zn = Math.floor(y / 1000000);
    if (!zs[zn]) {
        let best = null, bestD = 500000;
        Object.keys(zs).forEach(k => {
            const d = Math.abs(y - zs[k].fe);
            if (d < bestD) { bestD = d; best = k; }
        });
        zn = best;
    }
    return zs[zn] ? { zone: zn, lon0: zs[zn].lon0, fe: zs[zn].fe } : null;
}

function rrXmlToGeoJSON(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
        throw new Error('XML повреждён или имеет неверную структуру');
    }
    const root = doc.documentElement;
    const rec = Array.from(root.children).find(c => /_record$/.test(c.localName)) || root;

    // ----- атрибуты объекта (без персональных данных) -----
    const cad = rrText(rec, 'object/common_data/cad_number') || rrText(root, 'land_record/object/common_data/cad_number');
    const areaVal = rrNum(rrText(rec, 'params/area/value'));
    const inacc = rrNum(rrText(rec, 'params/area/inaccuracy'));
    const props = {
        source: 'rosreestr',
        cad_number: cad || (rrAll(root, 'cad_number')[0] || {}).textContent || '',
        object_type: rrText(rec, 'object/common_data/type/value'),
        subtype: rrText(rec, 'object/subtype/value'),
        category: rrText(rec, 'params/category/type/value'),
        permitted_use: rrText(rec, 'params/permitted_use/permitted_use_established/by_document')
            || rrText(rec, 'params/permitted_use/permitted_use_established/land_use/value')
            || rrText(rec, 'params/permitted_use/name'),
        area_type: rrText(rec, 'params/area/type/value'),
        area_m2: areaVal,
        area_inaccuracy_m2: inacc,
        cost_rub: rrNum(rrText(rec, 'cost/value')),
        address: rrText(rec, 'address_location/address/readable_address'),
        status: rrText(root, 'status'),
        extract_number: rrText(root, 'details_statement/group_top_requisites/registration_number'),
        extract_date: rrText(root, 'details_statement/group_top_requisites/date_formation'),
        encumbrances: rrAll(root, 'restrict_record').map(r => {
            const t = rrText(r, 'restrictions_encumbrances_data/restriction_encumbrance_type/value');
            const a = rrText(r, 'restrictions_encumbrances_data/period/period_info/start_date');
            const b = rrText(r, 'restrictions_encumbrances_data/period/period_info/end_date');
            return t ? t + (a || b ? ' (' + (a || '…') + ' — ' + (b || '…') + ')' : '') : '';
        }).filter(Boolean)
    };

    // ----- геометрия: все entity_spatial, внутри — кольца spatial_element -----
    const spatials = rrAll(root, 'entity_spatial').filter(e => rrAll(e, 'ordinate').length);
    if (!spatials.length) {
        throw new Error('В выписке нет координат границ (раздел с контурами отсутствует)');
    }

    const warnings = [];
    const features = [];
    let skLabel = '';
    let hasArcs = false;

    spatials.forEach((es, idx) => {
        const skText = rrText(es, 'sk_id');
        const sk = rrParseSk(skText);
        if (!sk) {
            throw new Error('Система координат «' + (skText || 'не указана') + '» пока не поддерживается: приложение читает местные системы координат МСК-XX субъектов РФ.');
        }
        const found = rrFindRegion(sk, skText);
        if (!found) {
            throw new Error('Для системы координат МСК-' + sk.code + ' в приложении ещё нет параметров пересчёта (регион не внесён в таблицу RR_MSK).');
        }
        const region = found.region;
        if (found.guessed) {
            const w = 'в выписке не указан размер зоны — для ' + region.name + ' принят вариант по умолчанию, проверьте положение на карте';
            if (warnings.indexOf(w) < 0) warnings.push(w);
        }
        skLabel = region.name;

        // кольца контура (плоские координаты МСК)
        const rings = rrAll(es, 'spatial_element').map(se => {
            const pts = rrAll(se, 'ordinate').map(o => {
                if (rrKids(o, 'r').length) hasArcs = true;
                return { x: rrNum(rrText(o, 'x')), y: rrNum(rrText(o, 'y')) };
            }).filter(p => p.x !== null && p.y !== null);
            const clean = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
            if (clean.length && (clean[0].x !== clean[clean.length - 1].x || clean[0].y !== clean[clean.length - 1].y)) {
                clean.push({ x: clean[0].x, y: clean[0].y });
            }
            return clean;
        }).filter(r => r.length >= 4);
        if (!rings.length) return;

        // самое большое кольцо — внешняя граница, остальные — вырезы
        rings.sort((p, q) => rrRingArea(q) - rrRingArea(p));
        const planarArea = rrRingArea(rings[0]) - rings.slice(1).reduce((s, r) => s + rrRingArea(r), 0);

        const coordinates = rings.map(r => r.map(p => {
            const zi = rrZoneFor(region, sk.zone, p.y);
            if (!zi) {
                throw new Error('Не удалось определить зону ' + region.name + ': Y = ' + p.y + ' (доступные зоны: ' + Object.keys(region.zones).join(', ') + ')');
            }
            let ll = rrMskToWgs84(p.x, p.y, region, zi);
            const b = region.bbox || RR_RU_BBOX;
            const inBox = q => {
                const lonN = q[0] < -90 ? q[0] + 360 : q[0];   // Чукотка за 180° меридианом
                return !(lonN < b[0] || lonN > b[2] || q[1] < b[1] || q[1] > b[3]);
            };
            // запасной ложный сдвиг X (fnAlt) — только если основной вывел точку за рамку
            if (!inBox(ll) && region.fnAlt !== undefined) {
                const alt = rrMskToWgs84(p.x, p.y, Object.assign({}, region, { fn: region.fnAlt }), zi);
                if (inBox(alt)) ll = alt;
            }
            if (!inBox(ll)) {
                throw new Error('Координаты вне ' + (region.bbox ? region.name : 'России') + ' после пересчёта (зона ' + zi.zone + '): проверьте систему координат выписки');
            }
            return [Math.round(ll[0] * 1e8) / 1e8, Math.round(ll[1] * 1e8) / 1e8];
        }));

        const contourEl = es.parentElement && es.parentElement.localName.toLowerCase() === 'contour' ? es.parentElement : null;
        const number = contourEl ? rrText(contourEl, 'number_pp') : '';
        features.push({
            type: 'Feature',
            properties: Object.assign({}, props, {
                contour: number || String(idx + 1),
                contour_count: spatials.length,
                contour_area_m2: Math.round(planarArea * 100) / 100
            }),
            geometry: { type: 'Polygon', coordinates }
        });
    });

    if (!features.length) throw new Error('В выписке не найдено ни одного замкнутого контура');
    if (hasArcs) warnings.push('в границе есть дуги окружностей — они заменены хордами');

    return { geojson: { type: 'FeatureCollection', features }, props, warnings, skLabel };
}

// Декодирование XML из байтов с учётом кодировки в заголовке <?xml ... encoding="..."?>
function rrDecodeXml(buf) {
    const head = new TextDecoder('latin1').decode(new Uint8Array(buf.slice(0, 200)));
    const m = /encoding\s*=\s*["']([\w\-]+)["']/i.exec(head);
    try {
        return new TextDecoder(m ? m[1].toLowerCase() : 'utf-8').decode(buf);
    } catch (e) {
        return new TextDecoder('utf-8').decode(buf);
    }
}

function rrFmtNum(v, digits) {
    return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: digits === undefined ? 2 : digits });
}

function rrPopupHtml(p) {
    const rows = [];
    const add = (label, value) => { if (value !== null && value !== undefined && value !== '') rows.push([label, value]); };
    add('Кадастровый номер', escapeHtml(p.cad_number));
    add('Тип объекта', escapeHtml([p.object_type, p.subtype].filter(Boolean).join(', ')));
    add('Категория земель', escapeHtml(p.category));
    add('Разрешённое использование', escapeHtml(p.permitted_use));
    if (p.area_m2 !== null && p.area_m2 !== undefined) {
        let a = rrFmtNum(p.area_m2, 2) + ' м² (' + rrFmtNum(p.area_m2 / 10000, 4) + ' га)';
        if (p.area_inaccuracy_m2) a += ' ± ' + rrFmtNum(p.area_inaccuracy_m2, 2);
        if (p.area_type) a += ', ' + p.area_type.toLowerCase();
        add('Площадь по выписке', escapeHtml(a));
    }
    if (p.contour_count > 1) {
        add('Контур ' + p.contour + ' из ' + p.contour_count, rrFmtNum(p.contour_area_m2, 2) + ' м²');
    }
    add('Кадастровая стоимость', p.cost_rub !== null && p.cost_rub !== undefined ? rrFmtNum(p.cost_rub, 2) + ' ₽' : '');
    add('Адрес', escapeHtml(p.address));
    add('Обременения', escapeHtml((p.encumbrances || []).join('; ')));
    add('Статус', escapeHtml(p.status));
    add('Выписка', escapeHtml([p.extract_number, p.extract_date].filter(Boolean).join(' от ')));
    return '<div style="font-size:12px;line-height:1.45;max-width:320px">'
        + '<div style="font-weight:700;margin-bottom:4px;color:#065f46">📄 Выписка из ЕГРН</div>'
        + '<table style="border-collapse:collapse">'
        + rows.map(r => '<tr><td style="color:#64748b;padding:1px 8px 1px 0;vertical-align:top;white-space:nowrap">' + r[0] + '</td><td style="font-weight:600">' + r[1] + '</td></tr>').join('')
        + '</table>'
        + '<div style="margin-top:5px;color:#94a3b8;font-size:10px">Границы пересчитаны из МСК в WGS84 (параметры ГОСТ 51794-2008) — для отображения на карте, не для кадастровых работ.</div>'
        + '</div>';
}

// Импорт: каждый контур участка — отдельный полигон в drawnItems (подпись площади, список, выбор — как у нарисованных)
function importRosreestrXml(xmlText) {
    let res;
    try {
        res = rrXmlToGeoJSON(xmlText);
    } catch (err) {
        showError('❌ ' + err.message);
        return;
    }
    objectLabels.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    objectLabels = [];
    drawnItems.clearLayers();
    disableEditForAll();
    const group = L.geoJSON(res.geojson, { style: SHAPE_STYLE });
    group.eachLayer(layer => {
        layer.bindPopup(rrPopupHtml(layer.feature.properties), { maxWidth: 340 });
        drawnItems.addLayer(layer);
    });
    map.fitBounds(group.getBounds());
    updateAllLabels();
    updateObjectList();
    const n = res.geojson.features.length;
    updateStatus('📂 Выписка Росреестра загружена: ' + res.props.cad_number + ', контуров: ' + n
        + ' (' + res.skLabel + ' → WGS84)' + (res.warnings.length ? '. Внимание: ' + res.warnings.join('; ') : ''));
}

// ---------- ЗАГРУЗКА ФАЙЛОВ ----------
document.getElementById('vectorFileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            let geojson;
            const ext = file.name.split('.').pop().toLowerCase();
            document.getElementById('vectorFileName').textContent = file.name;
            if (ext === 'kml') {
                const parser = new DOMParser();
                const kmlDoc = parser.parseFromString(ev.target.result, 'text/xml');
                geojson = toGeoJSON.kml(kmlDoc);
            } else if (ext === 'geojson' || ext === 'json') {
                geojson = JSON.parse(ev.target.result);
            } else if (ext === 'xlsx' || ext === 'xls') {
                const workbook = XLSX.read(ev.target.result, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet);
                const points = [];
                rows.forEach(row => {
                    const lon = parseFloat(row['X'] || row['Долгота'] || Object.values(row)[0]);
                    const lat = parseFloat(row['Y'] || row['Широта'] || Object.values(row)[1]);
                    if (!isNaN(lon) && !isNaN(lat)) {
                        points.push([lon, lat]);
                    }
                });
                if (points.length > 0) {
                    geojson = {
                        type: 'FeatureCollection',
                        features: [{
                            type: 'Feature',
                            geometry: { type: 'Polygon', coordinates: [points] },
                            properties: { name: 'Из Excel' }
                        }]
                    };
                } else {
                    updateStatus('Не найдены координаты в Excel', true);
                    return;
                }
            } else if (ext === 'xml') {
                importRosreestrXml(rrDecodeXml(ev.target.result));
                return;
            } else {
                updateStatus('Неподдерживаемый формат', true);
                return;
            }
            if (!geojson) {
                updateStatus('Ошибка парсинга файла', true);
                return;
            }
            drawnItems.clearLayers();
            objectLabels = [];
            disableEditForAll();
            const layer = L.geoJSON(geojson, {
                style: SHAPE_STYLE
            });
            drawnItems.addLayer(layer);
            map.fitBounds(layer.getBounds());
            updateAllLabels();
            updateObjectList();
            updateStatus('📂 Файл загружен!');
        } catch (err) {
            updateStatus('Ошибка: ' + err.message, true);
        }
    };
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || /\.xml$/i.test(file.name)) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
    this.value = '';
});

function geojsonToKml(geojson) {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Классификация земной поверхности</name>
    <Style id="polyStyle">
      <LineStyle><color>ff669e05</color><width>2.5</width></LineStyle>
      <PolyStyle><color>26669e05</color></PolyStyle>
    </Style>`;
    geojson.features.forEach((feature, i) => {
        const geom = feature.geometry;
        if (!geom) return;
        if (geom.type === 'Polygon') {
            const coords = geom.coordinates[0].map(c => `${c[0]},${c[1]},0`).join(' ');
            kml += `
    <Placemark>
      <name>Объект ${i+1}</name>
      <styleUrl>#polyStyle</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing><coordinates>${coords}</coordinates></LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(poly => {
                const coords = poly[0].map(c => `${c[0]},${c[1]},0`).join(' ');
                kml += `
    <Placemark>
      <name>Объект ${i+1}</name>
      <styleUrl>#polyStyle</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing><coordinates>${coords}</coordinates></LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
            });
        } else if (geom.type === 'Circle') {
            const center = geom.coordinates;
            kml += `
    <Placemark>
      <name>Круг ${i+1}</name>
      <styleUrl>#polyStyle</styleUrl>
      <Point>
        <coordinates>${center[0]},${center[1]},0</coordinates>
      </Point>
    </Placemark>`;
        } else if (geom.type === 'LineString') {
            const coords = geom.coordinates.map(c => `${c[0]},${c[1]},0`).join(' ');
            kml += `
    <Placemark>
      <name>Линия ${i+1}</name>
      <styleUrl>#polyStyle</styleUrl>
      <LineString>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`;
        }
    });
    kml += `\n  </Document>\n</kml>`;
    return kml;
}

// ============================================================
//  ИНТЕРФЕЙС КАРТЫ
// ============================================================

document.getElementById('zoomInBtn').addEventListener('click', () => map.zoomIn());
document.getElementById('zoomOutBtn').addEventListener('click', () => map.zoomOut());

document.getElementById('locateBtn').addEventListener('click', () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 14);
            updateStatus('📍 Местоположение определено');
            window.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            showUserLocality(pos.coords.latitude, pos.coords.longitude);
        }, () => updateStatus('Не удалось определить местоположение', true));
    }
});

// ---------- МОЁ МЕСТОПОЛОЖЕНИЕ ПРИ ЗАГРУЗКЕ + НАСЕЛЁННЫЙ ПУНКТ ПОД ПОИСКОМ (как в Яндекс Картах) ----------
const AUTO_LOCATE = {
    zoom: 12,           // масштаб карты после определения местоположения
    ipFallback: true    // если браузер не отдал координаты (нет разрешения, http, file://) — определить примерно по IP (сервис ipwho.is, без ключа)
};
const spLocEl = document.getElementById('spLoc');
const spLocNameEl = document.getElementById('spLocName');
const spLocRegionEl = document.getElementById('spLocRegion');

function setUserLocality(name, region, failed) {
    if (!spLocEl) return;
    spLocEl.classList.toggle('sp-loc-off', !!failed);
    spLocNameEl.textContent = name;
    spLocRegionEl.textContent = (region && region !== name) ? region : '';
}

// ---------- ПОГОДА РЯДОМ С НАЗВАНИЕМ ГОРОДА (Open-Meteo, без ключа) ----------
const spWxEl = document.getElementById('spWx');

// код погоды WMO → [значок, подпись, цвет значка]
function spWxInfo(code, isDay) {
    if (code === 0) return isDay ? ['fa-sun', 'Ясно', '#f59e0b'] : ['fa-moon', 'Ясно', '#6366f1'];
    if (code === 1 || code === 2) return isDay ? ['fa-cloud-sun', 'Малооблачно', '#f59e0b'] : ['fa-cloud-moon', 'Малооблачно', '#6366f1'];
    if (code === 3) return ['fa-cloud', 'Облачно', '#64748b'];
    if (code === 45 || code === 48) return ['fa-smog', 'Туман', '#94a3b8'];
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ['fa-cloud-rain', 'Дождь', '#3b82f6'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['fa-snowflake', 'Снег', '#38bdf8'];
    if (code >= 95) return ['fa-cloud-bolt', 'Гроза', '#7c3aed'];
    return ['fa-cloud', 'Облачно', '#64748b'];
}

async function loadUserWeather(lat, lng) {
    if (!spWxEl) return;
    try {
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day&timezone=auto`);
        const d = await resp.json();
        const c = d && d.current;
        if (!c || typeof c.temperature_2m !== 'number') throw new Error('нет данных о погоде');
        const t = Math.round(c.temperature_2m);
        const info = spWxInfo(c.weather_code, c.is_day === 1);
        const ico = spWxEl.querySelector('i');
        ico.className = 'fas ' + info[0];
        ico.style.color = info[2];
        spWxEl.querySelector('b').textContent = (t > 0 ? '+' : t < 0 ? '−' : '') + Math.abs(t) + '°';
        spWxEl.title = 'Сейчас: ' + info[1].toLowerCase() + ', ' + (t > 0 ? '+' : '') + t + ' °C';
        spWxEl.hidden = false;
    } catch (err) {
        spWxEl.hidden = true;   // нет связи с сервисом — просто не показываем
    }
}
setInterval(() => { if (window.userLoc) loadUserWeather(window.userLoc.lat, window.userLoc.lng); }, 15 * 60 * 1000);

// название населённого пункта по координатам (Nominatim)
async function showUserLocality(lat, lng) {
    if (!spLocEl) return;
    loadUserWeather(lat, lng);
    for (const z of [13, 10]) {
        try {
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=${z}&addressdetails=1&accept-language=ru`);
            const data = await resp.json();
            const a = (data && data.address) || {};
            const name = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || '';
            if (name) {
                setUserLocality(name, a.state || a.region || '');
                return;
            }
        } catch (err) { /* пробуем более крупный масштаб */ }
    }
    setUserLocality('Местоположение не определено', '', true);
}

async function locateByIp() {
    try {
        const resp = await fetch('https://ipwho.is/?lang=ru');
        const d = await resp.json();
        if (d && d.success !== false && typeof d.latitude === 'number' && typeof d.longitude === 'number') return d;
    } catch (err) { /* сервис недоступен */ }
    return null;
}

function autoDetectLocation() {
    if (!spLocEl) return;
    const viaIp = async () => {
        const d = AUTO_LOCATE.ipFallback ? await locateByIp() : null;
        if (!d) {
            setUserLocality('Местоположение не определено', '', true);
            return;
        }
        map.setView([d.latitude, d.longitude], AUTO_LOCATE.zoom);
        window.userLoc = { lat: d.latitude, lng: d.longitude };
        if (d.city) { setUserLocality(d.city, d.region || ''); loadUserWeather(d.latitude, d.longitude); }
        else showUserLocality(d.latitude, d.longitude);
        updateStatus('📍 Местоположение определено по IP (примерно)');
    };
    if (!navigator.geolocation) { viaIp(); return; }
    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        map.setView([lat, lng], AUTO_LOCATE.zoom);
        window.userLoc = { lat: lat, lng: lng };
        showUserLocality(lat, lng);
        updateStatus('📍 Местоположение определено');
    }, viaIp, { timeout: 8000, maximumAge: 600000 });
}

// ---------- ШТОРКА ----------
document.getElementById('toggleDrawerBtn').addEventListener('click', function() {
    const panel = document.getElementById('mainPanel');
    if (panel) {
        panel.classList.toggle('hidden');
        const collapsed = panel.classList.contains('hidden');
        this.innerHTML = collapsed ? '<i class="fas fa-chevron-right"></i>' : '<i class="fas fa-chevron-left"></i>';
        this.title = collapsed ? 'Развернуть панель' : 'Свернуть панель';
        setTimeout(() => map.invalidateSize(), 350);
    }
});

// ---------- МАСШТАБНАЯ ЛИНЕЙКА ----------
function updateScaleBar() {
    const zoom = map.getZoom();
    let scale = 0;
    if (zoom >= 18) scale = 10;
    else if (zoom >= 17) scale = 25;
    else if (zoom >= 16) scale = 50;
    else if (zoom >= 15) scale = 100;
    else if (zoom >= 14) scale = 200;
    else if (zoom >= 13) scale = 500;
    else if (zoom >= 12) scale = 1000;
    else if (zoom >= 11) scale = 2000;
    else if (zoom >= 10) scale = 5000;
    else if (zoom >= 9) scale = 10000;
    else scale = 20000;
    const text = scale >= 1000 ? (scale/1000).toFixed(0) + ' км' : scale + ' м';
    document.querySelector('.scale-text').textContent = text;
    document.querySelector('.scale-line').style.width = Math.min(scale / 100, 80) + 'px';
}

map.on('zoomend', updateScaleBar);
map.on('moveend', updateScaleBar);
setTimeout(updateScaleBar, 200);

// ============================================================
//  ПОВОРОТ КАРТЫ, КОНТЕКСТНОЕ МЕНЮ «ЧТО ЗДЕСЬ?»
// ============================================================
//  Правая кнопка мыши:
//    • короткий клик без движения  → меню «Что здесь?»
//    • зажать и двигать мышью      → поворот карты по сторонам света
// ============================================================

const ROTATE_SENSITIVITY = 0.4;   // градусов поворота на 1 px смещения мыши
const ROTATE_DRAG_THRESHOLD = 4;  // px, после которых жест считается поворотом

const northBtn = document.getElementById('northBtn');
const northArrow = document.getElementById('northArrow');
const mapContextMenu = document.getElementById('mapContextMenu');
const mapStageEl = document.getElementById('mapStage');

let rotateGesture = null;
let contextMenuLatLng = null;

function isRotationSupported() {
    return !!(map.options.rotate && typeof map.setBearing === 'function');
}

function getBearing() {
    return isRotationSupported() ? map.getBearing() : 0;
}

function updateNorthArrow() {
    const bearing = getBearing();
    northArrow.style.transform = `rotate(${bearing}deg)`;
    const rotated = Math.abs(bearing % 360) > 0.5 && Math.abs((bearing % 360) - 360) > 0.5;
    northBtn.classList.toggle('rotated', rotated);
}

northBtn.addEventListener('click', function() {
    if (!isRotationSupported()) {
        updateStatus('⚠️ Поворот карты недоступен (плагин не загружен)', true);
        return;
    }
    map.setBearing(0);
    updateStatus('🧭 Карта повёрнута на север');
});

if (isRotationSupported()) {
    map.on('rotate', updateNorthArrow);
}

// ---------- КОНТЕКСТНОЕ МЕНЮ ----------
function showMapContextMenu(originalEvent) {
    const rect = mapStageEl.getBoundingClientRect();
    if (typeof skHideCtx === 'function') skHideCtx();
    if (typeof skCtxMenuSync === 'function') skCtxMenuSync();   // отмена / повтор / очистка рисунков — только когда применимы
    mapContextMenu.style.display = 'block';
    const menuW = mapContextMenu.offsetWidth;
    const menuH = mapContextMenu.offsetHeight;
    const left = Math.min(originalEvent.clientX - rect.left, rect.width - menuW - 6);
    const top = Math.min(originalEvent.clientY - rect.top, rect.height - menuH - 6);
    mapContextMenu.style.left = Math.max(left, 4) + 'px';
    mapContextMenu.style.top = Math.max(top, 4) + 'px';
}

function hideMapContextMenu() {
    mapContextMenu.style.display = 'none';
}

// Браузерное меню на карте отключаем полностью
map.getContainer().addEventListener('contextmenu', e => e.preventDefault());

// Начало жеста
map.getContainer().addEventListener('mousedown', function(e) {
    if (e.button !== 2) return;
    hideMapContextMenu();
    rotateGesture = {
        startX: e.clientX,
        startBearing: getBearing(),
        moved: false,
        originalEvent: e
    };
});

// Поворот при движении с зажатой правой кнопкой
window.addEventListener('mousemove', function(e) {
    if (!rotateGesture) return;
    const dx = e.clientX - rotateGesture.startX;
    if (!rotateGesture.moved && Math.abs(dx) < ROTATE_DRAG_THRESHOLD) return;
    rotateGesture.moved = true;
    if (isRotationSupported()) {
        map.setBearing(rotateGesture.startBearing + dx * ROTATE_SENSITIVITY);
    }
});

// Окончание жеста: без движения → показываем меню «Что здесь?»
window.addEventListener('mouseup', function(e) {
    if (e.button !== 2 || !rotateGesture) return;
    const gesture = rotateGesture;
    rotateGesture = null;
    if (gesture.moved) {
        updateStatus(`🧭 Азимут карты: ${Math.round(getBearing())}°`);
        return;
    }
    const skHit = typeof skLayerFromTarget === 'function' ? skLayerFromTarget(e.target) : null;
    if (skHit && !(typeof m3d !== 'undefined' && m3d.active)) {   // правая кнопка на нарисованном объекте — меню действий
        skSelect(skHit);
        skShowCtx(e, 'menu');
        return;
    }
    contextMenuLatLng = map.mouseEventToLatLng(e);
    showMapContextMenu(e);
});

// Закрытие меню
document.addEventListener('mousedown', function(e) {
    if (e.button === 0 && !mapContextMenu.contains(e.target)) hideMapContextMenu();
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideMapContextMenu();
});
map.on('movestart zoomstart', hideMapContextMenu);

// ---------- ТОЧКА НА КАРТЕ + ПАНЕЛЬ «КООРДИНАТЫ И АДРЕС» ----------
// Общая для «Что здесь?» и для результатов поиска.
const geoCoordsEl = document.getElementById('geoCoords');
const geoAddressEl = document.getElementById('geoAddress');
const geoCoordsRow = document.getElementById('geoCoordsRow');
const geoAddressRow = document.getElementById('geoAddressRow');
const geoEmptyEl = document.getElementById('geoEmpty');
const geoCloseBtn = document.getElementById('geoCloseBtn');

let geoMarker = null;
let reverseRequestId = 0;
const geoState = { coords: '', address: '', addressReady: false };

function formatCoords(latlng) {
    return `${latlng.lat.toFixed(5)}°, ${latlng.lng.toFixed(5)}°`;
}

function createGeoMarker(latlng, kind) {
    const isSearch = kind === 'search';
    const bg = isSearch ? '#059669' : '#ef4444';
    const icon = isSearch ? 'fa-map-pin' : 'fa-question';
    const html = `<div style="background:${bg}; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; border:2px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.25);"><i class="fas ${icon}" style="font-size:12px;"></i></div>`;
    return L.marker(latlng, {
        icon: L.divIcon({ html, iconSize: [24, 24], className: 'custom-marker' }),
        interactive: false
    });
}

function renderGeoPanel(latlng, address, addressReady) {
    geoState.coords = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
    geoState.address = address;
    geoState.addressReady = addressReady;

    geoCoordsEl.textContent = formatCoords(latlng);
    geoAddressEl.textContent = address;
    geoEmptyEl.hidden = true;
    geoCoordsRow.hidden = false;
    geoAddressRow.hidden = false;
    geoCloseBtn.hidden = false;
}

// Показать точку: маркер на карте + данные в боковой панели
function showGeoPoint(latlng, kind, address, addressReady = true) {
    if (geoMarker) map.removeLayer(geoMarker);
    geoMarker = createGeoMarker(latlng, kind).addTo(map);
    renderGeoPanel(latlng, address, addressReady);
}

// Крестик: очистить панель и убрать точку с карты
function clearGeoPoint() {
    reverseRequestId++;   // отменяем ожидающий ответ геокодера
    if (geoMarker) {
        map.removeLayer(geoMarker);
        geoMarker = null;
    }
    geoState.coords = '';
    geoState.address = '';
    geoState.addressReady = false;
    geoCoordsEl.textContent = '';
    geoAddressEl.textContent = '';
    geoCoordsRow.hidden = true;
    geoAddressRow.hidden = true;
    geoCloseBtn.hidden = true;
    geoEmptyEl.hidden = false;
}

async function showWhatIsHere(latlng) {
    const requestId = ++reverseRequestId;
    showGeoPoint(latlng, 'here', 'Определение адреса…', false);

    let address;
    try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=18&addressdetails=1&accept-language=ru`);
        const data = await resp.json();
        address = (data && data.display_name) ? data.display_name : 'Адрес не найден';
    } catch (err) {
        address = 'Ошибка получения адреса';
    }

    if (requestId !== reverseRequestId) return; // точку убрали или выбрали другую
    renderGeoPanel(latlng, address, true);
    updateStatus(`📍 Что здесь: ${formatCoords(latlng)}`);
}

document.getElementById('ctxWhatHere').addEventListener('click', function(e) {
    e.stopPropagation();
    hideMapContextMenu();
    if (contextMenuLatLng) {
        showWhatIsHere(contextMenuLatLng);
    }
});

geoCloseBtn.addEventListener('click', function() {
    clearGeoPoint();
    updateStatus('🧹 Точка убрана с карты');
});

// ---------- КОПИРОВАНИЕ ----------
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // запасной вариант (file://, старые браузеры)
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        ta.remove();
        return ok;
    }
}

document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
        const kind = this.dataset.copy;
        if (kind === 'address' && !geoState.addressReady) return;
        const text = kind === 'coords' ? geoState.coords : geoState.address;
        if (!text) return;
        const ok = await copyToClipboard(text);
        const icon = this.querySelector('i');
        icon.className = ok ? 'fas fa-check' : 'fas fa-triangle-exclamation';
        this.classList.toggle('copied', ok);
        updateStatus(ok ? `📋 Скопировано: ${text}` : 'Не удалось скопировать', !ok);
        setTimeout(() => {
            icon.className = 'fas fa-copy';
            this.classList.remove('copied');
        }, 1200);
    });
});

// ---------- ОБНОВИТЬ КАРТУ ----------
document.getElementById('refreshMapBtn').addEventListener('click', function() {
    const btn = this;
    btn.classList.add('spinning');

    map.invalidateSize();
    currentTileLayer.redraw();
    redrawSwipeLayers();
    updateAllLabels();
    updateObjectList();
    updateScaleBar();

    setTimeout(() => btn.classList.remove('spinning'), 700);
    updateStatus('🔄 Карта обновлена');
});

// ---------- НА ВЕСЬ ЭКРАН ----------
const fullscreenBtn = document.getElementById('fullscreenBtn');

function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
    const root = document.querySelector('.map-container');   // область карты (карта + нижняя панель)
    try {
        if (!isFullscreen()) {
            const request = root.requestFullscreen || root.webkitRequestFullscreen;
            const result = request && request.call(root);
            if (result && result.catch) result.catch(() => updateStatus('⚠️ Не удалось включить полноэкранный режим', true));
        } else {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document);
        }
    } catch (err) {
        updateStatus('⚠️ Полноэкранный режим недоступен', true);
    }
}

function onFullscreenChange() {
    const on = isFullscreen();
    fullscreenBtn.classList.toggle('active', on);
    fullscreenBtn.title = on ? 'Выйти из полноэкранного режима' : 'На весь экран';
    fullscreenBtn.innerHTML = `<i class="fas ${on ? 'fa-compress' : 'fa-expand'}"></i>`;
    setTimeout(() => map.invalidateSize(), 150);
}

fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// ============================================================
//  ПОИСК АДРЕСОВ
// ============================================================

const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchBtn = document.getElementById('searchBtn');
let searchTimeout = null;

async function searchAddress(query) {
    if (query.length < 2) return [];
    try {
        const resp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8&addressdetails=1&accept-language=ru&countrycodes=ru`
        );
        const data = await resp.json();
        return data.map(item => ({
            name: item.display_name.split(',')[0] || item.display_name,
            address: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon)
        }));
    } catch {
        return [];
    }
}

let lastSearchItems = [];

function showSearchResults(items) {
    lastSearchItems = items;
    if (!items.length) {
        searchResults.innerHTML = '<div class="search-result-item" style="color:#94a3b8;">Ничего не найдено</div>';
        searchResults.classList.add('active');
        return;
    }
    searchResults.innerHTML = items.map((r, i) => `
        <div class="search-result-item" onclick="selectSearchResult(${i})">
            <div class="result-name">${escapeHtml(r.name)}</div>
            <div class="result-address">${escapeHtml(r.address)}</div>
        </div>
    `).join('');
    searchResults.classList.add('active');
}

function selectSearchResult(index) {
    const item = lastSearchItems[index];
    if (!item) return;
    searchResults.classList.remove('active');
    searchInput.value = '';
    map.setView([item.lat, item.lon], 16);
    reverseRequestId++;   // отменяем незавершённый запрос «Что здесь?»
    showGeoPoint(L.latLng(item.lat, item.lon), 'search', item.address);
    updateStatus(`📍 Найден: ${item.name}`);
}

window.selectSearchResult = selectSearchResult;

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    const query = this.value.trim();
    if (query.length < 2) {
        searchResults.classList.remove('active');
        return;
    }
    searchTimeout = setTimeout(async () => {
        const items = await searchAddress(query);
        showSearchResults(items);
    }, 300);
});

searchBtn.addEventListener('click', async function() {
    const query = searchInput.value.trim();
    if (query.length < 2) return;
    const items = await searchAddress(query);
    showSearchResults(items);
});

searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        searchBtn.click();
    }
});

document.addEventListener('click', function(e) {
    if (!searchResults.contains(e.target) && e.target !== searchInput && e.target !== searchBtn) {
        searchResults.classList.remove('active');
    }
});


// ============================================================
//  ИЗМЕРЕНИЯ (расстояние / площадь)
// ============================================================
//  Пока пользователь тянет мышь от точки к точке, «резиновая»
//  линия соединяет последнюю точку с курсором, а значение в
//  информационной панели пересчитывается на лету.
//  Двойной клик — завершить, следующий клик — новое измерение.
// ============================================================

const MEASURE_COLOR = '#059669';
let measureFinished = false;

function setMeasureChipsActive(mode) {
    document.querySelectorAll('#measurePanel .measure-chip').forEach(el => {
        el.classList.toggle('active', el.dataset.mode === mode);
    });
}

function activateMeasureMode(mode) {
    deactivateAllTools();
    deactivateMeasureMode();
    clearMeasurements();

    measureMode = mode;
    measureFinished = false;
    document.getElementById('measureBtn').classList.add('active');
    setMeasureChipsActive(mode);
    showMeasureToolbar(mode);

    map.on('click', measureMapClick);
    map.on('dblclick', measureMapDblClick);
    map.on('mousemove', measureMapMouseMove);
    map.doubleClickZoom.disable();   // двойной клик завершает измерение, а не зумит
    map.getContainer().style.cursor = 'crosshair';

    const modeName = mode === 'distance' ? 'расстояния' : 'площади';
    updateStatus(`📏 Режим измерения ${modeName} — кликайте на карте. Двойной клик — завершить.`);
}

function deactivateMeasureMode() {
    measureMode = null;
    measureFinished = false;
    document.getElementById('measureBtn').classList.remove('active');
    setMeasureChipsActive(null);

    map.off('click', measureMapClick);
    map.off('dblclick', measureMapDblClick);
    map.off('mousemove', measureMapMouseMove);
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = '';

    const toolbar = document.querySelector('.measure-toolbar');
    if (toolbar) {
        toolbar.remove();
    }
    measureInfoEl.style.display = 'none';

    // убираем временную «резиновую» линию, зафиксированные точки остаются на карте
    if (measurePointsArr.length > 0 && !measureFinished) {
        updateMeasureDisplay(true);
    }
}

function showMeasureToolbar(mode) {
    const oldToolbar = document.querySelector('.measure-toolbar');
    if (oldToolbar) {
        oldToolbar.remove();
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'measure-toolbar';
    toolbar.innerHTML = `
        <button class="toolbar-btn ${mode === 'distance' ? 'active' : ''}" data-mode="distance">
            <i class="fas fa-ruler"></i> Расстояние
        </button>
        <button class="toolbar-btn ${mode === 'area' ? 'active' : ''}" data-mode="area">
            <i class="fas fa-vector-square"></i> Площадь
        </button>
        <button class="toolbar-btn toolbar-close" id="measureCloseBtn">
            <i class="fas fa-times"></i>
        </button>
    `;
    document.querySelector('.map-stage').appendChild(toolbar);

    toolbar.querySelectorAll('.toolbar-btn[data-mode]').forEach(btn => {
        btn.addEventListener('click', function() {
            const newMode = this.dataset.mode;
            if (newMode === measureMode) return;
            clearMeasurements();
            deactivateMeasureMode();
            activateMeasureMode(newMode);
        });
    });

    toolbar.querySelector('#measureCloseBtn').addEventListener('click', function() {
        clearMeasurements();
        deactivateMeasureMode();
    });
}

function measureMapClick(e) {
    // после двойного клика следующий клик начинает новое измерение
    if (measureFinished) {
        clearMeasurements();
        measureFinished = false;
    }

    // второй клик двойного клика попадает в ту же точку — пропускаем его
    const lastPoint = measurePointsArr[measurePointsArr.length - 1];
    if (lastPoint) {
        const lastPx = map.latLngToContainerPoint(L.latLng(lastPoint[0], lastPoint[1]));
        if (lastPx.distanceTo(map.latLngToContainerPoint(e.latlng)) < 4) return;
    }

    measurePointsArr.push([e.latlng.lat, e.latlng.lng]);
    const marker = addMeasureMarker(e.latlng, measurePointsArr.length);
    measurePointsArr._markers = measurePointsArr._markers || [];
    measurePointsArr._markers.push(marker);

    if (measurePointsArr.length >= 2) {
        updateMeasureDisplay(false, e.latlng);
    } else {
        updateStatus(`📍 Точка ${measurePointsArr.length} добавлена. Кликните ещё для измерения.`);
    }
}

// «Резиновая» линия: от последней точки к курсору
function measureMapMouseMove(e) {
    if (!measureMode || measureFinished || measurePointsArr.length === 0) return;
    updateMeasureDisplay(false, e.latlng);
}

function measureMapDblClick() {
    const minPoints = measureMode === 'area' ? 3 : 2;
    if (measurePointsArr.length < minPoints) {
        updateStatus(`⚠️ Нужно минимум ${minPoints} точки для измерения`, true);
        return;
    }
    measureFinished = true;
    updateMeasureDisplay(true);
    updateStatus(`✅ Измерение завершено. ${measureMode === 'distance' ? 'Расстояние' : 'Площадь'} посчитана. Кликните, чтобы начать новое.`);
}

function addMeasureMarker(latlng, index) {
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'measure-marker',
            html: `<div style="background:${MEASURE_COLOR}; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:700; border:2px solid white; box-shadow:0 1px 4px rgba(0,0,0,0.3);">${index}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        }),
        interactive: false
    }).addTo(measureLayerGroup);
    marker._isMarker = true;
    return marker;
}

function measurePolylineLength(latlngs) {
    let total = 0;
    for (let i = 1; i < latlngs.length; i++) {
        total += haversineDistance(latlngs[i-1][1], latlngs[i-1][0], latlngs[i][1], latlngs[i][0]);
    }
    return total;
}

// Подпись прямо на карте (сегмент / общая длина / площадь).
// Это обычный маркер без флага _isMarker, поэтому он пересоздаётся
// вместе с линиями при каждом обновлении измерения.
function addMeasureLabel(latlng, text, kind) {
    return L.marker(latlng, {
        icon: L.divIcon({
            className: 'measure-label-icon',
            html: `<div class="ml ml-${kind}">${text}</div>`,
            iconSize: [0, 0]
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 500
    }).addTo(measureLayerGroup);
}

function formatMeasureDistance(km) {
    return km < 1 ? Math.round(km * 1000) + ' м' : km.toFixed(2) + ' км';
}

// finalize — зафиксированный результат; cursorLatLng — текущее положение курсора (превью)
function updateMeasureDisplay(finalize = false, cursorLatLng = null) {
    measureLayerGroup.eachLayer(layer => {
        if (!layer._isMarker) {
            measureLayerGroup.removeLayer(layer);
        }
    });

    const fixed = measurePointsArr.map(p => [p[0], p[1]]);
    if (fixed.length === 0) return;

    const cursor = (!finalize && cursorLatLng) ? [cursorLatLng.lat, cursorLatLng.lng] : null;
    const preview = cursor ? fixed.concat([cursor]) : fixed;

    if (measureMode === 'distance') {
        if (preview.length < 2) return;

        // зафиксированная часть
        if (fixed.length >= 2) {
            L.polyline(fixed, { color: MEASURE_COLOR, weight: 3, opacity: 0.85, interactive: false }).addTo(measureLayerGroup);
        }
        // «резиновая» линия до курсора
        if (cursor) {
            L.polyline([fixed[fixed.length - 1], cursor], {
                color: MEASURE_COLOR, weight: 3, opacity: 0.7, dashArray: '6,6', interactive: false
            }).addTo(measureLayerGroup);
        }

        // подписи длины на каждом отрезке (включая «резиновый» до курсора)
        for (let i = 1; i < preview.length; i++) {
            const a = preview[i - 1];
            const b = preview[i];
            const segKm = measurePolylineLength([a, b]);
            addMeasureLabel(
                L.latLng((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
                formatMeasureDistance(segKm),
                'seg'
            );
        }

        // общая длина — у последней точки (при рисовании — у курсора); при одном отрезке она равна ему
        if (preview.length >= 3) {
            const last = preview[preview.length - 1];
            addMeasureLabel(
                L.latLng(last[0], last[1]),
                'Всего: ' + formatMeasureDistance(measurePolylineLength(preview)),
                'total'
            );
        }
    } else if (measureMode === 'area') {
        if (preview.length >= 3) {
            const polygon = L.polygon(preview, {
                color: MEASURE_COLOR,
                weight: cursor ? 0 : 2.5,
                opacity: 0.8,
                fillColor: MEASURE_COLOR,
                fillOpacity: 0.12,
                interactive: false
            }).addTo(measureLayerGroup);

            const polyGeo = polygon.toGeoJSON();
            const area = turf.area(polyGeo.geometry) / 10000;

            // подпись в центре полигона (для вогнутых фигур — точка, гарантированно лежащая внутри)
            let c = turf.centroid(polyGeo).geometry.coordinates;
            if (!turf.booleanPointInPolygon(c, polyGeo)) {
                c = turf.pointOnFeature(polyGeo).geometry.coordinates;
            }
            addMeasureLabel(L.latLng(c[1], c[0]), area.toFixed(4) + ' га', 'area');
        }

        if (fixed.length >= 2) {
            L.polyline(fixed, { color: MEASURE_COLOR, weight: 2.5, opacity: 0.85, interactive: false }).addTo(measureLayerGroup);
        }
        // «резиновые» линии: последняя точка → курсор → первая точка
        if (cursor) {
            L.polyline([fixed[fixed.length - 1], cursor, fixed[0]], {
                color: MEASURE_COLOR, weight: 2.5, opacity: 0.7, dashArray: '6,6', interactive: false
            }).addTo(measureLayerGroup);
        }
    }
}

function showMeasureInfo(value, label) {
    measureInfoEl.innerHTML = `
        <span class="measure-label">${label}:</span>
        <span class="measure-value">${value}</span>
    `;
    measureInfoEl.style.display = 'block';
}

function clearMeasurements() {
    measureLayerGroup.clearLayers();
    measurePointsArr = [];
    measurePointsArr._markers = [];
    measureFinished = false;
    measureInfoEl.style.display = 'none';

    if (measureMode) {
        updateStatus(`📏 Режим измерения ${measureMode === 'distance' ? 'расстояния' : 'площади'} — кликайте на карте`);
    } else {
        updateStatus('🧹 Измерения очищены');
    }
}

function haversineDistance(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}


// ============================================================
//  НОВЫЕ ВИДЖЕТЫ: БАЗОВЫЕ КАРТЫ, СПУТНИКИ, ИЗМЕРЕНИЯ (по клику)
// ============================================================

let activePanel = null;

// Функция для переключения панели
function togglePanel(panelId, btnId) {
    const panel = document.getElementById(panelId);
    const btn = document.getElementById(btnId);
    
    if (activePanel === panelId) {
        panel.classList.remove('active');
        btn.classList.remove('active');
        activePanel = null;
        return;
    }
    
    if (activePanel) {
        document.getElementById(activePanel).classList.remove('active');
        document.querySelectorAll('.widget-btn').forEach(b => b.classList.remove('active'));
    }
    
    panel.classList.add('active');
    btn.classList.add('active');
    activePanel = panelId;
}

// Закрытие панели при клике вне неё
document.addEventListener('click', function(e) {
    const isWidget = e.target.closest('.side-widget');
    if (!isWidget) {
        document.querySelectorAll('.widget-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.widget-btn').forEach(b => b.classList.remove('active'));
        activePanel = null;
    }
});

// ---------- БАЗОВЫЕ КАРТЫ ----------
document.getElementById('baseLayersBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    togglePanel('baseLayersPanel', 'baseLayersBtn');
});

document.querySelectorAll('#baseLayersPanel .layer-chip').forEach(item => {
    item.addEventListener('click', function(e) {
        e.stopPropagation();
        const layerKey = this.dataset.layer;
        
        // Меняем слой
        switchLayer(layerKey);
        
        // Закрываем панель
        document.getElementById('baseLayersPanel').classList.remove('active');
        document.getElementById('baseLayersBtn').classList.remove('active');
        activePanel = null;
    });
});

// ---------- СПУТНИКОВЫЕ СНИМКИ ----------
document.getElementById('satelliteBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    togglePanel('satellitePanel', 'satelliteBtn');
});

document.querySelectorAll('#satellitePanel .layer-chip').forEach(item => {
    item.addEventListener('click', function(e) {
        e.stopPropagation();
        const layerKey = this.dataset.layer;
        
        // Меняем слой
        switchLayer(layerKey);
        
        // Закрываем панель
        document.getElementById('satellitePanel').classList.remove('active');
        document.getElementById('satelliteBtn').classList.remove('active');
        activePanel = null;
    });
});

// ---------- АНАЛИТИЧЕСКИЕ ПОДЛОЖКИ ----------
document.getElementById('analyticsBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    togglePanel('analyticsPanel', 'analyticsBtn');
});

document.querySelectorAll('#analyticsPanel .layer-chip').forEach(item => {
    item.addEventListener('click', function(e) {
        e.stopPropagation();
        const layerKey = this.dataset.layer;
        
        // Меняем слой
        switchLayer(layerKey);
        
        // Закрываем панель
        document.getElementById('analyticsPanel').classList.remove('active');
        document.getElementById('analyticsBtn').classList.remove('active');
        activePanel = null;
    });
});

// ---------- ИЗМЕРЕНИЯ ----------
document.getElementById('measureBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    togglePanel('measurePanel', 'measureBtn');
});

document.querySelectorAll('#measurePanel .measure-chip').forEach(item => {
    item.addEventListener('click', function(e) {
        e.stopPropagation();
        const mode = this.dataset.mode;
        
        if (mode === 'clear') {
            clearMeasurements();
            document.querySelectorAll('#measurePanel .measure-chip').forEach(el => {
                el.classList.remove('active');
            });
            document.getElementById('measurePanel').classList.remove('active');
            document.getElementById('measureBtn').classList.remove('active');
            activePanel = null;
            return;
        }
        
        if (measureMode === mode) {
            deactivateMeasureMode();
            document.querySelectorAll('#measurePanel .measure-chip').forEach(el => {
                el.classList.remove('active');
            });
            document.getElementById('measurePanel').classList.remove('active');
            document.getElementById('measureBtn').classList.remove('active');
            activePanel = null;
            return;
        }
        
        // Активируем режим измерения
        activateMeasureMode(mode);
        
        document.querySelectorAll('#measurePanel .measure-chip').forEach(el => {
            el.classList.toggle('active', el.dataset.mode === mode);
        });
        
        // Закрываем панель после выбора
        document.getElementById('measurePanel').classList.remove('active');
        document.getElementById('measureBtn').classList.remove('active');
        activePanel = null;
    });
});

// ============================================================
//  CSS ДЛЯ ВЕРШИН
// ============================================================

const editStyles = document.createElement('style');
editStyles.textContent = `
    .edit-vertex {
        background: transparent;
        border: none;
        cursor: pointer !important;
    }
    .edit-vertex:hover div {
        transform: scale(1.3);
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        cursor: pointer !important;
    }
    .edit-vertex div {
        cursor: pointer !important;
        transition: transform 0.15s, box-shadow 0.15s;
    }
    .leaflet-marker-icon.edit-vertex {
        cursor: pointer !important;
    }
    .edit-vertex * {
        cursor: pointer !important;
    }
`;
document.head.appendChild(editStyles);

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ
// ============================================================

function updateStatus(msg, isErr = false) {
    const statusEl = document.getElementById('statusMsg');
    if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.color = isErr ? '#ef4444' : '#e2e8f0';
        setTimeout(() => { statusEl.style.color = '#e2e8f0'; }, 3000);
    }
    console.log(msg);
}

// ============================================================
//  НИЖНЯЯ ПАНЕЛЬ
// ============================================================
//  «Главная» — легенда включённых аналитических слоёв (см. updateLayerLegend),
//  «Рисование» — виджет рисования (см. блок «ВИДЖЕТ РИСОВАНИЯ» ниже).
// ============================================================

document.getElementById('bottomPanelToggle').addEventListener('click', function() {
    const panel = document.getElementById('bottomPanel');
    panel.classList.toggle('collapsed');
    this.querySelector('i').className = panel.classList.contains('collapsed')
        ? 'fas fa-chevron-up'
        : 'fas fa-chevron-down';
    setTimeout(() => map.invalidateSize(), 300);
});

// Вкладки нижней панели
document.querySelectorAll('.bp-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        const id = this.dataset.bpTab;
        document.querySelectorAll('.bp-tab').forEach(t => {
            const on = t === this;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.bp-pane').forEach(p => {
            p.classList.toggle('active', p.dataset.bpPane === id);
        });
    });
});

// Карта подстраивается под любое изменение размера своей области
// (нижняя панель, шторка, полноэкранный режим)
if (window.ResizeObserver) {
    new ResizeObserver(() => map.invalidateSize()).observe(mapStageEl);
}

// ============================================================
//  ВКЛАДКИ БОКОВОЙ ПАНЕЛИ
// ============================================================

document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        const id = this.dataset.tab;
        document.querySelectorAll('.panel-tab').forEach(t => {
            const on = t === this;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.tab-pane').forEach(p => {
            p.classList.toggle('active', p.dataset.pane === id);
        });
    });
});

// ============================================================
//  ВИДЖЕТ «ШТОРКА» (как в ArcGIS)
// ============================================================
//  Карта делится подвижной вертикальной линией на две части.
//  Слева и справа работают две отдельные «тайловые» карты (по одной на сторону),
//  которые синхронизируются с основной картой (центр, масштаб, поворот).
//  Основная карта остаётся сверху и прозрачной: на ней рисование, объекты и измерения.
//  У каждой половины — свой виджет выбора подложки (базовые, спутник, аналитика).
//  При выключении шторки на основной карте остаётся подложка ЛЕВОЙ половины.
// ============================================================

const SWIPE_GROUPS = [
    { id: 'base',      icon: 'fa-map',        title: 'Базовые карты',          panel: 'baseLayersPanel' },
    { id: 'sat',       icon: 'fa-satellite',  title: 'Спутниковые снимки',     panel: 'satellitePanel' },
    { id: 'analytics', icon: 'fa-chart-area', title: 'Аналитические подложки', panel: 'analyticsPanel' }
];
const SWIPE_SIDE_NAMES = { left: 'слева', right: 'справа' };
const SWIPE_MIN_PX = 60;   // минимальная ширина любой половины

// Списки слоёв берём прямо из существующих панелей — новые чипы подхватываются автоматически
function getSwipeGroups() {
    return SWIPE_GROUPS.map(g => ({
        id: g.id,
        icon: g.icon,
        title: g.title,
        items: Array.from(document.querySelectorAll(`#${g.panel} .layer-chip`)).map(chip => ({
            key: chip.dataset.layer,
            label: (chip.querySelector('span') || {}).textContent || chip.dataset.layer,
            hint: chip.getAttribute('title') || ''
        }))
    }));
}

function getLayerMaxZoom(layer) {
    if (!layer) return 19;
    if (layer.options && typeof layer.options.maxZoom === 'number') return layer.options.maxZoom;
    if (typeof layer.getLayers === 'function') {
        const zs = layer.getLayers().map(getLayerMaxZoom);
        if (zs.length) return Math.min.apply(null, zs);
    }
    return 19;
}

// Тайловая карта одной половины (без интерактива — управляет ею основная карта)
function createSwipeMap(side) {
    const el = document.createElement('div');
    el.className = `swipe-map swipe-map-${side}`;
    mapStageEl.insertBefore(el, document.getElementById('map'));
    const opts = {
        zoomControl: false, attributionControl: false,
        dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false,
        boxZoom: false, keyboard: false, tap: false, inertia: false,
        zoomSnap: 0
    };
    if (isRotationSupported()) {
        Object.assign(opts, { rotate: true, bearing: getBearing(), rotateControl: false, touchRotate: false, shiftKeyRotate: false });
    }
    const m = L.map(el, opts);
    m.setView(map.getCenter(), map.getZoom(), { animate: false });
    return { map: m, el: el, layer: null, layerKey: null };
}

// Положение линии → обрезка половин и позиция виджетов
// В режиме дублирования обрезки нет: окна лежат рядом (левое — основная карта, правое — вторая карта)
function applySwipeClip() {
    if (!swipeState.active) return;
    const w = mapStageEl.clientWidth;
    const dual = swipeState.mode === 'dual';
    const x = Math.round((dual ? 0.5 : swipeState.frac) * w);
    const leftClip = dual ? 'none' : `inset(0 ${Math.max(w - x, 0)}px 0 0)`;
    const rightClip = dual ? 'none' : `inset(0 0 0 ${x}px)`;
    const setClip = (el, c) => { if (el) { el.style.clipPath = c; el.style.webkitClipPath = c; } };
    setClip(swipeState.sides.left.el, leftClip);
    setClip(swipeState.sides.right.el, rightClip);
    if (m3d.active) { setClip(document.getElementById('map3d'), leftClip); setClip(document.getElementById('map3dR'), rightClip); }
    swipeState.ui.style.setProperty('--swipe-x', x + 'px');
}

// Синхронизация половин с основной картой
function syncSwipeMaps(force) {
    if (!swipeState.active) return;
    if (!force && performance.now() < swipeState.holdUntil) return;
    const c = map.getCenter(), z = map.getZoom(), b = getBearing();
    const key = c.lat + '|' + c.lng + '|' + z + '|' + b;
    if (!force && key === swipeState.lastKey) return;
    swipeState.lastKey = key;
    ['left', 'right'].forEach(side => {
        const m = swipeState.sides[side].map;
        if (isRotationSupported() && typeof m.setBearing === 'function' && m.getBearing() !== b) m.setBearing(b);
        m.setView(c, z, { animate: false });
    });
}

function swipeTick() {
    if (!swipeState.active) return;
    syncSwipeMaps(false);
    swipeState.raf = requestAnimationFrame(swipeTick);
}

// Анимация масштаба: половины анимируются так же, как основная карта
map.on('zoomanim', function(e) {
    if (!swipeState.active) return;
    swipeState.holdUntil = performance.now() + 350;
    ['left', 'right'].forEach(side => {
        swipeState.sides[side].map.setView(e.center, e.zoom, { animate: true });
    });
});

if (window.ResizeObserver) {
    new ResizeObserver(() => {
        if (!swipeState.active) return;
        ['left', 'right'].forEach(side => swipeState.sides[side].map.invalidateSize({ animate: false }));
        applySwipeClip();
        syncSwipeMaps(true);
    }).observe(mapStageEl);
}

function redrawSwipeLayers() {
    if (!swipeState.active) return;
    ['left', 'right'].forEach(side => {
        const s = swipeState.sides[side];
        if (s && s.layer && s.layer.redraw) s.layer.redraw();
    });
}

// Основная карта не должна приближаться глубже, чем позволяют обе подложки
function applySwipeMaxZoom() {
    const l = swipeState.sides.left, r = swipeState.sides.right;
    if (!l || !r || !l.layer || !r.layer) return;
    map.setMaxZoom(Math.min(getLayerMaxZoom(l.layer), getLayerMaxZoom(r.layer)));
}

function updateSwipeLabels() {
    ['left', 'right'].forEach(side => {
        const els = swipeState.sideEls[side], s = swipeState.sides[side];
        if (!els || !s) return;
        els.label.textContent = LAYER_NAMES[s.layerKey] || s.layerKey || '';
    });
}

// Кнопки категорий на половинах шторки: миниатюра активной подложки группы,
// либо последней активной из этой группы, либо (до первого выбора) первой в списке.
function swipeGroupOf(key) {
    const g = SWIPE_GROUPS.find(g => document.querySelector(`#${g.panel} .layer-chip[data-layer="${key}"]`));
    return g ? g.id : null;
}

function updateSwipeCatButtons(side) {
    const els = swipeState.sideEls[side];
    if (!els) return;
    const groups = getSwipeGroups();
    els.root.querySelectorAll('.swipe-cat-btn').forEach(btn => {
        const group = groups.find(g => g.id === btn.dataset.cat);
        const key = swipeState.lastByGroup[side][btn.dataset.cat] || (group && group.items[0] && group.items[0].key);
        setBtnThumb(btn, key);
    });
}

function rememberSwipeLayer(side, key) {
    const gid = swipeGroupOf(key);
    if (gid) swipeState.lastByGroup[side][gid] = key;
    updateSwipeCatButtons(side);
}

function setSwipeLayer(side, key) {
    const s = swipeState.sides[side];
    if (!s || !layerFactories[key]) return;
    if (s.layer) s.map.removeLayer(s.layer);
    s.layer = layerFactories[key]().addTo(s.map);
    s.layerKey = key;
    rememberSwipeLayer(side, key);
    if (side === 'left') {
        // подложка левой половины становится «текущей» подложкой карты
        currentLayer = key;
        currentTileLayer = baseLayers[key];
        updateActiveChips(key);
    }
    if (m3d.active) { if (side === 'left') m3RebuildBasemap(); else m3RebuildBasemap2(); }   // подложка в 3D-окне
    applySwipeMaxZoom();
    updateSwipeLabels();
    updateLayerLegend();
    updateStatus(`↔️ Шторка (${SWIPE_SIDE_NAMES[side]}): ${LAYER_NAMES[key] || key}`);
}

// ---------- Виджеты выбора подложек на половинах ----------
function closeSwipeLists() {
    ['left', 'right'].forEach(side => {
        const els = swipeState.sideEls[side];
        if (!els) return;
        els.list.hidden = true;
        els.openCat = null;
        els.root.querySelectorAll('.swipe-cat-btn').forEach(b => b.classList.remove('active'));
    });
}

function renderSwipeList(side, groupId) {
    const els = swipeState.sideEls[side];
    const group = getSwipeGroups().find(g => g.id === groupId);
    if (!els || !group) return;
    const activeKey = swipeState.sides[side].layerKey;
    els.list.innerHTML = group.items.map(it => `
        <div class="layer-chip${it.key === activeKey ? ' active' : ''}" data-layer="${it.key}"${it.hint ? ` title="${it.hint}"` : ''}>
            <span>${it.label}</span>
            <div class="layer-thumb" data-thumb="${it.key}"></div>
        </div>`).join('');
    els.list.querySelectorAll('.layer-thumb').forEach(el => {
        const url = LAYER_THUMBS[el.dataset.thumb];
        if (url) el.style.backgroundImage = [].concat(url).map(u => `url("${u}")`).join(', ');
    });
}

function buildSwipeSide(side) {
    const root = document.createElement('div');
    root.className = `swipe-side swipe-side-${side}`;
    root.innerHTML = `
        <div class="swipe-side-bar">
            <span class="swipe-side-label"></span>
            ${getSwipeGroups().map(g => `
                <button type="button" class="swipe-cat-btn" data-cat="${g.id}" title="${g.title}">
                    <i class="fas ${g.icon}"></i>
                </button>`).join('')}
        </div>
        <div class="swipe-side-list" hidden></div>`;
    const els = {
        root: root,
        label: root.querySelector('.swipe-side-label'),
        list: root.querySelector('.swipe-side-list'),
        openCat: null
    };
    swipeState.sideEls[side] = els;
    updateSwipeCatButtons(side);

    root.querySelectorAll('.swipe-cat-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const cat = this.dataset.cat;
            const wasOpen = els.openCat === cat;
            closeSwipeLists();
            if (wasOpen) return;
            els.openCat = cat;
            renderSwipeList(side, cat);
            els.list.hidden = false;
            this.classList.add('active');
        });
    });

    els.list.addEventListener('click', function(e) {
        e.stopPropagation();
        const chip = e.target.closest('.layer-chip');
        if (!chip) return;
        setSwipeLayer(side, chip.dataset.layer);
        closeSwipeLists();
    });
    return root;
}

function bindSwipeDrag(divider) {
    let dragging = false;
    divider.addEventListener('pointerdown', function(e) {
        dragging = true;
        divider.classList.add('dragging');
        try { divider.setPointerCapture(e.pointerId); } catch (err) {}
        closeSwipeLists();
        e.preventDefault();
    });
    divider.addEventListener('pointermove', function(e) {
        if (!dragging) return;
        const rect = mapStageEl.getBoundingClientRect();
        if (!rect.width) return;
        const maxX = Math.max(rect.width - SWIPE_MIN_PX, SWIPE_MIN_PX);
        const x = Math.min(Math.max(e.clientX - rect.left, SWIPE_MIN_PX), maxX);
        swipeState.frac = x / rect.width;
        applySwipeClip();
    });
    const end = () => { dragging = false; divider.classList.remove('dragging'); };
    divider.addEventListener('pointerup', end);
    divider.addEventListener('pointercancel', end);
    divider.addEventListener('lostpointercapture', end);
}

function ensureSwipeUI() {
    if (swipeState.ui) { swipeState.ui.hidden = false; return; }
    const ui = document.createElement('div');
    ui.className = 'swipe-ui';
    ui.id = 'swipeUI';
    ui.innerHTML = `
        <div class="swipe-divider" id="swipeDivider">
            <div class="swipe-line"></div>
            <div class="swipe-grip">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
        </div>
        <button type="button" class="swipe-mode-btn" id="swipeModeBtn" title="Обычная шторка ⇄ две карты рядом (дублирование)"><i class="fas fa-table-columns"></i><span>Дублирование</span></button>`;
    ui.appendChild(buildSwipeSide('left'));
    ui.appendChild(buildSwipeSide('right'));
    mapStageEl.appendChild(ui);
    swipeState.ui = ui;
    bindSwipeDrag(ui.querySelector('#swipeDivider'));
    ui.querySelector('#swipeModeBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        setSwipeMode(swipeState.mode === 'dual' ? 'swipe' : 'dual');
    });
}

document.addEventListener('click', function(e) {
    if (swipeState.active && !e.target.closest('.swipe-side')) closeSwipeLists();
});

// ---------- Режим дублирования (две карты рядом) ----------
function swipeModeUI() {
    const dual = swipeState.mode === 'dual';
    mapStageEl.classList.toggle('swipe-dual', dual);
    if (!swipeState.ui) return;
    swipeState.ui.classList.toggle('dual', dual);
    const b = swipeState.ui.querySelector('#swipeModeBtn');
    if (b) { b.classList.toggle('on', dual); b.querySelector('span').textContent = dual ? 'Шторка' : 'Дублирование'; }
}

function setSwipeMode(mode) {
    if (!swipeState.active || swipeState.mode === mode) return;
    swipeState.mode = mode;
    swipeModeUI();
    map.invalidateSize({ animate: false });
    ['left', 'right'].forEach(side => swipeState.sides[side].map.invalidateSize({ animate: false }));
    if (m3d.active) [m3d.map, m3d.map2].forEach(m => { if (m) m.resize(); });
    applySwipeClip();
    syncSwipeMaps(true);
    updateStatus(mode === 'dual' ? '🗺️ Дублирование: две карты рядом, у каждой своя подложка' : '↔️ Обычная шторка');
}

// В режиме дублирования правое окно (Leaflet) тоже двигает и масштабирует общий вид
function bindDualRightControl(el) {
    let last = null;
    el.addEventListener('pointerdown', e => {
        if (swipeState.mode !== 'dual' || e.button !== 0) return;
        last = [e.clientX, e.clientY];
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener('pointermove', e => {
        if (!last) return;
        map.panBy([last[0] - e.clientX, last[1] - e.clientY], { animate: false });
        last = [e.clientX, e.clientY];
    });
    const end = () => { last = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => {
        if (swipeState.mode !== 'dual') return;
        e.preventDefault();
        map.setZoom(map.getZoom() + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
}

// ---------- Включение / выключение ----------
function activateSwipe() {
    if (swipeState.active) return;
    const leftKey = currentLayer;
    const rightKey = leftKey === 'esri_sat' ? 'google' : 'esri_sat';

    swipeState.prevMaxZoom = map.options.maxZoom;
    if (map.hasLayer(currentTileLayer)) map.removeLayer(currentTileLayer);   // тайлы теперь рисуют половины (в 3D — MapLibre)
    swipeState.active = true;
    mapStageEl.classList.add('swipe-active');

    swipeState.sides.left = createSwipeMap('left');
    swipeState.sides.right = createSwipeMap('right');
    bindDualRightControl(swipeState.sides.right.el);
    ensureSwipeUI();
    swipeState.mode = 'swipe';
    swipeModeUI();

    // память кнопок: левая половина продолжает основную карту, правая начинает с первых в списках
    swipeState.lastByGroup = { left: {}, right: {} };
    WIDGET_BTN_GROUPS.forEach(g => {
        if (lastLayerByWidget[g.btn]) swipeState.lastByGroup.left[g.group] = lastLayerByWidget[g.btn];
    });
    updateSwipeCatButtons('left');
    updateSwipeCatButtons('right');

    setSwipeLayer('left', leftKey);
    setSwipeLayer('right', rightKey);
    applySwipeClip();
    syncSwipeMaps(true);
    swipeState.raf = requestAnimationFrame(swipeTick);
    if (m3d.active) m3EnterSplit();   // 3D уже включён — второе 3D-окно

    document.getElementById('swipeBtn').classList.add('active');
    updateStatus('↔️ Шторка включена: выберите подложки слева и справа от линии');
}

function deactivateSwipe() {
    if (!swipeState.active) return;
    swipeState.active = false;
    cancelAnimationFrame(swipeState.raf);
    closeSwipeLists();
    if (swipeState.ui) swipeState.ui.hidden = true;

    ['left', 'right'].forEach(side => {
        const s = swipeState.sides[side];
        if (!s) return;
        s.map.remove();
        if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
    });
    swipeState.sides = {};
    mapStageEl.classList.remove('swipe-active');
    swipeState.mode = 'swipe';
    swipeModeUI();
    map.invalidateSize({ animate: false });

    // основная карта возвращает себе подложку (левой половины)
    map.options.maxZoom = swipeState.prevMaxZoom;
    currentTileLayer = baseLayers[currentLayer];
    if (m3d.active) m3DestroySplit(); else currentTileLayer.addTo(map);
    updateActiveChips(currentLayer);
    updateLayerLegend();

    document.getElementById('swipeBtn').classList.remove('active');
    updateStatus(`↔️ Шторка выключена. Подложка: ${LAYER_NAMES[currentLayer] || currentLayer}`);
}

document.getElementById('swipeBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    // закрываем открытые панели виджетов справа (кроме кнопки «Шторка» и активного режима измерений)
    document.querySelectorAll('.widget-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.widget-btn').forEach(b => {
        if (b.id === 'swipeBtn') return;
        if (b.id === 'measureBtn' && measureMode) return;
        if (b.id === 'mode3dBtn' && m3d.active) return;
        b.classList.remove('active');
    });
    activePanel = null;
    if (swipeState.active) deactivateSwipe(); else activateSwipe();
});

// ============================================================
//  ВИДЖЕТ «РИСОВАНИЕ» (нижняя панель → вкладка «Рисование»)
// ============================================================
//  Полноценный набор графики поверх карты (как в ArcGIS Experience Builder):
//  значки, точки, текст, линии, свободная линия, полигоны, прямоугольники, круги;
//  стили (цвет, толщина, прозрачность, пунктир, заливка, значок, текст),
//  выбор / перемещение / правка вершин, дубликат, порядок, undo/redo,
//  подписи размеров, список объектов и экспорт в GeoJSON.
//  Это ОТДЕЛЬНЫЙ слой (sketchItems): он не участвует в расчёте площади,
//  стоимости и классификации, которые работают с drawnItems.
// ============================================================

const SK_PALETTE = ['#059669', '#10b981', '#0ea5e9', '#2563eb', '#7c3aed', '#db2777', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#64748b', '#0f172a', '#ffffff'];

const SK_ICONS = [
    ['location-dot', 'Метка'], ['star', 'Звезда'], ['flag', 'Флаг'], ['house', 'Дом'],
    ['tree', 'Дерево'], ['seedling', 'Росток'], ['wheat-awn', 'Поле'], ['tractor', 'Трактор'],
    ['droplet', 'Вода'], ['fire', 'Огонь'], ['triangle-exclamation', 'Внимание'], ['bolt', 'Электричество'],
    ['industry', 'Промышленность'], ['warehouse', 'Склад'], ['school', 'Школа'], ['hospital', 'Больница'],
    ['car', 'Авто'], ['gas-pump', 'АЗС'], ['anchor', 'Якорь'], ['mountain', 'Гора'],
    ['camera', 'Камера'], ['tower-cell', 'Вышка'], ['circle-info', 'Информация'], ['circle-check', 'Готово']
];

const SK_KIND_NAMES = {
    point: 'Точка', icon: 'Значок', text: 'Текст', line: 'Линия',
    polygon: 'Полигон', rectangle: 'Прямоугольник', circle: 'Круг'
};
const SK_KIND_ICONS = {
    point: 'fas fa-circle-dot', icon: 'fas fa-location-dot', text: 'fas fa-font', line: 'fas fa-route',
    polygon: 'fas fa-draw-polygon', rectangle: 'fas fa-vector-square', circle: 'far fa-circle'
};
const SK_TOOL_HINTS = {
    icon: 'Значок: кликните на карте, чтобы поставить',
    point: 'Точка: кликните на карте, чтобы поставить',
    text: 'Текст: кликните на карте, чтобы разместить надпись',
    line: 'Линия: кликайте по точкам; Enter или клик по последней точке — завершить; Backspace — удалить точку',
    freeline: 'Свободная линия: зажмите левую кнопку мыши и ведите по карте',
    polygon: 'Полигон: кликайте по точкам; клик по первой точке или Enter — завершить',
    rectangle: 'Прямоугольник: нажмите и перетащите',
    circle: 'Круг: нажмите в центре и перетащите до нужного радиуса'
};

const sketchItems = new L.FeatureGroup();
map.addLayer(sketchItems);

const sketchState = {
    tool: null, handler: null, mode: 'select', selected: null,
    seq: 0, hist: ['[]'], hi: 0, justClicked: false,
    free: null, move: null, restoring: false,
    repeat: false, measure: false
};

// Текущий стиль (то, что показывают элементы управления). Для нового объекта копируется в него,
// у выбранного объекта загружается в элементы управления и правится «вживую».
const sketchStyle = {
    color: '#059669', weight: 3, opacity: 100, dash: 'solid', cap: 'round',
    fillOn: true, fillColor: '#10b981', fillOpacity: 25, radius: 7,
    iconName: 'location-dot', iconShape: 'pin', iconBg: '#ef4444', iconColor: '#ffffff', iconSize: 30,
    text: 'Текст', textSize: 16, textColor: '#0f172a', bold: true, italic: false,
    halo: true, haloColor: '#ffffff', textBg: false, textBgColor: '#ffffff'
};

// [id элемента, ключ стиля, тип значения]
const SK_CONTROLS = [
    ['skColor', 'color', 'str'], ['skWeight', 'weight', 'num'], ['skOpacity', 'opacity', 'num'],
    ['skDash', 'dash', 'str'], ['skCap', 'cap', 'str'],
    ['skFillOn', 'fillOn', 'bool'], ['skFillColor', 'fillColor', 'str'], ['skFillOpacity', 'fillOpacity', 'num'],
    ['skRadius', 'radius', 'num'],
    ['skIconShape', 'iconShape', 'str'], ['skIconBg', 'iconBg', 'str'], ['skIconColor', 'iconColor', 'str'], ['skIconSize', 'iconSize', 'num'],
    ['skText', 'text', 'str'], ['skTextSize', 'textSize', 'num'], ['skTextColor', 'textColor', 'str'],
    ['skBold', 'bold', 'bool'], ['skItalic', 'italic', 'bool'],
    ['skHalo', 'halo', 'bool'], ['skHaloColor', 'haloColor', 'str'],
    ['skTextBg', 'textBg', 'bool'], ['skTextBgColor', 'textBgColor', 'str']
];

const skEl = id => document.getElementById(id);

// ---------- ГЕНЕРАЦИЯ СТИЛЕЙ И ЗНАЧКОВ ----------
function skDashArray(s) {
    const w = Math.max(1, s.weight);
    switch (s.dash) {
        case 'dash':    return `${w * 4} ${w * 3}`;
        case 'dot':     return `1 ${w * 2}`;
        case 'dashdot': return `${w * 5} ${w * 2.5} 1 ${w * 2.5}`;
        case 'long':    return `${w * 8} ${w * 3}`;
        default:        return null;
    }
}

function skPathOptions(s, kind) {
    return {
        color: s.color,
        weight: s.weight,
        opacity: s.opacity / 100,
        dashArray: skDashArray(s),
        lineCap: s.dash === 'dot' ? 'round' : s.cap,
        lineJoin: 'round',
        fill: kind !== 'line' && (kind === 'point' ? true : s.fillOn),
        fillColor: s.fillColor,
        fillOpacity: s.fillOpacity / 100
    };
}

function skMakeIcon(s) {
    const size = s.iconSize;
    const fs = Math.round(size * 0.5);
    const glyph = `<i class="fas fa-${s.iconName}" style="color:${s.iconColor};font-size:${fs}px"></i>`;
    let html, w = size, h = size, ax = size / 2, ay = size / 2;
    if (s.iconShape === 'pin') {
        h = Math.round(size * 1.21);
        ay = h;
        html = `<div class="sk-ic sk-ic-pin" style="width:${size}px;height:${size}px;background:${s.iconBg}"><span class="sk-ic-in" style="transform:rotate(45deg)">${glyph}</span></div>`;
    } else if (s.iconShape === 'circle') {
        html = `<div class="sk-ic" style="width:${size}px;height:${size}px;background:${s.iconBg};border-radius:50%">${glyph}</div>`;
    } else if (s.iconShape === 'square') {
        html = `<div class="sk-ic" style="width:${size}px;height:${size}px;background:${s.iconBg};border-radius:6px">${glyph}</div>`;
    } else {
        html = `<div class="sk-ic sk-ic-plain" style="width:${size}px;height:${size}px"><i class="fas fa-${s.iconName}" style="color:${s.iconBg};font-size:${size}px"></i></div>`;
    }
    return L.divIcon({ className: 'sk-icon-wrap', html: html, iconSize: [w, h], iconAnchor: [ax, ay] });
}

function skMakeTextIcon(text, s) {
    const st = [
        `font-size:${s.textSize}px`,
        `color:${s.textColor}`,
        `font-weight:${s.bold ? 700 : 400}`,
        `font-style:${s.italic ? 'italic' : 'normal'}`
    ];
    if (s.halo) {
        const c = s.haloColor;
        st.push(`text-shadow:-1px -1px 0 ${c},1px -1px 0 ${c},-1px 1px 0 ${c},1px 1px 0 ${c},0 0 5px ${c}`);
    }
    if (s.textBg) st.push(`background:${s.textBgColor};padding:2px 7px;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.25)`);
    return L.divIcon({
        className: 'sk-text-wrap',
        html: `<div class="sk-text" style="${st.join(';')}">${escapeHtml(text)}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
    });
}

// ---------- СОЗДАНИЕ / СЕРИАЛИЗАЦИЯ ОБЪЕКТОВ ----------
const skClone = o => JSON.parse(JSON.stringify(o));
const skIsMarker = kind => kind === 'icon' || kind === 'text';

function skBuildLayer(o) {
    const s = o.style;
    let l;
    switch (o.kind) {
        case 'point':
            l = L.circleMarker(o.ll, Object.assign(skPathOptions(s, 'point'), { radius: s.radius }));
            break;
        case 'icon':
            l = L.marker(o.ll, { icon: skMakeIcon(s), keyboard: false, bubblingMouseEvents: true });
            break;
        case 'text':
            l = L.marker(o.ll, { icon: skMakeTextIcon(o.text, s), keyboard: false, bubblingMouseEvents: true });
            break;
        case 'line':
            l = L.polyline(o.pts, skPathOptions(s, 'line'));
            break;
        case 'polygon':
            l = L.polygon(o.pts, skPathOptions(s, 'polygon'));
            break;
        case 'rectangle':
            l = L.rectangle(o.b, skPathOptions(s, 'rectangle'));
            break;
        case 'circle':
            l = L.circle(o.ll, Object.assign(skPathOptions(s, 'circle'), { radius: o.r }));
            break;
        default:
            return null;
    }
    l._sk = { id: o.id, kind: o.kind, name: o.name, style: skClone(s), text: o.text || '' };
    return l;
}

const skLatLngsToArr = a => Array.isArray(a) ? a.map(skLatLngsToArr) : [a.lat, a.lng];

function skSerializeLayer(l) {
    const sk = l._sk;
    const o = { id: sk.id, kind: sk.kind, name: sk.name, style: sk.style, text: sk.text };
    if (sk.kind === 'point' || skIsMarker(sk.kind)) {
        const ll = l.getLatLng();
        o.ll = [ll.lat, ll.lng];
    } else if (sk.kind === 'circle') {
        const ll = l.getLatLng();
        o.ll = [ll.lat, ll.lng];
        o.r = l.getRadius();
    } else if (sk.kind === 'rectangle') {
        const b = l.getBounds();
        o.b = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    } else {
        o.pts = skLatLngsToArr(l.getLatLngs());
    }
    return o;
}

function skNextName(kind) {
    const n = sketchItems.getLayers().filter(l => l._sk.kind === kind).length + 1;
    return `${SK_KIND_NAMES[kind]} ${n}`;
}

function skRegister(l) {
    sketchItems.addLayer(l);
    l.on('click', skOnLayerClick);
    l.on('mousedown', skOnLayerDown);
    l.on('edit', skOnLayerEdit);
    skApplyMeasure(l);
}

// ---------- ПОДПИСИ РАЗМЕРОВ ----------
function skFmtDist(m) {
    return m < 1000 ? `${m.toFixed(m < 10 ? 1 : 0)} м` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} км`;
}
function skFmtArea(m2) {
    if (m2 < 10000) return `${m2.toFixed(m2 < 100 ? 1 : 0)} м²`;
    if (m2 < 1e6) return `${(m2 / 1e4).toFixed(2)} га`;
    return `${(m2 / 1e6).toFixed(2)} км²`;
}
function skMeasureText(l) {
    const k = l._sk.kind;
    try {
        if (k === 'line') {
            return 'Длина: ' + skFmtDist(turf.length(l.toGeoJSON(), { units: 'kilometers' }) * 1000);
        }
        if (k === 'polygon' || k === 'rectangle') {
            const gj = l.toGeoJSON();
            const p = turf.length(turf.polygonToLine(gj), { units: 'kilometers' }) * 1000;
            return `${skFmtArea(turf.area(gj))}<br>P: ${skFmtDist(p)}`;
        }
        if (k === 'circle') {
            const r = l.getRadius();
            return `R: ${skFmtDist(r)}<br>${skFmtArea(Math.PI * r * r)}`;
        }
    } catch (e) { /* пустая геометрия */ }
    return '';
}
function skApplyMeasure(l) {
    if (l.getTooltip && l.getTooltip()) l.unbindTooltip();
    if (!sketchState.measure) return;
    const txt = skMeasureText(l);
    if (txt) l.bindTooltip(txt, { permanent: true, direction: 'center', className: 'sk-measure-tip', opacity: 1 });
}

// ---------- ПРИМЕНЕНИЕ СТИЛЯ ----------
function skSetSelectedClass(l, on) {
    const el = l && l.getElement ? l.getElement() : null;
    if (el) el.classList.toggle('sk-selected', on);
}

function skApplyStyle(l) {
    const sk = l._sk, s = sk.style;
    if (sk.kind === 'icon') l.setIcon(skMakeIcon(s));
    else if (sk.kind === 'text') l.setIcon(skMakeTextIcon(sk.text, s));
    else {
        const o = skPathOptions(s, sk.kind);
        if (sk.kind === 'point') o.radius = s.radius;
        l.setStyle(o);
    }
    if (sketchState.selected === l) skSetSelectedClass(l, true);
}

function skApplyToSelected() {
    const l = sketchState.selected;
    if (!l) return;
    l._sk.style = skClone(sketchStyle);
    if (l._sk.kind === 'text') l._sk.text = (sketchStyle.text || '').trim() || 'Текст';
    skApplyStyle(l);
    skApplyMeasure(l);
}

// ---------- ИНТЕРФЕЙС: ЭЛЕМЕНТЫ УПРАВЛЕНИЯ ----------
function skReadControl(el, type) {
    if (type === 'bool') return el.checked;
    if (type === 'num') return parseFloat(el.value);
    return el.value;
}

function skWriteControl(el, type, val) {
    if (type === 'bool') el.checked = !!val;
    else el.value = val;
}

function skUpdateOutputs() {
    const set = (id, txt) => { const e = skEl(id); if (e) e.textContent = txt; };
    set('skWeightVal', sketchStyle.weight + ' px');
    set('skOpacityVal', sketchStyle.opacity + '%');
    set('skFillOpacityVal', sketchStyle.fillOpacity + '%');
    set('skRadiusVal', sketchStyle.radius + ' px');
    set('skIconSizeVal', sketchStyle.iconSize + ' px');
    set('skTextSizeVal', sketchStyle.textSize + ' px');
    document.querySelectorAll('.dw-icon-btn').forEach(b => b.classList.toggle('active', b.dataset.icon === sketchStyle.iconName));
    document.querySelectorAll('.dw-swatches').forEach(box => {
        const cur = (skEl(box.dataset.target) || {}).value;
        box.querySelectorAll('.dw-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === cur));
    });
}

function skLoadStyleToUI(sk) {
    Object.assign(sketchStyle, sk.style);
    if (sk.kind === 'text') sketchStyle.text = sk.text;
    SK_CONTROLS.forEach(([id, key, type]) => { const el = skEl(id); if (el) skWriteControl(el, type, sketchStyle[key]); });
    skUpdateOutputs();
}

function skUpdateRelevance() {
    let kind = sketchState.selected ? sketchState.selected._sk.kind : (sketchState.tool === 'freeline' ? 'line' : sketchState.tool);
    if (['point', 'line', 'polygon', 'rectangle', 'circle', 'icon', 'text'].indexOf(kind) === -1) kind = null;
    // параметры показываются только для выбранного инструмента / фигуры; остальные блоки скрыты
    document.querySelectorAll('.dw-block[data-for]').forEach(b => {
        b.classList.toggle('dw-dim', !kind || b.dataset.for.split(' ').indexOf(kind) === -1);
    });
    const skHint = document.getElementById('skHint');
    if (skHint) skHint.hidden = !!kind;
}

function skUpdateButtons() {
    const sel = sketchState.selected;
    const n = sketchItems.getLayers().length;
    const dis = (act, off) => { const b = document.querySelector(`[data-sk-act="${act}"]`); if (b) b.disabled = off; };
    dis('undo', sketchState.hi <= 0);
    dis('redo', sketchState.hi >= sketchState.hist.length - 1);
    dis('duplicate', !sel);
    dis('delete', !sel);
    dis('front', !sel);
    dis('back', !sel);
    dis('clear', n === 0);
    dis('export', n === 0);
    document.querySelectorAll('[data-sk-tool]').forEach(b => b.classList.toggle('active', b.dataset.skTool === sketchState.tool));
    document.querySelectorAll('[data-sk-mode]').forEach(b => b.classList.toggle('active', !sketchState.tool && b.dataset.skMode === sketchState.mode));
    const badge = skEl('skCount');
    if (badge) badge.textContent = n;
    skUpdateRelevance();
}

function skRenderList() {
    const box = skEl('skList');
    if (!box) return;
    const layers = sketchItems.getLayers();
    if (!layers.length) {
        box.innerHTML = '';
        skUpdateButtons();
        return;
    }
    box.innerHTML = layers.map(l => {
        const sk = l._sk;
        const label = sk.kind === 'text' ? `«${escapeHtml(sk.text)}»` : escapeHtml(sk.name);
        return `<div class="dw-item${sketchState.selected === l ? ' active' : ''}" data-id="${sk.id}">
            <i class="${SK_KIND_ICONS[sk.kind]}"></i>
            <span class="dw-item-name">${label}</span>
            <button class="dw-item-btn" data-item-act="zoom" title="Показать на карте"><i class="fas fa-crosshairs"></i></button>
            <button class="dw-item-btn" data-item-act="del" title="Удалить"><i class="fas fa-xmark"></i></button>
        </div>`;
    }).join('');
    skUpdateButtons();
}

// ---------- ИСТОРИЯ (отменить / повторить) ----------
function skCommit() {
    if (sketchState.restoring) return;
    const snap = JSON.stringify(sketchItems.getLayers().map(skSerializeLayer));
    sketchState.hist = sketchState.hist.slice(0, sketchState.hi + 1);
    sketchState.hist.push(snap);
    if (sketchState.hist.length > 80) sketchState.hist.shift();
    sketchState.hi = sketchState.hist.length - 1;
    skUpdateButtons();
}

function skRestore(i) {
    sketchState.restoring = true;
    skSelect(null);
    sketchItems.clearLayers();
    JSON.parse(sketchState.hist[i]).forEach(o => {
        const l = skBuildLayer(o);
        if (l) {
            sketchState.seq = Math.max(sketchState.seq, o.id);
            skRegister(l);
        }
    });
    sketchState.restoring = false;
    skRenderList();
}

function skUndo() {
    if (sketchState.hi <= 0) return;
    sketchState.hi--;
    skRestore(sketchState.hi);
    updateStatus('↩️ Действие отменено');
}
function skRedo() {
    if (sketchState.hi >= sketchState.hist.length - 1) return;
    sketchState.hi++;
    skRestore(sketchState.hi);
    updateStatus('↪️ Действие повторено');
}

// ---------- ВЫДЕЛЕНИЕ И РЕЖИМЫ ----------
let skVx = null;   // редактор вершин выбранной фигуры (общий с разделами NDVI: перетаскивание, добавление и удаление вершин)
function skStartEdit(l) {
    skStopEdit();
    if (!l || !l._sk || skIsMarker(l._sk.kind) || l._sk.kind === 'point') return;
    skVx = gcVx(l, { onChange: (lay, fin) => { skApplyMeasure(lay); if (fin) skCommit(); } });
}
function skStopEdit() {
    if (skVx) { skVx.destroy(); skVx = null; }
}

function skSelect(l) {
    const prev = sketchState.selected;
    if (prev === l) return;
    sketchState.mode = (l && l._sk && !skIsMarker(l._sk.kind) && l._sk.kind !== 'point') ? 'edit' : 'select';   // у линий и фигур сразу видны вершины (как в «Анализе участка»)
    skHideCtx();
    if (prev) {
        skStopEdit(prev);
        skSetSelectedClass(prev, false);
    }
    sketchState.selected = l;
    if (l) {
        skSetSelectedClass(l, true);
        skLoadStyleToUI(l._sk);
        if (sketchState.mode === 'edit') skStartEdit(l);
    }
    skRenderList();
}

function skSetMode(mode) {
    skCancelTool();
    sketchState.mode = mode;
    const sel = sketchState.selected;
    if (sel) {
        if (mode === 'edit') skStartEdit(sel); else skStopEdit(sel);
    }
    skUpdateButtons();
    const hints = {
        select: 'Выбор: кликните по нарисованному объекту, чтобы изменить его стиль',
        move: 'Перемещение: перетащите объект мышью',
        edit: 'Правка вершин: выберите линию, полигон, прямоугольник или круг и тяните маркеры'
    };
    updateStatus('✏️ ' + hints[mode]);
}

function skOnLayerClick(e) {
    sketchState.justClicked = true;
    setTimeout(() => { sketchState.justClicked = false; }, 0);
    if (sketchState.tool) return;
    if (window.gcProfileBusy && window.gcProfileBusy()) return;   // идёт рисование на вкладке «Профиль»
    skSelect(e.target);
    if (e.originalEvent) skShowCtx(e.originalEvent, 'bar');   // действия — прямо на карте
}

function skOnLayerEdit(e) {
    const l = e.target || e.layer;
    if (!l || !l._sk) return;
    skApplyMeasure(l);
    skCommit();
}

// Используется основным обработчиком клика по карте (чтобы не выделять территорию под графикой)
function sketchIsBusy() {
    return !!sketchState.tool || sketchState.justClicked;
}

// ---------- ДЕЙСТВИЯ С ОБЪЕКТОМ ПРЯМО НА КАРТЕ ----------
// Клик по нарисованному объекту — рядом появляется панель значков; правая кнопка на объекте — то же меню с подписями;
// правая кнопка на пустой карте — отмена / повтор / очистка / экспорт (пункты добавлены в общее контекстное меню).
function skHideCtx() {
    const el = document.getElementById('skCtx');
    if (el) el.style.display = 'none';
}

function skLayerFromTarget(t) {
    if (!t || !t.nodeType) return null;
    const ls = sketchItems.getLayers();
    for (let i = 0; i < ls.length; i++) {
        const l = ls[i];
        if ((l._path && l._path.contains(t)) || (l._icon && l._icon.contains(t))) return l;
    }
    return null;
}

function skActions(l) {
    const k = l._sk.kind, mode = sketchState.mode, acts = [];
    const isLine = k === 'line', isArea = k === 'polygon' || k === 'rectangle' || k === 'circle';
    acts.push({ id: 'move', icon: 'up-down-left-right', label: 'Двигать', on: mode === 'move', keep: true, fn: () => skSetMode(mode === 'move' ? 'select' : 'move') });
    if (!skIsMarker(k) && k !== 'point') acts.push({ id: 'edit', icon: 'pen-to-square', label: 'Править вершины', on: mode === 'edit', keep: true, fn: () => skSetMode(mode === 'edit' ? 'select' : 'edit') });
    acts.push({ id: 'dup', icon: 'clone', label: 'Копия', fn: skDuplicate });
    acts.push({ id: 'front', icon: 'arrow-up', label: 'На передний план', fn: () => skReorder(true) });
    acts.push({ id: 'back', icon: 'arrow-down', label: 'На задний план', fn: () => skReorder(false) });
    if (isLine || isArea) acts.push({ id: 'prof', icon: 'mountain', label: 'Профиль рельефа', fn: () => { if (window.gcPfFromSelected) window.gcPfFromSelected(); } });
    if (isArea) acts.push({ id: 'hyp', icon: 'chart-area', label: 'Гипсометрия', fn: () => { if (window.gcHyFromSelected) window.gcHyFromSelected(); } });
    acts.push({ id: 'del', icon: 'trash', label: 'Удалить', danger: true, fn: () => skDeleteLayer(sketchState.selected) });
    return acts;
}

function skRenderCtx(kind) {
    const el = document.getElementById('skCtx'), l = sketchState.selected;
    if (!el || !l) return;
    kind = kind || el.dataset.kind || 'bar';
    el.dataset.kind = kind;
    el.className = 'sk-ctx sk-' + kind;
    el.innerHTML = skActions(l).map(a => `<button type="button" class="sk-act${a.on ? ' on' : ''}${a.danger ? ' danger' : ''}" data-act="${a.id}" title="${a.label}"><i class="fas fa-${a.icon}"></i>${kind === 'menu' ? '<span>' + a.label + '</span>' : ''}</button>`).join('');
}

function skShowCtx(ev, kind) {
    const el = document.getElementById('skCtx');
    if (!el || !sketchState.selected || !ev) return;
    hideMapContextMenu();
    skRenderCtx(kind);
    el.style.display = 'flex';
    const rect = mapStageEl.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let left = ev.clientX - rect.left + (kind === 'menu' ? 2 : -w / 2);
    let top = ev.clientY - rect.top + (kind === 'menu' ? 2 : -h - 14);
    if (kind !== 'menu' && top < 6) top = ev.clientY - rect.top + 18;
    left = Math.max(6, Math.min(left, rect.width - w - 6));
    top = Math.max(6, Math.min(top, rect.height - h - 6));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
}

// пункты рисунков в общем контекстном меню (правый клик по пустой карте)
function skCtxMenuSync() {
    const n = sketchItems.getLayers().length, in3d = typeof m3d !== 'undefined' && m3d.active;
    const vis = {
        ctxSkUndo: !in3d && sketchState.hi > 0,
        ctxSkRedo: !in3d && sketchState.hi < sketchState.hist.length - 1,
        ctxSkClear: !in3d && n > 0,
        ctxSkExport: !in3d && n > 0
    };
    let any = false;
    Object.keys(vis).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = vis[id] ? '' : 'none';
        any = any || vis[id];
    });
    const sep = document.getElementById('ctxSkSep');
    if (sep) sep.style.display = any ? '' : 'none';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') skHideCtx(); });
map.on('movestart zoomstart', skHideCtx);

// ---------- ПЕРЕМЕЩЕНИЕ ----------
function skShiftLL(ll, delta, z) {
    const p = map.project(L.latLng(ll[0], ll[1]), z).add(delta);
    const r = map.unproject(p, z);
    return [r.lat, r.lng];
}
function skShiftArr(a, delta, z) {
    return typeof a[0] === 'number' ? skShiftLL(a, delta, z) : a.map(x => skShiftArr(x, delta, z));
}

function skOnLayerDown(e) {
    if (sketchState.mode !== 'move' || sketchState.tool) return;
    if (e.originalEvent && e.originalEvent.button !== 0) return;
    const l = e.target;
    skSelect(l);
    skHideCtx();
    map.dragging.disable();
    sketchState.move = { layer: l, start: e.latlng, orig: skSerializeLayer(l), moved: false };
    map.on('mousemove', skMoveDrag);
    document.addEventListener('mouseup', skMoveEnd, { once: true });
}

function skMoveDrag(e) {
    const m = sketchState.move;
    if (!m) return;
    const z = map.getZoom();
    const delta = map.project(e.latlng, z).subtract(map.project(m.start, z));
    const o = m.orig, l = m.layer;
    if (o.pts) l.setLatLngs(skShiftArr(o.pts, delta, z));
    else if (o.b) l.setBounds(L.latLngBounds(skShiftLL(o.b[0], delta, z), skShiftLL(o.b[1], delta, z)));
    else if (o.ll) l.setLatLng(skShiftLL(o.ll, delta, z));
    m.moved = true;
    skApplyMeasure(l);
    skSetSelectedClass(l, true);
}

function skMoveEnd() {
    const m = sketchState.move;
    map.off('mousemove', skMoveDrag);
    map.dragging.enable();
    sketchState.move = null;
    if (m && m.moved) {
        skApplyMeasure(m.layer);
        skCommit();
    }
}

// ---------- ИНСТРУМЕНТЫ РИСОВАНИЯ ----------
function skCancelTool() {
    if (!sketchState.tool && !sketchState.handler) return;
    if (sketchState.handler) {
        sketchState.handler.disable();
        sketchState.handler = null;
    }
    map.off('click', skMapPlace);
    map.off('mousedown', skFreeDown);
    if (sketchState.free) skFreeAbort();
    sketchState.tool = null;
    map.getContainer().style.cursor = '';
    skUpdateButtons();
}

function skActivateTool(tool) {
    if (sketchState.tool === tool) {
        skCancelTool();
        updateStatus('🔧 Инструмент рисования отключён');
        return;
    }
    if (measureMode) deactivateMeasureMode();
    deactivateAllTools();     // выключает инструменты территории и (через хук) прошлый инструмент графики
    skCancelTool();
    skSelect(null);
    sketchState.tool = tool;
    map.getContainer().style.cursor = 'crosshair';

    if (tool === 'point' || tool === 'icon' || tool === 'text') {
        map.on('click', skMapPlace);
    } else if (tool === 'freeline') {
        map.on('mousedown', skFreeDown);
    } else {
        const so = skPathOptions(sketchStyle, tool);
        let h;
        if (tool === 'line') h = new L.Draw.Polyline(map, { shapeOptions: so, metric: true, showLength: true });
        else if (tool === 'polygon') h = new L.Draw.Polygon(map, { allowIntersection: true, showArea: false, shapeOptions: so });
        else if (tool === 'rectangle') h = new L.Draw.Rectangle(map, { shapeOptions: so, showArea: false });
        else if (tool === 'circle') h = new L.Draw.Circle(map, { shapeOptions: so, showRadius: true });
        if (h) {
            h.enable();
            sketchState.handler = h;
        }
    }
    skUpdateButtons();
    updateStatus('🖊️ ' + SK_TOOL_HINTS[tool]);
}

// Точка / значок / текст — по клику
function skMapPlace(e) {
    const kind = sketchState.tool;
    if (!kind) return;
    const text = kind === 'text' ? ((sketchStyle.text || '').trim() || 'Текст') : '';
    const l = skBuildLayer({
        id: ++sketchState.seq, kind: kind, name: skNextName(kind),
        style: sketchStyle, text: text, ll: [e.latlng.lat, e.latlng.lng]
    });
    if (!l) return;
    skRegister(l);
    skCommit();
    skRenderList();
    if (!sketchState.repeat) {
        skCancelTool();
        skSelect(l);
        updateStatus(`✅ ${SK_KIND_NAMES[kind]} добавлен(а)`);
    }
}

// Фигуры Leaflet.Draw (линия, полигон, прямоугольник, круг): вызывается из общего обработчика CREATED
function skOnCreated(e) {
    if (!sketchState.handler) return false;
    const tool = sketchState.tool;
    const l = e.layer;
    l._sk = { id: ++sketchState.seq, kind: tool, name: skNextName(tool), style: skClone(sketchStyle), text: '' };
    skRegister(l);
    skCommit();
    const again = sketchState.repeat;
    skCancelTool();
    skRenderList();
    if (again) {
        setTimeout(() => skActivateTool(tool), 0);
    } else {
        skSelect(l);
        updateStatus(`✅ ${SK_KIND_NAMES[tool]} создан(а)`);
    }
    return true;
}

// Свободная линия
function skFreeDown(e) {
    if (sketchState.tool !== 'freeline') return;
    if (e.originalEvent && e.originalEvent.button !== 0) return;
    map.dragging.disable();
    sketchState.free = {
        pts: [e.latlng],
        line: L.polyline([e.latlng], skPathOptions(sketchStyle, 'line')).addTo(map)
    };
    map.on('mousemove', skFreeMove);
    document.addEventListener('mouseup', skFreeUp, { once: true });
}

function skFreeMove(e) {
    const f = sketchState.free;
    if (!f) return;
    const last = f.pts[f.pts.length - 1];
    if (map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(e.latlng)) < 3) return;
    f.pts.push(e.latlng);
    f.line.setLatLngs(f.pts);
}

function skFreeAbort() {
    const f = sketchState.free;
    map.off('mousemove', skFreeMove);
    document.removeEventListener('mouseup', skFreeUp);
    map.dragging.enable();
    if (f) map.removeLayer(f.line);
    sketchState.free = null;
}

function skFreeUp() {
    const f = sketchState.free;
    map.off('mousemove', skFreeMove);
    map.dragging.enable();
    sketchState.free = null;
    if (!f) return;
    map.removeLayer(f.line);
    if (f.pts.length < 2) return;
    let pts = f.pts.map(p => [p.lat, p.lng]);
    try {
        const tol = (360 / (256 * Math.pow(2, map.getZoom()))) * 1.2;
        const simp = turf.simplify(turf.lineString(pts.map(p => [p[1], p[0]])), { tolerance: tol, highQuality: false });
        if (simp.geometry.coordinates.length >= 2) pts = simp.geometry.coordinates.map(c => [c[1], c[0]]);
    } catch (err) { /* оставляем исходные точки */ }
    const l = skBuildLayer({ id: ++sketchState.seq, kind: 'line', name: skNextName('line'), style: sketchStyle, pts: pts });
    skRegister(l);
    skCommit();
    skRenderList();
    if (!sketchState.repeat) {
        skCancelTool();
        skSelect(l);
        updateStatus('✅ Линия создана');
    }
}

// ---------- ДЕЙСТВИЯ ----------
function skDeleteLayer(l) {
    if (!l) return;
    if (sketchState.selected === l) skSelect(null);
    sketchItems.removeLayer(l);
    skCommit();
    skRenderList();
    updateStatus('🗑️ Объект удалён');
}

function skDuplicate() {
    const l = sketchState.selected;
    if (!l) return;
    const o = skSerializeLayer(l);
    const z = map.getZoom();
    const d = L.point(24, 24);
    if (o.pts) o.pts = skShiftArr(o.pts, d, z);
    else if (o.b) o.b = [skShiftLL(o.b[0], d, z), skShiftLL(o.b[1], d, z)];
    else if (o.ll) o.ll = skShiftLL(o.ll, d, z);
    o.id = ++sketchState.seq;
    o.name = skNextName(o.kind);
    const c = skBuildLayer(o);
    skRegister(c);
    skCommit();
    skSelect(c);
    updateStatus('📑 Создана копия объекта');
}

function skReorder(toFront) {
    const l = sketchState.selected;
    if (!l) return;
    if (skIsMarker(l._sk.kind)) {
        l.setZIndexOffset((l.options.zIndexOffset || 0) + (toFront ? 1000 : -1000));
    } else if (toFront) {
        l.bringToFront();
    } else {
        l.bringToBack();
    }
    skSetSelectedClass(l, true);
}

function skClearAll() {
    if (!sketchItems.getLayers().length) return;
    if (!confirm('Удалить все нарисованные объекты?')) return;
    skSelect(null);
    sketchItems.clearLayers();
    skCommit();
    skRenderList();
    updateStatus('🧹 Рисунки очищены');
}

function skExport() {
    const features = sketchItems.getLayers().map(l => {
        const f = l.toGeoJSON();
        f.properties = Object.assign({}, f.properties, {
            name: l._sk.name,
            kind: l._sk.kind,
            text: l._sk.kind === 'text' ? l._sk.text : undefined,
            radius_m: l._sk.kind === 'circle' ? l.getRadius() : undefined,
            style: l._sk.style
        });
        return f;
    });
    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: features }, null, 2)], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'geoclass-drawing.geojson';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    updateStatus('💾 Рисунки экспортированы в GeoJSON');
}

// ---------- ПОДКЛЮЧЕНИЕ ИНТЕРФЕЙСА ----------
function skInitUI() {
    // палитры быстрых цветов
    document.querySelectorAll('.dw-swatches').forEach(box => {
        box.innerHTML = SK_PALETTE.map(c => `<button type="button" class="dw-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
        box.addEventListener('click', ev => {
            const b = ev.target.closest('.dw-swatch');
            if (!b) return;
            const input = skEl(box.dataset.target);
            input.value = b.dataset.color;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    // галерея значков
    const gal = skEl('skIconGrid');
    gal.innerHTML = SK_ICONS.map(([n, t]) => `<button type="button" class="dw-icon-btn" data-icon="${n}" title="${t}"><i class="fas fa-${n}"></i></button>`).join('');
    gal.addEventListener('click', ev => {
        const b = ev.target.closest('.dw-icon-btn');
        if (!b) return;
        sketchStyle.iconName = b.dataset.icon;
        skUpdateOutputs();
        const sel = sketchState.selected;
        if (sel && sel._sk.kind === 'icon') {
            skApplyToSelected();
            skCommit();
        } else if (sketchState.tool !== 'icon') {
            skActivateTool('icon');
        }
    });

    // стили: «живое» применение к выбранному объекту
    SK_CONTROLS.forEach(([id, key, type]) => {
        const el = skEl(id);
        if (!el) return;
        skWriteControl(el, type, sketchStyle[key]);
        el.addEventListener('input', () => {
            const v = skReadControl(el, type);
            if (type === 'num' && isNaN(v)) return;
            sketchState.hasUserStyle = true;
            sketchStyle[key] = v;
            skUpdateOutputs();
            skApplyToSelected();
        });
        el.addEventListener('change', () => {
            if (sketchState.selected) {
                skCommit();
                if (key === 'text') skRenderList();
            }
        });
    });

    // инструменты, режимы, действия
    document.querySelectorAll('[data-sk-tool]').forEach(b => b.addEventListener('click', () => skActivateTool(b.dataset.skTool)));
    document.querySelectorAll('[data-sk-mode]').forEach(b => b.addEventListener('click', () => skSetMode(b.dataset.skMode)));
    document.querySelectorAll('[data-sk-act]').forEach(b => b.addEventListener('click', () => {
        switch (b.dataset.skAct) {
            case 'undo': skUndo(); break;
            case 'redo': skRedo(); break;
            case 'duplicate': skDuplicate(); break;
            case 'front': skReorder(true); break;
            case 'back': skReorder(false); break;
            case 'delete': skDeleteLayer(sketchState.selected); break;
            case 'clear': skClearAll(); break;
            case 'export': skExport(); break;
        }
    }));

    skEl('skRepeat').addEventListener('change', function() { sketchState.repeat = this.checked; });
    skEl('skMeasure').addEventListener('change', function() {
        sketchState.measure = this.checked;
        sketchItems.eachLayer(skApplyMeasure);
    });

    // панель действий на карте и пункты общего контекстного меню
    const ctxEl = skEl('skCtx');
    if (ctxEl) {
        ['mousedown', 'dblclick', 'wheel'].forEach(t => ctxEl.addEventListener(t, ev => ev.stopPropagation()));
        ctxEl.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); });
        ctxEl.addEventListener('click', ev => {
            ev.stopPropagation();
            const b = ev.target.closest('[data-act]'), l = sketchState.selected;
            if (!b || !l) return;
            const a = skActions(l).find(x => x.id === b.dataset.act);
            if (!a) return;
            a.fn();
            if (a.keep && sketchState.selected) skRenderCtx(); else skHideCtx();
        });
    }
    [['ctxSkUndo', skUndo], ['ctxSkRedo', skRedo], ['ctxSkClear', skClearAll], ['ctxSkExport', skExport]].forEach(([id, fn]) => {
        const el = skEl(id);
        if (el) el.addEventListener('click', ev => { ev.stopPropagation(); hideMapContextMenu(); fn(); });
    });

    // список объектов
    skEl('skList').addEventListener('click', ev => {
        const row = ev.target.closest('.dw-item');
        if (!row) return;
        const l = sketchItems.getLayers().find(x => x._sk.id === Number(row.dataset.id));
        if (!l) return;
        const act = ev.target.closest('[data-item-act]');
        if (act && act.dataset.itemAct === 'del') { skDeleteLayer(l); return; }
        if (!sketchState.tool) skSelect(l);
        if (l.getBounds) {
            const b = l.getBounds();
            if (b.isValid()) map.fitBounds(b, { maxZoom: 18, padding: [40, 40] });
        } else if (l.getLatLng) {
            map.panTo(l.getLatLng());
        }
    });

    // клик по пустой карте снимает выделение
    map.on('click', () => {
        if (sketchState.tool || sketchState.justClicked || measureMode) return;
        skSelect(null);
    });

    // при первом открытии вкладки увеличиваем панель, чтобы все инструменты были видны
    const drawTab = document.querySelector('.bp-tab[data-bp-tab="draw"]');
    if (drawTab) {
        drawTab.addEventListener('click', () => {
            const bp = document.getElementById('bottomPanel');
            if (!bp.classList.contains('collapsed') && bp.offsetHeight < 300) {
                const max = document.querySelector('.map-container').clientHeight - 140;
                bp.style.height = Math.max(bp.offsetHeight, Math.min(300, max)) + 'px';
            }
        });
    }

    // горячие клавиши
    document.addEventListener('keydown', ev => {
        const t = ev.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (ev.key === 'Escape' && sketchState.tool) {
            skCancelTool();
            updateStatus('🔧 Инструмент рисования отключён');
        } else if (typing) {
            return;
        } else if (ev.key === 'Enter' && sketchState.handler && sketchState.handler.completeShape) {
            sketchState.handler.completeShape();
        } else if (ev.key === 'Backspace' && sketchState.handler && sketchState.handler.deleteLastVertex) {
            ev.preventDefault();
            sketchState.handler.deleteLastVertex();
        } else if (ev.key === 'Delete' && sketchState.selected && !sketchState.tool) {
            skDeleteLayer(sketchState.selected);
        } else if ((ev.ctrlKey || ev.metaKey) && drawTab && drawTab.classList.contains('active')) {
            const k = ev.key.toLowerCase();
            if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); skUndo(); }
            else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); skRedo(); }
        }
    });

    skUpdateOutputs();
    skRenderList();
}
skInitUI();

// ============================================================
//  ИЗМЕНЕНИЕ РАЗМЕРА ПАНЕЛЕЙ МЫШЬЮ
// ============================================================
//  Боковая панель — тянуть за её правый край,
//  нижняя панель — за верхний край. Двойной клик по ручке — размер по умолчанию.
// ============================================================
(function initPanelResizers() {
    function makeResizer(handle, panel, opts) {
        let start = null;
        handle.addEventListener('pointerdown', ev => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            handle.setPointerCapture(ev.pointerId);
            const r = panel.getBoundingClientRect();
            start = { x: ev.clientX, y: ev.clientY, w: r.width, h: r.height };
            panel.classList.add('resizing');
            handle.classList.add('dragging');
            document.body.classList.add(opts.bodyClass);
        });
        handle.addEventListener('pointermove', ev => {
            if (!start) return;
            opts.apply(start, ev);
        });
        const finish = ev => {
            if (!start) return;
            start = null;
            panel.classList.remove('resizing');
            handle.classList.remove('dragging');
            document.body.classList.remove(opts.bodyClass);
            try { handle.releasePointerCapture(ev.pointerId); } catch (e) { /* уже освобождён */ }
            map.invalidateSize();
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('dblclick', () => {
            opts.reset();
            setTimeout(() => map.invalidateSize(), 50);
        });
    }

    // боковая панель: ширина
    const side = document.getElementById('mainPanel');
    const sideHandle = document.getElementById('panelResizer');
    if (side && sideHandle) {
        makeResizer(sideHandle, side, {
            bodyClass: 'resizing-x',
            apply: (s, ev) => {
                const max = Math.max(320, window.innerWidth - 320);
                const w = Math.round(Math.min(max, Math.max(260, s.w + ev.clientX - s.x)));
                side.style.width = w + 'px';
                side.style.minWidth = w + 'px';
            },
            reset: () => { side.style.width = ''; side.style.minWidth = ''; }
        });
    }

    // нижняя панель: высота
    const bottom = document.getElementById('bottomPanel');
    const bottomHandle = document.getElementById('bpResizer');
    if (bottom && bottomHandle) {
        makeResizer(bottomHandle, bottom, {
            bodyClass: 'resizing-y',
            apply: (s, ev) => {
                const max = Math.max(160, document.querySelector('.map-container').clientHeight - 140);
                const h = Math.round(Math.min(max, Math.max(110, s.h - (ev.clientY - s.y))));
                bottom.style.height = h + 'px';
            },
            reset: () => { bottom.style.height = ''; }
        });
    }
})();

// ============================================================
//  ИНИЦИАЛИЗАЦИЯ
// ============================================================

createDrawControl();
autoDetectLocation();
updateActiveChips(currentLayer);
fillLayerThumbs();
updateLayerLegend();
updateNorthArrow();
updateStatus('🔧 Выберите инструмент рисования на карте');

window.addEventListener('resize', () => {
    map.invalidateSize();
});

// ============================================================
//  3D РЕЖИМ (MapLibre GL JS)
// ============================================================
//  Кнопка «3D» под виджетом «Шторка» включает объёмный вид: поверх основной карты показывается
//  карта MapLibre с рельефом (DEM), 3D-зданиями OSM (OpenFreeMap), освещением и небом.
//  Основная Leaflet-карта остаётся «за кадром» и синхронизируется с 3D (центр, масштаб, азимут),
//  поэтому поиск, кнопки масштаба, стрелка севера, мини-карта и история экстентов работают как раньше.
//  Настройки 3D — во вкладке «3D» нижней панели (активна только в 3D-режиме):
//  камера, рельеф, здания, слои OSM, освещение, нарисованные объекты, импорт 3D-моделей (GLB/GLTF)
//  и выдавливание GeoJSON/KML в 3D.
// ============================================================

const M3D = {
    BEARING_SIGN: -1,   // азимут в leaflet-rotate и в MapLibre отсчитывается в противоположные стороны
    DEM: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    OSM: 'https://tiles.openfreemap.org/planet',
    GLYPHS: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    FONT: ['Noto Sans Regular'],
    TREE_MINZ: 14,      // деревья рисуются с этого масштаба MapLibre
    TREE_MAX: 60000,    // максимум деревьев одновременно
    TREE_HINT: 'Деревья случайно рассыпаются по лесным полигонам OSM (с масштаба z14)'
};

function m3DefaultOpts() {
    return {
        terrain: true, exaggeration: 1.5, hillshade: true, hillInt: 0.5, sky: true,
        buildings: true, bColor: '#d8dee9', bOpacity: 0.92, bHeight: 1, bByHeight: false,
        roads: false, water: false, landcover: false, labels: false,
        sunAz: 210, sunAlt: 45, sunInt: 0.55,
        userObjects: true, extrude: false, extrudeH: 20,
        trees: false, treeDens: 100, power: false
    };
}

const m3d = {
    active: false, map: null, ready: false, guard: false, seq: 0, baseIds: [],
    items: [], nextId: 1, selected: null, placing: false, orbit: 0, marker: null,
    map2: null, ready2: false, baseIds2: [], unlink: null,   // второе 3D-окно (шторка / дублирование)
    lights: [], bingReg: false, opts: m3DefaultOpts(),
    trees: { n: 0, timer: 0, retry: 0, origin: null, cosO: 1, trunk: null, crown: null, sun: null },
    lab: { timer: 0, list: [], cache: null, scene: null, origin: null, gT: 0 },   // вертикальные 3D-подписи населённых пунктов
    power: { timer: 0, rt: 0, seq: 0, lines: [], center: null, origin: null, n: 0, spans: 0, retry: 0, busy: false, failAt: 0, scene: null }   // ЛЭП из OSM
};

// [id элемента, ключ настройки, тип значения]
const M3_CONTROLS = [
    ['m3Terrain', 'terrain', 'bool'], ['m3Exag', 'exaggeration', 'num'],
    ['m3Hill', 'hillshade', 'bool'], ['m3HillInt', 'hillInt', 'num'], ['m3Sky', 'sky', 'bool'],
    ['m3Bld', 'buildings', 'bool'], ['m3BColor', 'bColor', 'str'], ['m3BOp', 'bOpacity', 'num'],
    ['m3BH', 'bHeight', 'num'], ['m3BByH', 'bByHeight', 'bool'],
    ['m3Roads', 'roads', 'bool'], ['m3Water', 'water', 'bool'], ['m3Land', 'landcover', 'bool'], ['m3Labels', 'labels', 'bool'],
    ['m3SunAz', 'sunAz', 'num'], ['m3SunAlt', 'sunAlt', 'num'], ['m3SunInt', 'sunInt', 'num'],
    ['m3User', 'userObjects', 'bool'], ['m3Extrude', 'extrude', 'bool'], ['m3ExtH', 'extrudeH', 'num'],
    ['m3Trees', 'trees', 'bool'], ['m3TreeDens', 'treeDens', 'num'], ['m3Power', 'power', 'bool']
];
const M3_FMT = {
    m3Exag: v => '×' + (+v).toFixed(1), m3HillInt: v => Math.round(v * 100) + '%',
    m3BOp: v => Math.round(v * 100) + '%', m3BH: v => '×' + (+v).toFixed(1),
    m3SunAz: v => Math.round(v) + '°', m3SunAlt: v => Math.round(v) + '°', m3SunInt: v => Math.round(v * 100) + '%',
    m3ExtH: v => Math.round(v) + ' м', m3TreeDens: v => Math.round(v) + '/га'
};

const m3El = id => document.getElementById(id);
const m3Rad = Math.PI / 180;
const m3LbToMl = b => { const v = M3D.BEARING_SIGN * b; return ((((v + 180) % 360) + 360) % 360) - 180; };

// ---------- Подложка Leaflet → растровые источники MapLibre ----------
function m3LayerToRasters(layer, out) {
    if (!layer) return out;
    if (typeof layer.getLayers === 'function') {   // составной слой (основа + данные + подписи)
        layer.getLayers().slice()
            .sort((a, b) => ((a.options && a.options.zIndex) || 0) - ((b.options && b.options.zIndex) || 0))
            .forEach(l => m3LayerToRasters(l, out));
        return out;
    }
    const o = layer.options || {};
    const native = o.maxNativeZoom != null ? o.maxNativeZoom : (o.maxZoom != null ? o.maxZoom : 19);
    const spec = {
        type: 'raster', tileSize: 256, maxzoom: Math.min(native, 22),
        attribution: o.attribution || '', opacity: o.opacity != null ? o.opacity : 1
    };
    if (layer instanceof SentinelLayer) {
        spec.tiles = [`gcsentinel://${layer._snKey}/{z}/{x}/{y}`];
    } else if (layer instanceof BingLayer) {
        spec.tiles = [`gcbing://${o.bingType}/{z}/{x}/{y}`];
    } else if (layer instanceof EsriLandCoverLayer) {
        const rule = encodeURIComponent(JSON.stringify({ rasterFunction: 'Cartographic Renderer for Visualization and Analysis' }));
        spec.tiles = [`${ESRI_LANDCOVER_EXPORT_URL}?f=image&bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857` +
                      `&size=256,256&format=png32&transparent=true&renderingRule=${rule}`];
    } else if (L.TileLayer.WMS && layer instanceof L.TileLayer.WMS) {
        const p = layer.wmsParams || {};
        const sep = layer._url.indexOf('?') >= 0 ? '&' : '?';
        spec.tiles = [`${layer._url}${sep}SERVICE=WMS&VERSION=${p.version || '1.3.0'}&REQUEST=GetMap&LAYERS=${encodeURIComponent(p.layers)}` +
                      `&STYLES=&FORMAT=${encodeURIComponent(p.format || 'image/png')}&TRANSPARENT=${p.transparent ? 'true' : 'false'}` +
                      `&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`];
    } else if (layer._url) {
        const subs = typeof o.subdomains === 'string' ? o.subdomains.split('') : (o.subdomains || ['a', 'b', 'c']);
        spec.tiles = layer._url.indexOf('{s}') >= 0 ? subs.map(s => layer._url.replace('{s}', s)) : [layer._url];
    } else {
        return out;
    }
    out.push(spec);
    return out;
}

function m3RebuildBasemapOn(m, ids, key) {
    ids.forEach(id => {
        if (m.getLayer('l-' + id)) m.removeLayer('l-' + id);
        if (m.getSource(id)) m.removeSource(id);
    });
    ids.length = 0;
    m3LayerToRasters(baseLayers[key] || currentTileLayer, []).forEach(spec => {
        const id = 'gc-base-' + (++m3d.seq);
        const opacity = spec.opacity;
        delete spec.opacity;
        m.addSource(id, spec);
        m.addLayer({ id: 'l-' + id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 120 } }, 'gc-hillshade');
        ids.push(id);
    });
}

function m3RebuildBasemap() {
    if (m3d.map && m3d.ready) m3RebuildBasemapOn(m3d.map, m3d.baseIds, currentLayer);
    m3RebuildBasemap2();
}

// Подложка второго 3D-окна = подложка правой половины шторки
function m3RebuildBasemap2() {
    if (m3d.map2 && m3d.ready2 && swipeState.active && swipeState.sides.right && swipeState.sides.right.layerKey) {
        m3RebuildBasemapOn(m3d.map2, m3d.baseIds2, swipeState.sides.right.layerKey);
    }
}

// ---------- Второе 3D-окно (правая половина шторки / правое окно дублирования) ----------
function m3InitRight() {
    const src = m3d.map;
    let el = m3El('map3dR');
    if (!el) {
        el = document.createElement('div');
        el.id = 'map3dR';
        el.className = 'map3d map3d-r';
        mapStageEl.insertBefore(el, m3El('map3d').nextSibling);
    }
    const c = src.getCenter();
    const m = new maplibregl.Map({
        container: el,
        style: { version: 8, glyphs: M3D.GLYPHS, sources: {}, layers: [{ id: 'gc-bg', type: 'background', paint: { 'background-color': '#dfe7ee' } }] },
        center: [c.lng, c.lat], zoom: src.getZoom(), bearing: src.getBearing(), pitch: src.getPitch(),
        maxPitch: 85, maxZoom: 21, attributionControl: false, preserveDrawingBuffer: true, antialias: true
    });
    m3d.map2 = m;
    m3d.ready2 = false;
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    m.on('load', () => {
        m3d.ready2 = true;
        m3AddOverlays(m);
        m3RebuildBasemap2();
        m3Apply();
    });
    // камеры обоих окон движутся вместе
    let busy = false;
    const mirror = (from, to) => () => {
        if (busy) return;
        busy = true;
        to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
        busy = false;
    };
    const h1 = mirror(src, m), h2 = mirror(m, src);
    src.on('move', h1);
    m.on('move', h2);
    m3d.unlink = () => src.off('move', h1);
    ['mousedown', 'touchstart', 'wheel'].forEach(ev => m.on(ev, m3StopOrbit));
}

function m3EnterSplit() {
    if (!m3d.map || m3d.map2) return;
    m3InitRight();
    applySwipeClip();
    m3d.map.resize();
    m3d.map2.resize();
}

function m3DestroySplit() {
    if (m3d.unlink) { m3d.unlink(); m3d.unlink = null; }
    if (m3d.map2) { m3d.map2.remove(); m3d.map2 = null; }
    m3d.ready2 = false;
    m3d.baseIds2 = [];
    const r = m3El('map3dR');
    if (r && r.parentNode) r.parentNode.removeChild(r);
    const l = m3El('map3d');
    if (l) { l.style.clipPath = ''; l.style.webkitClipPath = ''; }
    if (m3d.map) m3d.map.resize();
}

// ---------- Синхронизация с основной (Leaflet) картой ----------
function m3SyncToLeaflet() {
    if (!m3d.map) return;
    const c = m3d.map.getCenter();
    m3d.guard = true;
    const snap = map.options.zoomSnap;
    map.options.zoomSnap = 0;   // без округления масштаба
    try {
        map.setView([c.lat, c.lng], m3d.map.getZoom() + 1, { animate: false });
        if (isRotationSupported()) map.setBearing(M3D.BEARING_SIGN * m3d.map.getBearing());
    } catch (e) { /* карта могла быть в переходном состоянии */ }
    map.options.zoomSnap = snap;
    m3d.guard = false;
}

function m3SyncFromLeaflet() {
    if (!m3d.active || !m3d.map || m3d.guard) return;
    const c = map.getCenter();
    m3d.map.easeTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1, bearing: m3LbToMl(getBearing()), duration: 350, essential: true });
}

// ---------- Стиль и слои ----------
function m3AddOverlays(m) {
    const o = m3d.opts;
    m.addSource('gc-dem', { type: 'raster-dem', tiles: [M3D.DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15,
        attribution: 'Рельеф: Mapzen / AWS Terrain Tiles' });
    m.addSource('gc-dem-hs', { type: 'raster-dem', tiles: [M3D.DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
    m.addSource('gc-osm', { type: 'vector', url: M3D.OSM, attribution: '&copy; OpenStreetMap contributors, OpenFreeMap' });

    m.addLayer({ id: 'gc-hillshade', type: 'hillshade', source: 'gc-dem-hs', paint: {
        'hillshade-shadow-color': '#1e293b', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#475569',
        'hillshade-exaggeration': o.hillInt, 'hillshade-illumination-direction': o.sunAz, 'hillshade-illumination-anchor': 'map'
    } });
    m.addLayer({ id: 'gc-landcover', type: 'fill', source: 'gc-osm', 'source-layer': 'landcover', layout: { visibility: 'none' }, paint: {
        'fill-color': ['match', ['get', 'class'], 'wood', '#15803d', 'forest', '#15803d', 'grass', '#65a30d', 'farmland', '#ca8a04',
            'wetland', '#0d9488', 'sand', '#fcd34d', '#84cc16'],
        'fill-opacity': 0.38
    } });
    m.addLayer({ id: 'gc-forest', type: 'fill', source: 'gc-osm', 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]], layout: { visibility: 'none' },
        paint: { 'fill-color': '#166534', 'fill-opacity': 0.22 } });
    m.addLayer({ id: 'gc-water', type: 'fill', source: 'gc-osm', 'source-layer': 'water', layout: { visibility: 'none' }, paint: {
        'fill-color': '#38bdf8', 'fill-opacity': 0.6
    } });
    m.addLayer({ id: 'gc-roads', type: 'line', source: 'gc-osm', 'source-layer': 'transportation', minzoom: 8,
        filter: ['all', ['==', ['geometry-type'], 'LineString'],
            ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]]],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: {
            'line-color': ['match', ['get', 'class'], 'motorway', '#f97316', 'trunk', '#f97316', 'primary', '#fbbf24', '#ffffff'],
            'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.6, 14, 2.2, 18, 10],
            'line-opacity': 0.95
        } });
    m.addLayer({ id: 'gc-buildings', type: 'fill-extrusion', source: 'gc-osm', 'source-layer': 'building', minzoom: 13, paint: {
        'fill-extrusion-color': o.bColor, 'fill-extrusion-height': 8, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': o.bOpacity
    } });
    m.addLayer({ id: 'gc-labels', type: 'symbol', source: 'gc-osm', 'source-layer': 'place', layout: {
        visibility: 'none',
        'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name:latin'], ['get', 'name']],
        'text-font': M3D.FONT, 'text-max-width': 8,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 15, 16, 18]
    }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
    if (window.gridInit3D) window.gridInit3D(m);   // сетка координат в 3D
}

function m3AddUserLayers(m) {
    const o = m3d.opts;
    m.addSource('gc-user', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const isK = k => ['==', ['get', 'k'], k];
    m.addLayer({ id: 'gc-user-fill', type: 'fill', source: 'gc-user', filter: isK('fill'),
        paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] } });
    m.addLayer({ id: 'gc-user-ext', type: 'fill-extrusion', source: 'gc-user', filter: isK('fill'), layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': ['get', 'fillColor'], 'fill-extrusion-height': o.extrudeH, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.8 } });
    m.addLayer({ id: 'gc-user-line', type: 'line', source: 'gc-user', filter: isK('line'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'] } });
    m.addLayer({ id: 'gc-user-pt', type: 'circle', source: 'gc-user', filter: isK('pt'),
        paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    m.addLayer({ id: 'gc-user-txt', type: 'symbol', source: 'gc-user', filter: isK('txt'),
        layout: { 'text-field': ['get', 'txt'], 'text-font': M3D.FONT, 'text-size': 14, 'text-allow-overlap': true },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
}

// Применить все настройки к карте
function m3Apply() {
    m3ApplyTo(m3d.map, true);
    if (m3d.map2 && m3d.ready2) m3ApplyTo(m3d.map2, false);
}

function m3ApplyTo(m, main) {
    const o = m3d.opts;
    if (!m || !(main ? m3d.ready : m3d.ready2)) return;
    const vis = on => on ? 'visible' : 'none';

    try { m.setTerrain(o.terrain ? { source: 'gc-dem', exaggeration: o.exaggeration } : null); } catch (e) { console.warn('terrain', e); }

    m.setLayoutProperty('gc-hillshade', 'visibility', vis(o.hillshade));
    m.setPaintProperty('gc-hillshade', 'hillshade-exaggeration', o.hillInt);
    m.setPaintProperty('gc-hillshade', 'hillshade-illumination-direction', o.sunAz);

    if (typeof m.setSky === 'function') {
        try {
            m.setSky(o.sky
                ? { 'sky-color': '#7db7ee', 'horizon-color': '#eaf3fb', 'fog-color': '#f3f7fb', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 }
                : { 'sky-color': '#dfe7ee', 'horizon-color': '#dfe7ee', 'fog-color': '#dfe7ee', 'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 0 });
        } catch (e) { /* старая версия без sky */ }
    }
    try {
        m.setLight({ anchor: 'map', position: [1.15, o.sunAz, 90 - o.sunAlt], intensity: o.sunInt, color: '#ffffff' });
    } catch (e) { /* свет необязателен */ }

    const hRaw = ['coalesce', ['get', 'render_height'], 8];
    m.setLayoutProperty('gc-buildings', 'visibility', vis(o.buildings));
    m.setPaintProperty('gc-buildings', 'fill-extrusion-height', ['*', o.bHeight, hRaw]);
    m.setPaintProperty('gc-buildings', 'fill-extrusion-base', ['*', o.bHeight, ['coalesce', ['get', 'render_min_height'], 0]]);
    m.setPaintProperty('gc-buildings', 'fill-extrusion-opacity', o.bOpacity);
    m.setPaintProperty('gc-buildings', 'fill-extrusion-color', o.bByHeight
        ? ['interpolate', ['linear'], hRaw, 0, '#e5e7eb', 15, '#fde68a', 40, '#fdba74', 90, '#f87171', 180, '#a78bfa']
        : o.bColor);

    m.setLayoutProperty('gc-roads', 'visibility', vis(o.roads));
    m.setLayoutProperty('gc-water', 'visibility', vis(o.water));
    m.setLayoutProperty('gc-landcover', 'visibility', vis(o.landcover));
    m.setLayoutProperty('gc-labels', 'visibility', vis(o.labels && !(main && typeof THREE !== 'undefined')));   // в основном 3D-окне подписи — вертикальные, на three.js
    m.setLayoutProperty('gc-forest', 'visibility', vis(o.trees));

    if (main) {   // объекты пользователя, модели и деревья — только в основном (левом) 3D-окне
        ['gc-user-line', 'gc-user-pt', 'gc-user-txt'].forEach(id => m.setLayoutProperty(id, 'visibility', vis(o.userObjects)));
        m.setLayoutProperty('gc-user-fill', 'visibility', vis(o.userObjects && !o.extrude));
        m.setLayoutProperty('gc-user-ext', 'visibility', vis(o.userObjects && o.extrude));
        m.setPaintProperty('gc-user-ext', 'fill-extrusion-height', o.extrudeH);

        m3UpdateLights();
        if (o.trees || m3d.trees.n) m3TreesSchedule();
        m3LabSchedule();
        if (o.power || m3d.power.n) m3PowerSchedule(true);
    }
    m.triggerRepaint();
}

// ---------- Нарисованные объекты → GeoJSON для 3D ----------
function m3CollectUser() {
    const feats = [];
    let count = 0;
    const addPoly = (rings, base, fillOn) => {
        if (fillOn) feats.push({ type: 'Feature', properties: Object.assign({ k: 'fill' }, base), geometry: { type: 'Polygon', coordinates: rings } });
        rings.forEach(r => feats.push({ type: 'Feature', properties: Object.assign({ k: 'line' }, base), geometry: { type: 'LineString', coordinates: r } }));
    };
    const walk = layer => {
        if (typeof layer.eachLayer === 'function' && !(layer instanceof L.Path)) { layer.eachLayer(walk); return; }
        const o = layer.options || {};
        const color = o.color || '#059669';
        const base = {
            color: color, weight: o.weight || 2, opacity: o.opacity != null ? o.opacity : 1,
            fillColor: o.fillColor || color, fillOpacity: o.fillOpacity != null ? o.fillOpacity : 0.2
        };
        const fillOn = o.fill !== false;
        try {
            if (layer instanceof L.Circle) {
                addPoly([circleToPolygonPoints(layer)], base, fillOn); count++;
            } else if (layer instanceof L.CircleMarker) {
                const ll = layer.getLatLng();
                feats.push({ type: 'Feature', properties: Object.assign({ k: 'pt', r: o.radius || 6 }, base), geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } });
                count++;
            } else if (layer instanceof L.Polygon) {
                const g = layer.toGeoJSON().geometry;
                (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach(rings => addPoly(rings, base, fillOn));
                count++;
            } else if (layer instanceof L.Polyline) {
                const g = layer.toGeoJSON().geometry;
                (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach(c =>
                    feats.push({ type: 'Feature', properties: Object.assign({ k: 'line' }, base), geometry: { type: 'LineString', coordinates: c } }));
                count++;
            } else if (layer instanceof L.Marker) {
                const ll = layer.getLatLng(), sk = layer._sk;
                const st = (sk && sk.style) || {};
                if (sk && sk.kind === 'text') {
                    feats.push({ type: 'Feature', properties: { k: 'txt', txt: String(sk.text || ''), color: st.textColor || '#0f172a' }, geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } });
                } else {
                    feats.push({ type: 'Feature', properties: { k: 'pt', r: 7, color: st.iconBg || '#ef4444', weight: 1, opacity: 1, fillColor: st.iconBg || '#ef4444', fillOpacity: 1 }, geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } });
                }
                count++;
            }
        } catch (e) { /* пропускаем объект, который не удалось преобразовать */ }
    };
    [drawnItems, sketchItems].forEach(g => { if (g) g.eachLayer(walk); });
    return { features: feats, count: count };
}

function m3RefreshUser() {
    const m = m3d.map;
    if (!m || !m3d.ready) return;
    const res = m3CollectUser();
    const src = m.getSource('gc-user');
    if (src) src.setData({ type: 'FeatureCollection', features: res.features });
    const badge = m3El('m3UserCount');
    if (badge) badge.textContent = res.count;
}

// ---------- 3D-модели (three.js) ----------
function m3AddModelLayer(m) {
    if (typeof THREE === 'undefined') return;
    m.addLayer({
        id: 'gc-models', type: 'custom', renderingMode: '3d',
        onAdd: function (map, gl) {
            this.map = map;
            this.camera = new THREE.Camera();
            this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
            this.renderer.autoClear = false;
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        },
        render: function (gl, matrix) {
            m3d.projM = Array.prototype.slice.call(matrix);   // матрица проекции нужна для выбора моделей мышью
            const list = m3d.items.filter(it => it.kind === 'model' && it.visible);
            if (!list.length) return;
            const proj = new THREE.Matrix4().fromArray(matrix);
            const rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);   // glTF: Y вверх → мир: Z вверх
            this.renderer.resetState();
            list.forEach(it => {
                const ground = (m3d.opts.terrain && this.map.queryTerrainElevation)
                    ? (this.map.queryTerrainElevation([it.lng, it.lat]) || 0) : 0;
                const mc = maplibregl.MercatorCoordinate.fromLngLat([it.lng, it.lat], ground + it.alt);
                const s = mc.meterInMercatorCoordinateUnits() * it.scale;
                const l = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
                    .scale(new THREE.Vector3(s, -s, s)).multiply(rotX);
                this.camera.projectionMatrix = proj.clone().multiply(l);
                this.renderer.render(it.scene, this.camera);
                if (it.id === m3d.selected) {   // полупрозрачная маска поверх выделенной модели
                    if (!this.maskMat) this.maskMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
                    it.scene.overrideMaterial = this.maskMat;
                    this.renderer.render(it.scene, this.camera);
                    it.scene.overrideMaterial = null;
                }
            });
        }
    });
}

function m3MakeScene() {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const d = new THREE.DirectionalLight(0xffffff, 0.9);
    scene.add(d);
    m3d.lights.push(d);
    m3UpdateLights();
    return scene;
}

function m3UpdateLights() {
    if (typeof THREE === 'undefined') return;
    const az = m3d.opts.sunAz * m3Rad, alt = Math.max(m3d.opts.sunAlt, 5) * m3Rad;
    m3d.lights.forEach(d => {
        d.position.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
        d.intensity = 0.3 + m3d.opts.sunInt * 1.2;
    });
    m3TreesLight();
}

// ---------- 3D-деревья на лесных полигонах OSM (three.js, InstancedMesh) ----------
// Точки-деревья берутся псевдослучайно из глобальной сетки: в каждой ячейке одна точка со случайным
// смещением (генератор зависит только от номера ячейки), после чего остаются точки внутри лесных
// полигонов OSM. Поэтому деревья не «прыгают» при движении карты и не дублируются на стыках тайлов.
function m3TreesLight() {
    const T = m3d.trees;
    if (!T.sun) return;
    const az = m3d.opts.sunAz * m3Rad, alt = Math.max(m3d.opts.sunAlt, 5) * m3Rad;
    T.sun.position.set(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt));   // восток, север, вверх
    T.sun.intensity = 0.3 + m3d.opts.sunInt * 1.2;
}

function m3AddTreesLayer(m) {
    if (typeof THREE === 'undefined') return;
    const T = m3d.trees;
    m.addLayer({
        id: 'gc-trees', type: 'custom', renderingMode: '3d',
        onAdd: function (map, gl) {
            this.camera = new THREE.Camera();
            this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
            this.renderer.autoClear = false;
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            const cap = M3D.TREE_MAX, scene = new THREE.Scene();
            scene.add(new THREE.AmbientLight(0xffffff, 0.65));
            T.sun = new THREE.DirectionalLight(0xffffff, 0.9);
            scene.add(T.sun);
            const tg = new THREE.CylinderGeometry(1, 1, 1, 5);   // ствол: ось Z, основание в z=0
            tg.rotateX(Math.PI / 2); tg.translate(0, 0, 0.5);
            const mk = (geo, color) => {
                const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: color }), cap);
                mesh.count = 0; mesh.frustumCulled = false; scene.add(mesh);
                return mesh;
            };
            T.trunk = mk(tg, 0x5b3a1e);
            T.crown = mk(new THREE.IcosahedronGeometry(1, 0), 0xffffff);   // крона
            T.crown.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
            this.scene = scene;
            m3TreesLight();
        },
        render: function (gl, matrix) {
            if (!T.n || !T.origin) return;
            const s = T.origin.meterInMercatorCoordinateUnits();
            const l = new THREE.Matrix4().makeTranslation(T.origin.x, T.origin.y, T.origin.z)
                .scale(new THREE.Vector3(s, -s, s));   // x — восток, y — север, z — вверх (метры)
            this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
            this.renderer.resetState();
            this.renderer.render(this.scene, this.camera);
        }
    });
}

// ---------- Подписи населённых пунктов: стоят на карте вертикально, как надпись Hollywood (three.js) ----------
// Подпись — вертикальная плоскость в мире: поворачивается и наклоняется вместе с картой, читается со стороны камеры
// (когда карту разворачивают «на юг», подпись переворачивается на 180°, чтобы не читалась зеркально).
const M3_PLACE_Z = { city: 0, town: 6, village: 10, suburb: 11, hamlet: 12, isolated_dwelling: 14 };   // с какого масштаба показывать
const M3_PLACE_PX = { city: 34, town: 26, village: 20, suburb: 16, hamlet: 15, isolated_dwelling: 12 };  // высота буквы при взгляде сверху, px

function m3LabMake(name) {
    const px = 64, pad = 14, f = '700 ' + px + 'px "Segoe UI", Arial, sans-serif';
    const cv = document.createElement('canvas'), g = cv.getContext('2d');
    g.font = f;
    cv.width = Math.min(1024, Math.ceil(g.measureText(name).width) + pad * 2); cv.height = px + pad * 2;
    g.font = f; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(name, cv.width / 2, cv.height / 2 + 2, cv.width - pad);
    g.fillStyle = '#0f172a'; g.fillText(name, cv.width / 2, cv.height / 2 + 2, cv.width - pad);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.5);   // плоскость стоит вертикально, низ в z=0
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.frustumCulled = false;
    return { mesh: mesh, aspect: cv.width / cv.height };
}

function m3AddLabels3D(m) {
    if (typeof THREE === 'undefined') return;
    const S = m3d.lab;
    S.cache = new Map(); S.list = []; S.origin = null; S.gT = 0;
    m.addLayer({
        id: 'gc-labels3d', type: 'custom', renderingMode: '3d',
        onAdd: function (map, gl) {
            this.map = map;
            this.camera = new THREE.Camera();
            this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
            this.renderer.autoClear = false;
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            S.scene = new THREE.Scene();
        },
        render: function (gl, matrix) {
            if (!m3d.opts.labels || !S.list.length || !S.origin) return;
            const mp = this.map;
            const mpp = 78271.517 * Math.cos(mp.getCenter().lat * m3Rad) / Math.pow(2, mp.getZoom());   // метров в пикселе
            const flip = Math.cos(mp.getBearing() * m3Rad) < 0;
            const now = performance.now(), upd = now - S.gT > 700;
            if (upd) S.gT = now;
            const useT = m3d.opts.terrain && typeof mp.queryTerrainElevation === 'function';
            S.list.forEach(it => {
                if (upd) { const e = useT ? mp.queryTerrainElevation([it.lng, it.lat]) : 0; it.g = e == null ? it.g : e; }
                const h = it.px * mpp;
                it.mesh.scale.set(h * it.aspect, 1, h);
                it.mesh.position.z = it.g + h * 0.06;
                it.mesh.rotation.z = flip ? Math.PI : 0;
            });
            const o = S.origin, s = o.meterInMercatorCoordinateUnits();
            const l = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).scale(new THREE.Vector3(s, -s, s));   // x — восток, y — север, z — вверх (м)
            this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
            this.renderer.resetState();
            this.renderer.render(S.scene, this.camera);
        }
    });
}

function m3LabSchedule() {
    const S = m3d.lab;
    clearTimeout(S.timer);
    S.timer = setTimeout(m3LabBuild, 250);
}

function m3LabBuild() {
    const S = m3d.lab, m = m3d.map;
    if (!m || !S.scene) return;
    S.list.forEach(it => S.scene.remove(it.mesh));
    S.list = [];
    if (!m3d.opts.labels) { m.triggerRepaint(); return; }
    const z = m.getZoom(), c = m.getCenter();
    let fs = [];
    try { fs = m.querySourceFeatures('gc-osm', { sourceLayer: 'place' }); } catch (e) { /* тайлы ещё не загружены */ }
    const seen = new Set(), found = [];
    fs.forEach(f => {
        const p = f.properties || {}, cls = p.class;
        if (M3_PLACE_Z[cls] == null || z < M3_PLACE_Z[cls]) return;
        const name = p['name:ru'] || p['name:latin'] || p.name;
        if (!name || !f.geometry || f.geometry.type !== 'Point') return;
        const lng = f.geometry.coordinates[0], lat = f.geometry.coordinates[1];
        const key = name + '|' + cls + '|' + Math.round(lng * 200) + '|' + Math.round(lat * 200);
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ name: name, cls: cls, lng: lng, lat: lat, d: (lng - c.lng) * (lng - c.lng) + (lat - c.lat) * (lat - c.lat) });
    });
    found.sort((a, b) => a.d - b.d);
    const o = S.origin = maplibregl.MercatorCoordinate.fromLngLat([c.lng, c.lat], 0), s = o.meterInMercatorCoordinateUnits();
    found.slice(0, 140).forEach(f => {
        let e = S.cache.get(f.name);
        if (!e) { e = m3LabMake(f.name); S.cache.set(f.name, e); }
        const mc = maplibregl.MercatorCoordinate.fromLngLat([f.lng, f.lat]);
        e.mesh.position.set((mc.x - o.x) / s, (o.y - mc.y) / s, 0);
        S.scene.add(e.mesh);
        S.list.push({ mesh: e.mesh, aspect: e.aspect, px: M3_PLACE_PX[f.cls], lng: f.lng, lat: f.lat, g: 0 });
    });
    if (S.cache.size > 500) {   // чистим кэш текстур
        const keep = new Set(S.list.map(it => it.mesh));
        S.cache.forEach((e, k) => { if (!keep.has(e.mesh)) { e.mesh.material.map.dispose(); e.mesh.material.dispose(); e.mesh.geometry.dispose(); S.cache.delete(k); } });
    }
    S.gT = 0;
    m.triggerRepaint();
}

// ---------- ЛЭП с проводами (данные OSM через Overpass, three.js): опоры, траверсы и провода с провисанием ----------
const M3_OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const M3_POWER_HINT = 'Опоры и провода ЛЭП из OSM (с масштаба z11.5; загружается область ≈ 11×11 км вокруг центра карты)';
const M3_POWER_MINZ = 11.5, M3_POWER_MAXSPANS = 5000, M3_POWER_MAXT = 6000;

function m3PowerInfo(t, warn) {
    const el = m3El('m3PowerInfo');
    if (!el) return;
    el.textContent = t; el.style.color = warn ? '#dc2626' : '';
}

// Параметры линии по тегам OSM: высота опоры, расстояние между проводами, их расположение
function m3PowerCfg(tags) {
    const minor = tags.power === 'minor_line';
    let kv = 0;
    String(tags.voltage || '').split(';').forEach(v => { const x = parseFloat(v) / 1000; if (x > kv) kv = x; });
    if (!kv) kv = minor ? 10 : 110;
    let h, d;
    if (minor || kv < 35) { h = minor ? 9 : 12; d = minor ? 1.1 : 1.6; }
    else if (kv < 110) { h = 20; d = 3; }
    else if (kv < 220) { h = 28; d = 4.5; }
    else if (kv < 330) { h = 40; d = 6.5; }
    else { h = 48; d = 8; }
    const ht = parseFloat(tags.height);
    if (ht > 3 && ht < 120) h = ht;
    let circ = parseInt(tags.circuits, 10);
    if (!(circ > 0)) circ = parseInt(tags.cables, 10) >= 6 ? 2 : 1;
    circ = Math.min(circ, 2);
    const wires = [], levels = [];
    if (circ === 1) { levels.push(0.94); [-1, 0, 1].forEach(k => wires.push({ off: k * d, zf: 0.94 })); }
    else [0.78, 0.87, 0.96].forEach(zf => { levels.push(zf); [-1, 1].forEach(sg => wires.push({ off: sg * d, zf: zf })); });
    const ground = !minor && kv >= 110;   // грозозащитный трос поверх опоры
    if (ground) wires.push({ off: 0, zf: 1.04 });
    return { h: h, d: d, wires: wires, levels: levels, minor: minor, topF: ground ? 1.04 : 1 };
}

function m3AddPowerLayer(m) {
    if (typeof THREE === 'undefined') return;
    const P = m3d.power;
    P.lines = []; P.center = null; P.origin = null; P.n = 0; P.spans = 0; P.retry = 0; P.busy = false; P.failAt = 0; P.seq++;
    m.addLayer({
        id: 'gc-power', type: 'custom', renderingMode: '3d',
        onAdd: function (map, gl) {
            this.camera = new THREE.Camera();
            this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
            this.renderer.autoClear = false;
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            const scene = new THREE.Scene();
            const tg = new THREE.CylinderGeometry(0.32, 1, 1, 4);   // сужающаяся к верху опора: ось Z, основание в z=0
            tg.rotateX(Math.PI / 2); tg.rotateZ(Math.PI / 4); tg.translate(0, 0, 0.5);
            P.towers = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0x8d99a6 }), M3_POWER_MAXT);
            P.arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x5d6978 }), M3_POWER_MAXT * 3);
            [P.towers, P.arms].forEach(x => { x.count = 0; x.frustumCulled = false; scene.add(x); });
            P.wires = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1f2937 }));
            P.wires.frustumCulled = false; P.wires.visible = false; scene.add(P.wires);
            P.scene = scene;
        },
        render: function (gl, matrix) {
            if (!P.n || !P.origin || !m3d.opts.power) return;
            const o = P.origin, s = o.meterInMercatorCoordinateUnits();
            const l = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).scale(new THREE.Vector3(s, -s, s));   // x — восток, y — север, z — вверх (м)
            this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
            this.renderer.resetState();
            this.renderer.render(P.scene, this.camera);
        }
    });
}

// Построение геометрии: высоты берутся из рельефа (если тайлы рельефа ещё не загружены — пересобираем позже)
function m3PowerBuild() {
    const P = m3d.power, m = m3d.map;
    if (!m || !P.scene) return;
    clearTimeout(P.rt);
    const lines = m3d.opts.power ? P.lines : [];
    if (!lines.length) { P.towers.count = 0; P.arms.count = 0; P.wires.visible = false; P.n = 0; m.triggerRepaint(); return; }
    const c = P.center || m.getCenter();
    const o = P.origin = maplibregl.MercatorCoordinate.fromLngLat([c.lng, c.lat], 0), s = o.meterInMercatorCoordinateUnits();
    const useT = m3d.opts.terrain && typeof m.queryTerrainElevation === 'function';
    const wp = [], M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), zAx = new THREE.Vector3(0, 0, 1);
    const put = (mesh, k, x, y, z, rot, sx, sy, sz) => { q.setFromAxisAngle(zAx, rot); M4.compose(pv.set(x, y, z), q, sv.set(sx, sy, sz)); mesh.setMatrixAt(k, M4); };
    let miss = 0, nT = 0, nA = 0, spans = 0, over = false;
    for (const ln of lines) {
        if (over) break;
        const cf = ln.cf, sup = [];
        ln.pts.forEach((p, i) => {   // опоры — вершины линии, но не чаще чем раз в 30 м
            const mc = maplibregl.MercatorCoordinate.fromLngLat([p[0], p[1]]);
            const x = (mc.x - o.x) / s, y = (o.y - mc.y) / s, last = sup[sup.length - 1];
            if (last && Math.hypot(x - last.x, y - last.y) < 30) { if (i < ln.pts.length - 1) return; sup.pop(); }
            let g = 0;
            if (useT) { const e = m.queryTerrainElevation([p[0], p[1]]); if (e == null) miss++; else g = e; }
            sup.push({ x: x, y: y, g: g, tx: 1, ty: 0 });
        });
        if (sup.length < 2) continue;
        sup.forEach((a, i) => {   // направление линии в опоре
            const pr = sup[Math.max(i - 1, 0)], nx = sup[Math.min(i + 1, sup.length - 1)];
            const dx = nx.x - pr.x, dy = nx.y - pr.y, len = Math.hypot(dx, dy) || 1;
            a.tx = dx / len; a.ty = dy / len;
            if (nT < M3_POWER_MAXT) { const w = cf.minor ? 0.22 : cf.h * 0.1; put(P.towers, nT++, a.x, a.y, a.g, 0, w, w, cf.h * cf.topF); }
            cf.levels.forEach(zf => { if (nA < M3_POWER_MAXT * 3) put(P.arms, nA++, a.x, a.y, a.g + cf.h * zf, Math.atan2(a.ty, a.tx), 0.5, cf.d * 2.4, 0.4); });
        });
        for (let i = 0; i + 1 < sup.length; i++) {
            if (spans >= M3_POWER_MAXSPANS) { over = true; break; }
            spans++;
            const a = sup[i], b = sup[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
            const sag = Math.min(L * 0.017, 25), N = Math.min(12, Math.max(3, Math.ceil(L / 20)));   // провисание ≈ 1.7% пролёта
            cf.wires.forEach(w => {
                const ax = a.x - a.ty * w.off, ay = a.y + a.tx * w.off, az = a.g + cf.h * w.zf;
                const bx = b.x - b.ty * w.off, by = b.y + b.tx * w.off, bz = b.g + cf.h * w.zf;
                let px = ax, py = ay, pz = az;
                for (let k = 1; k <= N; k++) {
                    const t = k / N, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t - 4 * sag * t * (1 - t);
                    wp.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
                }
            });
        }
    }
    P.towers.count = nT; P.towers.instanceMatrix.needsUpdate = true;
    P.arms.count = nA; P.arms.instanceMatrix.needsUpdate = true;
    P.wires.geometry.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    P.wires.geometry = g; P.wires.visible = wp.length > 0;
    P.n = nT; P.spans = spans;
    m3PowerInfo('ЛЭП: ' + lines.length + ' линий, ' + nT + ' опор, ' + spans + ' пролётов' + (over ? ' (показаны первые ' + M3_POWER_MAXSPANS + ')' : ''));
    if (miss && P.retry < 4) { P.retry++; P.rt = setTimeout(m3PowerBuild, 900); }   // рельеф ещё грузится — ставим опоры на землю
    m.triggerRepaint();
}

async function m3PowerFetch(c) {
    const dLat = 0.05, dLng = 0.05 / Math.max(Math.cos(c.lat * m3Rad), 0.2);
    const bb = [c.lat - dLat, c.lng - dLng, c.lat + dLat, c.lng + dLng].map(v => v.toFixed(5)).join(',');
    const q = '[out:json][timeout:25][bbox:' + bb + '];(way["power"~"^(line|minor_line)$"];);out geom qt;';
    let last = 'нет ответа';
    for (const url of M3_OVERPASS) {
        const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 30000);
        try {
            const r = await fetch(url + '?data=' + encodeURIComponent(q), { signal: ctl.signal });
            if (!r.ok) { last = 'HTTP ' + r.status; continue; }
            const j = await r.json(), els = j.elements || [];
            if (j.remark && !els.length && /error|timed out|out of memory/i.test(j.remark)) { last = 'сервер перегружен'; continue; }
            return els;
        } catch (e) { last = e.name === 'AbortError' ? 'таймаут' : (e.message || 'ошибка сети'); }
        finally { clearTimeout(tm); }
    }
    throw new Error(last);
}

function m3PowerSchedule(rebuild) {
    const P = m3d.power;
    clearTimeout(P.timer);
    P.timer = setTimeout(() => m3PowerRun(rebuild), 400);
}

async function m3PowerRun(rebuild) {
    const P = m3d.power, m = m3d.map;
    if (!m || !P.scene) return;
    if (!m3d.opts.power) { if (P.n) m3PowerBuild(); m3PowerInfo(M3_POWER_HINT); return; }
    const c = m.getCenter(), k = Math.max(Math.cos(c.lat * m3Rad), 0.2);
    const far = !P.center || Math.abs(c.lat - P.center.lat) > 0.028 || Math.abs(c.lng - P.center.lng) > 0.028 / k;
    if (far && m.getZoom() < M3_POWER_MINZ) { if (!P.n) m3PowerInfo('Приблизьтесь: ЛЭП загружаются с масштаба z' + M3_POWER_MINZ); return; }
    if (far && !P.busy && Date.now() > P.failAt) {
        P.busy = true;
        const seq = ++P.seq;
        m3PowerInfo('Загрузка ЛЭП из OSM…');
        try {
            const els = await m3PowerFetch({ lat: c.lat, lng: c.lng });
            if (seq !== P.seq || !m3d.opts.power || m3d.map !== m) return;
            P.center = { lat: c.lat, lng: c.lng }; P.retry = 0;
            P.lines = els.filter(e => e.type === 'way' && e.geometry && e.geometry.length > 1 && e.tags)
                .map(e => ({ pts: e.geometry.map(g => [g.lon, g.lat]), cf: m3PowerCfg(e.tags) }));
            m3PowerBuild();
            if (!P.lines.length) m3PowerInfo('В этой области ЛЭП в OSM не найдены');
        } catch (e) {
            P.failAt = Date.now() + 20000;   // повторная попытка не раньше чем через 20 с
            m3PowerInfo('Не удалось загрузить ЛЭП: ' + e.message + ' (повтор при следующем сдвиге карты)', true);
        } finally { P.busy = false; }
    } else if (rebuild && P.lines.length) { P.retry = 0; m3PowerBuild(); }
}

function m3TreesInfo(t) { const el = m3El('m3TreesInfo'); if (el) el.textContent = t; }

function m3TreesSchedule(retry) {
    const T = m3d.trees;
    clearTimeout(T.timer);
    if (!retry) T.retry = 0;
    T.timer = setTimeout(m3TreesRebuild, retry ? 800 : 250);
}

function m3TreesClear(msg) {
    const T = m3d.trees;
    T.n = 0;
    if (T.trunk) { T.trunk.count = 0; T.crown.count = 0; }
    m3TreesInfo(msg || M3D.TREE_HINT);
    if (m3d.map) m3d.map.triggerRepaint();
}

function m3Hash(i, j) {
    let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}
function m3Rng(seed) {   // mulberry32
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function m3InPoly(x, y, rings) {   // чётно-нечётное правило: дырки в полигоне учитываются
    let inside = false;
    for (let k = 0; k < rings.length; k++) {
        const r = rings[k];
        for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
            const xi = r[a][0], yi = r[a][1], xj = r[b][0], yj = r[b][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
    }
    return inside;
}

function m3TreesRebuild() {
    const T = m3d.trees, m = m3d.map, o = m3d.opts;
    if (!m || !m3d.ready || !T.trunk) return;
    if (!o.trees) { m3TreesClear(); return; }
    if (m.getZoom() < M3D.TREE_MINZ) { m3TreesClear('Приблизьте карту (масштаб z' + M3D.TREE_MINZ + ' и крупнее), чтобы появились деревья'); return; }

    const R = 6378137, k = m3Rad;
    const mx = lng => R * lng * k;
    const my = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * k / 2));
    const invLat = y => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / k;
    const c = m.getCenter(), b = m.getBounds();
    const cosO = Math.cos(c.lat * k), cosG = Math.cos(Math.round(c.lat) * k);
    const X0 = mx(c.lng), Y0 = my(c.lat), half = 1500 / cosO;   // деревья строим в радиусе ~1,5 км от центра
    const vx0 = Math.max(mx(b.getWest()), X0 - half), vx1 = Math.min(mx(b.getEast()), X0 + half);
    const vy0 = Math.max(my(b.getSouth()), Y0 - half), vy1 = Math.min(my(b.getNorth()), Y0 + half);
    const lng0 = vx0 / (R * k), lng1 = vx1 / (R * k), lat0 = invLat(vy0), lat1 = invLat(vy1);
    const cell = Math.sqrt(10000 / Math.max(o.treeDens, 1)) / cosG;   // сторона ячейки, м (Меркатор)

    const feats = m.querySourceFeatures('gc-osm', { sourceLayer: 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]] });
    const cap = M3D.TREE_MAX, seen = new Set();
    const tm = T.trunk.instanceMatrix.array, cm = T.crown.instanceMatrix.array, cc = T.crown.instanceColor.array;
    const setM = (a, off, sx, sy, sz, x, y, z) => {
        a[off] = sx; a[off + 1] = 0; a[off + 2] = 0; a[off + 3] = 0;
        a[off + 4] = 0; a[off + 5] = sy; a[off + 6] = 0; a[off + 7] = 0;
        a[off + 8] = 0; a[off + 9] = 0; a[off + 10] = sz; a[off + 11] = 0;
        a[off + 12] = x; a[off + 13] = y; a[off + 14] = z; a[off + 15] = 1;
    };
    const useTerr = !!(o.terrain && m.queryTerrainElevation);
    const col = new THREE.Color();
    let n = 0, full = false, miss = 0, polys = 0;

    for (let fi = 0; fi < feats.length && !full; fi++) {
        const g = feats[fi].geometry;
        if (!g) continue;
        const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
        if (!list) continue;
        for (let pi = 0; pi < list.length && !full; pi++) {
            const poly = list[pi];
            let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
            poly[0].forEach(p => { if (p[0] < a0) a0 = p[0]; if (p[0] > a1) a1 = p[0]; if (p[1] < b0) b0 = p[1]; if (p[1] > b1) b1 = p[1]; });
            if (a1 < lng0 || a0 > lng1 || b1 < lat0 || b0 > lat1) continue;   // вне области построения
            polys++;
            const rings = poly.map(r => r.map(p => [mx(p[0]), my(p[1])]));
            const minX = Math.max(mx(a0), vx0), maxX = Math.min(mx(a1), vx1);
            const minY = Math.max(my(b0), vy0), maxY = Math.min(my(b1), vy1);
            for (let i = Math.floor(minX / cell); i <= Math.floor(maxX / cell) && !full; i++) {
                for (let j = Math.floor(minY / cell); j <= Math.floor(maxY / cell); j++) {
                    const key = (i + 5e6) * 1e7 + (j + 5e6);
                    if (seen.has(key)) continue;
                    const rnd = m3Rng(m3Hash(i, j));
                    const X = (i + rnd()) * cell, Y = (j + rnd()) * cell;
                    if (X < vx0 || X > vx1 || Y < vy0 || Y > vy1 || !m3InPoly(X, Y, rings)) continue;
                    seen.add(key);
                    let z = 0;
                    if (useTerr) {
                        const e = m.queryTerrainElevation([X / (R * k), invLat(Y)]);
                        if (e == null) miss++; else z = e;
                    }
                    const H = 8 + rnd() * 8, cr = 1.8 + rnd() * 1.6, tr = 0.22 + rnd() * 0.12;
                    const ex = (X - X0) * cosO, ny = (Y - Y0) * cosO, o16 = n * 16;
                    setM(tm, o16, tr, tr, H * 0.4, ex, ny, z);
                    setM(cm, o16, cr, cr, H * 0.35, ex, ny, z + H * 0.65);
                    col.setHSL(0.24 + rnd() * 0.09, 0.45 + rnd() * 0.15, 0.17 + rnd() * 0.10);
                    cc[n * 3] = col.r; cc[n * 3 + 1] = col.g; cc[n * 3 + 2] = col.b;
                    if (++n >= cap) { full = true; break; }
                }
            }
        }
    }

    T.n = n;
    T.trunk.count = n; T.crown.count = n;
    T.trunk.instanceMatrix.needsUpdate = true;
    T.crown.instanceMatrix.needsUpdate = true;
    T.crown.instanceColor.needsUpdate = true;
    T.origin = maplibregl.MercatorCoordinate.fromLngLat([c.lng, c.lat], 0);
    T.cosO = cosO;
    m.triggerRepaint();

    m3TreesInfo(n ? `Деревьев: ${n}${full ? ' (показана часть — приблизьте карту или уменьшите густоту)' : ''}`
        : (polys ? 'В этой области деревья не поместились — увеличьте густоту' : 'Лесных полигонов OSM в этой области нет (или тайлы ещё грузятся)'));
    if (miss > 0 && T.retry < 3) { T.retry++; m3TreesSchedule(true); }   // рельеф ещё грузится — пересаживаем деревья на землю
}

function m3AddModel(obj, name) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    obj.position.set(-ctr.x, -box.min.y - size.y / 2, -ctr.z);   // центр по горизонтали; вращение (наклон / крен) идёт вокруг центра модели
    const pivot = new THREE.Group(), tilt = new THREE.Group();
    tilt.position.y = size.y / 2;   // основание модели лежит на «земле» (y = 0 группы pivot)
    tilt.add(obj);
    pivot.add(tilt);
    const scene = m3MakeScene();
    scene.add(pivot);
    const c = m3d.map.getCenter();
    const it = {
        id: m3d.nextId++, kind: 'model', name: name || 'Модель', lng: c.lng, lat: c.lat,
        alt: 0, scale: (maxDim < 0.5 || maxDim > 500) ? 30 / maxDim : 1, heading: 0, pitch: 0, roll: 0, spin: 0, visible: true, scene: scene, pivot: pivot, tilt: tilt
    };
    m3d.items.push(it);
    m3Select(it.id);
    updateStatus(`🧊 Модель «${it.name}» добавлена в центр карты. Выделяйте и двигайте её мышью (или кнопкой «Переместить»)`);
}

// ---------- Готовые 3D-модели для визуала (агрономическая тема) ----------
// Модели собираются в браузере из простых форм three.js (файлы не нужны), размеры — в метрах.
// Кнопка в панели «3D» добавляет модель и включает режим постановки: клик по карте ставит её на землю.
function m3PMat(color, extra) {
    const c = new THREE.Color(color);
    if (c.convertSRGBToLinear) c.convertSRGBToLinear();   // рендер идёт с sRGB-выводом — цвета из hex иначе выглядят блёклыми
    return new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8, metalness: 0.08 }, extra || {}));
}
function m3PBox(g, w, h, d, color, x, y, z, extra) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m3PMat(color, extra));
    m.position.set(x, y, z);
    g.add(m);
    return m;
}
function m3PCyl(g, rt, rb, h, color, x, y, z, axis, seg, extra) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 24), m3PMat(color, extra));
    m.position.set(x, y, z);
    if (axis === 'x') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.x = Math.PI / 2;
    g.add(m);
    return m;
}
function m3PWheel(g, r, w, x, y, z, hub) {
    m3PCyl(g, r, r, w, 0x1f2937, x, y, z, 'x', 28);
    m3PCyl(g, r * 0.55, r * 0.55, w + 0.04, hub || 0xfacc15, x, y, z, 'x', 20);
}
// профиль «двускатный дом» (стены + крыша), выдавленный вдоль оси Z
function m3PGable(w, wall, ridge, len, color, extra) {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, wall); sh.lineTo(0, ridge); sh.lineTo(-w / 2, wall); sh.lineTo(-w / 2, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false });
    geo.translate(0, 0, -len / 2);
    return new THREE.Mesh(geo, m3PMat(color, extra));
}

function m3PresetTractor() {
    const g = new THREE.Group(), GREEN = 0x2f9e44, GLASS = 0x1e3a5f;
    m3PWheel(g, 0.85, 0.55, 1.1, 0.85, -0.9);  m3PWheel(g, 0.85, 0.55, -1.1, 0.85, -0.9);
    m3PWheel(g, 0.52, 0.35, 0.95, 0.52, 1.5);  m3PWheel(g, 0.52, 0.35, -0.95, 0.52, 1.5);
    m3PBox(g, 1.1, 0.9, 2.2, GREEN, 0, 1.35, 1.1);                 // капот
    m3PBox(g, 0.9, 0.7, 0.06, 0x111827, 0, 1.3, 2.23);             // решётка
    m3PBox(g, 1.4, 0.7, 2.2, GREEN, 0, 1.1, -0.5);                 // корпус
    m3PBox(g, 1.5, 1.5, 1.5, GREEN, 0, 2.2, -0.7);                 // кабина
    m3PBox(g, 1.54, 0.9, 1.2, GLASS, 0, 2.3, -0.7);                // стёкла
    m3PBox(g, 1.7, 0.12, 1.8, 0xf1f5f9, 0, 3.0, -0.7);             // крыша
    m3PBox(g, 0.5, 0.08, 1.2, GREEN, 1.1, 1.78, -0.9);             // крылья
    m3PBox(g, 0.5, 0.08, 1.2, GREEN, -1.1, 1.78, -0.9);
    m3PCyl(g, 0.07, 0.07, 1.0, 0x111827, 0.35, 2.15, 1.6);         // выхлопная труба
    m3PBox(g, 0.4, 0.3, 0.5, 0x374151, 0, 0.7, -2.0);              // сцепка
    return g;
}

function m3PresetCombine() {
    const g = new THREE.Group(), GREEN = 0x15803d, GLASS = 0x1e3a5f, YEL = 0xfacc15;
    m3PWheel(g, 1.0, 0.7, 1.4, 1.0, 1.3, YEL);  m3PWheel(g, 1.0, 0.7, -1.4, 1.0, 1.3, YEL);
    m3PWheel(g, 0.65, 0.5, 1.2, 0.65, -3.0, YEL); m3PWheel(g, 0.65, 0.5, -1.2, 0.65, -3.0, YEL);
    m3PBox(g, 2.8, 1.8, 5.2, GREEN, 0, 2.2, -0.6);                 // корпус
    m3PBox(g, 2.4, 1.2, 2.6, GREEN, 0, 3.7, -1.8);                 // зерновой бункер
    m3PCyl(g, 0.2, 0.2, 4.0, 0x94a3b8, 1.8, 4.6, -1.8, 'x');      // выгрузной шнек
    m3PCyl(g, 0.2, 0.2, 1.4, 0x94a3b8, -0.1, 4.0, -1.8);
    m3PBox(g, 1.7, 1.5, 1.6, GREEN, 0, 3.1, 1.4);                  // кабина
    m3PBox(g, 1.74, 0.95, 1.3, GLASS, 0, 3.2, 1.5);                // стёкла
    m3PBox(g, 1.9, 0.12, 1.9, 0xf1f5f9, 0, 3.9, 1.4);              // крыша
    m3PBox(g, 2.4, 1.0, 2.0, GREEN, 0, 1.6, 2.9);                  // наклонная камера
    m3PBox(g, 6.0, 0.9, 1.2, YEL, 0, 0.75, 4.3);                   // жатка
    m3PCyl(g, 0.45, 0.45, 6.0, 0xf59e0b, 0, 1.5, 4.4, 'x', 20);    // мотовило
    return g;
}

function m3PresetTruck() {
    const g = new THREE.Group(), BLUE = 0x1d4ed8;
    m3PBox(g, 2.2, 0.35, 8.5, 0x374151, 0, 0.9, 0);                // рама
    m3PBox(g, 2.4, 2.2, 2.0, BLUE, 0, 2.2, 3.2);                   // кабина
    m3PBox(g, 2.44, 0.8, 1.5, 0x1e3a5f, 0, 2.7, 3.45);             // стёкла
    m3PBox(g, 2.0, 0.9, 0.9, BLUE, 0, 1.6, 4.4);                   // капот
    m3PWheel(g, 0.55, 0.4, 1.15, 0.55, 3.6, 0xd1d5db);  m3PWheel(g, 0.55, 0.4, -1.15, 0.55, 3.6, 0xd1d5db);
    [-0.6, -2.0, -3.4].forEach(z => { m3PWheel(g, 0.55, 0.4, 1.15, 0.55, z, 0xd1d5db); m3PWheel(g, 0.55, 0.4, -1.15, 0.55, z, 0xd1d5db); });
    m3PBox(g, 2.5, 0.15, 5.8, 0x6b7280, 0, 1.15, -1.3);            // пол кузова
    m3PBox(g, 0.12, 1.5, 5.8, 0xd1d5db, 1.25, 1.9, -1.3);          // борта
    m3PBox(g, 0.12, 1.5, 5.8, 0xd1d5db, -1.25, 1.9, -1.3);
    m3PBox(g, 2.5, 1.5, 0.12, 0xd1d5db, 0, 1.9, 1.55);
    m3PBox(g, 2.5, 1.5, 0.12, 0xd1d5db, 0, 1.9, -4.15);
    m3PBox(g, 2.3, 0.5, 5.6, 0xfbbf24, 0, 2.4, -1.3);              // зерно
    return g;
}

function m3PresetBarn() {
    const g = new THREE.Group(), W = 12, L = 20;
    g.add(m3PGable(W, 6, 10, L, 0xb91c1c));                        // стены
    [-1, 1].forEach(k => {                                         // крыша
        const roof = m3PBox(g, 7.6, 0.25, L + 0.8, 0x475569, k * 3.05, 8.05, 0);
        roof.rotation.z = -k * Math.atan(4 / 6);
    });
    m3PBox(g, 4.2, 4.4, 0.12, 0x7f1d1d, 0, 2.2, L / 2 + 0.05);     // ворота
    m3PBox(g, 4.7, 0.3, 0.14, 0xf8fafc, 0, 4.55, L / 2 + 0.06);    // белая окантовка
    m3PBox(g, 0.3, 4.4, 0.14, 0xf8fafc, 2.3, 2.2, L / 2 + 0.06);
    m3PBox(g, 0.3, 4.4, 0.14, 0xf8fafc, -2.3, 2.2, L / 2 + 0.06);
    m3PBox(g, 1.2, 1.2, 0.12, 0xf8fafc, 0, 7.4, L / 2 + 0.05);     // слуховое окно
    return g;
}

function m3PresetSilo() {
    const g = new THREE.Group(), R = 3, H = 14;
    m3PBox(g, 7.2, 0.4, 7.2, 0x9ca3af, 0, 0.2, 0);                 // основание
    m3PCyl(g, R, R, H, 0xcbd5e1, 0, 0.4 + H / 2, 0, null, 36);     // башня
    for (let i = 1; i <= 6; i++) m3PCyl(g, R + 0.06, R + 0.06, 0.15, 0x94a3b8, 0, 0.4 + i * H / 7, 0, null, 36);   // кольца
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), m3PMat(0xb91c1c));
    dome.position.set(0, 0.4 + H, 0);
    g.add(dome);
    m3PBox(g, 0.5, H + 1, 0.12, 0x6b7280, R + 0.1, 0.4 + (H + 1) / 2, 0);   // лестница
    m3PCyl(g, 0.45, 0.45, 2.4, 0x94a3b8, -R - 0.4, 2.0, 0, null, 16);        // разгрузочный узел
    return g;
}

function m3PresetHangar() {
    const g = new THREE.Group(), R = 8, L = 24;
    const shell = new THREE.CylinderGeometry(R, R, L, 40, 1, true, Math.PI / 2, Math.PI);
    shell.rotateX(Math.PI / 2);
    g.add(new THREE.Mesh(shell, m3PMat(0xcbd5e1, { side: THREE.DoubleSide })));
    [-1, 1].forEach(k => {
        const wall = new THREE.Mesh(new THREE.CircleGeometry(R, 40, 0, Math.PI), m3PMat(0xe2e8f0, { side: THREE.DoubleSide }));
        wall.position.z = k * L / 2;
        g.add(wall);
    });
    m3PBox(g, 8, 5.2, 0.15, 0x475569, 0, 2.6, L / 2 + 0.05);       // ворота
    for (let i = -2; i <= 2; i++) m3PBox(g, 0.12, 5.2, 0.18, 0x94a3b8, i * 1.6, 2.6, L / 2 + 0.08);
    return g;
}

function m3PresetGreenhouse() {
    const g = new THREE.Group(), W = 8, L = 20, wall = 2.2, ridge = 3.8;
    const glass = m3PGable(W, wall, ridge, L, 0xdcfce7, { transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.2 });
    g.add(glass);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0xffffff }));
    g.add(edges);
    for (let i = 0; i <= 8; i++) {                                 // рёбра каркаса
        const z = -L / 2 + i * L / 8;
        m3PBox(g, 0.1, wall, 0.1, 0xf8fafc, W / 2, wall / 2, z);
        m3PBox(g, 0.1, wall, 0.1, 0xf8fafc, -W / 2, wall / 2, z);
        [-1, 1].forEach(k => {
            const r = m3PBox(g, Math.hypot(W / 2, ridge - wall), 0.08, 0.1, 0xf8fafc, k * W / 4, (wall + ridge) / 2, z);
            r.rotation.z = -k * Math.atan((ridge - wall) / (W / 2));
        });
    }
    [-2.4, 0, 2.4].forEach(x => m3PBox(g, 1.2, 0.6, L - 1.5, 0x22c55e, x, 0.3, 0));   // грядки
    return g;
}

function m3PresetWindmill() {
    const g = new THREE.Group(), H = 40;
    m3PCyl(g, 0.5, 0.95, H, 0xf8fafc, 0, H / 2, 0, null, 24);      // башня
    m3PBox(g, 1.7, 1.7, 4.2, 0xe5e7eb, 0, H + 0.6, 0.4);           // гондола
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14), m3PMat(0xf8fafc));
    hub.position.set(0, H + 0.6, 2.7);
    g.add(hub);
    for (let k = 0; k < 3; k++) {                                  // лопасти
        const arm = new THREE.Group();
        arm.position.set(0, H + 0.6, 2.9);
        arm.rotation.z = k * 2 * Math.PI / 3 + 0.35;
        const blade = m3PBox(arm, 0.7, 20, 0.18, 0xf8fafc, 0, 10.5, 0);
        blade.scale.x = 1;
        g.add(arm);
    }
    return g;
}

function m3PresetTower() {
    const g = new THREE.Group();
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(p => m3PCyl(g, 0.3, 0.3, 16, 0x6b7280, p[0] * 2.4, 8, p[1] * 2.4, null, 12));   // опоры
    [5, 10, 15].forEach(y => {                                     // обвязка
        m3PBox(g, 4.9, 0.2, 0.2, 0x6b7280, 0, y, 2.4);  m3PBox(g, 4.9, 0.2, 0.2, 0x6b7280, 0, y, -2.4);
        m3PBox(g, 0.2, 0.2, 4.9, 0x6b7280, 2.4, y, 0);  m3PBox(g, 0.2, 0.2, 4.9, 0x6b7280, -2.4, y, 0);
    });
    m3PCyl(g, 3.2, 3.2, 4.2, 0x64748b, 0, 18.1, 0, null, 36);      // бак
    m3PCyl(g, 3.25, 3.25, 0.9, 0x38bdf8, 0, 18.1, 0, null, 36);    // голубой пояс
    m3PCyl(g, 0.2, 3.4, 1.8, 0x475569, 0, 21.1, 0, null, 36);      // крыша
    m3PCyl(g, 0.25, 0.25, 16, 0x94a3b8, 0, 8, 0, null, 12);        // стояк
    return g;
}

function m3PresetHay() {
    const g = new THREE.Group(), HAY = 0xeab308, R = 0.9, W = 1.2;
    const bale = (y, z) => {
        m3PCyl(g, R, R, W, HAY, 0, y, z, 'x', 28);
        m3PCyl(g, R * 0.93, R * 0.93, W + 0.02, 0xca8a04, 0, y, z, 'x', 28);   // торцы потемнее
        m3PCyl(g, R * 0.97, R * 0.97, W * 0.82, HAY, 0, y, z, 'x', 28);
    };
    [-1.95, 0, 1.95].forEach(z => bale(R, z));
    [-0.97, 0.97].forEach(z => bale(R + 1.55, z));
    return g;
}

function m3PresetIrrigation() {
    const g = new THREE.Group(), LEN = 100, STEP = 20;
    m3PCyl(g, 0.2, 0.2, LEN, 0xe5e7eb, 0, 3.6, 0, 'x', 12);        // труба с водой
    m3PBox(g, LEN, 0.1, 0.1, 0x9ca3af, 0, 4.2, 0);                 // верхний пояс фермы
    for (let x = -LEN / 2; x <= LEN / 2 + 0.01; x += STEP) {       // опоры на колёсах
        m3PBox(g, 0.18, 3.6, 0.18, 0x6b7280, x, 1.8, 0.9);
        m3PBox(g, 0.18, 3.6, 0.18, 0x6b7280, x, 1.8, -0.9);
        m3PBox(g, 0.15, 0.15, 2.0, 0x6b7280, x, 2.2, 0);
        m3PWheel(g, 0.6, 0.3, x, 0.6, 1.5, 0x9ca3af);  m3PWheel(g, 0.6, 0.3, x, 0.6, -1.5, 0x9ca3af);
    }
    for (let x = -LEN / 2 + 2.5; x < LEN / 2; x += 5) {            // спуски с форсунками
        m3PCyl(g, 0.03, 0.03, 2.2, 0x111827, x, 2.5, 0, null, 6);
        const nz = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), m3PMat(0x38bdf8));
        nz.position.set(x, 1.35, 0);
        g.add(nz);
    }
    return g;
}

function m3PresetSprayer() {
    const g = new THREE.Group(), RED = 0xdc2626, WHITE = 0xf1f5f9, GLASS = 0x1e3a5f;
    [[1.55, 1.9], [-1.55, 1.9], [1.55, -1.9], [-1.55, -1.9]].forEach(w => m3PWheel(g, 1.0, 0.55, w[0], 1.0, w[1], 0xfacc15));
    m3PBox(g, 2.2, 0.5, 5.6, 0x374151, 0, 1.7, 0);                 // рама
    m3PBox(g, 1.9, 1.7, 1.7, RED, 0, 2.9, 1.9);                    // кабина
    m3PBox(g, 1.94, 0.9, 1.3, GLASS, 0, 3.1, 1.95);                // стёкла
    m3PBox(g, 2.1, 0.12, 1.9, WHITE, 0, 3.8, 1.9);                 // крыша
    m3PBox(g, 1.6, 0.9, 1.3, RED, 0, 2.4, 3.2);                    // капот
    m3PCyl(g, 1.0, 1.0, 3.4, WHITE, 0, 3.0, -1.4, 'z', 24);        // бак
    m3PBox(g, 0.3, 0.3, 1.0, 0x6b7280, 0, 1.5, -3.2);              // крепление штанги
    m3PBox(g, 24, 0.1, 0.1, 0x6b7280, 0, 1.3, -3.6);               // штанга
    for (let x = -11.5; x <= 11.6; x += 1.5) m3PCyl(g, 0.04, 0.04, 0.35, 0x111827, x, 1.1, -3.6, null, 6);   // форсунки
    return g;
}

function m3PresetHouse() {
    const g = new THREE.Group(), W = 9, L = 7;
    g.add(m3PGable(W, 3, 5.2, L, 0xe8dcc0));                       // стены
    [-1, 1].forEach(k => {                                         // крыша
        const roof = m3PBox(g, 5.4, 0.22, L + 0.8, 0xa33b2a, k * 2.3, 4.15, 0);
        roof.rotation.z = -k * Math.atan(2.2 / 4.5);
    });
    m3PBox(g, 1.1, 2.1, 0.12, 0x7c4a21, 0, 1.05, L / 2 + 0.05);    // дверь
    [-2.6, 2.6].forEach(x => m3PBox(g, 1.2, 1.1, 0.12, 0x7dd3fc, x, 1.7, L / 2 + 0.05));   // окна спереди
    [-1, 1].forEach(k => m3PBox(g, 0.12, 1.1, 1.2, 0x7dd3fc, k * (W / 2 + 0.05), 1.7, 0));  // окна по бокам
    m3PBox(g, 0.7, 1.6, 0.7, 0x9a3412, 2.2, 5.0, -1.5);            // труба
    return g;
}

function m3PresetCar() {
    const g = new THREE.Group(), BODY = 0x2563eb, GLASS = 0x1e3a5f;
    [[0.9, 1.3], [-0.9, 1.3], [0.9, -1.3], [-0.9, -1.3]].forEach(w => m3PWheel(g, 0.34, 0.24, w[0], 0.34, w[1], 0xd1d5db));
    m3PBox(g, 1.8, 0.65, 4.3, BODY, 0, 0.72, 0);                   // кузов
    m3PBox(g, 1.6, 0.6, 2.2, BODY, 0, 1.3, -0.2);                  // салон
    m3PBox(g, 1.64, 0.46, 1.9, GLASS, 0, 1.32, -0.2);              // стёкла
    [-1, 1].forEach(k => {
        m3PBox(g, 0.35, 0.18, 0.06, 0xfef08a, k * 0.6, 0.85, 2.17);   // фары
        m3PBox(g, 0.35, 0.18, 0.06, 0xdc2626, k * 0.6, 0.85, -2.17);  // стоп-сигналы
    });
    return g;
}

function m3PresetTree() {
    const g = new THREE.Group();
    m3PCyl(g, 0.22, 0.32, 2.6, 0x6b4423, 0, 1.3, 0, null, 8);      // ствол
    m3PCyl(g, 0, 2.2, 3.4, 0x2f7d32, 0, 3.7, 0, null, 10);         // ярусы кроны
    m3PCyl(g, 0, 1.8, 3.0, 0x388e3c, 0, 5.4, 0, null, 10);
    m3PCyl(g, 0, 1.3, 2.6, 0x43a047, 0, 7.0, 0, null, 10);
    return g;
}

function m3PresetTank() {
    const g = new THREE.Group(), R = 1.5, L = 7;
    m3PCyl(g, R, R, L, 0xe5e7eb, 0, R + 0.9, 0, 'z', 28);          // горизонтальная ёмкость
    [-1, 1].forEach(k => {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12), m3PMat(0xe5e7eb));
        cap.position.set(0, R + 0.9, k * L / 2);
        cap.scale.set(1, 1, 0.4);
        g.add(cap);
    });
    [-2.4, 2.4].forEach(z => m3PBox(g, 2.4, 0.9, 0.35, 0x6b7280, 0, 0.45, z));   // опоры
    m3PCyl(g, 0.4, 0.4, 0.3, 0x6b7280, 0, 4.0, 0, null, 12);       // люк
    return g;
}

function m3PresetPole() {
    const g = new THREE.Group();
    m3PCyl(g, 0.2, 0.3, 14, 0x78716c, 0, 7, 0, null, 10);          // опора
    m3PBox(g, 5.2, 0.22, 0.22, 0x57534e, 0, 12.8, 0);              // траверсы
    m3PBox(g, 3.4, 0.2, 0.2, 0x57534e, 0, 11.2, 0);
    [-2.4, 0, 2.4].forEach(x => m3PCyl(g, 0.09, 0.09, 0.6, 0xe0f2fe, x, 13.25, 0, null, 8));   // изоляторы
    [-1.5, 1.5].forEach(x => m3PCyl(g, 0.09, 0.09, 0.6, 0xe0f2fe, x, 11.6, 0, null, 8));
    return g;
}

function m3PresetCow() {
    const g = new THREE.Group(), WH = 0xf8fafc, BK = 0x111827;
    m3PBox(g, 0.85, 0.9, 1.9, WH, 0, 1.15, 0);                     // туловище
    m3PBox(g, 0.87, 0.45, 0.6, BK, 0, 1.3, 0.4);                   // пятна
    m3PBox(g, 0.87, 0.4, 0.55, BK, 0, 1.4, -0.55);
    m3PBox(g, 0.5, 0.55, 0.6, WH, 0, 1.45, 1.2);                   // голова
    m3PBox(g, 0.3, 0.2, 0.2, 0xf9a8d4, 0, 1.3, 1.55);              // морда
    [-1, 1].forEach(k => m3PBox(g, 0.08, 0.18, 0.08, 0xfef3c7, k * 0.2, 1.8, 1.1));   // рога
    [[0.28, 0.7], [-0.28, 0.7], [0.28, -0.7], [-0.28, -0.7]].forEach((l, i) => m3PBox(g, 0.16, 0.7, 0.16, i % 3 ? BK : WH, l[0], 0.35, l[1]));   // ноги
    m3PBox(g, 0.06, 0.6, 0.06, BK, 0, 1.2, -1.0);                  // хвост
    return g;
}

const M3_PRESETS = {
    tractor:    { name: 'Трактор',             build: m3PresetTractor },
    combine:    { name: 'Комбайн',             build: m3PresetCombine },
    truck:      { name: 'Зерновоз',            build: m3PresetTruck },
    barn:       { name: 'Амбар',               build: m3PresetBarn },
    silo:       { name: 'Силос',               build: m3PresetSilo },
    hangar:     { name: 'Ангар',               build: m3PresetHangar },
    greenhouse: { name: 'Теплица',             build: m3PresetGreenhouse },
    windmill:   { name: 'Ветрогенератор',      build: m3PresetWindmill },
    tower:      { name: 'Водонапорная башня',  build: m3PresetTower },
    hay:        { name: 'Рулоны сена',         build: m3PresetHay },
    irrigation: { name: 'Поливная машина',     build: m3PresetIrrigation },
    sprayer:    { name: 'Опрыскиватель',       build: m3PresetSprayer },
    house:      { name: 'Жилой дом',           build: m3PresetHouse },
    car:        { name: 'Автомобиль',          build: m3PresetCar },
    tree:       { name: 'Дерево',              build: m3PresetTree },
    tank:       { name: 'Ёмкость',             build: m3PresetTank },
    pole:       { name: 'Опора ЛЭП',           build: m3PresetPole },
    cow:        { name: 'Корова',              build: m3PresetCow }
};

function m3AddPreset(key) {
    const p = M3_PRESETS[key];
    if (!p) return;
    if (!m3d.active || !m3d.map) { updateStatus('ℹ️ Модели добавляются в 3D-режиме — включите 3D кнопкой «3D» на карте', true); return; }
    if (typeof THREE === 'undefined') { updateStatus('⚠️ Three.js не загрузился — проверьте подключение к интернету', true); return; }
    m3AddModel(p.build(), p.name);
    m3StartPlacing();   // сразу ждём клик по карте — туда модель и встанет
}

function m3ImportModel(file) {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) {
        updateStatus('⚠️ Three.js / GLTFLoader не загрузились — проверьте подключение к интернету', true);
        return;
    }
    const isText = /\.gltf$/i.test(file.name);
    const rd = new FileReader();
    rd.onload = () => {
        try {
            new THREE.GLTFLoader().parse(rd.result, '', gltf => m3AddModel(gltf.scene, file.name.replace(/\.[^.]+$/, '')),
                err => updateStatus('⚠️ Не удалось прочитать модель: ' + ((err && err.message) || err), true));
        } catch (err) {
            updateStatus('⚠️ Не удалось прочитать модель: ' + err.message, true);
        }
    };
    if (isText) rd.readAsText(file); else rd.readAsArrayBuffer(file);
}

// ---------- Импорт GeoJSON / KML с выдавливанием в 3D ----------
function m3ImportVector(file) {
    const rd = new FileReader();
    rd.onload = () => {
        try {
            let gj;
            if (/\.kml$/i.test(file.name)) {
                gj = toGeoJSON.kml(new DOMParser().parseFromString(rd.result, 'text/xml'));
            } else {
                gj = JSON.parse(rd.result);
            }
            m3AddExtrusion(gj, file.name.replace(/\.[^.]+$/, ''));
        } catch (err) {
            updateStatus('⚠️ Не удалось прочитать файл: ' + err.message, true);
        }
    };
    rd.readAsText(file);
}

function m3AddExtrusion(gj, name) {
    const src = gj.type === 'FeatureCollection' ? gj.features
        : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }];
    const def = parseFloat(m3El('m3ImpH').value) || 20;
    const color = m3El('m3ImpColor').value || '#f59e0b';
    const out = [];
    src.forEach(f => {
        if (!f || !f.geometry) return;
        let ft = f;
        const t = f.geometry.type;
        if (/Point|LineString/.test(t)) {   // точки и линии превращаем в узкие колонны / стенки
            if (!window.turf) return;
            try { ft = turf.buffer(f, /Point/.test(t) ? 4 : 2, { units: 'meters' }); } catch (e) { return; }
        }
        if (!ft || !ft.geometry || !/Polygon/.test(ft.geometry.type)) return;
        const p = f.properties || {};
        let h = parseFloat([p.height, p.Height, p.HEIGHT, p.h, p['building:height'], p.render_height].find(v => v != null && isFinite(parseFloat(v))));
        if (!isFinite(h)) {
            const lv = parseFloat(p['building:levels'] != null ? p['building:levels'] : p.levels);
            h = isFinite(lv) ? lv * 3 : def;
        }
        out.push({ type: 'Feature', properties: { __h: h }, geometry: ft.geometry });
    });
    if (!out.length) { updateStatus('⚠️ В файле нет полигонов (или линий/точек) для выдавливания', true); return; }
    const fc = { type: 'FeatureCollection', features: out };
    const m = m3d.map, id = m3d.nextId++;
    const it = {
        id: id, kind: 'ext', name: name || 'Выдавливание', srcId: 'gc-ex-' + id, layerId: 'gc-exl-' + id,
        hmul: 1, base: 0, color: color, opacity: 0.88, visible: true, count: out.length,
        bbox: window.turf ? turf.bbox(fc) : null, fc: fc
    };
    m.addSource(it.srcId, { type: 'geojson', data: fc });
    m.addLayer({ id: it.layerId, type: 'fill-extrusion', source: it.srcId, paint: {} }, m.getLayer('gc-models') ? 'gc-models' : undefined);
    m3d.items.push(it);
    m3UpdateExtPaint(it);
    m3Select(id);
    if (it.bbox) m.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { padding: 80, maxZoom: 18, pitch: Math.max(m.getPitch(), 50) });
    updateStatus(`🏢 «${it.name}»: выдавлено объектов — ${it.count}`);
}

function m3UpdateExtPaint(it) {
    const m = m3d.map;
    if (!m || !m.getLayer(it.layerId)) return;
    m.setPaintProperty(it.layerId, 'fill-extrusion-height', ['+', it.base, ['*', it.hmul, ['get', '__h']]]);
    m.setPaintProperty(it.layerId, 'fill-extrusion-base', it.base);
    m.setPaintProperty(it.layerId, 'fill-extrusion-color', it.color);
    m.setPaintProperty(it.layerId, 'fill-extrusion-opacity', it.opacity);
    m.setLayoutProperty(it.layerId, 'visibility', it.visible ? 'visible' : 'none');
    // полупрозрачная маска на выделенном объекте
    const sid = it.layerId + '-sel';
    if (it.id === m3d.selected && it.visible) {
        if (!m.getLayer(sid)) m.addLayer({ id: sid, type: 'fill-extrusion', source: it.srcId, paint: {} }, m.getLayer('gc-models') ? 'gc-models' : undefined);
        m.setPaintProperty(sid, 'fill-extrusion-height', ['+', it.base, ['*', it.hmul, ['get', '__h']], 0.3]);
        m.setPaintProperty(sid, 'fill-extrusion-base', it.base);
        m.setPaintProperty(sid, 'fill-extrusion-color', '#3b82f6');
        m.setPaintProperty(sid, 'fill-extrusion-opacity', 0.4);
    } else if (m.getLayer(sid)) {
        m.removeLayer(sid);
    }
}

// ---------- Список импортированных объектов и «Выбранный объект» ----------
// плавное вращение выбранных моделей вокруг вертикальной оси (ползунок «Вращение», °/с)
let m3SpinRaf = 0, m3SpinT = 0;
function m3SpinTick(t) {
    m3SpinRaf = 0;
    const list = m3d.items.filter(i => i.kind === 'model' && i.spin);
    if (!list.length || !m3d.map) { m3SpinT = 0; return; }
    const dt = m3SpinT ? Math.min(0.1, (t - m3SpinT) / 1000) : 0;
    m3SpinT = t;
    list.forEach(it => {
        it.heading = ((it.heading + it.spin * dt + 180) % 360 + 360) % 360 - 180;
        it.pivot.rotation.y = -it.heading * m3Rad;
    });
    const sel = m3Selected();
    if (sel && sel.spin) { const h = document.getElementById('m3SelHeading'), hv = document.getElementById('m3SelHeadingVal'); if (h) h.value = sel.heading; if (hv) hv.textContent = Math.round(sel.heading) + '°'; }
    m3d.map.triggerRepaint();
    m3SpinRaf = requestAnimationFrame(m3SpinTick);
}
function m3SpinKick() { if (!m3SpinRaf) { m3SpinT = 0; m3SpinRaf = requestAnimationFrame(m3SpinTick); } }
function m3Selected() { return m3d.items.find(i => i.id === m3d.selected) || null; }

function m3RenderList() {
    const box = m3El('m3List');
    if (!box) return;
    if (!m3d.items.length) {
        box.innerHTML = '<div class="m3-empty">Пока нет импортированных объектов</div>';
        return;
    }
    box.innerHTML = m3d.items.map(it => `
        <div class="m3-item${it.id === m3d.selected ? ' sel' : ''}" data-id="${it.id}">
            <i class="fas ${it.kind === 'model' ? 'fa-cube' : 'fa-building'}"></i>
            <span class="m3-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
            <button type="button" data-act="vis" title="Показать / скрыть"><i class="fas ${it.visible ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
            <button type="button" data-act="fly" title="Перейти к объекту"><i class="fas fa-location-crosshairs"></i></button>
        </div>`).join('');
}

function m3SyncSelectedUI() {
    const it = m3Selected();
    const set = (id, fn) => { const el = m3El(id); if (el) fn(el); };
    set('m3SelBlock', el => el.classList.toggle('dw-dim', !it));
    ['m3SelScale', 'm3SelHeading', 'm3SelPitch', 'm3SelRoll', 'm3SelSpin', 'm3SelAlt', 'm3SelColor', 'm3MoveBtn', 'm3DelBtn'].forEach(id => set(id, el => { el.disabled = !it; }));
    set('m3SelName', el => { el.textContent = it ? it.name : 'не выбран'; });
    if (!it) return;
    const scale = it.kind === 'model' ? it.scale : it.hmul;
    set('m3SelScale', el => { el.value = Math.log10(scale); });
    set('m3SelScaleVal', el => { el.textContent = '×' + (scale < 10 ? scale.toFixed(2) : scale.toFixed(1)); });
    set('m3SelHeading', el => { el.value = it.heading || 0; el.disabled = it.kind !== 'model'; });
    set('m3SelHeadingVal', el => { el.textContent = Math.round(it.heading || 0) + '°'; });
    set('m3SelPitch', el => { el.value = it.pitch || 0; el.disabled = it.kind !== 'model'; });
    set('m3SelPitchVal', el => { el.textContent = Math.round(it.pitch || 0) + '°'; });
    set('m3SelRoll', el => { el.value = it.roll || 0; el.disabled = it.kind !== 'model'; });
    set('m3SelRollVal', el => { el.textContent = Math.round(it.roll || 0) + '°'; });
    set('m3SelSpin', el => { el.value = it.spin || 0; el.disabled = it.kind !== 'model'; });
    set('m3SelSpinVal', el => { el.textContent = it.spin ? (it.spin > 0 ? '↻ ' : '↺ ') + Math.abs(Math.round(it.spin)) + '°/с' : 'выкл'; });
    set('m3SelAlt', el => { el.value = it.kind === 'model' ? it.alt : it.base; });
    set('m3SelAltVal', el => { el.textContent = Math.round(it.kind === 'model' ? it.alt : it.base) + ' м'; });
    set('m3SelColor', el => { el.value = it.color || '#f59e0b'; el.disabled = it.kind !== 'ext'; });
    set('m3MoveBtn', el => { el.disabled = it.kind !== 'model'; });
}

// Выделить объект (null — снять выделение): в списке, в блоке «Выбранный» и маской на карте
function m3Select(id) {
    m3d.selected = id;
    m3RenderList();
    m3SyncSelectedUI();
    m3d.items.forEach(i => { if (i.kind === 'ext') m3UpdateExtPaint(i); });
    if (m3d.map) m3d.map.triggerRepaint();
}

// Модель под курсором: луч через сцену three.js, запасной вариант — близость к точке привязки (до ~28 px)
function m3PickModel(pt) {
    const m = m3d.map, models = m3d.items.filter(i => i.kind === 'model' && i.visible);
    if (!models.length) return null;
    let best = null, bz = Infinity;
    if (typeof THREE !== 'undefined' && m3d.projM) {
        const cv = m.getCanvas(), nx = pt.x / cv.clientWidth * 2 - 1, ny = 1 - pt.y / cv.clientHeight * 2;
        const proj = new THREE.Matrix4().fromArray(m3d.projM), rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
        models.forEach(it => {
            try {
                const ground = (m3d.opts.terrain && m.queryTerrainElevation) ? (m.queryTerrainElevation([it.lng, it.lat]) || 0) : 0;
                const mc = maplibregl.MercatorCoordinate.fromLngLat([it.lng, it.lat], ground + it.alt);
                const s = mc.meterInMercatorCoordinateUnits() * it.scale;
                const l = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s)).multiply(rotX);
                const pm = proj.clone().multiply(l), inv = pm.clone().invert();
                const a = new THREE.Vector3(nx, ny, -1).applyMatrix4(inv), b = new THREE.Vector3(nx, ny, 1).applyMatrix4(inv);
                const rc = new THREE.Raycaster(a, b.clone().sub(a).normalize(), 0, Infinity);
                const hit = rc.intersectObject(it.scene, true)[0];
                if (!hit) return;
                const z = hit.point.clone().applyMatrix4(pm).z;
                if (z < bz) { bz = z; best = it; }
            } catch (err) { /* модель пропускаем */ }
        });
    }
    if (best) return best;
    let nd = 28;
    models.forEach(it => {
        const q = m.project([it.lng, it.lat]), d = Math.hypot(q.x - pt.x, q.y - pt.y);
        if (d < nd) { nd = d; best = it; }
    });
    return best;
}

function m3PickItem(pt) {
    const m = m3d.map;
    if (!m || !m3d.ready || !m3d.items.length) return null;
    const mod = m3PickModel(pt);
    if (mod) return mod;
    const ids = m3d.items.filter(i => i.kind === 'ext' && i.visible && m.getLayer(i.layerId)).map(i => i.layerId);
    if (!ids.length) return null;
    const f = m.queryRenderedFeatures(pt, { layers: ids })[0];
    return f ? (m3d.items.find(i => i.layerId === f.layer.id) || null) : null;
}

function m3ShiftCoords(c, dx, dy) {
    if (typeof c[0] === 'number') { c[0] += dx; c[1] += dy; } else c.forEach(x => m3ShiftCoords(x, dx, dy));
}

// Нажатие на модель / выдавленный объект: выделить и тянуть
function m3OnDown(e) {
    const m = m3d.map, oe = e.originalEvent;
    if (!m || m3d.placing || !m3d.items.length) return;
    if (oe && oe.type === 'mousedown' && (oe.button !== 0 || oe.ctrlKey || oe.shiftKey)) return;   // ПКМ / Ctrl+ЛКМ — поворот сцены
    if (e.points && e.points.length > 1) return;
    const it = m3PickItem(e.point);
    if (!it) return;
    if (m3d.selected !== it.id) m3Select(it.id);
    m3d.drag = { it: it, last: e.lngLat, x0: e.point.x, y0: e.point.y, moved: false };
    e.preventDefault();
    m.dragPan.disable();
    const end = () => {
        document.removeEventListener('mouseup', end);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        m3EndDrag();
    };
    document.addEventListener('mouseup', end);
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
}

function m3OnMove(e) {
    const m = m3d.map, d = m3d.drag;
    if (!d) {   // курсор над объектом: указатель / «двигать»
        if (!m3d.items.length || m3d.placing) return;
        const now = Date.now();
        if (now - (m3d.hoverT || 0) < 70) return;
        m3d.hoverT = now;
        const hit = m3PickItem(e.point);
        m.getCanvas().style.cursor = hit ? (hit.id === m3d.selected ? 'move' : 'pointer') : '';
        return;
    }
    if (!d.moved && Math.hypot(e.point.x - d.x0, e.point.y - d.y0) < 4) return;
    if (!d.moved) { d.moved = true; m.getCanvas().style.cursor = 'grabbing'; }
    const ll = e.lngLat, it = d.it, dx = ll.lng - d.last.lng, dy = ll.lat - d.last.lat;
    d.last = ll;
    if (it.kind === 'model') {
        it.lng += dx; it.lat += dy;
        m.triggerRepaint();
    } else if (it.fc) {
        it.fc.features.forEach(f => m3ShiftCoords(f.geometry.coordinates, dx, dy));
        if (it.bbox) { it.bbox[0] += dx; it.bbox[2] += dx; it.bbox[1] += dy; it.bbox[3] += dy; }
        const src = m.getSource(it.srcId);
        if (src) src.setData(it.fc);
    }
}

function m3EndDrag() {
    const d = m3d.drag;
    if (!d) return;
    m3d.drag = null;
    if (m3d.map) { m3d.map.dragPan.enable(); m3d.map.getCanvas().style.cursor = ''; }
    if (d.moved) {
        m3d.justDragged = true;
        setTimeout(() => { m3d.justDragged = false; }, 60);
        updateStatus(`🧊 «${d.it.name}» перемещён`);
    }
}

function m3RemoveItem(it) {
    const m = m3d.map;
    if (it.kind === 'ext') {
        if (m.getLayer(it.layerId + '-sel')) m.removeLayer(it.layerId + '-sel');
        if (m.getLayer(it.layerId)) m.removeLayer(it.layerId);
        if (m.getSource(it.srcId)) m.removeSource(it.srcId);
    } else if (it.scene) {
        it.scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) [].concat(o.material).forEach(mt => mt.dispose && mt.dispose());
        });
        m3d.lights = m3d.lights.filter(l => !it.scene.children.includes(l));
    }
    m3d.items = m3d.items.filter(i => i !== it);
    if (m3d.selected === it.id) m3d.selected = null;
    m.triggerRepaint();
}

function m3StartPlacing() {
    const it = m3Selected();
    if (!it || it.kind !== 'model') return;
    m3d.placing = true;
    m3El('map3d').classList.add('m3-placing');
    updateStatus('📍 Кликните по карте, чтобы поставить модель (Esc — отмена)');
}
function m3CancelPlacing() {
    m3d.placing = false;
    m3El('map3d').classList.remove('m3-placing');
}

// ---------- Камера ----------
function m3UpdateViewControls() {
    const m = m3d.map;
    if (!m) return;
    const br = ((m.getBearing() + 180) % 360 + 360) % 360 - 180;
    const btn = m3El('mode3dBtn');   // стрелка севера на кнопке «2D» поворачивается вместе со сценой
    if (btn) btn.style.setProperty('--m3b', (-br) + 'deg');
}

function m3StopOrbit() {
    if (!m3d.orbit) return;
    cancelAnimationFrame(m3d.orbit);
    m3d.orbit = 0;
    const btn = m3El('m3Orbit');
    if (btn) btn.classList.remove('active');
    if (m3d.active) m3SyncToLeaflet();
}

function m3ToggleOrbit() {
    if (!m3d.map) return;
    if (m3d.orbit) { m3StopOrbit(); return; }
    const step = () => {
        m3d.map.setBearing(m3d.map.getBearing() + 0.15);
        m3d.orbit = requestAnimationFrame(step);
    };
    m3d.orbit = requestAnimationFrame(step);
    m3El('m3Orbit').classList.add('active');
}

// ---------- Маркер «Что здесь?» ----------
function m3RemoveMarker() {
    if (m3d.marker) { m3d.marker.remove(); m3d.marker = null; }
}
function m3PutMarker(latlng) {
    if (!m3d.map) return;
    const ll = L.latLng(latlng);
    m3RemoveMarker();
    m3d.marker = new maplibregl.Marker({ color: '#ef4444' }).setLngLat([ll.lng, ll.lat]).addTo(m3d.map);
}

// ---------- Создание карты MapLibre ----------
function m3OnClick(e) {
    const m = m3d.map;
    if (m3d.placing) {
        const it = m3Selected();
        if (it && it.kind === 'model') { it.lng = e.lngLat.lng; it.lat = e.lngLat.lat; m.triggerRepaint(); }
        m3CancelPlacing();
        return;
    }
    if (m3d.justDragged) return;
    if (m3PickItem(e.point)) return;                        // объект уже выделен при нажатии
    if (m3d.selected != null) m3Select(null);               // клик по пустому месту снимает выделение
    if (!m.getLayer('gc-buildings')) return;
    const f = m.queryRenderedFeatures(e.point, { layers: ['gc-buildings'] })[0];
    if (!f) return;
    const p = f.properties || {};
    const h = Math.round(+p.render_height || 0), b = Math.round(+p.render_min_height || 0);
    new maplibregl.Popup({ maxWidth: '220px' }).setLngLat(e.lngLat)
        .setHTML(`<b>Здание (OSM)</b><br>Высота: ~${h} м${b ? `<br>Поднято над землёй: ${b} м` : ''}`).addTo(m);
}

function m3Init() {
    if (!m3d.bingReg) {
        // Bing отдаёт тайлы по quadkey — превращаем его в обычные тайлы для MapLibre
        maplibregl.addProtocol('gcbing', async params => {
            const mt = params.url.match(/^gcbing:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
            const type = mt[1], z = +mt[2], x = +mt[3], y = +mt[4];
            const res = await fetch(`https://ecn.t${(x + y) % 4}.tiles.virtualearth.net/tiles/${type}${bingQuadKey(x, y, z)}.jpeg?g=1`);
            if (!res.ok) throw new Error('Bing tile ' + res.status);
            return { data: await res.arrayBuffer() };
        });
        m3d.bingReg = true;
    }
    if (!m3d.snReg) {
        // снимки Sentinel-2 для 3D рисуются тем же кодом, что и на плоской карте
        maplibregl.addProtocol('gcsentinel', async params => {
            const mt = params.url.match(/^gcsentinel:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            await snRenderTile(mt[1], +mt[2], +mt[3], +mt[4], c);
            const blob = await new Promise(r => c.toBlob(r, 'image/png'));
            return { data: await blob.arrayBuffer() };
        });
        m3d.snReg = true;
    }
    const c = map.getCenter();
    const m = new maplibregl.Map({
        container: 'map3d',
        style: { version: 8, glyphs: M3D.GLYPHS, sources: {}, layers: [{ id: 'gc-bg', type: 'background', paint: { 'background-color': '#dfe7ee' } }] },
        center: [c.lng, c.lat], zoom: Math.max(map.getZoom() - 1, 0), bearing: m3LbToMl(getBearing()), pitch: 60,
        maxPitch: 85, maxZoom: 21, attributionControl: false, preserveDrawingBuffer: true, antialias: true
    });
    m3d.map = m;
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    m.on('load', () => {
        m3d.ready = true;
        m3AddOverlays(m);
        m3RebuildBasemap();
        m3AddUserLayers(m);
        m3AddModelLayer(m);
        m3AddTreesLayer(m);
    m3AddLabels3D(m);
    m3AddPowerLayer(m);
        m3Apply();
        m3RefreshUser();
        m3UpdateViewControls();
    });
    m.on('moveend', () => { if (m3d.active && !m3d.orbit) m3SyncToLeaflet(); });
    m.on('moveend', () => { if (m3d.opts.trees) m3TreesSchedule(); });
    m.on('sourcedata', e => { if (e.sourceId === 'gc-osm' && m3d.opts.trees) m3TreesSchedule(); });   // подгрузились тайлы OSM
    m.on('move', m3UpdateViewControls);
    m.on('moveend', () => { m3LabSchedule(); if (m3d.opts.power) m3PowerSchedule(); });
    m.on('sourcedata', e => { if (e.sourceId === 'gc-osm' && m3d.opts.labels) m3LabSchedule(); });
    m.on('click', m3OnClick);
    m.on('mousedown', m3OnDown);
    m.on('touchstart', m3OnDown);
    m.on('mousemove', m3OnMove);
    m.on('touchmove', m3OnMove);
    m.on('contextmenu', e => {   // правый клик → меню «Что здесь?»
        contextMenuLatLng = L.latLng(e.lngLat.lat, e.lngLat.lng);
        showMapContextMenu(e.originalEvent);
    });
    ['mousedown', 'touchstart', 'wheel'].forEach(ev => m.on(ev, m3StopOrbit));
}

// ---------- Включение / выключение ----------
function m3SetTabEnabled(on) {
    // вкладка «3D» доступна всегда; пока 3D выключен, её инструменты неактивны
    const pane = document.querySelector('[data-bp-pane="3d"]');
    if (!pane) return;
    pane.classList.toggle('m3-off', !on);
    pane.querySelectorAll('.dw-block:not(.m3-switch)').forEach(b => { b.inert = !on; });
    const t = m3El('m3ToggleBtn');
    if (t) {
        t.classList.toggle('on', on);
        t.querySelector('span').textContent = on ? 'Выключить 3D' : 'Включить 3D';
    }
    if (on) {
        const bp = m3El('bottomPanel');
        if (bp.classList.contains('collapsed')) m3El('bottomPanelToggle').click();
        const tab = document.querySelector('.bp-tab[data-bp-tab="3d"]');
        if (tab && !tab.classList.contains('active')) tab.click();
    }
}

// Кнопка на карте: при включённом 3D показывает «2D» (возврат к плоской карте), при выключенном — «3D»
function m3SetBtnLabel(on) {
    const b = m3El('mode3dBtn');
    if (!b) return;
    const t = b.querySelector('.m3-txt');
    if (t) t.textContent = on ? '2D' : '3D';
    b.title = on ? '2D режим: нажмите, чтобы вернуться к плоской карте. Потяните кнопку — сцена вращается (вбок) и наклоняется (вверх / вниз)' : '3D режим: включить';
}

function enter3D() {
    if (m3d.active) return;
    if (typeof maplibregl === 'undefined') {
        updateStatus('⚠️ MapLibre GL не загрузился — проверьте подключение к интернету', true);
        return;
    }
    document.querySelectorAll('.widget-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.widget-btn').forEach(b => { if (b.id !== 'mode3dBtn' && !(b.id === 'swipeBtn' && swipeState.active)) b.classList.remove('active'); });
    activePanel = null;
    try { if (measureMode) deactivateMeasureMode(); } catch (e) { /* не критично */ }
    try { if (currentTool || activeDrawHandler || isEditing || sketchState.tool) deactivateAllTools(); } catch (e) { /* не критично */ }
    hideMapContextMenu();

    m3d.active = true;
    mapStageEl.classList.add('mode-3d');
    m3d.opts.trees = true;   // при включении 3D деревья включаются автоматически
    m3PushOptsToUI();
    if (map.hasLayer(currentTileLayer)) map.removeLayer(currentTileLayer);   // тайлы теперь рисует MapLibre

    if (!m3d.map) {
        m3Init();
    } else {
        const c = map.getCenter();
        m3d.map.resize();
        m3d.map.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom() - 1, 0), bearing: m3LbToMl(getBearing()) });
        m3RebuildBasemap();
        m3RefreshUser();
        m3Apply();   // включить деревья и в уже созданной 3D-карте
    }
    if (geoMarker) m3PutMarker(geoMarker.getLatLng());

    if (swipeState.active) m3EnterSplit();   // шторка / дублирование → два 3D-окна
    m3El('mode3dBtn').classList.add('active');
    m3SetBtnLabel(true);
    m3SetTabEnabled(true);
    updateStatus('🧊 3D включён: ЛКМ — сдвиг, ПКМ / Ctrl+ЛКМ — поворот и наклон, колесо — масштаб');
}

function exit3D() {
    if (!m3d.active) return;
    m3StopOrbit();
    m3SyncToLeaflet();
    m3d.active = false;
    mapStageEl.classList.remove('mode-3d');
    m3CancelPlacing();
    m3RemoveMarker();
    m3DestroySplit();
    if (!swipeState.active && !map.hasLayer(currentTileLayer)) currentTileLayer.addTo(map);
    map.invalidateSize();
    if (swipeState.active) {   // вернуть Leaflet-половины шторки
        ['left', 'right'].forEach(side => swipeState.sides[side].map.invalidateSize({ animate: false }));
        applySwipeClip();
        syncSwipeMaps(true);
    }
    m3El('mode3dBtn').classList.remove('active');
    m3SetBtnLabel(false);
    m3SetTabEnabled(false);
    // 3D выключили, пока открыта панель «3D», — возвращаемся на главную боковой панели
    const t3 = document.querySelector('.bp-tab[data-bp-tab="3d"]'), mp = document.getElementById('mainPanel');
    if (t3 && t3.classList.contains('active') && mp && mp.getAttribute('data-view') === 'bp') {
        const home = document.querySelector('.panel-tab[data-tab="main"]');
        if (home) home.click();
    }
    updateStatus(`🧊 3D выключен. Подложка: ${LAYER_NAMES[currentLayer] || currentLayer}`);
}

// ---------- Привязка интерфейса ----------
function m3Labels() {
    M3_CONTROLS.forEach(c => {
        const f = M3_FMT[c[0]], out = m3El(c[0] + 'Val');
        if (f && out) out.textContent = f(m3d.opts[c[1]]);
    });
}

function m3PushOptsToUI() {
    M3_CONTROLS.forEach(c => {
        const el = m3El(c[0]);
        if (!el) return;
        if (c[2] === 'bool') el.checked = !!m3d.opts[c[1]]; else el.value = m3d.opts[c[1]];
    });
    m3Labels();
}

function m3BindUI() {
    M3_CONTROLS.forEach(c => {
        const el = m3El(c[0]);
        if (!el) return;
        el.addEventListener('input', () => {
            m3d.opts[c[1]] = c[2] === 'bool' ? el.checked : c[2] === 'num' ? parseFloat(el.value) : el.value;
            m3Labels();
            m3Apply();
        });
    });
    m3PushOptsToUI();

    // камера: облёт (поворот и наклон сцены — перетаскиванием кнопки «2D» на карте, см. ниже)
    m3El('m3Orbit').addEventListener('click', m3ToggleOrbit);

    // мои объекты
    m3El('m3RefreshUser').addEventListener('click', () => { m3RefreshUser(); updateStatus('🔄 Объекты обновлены в 3D'); });

    // импорт
    m3El('m3ImportModelBtn').addEventListener('click', () => m3El('m3ModelFile').click());
    m3El('m3ImportVecBtn').addEventListener('click', () => m3El('m3VecFile').click());
    m3El('m3ModelFile').addEventListener('change', function () { if (this.files[0]) m3ImportModel(this.files[0]); this.value = ''; });
    m3El('m3VecFile').addEventListener('change', function () { if (this.files[0]) m3ImportVector(this.files[0]); this.value = ''; });

    // готовые 3D-модели (агро-тематика): кнопка добавляет модель и сразу включает режим «кликните по карте»
    document.querySelectorAll('[data-m3-preset]').forEach(btn => btn.addEventListener('click', function () { m3AddPreset(this.dataset.m3Preset); }));

    m3El('m3List').addEventListener('click', e => {
        const row = e.target.closest('.m3-item');
        if (!row) return;
        const it = m3d.items.find(i => i.id === +row.dataset.id);
        if (!it) return;
        const act = e.target.closest('button');
        if (act && act.dataset.act === 'vis') {
            it.visible = !it.visible;
            if (it.kind === 'ext') m3UpdateExtPaint(it); else m3d.map.triggerRepaint();
        } else if (act && act.dataset.act === 'fly') {
            if (it.kind === 'model') m3d.map.easeTo({ center: [it.lng, it.lat], zoom: Math.max(m3d.map.getZoom(), 17), duration: 900 });
            else if (it.bbox) m3d.map.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { padding: 80, maxZoom: 18, duration: 900 });
        }
        m3Select(it.id);
    });

    // выбранный объект
    m3El('m3SelScale').addEventListener('input', function () {
        const it = m3Selected(); if (!it) return;
        const v = Math.pow(10, +this.value);
        if (it.kind === 'model') it.scale = v; else { it.hmul = v; m3UpdateExtPaint(it); }
        m3El('m3SelScaleVal').textContent = '×' + (v < 10 ? v.toFixed(2) : v.toFixed(1));
        m3d.map.triggerRepaint();
    });
    m3El('m3SelHeading').addEventListener('input', function () {
        const it = m3Selected(); if (!it || it.kind !== 'model') return;
        it.heading = +this.value;
        it.pivot.rotation.y = -it.heading * m3Rad;
        m3El('m3SelHeadingVal').textContent = Math.round(it.heading) + '°';
        m3d.map.triggerRepaint();
    });
    m3El('m3SelPitch').addEventListener('input', function () {
        const it = m3Selected(); if (!it || it.kind !== 'model') return;
        it.pitch = +this.value;
        it.tilt.rotation.x = it.pitch * m3Rad;
        m3El('m3SelPitchVal').textContent = Math.round(it.pitch) + '°';
        m3d.map.triggerRepaint();
    });
    m3El('m3SelRoll').addEventListener('input', function () {
        const it = m3Selected(); if (!it || it.kind !== 'model') return;
        it.roll = +this.value;
        it.tilt.rotation.z = it.roll * m3Rad;
        m3El('m3SelRollVal').textContent = Math.round(it.roll) + '°';
        m3d.map.triggerRepaint();
    });
    m3El('m3SelSpin').addEventListener('input', function () {
        const it = m3Selected(); if (!it || it.kind !== 'model') return;
        it.spin = +this.value;
        m3El('m3SelSpinVal').textContent = it.spin ? (it.spin > 0 ? '↻ ' : '↺ ') + Math.abs(Math.round(it.spin)) + '°/с' : 'выкл';
        m3SpinKick();
    });
    m3El('m3SelRotReset').addEventListener('click', () => {
        const it = m3Selected(); if (!it || it.kind !== 'model') return;
        it.heading = 0; it.pitch = 0; it.roll = 0; it.spin = 0;
        it.pivot.rotation.y = 0; it.tilt.rotation.set(0, 0, 0);
        m3SyncSelectedUI();
        m3d.map.triggerRepaint();
    });
    m3El('m3SelAlt').addEventListener('input', function () {
        const it = m3Selected(); if (!it) return;
        if (it.kind === 'model') it.alt = +this.value; else { it.base = +this.value; m3UpdateExtPaint(it); }
        m3El('m3SelAltVal').textContent = Math.round(+this.value) + ' м';
        m3d.map.triggerRepaint();
    });
    m3El('m3SelColor').addEventListener('input', function () {
        const it = m3Selected(); if (!it || it.kind !== 'ext') return;
        it.color = this.value;
        m3UpdateExtPaint(it);
    });
    m3El('m3MoveBtn').addEventListener('click', m3StartPlacing);
    m3El('m3DelBtn').addEventListener('click', () => {
        const it = m3Selected(); if (!it) return;
        m3RemoveItem(it);
        m3RenderList();
        m3SyncSelectedUI();
    });
    m3RenderList();
    m3SyncSelectedUI();

    // сервис
    m3El('m3Shot').addEventListener('click', () => {
        if (!m3d.map) return;
        m3d.map.triggerRepaint();
        m3d.map.once('render', () => {
            m3d.map.getCanvas().toBlob(b => {
                if (!b) return;
                const a = document.createElement('a');
                a.href = URL.createObjectURL(b);
                a.download = 'geoclass-3d.png';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 3000);
            });
        });
    });
    m3El('m3Reset').addEventListener('click', () => {
        m3d.opts = m3DefaultOpts();
        m3PushOptsToUI();
        m3Apply();
        if (m3d.map) m3d.map.easeTo({ pitch: 60, duration: 600 });
        updateStatus('↺ Настройки 3D сброшены');
    });

    // кнопка «3D / 2D» на карте. Как в Яндекс Картах: пока 3D включён, кнопку можно потянуть —
    // по горизонтали сцена вращается, по вертикали наклоняется; обычный клик возвращает плоскую карту
    const btn3 = m3El('mode3dBtn');
    let rot = null;
    btn3.addEventListener('pointerdown', e => {
        if (!m3d.active || !m3d.map || e.button !== 0) return;
        rot = { x: e.clientX, y: e.clientY, br: m3d.map.getBearing(), pt: m3d.map.getPitch(), moved: false, id: e.pointerId };
        try { btn3.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    });
    btn3.addEventListener('pointermove', e => {
        if (!rot || e.pointerId !== rot.id || !m3d.map) return;
        const dx = e.clientX - rot.x, dy = e.clientY - rot.y;
        if (!rot.moved && Math.hypot(dx, dy) < 4) return;
        if (!rot.moved) { rot.moved = true; m3StopOrbit(); btn3.classList.add('m3-rot'); }
        m3d.map.jumpTo({ bearing: rot.br - dx * 0.6, pitch: Math.max(0, Math.min(85, rot.pt - dy * 0.5)) });
    });
    const rotEnd = e => {
        if (!rot || e.pointerId !== rot.id) return;
        if (rot.moved) m3d.btnDragT = Date.now();
        rot = null;
        btn3.classList.remove('m3-rot');
    };
    btn3.addEventListener('pointerup', rotEnd);
    btn3.addEventListener('pointercancel', rotEnd);
    btn3.addEventListener('click', function (e) {
        e.stopPropagation();
        if (Date.now() - (m3d.btnDragT || 0) < 400) return;   // это было вращение сцены, а не клик
        if (m3d.active) exit3D(); else enter3D();
    });
}

// Leaflet → 3D: поиск, кнопки масштаба, стрелка севера, история экстентов
map.on('moveend', m3SyncFromLeaflet);
if (isRotationSupported()) map.on('rotate', m3SyncFromLeaflet);

// Подложки, выбранные справа, применяются и к 3D
const m3OrigSwitchLayer = switchLayer;
switchLayer = function (layerKey) {
    if (m3d.active && !swipeState.active) {
        if (currentLayer === layerKey || !baseLayers[layerKey]) return;
        currentLayer = layerKey;
        currentTileLayer = baseLayers[layerKey];
        updateActiveChips(layerKey);
        updateLayerLegend();
        m3RebuildBasemap();
        updateStatus(`🗺️ Подложка (3D): ${LAYER_NAMES[layerKey] || layerKey}`);
        return;
    }
    return m3OrigSwitchLayer.apply(this, arguments);
};

// Точка «Что здесь?» / результат поиска показываются и в 3D
const m3OrigShowGeoPoint = showGeoPoint;
showGeoPoint = function (latlng) {
    const r = m3OrigShowGeoPoint.apply(this, arguments);
    if (m3d.active) m3PutMarker(latlng);
    return r;
};
const m3OrigClearGeoPoint = clearGeoPoint;
clearGeoPoint = function () {
    m3RemoveMarker();
    return m3OrigClearGeoPoint.apply(this, arguments);
};

// «Обновить карту» обновляет и 3D
m3El('refreshMapBtn').addEventListener('click', () => {
    if (!m3d.active) return;
    m3d.map.resize();
    m3RebuildBasemap();
    m3RefreshUser();
});

// В 3D рисование и измерения (они работают на Leaflet) недоступны — подсказываем вместо молчаливого отказа
document.querySelector('.map-container').addEventListener('click', e => {
    if (!m3d.active) return;
    if (e.target.closest('.draw-row, #measureWidget, [data-bp-pane="draw"] .dw-tool')) {
        e.stopPropagation();
        e.preventDefault();
        updateStatus('ℹ️ Рисование и измерения работают в 2D — выключите 3D кнопкой «2D» на карте', true);
    }
}, true);

// Шторка и 3D работают вместе: в 3D шторка / дублирование показывают два 3D-окна

document.addEventListener('keydown', e => { if (e.key === 'Escape' && m3d.placing) m3CancelPlacing(); });
// выделенный 3D-объект: Delete — удалить, Esc — снять выделение
document.addEventListener('keydown', e => {
    if (!m3d.active || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
    const it = m3Selected();
    if (!it) return;
    if (e.key === 'Delete') { m3RemoveItem(it); m3RenderList(); m3SyncSelectedUI(); }
    else if (e.key === 'Escape') m3Select(null);
});

if (window.ResizeObserver) {
    new ResizeObserver(() => { if (m3d.map && m3d.active) { m3d.map.resize(); if (m3d.map2) m3d.map2.resize(); } }).observe(mapStageEl);
}

m3BindUI();

m3SetTabEnabled(false);   // при запуске вкладка «3D» открыта, но инструменты неактивны

// ============================================================
//  ЭКСПОРТ КАРТЫ (нижняя панель → вкладка «Экспорт»)
// ============================================================
//  Карта собирается на canvas: тайлы подложки, нарисованные объекты, сетка координат, легенда,
//  масштабная линейка, стрелка севера, заголовок. Форматы: PNG, JPEG, WebP, PDF, TIFF.
//  Привязка (EPSG:3857 / WGS 84): GeoTIFF, GeoPDF (для Avenza Maps, QGIS, Acrobat)
//  или ZIP «изображение + world-файл + .prj» для PNG/JPEG/WebP.
//  В 3D-режиме экспортируется текущий 3D-вид (привязка — только при виде строго сверху).
// ============================================================
(function () {
    const pane = document.querySelector('[data-bp-pane="export"]');
    if (!pane) return;
    const $ = id => document.getElementById(id);
    const R = 6378137, HALF = Math.PI * R, D2R = Math.PI / 180;
    const PAPER = { a0: [841, 1189], a1: [594, 841], a2: [420, 594], a3: [297, 420], a4: [210, 297], a5: [148, 210],
                    letter: [215.9, 279.4], legal: [215.9, 355.6], tabloid: [279.4, 431.8] };
    const FONT = '"Segoe UI", Arial, sans-serif';
    const PRJ = 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]';

    const mx = lng => R * lng * D2R;
    const my = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
    const toLng = x => x / R / D2R;
    const toLat = y => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D2R;
    const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), n = x / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; };
    const blobBytes = async b => new Uint8Array(await b.arrayBuffer());
    const canvasBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

    // ---------- Настройки ----------
    function readOpts() {
        const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
        const ch = id => $(id).checked;
        return {
            fmt: $('exFmt').value, q: num('exQuality', 90) / 100, dpi: num('exDpi', 150),
            paper: $('exPaper').value, orient: $('exOrient').value, cw: Math.max(20, num('exCW', 297)), ch: Math.max(20, num('exCH', 210)),
            margin: Math.max(0, num('exMargin', 8)),
            base: ch('exBase'), drawn: ch('exDrawn'), sketch: ch('exSketch'),
            title: $('exTitle').value.trim(), note: $('exNote').value.trim(),
            legend: ch('exLegend'), scale: ch('exScale'), north: ch('exNorth'), grid: ch('exGrid'), frame: ch('exFrame'),
            date: ch('exDate'), attr: ch('exAttr'), coords: ch('exCoords'), geo: ch('exGeo')
        };
    }

    function viewInfo() {
        if (m3d.active && m3d.map) {
            const m = m3d.map, c = m.getCenter(), cv = m.getContainer(), res = 2 * HALF / (512 * Math.pow(2, m.getZoom()));
            return { is3d: true, wPx: cv.clientWidth, hPx: cv.clientHeight, cx: mx(c.lng), cy: my(c.lat),
                     wM: cv.clientWidth * res, hM: cv.clientHeight * res, flat: Math.abs(m.getPitch()) < 0.5 && Math.abs(m.getBearing()) < 0.5 };
        }
        const c = map.getCenter(), s = map.getSize(), res = 2 * HALF / (256 * Math.pow(2, map.getZoom()));
        return { is3d: false, wPx: s.x, hPx: s.y, cx: mx(c.lng), cy: my(c.lat), wM: s.x * res, hM: s.y * res, flat: true };
    }

    // раскладка листа в мм: поля, шапка, подвал, рамка карты
    function layout(o, v) {
        let pw, ph;
        if (o.paper === 'screen') { pw = v.wPx * 25.4 / 96; ph = v.hPx * 25.4 / 96; }
        else if (o.paper === 'custom') { pw = o.cw; ph = o.ch; }
        else {
            [pw, ph] = PAPER[o.paper];
            const land = o.orient === 'auto' ? v.wPx >= v.hPx : o.orient === 'landscape';
            if (land !== pw > ph) [pw, ph] = [ph, pw];
        }
        const geo = o.geo && v.flat;
        const mapOnly = geo && o.fmt !== 'pdf';     // растр с привязкой = только карта, без полей
        const m = mapOnly ? 0 : Math.min(o.margin, Math.min(pw, ph) / 4);
        const head = mapOnly ? 0 : (o.title ? 9 : 0) + (o.note ? 5 : 0) + (o.title || o.note ? 1.5 : 0);
        const foot = mapOnly ? 0 : ((o.date || o.attr || o.coords || o.scale) ? 6 : 0);
        return { pw, ph, m, head, foot, mapOnly, geo,
                 fx: m, fy: m + head, fw: Math.max(10, pw - 2 * m), fh: Math.max(10, ph - 2 * m - head - foot) };
    }

    function finalScale(Lo, o) {
        let ppm = o.dpi / 25.4;
        const W = Lo.pw * ppm, H = Lo.ph * ppm, cap = o.fmt === 'tiff' ? 30e6 : 60e6;
        const k = Math.min(1, 12000 / Math.max(W, H), Math.sqrt(cap / (W * H)));
        return { ppm: ppm * k, limited: k < 0.999 };
    }

    // ---------- Тайлы ----------
    const imgCache = new Map();
    function loadImg(url) {
        if (imgCache.has(url)) return imgCache.get(url);
        const p = new Promise(res => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => res(im);
            im.onerror = () => { imgCache.delete(url); res(null); };
            im.src = url;
        });
        imgCache.set(url, p);
        if (imgCache.size > 900) imgCache.delete(imgCache.keys().next().value);
        return p;
    }
    async function pool(tasks, n) {
        let i = 0;
        await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) await tasks[i++](); }));
    }
    function baseTileLayers() {
        const out = [];
        (function walk(l) { if (!l) return; if (l instanceof L.TileLayer) out.push(l); else if (l.eachLayer) l.eachLayer(walk); })(currentTileLayer);
        return out;
    }

    async function drawTiles(ctx, ext, F, stat, onProgress) {
        const ew = ext.maxx - ext.minx, eh = ext.maxy - ext.miny;
        for (const layer of baseTileLayers()) {
            const ts = layer.getTileSize().x || 256;
            const maxZ = layer.options.maxNativeZoom != null ? layer.options.maxNativeZoom : (layer.options.maxZoom || 19);
            let z = Math.ceil(Math.log2(2 * HALF / (ts * (ew / F.w))));
            z = Math.max(layer.options.minZoom || 0, Math.min(maxZ, z, 22));
            const cnt = zz => { const T = 2 * HALF / Math.pow(2, zz); return (Math.floor(ew / T) + 2) * (Math.floor(eh / T) + 2); };
            while (z > 0 && cnt(z) > 1600) z--;
            const T = 2 * HALF / Math.pow(2, z), n = Math.pow(2, z);
            const x0 = Math.floor((ext.minx + HALF) / T), x1 = Math.floor((ext.maxx + HALF) / T);
            const y0 = Math.max(0, Math.floor((HALF - ext.maxy) / T)), y1 = Math.min(n - 1, Math.floor((HALF - ext.miny) / T));
            const jobs = [], saved = layer._tileZoom;
            layer._tileZoom = z;
            try {
                for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
                    const xw = ((x % n) + n) % n;
                    let url; try { url = layer.getTileUrl({ x: xw, y, z }); } catch (e) { continue; }
                    jobs.push({ x, y, url });
                }
            } finally { layer._tileZoom = saved; }
            let done = 0;
            ctx.save();
            ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
            ctx.globalAlpha = layer.options.opacity != null ? layer.options.opacity : 1;
            await pool(jobs.map(j => async () => {
                const im = await loadImg(j.url);
                stat.total++;
                if (!im) { stat.failed++; }
                else {
                    const px = F.x + (j.x * T - HALF - ext.minx) / ew * F.w, py = F.y + (ext.maxy - (HALF - j.y * T)) / eh * F.h;
                    ctx.drawImage(im, px, py, T / ew * F.w + 0.6, T / eh * F.h + 0.6);
                }
                if (onProgress && ++done % 8 === 0) onProgress(done, jobs.length);
            }), 24);
            ctx.restore();
        }
    }

    function grab3d() {
        return new Promise(res => {
            const m = m3d.map;
            m.once('render', () => {
                const c = document.createElement('canvas'), src = m.getCanvas();
                c.width = src.width; c.height = src.height;
                c.getContext('2d').drawImage(src, 0, 0);
                res(c);
            });
            m.triggerRepaint();
        });
    }

    // ---------- Векторные объекты ----------
    function flat(g, out) {
        if (g && typeof g.eachLayer === 'function') g.eachLayer(c => flat(c, out)); else out.push(g);
        return out;
    }
    function drawVectors(ctx, ext, F, k, layers) {
        const ew = ext.maxx - ext.minx, eh = ext.maxy - ext.miny;
        const P = ll => [F.x + (mx(ll.lng) - ext.minx) / ew * F.w, F.y + (ext.maxy - my(ll.lat)) / eh * F.h];
        const rings = a => { const out = []; (function w(x) { if (x.length && x[0].lat !== undefined) out.push(x); else x.forEach(w); })(a); return out; };
        ctx.save();
        ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
        layers.forEach(l => {
            try {
                const o = l.options || {};
                const stroke = () => {
                    if (o.stroke === false) return;
                    ctx.globalAlpha = o.opacity != null ? o.opacity : 1;
                    ctx.strokeStyle = o.color || '#3388ff'; ctx.lineWidth = (o.weight != null ? o.weight : 3) * k;
                    ctx.lineCap = o.lineCap || 'round'; ctx.lineJoin = 'round';
                    ctx.setLineDash(o.dashArray ? String(o.dashArray).split(/[ ,]+/).map(Number).filter(n => n > 0).map(n => n * k) : []);
                    ctx.stroke();
                };
                const fill = () => {
                    if (!o.fill) return;
                    ctx.globalAlpha = o.fillOpacity != null ? o.fillOpacity : 0.2;
                    ctx.fillStyle = o.fillColor || o.color || '#3388ff';
                    ctx.fill('evenodd');
                };
                if (l instanceof L.Marker) return drawMarker(ctx, l, P(l.getLatLng()), k);
                if (l instanceof L.Circle) {
                    const c = l.getLatLng(), p = P(c), r = l.getRadius() / Math.cos(c.lat * D2R) / ew * F.w;
                    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); fill(); stroke();
                } else if (l instanceof L.CircleMarker) {
                    const p = P(l.getLatLng());
                    ctx.beginPath(); ctx.arc(p[0], p[1], (l.getRadius() || 6) * k, 0, 7); fill(); stroke();
                } else if (l instanceof L.Polyline) {
                    const closed = l instanceof L.Polygon;
                    ctx.beginPath();
                    rings(l.getLatLngs()).forEach(r => {
                        r.forEach((ll, i) => { const p = P(ll); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
                        if (closed) ctx.closePath();
                    });
                    if (closed) fill();
                    stroke();
                }
            } catch (e) { /* объект не критичен для экспорта */ }
        });
        ctx.restore();
    }
    function drawMarker(ctx, l, p, k) {
        const sk = l._sk, s = sk ? sk.style : null;
        ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (sk && sk.kind === 'text') {
            const fs = (s.textSize || 16) * k, t = sk.text || 'Текст';
            ctx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${fs}px ${FONT}`;
            if (s.textBg) { const w = ctx.measureText(t).width + fs * 0.6; ctx.fillStyle = s.textBgColor || '#fff'; ctx.fillRect(p[0] - w / 2, p[1] - fs * 0.75, w, fs * 1.5); }
            if (s.halo) { ctx.lineWidth = fs / 4; ctx.lineJoin = 'round'; ctx.strokeStyle = s.haloColor || '#fff'; ctx.strokeText(t, p[0], p[1]); }
            ctx.fillStyle = s.textColor || '#0f172a'; ctx.fillText(t, p[0], p[1]);
            return;
        }
        const S = ((s && s.iconSize) || 30) * k, shape = s ? s.iconShape : 'pin', bg = s ? s.iconBg : '#2563eb';
        let cy = p[1];
        ctx.fillStyle = bg;
        if (shape === 'pin') {
            cy = p[1] - S * 0.62;
            ctx.beginPath(); ctx.arc(p[0], cy, S * 0.4, 0, 7); ctx.fill();
            ctx.beginPath(); ctx.moveTo(p[0] - S * 0.3, cy + S * 0.28); ctx.lineTo(p[0], p[1]); ctx.lineTo(p[0] + S * 0.3, cy + S * 0.28); ctx.fill();
        } else if (shape === 'circle') { ctx.beginPath(); ctx.arc(p[0], cy, S * 0.45, 0, 7); ctx.fill(); }
        else if (shape === 'square') { ctx.fillRect(p[0] - S * 0.42, cy - S * 0.42, S * 0.84, S * 0.84); }
        const el = l.getElement && l.getElement(), ic = el && el.querySelector && el.querySelector('i');
        const content = ic ? getComputedStyle(ic, '::before').content : '';
        if (content && content !== 'none' && content !== 'normal') {
            ctx.font = `900 ${S * (shape === 'plain' ? 0.8 : 0.42)}px "Font Awesome 6 Free"`;
            ctx.fillStyle = s ? s.iconColor : '#fff';
            ctx.fillText(content.replace(/^["']|["']$/g, ''), p[0], cy);
        }
    }

    // ---------- Элементы карты ----------
    function txt(ctx, s, x, y, px, opt) {
        opt = opt || {};
        ctx.font = `${opt.bold ? 'bold ' : ''}${px}px ${FONT}`;
        ctx.textAlign = opt.align || 'left'; ctx.textBaseline = opt.base || 'alphabetic'; ctx.globalAlpha = 1;
        if (opt.halo) { ctx.lineWidth = px / 4; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(s, x, y); }
        ctx.fillStyle = opt.color || '#0f172a';
        ctx.fillText(s, x, y);
    }
    function fit(ctx, s, px, maxW) {
        ctx.font = `${px}px ${FONT}`;
        while (s.length > 3 && ctx.measureText(s).width > maxW) s = s.slice(0, -2).replace(/\s+$/, '') + '…';
        return s;
    }
    function wrap(ctx, s, px, maxW) {
        ctx.font = `${px}px ${FONT}`;
        const words = String(s).split(/\s+/), lines = []; let cur = '';
        words.forEach(w => {
            const t = cur ? cur + ' ' + w : w;
            if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
        });
        if (cur) lines.push(cur);
        return lines;
    }
    const box = (ctx, x, y, w, h) => { ctx.globalAlpha = 0.88; ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(15,23,42,.35)'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeRect(x + 0.5, y + 0.5, w, h); };

    function drawGrid(ctx, ext, F, mm) {
        const ew = ext.maxx - ext.minx, eh = ext.maxy - ext.miny;
        const step = niceStep((toLng(ext.maxx) - toLng(ext.minx)) / 5), dec = Math.max(0, Math.ceil(-Math.log10(step)));
        const X = lng => F.x + (mx(lng) - ext.minx) / ew * F.w, Y = lat => F.y + (ext.maxy - my(lat)) / eh * F.h;
        ctx.save(); ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
        ctx.strokeStyle = 'rgba(15,23,42,.35)'; ctx.lineWidth = Math.max(1, mm(0.15)); ctx.setLineDash([mm(1.2), mm(1.2)]);
        for (let g = Math.ceil(toLng(ext.minx) / step) * step; g <= toLng(ext.maxx); g += step) {
            const x = X(g); ctx.beginPath(); ctx.moveTo(x, F.y); ctx.lineTo(x, F.y + F.h); ctx.stroke();
            txt(ctx, g.toFixed(dec) + '°', x + mm(0.8), F.y + mm(3), mm(2.3), { halo: true });
        }
        for (let g = Math.ceil(toLat(ext.miny) / step) * step; g <= toLat(ext.maxy); g += step) {
            const y = Y(g); ctx.beginPath(); ctx.moveTo(F.x, y); ctx.lineTo(F.x + F.w, y); ctx.stroke();
            txt(ctx, g.toFixed(dec) + '°', F.x + mm(0.8), y - mm(0.8), mm(2.3), { halo: true });
        }
        ctx.restore();
    }

    function drawScale(ctx, F, mm, mpp, bottom) {
        const L = niceStep(mm(28) * mpp), bar = L / mpp, x = F.x + mm(3), pad = mm(2), h = mm(8);
        const y = bottom - h;
        box(ctx, x, y, bar + 2 * pad + mm(6), h);
        const by = y + mm(2.2), bh = mm(1.6);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#0f172a'; ctx.fillRect(x + pad + i * bar / 4, by, bar / 4, bh); }
        ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1; ctx.strokeRect(x + pad, by, bar, bh);
        const lab = v => v >= 1000 ? (v / 1000) + ' км' : v + ' м';
        txt(ctx, '0', x + pad, y + mm(6.6), mm(2.2), { align: 'center' });
        txt(ctx, lab(L / 2), x + pad + bar / 2, y + mm(6.6), mm(2.2), { align: 'center' });
        txt(ctx, lab(L), x + pad + bar, y + mm(6.6), mm(2.2), { align: 'center' });
    }

    function drawNorth(ctx, F, mm) {
        const r = mm(7), cx = F.x + F.w - mm(3) - r, cy = F.y + mm(3) + r;
        ctx.globalAlpha = 0.88; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(15,23,42,.35)'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
        txt(ctx, 'N', cx, cy - mm(3.6), mm(2.8), { bold: true, align: 'center', base: 'middle' });
        ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.moveTo(cx, cy - mm(1.8)); ctx.lineTo(cx + mm(2), cy + mm(4.6)); ctx.lineTo(cx, cy + mm(3.2)); ctx.lineTo(cx - mm(2), cy + mm(4.6)); ctx.closePath(); ctx.fill();
    }

    function drawLegend(ctx, F, mm, bottom) {
        const def = typeof LAYER_LEGENDS !== 'undefined' ? LAYER_LEGENDS[currentLayer] : null;
        if (!def) return false;
        const W = mm(60), inner = W - mm(6), rows = [];
        rows.push({ t: 'title', lines: wrap(ctx, def.title, mm(2.7), inner), h: 0 });
        (def.items || []).forEach(it => rows.push({ t: 'item', c: it[0], lines: wrap(ctx, it[1], mm(2.3), inner - mm(5)) }));
        if (def.gradient) rows.push({ t: 'grad', g: def.gradient });
        rows.forEach(r => { r.h = r.t === 'title' ? r.lines.length * mm(3.3) + mm(1.2) : r.t === 'item' ? Math.max(mm(3.6), r.lines.length * mm(2.9)) + mm(0.6) : mm(11); });
        const H = rows.reduce((s, r) => s + r.h, 0) + mm(4), x = F.x + F.w - mm(3) - W, y0 = bottom - H;
        box(ctx, x, y0, W, H);
        let y = y0 + mm(2.2);
        rows.forEach(r => {
            if (r.t === 'title') r.lines.forEach((ln, i) => txt(ctx, ln, x + mm(3), y + mm(2.4) + i * mm(3.3), mm(2.7), { bold: true }));
            else if (r.t === 'item') {
                ctx.fillStyle = r.c; ctx.fillRect(x + mm(3), y + mm(0.3), mm(3.6), mm(3)); ctx.strokeStyle = 'rgba(15,23,42,.4)'; ctx.strokeRect(x + mm(3), y + mm(0.3), mm(3.6), mm(3));
                r.lines.forEach((ln, i) => txt(ctx, ln, x + mm(8), y + mm(2.5) + i * mm(2.9), mm(2.3)));
            } else {
                const g = r.g, gx = x + mm(3), gw = inner, grd = ctx.createLinearGradient(gx, 0, gx + gw, 0);
                g.colors.forEach((c, i) => grd.addColorStop(i / (g.colors.length - 1), c));
                ctx.fillStyle = grd; ctx.fillRect(gx, y + mm(1), gw, mm(3)); ctx.strokeStyle = 'rgba(15,23,42,.4)'; ctx.strokeRect(gx, y + mm(1), gw, mm(3));
                g.ticks.forEach((t, i) => txt(ctx, String(t), gx + (t - g.min) / (g.max - g.min) * gw, y + mm(7), mm(2.2), { align: i === 0 ? 'left' : i === g.ticks.length - 1 ? 'right' : 'center' }));
                txt(ctx, `${g.low} · ${g.unit} · ${g.high}`, gx + gw / 2, y + mm(10), mm(2.1), { align: 'center', color: '#64748b' });
            }
            y += r.h;
        });
        return true;
    }

    function footerParts(o, ext, F, ppm, mpp) {
        const parts = [];
        if (o.date) parts.push(new Date().toLocaleDateString('ru-RU'));
        if (o.coords) parts.push(`Центр: ${toLat((ext.miny + ext.maxy) / 2).toFixed(5)}, ${toLng((ext.minx + ext.maxx) / 2).toFixed(5)}`);
        if (o.scale && o.paper !== 'screen') parts.push('1 : ' + Math.round(mpp * ppm * 1000).toLocaleString('ru-RU'));
        if (o.attr) {
            const a = baseTileLayers().map(l => l.options.attribution || '').join(' ').replace(/<[^>]+>/g, '').replace(/&copy;/g, '©').replace(/&amp;/g, '&').trim();
            parts.push('Подложка: ' + (LAYER_NAMES[currentLayer] || currentLayer) + (a ? ' · ' + a : ''));
        }
        return parts;
    }

    // ---------- Сборка карты ----------
    async function compose(cv, o, Lo, ppm, onProgress) {
        const v = viewInfo(), mm = x => x * ppm, k = ppm * 25.4 / 96;
        const W = Math.round(Lo.pw * ppm), H = Math.round(Lo.ph * ppm);
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        const F = Lo.mapOnly ? { x: 0, y: 0, w: W, h: H }
            : { x: Math.round(mm(Lo.fx)), y: Math.round(mm(Lo.fy)), w: Math.round(mm(Lo.fw)), h: Math.round(mm(Lo.fh)) };
        // охват: текущий вид, вписанный в рамку карты (север сверху)
        const a = F.w / F.h; let ew = v.wM, eh = v.hM;
        if (ew / eh > a) eh = ew / a; else ew = eh * a;
        const ext = { minx: v.cx - ew / 2, maxx: v.cx + ew / 2, miny: v.cy - eh / 2, maxy: v.cy + eh / 2 };
        const mpp = ew / F.w * Math.cos(toLat(v.cy) * D2R), stat = { total: 0, failed: 0 };

        ctx.fillStyle = '#e5e7eb'; ctx.fillRect(F.x, F.y, F.w, F.h);
        if (o.base) {
            if (v.is3d) {
                const c3 = await grab3d(), dw = F.w * v.wM / ew, dh = dw * c3.height / c3.width;
                ctx.save(); ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
                ctx.drawImage(c3, F.x + (F.w - dw) / 2, F.y + (F.h - dh) / 2, dw, dh);
                ctx.restore();
            } else await drawTiles(ctx, ext, F, stat, onProgress);
        }
        if (!v.is3d) {   // в 3D нарисованные объекты уже есть на 3D-виде (если включены в «Мои объекты»)
            const ls = [];
            if (o.drawn) flat(drawnItems, ls);
            if (o.sketch) flat(sketchItems, ls);
            if (ls.length) drawVectors(ctx, ext, F, k, ls);
        }
        if (o.grid) drawGrid(ctx, ext, F, mm);
        if (o.frame) { ctx.strokeStyle = '#0f172a'; ctx.lineWidth = Math.max(1, mm(0.35)); ctx.setLineDash([]); ctx.strokeRect(F.x, F.y, F.w, F.h); }

        // заголовок и подвал
        const parts = footerParts(o, ext, F, ppm, mpp), footTxt = parts.join('   |   ');
        let botPad = 0;
        if (Lo.mapOnly) {
            if (o.title || o.note) {
                const tw = Math.max(o.title ? (ctx.font = `bold ${mm(5)}px ${FONT}`, ctx.measureText(o.title).width) : 0, o.note ? (ctx.font = `${mm(3)}px ${FONT}`, ctx.measureText(o.note).width) : 0);
                const bh = (o.title ? mm(7.5) : 0) + (o.note ? mm(5) : 0) + mm(1.5);
                box(ctx, F.x + mm(3), F.y + mm(3), Math.min(tw + mm(6), F.w - mm(30)), bh);
                if (o.title) txt(ctx, fit(ctx, o.title, mm(5), F.w - mm(36)), F.x + mm(6), F.y + mm(9), mm(5), { bold: true });
                if (o.note) txt(ctx, fit(ctx, o.note, mm(3), F.w - mm(36)), F.x + mm(6), F.y + mm(3) + bh - mm(2.2), mm(3), { color: '#475569' });
            }
            if (footTxt) {
                botPad = mm(5);
                ctx.globalAlpha = 0.88; ctx.fillStyle = '#fff'; ctx.fillRect(F.x, F.y + F.h - botPad, F.w, botPad); ctx.globalAlpha = 1;
                txt(ctx, fit(ctx, footTxt, mm(2.4), F.w - mm(4)), F.x + mm(2), F.y + F.h - mm(1.6), mm(2.4), { color: '#334155' });
            }
        } else {
            if (o.title) txt(ctx, fit(ctx, o.title, mm(5.5), W - mm(2 * Lo.m)), mm(Lo.m), mm(Lo.m + 6.5), mm(5.5), { bold: true });
            if (o.note) txt(ctx, fit(ctx, o.note, mm(3), W - mm(2 * Lo.m)), mm(Lo.m), mm(Lo.m + (o.title ? 11.5 : 4)), mm(3), { color: '#475569' });
            if (footTxt) txt(ctx, fit(ctx, footTxt, mm(2.4), W - mm(2 * Lo.m)), mm(Lo.m), F.y + F.h + mm(4.2), mm(2.4), { color: '#334155' });
        }
        const bottom = F.y + F.h - mm(3) - botPad;
        if (o.scale) drawScale(ctx, F, mm, mpp, bottom);
        if (o.north) drawNorth(ctx, F, mm);
        if (o.legend) drawLegend(ctx, F, mm, bottom);
        return { ext, F, W, H, stat };
    }

    // ---------- Кодировщики ----------
    function makeTiff(cv, ext) {
        const W = cv.width, H = cv.height, px = cv.getContext('2d').getImageData(0, 0, W, H).data;
        const rgb = new Uint8Array(W * H * 3);
        for (let i = 0, j = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; }
        const geo = !!ext, n = geo ? 13 : 10;
        let off = 8 + 2 + n * 12 + 4;
        const bpsOff = off; off += 6;
        let scaleOff = 0, tieOff = 0, keyOff = 0;
        if (geo) { scaleOff = off; off += 24; tieOff = off; off += 48; keyOff = off; off += 32; }
        const dataOff = off, buf = new ArrayBuffer(dataOff), dv = new DataView(buf);
        dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
        let p = 8; dv.setUint16(p, n, true); p += 2;
        const ent = (tag, type, count, val) => {
            dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
            if (type === 3 && count === 1) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true);
            p += 12;
        };
        ent(256, 4, 1, W); ent(257, 4, 1, H); ent(258, 3, 3, bpsOff); ent(259, 3, 1, 1); ent(262, 3, 1, 2);
        ent(273, 4, 1, dataOff); ent(277, 3, 1, 3); ent(278, 4, 1, H); ent(279, 4, 1, W * H * 3); ent(284, 3, 1, 1);
        if (geo) { ent(33550, 12, 3, scaleOff); ent(33922, 12, 6, tieOff); ent(34735, 3, 16, keyOff); }
        dv.setUint32(p, 0, true);
        [8, 8, 8].forEach((v, i) => dv.setUint16(bpsOff + i * 2, v, true));
        if (geo) {
            [(ext.maxx - ext.minx) / W, (ext.maxy - ext.miny) / H, 0].forEach((v, i) => dv.setFloat64(scaleOff + i * 8, v, true));
            [0, 0, 0, ext.minx, ext.maxy, 0].forEach((v, i) => dv.setFloat64(tieOff + i * 8, v, true));
            [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857].forEach((v, i) => dv.setUint16(keyOff + i * 2, v, true));
        }
        return new Blob([buf, rgb], { type: 'image/tiff' });
    }

    async function makePdf(cv, q, Lo, F, ext, geo) {
        const jpg = await blobBytes(await canvasBlob(cv, 'image/jpeg', q));
        const Wp = Lo.pw * 72 / 25.4, Hp = Lo.ph * 72 / 25.4, enc = new TextEncoder();
        const parts = [], offs = []; let len = 0;
        const push = d => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
        const f = x => x.toFixed(4);
        let vp = '';
        if (geo) {
            const bx0 = F.x / cv.width * Wp, bx1 = (F.x + F.w) / cv.width * Wp, by0 = Hp - (F.y + F.h) / cv.height * Hp, by1 = Hp - F.y / cv.height * Hp;
            const la0 = toLat(ext.miny), la1 = toLat(ext.maxy), lo0 = toLng(ext.minx), lo1 = toLng(ext.maxx);
            vp = `/VP [<< /Type /Viewport /BBox [${f(bx0)} ${f(by0)} ${f(bx1)} ${f(by1)}] /Name (Map) /Measure << /Type /Measure /Subtype /GEO /Bounds [0 0 0 1 1 1 1 0] /LPTS [0 0 0 1 1 1 1 0] /GPTS [${la0.toFixed(8)} ${lo0.toFixed(8)} ${la1.toFixed(8)} ${lo0.toFixed(8)} ${la1.toFixed(8)} ${lo1.toFixed(8)} ${la0.toFixed(8)} ${lo1.toFixed(8)}] /GCS << /Type /GEOGCS /EPSG 4326 /WKT (GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]) >> >> >>]`;
        }
        const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
        push('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n');
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
        obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(Wp)} ${f(Hp)}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> ${vp} >>`);
        const cs = `q ${f(Wp)} 0 0 ${f(Hp)} 0 0 cm /Im0 Do Q`;
        obj(4, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
        offs[5] = len;
        push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
        push(jpg); push('\nendstream\nendobj\n');
        const xr = len;
        push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(i => String(offs[i]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
        return new Blob(parts, { type: 'application/pdf' });
    }

    const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    function makeZip(files) {
        const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
        files.forEach(f => {
            const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
            const h = new DataView(new ArrayBuffer(30));
            h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
            h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, name.length, true);
            parts.push(h.buffer, name, f.data);
            const c = new DataView(new ArrayBuffer(46));
            c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
            c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
            cd.push(c.buffer, name);
            off += 30 + name.length + sz;
        });
        const e = new DataView(new ArrayBuffer(22));
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
        e.setUint32(12, cd.reduce((s, x) => s + x.byteLength, 0), true); e.setUint32(16, off, true);
        return new Blob([...parts, ...cd, e.buffer], { type: 'application/zip' });
    }

    function download(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    // ---------- Интерфейс ----------
    const setStatus = (s, warn) => { const el = $('exStatus'); el.textContent = s || ''; el.className = warn ? 'ex-warn' : 'ex-info'; };
    const isVisible = () => pane.classList.contains('active') && !$('bottomPanel').classList.contains('collapsed');

    function syncUI() {
        const o = readOpts(), v = viewInfo();
        $('exCustomRow').hidden = o.paper !== 'custom';
        $('exOrient').disabled = o.paper === 'custom' || o.paper === 'screen';
        $('exQuality').disabled = !(o.fmt === 'jpg' || o.fmt === 'webp' || o.fmt === 'pdf');
        $('exQualityVal').textContent = $('exQuality').value + '%';
        const hints = {
            png: 'ZIP: изображение + world-файл (.pgw) + .prj, EPSG:3857 (QGIS, ArcGIS). Только карта, без полей',
            jpg: 'ZIP: изображение + world-файл (.jgw) + .prj, EPSG:3857 (QGIS, ArcGIS). Только карта, без полей',
            webp: 'ZIP: изображение + world-файл (.wpw) + .prj, EPSG:3857. Только карта, без полей',
            tiff: 'GeoTIFF, EPSG:3857 — Avenza Maps, QGIS, ArcGIS. Только карта, без полей',
            pdf: 'GeoPDF (WGS 84) — Avenza Maps, Adobe Acrobat, QGIS. Лист с полями и подписями, привязана рамка карты'
        };
        let h = o.geo ? hints[o.fmt] : 'Экспорт без привязки — обычное изображение / документ';
        if (o.geo && !v.flat) h = '⚠ Привязка недоступна: в 3D включите вид «Сверху» (наклон 0°, поворот 0°)';
        $('exGeoHint').textContent = h;
        const Lo = layout(o, v), { ppm, limited } = finalScale(Lo, o);
        $('exSizeInfo').textContent = `${Math.round(Lo.pw)}×${Math.round(Lo.ph)} мм · ${Math.round(Lo.pw * ppm)}×${Math.round(Lo.ph * ppm)} px` + (limited ? ' (снижено до лимита)' : '');
        return { o, v, Lo };
    }

    let timer = null, busy = false, again = false;
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(renderPreview, ms == null ? 250 : ms); }
    async function renderPreview() {
        // предпросмотр убран: пересчитываем только подсказки (размер листа, привязка)
        if (!isVisible()) return;
        try { syncUI(); } catch (e) { console.error(e); }
    }

    async function doExport() {
        const btn = $('exDownload');
        if (btn.disabled) return;
        btn.disabled = true;
        const al = window.AnLoader ? AnLoader.start('Экспорт карты', 'Сборка карты…', { delay: 150 }) : 0;
        try {
            const { o, v, Lo } = syncUI();
            const geo = Lo.geo, { ppm, limited } = finalScale(Lo, o);
            if (o.geo && !geo) setStatus('Привязка отключена: 3D-вид наклонён или повёрнут', true);
            setStatus('Сборка карты…');
            const cv = document.createElement('canvas');
            const r = await compose(cv, o, Lo, ppm, (d, n) => { setStatus(`Загрузка тайлов: ${d}/${n}`); if (window.AnLoader) AnLoader.progress(d / n * 85, `Загрузка тайлов: ${d}/${n}`); });
            const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1_');
            const base = 'geoclass_karta_' + stamp;
            setStatus('Кодирование файла…'); if (window.AnLoader) AnLoader.progress(90, 'Кодирование файла…');
            if (o.fmt === 'pdf') download(await makePdf(cv, o.q, Lo, r.F, r.ext, geo), base + '.pdf');
            else if (o.fmt === 'tiff') download(makeTiff(cv, geo ? r.ext : null), base + (geo ? '_geo' : '') + '.tif');
            else {
                const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[o.fmt];
                const blob = await canvasBlob(cv, mime, o.q);
                if (!blob) throw new Error('браузер не смог закодировать изображение');
                if (geo) {
                    const rx = (r.ext.maxx - r.ext.minx) / r.W, ry = (r.ext.maxy - r.ext.miny) / r.H;
                    const wf = [rx, 0, 0, -ry, r.ext.minx + rx / 2, r.ext.maxy - ry / 2].map(x => x.toFixed(10)).join('\n') + '\n';
                    const enc = new TextEncoder(), we = { png: 'pgw', jpg: 'jgw', webp: 'wpw' }[o.fmt];
                    download(makeZip([{ name: base + '.' + o.fmt, data: await blobBytes(blob) }, { name: base + '.' + we, data: enc.encode(wf) }, { name: base + '.prj', data: enc.encode(PRJ) }]), base + '_geo.zip');
                } else download(blob, base + '.' + o.fmt);
            }
            let msg = '✅ Карта экспортирована' + (geo ? ' с привязкой' : '');
            if (limited) msg += ' (размер снижен до безопасного лимита браузера)';
            if (r.stat.failed) msg += `. ⚠ Пропущено тайлов: ${r.stat.failed} (CORS/сеть)`;
            setStatus(msg, !!r.stat.failed);
            updateStatus(msg);
        } catch (e) {
            console.error(e);
            setStatus('Ошибка экспорта: ' + (e.name === 'SecurityError' ? 'подложка не разрешает экспорт (CORS), выберите OSM или Esri' : e.message), true);
        }
        btn.disabled = false;
        if (window.AnLoader) AnLoader.end(al);
    }

    pane.addEventListener('input', () => { syncUI(); schedule(); });
    pane.addEventListener('change', () => { syncUI(); schedule(); });
    $('exDownload').addEventListener('click', doExport);
    document.querySelector('.bp-tab[data-bp-tab="export"]').addEventListener('click', () => { syncUI(); schedule(50); });
    $('bottomPanelToggle').addEventListener('click', () => schedule(350));
    map.on('moveend', () => schedule(400));
    map.on('layeradd layerremove', () => schedule(500));
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.layer-chip, #mode3dBtn, #m3ToggleBtn')) schedule(900); });
    syncUI();
})();

// ============================================================
//  СЕТКА КООРДИНАТ (виджет справа) и ПРОФИЛЬ РЕЛЬЕФА (вкладка «Профиль» нижней панели)
// ============================================================
//  Сетка: географическая (градусы или град-мин-сек), шаг авто или вручную, подписи по краям.
//  В 2D рисуется на canvas поверх карты (учитывает поворот и режим дублирования),
//  в 3D — слоями MapLibre в каждом окне.
//  Профиль: линия рисуется на карте (или берётся выбранная на вкладке «Рисование»),
//  высоты читаются из тайлов Terrarium DEM (те же, что использует 3D-рельеф).
// ============================================================
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    // ---------- СЕТКА ----------
    const gs = { on: false, fmt: 'dd', step: 'auto', color: '#1d4ed8', labels: true };
    const DD_STEPS = [0.00005, 0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30];
    const DMS_STEPS = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 18000, 36000, 72000, 108000].map(v => v / 3600);

    function stepText(step) {
        if (gs.fmt === 'dms') {
            const sec = Math.round(step * 3600);
            return sec >= 3600 ? (sec / 3600) + '°' : sec >= 60 ? (sec / 60) + '′' : sec + '″';
        }
        return step + '°';
    }
    function fillSteps() {
        const sel = $('gridStep');
        const list = gs.fmt === 'dms' ? DMS_STEPS : DD_STEPS;
        sel.innerHTML = '<option value="auto">Авто</option>' + list.map(v => `<option value="${v}">${stepText(v)}</option>`).join('');
        sel.value = gs.step;
    }
    function autoStep(degPerPx, minPx) {
        const list = gs.fmt === 'dms' ? DMS_STEPS : DD_STEPS;
        for (const s of list) if (s / degPerPx >= minPx) return s;
        return list[list.length - 1];
    }
    function axis(min, max, step) {
        const out = [];
        for (let k = Math.ceil(min / step - 1e-9); k * step <= max && out.length < 400; k++) out.push(+(k * step).toFixed(8));
        return out;
    }
    function plan(b, degPerPx) {
        let step = gs.step === 'auto' ? autoStep(degPerPx, 110) : +gs.step;
        while (((b.e - b.w) + (b.n - b.s)) / step > 160) step *= 2;
        return { step: step, lngs: axis(b.w, b.e, step), lats: axis(b.s, b.n, step) };
    }
    function fmtCoord(v, isLat, step) {
        if (!isLat) v = ((v + 540) % 360) - 180;
        const hemi = isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E');
        const a = Math.abs(v);
        if (gs.fmt === 'dms') {
            let sec = Math.round(a * 3600);
            const d = Math.floor(sec / 3600); sec -= d * 3600;
            const m = Math.floor(sec / 60); sec -= m * 60;
            const st = Math.round(step * 3600);
            if (st >= 3600) return `${d}°${hemi}`;
            if (st >= 60) return `${d}°${String(m).padStart(2, '0')}′${hemi}`;
            return `${d}°${String(m).padStart(2, '0')}′${String(sec).padStart(2, '0')}″${hemi}`;
        }
        const dec = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
        return a.toFixed(dec) + '°' + hemi;
    }
    function hexA(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
    }
    function clipSeg(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {   // Лян–Барски
        let t0 = 0, t1 = 1;
        const dx = x1 - x0, dy = y1 - y0, p = [-dx, dx, -dy, dy], q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) { if (q[i] < 0) return null; continue; }
            const r = q[i] / p[i];
            if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
        return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
    }

    // --- 2D: canvas ---
    const cv = $('gridCanvas'), cx = cv.getContext('2d');
    let gRaf = 0;
    function gridRedraw() {
        if (gRaf) return;
        gRaf = requestAnimationFrame(() => { gRaf = 0; drawGrid2D(); });
    }
    function drawWindow(offX, w, h) {
        cx.save();
        cx.translate(offX, 0);
        cx.beginPath(); cx.rect(0, 0, w, h); cx.clip();
        const ll = [[0, 0], [w, 0], [w, h], [0, h]].map(p => map.containerPointToLatLng(L.point(p[0], p[1])));
        const b = {
            w: Math.min.apply(null, ll.map(p => p.lng)), e: Math.max.apply(null, ll.map(p => p.lng)),
            s: Math.max(-85, Math.min.apply(null, ll.map(p => p.lat))), n: Math.min(85, Math.max.apply(null, ll.map(p => p.lat)))
        };
        const pl = plan(b, 360 / (256 * Math.pow(2, map.getZoom())));
        const P = (lat, lng) => map.latLngToContainerPoint(L.latLng(lat, lng));
        cx.strokeStyle = hexA(gs.color, 0.6); cx.lineWidth = 1;
        const lines = [];
        pl.lngs.forEach(v => lines.push({ a: P(b.s, v), b: P(b.n, v), v: v, lat: false }));
        pl.lats.forEach(v => lines.push({ a: P(v, b.w), b: P(v, b.e), v: v, lat: true }));
        cx.beginPath();
        lines.forEach(l => { cx.moveTo(l.a.x, l.a.y); cx.lineTo(l.b.x, l.b.y); });
        cx.stroke();
        if (gs.labels) {
            cx.font = '600 11px "Segoe UI", Arial, sans-serif';
            cx.lineJoin = 'round'; cx.lineWidth = 3;
            lines.forEach(l => {
                const c = clipSeg(l.a.x, l.a.y, l.b.x, l.b.y, 6, 6, w - 6, h - 6);
                if (!c || Math.hypot(c[2] - c[0], c[3] - c[1]) < 40) return;
                let x, y;
                if (l.lat) {   // параллель: подпись у левого края
                    const left = c[0] <= c[2];
                    x = left ? c[0] : c[2]; y = left ? c[1] : c[3];
                    cx.textAlign = 'left'; cx.textBaseline = 'middle'; x += 4;
                } else {       // меридиан: подпись у верхнего края
                    const top = c[1] <= c[3];
                    x = top ? c[0] : c[2]; y = top ? c[1] : c[3];
                    cx.textAlign = 'center'; cx.textBaseline = 'top'; y += 3;
                }
                const t = fmtCoord(l.v, l.lat, pl.step);
                cx.strokeStyle = 'rgba(255,255,255,0.9)'; cx.strokeText(t, x, y);
                cx.fillStyle = '#0f172a'; cx.fillText(t, x, y);
            });
        }
        cx.restore();
    }
    function drawGrid2D() {
        const W = mapStageEl.clientWidth, H = mapStageEl.clientHeight, dpr = window.devicePixelRatio || 1;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cx.clearRect(0, 0, W, H);
        if (!gs.on || m3d.active) return;
        const sz = map.getSize();
        drawWindow(0, sz.x, sz.y);
        if (swipeState.active && swipeState.mode === 'dual') drawWindow(W / 2, sz.x, sz.y);   // второе окно дублирования
    }

    // --- 3D: слои MapLibre ---
    function grid3dUpdate(m) {
        try {
            if (!m || !m.getSource('gc-grid')) return;
            m.setLayoutProperty('gc-grid-line', 'visibility', gs.on ? 'visible' : 'none');
            m.setLayoutProperty('gc-grid-lbl', 'visibility', gs.on && gs.labels ? 'visible' : 'none');
            m.setPaintProperty('gc-grid-line', 'line-color', gs.color);
            if (!gs.on) return;
            const c = m.getCenter(), dpp = 360 / (512 * Math.pow(2, m.getZoom()));
            const step0 = gs.step === 'auto' ? autoStep(dpp, 110) : +gs.step, span = step0 * 25;
            const pl = plan({ w: c.lng - span, e: c.lng + span, s: Math.max(-85, c.lat - span), n: Math.min(85, c.lat + span) }, dpp);
            const s = Math.max(-85, c.lat - span), n = Math.min(85, c.lat + span);
            const feats = [];
            pl.lngs.forEach(v => feats.push({ type: 'Feature', properties: { label: fmtCoord(v, false, pl.step) }, geometry: { type: 'LineString', coordinates: [[v, s], [v, n]] } }));
            pl.lats.forEach(v => feats.push({ type: 'Feature', properties: { label: fmtCoord(v, true, pl.step) }, geometry: { type: 'LineString', coordinates: [[c.lng - span, v], [c.lng + span, v]] } }));
            m.getSource('gc-grid').setData({ type: 'FeatureCollection', features: feats });
        } catch (e) { /* стиль ещё загружается */ }
    }
    window.gridInit3D = function (m) {
        m.addSource('gc-grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'gc-grid-line', type: 'line', source: 'gc-grid', layout: { visibility: 'none' },
            paint: { 'line-color': gs.color, 'line-width': 1, 'line-opacity': 0.75 } });
        m.addLayer({ id: 'gc-grid-lbl', type: 'symbol', source: 'gc-grid', layout: { visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 300,
            'text-field': ['get', 'label'], 'text-font': M3D.FONT, 'text-size': 11 },
            paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
        m.on('moveend', () => grid3dUpdate(m));
        grid3dUpdate(m);
    };
    function grid3dAll() { [m3d.map, m3d.map2].forEach(grid3dUpdate); }

    function gridApply() { gridRedraw(); grid3dAll(); }
    function setGrid(on) {
        gs.on = on;
        $('gridToggle').classList.toggle('active', on);
        $('gridBtn').classList.toggle('tool-on', on);
        gridApply();
        updateStatus(on ? `▦ Сетка координат включена (шаг: ${gs.step === 'auto' ? 'авто' : stepText(+gs.step)})` : '▦ Сетка координат выключена');
    }
    $('gridBtn').addEventListener('click', e => { e.stopPropagation(); togglePanel('gridPanel', 'gridBtn'); });
    $('gridToggle').addEventListener('click', e => { e.stopPropagation(); setGrid(!gs.on); });
    $('gridFmt').addEventListener('change', function () { gs.fmt = this.value; gs.step = 'auto'; fillSteps(); if (!gs.on) setGrid(true); else gridApply(); });
    $('gridStep').addEventListener('change', function () { gs.step = this.value; if (!gs.on) setGrid(true); else gridApply(); });
    $('gridColor').addEventListener('input', function () { gs.color = this.value; if (!gs.on) setGrid(true); else gridApply(); });
    $('gridLabels').addEventListener('change', function () { gs.labels = this.checked; gridApply(); });
    fillSteps();
    map.on('move zoom zoomend moveend rotate resize viewreset', gridRedraw);
    if (window.ResizeObserver) new ResizeObserver(gridRedraw).observe(mapStageEl);
    new MutationObserver(gridRedraw).observe(mapStageEl, { attributes: true, attributeFilter: ['class'] });

    // ---------- ПРОФИЛЬ РЕЛЬЕФА ----------
    const pf = { drawing: false, pts: [], latlngs: null, line: null, verts: null, rubber: null, hoverMk: null,
        seq: 0, dist: null, lat: null, lng: null, raw: null, ele: null, slope: null, total: 0, hover: -1 };
    const slopeColor = p => { const a = Math.abs(p); return a < 3 ? '#10b981' : a < 8 ? '#eab308' : a < 15 ? '#f97316' : '#dc2626'; };
    const fmtDist = d => d >= 1000 ? (d / 1000).toFixed(2) + ' км' : Math.round(d) + ' м';
    const fmtM = v => Math.round(v) + ' м';
    const fmtSlope = p => `${p.toFixed(1)}% (${(Math.atan(p / 100) * 180 / Math.PI).toFixed(1)}°)`;

    // --- тайлы высот ---
    const tiles = new Map();
    function pfTile(z, x, y) {
        const k = z + '/' + x + '/' + y;
        let p = tiles.get(k);
        if (!p) {
            p = new Promise(res => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    try {
                        const c = document.createElement('canvas'); c.width = c.height = 256;
                        const g = c.getContext('2d', { willReadFrequently: true });
                        g.drawImage(img, 0, 0);
                        const d = g.getImageData(0, 0, 256, 256).data, a = new Float32Array(65536);
                        for (let i = 0; i < 65536; i++) a[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
                        res(a);
                    } catch (e) { res(null); }
                };
                img.onerror = () => res(null);
                img.src = M3D.DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y);
            }).then(v => { if (!v) tiles.delete(k); return v; });
            tiles.set(k, p);
            if (tiles.size > 160) tiles.delete(tiles.keys().next().value);
        }
        return p;
    }
    function tileXY(lat, lng, z) {
        const n = Math.pow(2, z), lr = lat * Math.PI / 180;
        return { x: (lng + 180) / 360 * n, y: (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n };
    }

    // --- рисование линии ---
    function pfOpenTab() {
        const bp = $('bottomPanel');
        if (bp.classList.contains('collapsed')) $('bottomPanelToggle').click();
        const tab = document.querySelector('.bp-tab[data-bp-tab="profile"]');
        if (tab && !tab.classList.contains('active')) tab.click();
    }
    function pfLayersClear() {
        [pf.line, pf.verts, pf.rubber, pf.hoverMk, pf.heat].forEach(l => { if (l) map.removeLayer(l); });
        pf.line = pf.verts = pf.rubber = pf.hoverMk = pf.heat = null;
        pf.hm = null; hmLegendSync();
    }
    function pfShowLine(pts, dashed) {
        if (!pf.line) {
            pf.line = L.polyline(pts, { color: '#e11d48', weight: 3, dashArray: dashed ? '6 5' : null, interactive: false }).addTo(map);
            pf.verts = L.layerGroup().addTo(map);
        } else {
            pf.line.setLatLngs(pts);
            pf.line.setStyle({ dashArray: dashed ? '6 5' : null });
        }
        pf.verts.clearLayers();
        pts.forEach((p, i) => {
            if (!dashed && i > 0 && i < pts.length - 1) return;
            L.circleMarker(p, { radius: 4, color: '#e11d48', weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false }).addTo(pf.verts);
        });
    }
    function pfEndDrawUI() {
        pf.drawing = false;
        map.doubleClickZoom.enable();
        map.getContainer().classList.remove('pf-drawing');
        $('profileBtn').classList.remove('tool-on');
        if (pf.rubber) { map.removeLayer(pf.rubber); pf.rubber = null; }
    }
    function pfClear() {
        if (pf.drawing) pfEndDrawUI();
        pf.seq++;
        pfLayersClear();
        pf.pts = []; pf.latlngs = null; pf.ele = pf.raw = pf.dist = pf.slope = null; pf.hover = -1;
        $('pfCsv').disabled = $('pfPng').disabled = true;
        pfStatsRender(); pfDraw();
        $('pfEmpty').textContent = 'Рисуйте линию на карте: ЛКМ — точки, двойной клик или Enter — завершить';
        $('pfEmpty').hidden = false;
    }
    function pfStart(keep) {
        if (m3d.active) { updateStatus('ℹ️ Профиль рельефа строится на 2D-карте — выключите 3D кнопкой «2D» на карте', true); return; }
        if (keep && pf.drawing) return;
        try { if (measureMode) deactivateMeasureMode(); } catch (e) { /* не критично */ }
        try { if (currentTool || activeDrawHandler || isEditing || sketchState.tool) deactivateAllTools(); } catch (e) { /* не критично */ }
        if (!keep) pfClear();   // при автозапуске прежний результат остаётся, пока не начата новая линия
        pf.pts = [];
        pf.drawing = true;
        map.doubleClickZoom.disable();
        map.getContainer().classList.add('pf-drawing');
        $('profileBtn').classList.add('tool-on');
        if (!keep) pfOpenTab();
        updateStatus('⛰️ Профиль: ЛКМ — точки линии, двойной клик или Enter — завершить, Esc — сбросить');
    }
    // Результат прежней линии убирается, когда начинается новая (рисование при этом не прерывается)
    function pfResetResult() {
        pf.seq++;
        pfLayersClear();
        pf.latlngs = null; pf.ele = pf.raw = pf.dist = pf.slope = null; pf.hover = -1;
        $('pfCsv').disabled = $('pfPng').disabled = true;
        pfStatsRender(); pfDraw();
        $('pfEmpty').textContent = 'Рисуйте линию на карте: ЛКМ — точки, двойной клик или Enter — завершить';
        $('pfEmpty').hidden = false;
    }
    function pfFinish() {
        if (pf.pts.length < 2) { updateStatus('⚠️ Для профиля нужно минимум 2 точки', true); return; }
        pfEndDrawUI();
        pf.latlngs = pf.pts.slice();
        pfShowLine(pf.latlngs, false);
        pfCompute();
        drawSync();   // сразу снова готовы рисовать следующую линию
    }
    function pfToggleDraw() {
        if (pf.drawing) { if (pf.pts.length >= 2) pfFinish(); else pfClear(); } else pfStart();
    }
    function pfFromSelected() {
        const sel = sketchState.selected;
        if (!sel || !sel._sk || typeof sel.getLatLngs !== 'function') {
            updateStatus('ℹ️ Выберите линию или контур на вкладке «Рисование» (кнопка «Выбрать»)', true); return;
        }
        let ll = sel.getLatLngs();
        while (Array.isArray(ll[0])) ll = ll[0];
        ll = ll.map(p => L.latLng(p.lat, p.lng));
        if (sel._sk.kind !== 'line' && ll.length) ll.push(ll[0]);
        if (ll.length < 2) { updateStatus('ℹ️ У выбранного объекта нет линии', true); return; }
        pfClear();
        pf.latlngs = ll;
        pfShowLine(ll, false);
        pfOpenTab();
        pfCompute();
        drawSync();
    }

    map.on('click', e => {
        if (!pf.drawing) return;
        if (measureMode || currentTool || sketchState.tool) { pfClear(); return; }
        if (!pf.pts.length && (pf.latlngs || pf.line)) pfResetResult();   // началась новая линия
        const last = pf.pts[pf.pts.length - 1];
        if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(e.latlng)) < 3) return;   // второй клик двойного клика
        pf.pts.push(e.latlng);
        pfShowLine(pf.pts, true);
    });
    map.on('dblclick', () => { if (pf.drawing) pfFinish(); });
    map.on('mousemove', e => {
        if (!pf.drawing || !pf.pts.length) return;
        const seg = [pf.pts[pf.pts.length - 1], e.latlng];
        if (!pf.rubber) pf.rubber = L.polyline(seg, { color: '#e11d48', weight: 2, opacity: 0.5, dashArray: '2 5', interactive: false }).addTo(map);
        else pf.rubber.setLatLngs(seg);
    });
    document.addEventListener('keydown', e => {
        if (!pf.drawing || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
        if (e.key === 'Enter') pfFinish();
        else if (e.key === 'Escape') { pfClear(); updateStatus('⛰️ Построение профиля сброшено'); drawSync(); }
    });

    // --- расчёт ---
    async function pfCompute() {
        const my = ++pf.seq, ll = pf.latlngs;
        const cum = [0];
        for (let i = 1; i < ll.length; i++) cum.push(cum[i - 1] + ll[i - 1].distanceTo(ll[i]));
        const total = cum[cum.length - 1];
        if (total < 1) { updateStatus('⚠️ Линия слишком короткая', true); return; }
        const N = Math.max(2, Math.min(+$('pfN').value, Math.ceil(total / 2) + 1));
        const dist = [], lat = [], lng = [];
        let j = 0;
        for (let k = 0; k < N; k++) {
            const d = total * k / (N - 1);
            while (j < cum.length - 2 && cum[j + 1] < d) j++;
            const seg = cum[j + 1] - cum[j], t = seg > 0 ? (d - cum[j]) / seg : 0;
            dist.push(d);
            lat.push(ll[j].lat + (ll[j + 1].lat - ll[j].lat) * t);
            lng.push(ll[j].lng + (ll[j + 1].lng - ll[j].lng) * t);
        }
        $('pfEmpty').textContent = 'Загрузка высот…'; $('pfEmpty').hidden = false;
        pf.ele = null; pfDraw();
        updateStatus('⛰️ Профиль: загружаю высоты…');

        // масштаб тайлов подбираем под шаг между точками, но не более ~36 тайлов
        const spacing = total / (N - 1), latMid = lat.reduce((a, b) => a + b, 0) / N;
        let z = Math.ceil(Math.log2(156543.03 * Math.cos(latMid * Math.PI / 180) / spacing));
        z = Math.max(5, Math.min(14, z));
        const keys = zz => { const set = new Set(); for (let i = 0; i < N; i++) { const t = tileXY(lat[i], lng[i], zz); set.add(Math.floor(t.x) + ',' + Math.floor(t.y)); } return set; };
        while (z > 5 && keys(z).size > 36) z--;
        const need = Array.from(keys(z));
        const data = {};
        const al = window.AnLoader ? AnLoader.start('Профиль рельефа', 'Загрузка высот: 0/' + need.length) : 0;
        try {
            let pdone = 0;
            await Promise.all(need.map(k => { const [x, y] = k.split(',').map(Number); return pfTile(z, x, y).then(a => { data[k] = a; if (window.AnLoader) AnLoader.progress(++pdone / need.length * 100, 'Загрузка высот: ' + pdone + '/' + need.length); }); }));
        } finally { if (window.AnLoader) AnLoader.end(al); }
        if (my !== pf.seq) return;

        const raw = [];
        let miss = 0;
        for (let i = 0; i < N; i++) {
            const t = tileXY(lat[i], lng[i], z), tx = Math.floor(t.x), ty = Math.floor(t.y), a = data[tx + ',' + ty];
            if (!a) { raw.push(null); miss++; continue; }
            const px = Math.min(254.999, Math.max(0, (t.x - tx) * 256 - 0.5)), py = Math.min(254.999, Math.max(0, (t.y - ty) * 256 - 0.5));
            const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0, o = y0 * 256 + x0;
            raw.push(a[o] * (1 - fx) * (1 - fy) + a[o + 1] * fx * (1 - fy) + a[o + 256] * (1 - fx) * fy + a[o + 257] * fx * fy);
        }
        if (miss === N) {
            $('pfEmpty').textContent = 'Не удалось загрузить данные рельефа. Проверьте подключение к интернету.';
            updateStatus('⚠️ Профиль: данные рельефа недоступны', true); return;
        }
        for (let i = 1; i < N; i++) if (raw[i] == null) raw[i] = raw[i - 1];
        for (let i = N - 2; i >= 0; i--) if (raw[i] == null) raw[i] = raw[i + 1];
        Object.assign(pf, { dist: dist, lat: lat, lng: lng, raw: raw, total: total });
        pfRender();
        pfHeatBuild();
        updateStatus(`⛰️ Профиль построен: ${fmtDist(total)}, перепад ${fmtM(Math.max.apply(null, pf.ele) - Math.min.apply(null, pf.ele))}` + (miss ? ' (часть данных не загрузилась)' : ''));
    }

    function pfRender() {
        if (!pf.raw) return;
        const n = pf.raw.length, k = +$('pfSmooth').value;
        pf.ele = pf.raw.map((_, i) => {
            const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
            let s = 0; for (let q = a; q <= b; q++) s += pf.raw[q];
            return s / (b - a + 1);
        });
        pf.slope = pf.ele.map((_, i) => {
            const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
            return pf.dist[b] > pf.dist[a] ? (pf.ele[b] - pf.ele[a]) / (pf.dist[b] - pf.dist[a]) * 100 : 0;
        });
        $('pfEmpty').hidden = true;
        $('pfCsv').disabled = $('pfPng').disabled = false;
        pfStatsRender();
        pfDraw();
    }

    function pfStatsRender() {
        const box = $('pfStats');
        if (!pf.ele) { box.innerHTML = '<div class="m3-hint">Нет данных</div>'; return; }
        const e = pf.ele, n = e.length;
        let asc = 0, desc = 0, sumAbs = 0;
        for (let i = 1; i < n; i++) { const d = e[i] - e[i - 1]; if (d > 0) asc += d; else desc -= d; }
        pf.slope.forEach(s => { sumAbs += Math.abs(s); });
        const mn = Math.min.apply(null, e), mx = Math.max.apply(null, e);
        const rows = [
            ['Длина', fmtDist(pf.total)], ['Точек', n],
            ['Мин. высота', fmtM(mn)], ['Макс. высота', fmtM(mx)],
            ['Средняя', fmtM(e.reduce((a, b) => a + b, 0) / n)], ['Перепад', fmtM(mx - mn)],
            ['Начало', fmtM(e[0])], ['Конец', fmtM(e[n - 1])],
            ['Набор ▲', fmtM(asc)], ['Спуск ▼', fmtM(desc)],
            ['Макс. подъём', fmtSlope(Math.max.apply(null, pf.slope))], ['Макс. спуск', fmtSlope(Math.min.apply(null, pf.slope))],
            ['Ср. уклон', fmtSlope(sumAbs / n)], ['Конец − начало', (e[n - 1] - e[0] >= 0 ? '+' : '') + Math.round(e[n - 1] - e[0]) + ' м']
        ];
        box.innerHTML = rows.map(r => `<div class="pf-st"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
    }

    // --- график ---
    function niceTicks(a, b, cnt) {
        const s0 = (b - a) / Math.max(1, cnt), mag = Math.pow(10, Math.floor(Math.log10(s0))), nn = s0 / mag;
        const st = (nn < 1.5 ? 1 : nn < 3 ? 2 : nn < 7 ? 5 : 10) * mag, out = [];
        for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9; v += st) out.push(+v.toFixed(6));
        return out;
    }
    function pfDraw() {
        const wrap = $('pfWrap'), c = $('pfCanvas'), W = wrap.clientWidth, H = wrap.clientHeight;
        if (!W || !H) return;
        const dpr = window.devicePixelRatio || 1;
        if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
        const g = c.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
        if (!pf.ele) return;
        const e = pf.ele, n = e.length, total = pf.total, PL = 46, PR = 12, PT = 10, PB = 22, pw = W - PL - PR, ph = H - PT - PB;
        if (pw < 20 || ph < 20) return;
        const mn = Math.min.apply(null, e), mx = Math.max.apply(null, e), pad = Math.max((mx - mn) * 0.1, 2), y0 = mn - pad, y1 = mx + pad;
        const X = d => PL + d / total * pw, Y = v => PT + ph - (v - y0) / (y1 - y0) * ph;
        g.font = '10px "Segoe UI", Arial, sans-serif';
        g.lineWidth = 1;
        g.textAlign = 'right'; g.textBaseline = 'middle';
        niceTicks(y0, y1, Math.floor(ph / 32)).forEach(v => {
            const y = Math.round(Y(v)) + 0.5;
            g.strokeStyle = '#e2e8f0'; g.beginPath(); g.moveTo(PL, y); g.lineTo(W - PR, y); g.stroke();
            g.fillStyle = '#64748b'; g.fillText(String(Math.round(v)), PL - 5, y);
        });
        const km = total >= 2000;
        g.textAlign = 'center'; g.textBaseline = 'top';
        niceTicks(0, total, Math.floor(pw / 80)).forEach(v => {
            const x = Math.round(X(v)) + 0.5;
            g.strokeStyle = '#f1f5f9'; g.beginPath(); g.moveTo(x, PT); g.lineTo(x, PT + ph); g.stroke();
            g.fillStyle = '#64748b'; g.fillText(String(+(km ? v / 1000 : v).toFixed(2)), x, PT + ph + 4);
        });
        g.textAlign = 'right'; g.fillStyle = '#94a3b8'; g.fillText(km ? 'км' : 'м', W - 2, PT + ph + 4);
        g.save(); g.translate(10, PT + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('высота, м', 0, -6); g.restore();
        // заливка и линия
        const grad = g.createLinearGradient(0, PT, 0, PT + ph);
        grad.addColorStop(0, 'rgba(16,185,129,0.35)'); grad.addColorStop(1, 'rgba(16,185,129,0.03)');
        g.beginPath(); g.moveTo(X(pf.dist[0]), PT + ph);
        for (let i = 0; i < n; i++) g.lineTo(X(pf.dist[i]), Y(e[i]));
        g.lineTo(X(pf.dist[n - 1]), PT + ph); g.closePath(); g.fillStyle = grad; g.fill();
        g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
        if ($('pfSlopeColor').checked) {
            for (let i = 1; i < n; i++) {
                g.strokeStyle = slopeColor((pf.slope[i] + pf.slope[i - 1]) / 2);
                g.beginPath(); g.moveTo(X(pf.dist[i - 1]), Y(e[i - 1])); g.lineTo(X(pf.dist[i]), Y(e[i])); g.stroke();
            }
        } else {
            g.strokeStyle = '#059669'; g.beginPath();
            for (let i = 0; i < n; i++) { const x = X(pf.dist[i]), y = Y(e[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
            g.stroke();
        }
        // маркер под курсором
        const h = pf.hover;
        if (h >= 0 && h < n) {
            const x = X(pf.dist[h]), y = Y(e[h]);
            g.strokeStyle = '#64748b'; g.lineWidth = 1; g.setLineDash([3, 3]);
            g.beginPath(); g.moveTo(x, PT); g.lineTo(x, PT + ph); g.stroke(); g.setLineDash([]);
            g.fillStyle = '#e11d48'; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
            g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
            const s = pf.slope[h], txt = `${fmtDist(pf.dist[h])} · ${Math.round(e[h])} м · ${s >= 0 ? '↗' : '↘'} ${Math.abs(s).toFixed(1)}%`;
            g.font = '600 11px "Segoe UI", Arial, sans-serif';
            const tw = g.measureText(txt).width + 12, bx = x + 10 + tw > W - 4 ? x - 10 - tw : x + 10;
            g.fillStyle = 'rgba(15,23,42,0.88)'; g.fillRect(bx, PT + 2, tw, 20);
            g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(txt, bx + 6, PT + 12);
        }
    }
    function pfHover(i) {
        pf.hover = i;
        pfDraw();
        if (i < 0 || !pf.ele) { if (pf.hoverMk) { map.removeLayer(pf.hoverMk); pf.hoverMk = null; } return; }
        const p = L.latLng(pf.lat[i], pf.lng[i]);
        if (!pf.hoverMk) pf.hoverMk = L.circleMarker(p, { radius: 6, color: '#ffffff', weight: 2, fillColor: '#e11d48', fillOpacity: 1, interactive: false }).addTo(map);
        else pf.hoverMk.setLatLng(p);
    }
    $('pfCanvas').addEventListener('pointermove', e => {
        if (!pf.ele) return;
        const r = $('pfCanvas').getBoundingClientRect(), PL = 46, PR = 12, pw = r.width - PL - PR;
        const t = Math.min(1, Math.max(0, (e.clientX - r.left - PL) / pw));
        pfHover(Math.round(t * (pf.ele.length - 1)));
    });
    $('pfCanvas').addEventListener('pointerleave', () => pfHover(-1));
    if (window.ResizeObserver) new ResizeObserver(pfDraw).observe($('pfWrap'));
    document.querySelector('.bp-tab[data-bp-tab="profile"]').addEventListener('click', () => setTimeout(pfDraw, 30));

    // --- экспорт ---
    function download(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    $('pfCsv').addEventListener('click', () => {
        if (!pf.ele) return;
        const f = (v, d) => v.toFixed(d).replace('.', ',');
        const rows = ['№;Расстояние, м;Широта;Долгота;Высота, м;Высота (сырая), м;Уклон, %'];
        pf.ele.forEach((v, i) => rows.push([i + 1, f(pf.dist[i], 1), f(pf.lat[i], 6), f(pf.lng[i], 6), f(v, 1), f(pf.raw[i], 1), f(pf.slope[i], 1)].join(';')));
        download(new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'profile.csv');
    });
    $('pfPng').addEventListener('click', () => {
        if (!pf.ele) return;
        const h = pf.hover; pf.hover = -1; pfDraw();
        $('pfCanvas').toBlob(b => { if (b) download(b, 'profile.png'); pf.hover = h; pfDraw(); });
    });

    // --- привязка кнопок ---
    $('profileBtn').addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.widget-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.widget-btn').forEach(b => { if (b.id !== 'mode3dBtn' && b.id !== 'swipeBtn') b.classList.remove('active'); });
        activePanel = null;
        pfToggleDraw();
    });
    $('pfHeat').addEventListener('change', () => pfHeatToggle());
    $('pfBand').addEventListener('change', () => { if (pf.heat) { map.removeLayer(pf.heat); pf.heat = null; pf.hm = null; } pfHeatBuild(); });
    $('pfN').addEventListener('change', () => { if (pf.latlngs) pfCompute(); });
    $('pfSmooth').addEventListener('input', function () { $('pfSmoothVal').textContent = this.value; pfRender(); });
    $('pfSlopeColor').addEventListener('change', pfDraw);
    // ---------- ТЕПЛОВАЯ КАРТА ВЫСОТ: для линии — полоса вдоль линии, для полигона — вся площадь ----------
    const HM_STOPS = [[43, 131, 186], [171, 221, 164], [255, 255, 191], [253, 174, 97], [215, 25, 28]];   // синий → зелёный → жёлтый → оранжевый → красный
    function hmColor(t) {
        t = Math.max(0, Math.min(1, t));
        const k = t * (HM_STOPS.length - 1), i = Math.min(HM_STOPS.length - 2, Math.floor(k)), f = k - i, a = HM_STOPS[i], b = HM_STOPS[i + 1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    // a = [сетка высот, строк, столбцов, запад, север, шаг по широте, шаг по долготе, мин, макс]
    function hmMake(a) {
        const grid = a[0], rows = a[1], cols = a[2], bw = a[3], bn = a[4], dLat = a[5], dLng = a[6], mn = a[7], mx = a[8], span = (mx - mn) || 1;
        const c0 = document.createElement('canvas'); c0.width = cols; c0.height = rows;
        const g0 = c0.getContext('2d'), img = g0.createImageData(cols, rows);
        for (let i = 0; i < grid.length; i++) {
            const v = grid[i]; if (v !== v) continue;
            const c = hmColor((v - mn) / span), o = i * 4;
            img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
        g0.putImageData(img, 0, 0);
        const sc = Math.max(1, Math.min(4, Math.floor(1600 / Math.max(cols, rows)))), c1 = document.createElement('canvas');
        c1.width = cols * sc; c1.height = rows * sc;
        const g1 = c1.getContext('2d'); g1.imageSmoothingEnabled = true; g1.imageSmoothingQuality = 'high';
        g1.drawImage(c0, 0, 0, c1.width, c1.height);   // плавное «тепловое» сглаживание
        return L.imageOverlay(c1.toDataURL('image/png'), [[bn - rows * dLat, bw], [bn, bw + cols * dLng]], { opacity: 0.7, interactive: false, pane: 'tilePane', zIndex: 12 });
    }
    function hmLegendSync() {
        const el = $('hmLegend'); if (!el) return;
        const mode = (pfPaneEl && pfPaneEl.dataset.pfMode) || 'line', d = mode === 'area' ? hy.hm : pf.hm;
        el.hidden = !d;
        if (d) { $('hmMin').textContent = Math.round(d.mn); $('hmMax').textContent = Math.round(d.mx); }
    }
    // сетка высот внутри полигона (для полосы вдоль линии)
    async function hmGrid(gj, alive) {
        const area = turf.area(gj), bb = turf.bbox(gj), bw = bb[0], bs = bb[1], be = bb[2], bn = bb[3];
        const cosL = Math.cos((bs + bn) / 2 * Math.PI / 180), mLat = 111320, mLng = 111320 * cosL;
        let step = Math.max(3, Math.sqrt(area / 12000));
        while (((be - bw) * mLng / step) * ((bn - bs) * mLat / step) > 90000) step *= 1.2;
        const cols = Math.ceil((be - bw) * mLng / step), rows = Math.ceil((bn - bs) * mLat / step), dLat = step / mLat, dLng = step / mLng;
        let z = Math.max(5, Math.min(14, Math.ceil(Math.log2(156543.03 * cosL / step))));
        const rng = zz => { const a = tileXY(bn, bw, zz), b = tileXY(bs, be, zz); return { x0: Math.floor(a.x), x1: Math.floor(b.x), y0: Math.floor(a.y), y1: Math.floor(b.y) }; };
        let R = rng(z); while (z > 5 && (R.x1 - R.x0 + 1) * (R.y1 - R.y0 + 1) > 48) R = rng(--z);
        const data = {}, jobs = [];
        for (let x = R.x0; x <= R.x1; x++) for (let y = R.y0; y <= R.y1; y++) jobs.push(pfTile(z, x, y).then(a => { data[x + ',' + y] = a; }));
        await Promise.all(jobs);
        if (!alive()) return null;
        const polys = gj.geometry.type === 'Polygon' ? [gj.geometry.coordinates] : gj.geometry.coordinates;
        const grid = new Float32Array(rows * cols).fill(NaN); let mn = Infinity, mx = -Infinity;
        for (let r = 0; r < rows; r++) {
            const lat = bn - (r + 0.5) * dLat;
            for (let c = 0; c < cols; c++) {
                const lng = bw + (c + 0.5) * dLng;
                if (!inPoly(lng, lat, polys)) continue;
                const t = tileXY(lat, lng, z), tx = Math.floor(t.x), ty = Math.floor(t.y), a = data[tx + ',' + ty];
                if (!a) continue;
                const px = Math.min(254.999, Math.max(0, (t.x - tx) * 256 - 0.5)), py = Math.min(254.999, Math.max(0, (t.y - ty) * 256 - 0.5));
                const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0, o = y0 * 256 + x0;
                const v = a[o] * (1 - fx) * (1 - fy) + a[o + 1] * fx * (1 - fy) + a[o + 256] * (1 - fx) * fy + a[o + 257] * fx * fy;
                grid[r * cols + c] = v; if (v < mn) mn = v; if (v > mx) mx = v;
            }
            if (r % 30 === 29) { await yieldUI(); if (!alive()) return null; }
        }
        if (!(mx > -Infinity)) return null;
        return [grid, rows, cols, bw, bn, dLat, dLng, mn, mx];
    }
    async function pfHeatBuild() {
        if (pf.heat || !pf.latlngs || !$('pfHeat').checked || !window.turf) return;
        const my = pf.seq, width = +$('pfBand').value || Math.min(600, Math.max(40, (pf.total || 0) / 12));   // полная ширина полосы, м
        let poly;
        try { poly = turf.buffer(turf.lineString(pf.latlngs.map(q => [q.lng, q.lat])), width / 2, { units: 'meters' }); } catch (e) { return; }
        if (!poly || !poly.geometry) return;
        let a = null;
        try { a = await hmGrid(poly, () => my === pf.seq); } catch (e) { console.warn('heat', e); }
        if (!a || my !== pf.seq || pf.heat) return;
        pf.heat = hmMake(a).addTo(map);
        pf.hm = { mn: a[7], mx: a[8] };
        hmLegendSync();
    }
    function pfHeatToggle() {
        if (!$('pfHeat').checked) { if (pf.heat) { map.removeLayer(pf.heat); pf.heat = null; } pf.hm = null; hmLegendSync(); return; }
        pfHeatBuild();
    }
    function hyHeatShow() {
        if (hy.heat) { map.removeLayer(hy.heat); hy.heat = null; }
        hy.hm = null;
        if (hy.hmArgs && $('hyHeat').checked) {
            hy.heat = hmMake(hy.hmArgs).addTo(map);
            hy.hm = { mn: hy.hmArgs[7], mx: hy.hmArgs[8] };
        }
        hmLegendSync();
    }

    // ---------- РИСОВАНИЕ ВКЛЮЧАЕТСЯ САМО при открытой вкладке «Профиль» и переключается режимом «По линии / По площади» ----------
    const pfPaneEl = document.querySelector('.bp-profile');
    const pfPaneOn = () => !!(pfPaneEl && pfPaneEl.classList.contains('active') && pfPaneEl.offsetParent !== null);
    function drawSync() {
        if (!pfPaneEl) return;
        if (!pfPaneOn()) {   // ушли с вкладки — рисование выключаем
            if (pf.drawing) { if (pf.pts.length) pfClear(); else pfEndDrawUI(); }
            hyStopDraw();
            return;
        }
        if ((pfPaneEl.dataset.pfMode || 'line') === 'area') {
            if (pf.drawing) { if (pf.pts.length) pfClear(); else pfEndDrawUI(); }
            hyStart(true);
        } else {
            hyStopDraw();
            pfStart(true);
        }
    }
    if (window.MutationObserver && pfPaneEl) {
        const sched = () => setTimeout(drawSync, 30);
        new MutationObserver(sched).observe(pfPaneEl, { attributes: true, attributeFilter: ['class'] });
        const mpEl = document.getElementById('mainPanel'), bpEl = document.getElementById('bottomPanel');
        if (mpEl) new MutationObserver(sched).observe(mpEl, { attributes: true, attributeFilter: ['data-view', 'class'] });
        if (bpEl) new MutationObserver(sched).observe(bpEl, { attributes: true, attributeFilter: ['class'] });
    }

    // ---------- ГИПСОМЕТРИЧЕСКАЯ КРИВАЯ: распределение высот по площади полигона (вкладка «Профиль» → «По площади») ----------
    const hy = { gj: null, layer: null, drawing: false, handler: null, seq: 0, area: 0, step: 0, z: 0, miss: 0, e: null, cw: null, curve: null, st: null, bins: null, bs: 0, hover: -1 };
    const yieldUI = () => new Promise(r => setTimeout(r));
    const fmtArea = m2 => m2 >= 1e6 ? (m2 / 1e6).toFixed(2) + ' км²' : (m2 / 1e4).toFixed(m2 < 1e5 ? 2 : 1) + ' га';
    const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const inPoly = (x, y, polys) => polys.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
    function hyGJ(l) {
        if (!l) return null;
        let gj = l instanceof L.Circle ? turf.circle([l.getLatLng().lng, l.getLatLng().lat], l.getRadius() / 1000, { steps: 64 }) : (l.toGeoJSON ? l.toGeoJSON() : null);
        if (gj && gj.type === 'FeatureCollection') gj = gj.features[0];
        return gj && gj.geometry && /Polygon/.test(gj.geometry.type) ? gj : null;
    }
    function hySetMode(m) {
        document.querySelector('.bp-profile').dataset.pfMode = m;
        document.querySelectorAll('.hy-mode [data-pf-mode]').forEach(b => b.classList.toggle('pf-on', b.dataset.pfMode === m));
        if (m !== 'area') hyStopDraw();
        hmLegendSync();
        drawSync();
        setTimeout(() => { pfDraw(); hyDraw(); }, 30);
    }
    function hyStopDraw() {
        const h = hy.handler; hy.handler = null; hy.drawing = false;
        if (h) { try { h.disable(); } catch (e) { /* не критично */ } }
    }
    function hyClear() {
        hy.seq++; hyStopDraw();
        if (hy.layer) { map.removeLayer(hy.layer); hy.layer = null; }
        if (hy.heat) { map.removeLayer(hy.heat); hy.heat = null; }
        hy.hm = null; hy.hmArgs = null; hmLegendSync();
        Object.assign(hy, { gj: null, area: 0, e: null, cw: null, curve: null, st: null, bins: null, hover: -1 });
        $('hyCsv').disabled = $('hyPng').disabled = true;
        hyStatsRender(); hyDraw();
        $('hyEmpty').textContent = 'Обведите полигон на карте: ЛКМ — точки, двойной клик по последней точке — завершить';
        $('hyEmpty').hidden = false;
    }
    function hyFail(msg) { $('hyEmpty').textContent = msg; $('hyEmpty').hidden = false; updateStatus('⚠️ Гипсометрия: ' + msg, true); }
    function hyStart(keep) {
        if (hy.drawing) return;
        if (m3d.active) { updateStatus('ℹ️ Гипсометрия строится на 2D-карте — выключите 3D кнопкой «2D» на карте', true); return; }
        try { if (measureMode) deactivateMeasureMode(); } catch (e) { /* не критично */ }
        try { if (currentTool || activeDrawHandler || isEditing || sketchState.tool) deactivateAllTools(); } catch (e) { /* не критично */ }
        if (pf.drawing) { if (pf.pts.length) pfClear(); else pfEndDrawUI(); }
        if (!keep) hyClear();   // при автозапуске прежний результат остаётся, пока не нарисован новый полигон
        hy.drawing = true;
        hy.handler = new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: { color: '#7c3aed', weight: 2, fillColor: '#7c3aed', fillOpacity: 0.1 } });
        hy.handler.enable();
        updateStatus('⛰️ Гипсометрия: обведите полигон на карте (двойной клик по последней точке — завершить)');
    }
    window.hyOnCreated = e => {
        if (!hy.drawing || !e.layer) return false;
        const gj = hyGJ(e.layer); hyStopDraw();
        if (gj) hyRun(gj);
        return true;
    };
    function hyFromSel() {
        const gj = hyGJ(sketchState.selected || selectedLayer);
        if (!gj) { updateStatus('ℹ️ Выберите полигон, прямоугольник или круг на карте или на вкладке «Рисование»', true); return; }
        if (pf.drawing) pfClear();
        hyStopDraw(); hyRun(gj);
    }
    window.gcPfFromSelected = pfFromSelected;   // действия из меню на карте (правый клик по нарисованному объекту)
    window.gcHyFromSelected = hyFromSel;
    window.gcProfileBusy = () => !!(pf.drawing || hy.drawing);
    window.gcProfileClear = () => { pfClear(); hyClear(); drawSync(); };

    async function hyRun(gj) {
        const al = window.AnLoader ? AnLoader.start('Гипсометрия участка', 'Загрузка тайлов высот…') : 0;
        try { await hyCalc(gj); } catch (e) { console.error(e); hyFail('ошибка расчёта — ' + (e && e.message || e)); }
        finally { if (window.AnLoader) AnLoader.end(al); }
        drawSync();   // снова готовы обводить следующий полигон
    }
    async function hyCalc(gj) {
        hyClear();
        const my = hy.seq;
        hy.gj = gj; hy.area = turf.area(gj);
        hy.layer = L.geoJSON(gj, { style: { color: '#7c3aed', weight: 3, fillColor: '#7c3aed', fillOpacity: 0.08 }, interactive: false }).addTo(map);
        hySetMode('area'); pfOpenTab();
        if (hy.area < 400) return hyFail('полигон слишком мал (менее 400 м²)');
        if (hy.area > 1e10) return hyFail('полигон слишком большой (более 10 000 км²)');
        const [bw, bs, be, bn] = turf.bbox(gj), cosL = Math.cos((bs + bn) / 2 * Math.PI / 180), mLat = 111320, mLng = 111320 * cosL;
        let step = Math.max(3, Math.sqrt(hy.area / 30000));                       // ~30 000 точек внутри полигона
        while (((be - bw) * mLng / step) * ((bn - bs) * mLat / step) > 250000) step *= 1.2;
        const cols = Math.ceil((be - bw) * mLng / step), rows = Math.ceil((bn - bs) * mLat / step), dLat = step / mLat, dLng = step / mLng;
        let z = Math.max(5, Math.min(14, Math.ceil(Math.log2(156543.03 * cosL / step))));
        const rng = zz => { const a = tileXY(bn, bw, zz), b = tileXY(bs, be, zz); return { x0: Math.floor(a.x), x1: Math.floor(b.x), y0: Math.floor(a.y), y1: Math.floor(b.y) }; };
        let R = rng(z); while (z > 5 && (R.x1 - R.x0 + 1) * (R.y1 - R.y0 + 1) > 48) R = rng(--z);
        const total = (R.x1 - R.x0 + 1) * (R.y1 - R.y0 + 1), data = {}, jobs = []; let done = 0;
        $('hyEmpty').hidden = false; $('hyEmpty').textContent = 'Загрузка высот: 0/' + total + '…';
        updateStatus('⛰️ Гипсометрия: загружаю тайлы высот…');
        for (let x = R.x0; x <= R.x1; x++) for (let y = R.y0; y <= R.y1; y++)
            jobs.push(pfTile(z, x, y).then(a => { data[x + ',' + y] = a; $('hyEmpty').textContent = 'Загрузка высот: ' + (++done) + '/' + total + '…'; if (window.AnLoader) AnLoader.progress(done / total * 55, 'Загрузка высот: ' + done + '/' + total); }));
        await Promise.all(jobs);
        if (my !== hy.seq) return;

        const polys = gj.geometry.type === 'Polygon' ? [gj.geometry.coordinates] : gj.geometry.coordinates;
        const grid = new Float32Array(rows * cols).fill(NaN), vals = [], wts = []; let miss = 0;
        for (let r = 0; r < rows; r++) {
            const lat = bn - (r + 0.5) * dLat, wt = Math.cos(lat * Math.PI / 180);
            for (let c = 0; c < cols; c++) {
                const lng = bw + (c + 0.5) * dLng;
                if (!inPoly(lng, lat, polys)) continue;
                const t = tileXY(lat, lng, z), tx = Math.floor(t.x), ty = Math.floor(t.y), a = data[tx + ',' + ty];
                if (!a) { miss++; continue; }
                const px = Math.min(254.999, Math.max(0, (t.x - tx) * 256 - 0.5)), py = Math.min(254.999, Math.max(0, (t.y - ty) * 256 - 0.5));
                const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0, o = y0 * 256 + x0;
                const v = a[o] * (1 - fx) * (1 - fy) + a[o + 1] * fx * (1 - fy) + a[o + 256] * (1 - fx) * fy + a[o + 257] * fx * fy;
                grid[r * cols + c] = v; vals.push(v); wts.push(wt);
            }
            if (r % 40 === 39) { $('hyEmpty').textContent = 'Расчёт: ' + Math.round(r / rows * 100) + '%'; if (window.AnLoader) AnLoader.progress(55 + r / rows * 45, 'Расчёт по площади: ' + Math.round(r / rows * 100) + '%'); await yieldUI(); if (my !== hy.seq) return; }
        }
        const nV = vals.length;
        if (nV < 10) return hyFail(miss ? 'не удалось загрузить данные рельефа. Проверьте подключение к интернету' : 'в полигоне слишком мало точек выборки');
        const idx = Array.from({ length: nV }, (_, i) => i).sort((a, b) => vals[a] - vals[b]);
        const e = new Float32Array(nV), cw = new Float64Array(nV); let W = 0, sm = 0;
        idx.forEach((k, i) => { e[i] = vals[k]; W += wts[k]; sm += vals[k] * wts[k]; cw[i] = W; });
        for (let i = 0; i < nV; i++) cw[i] /= W;
        const pct = p => { let lo = 0, hi = nV - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cw[m] >= p) hi = m; else lo = m + 1; } return e[lo]; };
        const curve = []; for (let q = 0; q <= 400; q++) curve.push([q / 400, pct(1 - q / 400)]);
        let sSum = 0, sN = 0, steep = 0;                                          // уклон по центральным разностям сетки
        for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
            const i = r * cols + c, v = grid[i];
            if (v !== v || grid[i - 1] !== grid[i - 1] || grid[i + 1] !== grid[i + 1] || grid[i - cols] !== grid[i - cols] || grid[i + cols] !== grid[i + cols]) continue;
            const sl = Math.hypot((grid[i + 1] - grid[i - 1]) / (2 * step), (grid[i + cols] - grid[i - cols]) / (2 * step)) * 100;
            sSum += sl; sN++; if (sl > 15) steep++;
        }
        const mn = e[0], mx = e[nV - 1], mean = sm / W;
        Object.assign(hy, { e, cw, curve, step, z, miss, hover: -1,
            st: { n: nV, min: mn, max: mx, mean, median: pct(0.5), p10: pct(0.1), p90: pct(0.9), hi: mx > mn ? (mean - mn) / (mx - mn) : 0, slope: sN ? sSum / sN : null, steep: sN ? steep / sN : null } });
        hyBinning(); hyStatsRender();
        hy.hmArgs = [grid, rows, cols, bw, bn, dLat, dLng, mn, mx];
        hyHeatShow();
        $('hyEmpty').hidden = true; $('hyCsv').disabled = $('hyPng').disabled = false;
        hyDraw();
        updateStatus(`⛰️ Гипсометрия: ${fmtArea(hy.area)}, высоты ${fmtM(mn)} – ${fmtM(mx)}, перепад ${fmtM(mx - mn)}` + (miss ? ' (часть данных не загрузилась)' : ''));
    }

    function hyBinning() {
        const st = hy.st; if (!st) return;
        let bs = +$('hyStep').value;
        if (!bs) { const s0 = Math.max(st.max - st.min, 1) / 10, mag = Math.pow(10, Math.floor(Math.log10(s0))), nn = s0 / mag; bs = (nn < 1.5 ? 1 : nn < 3 ? 2 : nn < 7 ? 5 : 10) * mag; }
        const a = Math.floor(st.min / bs) * bs, nb = Math.min(200, Math.max(1, Math.ceil((st.max - a) / bs - 1e-9)));
        const bins = Array.from({ length: nb }, (_, i) => ({ a: a + i * bs, b: a + (i + 1) * bs, f: 0 }));
        for (let i = 0; i < hy.e.length; i++) bins[Math.min(nb - 1, Math.floor((hy.e[i] - a) / bs))].f += hy.cw[i] - (i ? hy.cw[i - 1] : 0);
        hy.bins = bins; hy.bs = bs;
    }
    function hyStatsRender() {
        const box = $('hyStats'), st = hy.st;
        if (!st) { box.innerHTML = '<div class="m3-hint">Нет данных</div>'; return; }
        const rows = [
            ['Площадь', fmtArea(hy.area)], ['Точек выборки', st.n], ['Шаг сетки', Math.round(hy.step) + ' м'], ['Перепад', fmtM(st.max - st.min)],
            ['Мин. высота', fmtM(st.min)], ['Макс. высота', fmtM(st.max)], ['Средняя', fmtM(st.mean)], ['Медиана', fmtM(st.median)],
            ['90% площади выше', fmtM(st.p10)], ['10% площади выше', fmtM(st.p90)],
            ['Гипс. интеграл', st.hi.toFixed(2)], ['Ср. уклон', st.slope == null ? 'н/д' : st.slope.toFixed(1) + '%'],
            ['Круче 15%', st.steep == null ? 'н/д' : (st.steep * 100).toFixed(1) + '% площади']
        ];
        box.innerHTML = rows.map(r => `<div class="pf-st"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
    }

    function hyDraw() {
        const wrap = $('hyWrap'), c = $('hyCanvas'), W = wrap.clientWidth, H = wrap.clientHeight;
        if (!W || !H) return;
        const dpr = window.devicePixelRatio || 1;
        if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
        const g = c.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
        const st = hy.st; if (!st || !hy.bins) return;
        const PL = 46, PR = 12, PT = 10, PB = 34, pw = W - PL - PR, ph = H - PT - PB;
        if (pw < 20 || ph < 20) return;
        const view = $('hyView').value, belts = view === 'belts', rel = view === 'rel', bins = hy.bins, t = hy.hover;
        const span = (st.max - st.min) || 1, pad = Math.max(span * 0.08, 1);
        const fyv = v => rel ? (v - st.min) / span * 100 : v;
        const ya = belts ? 0 : rel ? 0 : st.min - pad, yb = belts ? Math.max(Math.max.apply(null, bins.map(b => b.f)) * 115, 1) : rel ? 100 : st.max + pad;
        const Y = v => PT + ph - (v - ya) / (yb - ya) * ph, X = f => PL + f * pw;
        g.font = '10px "Segoe UI", Arial, sans-serif'; g.lineWidth = 1;
        g.textAlign = 'right'; g.textBaseline = 'middle';
        niceTicks(ya, yb, Math.floor(ph / 32)).forEach(v => {
            const y = Math.round(Y(v)) + 0.5;
            g.strokeStyle = '#e2e8f0'; g.beginPath(); g.moveTo(PL, y); g.lineTo(W - PR, y); g.stroke();
            g.fillStyle = '#64748b'; g.fillText(String(+v.toFixed(1)), PL - 5, y);
        });
        g.fillStyle = '#94a3b8';
        g.save(); g.translate(10, PT + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(belts ? 'доля площади, %' : rel ? 'высота, % от перепада' : 'высота, м', 0, -6); g.restore();
        g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillText(belts ? 'высота, м' : 'площадь выше отметки, %', PL + pw / 2, H - 12);
        let tip = '';
        if (!belts) {
            for (let p = 0; p <= 100; p += 20) {
                const x = Math.round(X(p / 100)) + 0.5;
                g.strokeStyle = '#f1f5f9'; g.beginPath(); g.moveTo(x, PT); g.lineTo(x, PT + ph); g.stroke();
                g.fillStyle = '#64748b'; g.fillText(String(p), x, PT + ph + 4);
            }
            const cv = hy.curve, grad = g.createLinearGradient(0, PT, 0, PT + ph);
            grad.addColorStop(0, 'rgba(124,58,237,0.35)'); grad.addColorStop(1, 'rgba(124,58,237,0.03)');
            g.beginPath(); g.moveTo(X(0), PT + ph);
            cv.forEach(p => g.lineTo(X(p[0]), Y(fyv(p[1]))));
            g.lineTo(X(1), PT + ph); g.closePath(); g.fillStyle = grad; g.fill();
            if (rel) { g.setLineDash([4, 4]); g.strokeStyle = '#94a3b8'; g.beginPath(); g.moveTo(X(0), Y(100)); g.lineTo(X(1), Y(0)); g.stroke(); g.setLineDash([]); }
            g.lineWidth = 2; g.lineJoin = 'round'; g.strokeStyle = '#7c3aed'; g.beginPath();
            cv.forEach((p, i) => { const x = X(p[0]), y = Y(fyv(p[1])); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
            g.stroke(); g.lineWidth = 1;
            const ym = Y(fyv(st.mean)); g.setLineDash([3, 3]); g.strokeStyle = '#f59e0b'; g.beginPath(); g.moveTo(PL, ym); g.lineTo(W - PR, ym); g.stroke(); g.setLineDash([]);
            g.fillStyle = '#b45309'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('средняя ' + Math.round(st.mean) + ' м', PL + 4, ym - 2);
            if (rel) { g.textAlign = 'right'; g.textBaseline = 'top'; g.fillStyle = '#6d28d9'; g.fillText('HI = ' + st.hi.toFixed(2), W - PR - 4, PT + 4); }
            if (t >= 0) {
                const p = hy.curve[Math.round(t * 400)], x = X(p[0]), y = Y(fyv(p[1]));
                g.strokeStyle = '#64748b'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, PT); g.lineTo(x, PT + ph); g.stroke(); g.setLineDash([]);
                g.fillStyle = '#e11d48'; g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
                tip = `${(p[0] * 100).toFixed(0)}% площади (${fmtArea(p[0] * hy.area)}) выше ${Math.round(p[1])} м`;
            }
        } else {
            const nb = bins.length, bw = pw / nb, every = Math.max(1, Math.ceil(46 / bw)), hi = t >= 0 ? Math.min(nb - 1, Math.floor(t * nb)) : -1;
            bins.forEach((b, i) => {
                const x = PL + i * bw, y = Y(b.f * 100);
                g.fillStyle = `hsl(${Math.round(150 - 130 * i / Math.max(1, nb - 1))},55%,${i === hi ? 35 : 50}%)`;
                g.fillRect(x + 0.5, y, Math.max(1, bw - 1), PT + ph - y);
            });
            g.fillStyle = '#64748b'; g.textAlign = 'center'; g.textBaseline = 'top';
            for (let i = 0; i <= nb; i += every) g.fillText(String(+(bins[Math.min(i, nb - 1)][i === nb ? 'b' : 'a']).toFixed(1)), PL + i * bw, PT + ph + 4);
            if (hi >= 0) { const b = bins[hi]; tip = `${+b.a.toFixed(1)}–${+b.b.toFixed(1)} м · ${(b.f * 100).toFixed(1)}% · ${fmtArea(b.f * hy.area)}`; }
        }
        if (tip) {
            const x = PL + t * pw;
            g.font = '600 11px "Segoe UI", Arial, sans-serif';
            const tw = g.measureText(tip).width + 12, bx = x + 10 + tw > W - 4 ? x - 10 - tw : x + 10;
            g.fillStyle = 'rgba(15,23,42,0.88)'; g.fillRect(Math.max(PL, bx), PT + 2, tw, 20);
            g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(tip, Math.max(PL, bx) + 6, PT + 12);
        }
    }
    $('hyCanvas').addEventListener('pointermove', e => {
        if (!hy.st) return;
        const r = $('hyCanvas').getBoundingClientRect();
        hy.hover = Math.min(1, Math.max(0, (e.clientX - r.left - 46) / (r.width - 58))); hyDraw();
    });
    $('hyCanvas').addEventListener('pointerleave', () => { hy.hover = -1; hyDraw(); });
    if (window.ResizeObserver) new ResizeObserver(hyDraw).observe($('hyWrap'));
    document.querySelector('.bp-tab[data-bp-tab="profile"]').addEventListener('click', () => setTimeout(hyDraw, 30));

    $('hyCsv').addEventListener('click', () => {
        if (!hy.st) return;
        const f = (v, d) => v.toFixed(d).replace('.', ',');
        const rows = ['Ступень от, м;до, м;Площадь, м²;Площадь, %;Выше ступени (накоплено), %'];
        let above = 100;
        hy.bins.slice().reverse().forEach(b => { rows.push([f(b.a, 1), f(b.b, 1), f(b.f * hy.area, 0), f(b.f * 100, 2), f(above - b.f * 100, 2)].join(';')); above -= b.f * 100; });
        rows.push('', 'Доля площади выше отметки, %;Высота, м');
        for (let q = 0; q <= 400; q += 20) rows.push(f(q / 4, 0) + ';' + f(hy.curve[q][1], 1));
        download(new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'hypsometry.csv');
    });
    $('hyPng').addEventListener('click', () => {
        if (!hy.st) return;
        const h = hy.hover; hy.hover = -1; hyDraw();
        $('hyCanvas').toBlob(b => { if (b) download(b, 'hypsometry.png'); hy.hover = h; hyDraw(); });
    });
    document.querySelectorAll('.hy-mode [data-pf-mode]').forEach(b => b.addEventListener('click', () => hySetMode(b.dataset.pfMode)));
    $('profileBtn').addEventListener('click', () => hySetMode('line'));
    $('hyHeat').addEventListener('change', () => hyHeatShow());
    $('hyView').addEventListener('change', hyDraw);
    $('hyStep').addEventListener('change', () => { hyBinning(); hyDraw(); });
    map.on('draw:drawstop', () => { if (hy.drawing) { hyStopDraw(); setTimeout(drawSync, 50); } });   // Esc в процессе рисования — снова готовы обводить
    hyClear();
    pfClear();
})();



// ===== ЛОГИСТИЧЕСКИЙ АНАЛИЗ: один объект, буфер, дороги и водоёмы OSM (Overpass), ближайшие объекты (прямая + маршрут OSRM) =====
(function () {
    const $ = id => document.getElementById(id);
    if (!$('lgBuffer')) return;
    const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    const OSRM = 'https://router.project-osrm.org/';
    const MAIN_RE = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;
    const P_MAIN = ['way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]'];
    const P_LOCAL = ['way["highway"~"^(unclassified|residential|service|living_street|track)$"]'];
    const P_WW = ['way["waterway"~"^(river|stream|canal|ditch|drain)$"]'];
    const P_WATER = ['way["natural"="water"]', 'way["landuse"="reservoir"]', 'relation["natural"="water"]'];
    const grpObj = L.featureGroup().addTo(map), grp = L.featureGroup().addTo(map);
    const grpRoads = L.featureGroup().addTo(map), grpWater = L.featureGroup().addTo(map), grpNear = L.featureGroup().addTo(map);
    const cache = new Map();
    let obj = null, objLayer = null, tool = null, handler = null, editing = false;

    const wait = ms => new Promise(r => setTimeout(r, ms));
    const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const fmtD = m => m < 1000 ? Math.round(m) + ' м' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' км';
    const fmtA = m2 => m2 >= 1e6 ? (m2 / 1e6).toFixed(2) + ' км²' : (m2 / 1e4).toFixed(m2 < 1e5 ? 2 : 1) + ' га';
    const setStatus = (t, err) => { const e = $('lgStatus'); e.textContent = t; e.classList.toggle('lg-err', !!err); };
    const setBusy = on => { $('lgBuffer').disabled = on; $('lgNearest').disabled = on; };
    const closed = l => l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];
    const kindOf = t => t.highway ? (MAIN_RE.test(t.highway) ? 'main' : 'local') : (t.waterway ? 'waterway' : 'water');
    const errText = e => e.name === 'AbortError' ? (stopped() ? CANCEL : 'таймаут') : e.message;

    // ---- Ход обработки: тулбар прогресса, отмена расчёта ----
    let run = null;   // текущий расчёт: { ctl, t0 }
    const CANCEL = 'отменено', stopped = () => !!(run && run.ctl.signal.aborted);
    const chk = () => { if (stopped()) throw new Error(CANCEL); };
    const abortRun = () => { if (run) run.ctl.abort(); };
    function prog(p, text) {
        p = Math.min(100, p); $('lgProgBar').style.width = p + '%'; $('lgProgPct').textContent = Math.round(p) + '%';
        if (text) $('lgProgTxt').textContent = text;
        if (window.AnLoader) AnLoader.progress(p, text);
    }
    function progStart(text, title) {
        run = { ctl: new AbortController(), t0: Date.now() };
        run.al = window.AnLoader ? AnLoader.start(title || 'Логистический анализ', text, { onCancel: abortRun }) : 0;
        $('lgProg').className = 'dw-block lg-prog lg-run'; prog(0, text); $('lgStop').disabled = false; setBusy(true);
    }
    function progEnd(my, kind, text) {      // kind: ok | part | fail
        if (run !== my) return;
        if (window.AnLoader) AnLoader.end(my.al);
        $('lgProg').className = 'dw-block lg-prog lg-' + kind;
        if (kind !== 'fail') prog(100);
        $('lgProgTxt').textContent = text + ' · ' + ((Date.now() - my.t0) / 1000).toFixed(1) + ' с';
        $('lgStop').disabled = true; run = null; setBusy(false);
    }
    async function fetchT(url, ms) {
        const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms), rc = run && run.ctl, onAbort = () => ctl.abort();
        if (rc) { if (rc.signal.aborted) ctl.abort(); else rc.signal.addEventListener('abort', onAbort); }
        try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(tm); if (rc) rc.signal.removeEventListener('abort', onAbort); }
    }
    // Запрос Overpass: несколько зеркал по очереди, таймаут, кэш; ошибка содержит причину
    async function overpass(q) {
        if (cache.has(q)) return cache.get(q);
        let last = 'нет ответа';
        for (const url of OVERPASS) {
            try {
                const r = await fetchT(url + '?data=' + encodeURIComponent(q), 30000);
                if (!r.ok) { last = 'HTTP ' + r.status; continue; }
                const j = await r.json(), els = j.elements || [];
                if (j.remark && !els.length && /error|timed out|out of memory/i.test(j.remark)) { last = 'сервер перегружен'; continue; }
                cache.set(q, els); if (cache.size > 30) cache.delete(cache.keys().next().value);
                return els;
            } catch (e) { if (stopped()) throw new Error(CANCEL); last = errText(e); }
        }
        throw new Error(last);
    }
    // Текст запроса: scope = {bbox:'s,w,n,e'} или {around:'(around:r,lat,lon)'}
    const Q = (stmts, sc) => '[out:json][timeout:25]' + (sc.bbox ? '[bbox:' + sc.bbox + ']' : '') + ';(' + stmts.map(s => s + (sc.around || '') + ';').join('') + ');out geom qt;';
    // Линии элемента Overpass: [[lon,lat],...]
    function toLines(el) {
        const out = [], add = g => { if (g && g.length > 1) out.push(g.map(p => [p.lon, p.lat])); };
        if (el.type === 'way') add(el.geometry);
        else if (el.type === 'relation') (el.members || []).forEach(m => { if (m.role === 'outer') add(m.geometry); });
        return out;
    }
    // Часть линии внутри буфера (по серединам сегментов) и её длина, км
    function clipLine(line, poly) {
        const runs = []; let cur = [], len = 0;
        for (let i = 0; i < line.length - 1; i++) {
            const a = line[i], b = line[i + 1];
            if (turf.booleanPointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], poly)) {
                if (!cur.length) cur.push(a);
                cur.push(b); len += turf.distance(a, b);
            } else if (cur.length) { runs.push(cur); cur = []; }
        }
        if (cur.length) runs.push(cur);
        return { runs, len };
    }
    function originOf(gj) {
        const g = gj.geometry.type;
        if (g === 'Point') return gj.geometry.coordinates;
        if (g === 'LineString') return turf.along(gj, turf.length(gj) / 2).geometry.coordinates;
        const c = turf.centroid(gj).geometry.coordinates;
        return (g.endsWith('Polygon') && !turf.booleanPointInPolygon(c, gj)) ? turf.pointOnFeature(gj).geometry.coordinates : c;
    }
    function layerGJ(l) {
        if (l instanceof L.Circle) { const c = l.getLatLng(); return turf.circle([c.lng, c.lat], l.getRadius() / 1000, { steps: 48 }); }
        if (!l || !l.toGeoJSON) return null;
        let gj = l.toGeoJSON(); if (gj.type === 'FeatureCollection') gj = gj.features[0];
        return gj && gj.geometry ? gj : null;
    }
    function labelOf(gj, kind) {
        const t = gj.geometry.type;
        if (t === 'Point') return 'Точка: ' + gj.geometry.coordinates[1].toFixed(5) + ', ' + gj.geometry.coordinates[0].toFixed(5);
        if (t.endsWith('Polygon')) return (kind || 'Полигон') + ' · ' + fmtA(turf.area(gj));
        return 'Линия · ' + fmtD(turf.length(gj) * 1000);
    }
    const emptyRes = () => { $('lgStats').innerHTML = '<div class="m3-hint">Постройте буфер</div>'; $('lgNear').innerHTML = ''; };
    const drawOrigin = () => { if (obj.gj.geometry.type !== 'Point') L.circleMarker([obj.origin[1], obj.origin[0]], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#0f172a', fillOpacity: 1, interactive: false }).addTo(grp); };
    // Сбросить результаты и обновить данные объекта
    function applyObj(gj, label) {
        abortRun(); obj = { gj, origin: originOf(gj) };
        [grp, grpRoads, grpWater, grpNear].forEach(g => g.clearLayers());
        drawOrigin(); emptyRes();
        $('lgObj').textContent = label;
        setStatus('Объект задан. Задайте радиус и нажмите «Буфер и анализ»');
    }
    // Объект только один: новый заменяет прежний
    function setObj(gj, label, layer) {
        setEditing(false);
        if (layer !== objLayer) { grpObj.clearLayers(); objLayer = null; if (layer) { grpObj.addLayer(layer); objLayer = layer; } }
        applyObj(gj, label);
    }
    function setEditing(on) {
        if (objLayer && objLayer.editing) on ? objLayer.editing.enable() : objLayer.editing.disable();
        editing = !!(on && objLayer && objLayer.editing);
        $('lgEdit').classList.toggle('pf-on', editing);
    }
    // ---- Инструменты рисования (как в верхней панели) ----
    function markTool() { document.querySelectorAll('[data-lg-tool]').forEach(b => b.classList.toggle('pf-on', b.dataset.lgTool === tool)); }
    function cancelTool() {
        if (handler) { try { handler.disable(); } catch (e) { } handler = null; }
        tool = null; map.getContainer().classList.remove('lg-picking'); markTool();
    }
    window.lgCancelTool = cancelTool;
    function startTool(t) {
        const same = tool === t;
        cancelTool(); setEditing(false);
        if (same) return setStatus('');
        if (typeof deactivateAllTools === 'function') deactivateAllTools();
        tool = t; markTool();
        if (t === 'point') { map.getContainer().classList.add('lg-picking'); return setStatus('Кликните по карте, чтобы поставить точку (Esc — отмена)'); }
        const so = { color: '#0f172a', weight: 2, fillColor: '#0f172a', fillOpacity: 0.1 };
        handler = t === 'polygon' ? new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: so })
            : t === 'rectangle' ? new L.Draw.Rectangle(map, { shapeOptions: so, showArea: false })
            : new L.Draw.Circle(map, { shapeOptions: so, showRadius: true });
        handler.enable();
        setStatus('Рисуйте на карте — будет создан один объект (прежний заменится)');
    }
    window.lgOnCreated = e => {
        if (!handler || !e.layer) return false;
        const layer = e.layer, gj = layerGJ(layer), kind = { rectangle: 'Прямоугольник', circle: 'Круг' }[e.layerType];
        cancelTool();
        if (!gj) return true;
        layer.on('edit', () => { const g = layerGJ(layer); if (g) applyObj(g, labelOf(g, kind)); });
        setObj(gj, labelOf(gj, kind), layer);
        return true;
    };
    document.querySelectorAll('[data-lg-tool]').forEach(b => b.addEventListener('click', () => startTool(b.dataset.lgTool)));
    map.on('click', e => {
        if (tool !== 'point') return;
        cancelTool();
        const m = L.circleMarker(e.latlng, { radius: 7, color: '#ffffff', weight: 2, fillColor: '#0f172a', fillOpacity: 1 });
        setObj(turf.point([e.latlng.lng, e.latlng.lat]), 'Точка: ' + e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5), m);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && tool === 'point') { cancelTool(); setStatus(''); } });
    $('lgEdit').addEventListener('click', () => {
        if (!objLayer) return setStatus('Сначала нарисуйте объект', true);
        if (!objLayer.editing) return setStatus('Точку не редактируют — поставьте новую', true);
        cancelTool(); setEditing(!editing);
        setStatus(editing ? 'Тяните вершины объекта; повторное нажатие «Правка» — завершить' : '');
    });
    $('lgFromSel').addEventListener('click', () => {
        cancelTool();
        const gj = selectedLayer && layerGJ(selectedLayer);
        if (!gj) return setStatus('Выберите фигуру на карте или на вкладке «Рисование»', true);
        setObj(gj, labelOf(gj), null);
    });
    $('lgClear').addEventListener('click', () => {
        abortRun(); cancelTool(); setEditing(false); obj = null; objLayer = null;
        [grpObj, grp, grpRoads, grpWater, grpNear].forEach(g => g.clearLayers());
        $('lgObj').textContent = 'Объект не задан'; emptyRes(); setStatus('');
    });
    $('lgStop').addEventListener('click', () => { if (run) { abortRun(); setStatus('Расчёт отменён'); } });
    $('lgShowRoads').addEventListener('change', function () { this.checked ? map.addLayer(grpRoads) : map.removeLayer(grpRoads); });
    $('lgShowWater').addEventListener('change', function () { this.checked ? map.addLayer(grpWater) : map.removeLayer(grpWater); });

    // ---- Буфер и анализ дорог/водоёмов ----
    $('lgBuffer').addEventListener('click', async () => {
        if (!obj) return setStatus('Сначала задайте объект: точку или фигуру', true);
        const r = parseFloat($('lgR').value) * ($('lgU').value === 'km' ? 1 : 0.001);
        if (!(r > 0) || r > 20) return setStatus('Радиус должен быть больше 0 и не более 20 км', true);
        const buf = turf.buffer(obj.gj, r, { units: 'kilometers', steps: 48 });
        const area = buf ? turf.area(buf) : 0;
        if (!area) return setStatus('Не удалось построить буфер', true);
        if (area > 1e9) return setStatus('Буфер слишком большой (более 1000 км²) — уменьшите радиус', true);
        progStart('Подготовка запроса…', 'Буфер: дороги и водоёмы'); const my = run; setStatus('Запрос к OSM…');
        $('lgStats').innerHTML = '<div class="m3-hint">Идёт расчёт…</div>';
        try {
            [grp, grpRoads, grpWater].forEach(g => g.clearLayers()); drawOrigin();
            const bl = L.geoJSON(buf, { style: { color: '#7c3aed', weight: 2, dashArray: '6 4', fillColor: '#7c3aed', fillOpacity: 0.06 }, interactive: false }).addTo(grp);
            map.fitBounds(bl.getBounds(), { padding: [20, 20] });
            const bb = turf.bbox(buf), sc = { bbox: [bb[1], bb[0], bb[3], bb[2]].map(v => v.toFixed(5)).join(',') };
            const parts = [['главные дороги', P_MAIN], ['местные дороги', P_LOCAL], ['водотоки', P_WW], ['водоёмы', P_WATER]];
            const els = [], failed = []; let lastErr = '';
            for (const [i, [name, stm]] of parts.entries()) {
                setStatus('Запрос к OSM: ' + name + '…'); prog(5 + i * 20, 'OSM ' + (i + 1) + '/' + parts.length + ': ' + name);
                try { els.push(...await overpass(Q(stm, sc))); } catch (e) { chk(); failed.push(name); lastErr = e.message; }
                chk(); await wait(150);
            }
            if (failed.length === parts.length) throw new Error(lastErr);
            prog(88, 'Обработка геометрии…'); await wait(0); chk();
            const runs = { main: [], local: [], waterway: [] }, len = { main: 0, local: 0, waterway: 0 };
            const cnt = { main: 0, local: 0 }, wpolys = [];
            let wArea = 0; const seen = new Set();
            for (const el of els) {
                const key = el.type + el.id; if (seen.has(key)) continue; seen.add(key);
                const k = kindOf(el.tags || {});
                for (const line of toLines(el)) {
                    if (k === 'water' && closed(line)) {
                        try { const ix = turf.intersect(turf.polygon([line]), buf); if (ix) { wpolys.push(ix); wArea += turf.area(ix); } } catch (e) { }
                        continue;
                    }
                    const kk = k === 'water' ? 'waterway' : k;      // незамкнутые части водоёмов — как береговая линия
                    const c = clipLine(line, buf);
                    if (!c.len) continue;
                    runs[kk].push(...c.runs); len[kk] += c.len;
                    if (kk !== 'waterway') cnt[kk]++;
                }
            }
            const line = (arr, color, w) => arr.length && L.geoJSON({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: arr } }, { style: { color, weight: w, opacity: 0.9 }, interactive: false });
            [line(runs.local, '#f59e0b', 2), line(runs.main, '#dc2626', 3)].forEach(x => x && x.addTo(grpRoads));
            const ww = line(runs.waterway, '#0284c7', 2); if (ww) ww.addTo(grpWater);
            if (wpolys.length) L.geoJSON({ type: 'FeatureCollection', features: wpolys }, { style: { color: '#0284c7', weight: 1, fillColor: '#38bdf8', fillOpacity: 0.5 }, interactive: false }).addTo(grpWater);
            $('lgShowRoads').checked ? map.addLayer(grpRoads) : map.removeLayer(grpRoads);
            $('lgShowWater').checked ? map.addLayer(grpWater) : map.removeLayer(grpWater);
            const st = [['Площадь буфера', fmtA(area)], ['Дороги всего', fmtD((len.main + len.local) * 1000)],
                ['Магистральные', fmtD(len.main * 1000)], ['Местные', fmtD(len.local * 1000)],
                ['Число дорог', cnt.main + cnt.local], ['Водоёмов', wpolys.length],
                ['Площадь воды', fmtA(wArea)], ['Водотоки/берега', fmtD(len.waterway * 1000)]];
            $('lgStats').innerHTML = st.map(([a, b]) => '<div class="pf-st"><span>' + a + '</span><b>' + b + '</b></div>').join('');
            failed.length ? setStatus('Частично: не загружено — ' + failed.join(', ') + ' (' + lastErr + ')', true) : setStatus('Готово: данные OSM (Overpass)');
            progEnd(my, failed.length ? 'part' : 'ok', failed.length ? 'Частично (' + failed.length + ' из ' + parts.length + ' запросов не удалось)' : 'Готово');
        } catch (e) {
            if (stopped()) progEnd(my, 'fail', 'Отменено');
            else { setStatus('Ошибка запроса OSM: ' + errText(e) + '. Попробуйте ещё раз или уменьшите радиус', true); progEnd(my, 'fail', 'Ошибка запроса'); }
        }
    });

    // ---- Ближайшие дорога и водоём: прямая + маршрут OSRM ----
    async function route(a, b) {
        try {
            const r = await fetchT(OSRM + 'route/v1/driving/' + a[0] + ',' + a[1] + ';' + b[0] + ',' + b[1] + '?overview=full&geometries=geojson', 15000);
            const j = await r.json();
            if (j.code !== 'Ok' || !j.routes.length) return null;
            return { dist: j.routes[0].distance, geom: j.routes[0].geometry, gap: (j.waypoints || []).reduce((s, w) => s + (w.distance || 0), 0) };
        } catch (e) { return null; }
    }
    // Запасной вариант для дороги, если Overpass недоступен: сервис nearest у OSRM
    async function osrmNearest(o) {
        const j = await (await fetchT(OSRM + 'nearest/v1/driving/' + o[0] + ',' + o[1] + '?number=1', 15000)).json();
        const w = j.code === 'Ok' && j.waypoints && j.waypoints[0];
        return w ? { d: w.distance, np: w.location, t: { name: w.name || '', highway: 'дорога' } } : null;
    }
    $('lgNearest').addEventListener('click', async () => {
        if (!obj) return setStatus('Сначала задайте объект: точку или фигуру', true);
        const R = parseFloat($('lgSearch').value) * 1000;
        if (!(R > 0) || R > 10000) return setStatus('Радиус поиска — от 0.1 до 10 км', true);
        progStart('Подготовка…', 'Ближайшие дорога и водоём'); const my = run; grpNear.clearLayers(); $('lgNear').innerHTML = '';
        try {
            const [lon, lat] = obj.origin, pt = turf.point(obj.origin), steps = [500, 2000].filter(x => x < R).concat(R);
            // расширяем радиус поиска шагами: в плотной застройке хватает малого запроса
            async function findNearest(stm, base, span) {
                for (const [si, r] of steps.entries()) {
                    prog(base + span * si / steps.length, (base ? 'Ближайший водоём' : 'Ближайшая дорога') + ': радиус ' + fmtD(r));
                    const els = await overpass(Q(stm, { around: '(around:' + r + ',' + lat + ',' + lon + ')' })); chk();
                    let best = null;
                    for (const el of els) {
                        const t = el.tags || {}, k = kindOf(t);
                        for (const line of toLines(el)) {
                            let d, np;
                            if (k === 'water' && closed(line) && turf.booleanPointInPolygon(pt, turf.polygon([line]))) { d = 0; np = obj.origin; }
                            else { const s = turf.nearestPointOnLine(turf.lineString(line), pt); d = s.properties.dist * 1000; np = s.geometry.coordinates; }
                            if (!best || d < best.d) best = { d, np, t };
                        }
                    }
                    if (best && best.d <= R) return best;
                    await wait(150);
                }
                return null;
            }
            const found = {}, err = {};
            setStatus('Поиск ближайшей дороги…');
            let viaOsrm = false;
            try { found.road = await findNearest(P_MAIN.concat(P_LOCAL), 0, 40); }
            catch (e) { chk(); err.road = e.message; try { found.road = await osrmNearest(obj.origin); if (found.road) { delete err.road; viaOsrm = true; } } catch (e2) { } }
            chk(); await wait(150); setStatus('Поиск ближайшего водоёма…');
            try { found.water = await findNearest(P_WW.concat(P_WATER), 40, 30); } catch (e) { chk(); err.water = e.message; }
            chk();
            const defs = [['road', 'Дорога', '#dc2626'], ['water', 'Водоём', '#0284c7']], rows = [];
            for (const [di, [key, title, color]] of defs.entries()) {
                prog(70 + di * 15, 'Маршрут OSRM: ' + title.toLowerCase() + '…'); chk();
                const b = found[key];
                if (!b) { rows.push('<div class="lg-near-row" style="border-color:' + color + '"><b>' + title + '</b><br>' + (err[key] ? 'не удалось получить данные OSM (' + esc(err[key]) + ')' : 'не найдено в радиусе ' + fmtD(R)) + '</div>'); continue; }
                const ll = [b.np[1], b.np[0]], o = [lat, lon];
                L.polyline([o, ll], { color, weight: 2, dashArray: '6 6', interactive: false }).addTo(grpNear);
                L.circleMarker(ll, { radius: 4, color: '#ffffff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }).addTo(grpNear);
                L.tooltip({ permanent: true, direction: 'center', className: 'lg-label', interactive: false }).setLatLng([(o[0] + ll[0]) / 2, (o[1] + ll[1]) / 2]).setContent(fmtD(b.d)).addTo(grpNear);
                const name = b.t.name || b.t.highway || b.t.waterway || (b.t.landuse ? 'водохранилище' : 'водоём');
                let by = '<div>по дорогам: <b>н/д</b></div>';
                if (b.d > 0) {
                    const rt = await route(obj.origin, b.np); chk();
                    if (rt) {
                        L.geoJSON(rt.geom, { style: { color, weight: 4, opacity: 0.85 }, interactive: false }).addTo(grpNear);
                        // там, где дорог нет, маршрут достраивается прямой пунктирной линией: от объекта до дороги и от дороги до цели
                        const cs = rt.geom.coordinates, rs = [cs[0][1], cs[0][0]], re = [cs[cs.length - 1][1], cs[cs.length - 1][0]];
                        [[o, rs], [re, ll]].forEach(([p, q]) => { if (L.latLng(p).distanceTo(q) > 15) L.polyline([p, q], { color, weight: 4, opacity: 0.95, dashArray: '8 8', lineCap: 'butt', interactive: false }).addTo(grpNear); });
                        by = '<div>по дорогам: <b>' + fmtD(rt.dist) + '</b> <small>(+ ' + fmtD(rt.gap) + ' вне дорог)</small></div>';
                    }
                } else by = '<div><b>объект внутри водоёма</b></div>';
                rows.push('<div class="lg-near-row" style="border-color:' + color + '"><b>' + title + '</b> <small>' + esc(name) + '</small><div>по прямой: <b>' + fmtD(b.d) + '</b></div>' + by + '</div>');
            }
            $('lgNear').innerHTML = rows.join('');
            const bad = [err.road && 'дорога недоступна (' + err.road + ')', err.water && 'водоёмы недоступны (' + err.water + ')'].filter(Boolean);
            setStatus(bad.length ? 'Частично: ' + bad.join('; ') : viaOsrm ? 'Готово: дорога определена через OSRM (Overpass недоступен)' : 'Готово: прямая — OSM, маршрут — OSRM', bad.length > 0);
            progEnd(my, bad.length ? 'part' : 'ok', bad.length ? 'Частично' : 'Готово');
        } catch (e) {
            if (stopped()) progEnd(my, 'fail', 'Отменено');
            else { setStatus('Ошибка расчёта: ' + errText(e), true); progEnd(my, 'fail', 'Ошибка расчёта'); }
        }
    });
})();


// ============================================================
//  ПОГОДА: слой на карте + анализ в текущем экстенте (вкладка «Погода»)
// ============================================================
(function () {
    const $ = id => document.getElementById(id);
    const ROWS = 5, COLS = 5;   // сетка точек внутри экстента

    // ---------- Слой погоды ----------
    map.createPane('weatherPane');
    map.getPane('weatherPane').style.zIndex = 250;
    map.getPane('weatherPane').style.pointerEvents = 'none';
    let wxLayer = null, wxOpacity = 0.7, wxCur = 'off', windOn = false;
    const keyGet = () => { try { return localStorage.getItem('owmKey') || ''; } catch (e) { return ''; } };
    const keySet = v => { try { localStorage.setItem('owmKey', v); } catch (e) {} };
    function askKey() {
        const v = prompt('Ключ OpenWeatherMap (бесплатный, openweathermap.org/api). Нужен для облаков, температуры, ветра и давления:', keyGet());
        if (v !== null) keySet(v.trim());
        return keyGet();
    }
    async function setWx(key) {
        if (wxLayer) { map.removeLayer(wxLayer); wxLayer = null; }
        wxCur = 'off';
        if (key !== 'off') {
            const opt = { pane: 'weatherPane', opacity: wxOpacity };
            try {
                if (key === 'rain') {
                    const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
                    const p = j.radar.past[j.radar.past.length - 1];
                    wxLayer = L.tileLayer(j.host + p.path + '/256/{z}/{x}/{y}/2/1_1.png',
                        Object.assign(opt, { maxNativeZoom: 7, attribution: 'RainViewer' }));
                } else {
                    const k = keyGet() || askKey();
                    if (!k) key = 'off';
                    else wxLayer = L.tileLayer('https://tile.openweathermap.org/map/' + key + '/{z}/{x}/{y}.png?appid=' + k,
                        Object.assign(opt, { attribution: 'OpenWeatherMap' }));
                }
            } catch (e) { key = 'off'; wxLayer = null; alert('Не удалось загрузить слой погоды'); }
            if (wxLayer) { wxLayer.addTo(map); wxCur = key; }
        }
        document.querySelectorAll('#weatherPanel [data-wx]').forEach(el => el.classList.toggle('active', el.dataset.wx === wxCur));
        $('weatherBtn').classList.toggle('tool-on', wxCur !== 'off' || windOn);
    }
    $('weatherBtn').addEventListener('click', e => { e.stopPropagation(); togglePanel('weatherPanel', 'weatherBtn'); });
    document.querySelectorAll('#weatherPanel [data-wx]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); setWx(el.dataset.wx); }));
    $('wxKeyBtn').addEventListener('click', e => { e.stopPropagation(); if (askKey() && wxCur !== 'off' && wxCur !== 'rain') setWx(wxCur); });
    $('wxOpacity').addEventListener('input', function () { wxOpacity = this.value / 100; if (wxLayer) wxLayer.setOpacity(wxOpacity); });

    // ---------- Анимированный ветер (частицы на карте) ----------
    // Данные ветра — Open-Meteo (без ключа): сетка точек по видимой области, между ними — билинейная интерполяция.
    // Частицы рисуются на canvas внутри панели карты, поэтому двигаются и вращаются вместе с картой.
    const WIND = { cv: null, ctx: null, raf: 0, parts: [], grid: null, fz: 0, org: null, W: 0, H: 0, cell: 24, fu: null, fv: null, fw: 0, fh: 0, t: 0, ft: 0, timer: 0, tok: 0 };
    const WIND_COLS = [[3, '#bfe3ff'], [6, '#7dd3fc'], [10, '#fde68a'], [15, '#fb923c'], [99, '#f87171']];
    const windSample = (lat, lng) => {
        const g = WIND.grid;
        if (!g) return null;
        const fx = Math.min(g.cols - 1, Math.max(0, (lng - g.w) / (g.e - g.w) * (g.cols - 1)));
        const fy = Math.min(g.rows - 1, Math.max(0, (lat - g.s) / (g.n - g.s) * (g.rows - 1)));
        const x0 = Math.min(g.cols - 2, Math.floor(fx)), y0 = Math.min(g.rows - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
        const at = (a, x, y) => a[y * g.cols + x];
        const b = a => (at(a, x0, y0) * (1 - tx) + at(a, x0 + 1, y0) * tx) * (1 - ty) + (at(a, x0, y0 + 1) * (1 - tx) + at(a, x0 + 1, y0 + 1) * tx) * ty;
        return [b(g.u), b(g.v)];
    };
    function windLattice() {   // поле ветра в пикселях холста — чтобы частицы не пересчитывали координаты каждый кадр
        if (!WIND.cv || !WIND.org || !WIND.grid) return;
        const c = WIND.cell, fw = Math.ceil(WIND.W / c) + 1, fh = Math.ceil(WIND.H / c) + 1;
        WIND.fw = fw; WIND.fh = fh; WIND.fu = new Float32Array(fw * fh); WIND.fv = new Float32Array(fw * fh);
        for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
            const ll = map.layerPointToLatLng(L.point(WIND.org.x + i * c, WIND.org.y + j * c)), s = windSample(ll.lat, ll.lng) || [0, 0];
            WIND.fu[j * fw + i] = s[0]; WIND.fv[j * fw + i] = s[1];
        }
    }
    function windAt(x, y) {
        const c = WIND.cell, fx = Math.min(WIND.fw - 1.001, Math.max(0, x / c)), fy = Math.min(WIND.fh - 1.001, Math.max(0, y / c));
        const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, w = WIND.fw;
        const q = a => (a[j * w + i] * (1 - tx) + a[j * w + i + 1] * tx) * (1 - ty) + (a[(j + 1) * w + i] * (1 - tx) + a[(j + 1) * w + i + 1] * tx) * ty;
        return [q(WIND.fu), q(WIND.fv)];
    }
    function windSeed(p) { p.x = Math.random() * WIND.W; p.y = Math.random() * WIND.H; p.age = Math.floor(Math.random() * 90); p.px = p.x; p.py = p.y; }
    function windPlace() {   // холст покрывает всю видимую область (с запасом на поворот карты)
        if (!WIND.cv) return;
        const sz = map.getSize(), d = Math.ceil(Math.hypot(sz.x, sz.y)) + 40, ctr = map.latLngToLayerPoint(map.getCenter());
        WIND.org = L.point(Math.round(ctr.x - d / 2), Math.round(ctr.y - d / 2));
        if (WIND.W !== d || WIND.H !== d) { WIND.cv.width = d; WIND.cv.height = d; WIND.W = d; WIND.H = d; }
        L.DomUtil.setPosition(WIND.cv, WIND.org);
        WIND.ctx.clearRect(0, 0, d, d);
        const n = Math.max(350, Math.min(1800, Math.round(sz.x * sz.y / 1000)));
        while (WIND.parts.length < n) WIND.parts.push({});
        WIND.parts.length = n;
        WIND.parts.forEach(windSeed);
        windLattice();
    }
    async function windLoad(force) {
        const z = map.getZoom(), b = map.getBounds(), g = WIND.grid;
        if (!force && g && b.getSouth() >= g.s && b.getNorth() <= g.n && b.getWest() >= g.w && b.getEast() <= g.e && Math.abs(z - WIND.fz) < 2 && Date.now() - WIND.ft < 30 * 60 * 1000) return;
        const tok = ++WIND.tok, pb = b.pad(0.3), cols = 7, rows = 5;
        const s = Math.max(-85, pb.getSouth()), n = Math.min(85, pb.getNorth()), w = pb.getWest(), e = pb.getEast(), lats = [], lngs = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            lats.push((s + (n - s) * r / (rows - 1)).toFixed(3));
            lngs.push((w + (e - w) * c / (cols - 1)).toFixed(3));
        }
        try {
            const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') + '&longitude=' + lngs.join(',') + '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=UTC');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const j = await resp.json(), arr = Array.isArray(j) ? j : [j];
            if (tok !== WIND.tok || !windOn) return;
            const u = new Float32Array(cols * rows), v = new Float32Array(cols * rows);
            arr.forEach((o, i) => {
                const c = o && o.current, sp = c ? +c.wind_speed_10m : 0, dr = c ? +c.wind_direction_10m * Math.PI / 180 : 0;   // направление — откуда дует ветер
                u[i] = -sp * Math.sin(dr) || 0; v[i] = -sp * Math.cos(dr) || 0;
            });
            WIND.grid = { s: s, n: n, w: w, e: e, cols: cols, rows: rows, u: u, v: v };
            WIND.fz = z; WIND.ft = Date.now();
            windLattice();
        } catch (err) {
            console.warn('Ветер:', err);
            if (typeof updateStatus === 'function') updateStatus('⚠️ Не удалось загрузить данные ветра (Open-Meteo): ' + (err.message || err), true);
        }
    }
    function windFrame(now) {
        WIND.raf = 0;
        if (!windOn || !WIND.cv) return;
        WIND.raf = requestAnimationFrame(windFrame);
        if (!WIND.fu || WIND.cv.style.display === 'none') { WIND.t = now; return; }
        const dt = Math.min(3, Math.max(0.2, (now - (WIND.t || now)) / 16.7)); WIND.t = now;
        const ctx = WIND.ctx, W = WIND.W, H = WIND.H;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.5, 0.075 * dt).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        const bk = WIND_COLS.map(() => []);
        WIND.parts.forEach(p => {
            const w = windAt(p.x, p.y), sp = Math.hypot(w[0], w[1]);
            p.px = p.x; p.py = p.y;
            p.x += w[0] * 0.42 * dt; p.y -= w[1] * 0.42 * dt;   // север — вверх по экрану
            p.age += dt;
            if (p.age > 110 || p.x < 0 || p.y < 0 || p.x > W || p.y > H || sp < 0.05) { if (p.age > 110 || p.x < 0 || p.y < 0 || p.x > W || p.y > H) windSeed(p), p.age = 0; return; }
            let k = 0; while (WIND_COLS[k][0] < sp) k++;
            bk[k].push(p);
        });
        bk.forEach((l, k) => {
            if (!l.length) return;
            ctx.strokeStyle = WIND_COLS[k][1]; ctx.globalAlpha = 0.9; ctx.beginPath();
            l.forEach(p => { ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); });
            ctx.stroke();
        });
        ctx.globalAlpha = 1;
    }
    const windOnMove = () => { if (!windOn) return; windPlace(); windLoad(false); };
    const windHide = () => { if (WIND.cv) WIND.cv.style.display = 'none'; };
    const windShow = () => { if (WIND.cv) { WIND.cv.style.display = ''; windOnMove(); } };
    function windStart() {
        if (WIND.cv) return;
        const cv = document.createElement('canvas');
        cv.className = 'wx-wind'; cv.style.pointerEvents = 'none';
        map.getPane('weatherPane').appendChild(cv);
        WIND.cv = cv; WIND.ctx = cv.getContext('2d'); WIND.W = WIND.H = 0; WIND.t = 0;
        map.on('moveend', windOnMove).on('resize', windOnMove).on('zoomstart', windHide).on('zoomend', windShow);
        WIND.timer = setInterval(() => windLoad(true), 30 * 60 * 1000);
        windPlace();
        windLoad(true);
        WIND.raf = requestAnimationFrame(windFrame);
    }
    function windStop() {
        windOn = false;
        if (WIND.raf) cancelAnimationFrame(WIND.raf);
        WIND.raf = 0; clearInterval(WIND.timer); WIND.tok++;
        map.off('moveend', windOnMove).off('resize', windOnMove).off('zoomstart', windHide).off('zoomend', windShow);
        if (WIND.cv && WIND.cv.parentNode) WIND.cv.parentNode.removeChild(WIND.cv);
        WIND.cv = WIND.ctx = null; WIND.grid = null; WIND.fu = WIND.fv = null; WIND.parts = [];
    }
    $('wxWindAnim').addEventListener('change', function () {
        windOn = this.checked;
        if (windOn) windStart(); else windStop();
        $('weatherBtn').classList.toggle('tool-on', wxCur !== 'off' || windOn);
        if (typeof updateStatus === 'function') updateStatus(windOn ? '🌬️ Анимированный ветер включён (Open-Meteo, 10 м над землёй)' : '🌬️ Анимированный ветер выключен');
    });

    // ---------- Анализ в экстенте ----------
    const st = { days: null, busy: false, timer: null };
    const setStatus = (t, err) => { const e = $('wxStatus'); e.textContent = t; e.style.color = err ? '#dc2626' : ''; };
    const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
    const f = (v, d) => (v == null || isNaN(v)) ? '—' : v.toFixed(d == null ? 1 : d);
    const rng = (a, d) => f(avg(a), d) + ' (' + f(Math.min.apply(null, a), d) + '…' + f(Math.max.apply(null, a), d) + ')';
    const row = (k, v) => '<div class="pf-st"><span>' + k + '</span><b>' + v + '</b></div>';
    const isVisible = () => $('bottomPanel').querySelector('.bp-pane[data-bp-pane="weather"]').classList.contains('active') && !$('bottomPanel').classList.contains('collapsed');

    async function analyze(silent) {
        if (st.busy) return;
        st.busy = true; setStatus('Загрузка погоды…');
        const al = (window.AnLoader && silent !== true) ? AnLoader.start('Анализ погоды', 'Загружаю прогноз Open-Meteo для видимой области…') : 0;
        try {
            const b = map.getBounds(), s = Math.max(b.getSouth(), -85), n = Math.min(b.getNorth(), 85);
            let w = b.getWest(), e = b.getEast();
            if (e - w >= 360) { w = -180; e = 180; }
            const cl = x => ((x + 540) % 360) - 180;
            const lats = [], lons = [];
            for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
                lats.push((s + (n - s) * (i + 0.5) / ROWS).toFixed(3));
                lons.push(cl(w + (e - w) * (j + 0.5) / COLS).toFixed(3));
            }
            const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') + '&longitude=' + lons.join(',')
                + '&current=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m'
                + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
                + '&wind_speed_unit=ms&timezone=auto&forecast_days=7';
            const r = await fetch(url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            let d = await r.json(); if (!Array.isArray(d)) d = [d];
            const cur = k => d.map(p => p.current[k]);
            $('wxNow').innerHTML =
                row('Температура, °C', rng(cur('temperature_2m'))) +
                row('Влажность, %', rng(cur('relative_humidity_2m'), 0)) +
                row('Облачность, %', rng(cur('cloud_cover'), 0)) +
                row('Ветер, м/с', rng(cur('wind_speed_10m'))) +
                row('Осадки, мм', rng(cur('precipitation')));
            const N = d[0].daily.time.length, day = k => Array.from({ length: N }, (_, i) => avg(d.map(p => p.daily[k][i])));
            const tmax = day('temperature_2m_max'), tmin = day('temperature_2m_min'), pr = day('precipitation_sum'), pp = day('precipitation_probability_max'), wd = day('wind_speed_10m_max');
            const allMin = Math.min.apply(null, d.map(p => Math.min.apply(null, p.daily.temperature_2m_min)));
            const allMax = Math.max.apply(null, d.map(p => Math.max.apply(null, p.daily.temperature_2m_max)));
            const rainSum = d.map(p => p.daily.precipitation_sum.reduce((a, v) => a + v, 0));
            const gdd = tmax.reduce((sum, v, i) => sum + Math.max((v + tmin[i]) / 2 - 5, 0), 0);
            $('wxWeek').innerHTML =
                row('Осадки за 7 дн., мм', rng(rainSum)) +
                row('T мин…макс, °C', f(allMin) + '…' + f(allMax)) +
                row('Сумма T>5°C, °C·дн', f(gdd, 0)) +
                row('Дней с заморозком', tmin.filter(v => v < 0).length) +
                row('Дождливых дней (≥1 мм)', pr.filter(v => v >= 1).length) +
                row('Порывистых (≥10 м/с)', wd.filter(v => v >= 10).length);
            st.days = { t: d[0].daily.time, tmax, tmin, pr, pp, wd };
            setStatus('Обновлено ' + new Date().toLocaleTimeString().slice(0, 5) + ' · ' + lats.length + ' точек · Open-Meteo' + (map.getZoom() < 5 ? ' · малый масштаб: данные усреднены по большой площади' : ''));
            draw();
        } catch (err) {
            setStatus('Ошибка загрузки погоды: ' + (err.message || err), true);
        } finally { st.busy = false; if (al && window.AnLoader) AnLoader.end(al); }
    }

    function draw() {
        const wrap = $('wxWrap'), c = $('wxCanvas'), W = wrap.clientWidth, H = wrap.clientHeight;
        if (!W || !H || !st.days) return;
        $('wxEmpty').hidden = true;
        const dpr = window.devicePixelRatio || 1;
        if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
        const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        const D = st.days, n = D.t.length, PL = 10, PR = 10, FONT = '"Segoe UI", Arial, sans-serif';
        const pw = W - PL - PR; if (pw < 120 || H < 200) return;
        // три полосы: температура (сверху), осадки, подписи дней
        const hLab = 54, gap = 10, plotH = H - hLab - 8 - gap;
        const hT = Math.round(plotH * 0.6), hP = plotH - hT;
        const topT = 22, botT = topT + hT - 22, topP = hT + gap + 22 + 6, botP = hT + gap + hP;
        const X = i => PL + (i + 0.5) / n * pw;
        const tLo = Math.min.apply(null, D.tmin), tHi = Math.max.apply(null, D.tmax), span = Math.max(tHi - tLo, 4);
        const YT = v => botT - (v - tLo) / span * (botT - topT - 14) - 0;
        const pMax = Math.max(4, Math.ceil(Math.max.apply(null, D.pr)));
        const YP = v => botP - v / pMax * (botP - topP);
        const rr = (x, y, w, h, r) => { r = Math.min(r, w / 2, Math.max(h, 0.1)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, 0); g.arcTo(x, y + h, x, y, 0); g.arcTo(x, y, x + w, y, r); g.closePath(); };
        // фоновые полосы дней (через одну) и подписи панелей
        g.fillStyle = 'rgba(148,163,184,.10)';
        for (let i = 0; i < n; i += 2) g.fillRect(PL + i / n * pw, 0, pw / n, H - hLab + 6);
        g.font = '600 11px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#64748b';
        g.fillText('ТЕМПЕРАТУРА, °C', PL + 2, 2); g.fillText('ОСАДКИ, мм', PL + 2, hT + gap);
        // ноль
        if (tLo < 0 && tHi > 0) {
            g.strokeStyle = '#94a3b8'; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(PL, YT(0)); g.lineTo(W - PR, YT(0)); g.stroke(); g.setLineDash([]);
            g.fillStyle = '#94a3b8'; g.font = '10px ' + FONT; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('0°', W - PR - 2, YT(0) - 1);
        }
        // температурная полоса между мин. и макс.
        const grad = g.createLinearGradient(0, topT, 0, botT);
        grad.addColorStop(0, 'rgba(239,68,68,.30)'); grad.addColorStop(1, 'rgba(56,189,248,.28)');
        g.fillStyle = grad; g.beginPath();
        D.tmax.forEach((v, i) => i ? g.lineTo(X(i), YT(v)) : g.moveTo(X(i), YT(v)));
        for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), YT(D.tmin[i]));
        g.closePath(); g.fill();
        const line = (arr, col) => { g.strokeStyle = col; g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath(); arr.forEach((v, i) => i ? g.lineTo(X(i), YT(v)) : g.moveTo(X(i), YT(v))); g.stroke(); arr.forEach((v, i) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(i), YT(v), 4, 0, 7); g.fill(); g.strokeStyle = col; g.lineWidth = 2; g.stroke(); }); };
        line(D.tmax, '#ef4444'); line(D.tmin, '#38bdf8');
        g.font = '700 12px ' + FONT; g.textAlign = 'center';
        D.tmax.forEach((v, i) => { g.textBaseline = 'bottom'; g.fillStyle = '#dc2626'; g.fillText(Math.round(v) + '°', X(i), YT(v) - 8); });
        D.tmin.forEach((v, i) => { g.textBaseline = 'top'; g.fillStyle = '#0284c7'; g.fillText(Math.round(v) + '°', X(i), YT(v) + 8); });
        // осадки: столбики + значение + вероятность
        const bw = Math.min(26, pw / n * 0.46);
        D.pr.forEach((v, i) => {
            const y = YP(v), h = botP - y;
            g.fillStyle = 'rgba(148,163,184,.25)'; rr(X(i) - bw / 2, topP, bw, botP - topP, 5); g.fill();
            if (v > 0.05) { g.fillStyle = '#3b82f6'; rr(X(i) - bw / 2, y, bw, Math.max(h, 3), 5); g.fill(); }
            g.font = '700 11px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'bottom';
            g.fillStyle = v > 0.05 ? '#1d4ed8' : '#94a3b8'; g.fillText(v > 0.05 ? f(v) : '—', X(i), Math.min(y, botP) - 3);
        });
        // подписи дней и вероятность осадков
        D.t.forEach((t, i) => {
            const dt = new Date(t + 'T00:00:00'), today = i === 0;
            let wd = dt.toLocaleDateString('ru-RU', { weekday: 'short' }); wd = wd.charAt(0).toUpperCase() + wd.slice(1);
            g.textAlign = 'center'; g.textBaseline = 'top';
            g.fillStyle = today ? '#0f172a' : '#475569'; g.font = (today ? '800 ' : '600 ') + '12px ' + FONT; g.fillText(today ? 'Сегодня'.slice(0, pw / n < 52 ? 3 : 7) : wd, X(i), H - hLab + 8);
            g.fillStyle = '#94a3b8'; g.font = '11px ' + FONT; g.fillText(dt.getDate() + '.' + String(dt.getMonth() + 1).padStart(2, '0'), X(i), H - hLab + 22);
            g.fillStyle = '#2563eb'; g.font = '600 10px ' + FONT; g.fillText(Math.round(D.pp[i]) + '%', X(i), H - hLab + 38);
        });
    }

    $('wxRefresh').addEventListener('click', analyze);
    document.querySelector('.bp-tab[data-bp-tab="weather"]').addEventListener('click', () => { setTimeout(() => { if (!st.days) analyze(); else draw(); }, 30); });
    map.on('moveend', () => {
        if (!$('wxAuto').checked || !isVisible()) return;
        clearTimeout(st.timer); st.timer = setTimeout(() => analyze(true), 900);
    });
    if (window.ResizeObserver) new ResizeObserver(() => draw()).observe($('wxWrap'));
})();
