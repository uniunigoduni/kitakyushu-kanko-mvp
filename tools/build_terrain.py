"""開発時に一度だけ動かす：国土地理院の標高タイルと門司区の境界から data/terrain.* を作る。

uv run --with pillow --with numpy python tools/build_terrain.py
- 標高：地理院タイル dem_png（DEM10B, z13）https://maps.gsi.go.jp/development/ichiran.html
- 門司区の境界：OpenStreetMap relation 4008584（© OpenStreetMap contributors, ODbL）
タイルと境界は /var/tmp/kitakyushu/ に保存し、二度目からはそれを使う。
"""
import io, json, math, os, struct, sys, urllib.request
import numpy as np
from PIL import Image, ImageDraw

LON0, LON1, LAT0, LAT1 = 130.870, 131.070, 33.825, 34.000
CELL = 60.0  # m
Z = 13
CACHE = "/var/tmp/kitakyushu/gsi"
OUT = os.path.join(os.path.dirname(__file__), "..", "data")
UA = {"User-Agent": "moji-history-map-dev/0.1"}

LATC, LONC = (LAT0 + LAT1) / 2, (LON0 + LON1) / 2
MX = math.cos(math.radians(LATC)) * 111320.0
MZ = 110574.0

def local(lon, lat):
    return (lon - LONC) * MX, -(lat - LATC) * MZ

def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def get(url, path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            data = r.read()
        open(path, "wb").write(data)
    return open(path, "rb").read()

def dem_tile(x, y):
    try:
        raw = get(f"https://cyberjapandata.gsi.go.jp/xyz/dem_png/{Z}/{x}/{y}.png", f"{CACHE}/{Z}_{x}_{y}.png")
    except Exception as e:  # 海だけのタイルは 404
        return np.full((256, 256), np.nan)
    a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB")).astype(np.int64)
    v = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h = np.where(v < 2**23, v, v - 2**24) * 0.01
    h = h.astype(float)
    h[v == 2**23] = np.nan
    return h

def main():
    sx0, sy0 = tile_xy(LON0, LAT1, Z)
    sx1, sy1 = tile_xy(LON1, LAT0, Z)
    tx0, ty0, tx1, ty1 = int(sx0), int(sy0), int(sx1), int(sy1)
    mosaic = np.full(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.nan)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = dem_tile(tx, ty)
    w_m = (LON1 - LON0) * MX
    h_m = (LAT1 - LAT0) * MZ
    nx, ny = int(round(w_m / CELL)) + 1, int(round(h_m / CELL)) + 1
    hts = np.zeros((ny, nx))
    for j in range(ny):
        lat = LAT1 - (LAT1 - LAT0) * j / (ny - 1)
        for i in range(nx):
            lon = LON0 + (LON1 - LON0) * i / (nx - 1)
            px, py = tile_xy(lon, lat, Z)
            fx, fy = (px - tx0) * 256 - 0.5, (py - ty0) * 256 - 0.5
            x0, y0 = int(math.floor(fx)), int(math.floor(fy))
            ax, ay = fx - x0, fy - y0
            q = mosaic[y0:y0 + 2, x0:x0 + 2]
            wts = np.array([[(1 - ax) * (1 - ay), ax * (1 - ay)], [(1 - ax) * ay, ax * ay]])
            ok = ~np.isnan(q)
            if ok.sum() >= 3:  # 3点以上が陸なら陸
                hts[j, i] = (np.nan_to_num(q) * wts * ok).sum() / (wts * ok).sum()
            else:
                hts[j, i] = np.nan
    land = ~np.isnan(hts)
    # 門司区の境界（OSM）
    rel_path = "/var/tmp/kitakyushu/moji_rel.json"
    if not os.path.exists(rel_path):
        q = '[out:json][timeout:50];rel["name"="門司区"]["boundary"="administrative"];out geom;'
        get("https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(q), rel_path)
    rel = json.load(open(rel_path))["elements"][0]
    ways = [[(p["lon"], p["lat"]) for p in m["geometry"]] for m in rel["members"] if m["type"] == "way" and m["role"] == "outer"]
    rings = []
    while ways:
        ring = ways.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for k, w in enumerate(ways):
                if w[0] == ring[-1]: ring += w[1:]
                elif w[-1] == ring[-1]: ring += w[::-1][1:]
                elif w[-1] == ring[0]: ring = w[:-1] + ring
                elif w[0] == ring[0]: ring = w[::-1][:-1] + ring
                else: continue
                ways.pop(k); changed = True; break
        rings.append(ring)
    mask_img = Image.new("L", (nx, ny), 0)
    dr = ImageDraw.Draw(mask_img)
    poly_local = []
    for ring in rings:
        pts = [((lon - LON0) / (LON1 - LON0) * (nx - 1), (LAT1 - lat) / (LAT1 - LAT0) * (ny - 1)) for lon, lat in ring]
        dr.polygon(pts, fill=255)
        poly_local.append([[round(c, 1) for c in local(lon, lat)] for lon, lat in ring[::3]])
    moji = (np.asarray(mask_img) > 127)
    hd = np.where(land, np.clip(np.round(np.nan_to_num(hts) * 10), -30000, 32000), -32768).astype("<i2")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "terrain.bin"), "wb") as f:
        f.write(hd.tobytes())
        f.write(moji.astype("u1").tobytes())
    meta = {
        "source": "国土地理院 標高タイル(DEM10B) z13 / 門司区界: OpenStreetMap contributors (ODbL)",
        "bounds": {"lon0": LON0, "lon1": LON1, "lat0": LAT0, "lat1": LAT1},
        "center": {"lon": LONC, "lat": LATC}, "mPerDegLon": MX, "mPerDegLat": MZ,
        "nx": nx, "ny": ny, "cell": CELL, "width": w_m, "depth": h_m,
        "layout": "int16 height[dm] row-major north→south (sea=-32768), then uint8 moji-ward mask",
        "maxHeight": float(np.nanmax(hts)),
        "mojiRings": poly_local,
    }
    json.dump(meta, open(os.path.join(OUT, "terrain.json"), "w"), ensure_ascii=False)
    print(f"grid {nx}x{ny}, land {land.mean():.2%}, moji {moji.mean():.2%}, max {np.nanmax(hts):.0f}m, rings {len(rings)} ({[len(r) for r in rings]})")
    # 目視用プレビュー
    prev = np.zeros((ny, nx, 3), np.uint8)
    prev[~land] = (30, 50, 80)
    g = np.clip(np.nan_to_num(hts) / 400 * 200 + 40, 0, 255).astype(np.uint8)
    prev[land] = np.stack([g, g, g], -1)[land]
    prev[land & moji] = (prev[land & moji] * np.array([0.8, 1.0, 0.8])).astype(np.uint8)
    Image.fromarray(prev).resize((nx * 2, ny * 2)).save("/var/tmp/kitakyushu/terrain_preview.png")

if __name__ == "__main__":
    import urllib.parse
    main()
