"""開発時に一度だけ動かす：現代の道路を data/roads.json に作る（現代の地図と観光マップにだけ出す）。

python3 tools/build_roads.py
- 道路：OpenStreetMap の highway（© OpenStreetMap contributors、ODbL）。Overpass API で門司区の中の道路を取る。
  取ったものは /var/tmp/kitakyushu/roads/osm_roads.json に保存し、二度目からはそれを使う（取り直すときは消す）。
- 太さの段は 3 つ：major＝高速・国道・主な県道、mid＝県道・市道の幹線、minor＝町の中の道（寄ったときだけ出す）。
- トンネル（関門トンネルなど）と、海の上を渡る所（関門橋。橋は模型があるので描かない）は除く。
  門司区の外（小倉・下関）へ続く道は、区の境で切る（木や町並みと同じく、区の中だけ描く）。
- 線は 2.5 m より細かい曲がりを間引き、地形の中心（terrain.json の center）からの m で、2 点目からは前の点との差で持つ。
"""
import json, math, os, struct, urllib.parse, urllib.request
from array import array

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
CACHE = "/var/tmp/kitakyushu/roads/osm_roads.json"
UA = {"User-Agent": "kitakyushu-kanko-mvp-dev/0.1 (one-off build; github uniunigoduni)"}
TOL = 2.5  # 間引きの許し（m）

CLASSES = {
    "major": {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"},
    "mid": {"secondary", "secondary_link", "tertiary", "tertiary_link"},
    "minor": {"unclassified", "residential", "living_street"},
}
CLASS_OF = {hw: k for k, s in CLASSES.items() for hw in s}

QUERY = """[out:json][timeout:120];
area["name"="門司区"]["boundary"="administrative"]->.a;
way(area.a)["highway"~"^(%s)$"];
out geom tags;""" % "|".join(sorted(CLASS_OF))


def fetch():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding="utf-8"))
    req = urllib.request.Request("https://overpass-api.de/api/interpreter",
                                 data=urllib.parse.urlencode({"data": QUERY}).encode(), headers=UA)
    raw = urllib.request.urlopen(req, timeout=180).read()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    open(CACHE, "wb").write(raw)
    return json.loads(raw)


meta = json.load(open(os.path.join(DATA, "terrain.json"), encoding="utf-8"))
nx, ny, B, C = meta["nx"], meta["ny"], meta["bounds"], meta["center"]
MX, MZ = meta["mPerDegLon"], meta["mPerDegLat"]
_bin = open(os.path.join(DATA, "terrain.bin"), "rb").read()
height = array("h")
height.frombytes(_bin[: nx * ny * 2])
if struct.pack("=h", 1) != struct.pack("<h", 1):
    height.byteswap()
ward = _bin[nx * ny * 2: nx * ny * 3]  # 門司区の中なら 1
STEP = 15  # 海・区の外かどうかを調べる間隔（m）


def to_m(lon, lat):
    return ((lon - C["lon"]) * MX, -(lat - C["lat"]) * MZ)


def drawable(x, z):
    """陸で、門司区の中か（x, z は中心からの m）"""
    lon, lat = C["lon"] + x / MX, C["lat"] - z / MZ
    i = round((lon - B["lon0"]) / (B["lon1"] - B["lon0"]) * (nx - 1))
    j = round((B["lat1"] - lat) / (B["lat1"] - B["lat0"]) * (ny - 1))
    if not (0 <= i < nx and 0 <= j < ny):
        return False
    k = j * nx + i
    return height[k] != -32768 and ward[k] == 1


def dense(pts):
    """STEP ごとに点を足す（橋のように、両端しか点のない長い線の途中も調べられるように）"""
    out = [pts[0]]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(x1 - x0, z1 - z0) / STEP))
        out += [(x0 + (x1 - x0) * t / n, z0 + (z1 - z0) * t / n) for t in range(1, n + 1)]
    return out


def simplify(pts, tol):
    """Douglas-Peucker"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, az), (bx, bz) = pts[a], pts[b]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1e-9
        best, k = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            d = abs((px - ax) * dz - (pz - az) * dx) / L
            if d > best:
                best, k = d, i
        if best > tol:
            keep[k] = True
            stack += [(a, k), (k, b)]
    return [p for p, f in zip(pts, keep) if f]


def main():
    osm = fetch()
    out = {k: [] for k in CLASSES}
    stats = {k: [0, 0.0] for k in CLASSES}
    for el in osm["elements"]:
        tags = el.get("tags", {})
        cls = CLASS_OF.get(tags.get("highway"))
        if not cls or tags.get("tunnel") not in (None, "no") or tags.get("area") == "yes" or "geometry" not in el:
            continue
        # 海の上（関門橋・海を渡る高架）と区の外で切る
        runs, cur = [], []
        for x, z in dense([to_m(g["lon"], g["lat"]) for g in el["geometry"]]):
            if drawable(x, z):
                cur.append((x, z))
                continue
            if len(cur) > 1:
                runs.append(cur)
            cur = []
        if len(cur) > 1:
            runs.append(cur)
        for run in runs:
            pts = simplify(run, TOL)
            length = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
            if length < 8:
                continue
            q = [(round(x), round(z)) for x, z in pts]
            flat = [q[0][0], q[0][1]]
            for (x0, z0), (x1, z1) in zip(q, q[1:]):
                if (x1, z1) != (x0, z0):
                    flat += [x1 - x0, z1 - z0]
            if len(flat) >= 4:
                out[cls].append(flat)
                stats[cls][0] += 1
                stats[cls][1] += length
    doc = {
        "source": "© OpenStreetMap contributors（ODbL）。Overpass API で取った門司区の道路を tools/build_roads.py で間引いたもの",
        "fetched": osm.get("osm3s", {}).get("timestamp_osm_base", ""),
        "layout": "m from terrain center (x east, z south); each line = [x0, z0, dx1, dz1, dx2, dz2, ...]",
        **out,
    }
    path = os.path.join(DATA, "roads.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    for k, (n, L) in stats.items():
        print(f"{k}: {n} lines, {L / 1000:.1f} km")
    print(path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
