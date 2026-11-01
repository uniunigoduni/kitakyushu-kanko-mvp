"""開発時に一度だけ動かす：公開しているページ（GitHub Pages）の URL の QR コードを assets/qr_pages.svg に作る。

uv run -q --with segno python -I tools/build_qr.py
- 右上の「共有」で大きく出す。白地に黒の四角だけで描き、まわりに 4 マスの余白を付ける（読み取りの決まり）。
- 大きく引き伸ばしてもマスの境目に細い筋が出ないよう、横に続く黒いマスを 1 つの四角にまとめ、crispEdges で描く。
- 誤り訂正は M（約 15%）。画面に映したものを読むので、マスが大きくなる低い型を優先する。
"""
import os

import segno

URL = "https://uniunigoduni.github.io/kitakyushu-kanko-mvp/"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "assets", "qr_pages.svg")
QUIET = 4  # まわりの余白（マス）


def main():
    qr = segno.make(URL, error="m", micro=False)
    rows = [list(r) for r in qr.matrix]
    n = len(rows)
    size = n + 2 * QUIET
    d = []
    for y, row in enumerate(rows):
        x = 0
        while x < n:
            if not row[x]:
                x += 1
                continue
            x0 = x
            while x < n and row[x]:
                x += 1
            d.append(f"M{x0 + QUIET} {y + QUIET}h{x - x0}v1h{x0 - x}z")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges">'
        f'<title>{URL}</title>'
        f'<rect width="{size}" height="{size}" fill="#fff"/>'
        f'<path fill="#000" d="{"".join(d)}"/></svg>\n'
    )
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(svg)
    print(OUT, f"version {qr.version}-{qr.error}", f"{n}x{n} modules", os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
