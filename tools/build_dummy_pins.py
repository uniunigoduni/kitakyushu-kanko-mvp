"""開発時に動かす：MVP 用のダミーの小さいピンを、各時代 10 個ずつ data/dummy_pins.json に作る。

uv run --with numpy --with pillow python tools/build_dummy_pins.py
- 地図に寄ると出てくる小さいピンの見本。実在の史跡ではないので、名前に「（ダミー）」を付け、吹き出しにもそう書く。
- 置く場所は、その時代に陸で（data/coast.bin）、門司区の中の所。
  海べりのもの（浜・船着き場・倉庫など）は岸から 120 m 以内の低い所、山のもの（山城・砲台など）は標高 60〜260 m、
  ほかは標高 35 m 未満。縄文〜古墳はどこでも、飛鳥〜幕末は浦の集落・宿場の近く、明治から後は町の広がり
  （js/map/geo.js の TOWN_SEEDS・VILLAGES）の中を選びやすくする。
- その時代に出る本物の史跡のピン（現代は一押しの史跡すべて）から 250 m、ダミーどうしは 400 m 以上離す。
- 乱数の種は時代ごとに固定なので、何度動かしても同じ場所になる。史跡のピンを足したら作り直す。
時代ごとの配置図は /var/tmp/kitakyushu/dummy/ に出す。
"""
import json, math, os, re
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
PREVIEW = "/var/tmp/kitakyushu/dummy"
SEED = 20261031
SITE_GAP, DUMMY_GAP = 250.0, 400.0  # m

# 時代ごとのダミー：（名前, 置く所）。shore＝海べり、hill＝山、low＝平地
NAMES = {
    "jomon": [("貝塚", "shore"), ("竪穴住居の跡", "low"), ("土器のかけら", "low"), ("石斧の出土地", "low"), ("漁をした浜", "shore"),
              ("どんぐりの貯蔵穴", "low"), ("丸木舟の浜", "shore"), ("黒曜石の出土地", "low"), ("狩り場", "hill"), ("集落の跡", "low")],
    "yayoi": [("水田の跡", "low"), ("環濠集落", "low"), ("高床倉庫の跡", "low"), ("甕棺墓", "low"), ("銅剣の出土地", "low"),
              ("漁村", "shore"), ("製塩土器の浜", "shore"), ("石包丁の出土地", "low"), ("高地性集落", "hill"), ("木の農具の出土地", "low")],
    "kofun": [("円墳", "hill"), ("横穴墓", "hill"), ("箱式石棺", "low"), ("豪族の館", "low"), ("塩づくりの浜", "shore"),
              ("須恵器の窯", "hill"), ("海の祭り場", "shore"), ("集落の跡", "low"), ("古墳群", "hill"), ("鉄の工房", "low")],
    "asuka": [("寺の礎石", "low"), ("のろし台", "hill"), ("瓦の窯", "hill"), ("港の集落", "shore"), ("屯倉", "low"),
              ("渡し場", "shore"), ("古道", "low"), ("防人の見張り", "hill"), ("塩焼きの浜", "shore"), ("村の社", "low")],
    "nara": [("駅家", "low"), ("官道", "low"), ("渡し場", "shore"), ("塩焼きの浜", "shore"), ("郷の集落", "low"),
             ("牧", "hill"), ("寺の跡", "low"), ("瓦の出土地", "low"), ("船だまり", "shore"), ("村の社", "low")],
    "heian": [("荘園", "low"), ("村の社", "low"), ("山寺", "hill"), ("船着き場", "shore"), ("見張り台", "hill"),
              ("館の跡", "low"), ("塩浜", "shore"), ("漁村", "shore"), ("経塚", "hill"), ("古道", "low")],
    "kamakura": [("地頭の館", "low"), ("禅寺", "low"), ("村の社", "low"), ("船着き場", "shore"), ("砦", "hill"),
                 ("市", "low"), ("漁村", "shore"), ("塩浜", "shore"), ("板碑", "low"), ("渡し場", "shore")],
    "muromachi": [("山城", "hill"), ("砦", "hill"), ("寺", "low"), ("村の社", "low"), ("水軍の船だまり", "shore"),
                  ("市", "low"), ("館の跡", "low"), ("のろし台", "hill"), ("漁村", "shore"), ("宝篋印塔", "low")],
    "azuchi": [("砦", "hill"), ("陣の跡", "hill"), ("寺", "low"), ("村の社", "low"), ("船着き場", "shore"),
               ("茶屋", "low"), ("漁村", "shore"), ("街道", "low"), ("石垣の跡", "hill"), ("塩浜", "shore")],
    "edo": [("茶屋", "low"), ("船宿", "shore"), ("一里塚", "low"), ("庄屋屋敷", "low"), ("寺子屋", "low"),
            ("塩田", "shore"), ("漁村", "shore"), ("地蔵", "low"), ("石灯籠", "low"), ("段々畑", "hill")],
    "bakumatsu": [("砲台", "hill"), ("陣屋", "low"), ("見張り所", "hill"), ("船宿", "shore"), ("茶屋", "low"),
                  ("寺", "low"), ("庄屋屋敷", "low"), ("漁村", "shore"), ("台場", "shore"), ("村の社", "low")],
    "meiji": [("倉庫", "shore"), ("商社", "low"), ("旅館", "low"), ("銀行", "low"), ("小学校", "low"),
              ("郵便局", "low"), ("桟橋", "shore"), ("石炭置き場", "shore"), ("警察署", "low"), ("製材所", "low")],
    "taisho": [("商店", "low"), ("料亭", "low"), ("映画館", "low"), ("倉庫", "shore"), ("銀行", "low"),
               ("旅館", "low"), ("小学校", "low"), ("工場", "shore"), ("社宅", "low"), ("写真館", "low")],
    "showa_pre": [("カフェー", "low"), ("商店街", "low"), ("劇場", "low"), ("倉庫", "shore"), ("工場", "shore"),
                  ("社宅", "low"), ("女学校", "low"), ("病院", "low"), ("料亭", "low"), ("市場", "low")],
    "war": [("防空壕", "hill"), ("高射砲陣地", "hill"), ("監視哨", "hill"), ("軍需倉庫", "shore"), ("軍需工場", "shore"),
            ("配給所", "low"), ("国民学校", "low"), ("寺", "low"), ("神社", "low"), ("隣組の集会所", "low")],
    "postwar": [("闇市", "low"), ("バラック", "low"), ("引揚者の宿", "low"), ("新制中学校", "low"), ("市場", "low"),
                ("工場", "shore"), ("映画館", "low"), ("銭湯", "low"), ("社宅", "low"), ("進駐軍の倉庫", "shore")],
    "growth": [("団地", "low"), ("工場", "shore"), ("商店街", "low"), ("スーパー", "low"), ("中学校", "low"),
               ("公民館", "low"), ("銭湯", "low"), ("ボウリング場", "low"), ("社宅", "low"), ("港の倉庫", "shore")],
    "showa_late": [("団地", "low"), ("ショッピングセンター", "low"), ("物流倉庫", "shore"), ("公園", "low"), ("高校", "low"),
                   ("病院", "low"), ("工場", "shore"), ("フェリー乗り場", "shore"), ("運動公園", "low"), ("図書館", "low")],
    "heisei": [("コンビニ", "low"), ("公園", "low"), ("物流センター", "shore"), ("マンション", "low"), ("小学校", "low"),
               ("病院", "low"), ("展望台", "hill"), ("商業施設", "low"), ("駐車場", "low"), ("釣り公園", "shore")],
    "now": [("カフェ", "low"), ("ホテル", "low"), ("公園", "low"), ("展望所", "hill"), ("商業施設", "low"),
            ("撮影スポット", "shore"), ("観光案内所", "low"), ("ゲストハウス", "low"), ("レンタサイクル", "low"), ("海辺の遊歩道", "shore")],
}
# 吹き出しの年の行
ERA_LABEL = {"jomon": "縄文時代", "yayoi": "弥生時代", "kofun": "古墳時代", "asuka": "飛鳥時代", "nara": "奈良時代",
             "heian": "平安時代", "kamakura": "鎌倉時代", "muromachi": "室町・戦国時代", "azuchi": "安土桃山時代",
             "edo": "江戸時代", "bakumatsu": "幕末", "meiji": "明治時代", "taisho": "大正時代", "showa_pre": "昭和初期",
             "war": "戦時中", "postwar": "戦後", "growth": "高度経済成長期", "showa_late": "昭和後期", "heisei": "平成", "now": "現代"}
SUMMARY = "MVP用のダミーのピンです。実在の史跡ではありません。地図に寄ると出てくる小さいピンの見本として置いています。"

_eras_src = open(os.path.join(ROOT, "js", "eras.js"), encoding="utf-8").read()
ERAS = [(k, int(a), int(b) if re.fullmatch(r"-?\d+", b) else 2100)
        for k, a, b in re.findall(r"\{ id: '(\w+)', [^}]*?start: (-?\d+), end: ([^,]+),", _eras_src)]
assert [k for k, _, _ in ERAS] == list(NAMES), "eras.js の時代と NAMES がずれている"
_geo_src = open(os.path.join(ROOT, "js", "map", "geo.js"), encoding="utf-8").read()
_num = r"(-?[\d.]+)"
TOWNS = [dict(lat=float(a), lon=float(b), start=int(c), spread=float(d), max=float(e)) for a, b, c, d, e in re.findall(
    rf"name: '[^']+', lat: {_num}, lon: {_num}, start: {_num}, spread: {_num}, max: {_num}", _geo_src)]
VILLAGES = [dict(lat=float(a), lon=float(b), start=int(c)) for a, b, c in re.findall(
    rf"name: '[^']+', lat: {_num}, lon: {_num}, start: {_num}, r:", _geo_src)]
assert len(TOWNS) == 6 and len(VILLAGES) == 6, (len(TOWNS), len(VILLAGES))

meta = json.load(open(os.path.join(DATA, "terrain.json"), encoding="utf-8"))
nx, ny, B = meta["nx"], meta["ny"], meta["bounds"]
_buf = open(os.path.join(DATA, "terrain.bin"), "rb").read()
raw = np.frombuffer(_buf, "<i2", nx * ny).reshape(ny, nx)
ward = np.frombuffer(_buf, np.uint8, nx * ny, nx * ny * 2).reshape(ny, nx).astype(bool)
land = raw != -32768
hgt = np.where(land, np.maximum(0.6, raw / 10), 0.0)
frm = np.frombuffer(open(os.path.join(DATA, "coast.bin"), "rb").read(), np.uint8).reshape(ny, nx)
LON = B["lon0"] + np.arange(nx) / (nx - 1) * (B["lon1"] - B["lon0"])
LAT = B["lat1"] - np.arange(ny) / (ny - 1) * (B["lat1"] - B["lat0"])
c = meta["center"]
XM = (LON - c["lon"]) * meta["mPerDegLon"]          # 東へ m
ZM = -(LAT - c["lat"]) * meta["mPerDegLat"]         # 南へ m
XX, ZZ = np.meshgrid(XM, ZM)
to_m = lambda lon, lat: ((lon - c["lon"]) * meta["mPerDegLon"], -(lat - c["lat"]) * meta["mPerDegLat"])
dist = lambda lon, lat: np.hypot(XX - to_m(lon, lat)[0], ZZ - to_m(lon, lat)[1])


def grow(mask, r):
    """マスを r マスぶん太らせる（円に近い形）"""
    out = mask.copy()
    p = np.pad(mask, r)
    for dj in range(-r, r + 1):
        for di in range(-r, r + 1):
            if di * di + dj * dj <= r * r + r:
                out |= p[r + dj: r + dj + ny, r + di: r + di + nx]
    return out


SITES = json.load(open(os.path.join(DATA, "sites.json"), encoding="utf-8"))["sites"]
town_d = [dist(t["lon"], t["lat"]) for t in TOWNS]
vil_d = [dist(v["lon"], v["lat"]) for v in VILLAGES]
out, report = [], []
for ei, (era, t0, t1) in enumerate(ERAS):
    land_e = land & (frm <= ei)  # 0＝元からの陸、k＝k 番目の時代から陸、255＝海
    inner = ~grow(~land_e, 1)    # 岸のぎりぎりは避ける
    near_sea = grow(~land_e, 2) & land_e
    base = inner & ward
    # 本物のピンのまわりは空ける（現代は、一押しの史跡が全部出る）
    real = [s for s in SITES if era in s["eras"] or (era == "now" and s.get("pick"))]
    for s in real:
        base &= dist(s["lon"], s["lat"]) >= SITE_GAP
    # その時代に人が集まっていた所への近さ
    town = np.zeros_like(base)
    for t, d in zip(TOWNS, town_d):
        if t["start"] <= t1:
            town |= d <= min(t["max"], max(0.0, (t1 - t["start"]) * t["spread"]))
    anchors = [d for v, d in zip(VILLAGES, vil_d) if v["start"] <= t1] + [d for t, d in zip(TOWNS, town_d) if t["start"] <= t1]
    d_anchor = np.min(anchors, axis=0) if anchors else np.full(base.shape, np.inf)
    early = t1 <= 592
    near = np.ones(base.shape) if early else np.where(town, 1.0, np.exp(-d_anchor / 600) + 0.03)
    near_hill = np.ones(base.shape) if early else np.exp(-d_anchor / 1500) + 0.05
    kinds = {
        "shore": base & near_sea & (hgt < 12),
        "hill": base & (hgt >= 60) & (hgt <= 260),
        "low": base & ~near_sea & (hgt < 35),
    }
    rng = np.random.default_rng(SEED + ei)
    taken = np.zeros_like(base)
    year = round((t0 + min(t1, 2027)) / 2)
    for n, (name, kind) in enumerate(NAMES[era]):
        w = np.where(kinds[kind] & ~taken, near_hill if kind == "hill" else near, 0.0).ravel()
        if w.sum() == 0:
            w = np.where(kinds["low"] & ~taken, near, 0.0).ravel()
        if w.sum() == 0:
            report.append(f"{era}: {name} を置ける所がない")
            continue
        k = rng.choice(w.size, p=w / w.sum())
        j, i = divmod(k, nx)
        lon, lat = float(LON[i]), float(LAT[j])
        taken |= dist(lon, lat) < DUMMY_GAP
        out.append({
            "id": f"dummy_{era}_{n + 1:02d}", "name": f"{name}（ダミー）", "year": year, "yearLabel": ERA_LABEL[era],
            "eras": [era], "lat": round(lat, 5), "lon": round(lon, 5), "level": 1, "dummy": True, "summary": SUMMARY,
            "_kind": kind, "_h": round(float(hgt[j, i]), 1),
        })

# 確かめる：その時代に陸か・門司区の中か・本物のピンとダミーどうしの間
bad = 0
for s in out:
    ei = [k for k, _, _ in ERAS].index(s["eras"][0])
    x, z = to_m(s["lon"], s["lat"])
    j, i = int(np.argmin(np.abs(LAT - s["lat"]))), int(np.argmin(np.abs(LON - s["lon"])))
    ok_land = land[j, i] and frm[j, i] <= ei and ward[j, i]
    near_real = min((math.hypot(x - to_m(r["lon"], r["lat"])[0], z - to_m(r["lon"], r["lat"])[1])
                     for r in SITES if s["eras"][0] in r["eras"] or (s["eras"][0] == "now" and r.get("pick"))), default=1e9)
    near_dummy = min((math.hypot(x - to_m(o["lon"], o["lat"])[0], z - to_m(o["lon"], o["lat"])[1])
                      for o in out if o is not s and o["eras"] == s["eras"]), default=1e9)
    if not ok_land or near_real < SITE_GAP - 1 or near_dummy < DUMMY_GAP - 1:
        bad += 1
        report.append(f"NG {s['id']} land={ok_land} real={near_real:.0f}m dummy={near_dummy:.0f}m")

by_era = {}
for s in out:
    by_era.setdefault(s["eras"][0], []).append(f"{s['name'].replace('（ダミー）', '')}[{s['_kind']} {s['_h']}m]")
for era, names in by_era.items():
    print(f"{era:10s} {len(names):2d}  " + " ".join(names))
for r in report:
    print(r)
print("OK" if not bad else f"NG {bad}")

for s in out:
    del s["_kind"], s["_h"]
json.dump({
    "note": "MVP 用のダミーの小さいピン（実在の史跡ではない）。tools/build_dummy_pins.py で作る",
    "sites": out,
}, open(os.path.join(DATA, "dummy_pins.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"data/dummy_pins.json {len(out)} 個")

# 時代ごとの配置図（確かめる用）
try:
    from PIL import Image, ImageDraw
    os.makedirs(PREVIEW, exist_ok=True)
    for ei, (era, _, _) in enumerate(ERAS):
        land_e = land & (frm <= ei)
        img = np.zeros((ny, nx, 3), np.uint8)
        img[...] = (20, 40, 70)
        img[land_e] = (90, 90, 80)
        img[land_e & ward] = (130, 125, 105)
        im = Image.fromarray(img).resize((nx * 3, ny * 3), Image.NEAREST)
        dr = ImageDraw.Draw(im)
        px = lambda lon, lat: ((lon - B["lon0"]) / (B["lon1"] - B["lon0"]) * (nx - 1) * 3, (B["lat1"] - lat) / (B["lat1"] - B["lat0"]) * (ny - 1) * 3)
        for s in SITES:
            if era in s["eras"] or (era == "now" and s.get("pick")):
                x, y = px(s["lon"], s["lat"]); dr.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(242, 179, 61))
        for s in out:
            if s["eras"][0] == era:
                x, y = px(s["lon"], s["lat"]); dr.ellipse((x - 4, y - 4, x + 4, y + 4), outline=(255, 255, 255), width=2)
        im.crop((nx * 3 * 0.25, ny * 3 * 0.05, nx * 3 * 0.85, ny * 3 * 0.85)).save(os.path.join(PREVIEW, f"{ei:02d}_{era}.png"))
except ImportError:
    pass
