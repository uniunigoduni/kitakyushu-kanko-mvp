"""開発時に一度だけ動かす：タイトル用の書体を、使う文字だけに絞って assets/fonts/ に置く。

python3 tools/fetch_fonts.py
Google Fonts の css2 API の text= で文字を絞った woff2 を取り、OFL.txt も一緒に置く（OFL は同梱して配布してよい）。
"""
import os, re, urllib.parse, urllib.request

TITLE = "門司ヒストリーマップ"
ERAS = "縄文 弥生 古墳 飛鳥 奈良 平安 鎌倉 室町・戦国 安土桃山 江戸 幕末 明治 大正 昭和初期 戦時中 戦後 高度経済成長期 昭和後期 平成 現代 時代"
DIGITS = "0123456789年前後頃世紀〜–-., BCE"
FONTS = [  # (保存名, family 指定, 文字, ofl ディレクトリ)
    ("yuji-syuku", "Yuji+Syuku", TITLE + ERAS, "yujisyuku"),
    ("shippori-mincho-600", "Shippori+Mincho:wght@600", TITLE + ERAS, "shipporimincho"),
    ("noto-sans-jp-700", "Noto+Sans+JP:wght@700", TITLE + ERAS, "notosansjp"),
    ("noto-sans-mono-500", "Noto+Sans+Mono:wght@500", DIGITS, "notosansmono"),
]
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"}
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "fonts")

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()

os.makedirs(OUT, exist_ok=True)
for name, fam, text, ofl in FONTS:
    chars = "".join(sorted(set(text.replace(" ", "")))) + " "
    css = fetch(f"https://fonts.googleapis.com/css2?family={fam}&text={urllib.parse.quote(chars)}").decode()
    url = re.search(r"url\((https://[^)]+)\)", css).group(1)
    data = fetch(url)
    open(os.path.join(OUT, name + ".woff2"), "wb").write(data)
    lic = fetch(f"https://raw.githubusercontent.com/google/fonts/main/ofl/{ofl}/OFL.txt")
    open(os.path.join(OUT, f"OFL-{ofl}.txt"), "wb").write(lic)
    print(f"{name}: {len(data)/1024:.1f}KB, {len(chars)} chars")
