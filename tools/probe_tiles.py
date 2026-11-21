# 開発時に動かす：地理院タイルの年代別の空中写真が、門司のあたりにあるかを確かめる（1 枚ずつ・間をあけて取る。保存はしない）
#   python3 -I tools/probe_tiles.py [ズーム（書かなければ 15）] [レイヤー名をコンマで区切って（書かなければ全部）]
# 出力は 1 行に 1 レイヤー。地点ごとに、あれば大きさ（k）、無ければ -404 のように HTTP の番号。
# 2026-11-22 の結果は PROGRESS.md の「海岸線を史実に寄せるための材料」
import math
import sys
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "tile-coverage-check/0.1"}
BASE = "https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.{ext}"
LAYERS = [
    ("ort_USA10", "png"), ("ort_old10", "png"), ("gazo1", "jpg"), ("gazo2", "jpg"), ("gazo3", "jpg"), ("gazo4", "jpg"),
    ("airphoto", "png"), ("nendophoto2007", "png"), ("nendophoto2008", "png"), ("nendophoto2009", "png"), ("nendophoto2010", "png"),
    ("nendophoto2011", "png"), ("nendophoto2012", "png"), ("nendophoto2013", "png"), ("nendophoto2014", "png"), ("nendophoto2015", "png"),
    ("nendophoto2016", "png"), ("nendophoto2017", "png"), ("nendophoto2018", "png"), ("nendophoto2019", "png"), ("nendophoto2020", "png"),
    ("ort", "jpg"), ("seamlessphoto", "jpg"),
]
POINTS = [
    ("mojiko", 130.9617, 33.9452), ("dairi", 130.9320, 33.9070), ("tanoura", 130.9830, 33.9620), ("tachinoura", 131.0030, 33.9650),
    ("shinmoji", 130.9950, 33.8620), ("airport", 131.0350, 33.8460), ("kokura", 130.8850, 33.8930), ("hikoshima", 130.9050, 33.9350),
]


def tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def main():
    z = int(sys.argv[1]) if len(sys.argv) > 1 else 15
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    for layer, ext in LAYERS:
        if only and layer not in only:
            continue
        row = []
        for name, lon, lat in POINTS:
            x, y = tile(lon, lat, z)
            req = urllib.request.Request(BASE.format(layer=layer, z=z, x=x, y=y, ext=ext), headers=UA)
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    row.append(f"{name}={len(r.read()) // 1024}k")
            except urllib.error.HTTPError as e:
                row.append(f"{name}=-{e.code}")
            except Exception as e:  # noqa: BLE001
                row.append(f"{name}=ERR:{type(e).__name__}")
            time.sleep(0.2)
        print(f"{layer} z{z}  " + " ".join(row), flush=True)
    print("DONE")


main()
