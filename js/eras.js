// 時代の区切り・スライダー上の位置・見た目（差し色・書体）を一か所にまとめる。
// 差し色は color-palettes のパレットから選んだ色。地図には時代ごとの色やフィルターをかけない。

export const NOW_YEAR = new Date().getFullYear();

export const PALETTES = {
  '086': { name: 'テラコッタ暮色', accent: '#C9826B' },
  '081': { name: 'クラシックトリコ', accent: '#C7655A' },
  '076': { name: '墨と生成り', accent: '#DAD1BF' },
  '098': { name: 'セピアポストカード', accent: '#D6C29A' },
  '082': { name: 'オリーブレザー', accent: '#C9BE94' },
  '095': { name: 'オールドデニム', accent: '#B08A6A' },
  '043': { name: '港のブルーグレー', accent: '#A8BEC7' },
};

// w = スライダー上の長さの重み、pal = 差し色のパレット、font = 題字の書体、flavor = マップ外に出す時代の絵
export const ERAS = [
  { id: 'jomon', name: '縄文', start: -14000, end: -900, w: 0.9, pal: '086', font: 'brush' },
  { id: 'yayoi', name: '弥生', start: -900, end: 250, w: 0.7, pal: '086', font: 'brush' },
  { id: 'kofun', name: '古墳', start: 250, end: 592, w: 0.7, pal: '086', font: 'brush' },
  { id: 'asuka', name: '飛鳥', start: 592, end: 710, w: 0.6, pal: '081', font: 'brush' },
  { id: 'nara', name: '奈良', start: 710, end: 794, w: 0.6, pal: '081', font: 'brush' },
  { id: 'heian', name: '平安', start: 794, end: 1185, w: 1.1, pal: '081', font: 'brush', flavor: 'clouds' },
  { id: 'kamakura', name: '鎌倉', start: 1185, end: 1333, w: 0.8, pal: '076', font: 'brush', flavor: 'clouds' },
  { id: 'muromachi', name: '室町・戦国', short: '室町', start: 1333, end: 1573, w: 0.9, pal: '076', font: 'brush', flavor: 'clouds' },
  { id: 'azuchi', name: '安土桃山', start: 1573, end: 1603, w: 0.55, pal: '076', font: 'brush', flavor: 'clouds' },
  { id: 'edo', name: '江戸', start: 1603, end: 1853, w: 1.0, pal: '076', font: 'brush', flavor: 'clouds' },
  { id: 'bakumatsu', name: '幕末', start: 1853, end: 1868, w: 0.75, pal: '076', font: 'brush', flavor: 'portraits' },
  { id: 'meiji', name: '明治', start: 1868, end: 1912, w: 1.1, pal: '098', font: 'brush', flavor: 'portraits' },
  { id: 'taisho', name: '大正', start: 1912, end: 1926, w: 1.0, pal: '098', font: 'mincho', flavor: 'locomotive' },
  { id: 'showa_pre', name: '昭和初期', start: 1926, end: 1937, w: 0.7, pal: '098', font: 'mincho', flavor: 'locomotive' },
  { id: 'war', name: '戦時中', start: 1937, end: 1945, w: 1.0, pal: '082', font: 'mincho', flavor: 'warships' },
  { id: 'postwar', name: '戦後', start: 1945, end: 1955, w: 0.6, pal: '082', font: 'mincho' },
  { id: 'growth', name: '高度経済成長期', short: '高度成長', start: 1955, end: 1973, w: 1.0, pal: '095', font: 'mincho', flavor: 'chimneys' },
  { id: 'showa_late', name: '昭和後期', start: 1973, end: 1989, w: 0.65, pal: '095', font: 'mincho', flavor: 'chimneys' },
  { id: 'heisei', name: '平成', start: 1989, end: 2019, w: 0.85, pal: '043', font: 'mincho' },
  { id: 'now', name: '現代', start: 2019, end: NOW_YEAR + 1, w: 0.8, pal: '043', font: 'gothic' },
];

const TOTAL_W = ERAS.reduce((s, e) => s + e.w, 0);
let acc = 0;
for (const e of ERAS) { e.t0 = acc / TOTAL_W; acc += e.w; e.t1 = acc / TOTAL_W; e.tc = (e.t0 + e.t1) / 2; }
export const ERA_BY_ID = Object.fromEntries(ERAS.map((e) => [e.id, e]));

export function eraIndexAtT(t) {
  for (let i = 0; i < ERAS.length; i++) if (t < ERAS[i].t1) return i;
  return ERAS.length - 1;
}
export function eraAtYear(y) {
  for (const e of ERAS) if (y < e.end) return e;
  return ERAS[ERAS.length - 1];
}
export function yearToT(y) {
  const e = eraAtYear(Math.max(y, ERAS[0].start));
  const f = Math.min(1, Math.max(0, (y - e.start) / (e.end - e.start)));
  return e.t0 + f * (e.t1 - e.t0);
}
export function tToYear(t) {
  const e = ERAS[eraIndexAtT(Math.min(Math.max(t, 0), 0.99999))];
  const f = (t - e.t0) / (e.t1 - e.t0);
  return e.start + f * (e.end - e.start);
}

// 表示用の年。古い時代ほど丸める。
export function formatYear(y) {
  const r = y < -300 ? Math.round(y / 100) * 100 : y < 600 ? Math.round(y / 10) * 10 : Math.floor(y);
  return r < 0 ? `前${-r}` : `${r}`;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);

const ACCENTS = ERAS.map((e) => hex(PALETTES[e.pal].accent));

// 位置 t の差し色。時代の中心どうしの間でなめらかに混ぜる（色は連続、ピンは区切りで入れ替え）。
export function accentAtT(t) {
  let i = 0;
  while (i < ERAS.length - 1 && t > ERAS[i + 1].tc) i++;
  if (t <= ERAS[0].tc) return ACCENTS[0];
  if (i >= ERAS.length - 1) return ACCENTS[ERAS.length - 1];
  // 境目の前後 35% ずつだけで混ぜ、時代の中ほどはその時代の差し色のまま
  const raw = (t - ERAS[i].tc) / (ERAS[i + 1].tc - ERAS[i].tc);
  const k = smooth(Math.min(1, Math.max(0, (raw - 0.15) / 0.7)));
  return ACCENTS[i].map((v, j) => lerp(v, ACCENTS[i + 1][j], k));
}

export const toCss = (rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(' ')})`;
