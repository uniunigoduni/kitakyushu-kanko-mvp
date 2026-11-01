// 地図の上のピン。時代の区切りでだけ入れ替え、ズームに合わせて小さいピンを出し入れする。
// 大事なピンから順に置き、先に置いたピンと重なるピンは名前を隠すか、ピンごと隠す（HOI4 の都市のように、寄るほど増える）。
// 名前は右に出し、右がふさがっていれば左に出す。
// 時代ごとの注目の史跡には、赤ペンで描いたような矢印を一度だけ引く。
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { formatYear } from '../eras.js';
import { h, historicalName, svg } from '../util.js';
import { shortYear } from './band.js';
import { adIcon, iconOf } from './ads.js';

// ピンの頭の幅・高さと軸の高さ（css/style.css の .pin.lv* などと同じ値）。頭の中心は根元から軸の高さだけ上
const GEOM = {
  1: { w: 10, h: 10, stem: 0 },
  2: { w: 15, h: 15, stem: 12 },
  3: { w: 22, h: 22, stem: 18 },
  special: { w: 26, h: 26, stem: 20 }, // 特別演出のある史跡
  frame: { w: 62, h: 40, stem: 34 },   // 写真の枠のピン（時代ごとの場面がある場所）
  dummy: { w: 8, h: 8, stem: 0 },      // MVP 用のダミー
  ad: { w: 24, h: 24, stem: 17 },      // 広告（しずく形の先が根元）
  spot: { w: 24, h: 24, stem: 14 },    // 現代の地図の観光地（番号の丸）
};
// 一押しの史跡（pick）は、出す順では最大レベルのまま、大きさは中のピンにして色で見分ける。
// 現代の地図に出すとき（today）は、特別演出のある史跡も中のピンにそろえる
export const geomOf = (s, today = false) => GEOM[s.scenes ? 'frame' : s.special && !today ? 'special' : s.dummy ? 'dummy' : s.ad ? 'ad' : s.spot ? 'spot' : s.pick ? 2 : s.level];
// ピンに添える短い名前：「戦時中の門司港：出征の港と空襲」→「戦時中の門司港」
export const pinLabel = (name) => name.split('：')[0].replace(/（[^）]*）/g, '');
// 一押しの史跡は、その時代に加えて現代の地図にも「いまの姿」として出す
export const isToday = (s, era) => !!s.pick && era?.id === 'now' && !s.eras.includes('now');
// 現代の地図で名前に添える、さかのぼる先の年（「1934年」「1183年頃」「1912〜1913年」）。
// 年がはっきりしない伝承などは、データの yearShort（「平安末期」など）をそのまま使う
export const yearTag = (s) => s.yearShort ?? shortYear(s.yearLabel ?? '').match(/^前?\d+(?:〜\d+)?年頃?/)?.[0] ?? `${formatYear(s.year)}年`;

// 置く順（小さいほど先）：写真の枠 → 特別演出 → 広告 → 観光地 → 最大レベル → 中 → 小 → ダミー。同じレベルは注目の史跡が先。
// 広告は、自分の広告の見本（お店として登録した人にだけ出る）を先に置く。観光地は現代の地図にだけ出て、番号の順に置く
const tierOf = (s) => (s.scenes ? 0 : s.special ? 1 : s.ad ? (s.preview ? 1.4 : 1.5) : s.spot ? 1.6 : s.dummy ? 8 : (3 - s.level) * 2 + (s.featured ? 2 : 3));
// 出す近さ（ホームの距離に対する比がこれより小さいとき）。注目の史跡と中・最大レベル、広告はいつでも出す
const SMALL_R = 0.6, NAME_R = 0.4;        // 小さいピン、その名前
const DUMMY_R = 0.36, DUMMY_NAME_R = 0.2; // ダミーのピン、その名前
const small = (s) => s.level < 2 && !s.featured && !s.ad;
const showUnder = (s) => (s.dummy ? DUMMY_R : small(s) ? SMALL_R : Infinity);
const nameUnder = (s) => (s.dummy ? DUMMY_NAME_R : small(s) ? NAME_R : Infinity);
// 広告どうしは、頭のまわりにこれだけ空ける（引いた視点で広告ばかりが固まらないように。寄るほど数が増える）
const AD_GAP = 72, AD_GAP_KEEP = 56;
// 重なりの判定の余白。出ているピンは少しの重なりまで許し、隠れているピンは余裕ができてから出す（ちらつかないように）
const PAD_KEEP = 2, PAD_SHOW = 8;
// 大事なピンどうしの頭は、もっと近くまで並べてよい（寄りきれば、近くの一押しの史跡が画面の奥のほうでも両方出る）
const PAD_KEEP_MAJOR = 0, PAD_SHOW_MAJOR = 3;
// 画面の外にあるピンは重なりを調べない（名前がはみ出して見える分だけ、外も含める）
const OFF = 160;
// 赤い矢印の引き始め（ピンの頭から見た位置。上から順に、それぞれ短くしたものも試す）
const STARTS = [[-108, -84], [-132, -40], [108, -84], [-140, 24], [-108, 84], [-60, 120], [108, 84]];
const SCALES = [1, 0.72];
const SHORT = 0.5; // どの向きもふさがっているときの、いちばん短い矢印

export function createPins(app, world, sites) {
  const pins = new Map();
  // 観光地と同じ建物の史跡（観光地の same）：史跡の id → 観光地の id
  const merged = new Map(sites.filter((s) => s.spot && s.same && s.site).map((s) => [s.site, s.id]));
  for (const s of sites) {
    const head = h('span', { class: 'pin-head' });
    const label = h('span', { class: 'pin-name', text: pinLabel(historicalName(s)) });
    const hit = h('button', { class: 'pin-hit', type: 'button', tabindex: -1, 'aria-label': historicalName(s) }, head, label);
    const kind = (s.scenes ? ' is-frame' : s.special ? ' is-special' : s.dummy ? ' is-dummy' : s.ad ? ' is-ad' : s.spot ? ' is-spot' : '') + (s.pick ? ' is-pick' : '');
    const el = h('div', { class: `pin lv${s.level}${kind} is-off` }, h('i', { class: 'pin-shadow' }), h('i', { class: 'pin-stem' }), hit);
    const obj = new CSS2DObject(el);
    obj.position.copy(world.at(s.lon, s.lat, 0.4));
    obj.visible = false; // その時代になるまでは描かない（ダミーを入れると数が多いので）
    const tier = tierOf(s);
    obj.renderOrder = 10 - tier; // 大事なピンほど上に重ねる
    world.pinScene.add(obj);
    const p = { s, g: geomOf(s), el, hit, head, label, obj, tier, n: pins.size, show: showUnder(s), name: nameUnder(s), on: false, today: false, state: '', w: 0, offTimer: 0 };
    // 大事なピン（頭を先に置く）：最大レベル・注目・一押し・特別演出・写真の枠・広告・観光地
    p.major = !s.dummy && (s.level >= 3 || !!s.featured || !!s.special || !!s.scenes || !!s.pick || !!s.ad || !!s.spot);
    p.forced = false; p.left = false; p.q = { x: 0, y: 0 };
    p.was = ''; p.wasLeft = false; p.skip = false; p.evicted = false;
    if (s.scenes) {
      p.img = h('img', { alt: '', decoding: 'async' });
      head.append(p.img);
      setFrame(p, s.pano);
    }
    if (s.ad) setAd(p);
    if (s.spot) setSpot(p);
    hit.addEventListener('click', () => app.selectSite(s.id, { from: 'map' }));
    hit.addEventListener('pointerenter', () => { if (A.pin === p && A.drawn) g.classList.remove('is-dim'); });
    hit.addEventListener('pointerleave', () => { if (A.pin === p && A.drawn) g.classList.add('is-dim'); });
    pins.set(s.id, p);
  }

  // 写真の枠には、いまの年の場面の切り抜きを入れる（読み込めてから差し替える）
  function setFrame(p, pano) {
    const src = `assets/pano/${pano}_thumb.jpg`;
    if (p.src === src) return;
    p.src = src;
    const im = new Image();
    im.onload = () => { if (p.src === src) p.img.src = src; };
    im.src = src;
  }

  // 広告のピンは、しずく形の中に業種のアイコン。名前は店名だけにして（業種はアイコンで見分ける）、「広告」の札を添える。
  // 登録した長い店名（自分の広告の見本）は、途中から「…」で省く
  function setAd(p) {
    const s = p.s;
    p.head.replaceChildren(adIcon(iconOf(s)));
    p.label.replaceChildren(h('span', { class: 'pin-ad-name', text: s.short ?? pinLabel(s.name) }), h('span', { class: 'pin-ad', text: '広告' }));
    p.hit.setAttribute('aria-label', `${s.name}（広告）`);
    p.w = 0;
  }

  // 観光地のピンは、丸の中に一覧と同じ番号。名前は短い名前
  function setSpot(p) {
    const s = p.s;
    p.head.replaceChildren(h('b', { class: 'pin-num', text: String(s.n) }));
    p.label.replaceChildren(s.short ?? pinLabel(s.name));
    p.hit.setAttribute('aria-label', `${s.n}. ${s.name}`);
    p.w = 0;
  }

  // 現代の地図に出す一押しの史跡は、いまの名前に、さかのぼる先の年を添える
  function setToday(p, today) {
    const s = p.s;
    p.today = today;
    p.g = geomOf(s, today);
    p.el.classList.toggle('is-today', today);
    if (s.special) p.el.classList.toggle('is-special', !today);
    p.label.replaceChildren(today ? s.nowName ?? pinLabel(s.name) : pinLabel(historicalName(s)));
    if (today) p.label.append(h('span', { class: 'pin-year', text: yearTag(s) }));
    p.hit.setAttribute('aria-label', today ? `${s.nowName ?? pinLabel(s.name)}（${yearTag(s)}へさかのぼる）` : historicalName(s));
    p.w = 0;
  }

  // ---------- 時代 ----------
  const fadeIn = new Set();
  let dirty = true, needMeasure = true;
  function setEra(era) {
    for (const p of pins.values()) turn(p, era);
    needMeasure = true;
    dirty = true;
  }
  // その時代に出すピンを出し、出さないピンをしまう。
  // 観光地と同じ建物の一押しの史跡は、現代の地図では観光地のピンにまとめる（さかのぼるのは観光地の吹き出しから）
  function turn(p, era) {
    const today = isToday(p.s, era) && !merged.has(p.s.id);
    if (today !== p.today) setToday(p, today);
    const on = p.s.eras.includes(era.id) || today;
    if (on === p.on) return;
    p.on = on;
    clearTimeout(p.offTimer);
    if (on) {
      // 描き始めてから is-off を外すと、ふわっと出る
      p.obj.visible = true;
      fadeIn.add(p);
    } else {
      fadeIn.delete(p);
      p.el.classList.add('is-off');
      p.hit.tabIndex = -1;
      p.state = '';
      p.offTimer = setTimeout(() => { if (!p.on) p.obj.visible = false; }, 200);
    }
  }

  // ---------- ズームと重なり ----------
  // 頭・名前・軸の四角（地図の窓の中の px）。q にはピンの根元の位置が入っている
  const headRect = (p, q, out) => {
    const { w, h: hh, stem } = p.g, cy = q.y - stem;
    out[0] = q.x - w / 2 - 2; out[1] = cy - hh / 2 - 2; out[2] = q.x + w / 2 + 2; out[3] = cy + hh / 2 + 2;
    return out;
  };
  // 名前は頭の右（left のときは左）。p.w は頭＋間＋名前の幅
  const nameRect = (p, q, left, out) => {
    const { w, stem } = p.g, cy = q.y - stem, len = Math.max(p.w, w) - w + 4;
    out[0] = left ? q.x - w / 2 - len : q.x + w / 2; out[1] = cy - 10;
    out[2] = left ? q.x - w / 2 : q.x + w / 2 + len; out[3] = cy + 10;
    return out;
  };
  const stemRect = (p, q, out) => {
    const { h: hh, stem } = p.g;
    out[0] = q.x - 3; out[1] = q.y - stem + hh / 2; out[2] = q.x + 3; out[3] = q.y + 2;
    return out;
  };

  // 名前の幅（頭＋間＋名前）を測る。まだ描いていない（display:none の）ピンは 0 なので、次のコマで測り直す
  function measure() {
    let missing = false;
    for (const p of pins.values()) {
      if (!p.on || p.w) continue;
      p.w = p.hit.offsetWidth;
      if (!p.w) missing = true;
    }
    needMeasure = missing;
  }

  // 置いた四角。own を渡したときは、そのピン自身の頭と軸とは比べない
  const placed = [];
  const over = (a, b, pad) => b[0] < a[2] + pad && b[2] > a[0] - pad && b[1] < a[3] + pad && b[3] > a[1] - pad;
  // only を渡すと、その条件に合うピンとだけ調べる
  const hits = (b, pad, own, only) => {
    for (const a of placed) if (a.p !== own && (!only || only(a.p)) && over(a, b, pad)) return true;
    return false;
  };
  const put = (b, p) => { b.p = p; placed.push(b); };
  // b とぶつかる、必ず出すピン以外のピンを隠す（置いた頭と軸を取り除く）
  const evict = (b, own) => {
    for (let i = placed.length - 1; i >= 0; i--) {
      const q = placed[i]?.p;
      if (!q || q === own || q.forced || !over(placed[i], b, PAD_KEEP)) continue;
      for (let j = placed.length - 1; j >= 0; j--) if (placed[j].p === q) placed.splice(j, 1);
      q.evicted = true;
      setState(q, 'crowded');
      i = placed.length;
    }
  };
  // 名前が地図の端からはみ出すか（はみ出す側には出さない）
  const outside = (b) => b[0] < -4 || b[2] > world.size.W + 4;
  const Q = {};
  let lastR = -1, lastLayout = 0;
  // 大事なピンから順に置く。選んでいるピンと矢印のピン、写真の枠のピン（どの時代でも押せるように）は必ず出す。
  // 選んでいる間は矢印を隠すので、矢印のピンも重なれば隠す（現代の門司港駅と、同じ場所の「保存修理完了」など）。
  // 大事なピンは頭だけを先にすべて置き、名前はそのあとで空いている側に出す（ほかの名前のせいで頭が消えないように。
  // 寄りきれば、50m ほどしか離れていない一押しの史跡も両方出る）。小さいピンとダミーは、そのあとで 1 本ずつ置く
  function layout() {
    dirty = false;
    lastLayout = performance.now();
    if (needMeasure) { measure(); if (needMeasure) dirty = true; }
    const r = world.distance() / world.home.distance;
    lastR = r;
    const sel = app.selected;
    const rank = (p) => (p.s === sel ? -2 : p === A.pin ? -1 : p.tier);
    const list = [...pins.values()].filter((p) => p.on).sort((a, b) => rank(a) - rank(b) || a.n - b.n);
    // 出ていたかどうかは、並べ始める前の状態で見る（並べ直しても、ちらつきを防ぐ余白が変わらないように）
    for (const p of list) {
      p.was = p.state; p.wasLeft = p.left; p.skip = false;
      p.forced = p.s === sel || (p === A.pin && !sel) || !!p.s.scenes;
    }
    // 必ず出すピンの名前に押しのけられたピンは、外してから並べ直す（押しのけられたピンのせいで、
    // まわりのピン（広告どうしの間など）まで出ないままにならないように）
    for (let run = 0; run < 6 && placeMajor(list, r); run++);
    for (const p of list) if (!p.major && !p.forced && placeHead(p, r)) placeName(p, r);
  }
  // 大事なピンの頭を全部置いてから、名前を置く。押しのけられたピンがあれば、印を付けて true を返す
  function placeMajor(list, r) {
    placed.length = 0;
    const named = [];
    for (const p of list) {
      p.evicted = false;
      if (p.skip) setState(p, 'crowded');
      else if ((p.major || p.forced) && placeHead(p, r)) named.push(p);
    }
    for (const p of named) if (!p.evicted) placeName(p, r);
    let again = false;
    for (const p of named) if (p.evicted) again = p.skip = true;
    return again;
  }
  // 頭と軸を置く。名前まで置くときは true を返し、根元の位置を p.q に残す
  function placeHead(p, r) {
    if (!p.forced && r >= p.show) { setState(p, 'far'); return false; }
    world.project(p.obj.position, Q);
    const { W, H } = world.size;
    if (!Q.visible || Q.x < -OFF || Q.x > W + OFF || Q.y < -OFF || Q.y > H + OFF) { setState(p, p.forced || r < p.name ? 'full' : 'dot'); return false; }
    const kept = p.was === 'full' || p.was === 'dot';
    const pad = p.major ? (kept ? PAD_KEEP_MAJOR : PAD_SHOW_MAJOR) : kept ? PAD_KEEP : PAD_SHOW;
    const hr = headRect(p, Q, [0, 0, 0, 0]);
    if (!p.forced && hits(hr, pad)) { setState(p, 'crowded'); return false; }
    if (p.s.ad && !p.forced && hits(hr, kept ? AD_GAP_KEEP : AD_GAP, null, (q) => q.s.ad)) { setState(p, 'crowded'); return false; }
    put(hr, p);
    if (p.g.stem > p.g.h / 2) put(stemRect(p, Q, [0, 0, 0, 0]), p);
    p.q.x = Q.x; p.q.y = Q.y;
    return true;
  }
  // 名前を右に、ふさがっていれば左に出す。どちらにも入らなければ名前を隠す（必ず出すピンは、いまの側に出す）
  function placeName(p, r) {
    if (!p.forced && r >= p.name) { setState(p, 'dot'); return; }
    for (const left of [false, true]) {
      const nr = nameRect(p, p.q, left, [0, 0, 0, 0]);
      if (outside(nr) || hits(nr, p.was === 'full' && p.wasLeft === left ? PAD_KEEP : PAD_SHOW, p)) continue;
      setSide(p, left);
      put(nr, p);
      setState(p, 'full');
      return;
    }
    if (!p.forced) { setState(p, 'dot'); return; }
    // 必ず出すピンは、両側ともふさがっていても名前を出す。ほかの必ず出すピン（写真の枠など）とぶつからない側に出し、
    // そこにあるほかのピンは隠す。どちらの側もほかの必ず出すピンとぶつかるときは、選んでいるピンのほかは名前を隠す
    // （写真の枠は写真で見分けがつく）
    const free = (left) => { const b = nameRect(p, p.q, left, [0, 0, 0, 0]); return !outside(b) && !hits(b, PAD_KEEP, p, (q) => q.forced); };
    const left = free(false) ? false : free(true) ? true : null;
    if (left === null && p.s !== app.selected) { setState(p, 'dot'); return; }
    const nr = nameRect(p, p.q, !!left, [0, 0, 0, 0]);
    evict(nr, p);
    setSide(p, !!left);
    put(nr, p);
    setState(p, 'full');
  }
  function setSide(p, left) {
    if (p.left === left) return;
    p.left = left;
    p.el.classList.toggle('is-left', left);
  }
  function setState(p, st) {
    if (st === p.state) return;
    p.state = st;
    p.el.classList.toggle('is-far', st === 'far');
    p.el.classList.toggle('is-crowded', st === 'crowded');
    p.el.classList.toggle('is-dot', st === 'dot');
    p.hit.tabIndex = st === 'full' || st === 'dot' ? 0 : -1;
  }
  const shown = (p) => p.on && (p.state === 'full' || p.state === 'dot');

  // ---------- ピンの下の地名を消す ----------
  // 出ているピンの頭と名前・軸の四角。skip のピンは除く
  function pinRects(out, skip) {
    for (const p of pins.values()) {
      if (!shown(p) || p === skip) continue;
      world.project(p.obj.position, Q);
      if (!Q.visible) continue;
      const { w, h: hh, stem } = p.g, cy = Q.y - stem, half = Math.max(12, hh / 2 + 2);
      const len = p.state === 'full' ? Math.max(p.w, w) - w : 0;
      out.push([Q.x - w / 2 - 4 - (p.left ? len : 0), cy - half, Q.x + w / 2 + 4 + (p.left ? 0 : len), cy + half]);
      if (stem > hh / 2) out.push([Q.x - 9, cy + hh / 2, Q.x + 9, Q.y + 4]);
    }
    return out;
  }
  const rects = [];
  world.setLabelBlockers(() => { rects.length = 0; return pinRects(rects); });

  // ---------- 赤い矢印 ----------
  const map = world.renderer.domElement.parentElement;
  const layer = svg('svg', { class: 'arrow-layer', 'aria-hidden': 'true' });
  const g = svg('g');
  const shaft = svg('path');
  const tip = svg('path');
  g.append(shaft, tip);
  layer.append(g);
  map.append(layer);
  g.style.display = 'none';

  const A = { pin: null, drawn: false, hold: true, pending: false, timer: 0, dimTimer: 0, anims: [] };
  const P = {};
  const headAt = (p, out) => { world.project(p.obj.position, out); out.y -= p.g.stem; return out; };

  function resetArrow() {
    clearTimeout(A.timer); clearTimeout(A.dimTimer);
    for (const a of A.anims) a.cancel();
    A.anims = []; A.drawn = false; A.pending = false;
    g.style.display = 'none';
    g.classList.remove('is-dim');
  }
  function schedule(delay) {
    clearTimeout(A.timer);
    if (A.hold || A.drawn || !A.pin) return;
    A.timer = setTimeout(draw, delay);
  }

  function draw() {
    const p = A.pin;
    if (!p || A.drawn || A.hold) return;
    if (app.selected) { A.pending = true; return; }
    headAt(p, P);
    const { W, H } = world.size;
    if (!P.visible || P.x < 24 || P.x > W - 24 || P.y < 24 || P.y > H - 24) return; // 画面の外なら、次に止まったときに
    const S = pickStart(p);
    const sx = Math.sign(S[0]), sy = Math.sign(S[1]);
    const len = Math.hypot(S[0], S[1]);
    const u = [S[0] / len, S[1] / len];
    const r = Math.max(p.g.w, p.g.h) / 2 + 7;
    const T = [u[0] * r, u[1] * r];
    // 手で引いたような、ゆるい弧
    const d = [T[0] - S[0], T[1] - S[1]];
    const dl = Math.hypot(d[0], d[1]);
    const n = [-d[1] / dl, d[0] / dl];
    const bow = 15 * sx * sy * Math.min(1, len / 137);
    const C1 = [S[0] + d[0] * 0.35 + n[0] * bow, S[1] + d[1] * 0.35 + n[1] * bow];
    const C2 = [S[0] + d[0] * 0.75 + n[0] * bow * 0.45, S[1] + d[1] * 0.75 + n[1] * bow * 0.45];
    shaft.setAttribute('d', `M${S[0].toFixed(1)} ${S[1].toFixed(1)}C${C1[0].toFixed(1)} ${C1[1].toFixed(1)} ${C2[0].toFixed(1)} ${C2[1].toFixed(1)} ${T[0].toFixed(1)} ${T[1].toFixed(1)}`);
    // 矢じり：終わりの向きから左右 27° 開いた 2 本
    const tl = Math.hypot(T[0] - C2[0], T[1] - C2[1]);
    const b = [(C2[0] - T[0]) / tl, (C2[1] - T[1]) / tl];
    const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
    const w1 = rot(b, 0.47), w2 = rot(b, -0.47);
    tip.setAttribute('d', `M${(T[0] + w1[0] * 14).toFixed(1)} ${(T[1] + w1[1] * 14).toFixed(1)}L${T[0].toFixed(1)} ${T[1].toFixed(1)}L${(T[0] + w2[0] * 14).toFixed(1)} ${(T[1] + w2[1] * 14).toFixed(1)}`);

    A.drawn = true;
    g.classList.remove('is-dim');
    g.style.display = '';
    follow();
    const L1 = shaft.getTotalLength(), L2 = tip.getTotalLength();
    for (const [el, L] of [[shaft, L1], [tip, L2]]) { el.style.strokeDasharray = `${L} ${L}`; el.style.strokeDashoffset = `${L}`; }
    const a1 = shaft.animate([{ strokeDashoffset: `${L1}` }, { strokeDashoffset: '0' }], { duration: Math.max(350, (L1 / 500) * 1000), easing: 'cubic-bezier(0.65,0,0.35,1)', fill: 'forwards' });
    A.anims = [a1];
    a1.finished.then(() => {
      const a2 = tip.animate([{ strokeDashoffset: `${L2}` }, { strokeDashoffset: '0' }], { duration: 150, easing: 'ease-out', fill: 'forwards' });
      A.anims.push(a2);
      return a2.finished;
    }).then(() => {
      pop(p);
      A.dimTimer = setTimeout(() => g.classList.add('is-dim'), 2400);
    }).catch(() => { /* 途中で取り消した */ });
  }

  // 左上から引く。引き始めが窓からはみ出すときや、線が地名・ほかのピン・自分の名前にかかるときは、
  // 短くするか、左・右上・左下・下・右下の順に向きを変える（P にはピンの頭の位置が入っている）。
  // どの向きもふさがっているときは、もっと短くして試し、それでもだめなら、かかるところがいちばん少ない向きにする
  function pickStart(p) {
    const { W, H } = world.size;
    const hw = p.g.w;
    const avoid = pinRects(world.labelRects(), p);
    if (p.w) avoid.push(p.left ? [P.x + hw / 2 - p.w, P.y - 11, P.x - hw / 2, P.y + 11] : [P.x + hw / 2, P.y - 11, P.x - hw / 2 + p.w, P.y + 11]);
    const inWin = ([dx, dy]) => P.x + dx > 16 && P.x + dx < W - 16 && P.y + dy > 16 && P.y + dy < H - 16;
    // 線の上の 12 か所のうち、地名やピンにかかる数
    const cost = ([dx, dy]) => {
      let n = 0;
      for (let i = 0; i < 12; i++) {
        const k = i / 12, x = P.x + dx * (1 - k), y = P.y + dy * (1 - k);
        for (const b of avoid) if (x > b[0] - 6 && x < b[2] + 6 && y > b[1] - 6 && y < b[3] + 6) { n++; break; }
      }
      return n;
    };
    const clear = (s) => !cost(s);
    const fit = STARTS.flatMap(([dx, dy]) => SCALES.map((k) => [dx * k, dy * k])).filter(inWin);
    const short = STARTS.map(([dx, dy]) => [dx * SHORT, dy * SHORT]).filter(inWin);
    const found = fit.find(clear) ?? short.find(clear);
    if (found) return found;
    let best = null, least = Infinity;
    for (const s of fit.concat(short)) { const c = cost(s); if (c < least) { least = c; best = s; } }
    return best ?? STARTS[0];
  }

  // ピンを一度だけ弾ませる
  function pop(p) {
    p.el.classList.remove('is-pop');
    void p.el.offsetWidth;
    p.el.classList.add('is-pop');
    setTimeout(() => p.el.classList.remove('is-pop'), 320);
  }

  function follow() {
    if (!A.drawn || !A.pin) return;
    headAt(A.pin, P);
    if (!P.visible) { g.style.display = 'none'; return; }
    g.style.display = '';
    g.setAttribute('transform', `translate(${P.x.toFixed(1)} ${P.y.toFixed(1)})`);
  }

  // ---------- 出来事に合わせる ----------
  // 矢印を引く史跡：その時代に出ている注目の史跡のうち、いちばん先に置くもの（どの時代にも出る写真の枠とダミーは除く）。
  // 広告は注目の史跡ではないので選ばれない。現代では、観光地の 1 番の門司港駅（吹き出しから 1914 年へさかのぼれる）になる
  const featuredOf = () => {
    let best = null;
    for (const p of pins.values()) {
      if (!p.s.featured || p.s.scenes || p.s.dummy || !p.on) continue;
      if (!best || p.tier < best.tier) best = p;
    }
    return best;
  };
  app.on('era', (era, prev) => {
    setEra(era);
    resetArrow();
    A.pin = featuredOf();
    // 題字と同じく地名・ピンの書体も変わるので、大きさを測り直す
    if (prev?.font !== era.font) remeasure();
  });
  app.on('t', () => schedule(600)); // 時代が決まって 0.6 秒たったら引く
  app.on('scene', (s) => { const p = pins.get(s.id); if (p?.img) setFrame(p, s.pano); });
  app.on('select', (s) => {
    for (const p of pins.values()) {
      const on = p.s === s;
      p.el.classList.toggle('is-selected', on);
      p.obj.renderOrder = on ? 20 : 10 - p.tier;
    }
    layer.classList.add('is-hidden');
    dirty = true;
  });
  app.on('deselect', () => {
    for (const p of pins.values()) { p.el.classList.remove('is-selected'); p.obj.renderOrder = 10 - p.tier; }
    layer.classList.remove('is-hidden');
    if (A.pending) { A.pending = false; schedule(300); }
    dirty = true;
  });
  function remeasure() {
    for (const p of pins.values()) p.w = 0;
    needMeasure = true;
    dirty = true;
    world.measureLabels();
  }

  // 寄り引きはすぐ、動かしている間は 0.18 秒ごと、窓の大きさが変わったときと止まったときに置き直す
  const C = { x: NaN, y: NaN, z: NaN, W: 0, H: 0 };
  world.onFrame(() => {
    const cp = world.camera.position, { W, H } = world.size;
    const r = world.distance() / world.home.distance;
    const moved = cp.x !== C.x || cp.y !== C.y || cp.z !== C.z;
    if (dirty || Math.abs(r - lastR) > 0.004 || W !== C.W || H !== C.H || (moved && performance.now() - lastLayout > 180)) {
      C.x = cp.x; C.y = cp.y; C.z = cp.z; C.W = W; C.H = H;
      layout();
    }
    // 描き始めたピン（display が付いたもの）から、ふわっと出す
    for (const p of fadeIn) {
      if (p.el.style.display === 'none' || !p.el.isConnected) continue;
      fadeIn.delete(p);
      if (p.on) p.el.classList.remove('is-off');
    }
    follow();
  });
  document.fonts?.ready.then(remeasure);
  // ピンが画面の外で引けなかったときは、地図が止まったところでもう一度
  world.controls.addEventListener('rest', () => { dirty = true; schedule(300); });

  return {
    pins,
    // 冒頭の流しの間は矢印を止め、終わってから delay ミリ秒後に引く
    holdArrow() { A.hold = true; clearTimeout(A.timer); },
    releaseArrow(delay = 1000) { A.hold = false; schedule(delay); },
    position: (id) => pins.get(id)?.obj.position,
    // 現代へ戻ったとき、いまの場所のピンを弾ませる（観光地にまとめた史跡は、観光地のピン）
    pop(id) { const p = pins.get(merged.get(id) ?? id); if (p) pop(p); },
    // 中身や出す時代を変えたピンを描き直す（自分の広告の見本の店名・業種）
    refresh(id) {
      const p = pins.get(id);
      if (!p) return;
      if (p.s.ad) setAd(p);
      if (app.era) turn(p, app.era);
      needMeasure = true;
      dirty = true;
    },
  };
}
