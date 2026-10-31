"""AR用の360度画像を作る（開発時に1回だけ実行）。

生成画像（16:9）を円筒の内側に巻くため、右端を左端に重ねてつなぎ目を消し、JPEGにする。
ポップアップの「ARで探検」ボタン用に、見どころを切り出した小さな画像も作る。

使い方: uv run -q --with pillow --with numpy python tools/build_pano.py [生成画像のフォルダ]
"""
import pathlib
import sys

import numpy as np
from PIL import Image

RAW = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/var/tmp/kitakyushu/pano/raw")
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "pano"
BLEND = 0.10  # 端を重ねる幅（横幅に対する割合）

# 生成画像に入った意味のない文字を、すぐ横の壁で塗りつぶす: ((x0, y0, x1, y1), 写す元の左端x, 写す元の幅)
PATCHES = {
    "mojiko_retro": [((2330, 687, 2394, 702), 2397, 32)],
}
# サムネイルの中心（横・縦の割合）
THUMB = {
    "dannoura": (0.50, 0.40), "moji_castle": (0.38, 0.45), "moji_station": (0.51, 0.43),
    "moji_port_war": (0.468, 0.55), "kanmon_bridge": (0.504, 0.47), "mojiko_retro": (0.55, 0.47),
}
# 巌流島の「同じ画角」の場面は、どの時代も同じ切り抜き（海峡の真ん中）にして、景色の移り変わりを見せる
THUMB.update({f"ganryu_{k}": (0.56, 0.47) for k in (
    "dannoura", "duel", "kitamae", "meiji", "taisho", "warship", "tunnel", "bridge", "now")})


def patch(a, rects):
    for (x0, y0, x1, y1), sx, sw in rects:
        src = a[y0:y1, sx:sx + sw].copy()
        for x in range(x0, x1, sw):
            w = min(sw, x1 - x)
            a[y0:y1, x:x + w] = src[:, :w]
    return a


def box(a, r, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis)
    n = a.shape[axis]
    return (np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(c, range(n), axis=axis)) / (2 * r + 1)


def blur(a, r):
    for _ in range(3):
        a = box(box(a, r, 0), r, 1)
    return a


def seamless(a):
    """右端 B を左端 A に重ねる。色の流れ（ぼかした成分）は重なり全体でゆっくり混ぜ、
    細部は A と B がいちばん似ている縦の道で切り替える（二重写りも段差も出さない）。"""
    h, w, _ = a.shape
    b = int(w * BLEND)
    low = blur(a, 24)
    A, B = a[:, :b], a[:, w - b:]
    LA, LB = low[:, :b], low[:, w - b:]
    HA, HB = A - LA, B - LB
    e = ((HA - HB) ** 2).sum(axis=2) + 0.3 * ((A - B) ** 2).sum(axis=2)
    e = (e + np.roll(e, 1, 0) + np.roll(e, -1, 0)) / 3
    margin, feather = 24, 14
    cost = np.full_like(e, np.inf)
    cost[0, margin:b - margin] = e[0, margin:b - margin]
    back = np.zeros(e.shape, dtype=np.int64)
    for y in range(1, h):
        prev = cost[y - 1]
        cand = np.stack([np.roll(prev, 1), prev, np.roll(prev, -1)])
        cand[0, 0] = cand[2, -1] = np.inf
        back[y] = np.arange(b) + cand.argmin(axis=0) - 1
        cost[y] = e[y] + cand.min(axis=0)
        cost[y, :margin] = cost[y, b - margin:] = np.inf
    path = np.zeros(h, dtype=np.int64)
    path[-1] = int(cost[-1].argmin())
    for y in range(h - 1, 0, -1):
        path[y - 1] = back[y, path[y]]
    t = np.clip((np.arange(b)[None, :] - path[:, None]) / feather + 0.5, 0, 1)
    m = (t * t * (3 - 2 * t))[..., None]
    k = np.linspace(0, 1, b)[None, :, None]
    k = k * k * (3 - 2 * k)
    out = a[:, : w - b].copy()
    out[:, :b] = LB * (1 - k) + LA * k + HB * (1 - m) + HA * m
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for src in sorted(RAW.glob("*.png")):
        pid = src.stem
        a = np.asarray(Image.open(src).convert("RGB"), dtype=np.float64) / 255
        a = patch(a, PATCHES.get(pid, []))
        h, w, _ = a.shape
        img = Image.fromarray((seamless(a) * 255 + 0.5).clip(0, 255).astype(np.uint8))
        img.save(OUT / f"{pid}.jpg", quality=82, optimize=True, progressive=True)

        full = Image.fromarray((a * 255 + 0.5).clip(0, 255).astype(np.uint8))
        tw = int(w * 0.5)
        th = int(tw / 2.2)
        fx, fy = THUMB.get(pid, (0.5, 0.45))
        x0 = min(max(int(w * fx) - tw // 2, 0), w - tw)
        y0 = min(max(int(h * fy) - th // 2, 0), h - th)
        full.crop((x0, y0, x0 + tw, y0 + th)).resize((704, 320), Image.LANCZOS).save(
            OUT / f"{pid}_thumb.jpg", quality=80, optimize=True, progressive=True)
        print(pid, img.size, f"{(OUT / f'{pid}.jpg').stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
