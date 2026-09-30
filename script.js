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
    sentinel2: () => esriTiles('&copy; Esri / Sentinel-2'),
    landsat8: () => esriTiles('&copy; Esri / Landsat'),
    ndvi: () => esriTiles('&copy; Esri / NDVI'),
    ndwi: () => esriTiles('&copy; Esri / NDWI'),
    modified_ndwi: () => esriTiles('&copy; Esri / MNDWI'),
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
    modified_ndwi: 'MNDWI', esri_landcover: 'Esri Land Cover',
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
const swipeState = { active: false, sides: {}, sideEls: {}, lastByGroup: { left: {}, right: {} }, ui: null, frac: 0.5, holdUntil: 0, lastKey: '', raf: 0, prevMaxZoom: undefined };

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
        }, () => updateStatus('Не удалось определить местоположение', true));
    }
});

// ---------- ШТОРКА ----------
document.getElementById('toggleDrawerBtn').addEventListener('click', function() {
    const panel = document.getElementById('mainPanel');
    if (panel) {
        panel.classList.toggle('hidden');
        this.innerHTML = panel.classList.contains('hidden') ? '<i class="fas fa-bars"></i>' : '<i class="fas fa-times"></i>';
        setTimeout(() => map.invalidateSize(), 350);
    }
});

// ---------- ИСТОРИЯ ЭКСТЕНТОВ ----------
let extentHistory = [];
let extentHistoryIndex = -1;

function pushExtentToHistory() {
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (extentHistoryIndex < extentHistory.length - 1) {
        extentHistory = extentHistory.slice(0, extentHistoryIndex + 1);
    }
    extentHistory.push({ center, zoom });
    extentHistoryIndex = extentHistory.length - 1;
    updateExtentButtons();
}

function goToPreviousExtent() {
    if (extentHistoryIndex > 0) {
        extentHistoryIndex--;
        const state = extentHistory[extentHistoryIndex];
        map.setView(state.center, state.zoom);
        updateExtentButtons();
    }
}

function goToNextExtent() {
    if (extentHistoryIndex < extentHistory.length - 1) {
        extentHistoryIndex++;
        const state = extentHistory[extentHistoryIndex];
        map.setView(state.center, state.zoom);
        updateExtentButtons();
    }
}

function updateExtentButtons() {
    document.getElementById('zoomBackBtn').disabled = extentHistoryIndex <= 0;
    document.getElementById('zoomForwardBtn').disabled = extentHistoryIndex >= extentHistory.length - 1;
}

map.on('moveend', function() {
    if (!map._skipHistory) {
        pushExtentToHistory();
    }
    map._skipHistory = false;
});

const originalSetView = map.setView.bind(map);
map.setView = function(center, zoom, options) {
    this._skipHistory = true;
    return originalSetView(center, zoom, options);
};

document.getElementById('zoomBackBtn').addEventListener('click', goToPreviousExtent);
document.getElementById('zoomForwardBtn').addEventListener('click', goToNextExtent);

setTimeout(() => {
    pushExtentToHistory();
}, 100);

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

// ---------- МИНИ-КАРТА ----------
let miniMap = null;

function initMiniMap() {
    const center = map.getCenter();
    const zoomOffset = 5;
    const miniZoom = Math.max(map.getZoom() - zoomOffset, 1);
    miniMap = L.map('miniMap', {
        zoomControl: false,
        rotateControl: false,   // плагин поворота не должен добавлять компас в мини-карту
        attributionControl: false,
        dragging: true,
        touchZoom: true,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        fadeAnimation: false,
        zoomAnimation: false
    }).setView(center, miniZoom);
    googleTiles('m', { maxZoom: 19, attribution: '' }).addTo(miniMap);
    let miniMapRect = L.rectangle(map.getBounds(), {
        color: '#059669',
        weight: 2,
        opacity: 0.8,
        fill: false,
        dashArray: '4,4'
    }).addTo(miniMap);
    map.on('move', function() {
        const newZoom = Math.max(map.getZoom() - zoomOffset, 1);
        miniMap.setView(map.getCenter(), newZoom, { animate: false });
        miniMapRect.setBounds(map.getBounds());
    });
    map.on('zoom', function() {
        const newZoom = Math.max(map.getZoom() - zoomOffset, 1);
        miniMap.setView(map.getCenter(), newZoom, { animate: false });
        miniMapRect.setBounds(map.getBounds());
    });
    miniMap.on('click', function(e) {
        map.setView(e.latlng, map.getZoom());
    });
    map.on('resize', function() {
        setTimeout(() => {
            if (miniMap) {
                miniMap.invalidateSize();
            }
        }, 200);
    });
    return miniMap;
}

// ---------- СВОРАЧИВАНИЕ МИНИ-КАРТЫ ----------
const miniMapContainer = document.getElementById('miniMapContainer');
const miniMapCollapseBtn = document.getElementById('miniMapCollapseBtn');

miniMapContainer.addEventListener('click', function(e) {
    if (e.target.closest('.mini-map-collapse-btn')) return;
    if (this.classList.contains('collapsed')) {
        this.classList.remove('collapsed');
        setTimeout(() => {
            if (miniMap) {
                miniMap.invalidateSize();
            }
        }, 350);
        updateStatus('🗺️ Мини-карта развёрнута');
    }
});

miniMapCollapseBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    miniMapContainer.classList.toggle('collapsed');
    if (!miniMapContainer.classList.contains('collapsed')) {
        setTimeout(() => {
            if (miniMap) {
                miniMap.invalidateSize();
            }
        }, 350);
        updateStatus('🗺️ Мини-карта развёрнута');
    } else {
        updateStatus('🗺️ Мини-карта свёрнута');
    }
});

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
    if (miniMap) {
        miniMap.invalidateSize();
        miniMap.eachLayer(layer => {
            if (layer instanceof L.TileLayer) layer.redraw();
        });
    }
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
function applySwipeClip() {
    if (!swipeState.active) return;
    const w = mapStageEl.clientWidth;
    const x = Math.round(swipeState.frac * w);
    const leftClip = `inset(0 ${Math.max(w - x, 0)}px 0 0)`;
    const rightClip = `inset(0 0 0 ${x}px)`;
    const leftStyle = swipeState.sides.left.el.style, rightStyle = swipeState.sides.right.el.style;
    leftStyle.clipPath = leftClip;   leftStyle.webkitClipPath = leftClip;
    rightStyle.clipPath = rightClip; rightStyle.webkitClipPath = rightClip;
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
        </div>`;
    ui.appendChild(buildSwipeSide('left'));
    ui.appendChild(buildSwipeSide('right'));
    mapStageEl.appendChild(ui);
    swipeState.ui = ui;
    bindSwipeDrag(ui.querySelector('#swipeDivider'));
}

document.addEventListener('click', function(e) {
    if (swipeState.active && !e.target.closest('.swipe-side')) closeSwipeLists();
});

// ---------- Включение / выключение ----------
function activateSwipe() {
    if (swipeState.active) return;
    const leftKey = currentLayer;
    const rightKey = leftKey === 'esri_sat' ? 'google' : 'esri_sat';

    swipeState.prevMaxZoom = map.options.maxZoom;
    map.removeLayer(currentTileLayer);          // тайлы теперь рисуют половины
    swipeState.active = true;
    mapStageEl.classList.add('swipe-active');

    swipeState.sides.left = createSwipeMap('left');
    swipeState.sides.right = createSwipeMap('right');
    ensureSwipeUI();

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

    // основная карта возвращает себе подложку (левой половины)
    map.options.maxZoom = swipeState.prevMaxZoom;
    currentTileLayer = baseLayers[currentLayer];
    currentTileLayer.addTo(map);
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
    const kind = sketchState.selected ? sketchState.selected._sk.kind : (sketchState.tool === 'freeline' ? 'line' : sketchState.tool);
    document.querySelectorAll('.dw-block[data-for]').forEach(b => {
        b.classList.toggle('dw-dim', !!kind && b.dataset.for.split(' ').indexOf(kind) === -1);
    });
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
        box.innerHTML = '<div class="dw-empty">Пока нет объектов. Выберите инструмент и нарисуйте на карте.</div>';
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
function skStartEdit(l) {
    if (l && l.editing && !skIsMarker(l._sk.kind) && l._sk.kind !== 'point' && !l.editing.enabled()) l.editing.enable();
}
function skStopEdit(l) {
    if (l && l.editing && l.editing.enabled && l.editing.enabled()) l.editing.disable();
}

function skSelect(l) {
    const prev = sketchState.selected;
    if (prev === l) return;
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
    skSelect(e.target);
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
setTimeout(initMiniMap, 500);
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
        trees: false, treeDens: 100
    };
}

const m3d = {
    active: false, map: null, ready: false, guard: false, seq: 0, baseIds: [],
    items: [], nextId: 1, selected: null, placing: false, orbit: 0, marker: null,
    lights: [], bingReg: false, opts: m3DefaultOpts(),
    trees: { n: 0, timer: 0, retry: 0, origin: null, cosO: 1, trunk: null, crown: null, sun: null }
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
    ['m3Trees', 'trees', 'bool'], ['m3TreeDens', 'treeDens', 'num']
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
    if (layer instanceof BingLayer) {
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

function m3RebuildBasemap() {
    const m = m3d.map;
    if (!m || !m3d.ready) return;
    m3d.baseIds.forEach(id => {
        if (m.getLayer('l-' + id)) m.removeLayer('l-' + id);
        if (m.getSource(id)) m.removeSource(id);
    });
    m3d.baseIds = [];
    m3LayerToRasters(baseLayers[currentLayer] || currentTileLayer, []).forEach(spec => {
        const id = 'gc-base-' + (++m3d.seq);
        const opacity = spec.opacity;
        delete spec.opacity;
        m.addSource(id, spec);
        m.addLayer({ id: 'l-' + id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 120 } }, 'gc-hillshade');
        m3d.baseIds.push(id);
    });
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
    const m = m3d.map, o = m3d.opts;
    if (!m || !m3d.ready) return;
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
    m.setLayoutProperty('gc-labels', 'visibility', vis(o.labels));
    m.setLayoutProperty('gc-forest', 'visibility', vis(o.trees));

    ['gc-user-line', 'gc-user-pt', 'gc-user-txt'].forEach(id => m.setLayoutProperty(id, 'visibility', vis(o.userObjects)));
    m.setLayoutProperty('gc-user-fill', 'visibility', vis(o.userObjects && !o.extrude));
    m.setLayoutProperty('gc-user-ext', 'visibility', vis(o.userObjects && o.extrude));
    m.setPaintProperty('gc-user-ext', 'fill-extrusion-height', o.extrudeH);

    m3UpdateLights();
    if (o.trees || m3d.trees.n) m3TreesSchedule();
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
    obj.position.set(-ctr.x, -box.min.y, -ctr.z);   // центр по горизонтали, основание на «земле»
    const pivot = new THREE.Group();
    pivot.add(obj);
    const scene = m3MakeScene();
    scene.add(pivot);
    const c = m3d.map.getCenter();
    const it = {
        id: m3d.nextId++, kind: 'model', name: name || 'Модель', lng: c.lng, lat: c.lat,
        alt: 0, scale: (maxDim < 0.5 || maxDim > 500) ? 30 / maxDim : 1, heading: 0, visible: true, scene: scene, pivot: pivot
    };
    m3d.items.push(it);
    m3d.selected = it.id;
    m3RenderList();
    m3SyncSelectedUI();
    m3d.map.triggerRepaint();
    updateStatus(`🧊 Модель «${it.name}» добавлена в центр карты. Двигайте кнопкой «Переместить»`);
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
        bbox: window.turf ? turf.bbox(fc) : null
    };
    m.addSource(it.srcId, { type: 'geojson', data: fc });
    m.addLayer({ id: it.layerId, type: 'fill-extrusion', source: it.srcId, paint: {} }, m.getLayer('gc-models') ? 'gc-models' : undefined);
    m3d.items.push(it);
    m3UpdateExtPaint(it);
    m3d.selected = id;
    m3RenderList();
    m3SyncSelectedUI();
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
}

// ---------- Список импортированных объектов и «Выбранный объект» ----------
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
    ['m3SelScale', 'm3SelHeading', 'm3SelAlt', 'm3SelColor', 'm3MoveBtn', 'm3DelBtn'].forEach(id => set(id, el => { el.disabled = !it; }));
    set('m3SelName', el => { el.textContent = it ? it.name : 'не выбран'; });
    if (!it) return;
    const scale = it.kind === 'model' ? it.scale : it.hmul;
    set('m3SelScale', el => { el.value = Math.log10(scale); });
    set('m3SelScaleVal', el => { el.textContent = '×' + (scale < 10 ? scale.toFixed(2) : scale.toFixed(1)); });
    set('m3SelHeading', el => { el.value = it.heading || 0; el.disabled = it.kind !== 'model'; });
    set('m3SelHeadingVal', el => { el.textContent = Math.round(it.heading || 0) + '°'; });
    set('m3SelAlt', el => { el.value = it.kind === 'model' ? it.alt : it.base; });
    set('m3SelAltVal', el => { el.textContent = Math.round(it.kind === 'model' ? it.alt : it.base) + ' м'; });
    set('m3SelColor', el => { el.value = it.color || '#f59e0b'; el.disabled = it.kind !== 'ext'; });
    set('m3MoveBtn', el => { el.disabled = it.kind !== 'model'; });
}

function m3RemoveItem(it) {
    const m = m3d.map;
    if (it.kind === 'ext') {
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
    const p = m3El('m3Pitch'), b = m3El('m3Bearing');
    const br = ((m.getBearing() + 180) % 360 + 360) % 360 - 180;
    if (p) { p.value = m.getPitch(); m3El('m3PitchVal').textContent = Math.round(m.getPitch()) + '°'; }
    if (b) { b.value = br; m3El('m3BearingVal').textContent = Math.round(br) + '°'; }
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
        m3Apply();
        m3RefreshUser();
        m3UpdateViewControls();
    });
    m.on('moveend', () => { if (m3d.active && !m3d.orbit) m3SyncToLeaflet(); });
    m.on('moveend', () => { if (m3d.opts.trees) m3TreesSchedule(); });
    m.on('sourcedata', e => { if (e.sourceId === 'gc-osm' && m3d.opts.trees) m3TreesSchedule(); });   // подгрузились тайлы OSM
    m.on('move', m3UpdateViewControls);
    m.on('click', m3OnClick);
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

function enter3D() {
    if (m3d.active) return;
    if (typeof maplibregl === 'undefined') {
        updateStatus('⚠️ MapLibre GL не загрузился — проверьте подключение к интернету', true);
        return;
    }
    if (swipeState.active) deactivateSwipe();
    document.querySelectorAll('.widget-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.widget-btn').forEach(b => { if (b.id !== 'mode3dBtn') b.classList.remove('active'); });
    activePanel = null;
    try { if (measureMode) deactivateMeasureMode(); } catch (e) { /* не критично */ }
    try { if (currentTool || activeDrawHandler || isEditing || sketchState.tool) deactivateAllTools(); } catch (e) { /* не критично */ }
    hideMapContextMenu();

    m3d.active = true;
    mapStageEl.classList.add('mode-3d');
    if (map.hasLayer(currentTileLayer)) map.removeLayer(currentTileLayer);   // тайлы теперь рисует MapLibre

    if (!m3d.map) {
        m3Init();
    } else {
        const c = map.getCenter();
        m3d.map.resize();
        m3d.map.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom() - 1, 0), bearing: m3LbToMl(getBearing()) });
        m3RebuildBasemap();
        m3RefreshUser();
    }
    if (geoMarker) m3PutMarker(geoMarker.getLatLng());

    m3El('mode3dBtn').classList.add('active');
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
    if (!map.hasLayer(currentTileLayer)) currentTileLayer.addTo(map);
    map.invalidateSize();
    m3El('mode3dBtn').classList.remove('active');
    m3SetTabEnabled(false);
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

    // камера
    m3El('m3Pitch').addEventListener('input', function () { if (m3d.map) m3d.map.setPitch(+this.value); });
    m3El('m3Bearing').addEventListener('input', function () { if (m3d.map) m3d.map.setBearing(+this.value); });
    document.querySelectorAll('[data-m3-view]').forEach(btn => btn.addEventListener('click', function () {
        if (!m3d.map) return;
        const pitch = { top: 0, tilt: 60, side: 80 }[this.dataset.m3View];
        m3d.map.easeTo({ pitch: pitch, duration: 700 });
    }));
    m3El('m3Orbit').addEventListener('click', m3ToggleOrbit);

    // мои объекты
    m3El('m3RefreshUser').addEventListener('click', () => { m3RefreshUser(); updateStatus('🔄 Объекты обновлены в 3D'); });

    // импорт
    m3El('m3ImportModelBtn').addEventListener('click', () => m3El('m3ModelFile').click());
    m3El('m3ImportVecBtn').addEventListener('click', () => m3El('m3VecFile').click());
    m3El('m3ModelFile').addEventListener('change', function () { if (this.files[0]) m3ImportModel(this.files[0]); this.value = ''; });
    m3El('m3VecFile').addEventListener('change', function () { if (this.files[0]) m3ImportVector(this.files[0]); this.value = ''; });

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
        m3d.selected = it.id;
        m3RenderList();
        m3SyncSelectedUI();
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

    // кнопка «3D» под виджетом «Шторка»
    m3El('mode3dBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        if (m3d.active) exit3D(); else enter3D();
    });
    // кнопка включения 3D на самой вкладке «3D»
    m3El('m3ToggleBtn').addEventListener('click', function () {
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
        updateStatus('ℹ️ Рисование и измерения работают в 2D — выключите кнопку «3D»', true);
    }
}, true);

// Включение шторки выключает 3D
m3El('swipeWidget').addEventListener('click', () => { if (m3d.active) exit3D(); }, true);

document.addEventListener('keydown', e => { if (e.key === 'Escape' && m3d.placing) m3CancelPlacing(); });

if (window.ResizeObserver) {
    new ResizeObserver(() => { if (m3d.map && m3d.active) m3d.map.resize(); }).observe(mapStageEl);
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
        if (!isVisible()) return;
        if (busy) { again = true; return; }
        busy = true;
        try {
            const { o, Lo } = syncUI();
            const tmp = document.createElement('canvas'), ppm = Math.min(360 / Lo.pw, 240 / Lo.ph) * 1.5;
            const r = await compose(tmp, o, Lo, ppm);
            const cv = $('exPreview');
            cv.width = tmp.width; cv.height = tmp.height;
            cv.getContext('2d').drawImage(tmp, 0, 0);
            const lat0 = toLat(r.ext.miny), lat1 = toLat(r.ext.maxy), lon0 = toLng(r.ext.minx), lon1 = toLng(r.ext.maxx);
            $('exInfo').textContent = `Охват: ${lat0.toFixed(4)}…${lat1.toFixed(4)} с.ш., ${lon0.toFixed(4)}…${lon1.toFixed(4)} в.д.`;
            const w = $('exWarn');
            w.hidden = !(r.stat.failed > 0);
            if (r.stat.failed) w.textContent = `⚠ Не загрузилось тайлов: ${r.stat.failed} из ${r.stat.total}. Подложка может блокировать экспорт (CORS) — для надёжного результата выберите OSM или Esri.`;
        } catch (e) { console.error(e); setStatus('Не удалось построить превью: ' + e.message, true); }
        busy = false;
        if (again) { again = false; schedule(50); }
    }

    async function doExport() {
        const btn = $('exDownload');
        if (btn.disabled) return;
        btn.disabled = true;
        try {
            const { o, v, Lo } = syncUI();
            const geo = Lo.geo, { ppm, limited } = finalScale(Lo, o);
            if (o.geo && !geo) setStatus('Привязка отключена: 3D-вид наклонён или повёрнут', true);
            setStatus('Сборка карты…');
            const cv = document.createElement('canvas');
            const r = await compose(cv, o, Lo, ppm, (d, n) => setStatus(`Загрузка тайлов: ${d}/${n}`));
            const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1_');
            const base = 'geoclass_karta_' + stamp;
            setStatus('Кодирование файла…');
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
    }

    pane.addEventListener('input', () => { syncUI(); schedule(); });
    pane.addEventListener('change', () => { syncUI(); schedule(); });
    $('exRefresh').addEventListener('click', () => { imgCache.clear(); schedule(0); });
    $('exDownload').addEventListener('click', doExport);
    document.querySelector('.bp-tab[data-bp-tab="export"]').addEventListener('click', () => { syncUI(); schedule(50); });
    $('bottomPanelToggle').addEventListener('click', () => schedule(350));
    map.on('moveend', () => schedule(400));
    map.on('layeradd layerremove', () => schedule(500));
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.layer-chip, #mode3dBtn, #m3ToggleBtn')) schedule(900); });
    syncUI();
})();
