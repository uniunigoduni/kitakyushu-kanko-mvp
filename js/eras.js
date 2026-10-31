// 時代の区切り・スライダー上の位置・見た目（色・質感・書体）を一か所にまとめる。
// 色は color-palettes の登録HEX（1=いちばん明るい面 … 5=墨）。差し色は残り3色で彩度がいちばん高い色。

export const NOW_YEAR = new Date().getFullYear();

export const PALETTES = {
  '086': { name: 'テラコッタ暮色', c: ['#F5E8D5', '#DBC19E', '#C18B68', '#A45D4D', '#66504B'], accent: '#C9826B', sea: '#66504B', bg: '#2a2220' },
  '081': { name: 'クラシックトリコ', c: ['#F3EBDD', '#CFC2AC', '#B4594F', '#526A82', '#263A54'], accent: '#C7655A', sea: '#526A82', bg: '#18202d' },
  '076': { name: '墨と生成り', c: ['#F5F0E4', '#DAD1BF', '#A8A295', '#686A65', '#292F31'], accent: '#DAD1BF', sea: '#686A65', bg: '#1b1f20' },
  '098': { name: 'セピアポストカード', c: ['#F2E7CD', '#D6C29A', '#B49A72', '#897050', '#514537'], accent: '#D6C29A', sea: '#897050', bg: '#2a241d' },
  'mono': { name: 'ニュース映画', c: ['#efe7d6', '#c9c1b1', '#8f897d', '#4f4b44', '#17140f'], accent: '#f3eee4', sea: '#4f4b44', bg: '#17140f' },
  '082': { name: 'オリーブレザー', c: ['#EBE3CF', '#C9BE94', '#939269', '#8E654A', '#4B4E3D'], accent: '#C9BE94', sea: '#4B4E3D', bg: '#1d1f16' },
  '095': { name: 'オールドデニム', c: ['#EDE7DB', '#C0C5C3', '#8298A5', '#526F84', '#9B7658'], accent: '#B08A6A', sea: '#526F84', bg: '#212a33' },
  '043': { name: '港のブルーグレー', c: ['#F5F4EE', '#D8DEE0', '#A8BEC7', '#718F9E', '#3A5568'], accent: '#A8BEC7', sea: '#3A5568', bg: '#1a2630' },
};

// w = スライダー上の長さの重み。print = 浮世絵・絵巻の版画らしさ、mono = ニュース映画の白黒、dark = 戦時の暗さ
// tint = 時代パレットへ寄せる量、sat = 彩度、flavor = マップ外に出す時代の絵
export const ERAS = [
  { id: 'jomon', name: '縄文', start: -14000, end: -900, w: 0.9, pal: '086', font: 'brush', tint: 0.5, print: 0.45, sat: 0.8 },
  { id: 'yayoi', name: '弥生', start: -900, end: 250, w: 0.7, pal: '086', font: 'brush', tint: 0.5, print: 0.5, sat: 0.8 },
  { id: 'kofun', name: '古墳', start: 250, end: 592, w: 0.7, pal: '086', font: 'brush', tint: 0.5, print: 0.55, sat: 0.8 },
  { id: 'asuka', name: '飛鳥', start: 592, end: 710, w: 0.6, pal: '081', font: 'brush', tint: 0.48, print: 0.75, sat: 0.85 },
  { id: 'nara', name: '奈良', start: 710, end: 794, w: 0.6, pal: '081', font: 'brush', tint: 0.48, print: 0.8, sat: 0.85 },
  { id: 'heian', name: '平安', start: 794, end: 1185, w: 1.1, pal: '081', font: 'brush', tint: 0.48, print: 0.9, sat: 0.9, flavor: 'clouds' },
  { id: 'kamakura', name: '鎌倉', start: 1185, end: 1333, w: 0.8, pal: '076', font: 'brush', tint: 0.45, print: 0.9, sat: 0.85, flavor: 'clouds' },
  { id: 'muromachi', name: '室町・戦国', short: '室町', start: 1333, end: 1573, w: 0.9, pal: '076', font: 'brush', tint: 0.45, print: 0.92, sat: 0.85, flavor: 'clouds' },
  { id: 'azuchi', name: '安土桃山', start: 1573, end: 1603, w: 0.55, pal: '076', font: 'brush', tint: 0.45, print: 0.95, sat: 0.9, flavor: 'clouds' },
  { id: 'edo', name: '江戸', start: 1603, end: 1853, w: 1.0, pal: '076', font: 'brush', tint: 0.42, print: 1.0, sat: 0.95, flavor: 'clouds' },
  { id: 'bakumatsu', name: '幕末', start: 1853, end: 1868, w: 0.75, pal: '076', font: 'brush', tint: 0.45, print: 0.5, sat: 0.8, flavor: 'portraits' },
  { id: 'meiji', name: '明治', start: 1868, end: 1912, w: 1.1, pal: '098', font: 'brush', tint: 0.55, print: 0.0, sat: 0.7, flavor: 'portraits' },
  { id: 'taisho', name: '大正', start: 1912, end: 1926, w: 1.0, pal: 'mono', font: 'mincho', tint: 0, mono: 1, sat: 0, flavor: 'locomotive' },
  { id: 'showa_pre', name: '昭和初期', start: 1926, end: 1937, w: 0.7, pal: 'mono', font: 'mincho', tint: 0, mono: 1, sat: 0, flavor: 'locomotive' },
  { id: 'war', name: '戦時中', start: 1937, end: 1945, w: 1.0, pal: '082', font: 'mincho', tint: 0.5, dark: 1, sat: 0.45, flavor: 'warships' },
  { id: 'postwar', name: '戦後', start: 1945, end: 1955, w: 0.6, pal: '082', font: 'mincho', tint: 0.42, dark: 0.25, sat: 0.6 },
  { id: 'growth', name: '高度経済成長期', short: '高度成長', start: 1955, end: 1973, w: 1.0, pal: '095', font: 'mincho', tint: 0.4, sat: 0.8, flavor: 'chimneys' },
  { id: 'showa_late', name: '昭和後期', start: 1973, end: 1989, w: 0.65, pal: '095', font: 'mincho', tint: 0.32, sat: 0.88, flavor: 'chimneys' },
  { id: 'heisei', name: '平成', start: 1989, end: 2019, w: 0.85, pal: '043', font: 'mincho', tint: 0.26, sat: 0.95 },
  { id: 'now', name: '現代', start: 2019, end: NOW_YEAR + 1, w: 0.8, pal: '043', font: 'gothic', tint: 0.2, sat: 1.0 },
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

function eraLook(e) {
  const p = PALETTES[e.pal];
  return {
    pal: p.c.map(hex), accent: hex(p.accent), sea: hex(p.sea), bg: hex(p.bg),
    tint: e.tint ?? 0.4, print: e.print ?? 0, mono: e.mono ?? 0, dark: e.dark ?? 0, sat: e.sat ?? 1,
  };
}
const LOOKS = ERAS.map(eraLook);

// 位置 t の見た目。時代の中心どうしの間でなめらかに混ぜる（色は連続、ピンは区切りで入れ替え）。
export function lookAtT(t) {
  let i = 0;
  while (i < ERAS.length - 1 && t > ERAS[i + 1].tc) i++;
  if (t <= ERAS[0].tc) return { ...LOOKS[0], k: 0, i0: 0, i1: 0 };
  if (i >= ERAS.length - 1) return { ...LOOKS[ERAS.length - 1], k: 0, i0: i, i1: i };
  const a = LOOKS[i], b = LOOKS[i + 1];
  // 境目の前後 35% ずつだけで混ぜ、時代の中ほどはその時代の見た目のまま
  const raw = (t - ERAS[i].tc) / (ERAS[i + 1].tc - ERAS[i].tc);
  const k = smooth(Math.min(1, Math.max(0, (raw - 0.15) / 0.7)));
  const mix3 = (x, y) => x.map((v, j) => lerp(v, y[j], k));
  return {
    pal: a.pal.map((c, j) => mix3(c, b.pal[j])), accent: mix3(a.accent, b.accent), sea: mix3(a.sea, b.sea), bg: mix3(a.bg, b.bg),
    tint: lerp(a.tint, b.tint, k), print: lerp(a.print, b.print, k), mono: lerp(a.mono, b.mono, k),
    dark: lerp(a.dark, b.dark, k), sat: lerp(a.sat, b.sat, k), k, i0: i, i1: i + 1,
  };
}

export const toCss = (rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(' ')})`;
