# Локальный сервер сайта + прокси для снимков Sentinel-2.
# Запуск:  python serve_site.py   (из папки сайта или откуда угодно), затем откройте http://localhost:8000
# Прокси ускорен: постоянные соединения с S3 (без нового TLS-рукопожатия на каждый запрос)
# и кэш ответов на диске (папка .s3cache рядом со скриптом) — повторно открытые снимки грузятся мгновенно.
import hashlib, http.client, http.server, json, mimetypes, os, sys, threading, urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
UPSTREAM_HOST = 'sentinel-cogs.s3.us-west-2.amazonaws.com'
ALLOWED_PREFIX = 'sentinel-s2-l2a-cogs/'
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.s3cache')
CACHE_MAX = 3 * 1024 ** 3          # предел размера кэша на диске (3 ГБ) — старые файлы удаляются
FWD_HEADERS = ('Content-Type', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/css', '.css')
local = threading.local()


def upstream_get(path, headers):
    """GET к S3 по постоянному соединению (своё на каждый поток); при обрыве — одна повторная попытка."""
    for attempt in (0, 1):
        conn = getattr(local, 'conn', None)
        if conn is None:
            conn = local.conn = http.client.HTTPSConnection(UPSTREAM_HOST, timeout=60)
        try:
            conn.request('GET', path, headers=headers)
            r = conn.getresponse()
            data = r.read()
            return r.status, {k.lower(): v for k, v in r.getheaders()}, data
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            local.conn = None
            if attempt:
                raise


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


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/s3/'):
            return self.proxy()
        if self.path.startswith('/isric?'):
            return self.isric()
        return super().do_GET()

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
            conn = http.client.HTTPSConnection('maps.isric.org', timeout=120)
            try:
                conn.request('GET', '/mapserv?' + query, headers={'User-Agent': 'geoclass-proxy', 'Accept-Encoding': 'identity'})
                r = conn.getresponse()
                data = r.read()
                status, headers = r.status, {k.lower(): v for k, v in r.getheaders()}
            except Exception as e:
                print('ISRIC error:', e)
                self.send_error(502, 'ISRIC unreachable: %s' % e)
                return
            finally:
                conn.close()
            if status == 200 and data[:2] in (b'II', b'MM'):
                cache_put(key, None, status, headers, data)
        try:
            self.send_response(status)
            self.send_header('Content-Type', headers.get('content-type', 'application/octet-stream'))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def proxy(self):
        key = urllib.parse.unquote(self.path[4:].split('?')[0])
        if key == 'ping':
            self.send_response(200)
            self.send_header('X-GeoClass-Proxy', '1')
            self.send_header('Content-Length', '2')
            self.end_headers()
            self.wfile.write(b'ok')
            return
        if not key.startswith(ALLOWED_PREFIX) or '..' in key:
            self.send_error(403, 'forbidden')
            return
        rng = self.headers.get('Range')
        hit = cache_get(key, rng)
        if hit:
            status, headers, data = hit
        else:
            req_headers = {'User-Agent': 'geoclass-proxy', 'Accept-Encoding': 'identity'}
            if rng:
                req_headers['Range'] = rng
            try:
                status, headers, data = upstream_get('/' + urllib.parse.quote(key), req_headers)
            except Exception as e:
                print('S3 error:', key, e)
                self.send_error(502, 'S3 unreachable: %s' % e)
                return
            if status in (200, 206):
                cache_put(key, rng, status, headers, data)
        try:
            self.send_response(status)
            for h in FWD_HEADERS:
                if headers.get(h.lower()):
                    self.send_header(h, headers[h.lower()])
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    threading.Thread(target=cache_prune, daemon=True).start()
    print('Сайт: http://localhost:%d   (Ctrl+C — остановить)' % PORT)
    print('Кэш снимков: %s' % CACHE_DIR)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
