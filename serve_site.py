# Локальный сервер сайта + прокси для снимков Sentinel-2.
# Запуск:  python serve_site.py   (из папки сайта или откуда угодно), затем откройте http://localhost:8000
# Прокси ускорен: постоянные соединения с S3 (без нового TLS-рукопожатия на каждый запрос)
# и кэш ответов на диске (папка .s3cache рядом со скриптом) — повторно открытые снимки грузятся мгновенно.
import hashlib, http.client, http.cookiejar, http.server, json, mimetypes, os, ssl, sys, threading, time, urllib.parse, urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
UPSTREAM_HOST = 'sentinel-cogs.s3.us-west-2.amazonaws.com'
ALLOWED_PREFIX = 'sentinel-s2-l2a-cogs/'
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.s3cache')
CACHE_MAX = 3 * 1024 ** 3          # предел размера кэша на диске (3 ГБ) — старые файлы удаляются
FWD_HEADERS = ('Content-Type', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag')
DISCONNECT_ERRORS = (BrokenPipeError, ConnectionResetError)
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/css', '.css')
local = threading.local()

PROXY_UA = 'geoclass-proxy'
BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
NSPD_HDR = {'User-Agent': BROWSER_UA, 'Referer': 'https://nspd.gov.ru/map', 'Origin': 'https://nspd.gov.ru',
            'Accept': 'application/json,image/png,*/*;q=0.8', 'Accept-Encoding': 'identity'}

# сроки хранения кэша пользовательских слоёв, суток
UCACHE_DAYS_DEFAULT = 7        # обычные слои
UCACHE_DAYS_NSPD_TILE = 30     # плитки НСПД
UCACHE_DAYS_NSPD_JSON = 3      # ответы-атрибуты НСПД (JSON)


def response_headers(raw_headers):
    """Заголовки ответа в виде словаря с именами в нижнем регистре."""
    return {k.lower(): v for k, v in raw_headers}


def make_opener(px=None, jar=None):
    """Исходящие запросы без проверки сертификата (НСПД использует российский корневой сертификат).
    Если НСПД закрыт для вашего IP (зарубежный адрес/VPN) — задайте прокси в РФ: переменная окружения GEO_PROXY=http://host:port"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    handlers = [urllib.request.HTTPSHandler(context=ctx)]
    if jar is not None:
        handlers.append(urllib.request.HTTPCookieProcessor(jar))
    px = px or os.environ.get('GEO_PROXY')
    if px:
        handlers.append(urllib.request.ProxyHandler({'http': px, 'https': px}))
    return urllib.request.build_opener(*handlers)


OPENER = make_opener()


def win_proxy_for(url):
    """Прокси, который Windows выбирает для адреса (учитывает PAC-скрипт из настроек системы, как это делает браузер).
    Python сам PAC не читает, поэтому спрашиваем у системы через PowerShell. Вне Windows возвращает None."""
    if os.name != 'nt':
        return None
    try:
        import subprocess
        cmd = "$p=[System.Net.WebRequest]::GetSystemWebProxy(); $u=[uri]'%s'; if(-not $p.IsBypassed($u)){ $p.GetProxy($u).AbsoluteUri }" % url
        out = subprocess.run(['powershell', '-NoProfile', '-Command', cmd], capture_output=True, text=True, timeout=25, creationflags=0x08000000).stdout.strip()
        if out and out.rstrip('/') != url.rstrip('/'):
            return out.rstrip('/')
    except Exception as e:
        print('proxy autodetect error:', e)
    return None


# НСПД: прокси из GEO_PROXY, а если не задан — тот, что система (PAC) выбирает для nspd.gov.ru; остальные запросы идут как раньше
NSPD_PROXY = os.environ.get('GEO_PROXY') or win_proxy_for('https://nspd.gov.ru')
NSPD_JAR = http.cookiejar.CookieJar()     # cookie сессии НСПД: поисковый API отвечает 403 без них
NSPD_OPENER = make_opener(NSPD_PROXY, NSPD_JAR)
NSPD_HDR_XHR = dict(NSPD_HDR, **{'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors',
                                  'Sec-Fetch-Site': 'same-origin', 'Referer': 'https://nspd.gov.ru/map?thematic=PKK'})


# Прокси для S3: GEO_S3_PROXY=http://host:port или тот, что система (PAC) выбирает для S3 — как в браузере (нужно в сетях с прокси компании).
# Соединение с S3 (через прокси — туннелем CONNECT) постоянное, своё на каждый поток: не тратим ~секунды на новое подключение при каждом запросе.
S3_PROXY = os.environ.get('GEO_S3_PROXY') or win_proxy_for('https://' + UPSTREAM_HOST)
S3_OPENER = make_opener(S3_PROXY) if S3_PROXY else None
_S3_CTX = ssl.create_default_context()
_S3_CTX.check_hostname = False
_S3_CTX.verify_mode = ssl.CERT_NONE   # как в make_opener: прокси компании может подменять сертификат


def new_s3_conn():
    if S3_PROXY:
        u = urllib.parse.urlparse(S3_PROXY if '://' in S3_PROXY else 'http://' + S3_PROXY)
        c = http.client.HTTPSConnection(u.hostname, u.port or 8080, timeout=25, context=_S3_CTX)
        c.set_tunnel(UPSTREAM_HOST)
        return c
    return http.client.HTTPSConnection(UPSTREAM_HOST, timeout=25)


def upstream_get(path, headers):
    """GET к S3 по постоянному соединению (через прокси, если он есть); при обрыве — одна повторная попытка, затем запасной путь через urllib."""
    try:
        return upstream_get_direct(path, headers)
    except Exception as e:
        if S3_OPENER is None:
            raise
        print('S3: постоянное соединение не удалось (%s), пробуем через urllib' % e)
    rq = urllib.request.Request('https://' + UPSTREAM_HOST + path, headers=headers)
    try:
        with S3_OPENER.open(rq, timeout=25) as r:
            return r.status, response_headers(r.getheaders()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, response_headers(e.headers.items()), e.read()


def upstream_get_direct(path, headers):
    """GET к S3 по постоянному соединению (своё на каждый поток); при обрыве — одна повторная попытка."""
    for attempt in (0, 1):
        conn = getattr(local, 'conn', None)
        if conn is None:
            conn = local.conn = new_s3_conn()
        try:
            conn.request('GET', path, headers=headers)
            r = conn.getresponse()
            data = r.read()
            return r.status, response_headers(r.getheaders()), data
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            local.conn = None
            if attempt:
                raise


# ---------- дисковый кэш ----------
def cache_path(key, rng):
    h = hashlib.sha1((key + '|' + (rng or '')).encode('utf-8')).hexdigest()
    return os.path.join(CACHE_DIR, h[:2], h)


def cache_get(key, rng):
    p = cache_path(key, rng)
    try:
        with open(p + '.json', 'r', encoding='utf-8') as f:
            meta = json.load(f)
        with open(p + '.bin', 'rb') as f:
            data = f.read()
        if len(data) != meta['len']:
            return None
        return meta['status'], meta['headers'], data
    except Exception:
        return None


def cache_put(key, rng, status, headers, data):
    p = cache_path(key, rng)
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p + '.bin.tmp', 'wb') as f:
            f.write(data)
        os.replace(p + '.bin.tmp', p + '.bin')
        meta = {'status': status, 'len': len(data), 'headers': {h.lower(): headers[h.lower()] for h in FWD_HEADERS if headers.get(h.lower())}}
        with open(p + '.json.tmp', 'w', encoding='utf-8') as f:
            json.dump(meta, f)
        os.replace(p + '.json.tmp', p + '.json')    # .json пишется последним — это признак готовой записи
    except Exception as e:
        print('cache write error:', e)


def cache_prune():
    """Удаляет самые старые файлы кэша, если он вырос больше CACHE_MAX."""
    try:
        files, total = [], 0
        for root, _, names in os.walk(CACHE_DIR):
            for n in names:
                fp = os.path.join(root, n)
                st = os.stat(fp)
                files.append((st.st_mtime, st.st_size, fp))
                total += st.st_size
        if total <= CACHE_MAX:
            return
        files.sort()
        for _, size, fp in files:
            os.remove(fp)
            total -= size
            if total <= CACHE_MAX * 0.8:
                break
    except Exception as e:
        print('cache prune error:', e)


def ucache_ttl_days(is_nspd, cached_headers):
    """Срок жизни записи кэша пользовательского слоя: плитки НСПД — 30 суток, JSON-атрибуты НСПД — 3, остальные слои — 7."""
    if not is_nspd:
        return UCACHE_DAYS_DEFAULT
    is_json = 'json' in (cached_headers.get('content-type') or '')
    return UCACHE_DAYS_NSPD_JSON if is_json else UCACHE_DAYS_NSPD_TILE


# ---------- Почвенная карта: soil.geojson (122 МБ) читается один раз и отдаётся кусками по границам экрана ----------
SITE_DIR = os.path.dirname(os.path.abspath(__file__))
SOIL_FILE = os.path.join(SITE_DIR, 'soil.geojson')
SOIL = {'feats': None, 'state': 'idle', 'err': ''}
SOIL_MAX = 6000                      # предел числа полигонов в одном ответе


def soil_load():
    """Читает soil.geojson, сдвигает долготы >180 (Чукотка) в -180..180, хранит кольца компактными массивами float32."""
    from array import array
    SOIL['state'] = 'loading'
    t0 = time.time()
    try:
        with open(SOIL_FILE, encoding='utf-8') as f:
            gj = json.load(f)
        feats = []
        for ft in gj['features']:
            g = ft.get('geometry')
            if not g or not g.get('coordinates'):
                continue
            polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
            out, x0, y0, x1, y1 = [], 1e9, 1e9, -1e9, -1e9
            for poly in polys:
                rings = []
                for ring in poly:
                    a = array('f')
                    for x, y in ring:
                        if x > 180:
                            x -= 360
                        a.append(x); a.append(y)
                        if x < x0: x0 = x
                        if x > x1: x1 = x
                        if y < y0: y0 = y
                        if y > y1: y1 = y
                    rings.append(a)
                out.append(rings)
            p = ft.get('properties') or {}
            props = {k: v for k, v in p.items() if v != -9999 and v is not None}
            feats.append((x0, y0, x1, y1, props, out))
        del gj
        grid = {}      # сетка 1°x1° для быстрого поиска полигонов в окне
        for idx, ft in enumerate(feats):
            for ix in range(int(ft[0] // 1), int(ft[2] // 1) + 1):
                for iy in range(int(ft[1] // 1), int(ft[3] // 1) + 1):
                    grid.setdefault((ix, iy), []).append(idx)
        SOIL['grid'] = grid
        SOIL['feats'] = feats
        SOIL['state'] = 'ready'
        print('Почвенная карта загружена: %d полигонов за %.0f с' % (len(feats), time.time() - t0))
    except Exception as e:
        SOIL['state'] = 'error'
        SOIL['err'] = ('нет файла soil.geojson рядом с serve_site.py' if isinstance(e, FileNotFoundError) else str(e))[:200]
        print('Ошибка загрузки soil.geojson:', e)


SOIL_SIMPL = {}                      # кэш упрощённой геометрии: (номер полигона, масштаб) -> координаты


def soil_simplify(idx, polys, tol):
    """Прореживает точки (шаг не меньше ~1 пикселя экрана); None, если контур слишком мал."""
    mp = []
    for rings in polys:
        rr = []
        for a in rings:
            pts, lx, ly = [], None, None
            for i in range(0, len(a), 2):
                x, y = a[i], a[i + 1]
                if lx is None or abs(x - lx) > tol or abs(y - ly) > tol:
                    pts.append([round(x, 5), round(y, 5)]); lx, ly = x, y
            if len(pts) >= 3:
                if pts[0] != pts[-1]:
                    pts.append(pts[0])
                if len(pts) >= 4:
                    rr.append(pts)
        if rr:
            mp.append(rr)
    return mp or None


def soil_query(w, s, e, n, z):
    """Полигоны в окне: поиск по сетке, крупные контуры в приоритете, упрощение по масштабу с кэшем."""
    tol = 360.0 / (256 * 2 ** z) * 1.2
    feats, grid = SOIL['feats'], SOIL['grid']
    cand = set()
    for ix in range(max(int(w // 1), -181), min(int(e // 1), 180) + 1):
        for iy in range(max(int(s // 1), -91), min(int(n // 1), 90) + 1):
            cand.update(grid.get((ix, iy), ()))
    sel = []
    for i in cand:
        x0, y0, x1, y1 = feats[i][:4]
        if x1 < w or x0 > e or y1 < s or y0 > n or (x1 - x0 < tol and y1 - y0 < tol):
            continue
        sel.append((-(x1 - x0) * (y1 - y0), i))
    sel.sort()
    cut = len(sel) > SOIL_MAX
    if len(SOIL_SIMPL) > 150000:
        SOIL_SIMPL.clear()
    res = []
    for _, i in sel[:SOIL_MAX]:
        key = (i, z)
        if key not in SOIL_SIMPL:
            SOIL_SIMPL[key] = soil_simplify(i, feats[i][5], tol)
        mp = SOIL_SIMPL[key]
        if mp:
            res.append({'type': 'Feature', 'properties': feats[i][4], 'geometry': {'type': 'MultiPolygon', 'coordinates': mp}})
    return {'type': 'FeatureCollection', 'features': res, 'truncated': cut}


class Handler(http.server.SimpleHTTPRequestHandler):
    # префикс пути -> имя метода-обработчика; всё остальное — статические файлы сайта
    ROUTES = (('/s3/', 'proxy'), ('/isric?', 'isric'), ('/ucache?', 'ucache'), ('/nspdcheck', 'nspdcheck'), ('/soilgeo', 'soilgeo'))

    def do_GET(self):
        for prefix, handler in self.ROUTES:
            if self.path.startswith(prefix):
                return getattr(self, handler)()
        return super().do_GET()

    def reply(self, status, headers, data, ignore_disconnect=True):
        """Отправляет ответ: статус, заголовки (список пар) и тело; обрыв соединения клиентом по умолчанию игнорируется."""
        def send():
            self.send_response(status)
            for name, value in headers:
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)
        if not ignore_disconnect:
            return send()
        try:
            send()
        except DISCONNECT_ERRORS:
            pass

    # ---------- /ucache: кэширующий прокси плиток пользовательских слоёв ----------
    def ucache_fetch(self, u, is_nspd):
        """Загружает слой с источника напрямую (для НСПД — с браузерными заголовками и своим прокси)."""
        hdr = dict(NSPD_HDR) if is_nspd else {'User-Agent': PROXY_UA, 'Accept-Encoding': 'identity'}   # НСПД отдаёт тайлы только «браузерным» запросам с их сайта
        try:
            return self.ucache_open(u, hdr, is_nspd)
        except urllib.error.HTTPError as e:
            if not (is_nspd and e.code == 403 and '/geoportal/' in u):
                raise
            # поиск НСПД строже плиток: заходим на страницу карты (получаем cookie) и повторяем запрос с «браузерными» заголовками XHR
            try:
                page = urllib.request.Request('https://nspd.gov.ru/map', headers={'User-Agent': BROWSER_UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Encoding': 'identity'})
                NSPD_OPENER.open(page, timeout=20).read()
            except Exception as e2:
                print('NSPD session warm-up error:', e2)
            try:
                return self.ucache_open(u, dict(NSPD_HDR_XHR), is_nspd)
            except urllib.error.HTTPError as e3:
                print('NSPD search 403 after retry:', e3.read()[:300].decode('utf-8', 'replace'), '| cookies:', len(NSPD_JAR))
                raise

    def ucache_open(self, u, hdr, is_nspd):
        req = urllib.request.Request(u, headers=hdr)
        with (NSPD_OPENER if is_nspd else OPENER).open(req, timeout=20 if is_nspd else 60) as r:
            data = r.read()
            return r.status, response_headers(r.getheaders()), data

    def ucache(self):
        """Кэширующий прокси плиток пользовательских слоёв (WMS / XYZ / ArcGIS): картинки хранятся на диске 7 суток.
        Заодно работает с серверами с самоподписанным сертификатом."""
        u = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('u', [''])[0]
        pu = urllib.parse.urlparse(u)
        if pu.scheme not in ('http', 'https') or not pu.hostname or pu.hostname in ('localhost', '0.0.0.0', '::1'):
            self.send_error(403, 'forbidden')
            return
        key = 'u|' + u
        is_nspd = pu.hostname.endswith('nspd.gov.ru')
        hit = stale = cache_get(key, None)
        if hit:
            age = time.time() - os.path.getmtime(cache_path(key, None) + '.json')
            if age > ucache_ttl_days(is_nspd, hit[1]) * 86400:
                hit = None
        if hit:
            status, headers, data = hit
        else:
            try:
                status, headers, data = self.ucache_fetch(u, is_nspd)
            except Exception as e:
                print('UCACHE error:', u[:120], e)
                if stale:    # НСПД недоступен — отдаём устаревшую копию из кэша, лучше чем ничего
                    status, headers, data = stale
                else:
                    self.send_error(502, 'upstream unreachable', str(e))
                    return
            else:
                ctype = headers.get('content-type', '')
                if status == 200 and (ctype.startswith('image/') or (is_nspd and 'json' in ctype and len(data) > 2)):
                    cache_put(key, None, status, headers, data)
        self.reply(status, [('Content-Type', headers.get('content-type', 'application/octet-stream')), ('Content-Length', str(len(data))),
                            ('Cache-Control', 'public, max-age=%d' % (604800 if is_nspd else 86400))], data)

    # ---------- /soilgeo: почвенная карта по границам экрана ----------
    def soilgeo(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if SOIL['feats'] is None:
            if SOIL['state'] == 'idle':
                SOIL['state'] = 'loading'
                threading.Thread(target=soil_load, daemon=True).start()
            body = json.dumps({'loading': SOIL['state'] != 'error', 'error': SOIL['err']}).encode()
        else:
            try:
                w, s_, e, n = [float(v) for v in q.get('bbox', [''])[0].split(',')]
                z = max(0, min(22, int(float(q.get('z', ['8'])[0]))))
                body = json.dumps(soil_query(w, s_, e, n, z), separators=(',', ':')).encode()
            except Exception as ex:
                self.send_error(400, 'bad request', str(ex))
                return
        self.reply(200, [('Content-Type', 'application/json'), ('Content-Length', str(len(body))), ('Cache-Control', 'no-store')], body)

    # ---------- /nspdcheck: диагностика слоя НСПД ----------
    def nspd_probe_tile(self):
        """Пробный тайл НСПД (центр Москвы): статус, тип и размер ответа либо описание ошибки."""
        res = {}
        u = ('https://nspd.gov.ru/api/aeggis/v3/36049/wms?REQUEST=GetMap&SERVICE=WMS&VERSION=1.3.0&FORMAT=image/png&STYLES=&TRANSPARENT=true'
             '&LAYERS=36049&WIDTH=256&HEIGHT=256&CRS=EPSG:3857&BBOX=4187000,7508000,4188000,7509000')
        try:
            with NSPD_OPENER.open(urllib.request.Request(u, headers=NSPD_HDR), timeout=25) as r:
                data = r.read()
                res.update(status=r.status, type=r.headers.get('Content-Type', ''), bytes=len(data))
                if not res['type'].startswith('image/'):
                    res['body'] = data[:300].decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            res.update(status=e.code, error='HTTP %s' % e.code, body=e.read()[:300].decode('utf-8', 'replace'))
        except Exception as e:
            res.update(error=str(e))
        return res

    def nspd_probe_ip(self):
        """Страна IP-адреса, с которого идут запросы (None, если определить не удалось)."""
        try:
            with NSPD_OPENER.open(urllib.request.Request('https://ipwho.is/?fields=ip,country_code', headers={'User-Agent': PROXY_UA}), timeout=8) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception:
            return None

    def nspdcheck(self):
        """Диагностика слоя НСПД: пробный тайл (центр Москвы) и страна IP-адреса, с которого идут запросы."""
        res = self.nspd_probe_tile()
        ip = self.nspd_probe_ip()
        if ip is not None:
            res['ip'] = ip
        print('NSPD check:', res)
        data = json.dumps(res, ensure_ascii=False).encode('utf-8')
        self.reply(200, [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(data)))], data, ignore_disconnect=False)

    # ---------- /isric: прокси к WCS SoilGrids ----------
    def isric(self):
        """Прокси к WCS ISRIC SoilGrids (раздел «Хим. анализ»): обходит CORS, GeoTIFF кэшируются на диске."""
        query = self.path[7:]
        if not query.startswith('map=/map/') or '..' in query:
            self.send_error(403, 'forbidden')
            return
        key = 'isric|' + query
        hit = cache_get(key, None)
        if hit:
            status, headers, data = hit
        else:
            conn = http.client.HTTPSConnection('maps.isric.org', timeout=30)
            try:
                conn.request('GET', '/mapserv?' + query, headers={'User-Agent': PROXY_UA, 'Accept-Encoding': 'identity'})
                r = conn.getresponse()
                data = r.read()
                status, headers = r.status, response_headers(r.getheaders())
            except Exception as e:
                # напрямую недоступно (блокировка/VPN только в браузере) — пробуем через прокси: GEO_PROXY или системный (PAC), как у браузера
                print('ISRIC direct error:', e)
                try:
                    px = os.environ.get('GEO_PROXY') or win_proxy_for('https://maps.isric.org')
                    if not px:
                        raise e
                    rq = urllib.request.Request('https://maps.isric.org/mapserv?' + query, headers={'User-Agent': PROXY_UA, 'Accept-Encoding': 'identity'})
                    with make_opener(px).open(rq, timeout=120) as r2:
                        data = r2.read()
                        status, headers = r2.status, response_headers(r2.getheaders())
                except Exception as e2:
                    print('ISRIC error:', e2)
                    self.send_error(502, 'ISRIC unreachable', str(e2))
                    return
            finally:
                conn.close()
            if status == 200 and data[:2] in (b'II', b'MM'):
                cache_put(key, None, status, headers, data)
        self.reply(status, [('Content-Type', headers.get('content-type', 'application/octet-stream')), ('Content-Length', str(len(data)))], data)

    # ---------- /s3/: прокси снимков Sentinel-2 ----------
    def proxy(self):
        key = urllib.parse.unquote(self.path[4:].split('?')[0])
        if key == 'ping':
            self.reply(200, [('X-GeoClass-Proxy', '1'), ('Content-Length', '2')], b'ok', ignore_disconnect=False)
            return
        if not key.startswith(ALLOWED_PREFIX) or '..' in key:
            self.send_error(403, 'forbidden')
            return
        rng = self.headers.get('Range')
        hit = cache_get(key, rng)
        if hit:
            status, headers, data = hit
        else:
            req_headers = {'User-Agent': PROXY_UA, 'Accept-Encoding': 'identity'}
            if rng:
                req_headers['Range'] = rng
            try:
                status, headers, data = upstream_get('/' + urllib.parse.quote(key), req_headers)
            except Exception as e:
                print('S3 error:', key, e)
                self.send_error(502, 'S3 unreachable', str(e))
                return
            if status in (200, 206):
                cache_put(key, rng, status, headers, data)
        out = [(h, headers[h.lower()]) for h in FWD_HEADERS if headers.get(h.lower())]
        self.reply(status, out + [('Content-Length', str(len(data))), ('Cache-Control', 'public, max-age=86400')], data)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    threading.Thread(target=cache_prune, daemon=True).start()
    if os.path.exists(SOIL_FILE):
        threading.Thread(target=soil_load, daemon=True).start()   # почвенная карта грузится в фоне при старте
    print('Сайт: http://localhost:%d   (Ctrl+C — остановить)' % PORT)
    print('Кэш снимков: %s' % CACHE_DIR)
    print('Прокси для НСПД: %s' % (NSPD_PROXY or 'нет (напрямую)'))
    print('Прокси для снимков S3: %s' % (S3_PROXY or 'нет (напрямую)'))
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
