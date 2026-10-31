// 地図の上のピン型の広告（Google マップの広告のピンのような、見た目だけのデモ。三日目の追記）。
// お店はすべて架空で、経路・電話・サイトなどのボタンは「デモのため…」と出すだけ。
// ad_preview は、お店として登録した人にだけ出す自分の広告の見本（店名と業種は登録した内容に置きかえる）
import { h, svg } from '../util.js';
import { toast } from './toast.js';

// アイコンの線（24 の枠、線の太さ 2、角は丸く、塗りなし）
const PATHS = {
  food: ['M6 3v5a2 2 0 0 0 4 0V3', 'M8 3v5', 'M8 10v11', 'M16 3c-1.7 0-3 2-3 4.5S14.3 12 16 12s3-2 3-4.5S17.7 3 16 3z', 'M16 12v9'],
  cafe: ['M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16', 'M8.5 3.5V6', 'M12.5 3.5V6'],
  bag: ['M5 8h14l-1 12H6z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  camera: ['M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.5-2.5h7L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z', 'M8.5 13a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0'],
  bed: ['M3 5v14', 'M3 15h18v4', 'M21 15v-3a2 2 0 0 0-2-2h-8v5', 'M5.2 11.5a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0'],
  store: ['M4 4h16l1.5 5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0z', 'M4.5 11.5V20h15v-8.5', 'M10 20v-5h4v5'],
  softserve: ['M7.5 12a2.5 2.5 0 0 1 .5-4.9A4 4 0 0 1 12 3a4 4 0 0 1 4 4.1 2.5 2.5 0 0 1 .5 4.9z', 'M8.5 12 12 21l3.5-9'],
  route: ['M5 19v-6a3 3 0 0 1 3-3h10', 'M14 6l4 4-4 4'],
  phone: ['M7 3.5h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 5 5.5a2 2 0 0 1 2-2z'],
  globe: ['M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0', 'M3.5 12h17', 'M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17z'],
  bookmark: ['M7 3.5h10v17l-5-3.5-5 3.5z'],
};
// 業種のアイコン（account.js の業種の選択肢と同じ名前）
export const KIND_ICON = { 飲食店: 'food', 'カフェ・甘味': 'cafe', 'おみやげ・物販': 'bag', '体験・レンタル': 'camera', 宿泊: 'bed', そのほか: 'store' };
export const iconOf = (s) => s.icon ?? KIND_ICON[s.kind] ?? 'store';

export function adIcon(key) {
  const el = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  for (const d of PATHS[key] ?? PATHS.store) el.append(svg('path', { d }));
  return el;
}

// 門司港駅から徒歩何分か（まっすぐの距離の 1.3 倍を、分速 80m で）。駅から遠いお店は、データの access（近くの名所から）を使う
function walk(app, s) {
  if (s.access) return s.access;
  const st = app.byId.get('moji_station');
  if (!st) return '';
  const m = Math.hypot((s.lon - st.lon) * 111320 * Math.cos((st.lat * Math.PI) / 180), (s.lat - st.lat) * 110574);
  return `門司港駅から徒歩${Math.max(1, Math.ceil((m * 1.3) / 80))}分`;
}

// 保存したお店（ページを開いている間だけ覚えておく）
const saved = new Set();

const act = (icon, label, onclick, extra = {}) =>
  h('button', { class: 'ad-act', type: 'button', onclick, ...extra }, adIcon(icon), h('span', { text: label }));

// 吹き出しの中身。body は流す部分、foot は下の帯に並べるもの
export function adCard(app, s) {
  const own = !!s.preview;
  const saveBtn = act('bookmark', '保存', (e) => {
    const on = !saved.has(s.id);
    if (on) saved.add(s.id); else saved.delete(s.id);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    toast(on ? '保存しました（デモ）' : '保存をやめました（デモ）');
  }, { 'aria-pressed': String(saved.has(s.id)) });
  const row = (dt, dd) => [h('dt', { text: dt }), h('dd', { class: dd ? null : 'is-empty', text: dd ?? `ここに、${dt === '特典' ? '来た人への特典' : dt}が入ります` })];
  const body = h('div', { class: 'ad-card' },
    h('div', { class: 'ad-head' },
      h('span', { class: 'ad-tile' }, adIcon(iconOf(s))),
      h('div', { class: 'ad-title' },
        h('h2', { class: 'ad-name', id: 'popup-name', text: s.name }),
        // 業種と行き方は、それぞれ途中で折り返さない（狭い画面では「 · 」のところで次の行へ）
        h('p', { class: 'ad-meta' }, h('span', { class: 'ad-tag', text: '広告' }), [s.kind, walk(app, s)].filter(Boolean).flatMap((t, i) => [i ? ' · ' : null, h('span', { class: 'ad-meta-part', text: t })])))),
    h('div', { class: 'ad-actions' },
      act('route', '経路', () => toast('デモのため、道順は出せません'), { class: 'ad-act is-main' }),
      act('phone', '電話', () => toast('デモのため、電話はかけられません')),
      act('globe', 'サイト', () => toast('デモのため、お店のサイトはありません')),
      saveBtn),
    h('p', { class: own ? 'ad-pitch is-empty' : 'ad-pitch', text: own ? 'ここに、お店の紹介文が入ります。' : s.pitch }),
    h('dl', { class: 'ad-rows' }, ...row('特典', own ? null : s.offer), ...row('営業時間', own ? null : s.hours)));

  // 下の帯：自分の広告の見本は「掲載前の見本です」と申し込みのボタン。ほかのお店は「架空のお店です」と、広告を出したい人への入口
  if (own) return { body, foot: [h('p', { class: 'ad-note', text: '掲載前の見本です' }), h('button', { class: 'ad-shop is-main', type: 'button', onclick: () => toast('デモのため、申し込みはできません'), text: '掲載を申し込む' })] };
  const shop = app.user?.type === 'shop';
  return {
    body,
    foot: [
      h('p', { class: 'ad-note', text: '架空のお店です' }),
      h('button', { class: 'ad-shop', type: 'button', onclick: () => (shop ? app.showAdPreview() : app.openAccount('shop')), text: shop ? '自分の広告を見る' : '広告を出したい方へ' }),
    ],
  };
}
