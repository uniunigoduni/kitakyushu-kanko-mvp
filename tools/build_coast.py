"""開発時に一度だけ動かす：海を埋め立てた所が「どの時代から陸か」を推測して data/coast.* を作る。

uv run --with pillow --with numpy python tools/build_coast.py
- 埋立地・干拓地の範囲：地理院タイル「地形分類（人工地形）」experimental_landformclassification2 z14
  https://maps.gsi.go.jp/development/ichiran.html
  コードの意味は同じ場所の style.js による（11004〜11007・11014＝盛土地・埋立地、11008＝干拓地、11010＝改変工事中）
- いつ陸になったかは推測。年代の手がかりがある場所（門司港・猿喰新田・田野浦・太刀浦・新門司・北九州空港・巌流島）は
  REGIONS で決め、ほかの埋立地は、元からの陸に近い所ほど古い時代に陸にする。
- 史跡のピン・明治の鉄道・地名が、その時代に海の上へ出ないようにする。ピンを足したら作り直す。
タイルは /var/tmp/kitakyushu/lcm/t2 に保存し、二度目からはそれを使う。時代ごとのプレビューは /var/tmp/kitakyushu/coast/。
"""
import json, math, os, re, urllib.error, urllib.request
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
CACHE = "/var/tmp/kitakyushu/lcm/t2"
PREVIEW = "/var/tmp/kitakyushu/coast"
UA = {"User-Agent": "moji-history-map-dev/0.1"}
Z = 14
S = 4  # 格子の4倍の細かさで塗ってから、1マスに占める割合にする
FILL = {"11004", "11005", "11006", "11007", "11014", "11010"}  # 盛土地・埋立地と改変工事中
POLDER = {"11008"}  # 干拓地
HMAX = 8.0  # これより高い所は、埋立地の印があっても元からの陸とみなす（m）

_eras = re.findall(r"\{ id: '(\w+)', [^}]*?start: (-?\d+)", open(os.path.join(ROOT, "js", "eras.js"), encoding="utf-8").read())
ERA_IDS = [k for k, _ in _eras]
E = {k: i for i, k in enumerate(ERA_IDS)}
ERA_OF_YEAR = lambda y: max(i for i, (_, st) in enumerate(_eras) if int(st) <= y)
_props = open(os.path.join(ROOT, "js", "map", "props.js"), encoding="utf-8").read()
RAIL = [(float(a), float(b)) for a, b in re.findall(r"\[([\d.]+), ([\d.]+)\]", re.search(r"const RAIL = \[(.*?)\];", _props, re.S).group(1))]  # (lat, lon)
RAIL_ERA = "meiji"  # 鉄道（1891年）
SITES = json.load(open(os.path.join(DATA, "sites.json"), encoding="utf-8"))["sites"]
# 地図の地名（確かめるだけ）。from のない地名はどの時代にも出る
LABELS = [(t, float(la), float(lo), cls, int(fr) if fr else None) for t, la, lo, cls, fr in re.findall(
    r"\{ t: '([^']+)', lat: ([\d.]+), lon: ([\d.]+), cls: '([^']+)'[^}]*?(?:from: (\d+))? \}",
    open(os.path.join(ROOT, "js", "map", "world.js"), encoding="utf-8").read())]
# 地名のうち、出てくる年が決まっているもの（その時代には陸にしておく）
LABEL_POINTS = [("新門司", 130.9953, 33.8618, "growth")]

meta = json.load(open(os.path.join(DATA, "terrain.json"), encoding="utf-8"))
nx, ny, B = meta["nx"], meta["ny"], meta["bounds"]
_buf = open(os.path.join(DATA, "terrain.bin"), "rb").read()
raw = np.frombuffer(_buf, "<i2", nx * ny).reshape(ny, nx)
ward = np.frombuffer(_buf, np.uint8, nx * ny, nx * ny * 2).reshape(ny, nx).astype(bool)
land = raw != -32768
h = np.where(land, np.maximum(0.6, raw / 10), 0.0)
LONG, LATG = np.meshgrid(B["lon0"] + np.arange(nx) / (nx - 1) * (B["lon1"] - B["lon0"]),
                         B["lat1"] - np.arange(ny) / (ny - 1) * (B["lat1"] - B["lat0"]))


def cell(lon, lat):
    return (round((B["lat1"] - lat) / (B["lat1"] - B["lat0"]) * (ny - 1)),
            round((lon - B["lon0"]) / (B["lon1"] - B["lon0"]) * (nx - 1)))


def box(lon0, lon1, lat0, lat1):
    return (LONG >= lon0) & (LONG <= lon1) & (LATG >= lat0) & (LATG <= lat1)


def near(lon, lat, r_m):
    return ((LONG - lon) * meta["mPerDegLon"]) ** 2 + ((LATG - lat) * meta["mPerDegLat"]) ** 2 <= r_m ** 2


def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n


def fractions():
    """人工地形のタイルを集めて、1マスのうち埋立地・干拓地が占める割合を返す"""
    x0, y0 = map(int, tile_xy(B["lon0"], B["lat1"], Z))
    x1, y1 = map(int, tile_xy(B["lon1"], B["lat0"], Z))
    feats = []
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            p = f"{CACHE}/{tx}_{ty}.geojson"
            if not os.path.exists(p):
                os.makedirs(CACHE, exist_ok=True)
                url = f"https://cyberjapandata.gsi.go.jp/xyz/experimental_landformclassification2/{Z}/{tx}/{ty}.geojson"
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                        data = r.read()
                except urllib.error.HTTPError as e:  # 何もないタイルは 404
                    if e.code != 404:
                        raise
                    data = b'{"features":[]}'
                open(p, "wb").write(data)
            feats += json.load(open(p)).get("features", [])
    W, H = nx * S, ny * S

    def px(lon, lat):
        return (lon - B["lon0"]) / (B["lon1"] - B["lon0"]) * (nx - 1) * S, (B["lat1"] - lat) / (B["lat1"] - B["lat0"]) * (ny - 1) * S

    out = {}
    for name, codes in (("fill", FILL), ("polder", POLDER)):
        im = Image.new("L", (W, H), 0)
        dr = ImageDraw.Draw(im)
        for f in feats:
            if f["properties"].get("code") not in codes:
                continue
            g = f["geometry"]
            polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
            for poly in polys:
                dr.polygon([px(*pt) for pt in poly[0]], fill=255)
                for hole in poly[1:]:
                    dr.polygon([px(*pt) for pt in hole], fill=0)
        # マスの中心 i は細かい格子の i*S。そのまわり S×S 画素の平均をとる
        a = np.pad((np.asarray(im) > 127).astype(np.float32), ((S // 2, S // 2), (S // 2, S // 2)))
        acc = np.zeros((ny, nx), np.float32)
        for dy in range(S):
            for dx in range(S):
                acc += a[dy:dy + ny * S:S, dx:dx + nx * S:S]
        out[name] = acc / (S * S)
    return out


def label(m, conn8=True):
    """True のマスを、つながりごとに 1, 2, … と番号づけする"""
    H, W = m.shape
    W2 = W + 2
    p = np.zeros((H + 2, W2), bool)
    p[1:-1, 1:-1] = m
    f = p.ravel().tolist()
    lab = [0] * len(f)
    nb = (-W2, W2, -1, 1) + ((-W2 - 1, -W2 + 1, W2 - 1, W2 + 1) if conn8 else ())
    n = 0
    for s in np.flatnonzero(p).tolist():
        if lab[s]:
            continue
        n += 1
        lab[s] = n
        stack = [s]
        while stack:
            k = stack.pop()
            for d in nb:
                q = k + d
                if f[q] and not lab[q]:
                    lab[q] = n
                    stack.append(q)
    return np.array(lab, np.int32).reshape(H + 2, W2)[1:-1, 1:-1], n


def dist_from(src):
    """src のマスからの距離（マス数。上下左右 1、斜め √2）"""
    d = np.where(src, 0.0, 1e6)
    idx = np.arange(nx, dtype=float)
    D2 = math.sqrt(2)

    def along(r):
        r = np.minimum.accumulate(r - idx) + idx
        return np.minimum.accumulate((r + idx)[::-1])[::-1] - idx

    for rows in (range(ny), range(ny - 1, -1, -1)):
        prev = None
        for j in rows:
            c = d[j]
            if prev is not None:
                o = d[prev]
                c = np.minimum(c, o + 1)
                c[1:] = np.minimum(c[1:], o[:-1] + D2)
                c[:-1] = np.minimum(c[:-1], o[1:] + D2)
            d[j] = along(c)
            prev = j
    return d


def dilate(m, r=1):
    out = m.copy()
    for _ in range(r):
        o = out.copy()
        o[1:] |= out[:-1]; o[:-1] |= out[1:]; o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]
        out = o
    return out


def component_at(m, lon, lat):
    lab, _ = label(m)
    j, i = cell(lon, lat)
    return (lab == lab[j, i]) & (lab > 0)


def main():
    fr = fractions()
    sea = ~land
    shore = land & dilate(sea)

    # 1) 海を埋めた所の候補：低い埋立地・干拓地のうち、海につながっているかたまり
    PORT = box(130.9595, 130.9700, 33.9400, 33.9570) & ward
    cand = land & (h < HMAX) & ((fr["fill"] >= 0.5) | (fr["polder"] >= 0.5))
    cand |= land & PORT & (h < 4.5)  # 門司港の低い所は印がなくても埋立地（明治に海を埋めて港と駅を造った）
    lab, n = label(cand)
    keep = np.zeros(n + 1, bool)
    keep[np.unique(lab[cand & shore])] = True
    keep[0] = False
    recl = keep[lab]

    # 2) 元からの陸に近い所ほど古い時代に陸にする
    d = dist_from(land & ~recl)
    frm = np.full((ny, nx), 255, np.uint8)
    frm[land] = 0
    #    区の外（下関・小倉の町）は大正〜昭和後期、区の中の手がかりのない岸（漁港など）は戦後〜高度成長期
    gen = np.select([d <= 2, d <= 5, d <= 10], [E["taisho"], E["showa_pre"], E["growth"]], E["showa_late"])
    gen = np.where(ward, np.where(d <= 3, E["postwar"], E["growth"]), gen)
    frm[recl] = gen[recl]

    # 3) 年代の手がかりがある場所（後に書いたものほど優先）
    shinmoji = ward & box(130.975, 131.010, 33.840, 33.900)
    REGIONS = [
        ("小森江〜大里の工場・西海岸の岸壁（大正）", ward & box(130.915, 130.9595, 33.893, 33.947), E["taisho"]),
        ("門司港（明治に海を埋めて港と駅）", PORT, E["meiji"]),
        ("田野浦の埠頭（高度成長期）", ward & box(130.972, 130.993, 33.950, 33.972), E["growth"]),
        ("太刀浦のコンテナ埠頭（昭和後期）", ward & box(130.993, 131.014, 33.955, 33.975), E["showa_late"]),
        ("新門司・岸寄り（高度成長期）", shinmoji & (d <= 8), E["growth"]),
        ("新門司・沖（昭和後期）", shinmoji & (d > 8), E["showa_late"]),
        ("猿喰新田（江戸・1759年ごろ干拓）", (fr["polder"] >= 0.5) & near(130.981, 33.891, 1500), E["edo"]),
    ]
    for name, m, e in REGIONS:
        frm[recl & m] = e
    # 北九州空港の島（2006年開港）はまるごと平成から
    airport = component_at(land, 131.0349, 33.8459)
    frm[airport] = E["heisei"]
    # 巌流島：決闘のころは今の数分の一の小島。ピンのまわりだけ元の島にして、残りは埋め立て（時期は推測）
    g = next(s for s in SITES if s["id"] == "ganryujima")
    ganryu = component_at(land, g["lon"], g["lat"])
    gj, gi = cell(g["lon"], g["lat"])
    core = np.zeros_like(land)
    core[gj - 1:gj + 2, gi - 1:gi + 2] = True
    frm[ganryu] = E["growth"]
    frm[ganryu & core] = 0

    # 3.5) 地形分類で埋立地の印が抜けている所：埋立地にかこまれた低い「元からの陸」の切れはしは、となりと同じ時代に埋めたとみなす
    #      （そのままだと、新門司の沖などに昔の時代だけ細い島が浮かぶ。本当の小島はまわりが海なので残る）
    pin_cells = np.zeros_like(land)
    for s in SITES:
        pin_cells[cell(s["lon"], s["lat"])] = True
    lab, n = label(land & (frm == 0))
    size = np.bincount(lab.ravel(), minlength=n + 1)
    patched = []
    for k in np.flatnonzero(size < 500)[1:].tolist():
        comp = lab == k
        if (comp & (pin_cells | core)).any() or h[comp].max() >= 12:
            continue
        ring = dilate(comp) & ~comp
        rec = ring & land & (frm > 0) & (frm < 255)
        if rec.sum() < 0.3 * ring.sum():
            continue
        e = int(np.bincount(frm[rec]).argmax())
        frm[comp] = e
        recl |= comp
        j, i = np.argwhere(comp)[0]
        patched.append(f"{LATG[j, i]:.4f},{LONG[j, i]:.4f} {int(comp.sum())}マス→{ERA_IDS[e]}")
    print("印の抜けを埋立地にした所:", patched)

    # 4) 明治の鉄道は、そのころの海岸に沿って敷いた。線路より陸側の低い所（大里の町など）は元からの陸、
    #    線路の幅（両側 1 マスほど）は明治から陸にする。門司港は港ごと明治に埋めたので除く
    rail_pts = []
    for (a, b), (c2, d2) in zip(RAIL, RAIL[1:]):
        for t in np.linspace(0, 1, 24, endpoint=False):
            rail_pts.append(cell(b + (d2 - b) * t, a + (c2 - a) * t))
    rail_pts.append(cell(RAIL[-1][1], RAIL[-1][0]))
    band = np.zeros_like(land)
    inner = np.zeros_like(land)
    for j, i in rail_pts:
        if not (0 < j < ny - 1 and 0 < i < nx - 1) or PORT[j, i]:
            continue
        band[max(0, j - 1):j + 2, max(0, i - 1):i + 2] = True
        r = int(math.ceil(d[j, i])) + 2
        j0, j1, i0, i1 = max(0, j - r), min(ny, j + r + 1), max(0, i - r), min(nx, i + r + 1)
        jj, ii = np.mgrid[j0:j1, i0:i1]
        near_ = np.hypot(jj - j, ii - i) <= r
        inner[j0:j1, i0:i1] |= near_ & (d[j0:j1, i0:i1] <= d[j, i] - 1)
    frm[recl & inner & ~band & ~PORT] = 0
    m = recl & band & (frm > E[RAIL_ERA])
    frm[m] = E[RAIL_ERA]

    # 5) ピン・地名が、その時代に海の上へ出ないように、そこの岸をなめらかに沖へふくらませる
    #    （点では「その時代の陸からの距離 + 0.8 マス」まで陸にし、まわりへ行くほど 0 に近づける。四角い出っぱりや離れ小島にしない）
    want = {}
    for s in SITES:
        want.setdefault(E[s["eras"][0]], []).append(cell(s["lon"], s["lat"]))
    for name, lon, lat, era in LABEL_POINTS:
        want.setdefault(E[era], []).append(cell(lon, lat))
    for e in sorted(want):
        pts = [(j, i) for j, i in want[e] if land[j, i] and frm[j, i] > e]
        if not pts:
            continue
        de = dist_from(land & (frm <= e))
        thr = np.zeros((ny, nx))
        for j, i in pts:
            v = de[j, i] + 0.8
            R = max(2.5, 1.6 * v)
            r = int(math.ceil(R))
            j0, j1, i0, i1 = max(0, j - r), min(ny, j + r + 1), max(0, i - r), min(nx, i + r + 1)
            jj, ii = np.mgrid[j0:j1, i0:i1]
            k = np.clip(1 - (np.hypot(jj - j, ii - i) / R) ** 2, 0, 1) ** 2
            thr[j0:j1, i0:i1] = np.maximum(thr[j0:j1, i0:i1], v * k)
        m = recl & (frm > e) & (thr > 0) & (de <= thr)
        frm[m] = e

    # 6) 時代ごとに、海とつながらない水たまりは埋め、ほかとつながらない小さな陸（数マス）は次の時代へ送る
    dem_lab, _ = label(land)
    dem_size = np.bincount(dem_lab.ravel())
    def erode(m, r):
        return ~dilate(~m, r)

    for e in range(len(ERA_IDS)):
        for _ in range(4):
            changed = False
            # 陸と陸にはさまれた幅 4 マスまでの水路・入り江（線路の盛土など、海を埋めたのではない所）は陸にする
            L = land & (frm <= e)
            gap = erode(dilate(L, 2), 2) & ~L & recl & (frm > e)
            if gap.any():
                frm[gap] = e
                changed = True
            wet = land & (frm > e)
            lab, n = label(wet, conn8=False)
            if n:
                open_ = np.zeros(n + 1, bool)
                open_[np.unique(lab[wet & dilate(sea)])] = True
                lake = (lab > 0) & ~open_[lab]
                if lake.any():
                    frm[lake] = e
                    changed = True
            L = land & (frm <= e)
            lab, n = label(L)
            size = np.bincount(lab.ravel(), minlength=n + 1)
            has_pin = np.zeros(n + 1, bool)
            has_pin[np.unique(lab[L & pin_cells])] = True
            # 島まるごと（元の地形でも離れ島）なら小さくても残す
            whole = np.zeros(n + 1, bool)
            for k in np.unique(lab[L]):
                cells = lab == k
                whole[k] = size[k] == dem_size[np.unique(dem_lab[cells])].sum()
            speck = (lab > 0) & (size[lab] < 6) & ~has_pin[lab] & ~whole[lab]
            if speck.any():
                frm[speck] = e + 1
                changed = True
            if not changed:
                break

    # 7) 確かめる：陸にあるピン・地名が、出てくる時代に陸で、大きな陸（島のピンはその島）とつながっているか
    ok = True
    checks = [(s["id"], s["lon"], s["lat"], E[s["eras"][0]]) for s in SITES]
    checks += [(f"地名:{t}", lon, lat, 0 if fr is None else ERA_OF_YEAR(fr)) for t, lat, lon, cls, fr in LABELS if "sea" not in cls]
    for name, lon, lat, e in checks:
        j, i = cell(lon, lat)
        if not land[j, i]:
            print(f"  （海の上） {name}")
            continue
        L = land & (frm <= e)
        lab, _ = label(L)
        sz = int((lab == lab[j, i]).sum()) if L[j, i] else 0
        big = dem_size[dem_lab[j, i]] >= 1000
        good = frm[j, i] <= e and sz >= (1000 if big else 9)
        note = ""
        if not good and name.startswith("地名:") and not big:
            isle = (dem_lab == dem_lab[j, i]) & (frm <= e)
            if isle[max(0, j - 4):j + 5, max(0, i - 4):i + 5].any():
                good, note = True, "（島のすぐそば）"
        ok &= good
        print(f"  {'OK' if good else 'NG'} {name:24s} {ERA_IDS[e]:10s} from={ERA_IDS[frm[j, i]] if frm[j, i] < 255 else 'sea':10s} 陸のかたまり {sz}{note}")

    os.makedirs(PREVIEW, exist_ok=True)
    with open(os.path.join(DATA, "coast.bin"), "wb") as f:
        f.write(frm.astype("u1").tobytes())
    info = {
        "source": "国土地理院 地形分類（人工地形）タイル（盛土地・埋立地、干拓地）をもとに推測",
        "layout": "uint8 from[nx*ny] row-major north→south: 0=いつの時代も陸, k=ERAS[k] の時代から陸, 255=海",
        "eras": ERA_IDS,
        "nx": nx, "ny": ny,
        "regions": [name for name, _, _ in REGIONS] + ["北九州空港の島（平成）", "巌流島（ピンのまわり以外は高度成長期）",
                                                    "埋立地の印が抜けた低い切れはし（となりの埋立地と同じ時代）"],
    }
    json.dump(info, open(os.path.join(DATA, "coast.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    used = sorted(set(frm[land].tolist()))
    print("段階:", [(ERA_IDS[k], int((frm == k).sum())) for k in used])
    print("すべてのピンが陸に乗る" if ok else "陸に乗らないピンがある")
    preview(frm, used)


def preview(frm, used):
    """時代ごとの陸の形（区のまわり）。灰＝元からの陸、色＝その時代までに埋めた所、水色＝まだ海"""
    j0, i0 = cell(130.905, 33.975)
    j1, i1 = cell(131.045, 33.830)
    K = 3
    cols = {}
    pal = [(214, 120, 70), (225, 180, 70), (150, 190, 90), (90, 170, 160), (110, 130, 210), (180, 110, 200), (220, 110, 150), (240, 230, 120), (120, 200, 230)]
    for n, k in enumerate(k for k in used if k > 0):
        cols[k] = pal[n % len(pal)]
    tiles = []
    for e in [k for k in used if k > 0] + [len(ERA_IDS) - 1]:
        a = np.zeros((ny, nx, 3), np.uint8)
        a[:] = (24, 38, 62)
        a[land & (frm > e)] = (60, 95, 130)
        g = np.clip(70 + h / 400 * 150, 0, 255).astype(np.uint8)
        nat = land & (frm == 0)
        a[nat] = np.stack([g, g, g], -1)[nat]
        for k, c in cols.items():
            a[land & (frm == k) & (frm <= e)] = c
        a[~ward & land & (frm <= e)] = (a[~ward & land & (frm <= e)] * 0.6).astype(np.uint8)
        im = Image.fromarray(a[j0:j1 + 1, i0:i1 + 1]).resize(((i1 - i0 + 1) * K, (j1 - j0 + 1) * K), Image.NEAREST)
        dr = ImageDraw.Draw(im)
        for s in SITES:
            j, i = cell(s["lon"], s["lat"])
            if E[s["eras"][0]] <= e:
                x, y = (i - i0) * K + K / 2, (j - j0) * K + K / 2
                dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 40, 40) if not land[j, i] or frm[j, i] <= e else (255, 255, 0))
        dr.rectangle([0, 0, 150, 18], fill=(0, 0, 0))
        dr.text((4, 3), f"{e} {ERA_IDS[e]}", fill=(255, 255, 255))
        im.save(f"{PREVIEW}/era_{e:02d}_{ERA_IDS[e]}.png")
        tiles.append(im)
    w, hh = tiles[0].size
    cols_n = 3
    sheet = Image.new("RGB", (w * cols_n, hh * math.ceil(len(tiles) / cols_n)), (0, 0, 0))
    for n, im in enumerate(tiles):
        sheet.paste(im, ((n % cols_n) * w, (n // cols_n) * hh))
    sheet.save(f"{PREVIEW}/eras_sheet.png")


if __name__ == "__main__":
    main()
